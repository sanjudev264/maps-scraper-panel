const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rawInclude = process.env.INCLUDE_CATEGORIES || ""; 
const rawExclude = process.env.EXCLUDE_DOMAINS || "";
const minRatingInput = parseFloat(process.env.MIN_RATING) || 0;
const maxRatingInput = parseFloat(process.env.MAX_RATING) || 5;

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
        street = words.slice(0, words.slice(0, words.slice(0, words.length - 1).join(' ').length).trim();
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

  fs.writeFileSync(outputFile, '\uFEFF"Original Search URL","Google Map URL","Title","Website","Phone Number","Review Count","Rating","Street","City","State","Country","Category"\n', 'utf-8');

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
          
          const currentMapUrl = await page.evaluate(el => el.href ? el.href.toString() : '', element);
          if (!currentMapUrl || scrapedMapUrls.has(currentMapUrl)) {
            continue; 
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
            
            // ১. রেটিং ডিটেকশন
            const ratingTextEl = document.querySelector('span.ceNzKf[aria-label]');
            if (ratingTextEl) {
              const attr = ratingTextEl.getAttribute('aria-label');
              const match = attr ? attr.match(/([0-9.]+)\s*stars/) || attr.match(/([0-9.]+)\s*তারকা/) : null;
              if (match) rating = match[1];
            } else {
              const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]') || document.querySelector('.fontDisplayLarge');
              if (ratingEl) rating = ratingEl.innerText.toString().trim();
            }
            
            // 🎯 ২. স্ক্রিনশট অনুযায়ী কাস্টমাইজড রিভিউ কাউন্ট ফিক্স
            // প্রথমে সরাসরি আপনার স্ক্রিনশটের ক্লাস এবং টেক্সট প্যাটার্ন ম্যাচ করার চেষ্টা করবে
            const specificReviewEl = document.querySelector('.fontBodySmall');
            if (specificReviewEl && (specificReviewEl.innerText.includes('reviews') || specificReviewEl.innerText.includes('রিভিউ'))) {
              const matches = specificReviewEl.innerText.replace(/,/g, '').match(/\d+/);
              if (matches) reviewCount = matches[0];
            }

            // যদি উপরের সুনির্দিষ্ট ক্লাসে না পায়, তবে ব্যাকআপ হিসেবে পুরো প্যানেল স্ক্যান করবে
            if (reviewCount === '0') {
              const allElements = Array.from(document.querySelectorAll('button, span, div'));
              for (let el of allElements) {
                const text = (el.ariaLabel || el.innerText || '').toLowerCase();
                if (text.includes('google reviews') || text.includes('reviews') || text.includes('রিভিউ')) {
                  const matches = text.replace(/,/g, '').match(/\d+/);
                  if (matches) {
                    reviewCount = matches[0];
                    break; 
                  }
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

          const numericRating = parseFloat(details.rating) || 0;
          if (numericRating < minRatingInput || numericRating > maxRatingInput) {
            console.log(`[-] Skipped (Rating ${numericRating} is out of specified range)`);
            continue; 
          }

          if (targetKeywords.length > 0) {
            const currentCat = details.category.toLowerCase();
            const isMatched = targetKeywords.some(keyword => currentCat.includes(keyword));
            if (!isMatched) continue;
          }

          if (details.website && isExcludedWebsite(details.website)) continue;

          const { street, city, state, country } = parseAddress(details.address);

          const csvRow = `"${searchUrl.replace(/"/g, '""')}","${currentMapUrl.replace(/"/g, '""')}","${details.title.replace(/"/g, '""')}","${details.website.replace(/"/g, '""')}","${details.phone}","${details.reviewCount}","${details.rating}","${street.replace(/"/g, '""')}","${city.replace(/"/g, '""')}","${state.replace(/"/g, '""')}","${country.replace(/"/g, '""')}","${details.category.replace(/"/g, '""')}"\n`;
          
          fs.appendFileSync(outputFile, csvRow, 'utf-8');
          scrapedMapUrls.add(currentMapUrl); 
          console.log(`[+] Saved: ${details.title} (Rating: ${numericRating}, Reviews: ${details.reviewCount})`);

        } catch (err) { continue; }
      }
    } catch (err) { console.error(err.message); }
  }

  await browser.close();
  console.log(`🎉 স্ক্র্যাপিং সফলভাবে শেষ হয়েছে!`);
}

runUltimateScraper();
