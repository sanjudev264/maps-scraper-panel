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

function parseUniversalAddress(addressStr) {
  let fullAddress = "";
  let city = "";
  let country = "";

  if (!addressStr) return { fullAddress, city, country };

  fullAddress = addressStr.replace(/[\u00AD\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  
  const parts = fullAddress.split(',').map(p => p.trim()).filter(Boolean);
  
  if (parts.length > 0) {
    country = parts[parts.length - 1];
    if (parts.length > 1) {
      let potentialCity = parts[parts.length - 2];
      city = potentialCity.replace(/\b[A-Z]{2}\s*\d+(-\d+)?\b/i, '').trim();
      if (!city && parts.length > 2) {
        city = parts[parts.length - 3];
      }
    }
  }

  if (!city && parts.length > 0) city = parts[0];

  return { fullAddress, city, country };
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

  const scrapedMapUrls = new Set();

  // 🧹 [১. ফাইল ডুপ্লিকেট রিমুভ চেক] output.csv আগে থেকে থাকলে পুরনো লিংকগুলো লোড করে নেওয়া
  if (fs.existsSync(outputFile)) {
    const existingContent = fs.readFileSync(outputFile, 'utf-8');
    const existingRows = existingContent.split(/\r?\n/);
    existingRows.forEach(row => {
      // CSV এর ২য় কলামে "Google Map URL" থাকে
      const columns = row.split('","');
      if (columns.length > 1) {
        const existingUrl = columns[1].replace(/"/g, '').trim();
        if (existingUrl) scrapedMapUrls.add(existingUrl);
      }
    });
    console.log(`ℹ️ loaded ${scrapedMapUrls.size} existing leads from ${outputFile} to avoid duplicates.`);
  } else {
    fs.writeFileSync(outputFile, '\uFEFF"Original Search URL","Google Map URL","Title","Website","Phone Number","Review Count","Rating","Full Address","City","Country","Category"\n', 'utf-8');
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--disable-dev-shm-usage', 
      '--window-size=1280,850', 
      '--lang=en-US,en'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 850 });

  // 🚀 ব্রাউজার স্পিড বাড়ানোর জন্য মিডিয়া ব্লক
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  for (let i = 0; i < searchLinks.length; i++) {
    const searchUrl = searchLinks[i];
    console.log(`\n[Processing] URL: ${searchUrl}`);
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(4000); 

      const sidebarSelector = '.m6QErb[aria-label]';
      console.log("Scrolling sidebar to load maximum list...");
      await page.evaluate(async (selector) => {
        const sidebar = document.querySelector(selector) || document.querySelector('.m6QErb');
        if (sidebar) {
          for (let s = 0; s < 45; s++) {
            sidebar.scrollBy(0, 4000);
            await new Promise(r => setTimeout(r, 800));
            if (document.body.innerText.includes("You've reached the end of the list")) {
              break;
            }
          }
        }
      }, sidebarSelector);

      const companyElements = await page.$$('a[href*="/maps/place/"]');
      console.log(`Found ${companyElements.length} total shops on page.`);

      if (companyElements.length === 0) {
        console.log("⚠️ No shops found on this page.");
        continue;
      }

      for (let j = 0; j < companyElements.length; j++) {
        try {
          const element = companyElements[j];
          
          const currentMapUrl = await page.evaluate(el => el.href ? el.href.toString() : '', element);
          
          // 🧹 [২. ডুপ্লিকেট স্কিপ] ইউআরএল যদি আগে থেকে থেকে থাকে, তবে সাথে সাথে স্কিপ করবে
          if (!currentMapUrl || scrapedMapUrls.has(currentMapUrl)) {
            if (currentMapUrl) console.log(`[-] Skipped Duplicate URL: ${currentMapUrl}`);
            continue; 
          }

          await page.evaluate(el => el.scrollIntoView(), element);
          await element.click();
          await delay(2500);

          const details = await page.evaluate(() => {
            const nameEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1');
            const title = nameEl ? nameEl.innerText.toString().trim() : '';

            let category = '';
            const catBtn = document.querySelector('button[jsaction*="category"]') || document.querySelector('.fontBodyMedium .Rznmbe');
            if (catBtn) category = catBtn.innerText.toString().trim();

            let rating = '0';
            let reviewCount = '0';
            
            const ratingTextEl = document.querySelector('span.ceNzKf[aria-label]');
            if (ratingTextEl) {
              const attr = ratingTextEl.getAttribute('aria-label');
              const match = attr ? attr.match(/([0-9.]+)\s*stars/) || attr.match(/([0-9.]+)\s*তারকা/) : null;
              if (match) rating = match[1];
            } else {
              const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]') || document.querySelector('.fontDisplayLarge');
              if (ratingEl) rating = ratingEl.innerText.toString().trim();
            }
            
            const specificReviewEl = document.querySelector('.fontBodySmall');
            if (specificReviewEl && (specificReviewEl.innerText.toLowerCase().includes('reviews') || specificReviewEl.innerText.includes('রিভিউ') || specificReviewEl.innerText.toLowerCase().includes('opinion'))) {
                const matches = specificReviewEl.innerText.replace(/,/g, '').match(/\d+/);
                if (matches) reviewCount = matches[0];
            }

            if (reviewCount === '0' || reviewCount === '') {
                const reviewBtn = document.querySelector('button[jsaction*="pane.review.list"]') || document.querySelector('div.F7nice button');
                if (reviewBtn) {
                    const text = (reviewBtn.ariaLabel || reviewBtn.innerText || '').toLowerCase();
                    const matches = text.replace(/,/g, '').match(/\d+/);
                    if (matches) reviewCount = matches[0];
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

          if (!details.address || details.address.trim() === '') {
            console.log(`[-] Skipped: ${details.title} (No address)`);
            continue;
          }

          const numericRating = parseFloat(details.rating) || 0;
          if (numericRating < minRatingInput || numericRating > maxRatingInput) {
            console.log(`[-] Skipped: ${details.title} (Rating ${numericRating} out of range)`);
            continue; 
          }

          if (targetKeywords.length > 0) {
            const currentCat = details.category.toLowerCase().trim();
            const isMatched = targetKeywords.some(keyword => currentCat.includes(keyword.trim().toLowerCase()));
            if (!isMatched) {
              console.log(`[-] Skipped: ${details.title} (Category '${details.category}' not matched)`);
              continue;
            }
          }

          if (details.website && isExcludedWebsite(details.website)) continue;

          const { fullAddress, city, country } = parseUniversalAddress(details.address);

          const csvRow = `"${searchUrl.replace(/"/g, '""')}","${currentMapUrl.replace(/"/g, '""')}","${details.title.replace(/"/g, '""')}","${details.website.replace(/"/g, '""')}","${details.phone}","${details.reviewCount}","${details.rating}","${fullAddress.replace(/"/g, '""')}","${city.replace(/"/g, '""')}","${country.replace(/"/g, '""')}","${details.category.replace(/"/g, '""')}"\n`;
          
          fs.appendFileSync(outputFile, csvRow, 'utf-8');
          scrapedMapUrls.add(currentMapUrl); // 🎯 সেভ করার সাথে সাথে ট্র্যাকার সেটে ডুপ্লিকেট রেজিস্টার করে রাখা হলো
          console.log(`[+] Saved (${scrapedMapUrls.size}): ${details.title}`);

        } catch (err) { continue; }
      }
    } catch (err) { console.error(err.message); }
  }

  await browser.close();
  console.log(`🎉 স্ক্র্যাপিং সফলভাবে শেষ হয়েছে! মোট ইউনিক লিড: ${scrapedMapUrls.size}`);
}

runUltimateScraper();
