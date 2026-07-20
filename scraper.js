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

  if (fs.existsSync(outputFile)) {
    const existingContent = fs.readFileSync(outputFile, 'utf-8');
    const existingRows = existingContent.split(/\r?\n/);
    existingRows.forEach(row => {
      const columns = row.split('","');
      if (columns.length > 1) {
        const existingUrl = columns[1].replace(/"/g, '').trim();
        if (existingUrl) scrapedMapUrls.add(existingUrl);
      }
    });
    console.log(`ℹ️ Loaded ${scrapedMapUrls.size} existing leads from ${outputFile}`);
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

  const mainPage = await browser.newPage();
  await mainPage.setViewport({ width: 1280, height: 850 });

  // রিমোনিং অপ্রয়োজনীয় মিডিয়া
  await mainPage.setRequestInterception(true);
  mainPage.on('request', (req) => {
    if (['image', 'media', 'font'].includes(req.resourceType())) {
      req.abort();
    } else {
      req.continue();
    }
  });

  for (let i = 0; i < searchLinks.length; i++) {
    const searchUrl = searchLinks[i];
    console.log(`\n[Processing] URL: ${searchUrl}`);
    try {
      await mainPage.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(5000); 

      console.log("Scrolling sidebar to collect all shop links...");
      
      // সাইডবার স্ক্রোল করে সব লিংক কালেক্ট করা
      const placeLinks = await mainPage.evaluate(async () => {
        const sidebar = document.querySelector('div[role="feed"]') || document.querySelector('.m6QErb');
        if (sidebar) {
          for (let s = 0; s < 25; s++) {
            sidebar.scrollBy(0, 3000);
            await new Promise(r => setTimeout(r, 800));
            if (document.body.innerText.includes("You've reached the end of the list")) break;
          }
        }
        const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
        return anchors.map(a => a.href).filter((href, index, self) => href && self.indexOf(href) === index);
      });

      console.log(`Found ${placeLinks.length} unique links. Scraping details now...`);

      // নতুন পেজে সরাসরি ইউআরএল নেভিগেট করে ডাটা তোলা (স্টাক হওয়ার চান্স ০%)
      const detailPage = await browser.newPage();
      await detailPage.setRequestInterception(true);
      detailPage.on('request', (req) => {
        if (['image', 'media', 'font'].includes(req.resourceType())) req.abort();
        else req.continue();
      });

      for (let j = 0; j < placeLinks.length; j++) {
        const mapUrl = placeLinks[j];

        if (scrapedMapUrls.has(mapUrl)) {
          console.log(`[-] Skipped Duplicate: ${mapUrl.substring(0, 50)}...`);
          continue;
        }

        try {
          // সরাসরি দোকানে চলে যাবে, পেজ লোডের জন্য মাত্র ১০ সে. টাইমআউট
          await detailPage.goto(mapUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await delay(1500);

          const details = await detailPage.evaluate(() => {
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

            const reviewBtn = document.querySelector('button[jsaction*="pane.review.list"]') || document.querySelector('div.F7nice button');
            if (reviewBtn) {
              const text = (reviewBtn.ariaLabel || reviewBtn.innerText || '').toLowerCase();
              const matches = text.replace(/,/g, '').match(/\d+/);
              if (matches) reviewCount = matches[0];
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

          if (!details || !details.title || details.title.toLowerCase() === 'results') continue;

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

          const csvRow = `"${searchUrl.replace(/"/g, '""')}","${mapUrl.replace(/"/g, '""')}","${details.title.replace(/"/g, '""')}","${details.website.replace(/"/g, '""')}","${details.phone}","${details.reviewCount}","${details.rating}","${fullAddress.replace(/"/g, '""')}","${city.replace(/"/g, '""')}","${country.replace(/"/g, '""')}","${details.category.replace(/"/g, '""')}"\n`;
          
          fs.appendFileSync(outputFile, csvRow, 'utf-8');
          scrapedMapUrls.add(mapUrl);
          console.log(`[+] Saved (${scrapedMapUrls.size}/${placeLinks.length}): ${details.title} | ${city}`);

        } catch (err) {
          console.log(`[-] Failed to load shop, skipping...`);
          continue;
        }
      }
      await detailPage.close();

    } catch (err) { console.error(err.message); }
  }

  await browser.close();
  console.log(`🎉 স্ক্র্যাপিং সফলভাবে শেষ হয়েছে! মোট সংগৃহীত লিড: ${scrapedMapUrls.size}`);
}

runUltimateScraper();
