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
    const isFranchise = excludedDomains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
    if (isFranchise) return true;

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

  const parts = addressStr.split(',').map(p => p.trim());
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    const stateZipRegex = /^([A-Z]{2})\s+\d{5}(-\d{4})?$/i;
    
    if (stateZipRegex.test(lastPart)) {
      state = lastPart.split(' ')[0];
      city = secondLast;
      street = parts.slice(0, parts.length - 2).join(', ');
    } else if (stateZipRegex.test(secondLast)) {
      country = lastPart;
      state = secondLast.split(' ')[0];
      city = parts[parts.length - 3];
      street = parts.slice(0, parts.length - 3).join(', ');
    } else {
      street = parts.slice(0, parts.length - 2).join(', ');
      city = secondLast;
      state = lastPart;
    }
  } else {
    street = addressStr;
  }
  return { street, city, state, country };
}

async function runUltimateScraper() {
  const inputFile = 'input.csv';
  const outputFile = 'output.csv';
  const progressFile = 'progress.json';

  if (!fs.existsSync(inputFile)) {
    console.error(`Error: '${inputFile}' file not found!`);
    return;
  }

  const fileContent = fs.readFileSync(inputFile, 'utf-8');
  const lines = fileContent.split(/\r?\n/)
    .map(line => line.trim().replace(/^"|"$/g, '')) 
    .filter(line => line.length > 0);
    
  const searchLinks = lines.slice(1);

  let completedLinks = [];
  if (fs.existsSync(progressFile)) {
    try { completedLinks = JSON.parse(fs.readFileSync(progressFile, 'utf-8')); } catch (e) {}
  }

  // নতুন ফাইল হলে হেডার যুক্ত করা (BOM ফিক্সসহ)
  if (!fs.existsSync(outputFile)) {
    fs.writeFileSync(outputFile, '\uFEFF"Original Search URL","Google Map URL","Title","Website","Phone Number","Review Count","Rating","Street","City","State","Country","Category"\n', 'utf-8');
  }

  const uniqueTracker = new Set();
  if (fs.existsSync(outputFile)) {
    const existingContent = fs.readFileSync(outputFile, 'utf-8');
    const existingLines = existingContent.split(/\r?\n/);
    for (let k = 1; k < existingLines.length; k++) {
      const parts = existingLines[k].split('","');
      if (parts.length > 3) {
        const title = parts[2].replace(/"/g, '').toLowerCase().trim();
        const phone = parts[4] ? parts[4].replace(/[^\d]/g, '') : '';
        if (title) uniqueTracker.add(title);
        if (phone) uniqueTracker.add(phone);
      }
    }
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,850', '--lang=en-US,en']
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
  await page.setViewport({ width: 1280, height: 850 });

  const remainingLinks = searchLinks.filter(link => !completedLinks.includes(link));

  for (let i = 0; i < remainingLinks.length; i++) {
    const searchUrl = remainingLinks[i];
    console.log(`\n[Processing] URL: ${searchUrl.substring(0, 50)}...`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(4000); 

      const sidebarSelector = '.m6QErb[aria-label]';
      for (let scrollCount = 0; scrollCount < 3; scrollCount++) {
        await page.evaluate((selector) => {
          const sidebar = document.querySelector(selector);
          if (sidebar) sidebar.scrollBy(0, 1500);
        }, sidebarSelector);
        await delay(1500); 
      }

      const companyElements = await page.$$('a[href*="/maps/place/"]');

      for (let j = 0; j < companyElements.length; j++) {
        try {
          const element = companyElements[j];
          await page.evaluate(el => el.scrollIntoView(), element);
          await element.click();
          await delay(3000); 

          const details = await page.evaluate(() => {
            const nameEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1');
            const title = nameEl ? nameEl.innerText.trim() : '';

            let category = '';
            const catBtn = document.querySelector('button[jsaction*="category"]');
            if (catBtn) category = catBtn.innerText.trim();

            let rating = '0';
            let reviewCount = '0';
            
            // নতুন গুগল ম্যাপস ক্লাস নেম অনুযায়ী রেটিং ও রিভিউ ব্যাকআপ হ্যান্ডলিং
            const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]') || document.querySelector('span.ceNzKf');
            if (ratingEl) rating = ratingEl.innerText.replace(/[^0-9.]/g, '').trim();
            
            // রিভিউ কাউন্ট ফিক্স (যেকোনো ফরম্যাট থেকে শুধু সংখ্যা তুলে আনবে)
            const reviewEl = document.querySelector('div.F7nice button.HH2X1e') || document.querySelector('span.Zkbbqd');
            if (reviewEl) {
              const rawReviews = reviewEl.innerText;
              const matches = rawReviews.match(/\d+([\.,]\d+)?/);
              if (matches) {
                reviewCount = matches[0].replace(/[\.,]/g, '');
              }
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

            const googleMapUrl = window.location.href;

            return { title, category, website, phone, address, googleMapUrl, rating, reviewCount };
          });

          if (!details || !details.title) continue;

          const lowerTitle = details.title.toLowerCase().trim();
          const cleanPhone = details.phone.replace(/[^\d]/g, '');

          if (uniqueTracker.has(lowerTitle) || (cleanPhone && uniqueTracker.has(cleanPhone))) continue;

          // ⭐ ফিল্টারিং লজিক: রেটিং ৩ বা তার বেশি হতে হবে
          const numericRating = parseFloat(details.rating) || 0;
          if (numericRating < 3.0) {
            console.log(`      [-] Skipped: ${details.title} (Rating: ${details.rating})`);
            continue;
          }

          let isTarget = false;
          if (details.category) isTarget = targetKeywords.some(k => details.category.toLowerCase().includes(k));
          if (!isTarget) isTarget = targetKeywords.some(k => lowerTitle.includes(k));

          if (!isTarget) continue;
          if (details.website && isExcludedWebsite(details.website)) continue;

          uniqueTracker.add(lowerTitle);
          if (cleanPhone) uniqueTracker.add(cleanPhone);

          const { street, city, state, country } = parseAddress(details.address);

          // অদ্ভুত ক্যারেক্টার ক্লিন করে একদম ফ্রেশ ভ্যালু ইনসার্ট
          const cleanRating = details.rating.replace(/[^0-9.]/g, '');
          const cleanReviewCount = details.reviewCount.replace(/[^0-9]/g, '');

          const csvRow = `"${searchUrl.replace(/"/g, '""')}","${details.googleMapUrl.replace(/"/g, '""')}","${details.title.replace(/"/g, '""')}","${details.website.replace(/"/g, '""')}","${details.phone}","${cleanReviewCount}","${cleanRating}","${street.replace(/"/g, '""')}","${city.replace(/"/g, '""')}","${state.replace(/"/g, '""')}","${country.replace(/"/g, '""')}","${details.category.replace(/"/g, '""')}"\n`;
          
          fs.appendFileSync(outputFile, csvRow, 'utf-8');
          console.log(`      [+] Saved: ${details.title} | Rating: ${cleanRating} ⭐ | Reviews: ${cleanReviewCount}`);

        } catch (err) {
          continue;
        }
      }

      completedLinks.push(searchUrl);
      fs.writeFileSync(progressFile, JSON.stringify(completedLinks, null, 2), 'utf-8');

    } catch (err) {
      console.error(`Error: ${err.message}`);
    }
  }

  if (fs.existsSync(progressFile)) fs.unlinkSync(progressFile);
  await browser.close();
  console.log(`\n🎉 ফিক্স সম্পন্ন হয়েছে! নতুন ফাইলে ডাটা একদম ফ্রেশ আসবে।`);
}

runUltimateScraper();
