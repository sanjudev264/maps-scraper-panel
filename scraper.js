const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// এনভায়রনমেন্ট ভ্যারিয়েবল থেকে প্যানেলের ইনপুট ডেটা রিড করা
const rawInclude = process.env.INCLUDE_CATEGORIES || ""; 
const rawExclude = process.env.EXCLUDE_DOMAINS || "";
const minRatingInput = parseFloat(process.env.MIN_RATING) || 0;
const maxRatingInput = parseFloat(process.env.MAX_RATING) || 5;

// নতুন লাইন (\n) দিয়ে টেক্সটকে অ্যারেতে কনভার্ট করা
const targetKeywords = rawInclude 
  ? rawInclude.split('\n').map(item => item.trim().toLowerCase()).filter(Boolean) 
  : []; 

const excludedDomainsRaw = rawExclude 
  ? rawExclude.split('\n').map(item => item.trim().toLowerCase()).filter(Boolean) 
  : [];

function isExcludedWebsite(url) {
  if (!url) return false;
  try {
    const parsedUrl = new URL(url);
    let hostname = parsedUrl.hostname.toLowerCase().replace('www.', '');
    const defaultExcluded = ['youtube.com', 'linkedin.com', 'crunchbase.org', 'pitchbook.com', 'yelp.com'];
    const excludedDomains = excludedDomainsRaw.length > 0 ? excludedDomainsRaw : defaultExcluded;
    if (excludedDomains.some(domain => hostname === domain || hostname.includes(domain))) return true;
    return false;
  } catch (e) { return false; }
}

function parseAddress(addressStr) {
  let street = "", city = "", state = "", country = "United States"; 
  if (!addressStr) return { street, city, state, country };
  
  // ঠিকানার ভেতরের যেকোনো হিডেন বা ব্রোকেন ক্যারেক্টার এবং স্পেস ক্লিন করা (সাদা বক্স ফিক্স)
  let cleanAddr = addressStr.replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  cleanAddr = cleanAddr.replace(/,?\s*United States$/i, '').trim();
  
  const stateZipRegex = /\b([A-Z]{2})\s*(\d{5}(-\d{4})?)?\s*$/i;
  const match = cleanAddr.match(stateZipRegex);
  if (match) {
    state = match[1].toUpperCase();
    let remaining = cleanAddr.substring(0, match.index).trim().replace(/,$/, '').trim();
    const parts = remaining.split(',').map(p => p.trim());
    if (parts.length > 1) {
      city = parts[parts.length - 1];
      street = parts.slice(0, parts.length - 1).join(', ');
    } else if (parts.length === 1 && parts[0] !== "") {
      const words = parts[0].split(/\s+/);
      if (words.length > 1) {
        city = words[words.length - 1];
        street = words.slice(0, words.slice(0, words.length - 1).join(' ').length).trim();
      } else { city = words[0]; }
    }
  } else {
    const parts = cleanAddr.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      state = parts[parts.length - 1];
      city = parts[parts.length - 2];
      street = parts.slice(0, parts.length - 2).join(', ');
    } else { street = cleanAddr; }
  }
  return { street, city, state, country };
}

async function runUltimateScraper() {
  const inputFile = 'input.csv';
  const outputFile = 'output.csv';

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: '${inputFile}' not found!`);
    return;
  }

  const fileContent = fs.readFileSync(inputFile, 'utf-8');
  const lines = fileContent.split(/\r?\n/).map(line => line.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const searchLinks = lines.slice(1);

  // UTF-8 BOM সহ হেডার রাইট করা যাতে এক্সেল ফাইল সরাসরি ওপেন করলেও ফন্ট না ভাঙে
  fs.writeFileSync(outputFile, '\uFEFF"Original Search URL","Google Map URL","Title","Website","Phone Number","Review Count","Rating","Street","City","State","Country","Category"\n', 'utf-8');

  // ডুপ্লিকেট রোধ করার জন্য ইউনিক সেট ব্যবহার
  const scrapedMapUrls = new Set();

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--window-size=1280,850', '--lang=en-US,en']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 850 });

  for (let i = 0; i < searchLinks.length; i++) {
    const searchUrl = searchLinks[i];
    console.log(`\n[Processing] URL: ${searchUrl}`);
    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await delay(5000); 

      const sidebarSelector = '.m6QErb[aria-label]';
      await page.evaluate(async (selector) => {
        const sidebar = document.querySelector(selector);
        if (sidebar) {
          for (let s = 0; s < 6; s++) {
            sidebar.scrollBy(0, 2500);
            await new Promise(r => setTimeout(r, 1200));
          }
        }
      }, sidebarSelector);

      const companyElements = await page.$$('a[href*="/maps/place/"]');
      console.log(`Found ${companyElements.length} shops to check.`);

      for (let j = 0; j < companyElements.length; j++) {
        try {
          const element = companyElements[j];
          
          // গিটহাব ম্যাপস ইউআরএল সরাসরি এলিমেন্ট থেকে আগেই রিড করে চেক করা (ডুপ্লিকেট আটকানোর প্রধান লজিক)
          const currentMapUrl = await page.evaluate(el => el.href ? el.href.toString() : '', element);
          if (!currentMapUrl || scrapedMapUrls.has(currentMapUrl)) {
            continue; // ডুপ্লিকেট হলে স্কিপ করবে
          }

          await page.evaluate(el => el.scrollIntoView(), element);
          await element.click();
          await delay(4000); 

          const details = await page.evaluate(() => {
            const nameEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1');
            const title = nameEl ? nameEl.innerText.toString().trim() : '';

            let category = '';
            const catBtn = document.querySelector('button[jsaction*="category"]');
            if (catBtn) category = catBtn.innerText.toString().trim();

            let rating = '0';
            let reviewCount = '0';
            
            // ১. রেটিং ডিটেকশন ফিক্স
            const ratingTextEl = document.querySelector('span.ceNzKf[aria-label]');
            if (ratingTextEl) {
              const attr = ratingTextEl.getAttribute('aria-label');
              const match = attr ? attr.match(/([0-9.]+)\s*stars/) || attr.match(/([0-9.]+)\s*তারকা/) : null;
              if (match) rating = match[1];
            } else {
              const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]');
              if (ratingEl) rating = ratingEl.innerText.toString().trim();
            }
            
            // 🎯 ২. শক্তিশালী রিভিউ কাউন্ট ডিটেকশন ফিক্স (একাধিক ক্লাস চেক করা হচ্ছে)
            const reviewSelectors = [
              'div.F7nice button.HH2X1e', 
              'div.F7nice span.Zkbbqd',
              'button[jsaction*="pane.review.list"] span',
              'div.F7nice span:nth-child(2) span aria-label'
            ];
            
            for (let selector of reviewSelectors) {
              const el = document.querySelector(selector);
              if (el) {
                let text = el.getAttribute('aria-label') || el.innerText || '';
                const matches = text.toString().replace(/,/g, '').match(/\d+/);
                if (matches) {
                  reviewCount = matches[0];
                  break;
                }
              }
            }

            let website = '';
            const websiteEl = document.querySelector('a[data-item-id="authority"]');
            if (websiteEl) website = websiteEl.href ? websiteEl.href.toString() : '';

            let phone = '';
            const phoneEl = document.querySelector('button[data-item-id^="phone:tel:"]');
            if (phoneEl) {
              phone = phoneEl.getAttribute('data-item-id').toString().replace('phone:tel:', '').replace(/\s+/g, '').trim();
            }

            let address = '';
            const addressEl = document.querySelector('button[data-item-id="address"]');
            if (addressEl) address = addressEl.innerText.toString().trim();

            return { title, category, website, phone, address, rating, reviewCount };
          });

          if (!details || !details.title) continue;

          // ডায়নামিক রেটিং ফিল্টার চেক
          const numericRating = parseFloat(details.rating) || 0;
          if (numericRating < minRatingInput || numericRating > maxRatingInput) {
            console.log(`[-] Skipped (Rating ${numericRating} is out of specified range)`);
            continue; 
          }

          // ডায়নামিক ক্যাটাগরি ফিল্টার চেক
          if (targetKeywords.length > 0) {
            const currentCat = details.category.toLowerCase();
            const isMatched = targetKeywords.some(keyword => currentCat.includes(keyword));
            if (!isMatched) continue;
          }

          if (details.website && isExcludedWebsite(details.website)) continue;

          // ঠিকানার ক্যারেক্টার ফিক্স করে ফিল্ড আলাদা করা
          const { street, city, state, country } = parseAddress(details.address);

          const csvRow = `"${searchUrl.replace(/"/g, '""')}","${currentMapUrl.replace(/"/g, '""')}","${details.title.replace(/"/g, '""')}","${details.website.replace(/"/g, '""')}","${details.phone}","${details.reviewCount}","${details.rating}","${street.replace(/"/g, '""')}","${city.replace(/"/g, '""')}","${state.replace(/"/g, '""')}","${country.replace(/"/g, '""')}","${details.category.replace(/"/g, '""')}"\n`;
          
          fs.appendFileSync(outputFile, csvRow, 'utf-8');
          scrapedMapUrls.add(currentMapUrl); // সেটে অ্যাড করা হলো যাতে পরে আর ডুপ্লিকেট না হয়
          console.log(`[+] Saved: ${details.title} (Rating: ${numericRating}, Reviews: ${details.reviewCount})`);

        } catch (err) { continue; }
      }
    } catch (err) { console.error(err.message); }
  }

  await browser.close();
  console.log(`🎉 স্ক্র্যাপিং সফলভাবে শেষ হয়েছে!`);
}

runUltimateScraper();
