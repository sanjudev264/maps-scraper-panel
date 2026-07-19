const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const rawInclude = process.env.INCLUDE_CATEGORIES || ""; 
const rawExclude = process.env.EXCLUDE_DOMAINS || "";

const targetKeywords = rawInclude 
  ? rawInclude.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) 
  : [
      "air duct", "asbestos", "restoration", "carpet", "construction", 
      "contractor", "damage", "debris", "demolition", "environmental", 
      "fire", "general contractor", "inspector", "mold", "plumber", 
      "remodel", "roofing", "water"
    ];

const excludedDomainsRaw = rawExclude 
  ? rawExclude.split(',').map(item => item.trim().toLowerCase()).filter(Boolean) 
  : [];

function isExcludedWebsite(url) {
  if (!url) return false;
  try {
    const parsedUrl = new URL(url);
    let hostname = parsedUrl.hostname.toLowerCase().replace('www.', '');

    const defaultExcluded = [
      'servpro.com', 'pauldavis.com', 'puroclean.com', 'servicemasterrestore.com',
      'servicemasterclean.com', 'rainbowrestores.com', 'restoration1.com',
      '1800waterdamage.com', 'advantaclean.com', 'myvoda.com', 'steamatic.com',
      'coderedrestore.com', '911restoration.com', 'stanleysteemer.com',
      'biooneinc.com', 'belfor.com', 'atirestoration.com', 'goblusky.com',
      'cottonholdings.com', 'bmscat.com'
    ];

    const excludedDomains = excludedDomainsRaw.length > 0 ? excludedDomainsRaw : defaultExcluded;
    if (excludedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) return true;

    const parts = hostname.split('.');
    if (parts.length > 2) {
      const isCoUkType = parts[parts.length - 2] === 'co' || parts[parts.length - 2] === 'com';
      if (parts.length > 3 || !isCoUkType) return true; 
    }
    return false;
  } catch (e) {
    return false;
  }
}

function parseAddress(addressStr) {
  let street = "", city = "", state = "", country = "United States"; 
  if (!addressStr) return { street, city, state, country };

  let cleanAddr = addressStr.replace(/,?\s*United States$/i, '').trim();
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
        street = words.slice(0, words.length - 1).join(' ');
      } else {
        city = words[0];
      }
    }
  } else {
    const parts = cleanAddr.split(',').map(p => p.trim());
    if (parts.length >= 2) {
      street = parts.slice(0, parts.length - 2).join(', ');
      city = parts[parts.length - 2];
      state = parts[parts.length - 1];
    } else {
      street = cleanAddr;
    }
  }
  return { street, city, state, country };
}

async function runUltimateScraper() {
  const inputFile = 'input.csv';
  const outputFile = 'output.csv';

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: '${inputFile}' file not found!`);
    return;
  }

  const fileContent = fs.readFileSync(inputFile, 'utf-8');
  const lines = fileContent.split(/\r?\n/)
    .map(line => line.trim().replace(/^"|"$/g, '')) 
    .filter(line => line.length > 0);
    
  const searchLinks = lines.slice(1);

  // হেডার রাইট করা নিশ্চিত করা
  fs.writeFileSync(outputFile, '\uFEFF"Original Search URL","Google Map URL","Title","Website","Phone Number","Review Count","Rating","Street","City","State","Country","Category"\n', 'utf-8');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,850', '--lang=en-US,en']
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.setViewport({ width: 1280, height: 850 });

  for (let i = 0; i < searchLinks.length; i++) {
    const searchUrl = searchLinks[i];
    console.log(`\n[Processing] URL: ${searchUrl}`);

    try {
      await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
      await delay(5000); 

      // সাইডবার স্ক্রোলিং আরও শক্তিশালী করা
      const sidebarSelector = '.m6QErb[aria-label]';
      await page.evaluate(async (selector) => {
        const sidebar = document.querySelector(selector);
        if (sidebar) {
          for (let s = 0; s < 5; s++) {
            sidebar.scrollBy(0, 2000);
            await new Promise(r => setTimeout(r, 1000));
          }
        }
      }, sidebarSelector);

      const companyElements = await page.$$('a[href*="/maps/place/"]');
      console.log(`Found ${companyElements.length} companies to process.`);

      for (let j = 0; j < companyElements.length; j++) {
        try {
          const element = companyElements[j];
          await page.evaluate(el => el.scrollIntoView(), element);
          await element.click();
          await delay(3500); 

          const details = await page.evaluate(() => {
            const nameEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1');
            const title = nameEl ? nameEl.innerText.trim() : '';

            let category = '';
            const catBtn = document.querySelector('button[jsaction*="category"]');
            if (catBtn) category = catBtn.innerText.trim();

            let rating = '0';
            let reviewCount = '0';
            
            const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]') || document.querySelector('span.ceNzKf');
            if (ratingEl) rating = ratingEl.innerText.trim();
            
            const reviewEl = document.querySelector('div.F7nice button.HH2X1e') || document.querySelector('span.Zkbbqd');
            if (reviewEl) {
              const matches = reviewEl.innerText.match(/\d+/);
              if (matches) reviewCount = matches[0];
            }

            let website = '';
            const websiteEl = document.querySelector('a[data-item-id="authority"]');
            if (websiteEl) website = websiteEl.href || '';

            let phone = '';
            const phoneEl = document.querySelector('button[data-item-id^="phone:tel:"]');
            if (phoneEl) {
              phone = phoneEl.getAttribute('data-item-id').replace('phone:tel:', '').replace(/\s+/g, '').trim();
            }

            let address = '';
            const addressEl = document.querySelector('button[data-item-id="address"]');
            if (addressEl) address = addressEl.innerText.trim();

            return { title, category, website, phone, address, googleMapUrl: window.location.href, rating, reviewCount };
          });

          if (!details || !details.title) continue;

          // ফিল্টারিং শিথিল করা (চেক করার জন্য)
          const numericRating = parseFloat(details.rating) || 0;
          if (numericRating < 3.0) continue;

          if (details.website && isExcludedWebsite(details.website)) continue;

          const { street, city, state, country } = parseAddress(details.address);
          const cleanRating = details.rating.replace(/[^0-9.]/g, '').trim();
          const cleanReviewCount = details.reviewCount.replace(/[^0-9]/g, '').trim();

          const csvRow = `"${searchUrl.replace(/"/g, '""')}","${details.googleMapUrl.replace(/"/g, '""')}","${details.title.replace(/"/g, '""')}","${details.website.replace(/"/g, '""')}","${details.phone}","${cleanReviewCount || '0'}","${cleanRating || '0'}","${street.replace(/"/g, '""')}","${city.replace(/"/g, '""')}","${state.replace(/"/g, '""')}","${country.replace(/"/g, '""')}","${details.category.replace(/"/g, '""')}"\n`;
          
          fs.appendFileSync(outputFile, csvRow, 'utf-8');
          console.log(`[+] Saved: ${details.title}`);

        } catch (err) {
          continue;
        }
      }
    } catch (err) {
      console.error(`Error on URL: ${err.message}`);
    }
  }

  await browser.close();
  console.log(`🎉 স্ক্র্যাপিং সফলভাবে শেষ হয়েছে!`);
}

runUltimateScraper();
