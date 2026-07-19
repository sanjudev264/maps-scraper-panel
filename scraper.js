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

// 🎯 অ্যাড্রেস থেকে Street, City, State আলাদা করার একদম নতুন শক্তিশালী ফাংশন
function parseAddress(addressStr) {
  let street = "", city = "", state = "", country = "United States"; 
  if (!addressStr) return { street, city, state, country };

  // অ্যাড্রেস থেকে United States লেখাটি থাকলে তা বাদ দিয়ে ক্লিন করা
  let cleanAddr = addressStr.replace(/,?\s*United States$/i, '').trim();

  // US State এবং Zip কোড খোঁজার রেগুলার এক্সপ্রেশন (e.g., MD 21401 or MD)
  const stateZipRegex = /\b([A-Z]{2})\s*(\d{5}(-\d{4})?)?\s*$/i;
  const match = cleanAddr.match(stateZipRegex);

  if (match) {
    state = match[1].toUpperCase(); // State পেয়ে গেলাম (e.g., MD)
    // জিপ কোড এবং স্টেটের অংশটুকু মূল টেক্সট থেকে বাদ দিন
    let remaining = cleanAddr.substring(0, match.index).trim().replace(/,$/, '').trim();
    
    // এবার কমা দিয়ে বা শেষ শব্দ ধরে City এবং Street আলাদা করা
    const parts = remaining.split(',').map(p => p.trim());
    if (parts.length > 1) {
      city = parts[parts.length - 1];
      street = parts.slice(0, parts.length - 1).join(', ');
    } else if (parts.length === 1 && parts[0] !== "") {
      // যদি কোনো কমা না থাকে, তবে শেষ শব্দটিকে City ধরা হবে এবং বাকিটা Street
      const words = parts[0].split(/\s+/);
      if (words.length > 1) {
        city = words[words.length - 1];
        street = words.slice(0, words.length - 1).join(' ');
      } else {
        city = words[0];
        street = ""; // কোনো স্ট্রিট অ্যাড্রেস ম্যাপে দেওয়া ছিল না
      }
    }
  } else {
    // যদি কোনো স্টেট ফরম্যাট না মেলে, তবে নরমাল কমা স্প্লিট
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

  // একদম ফ্রেশ হেডার তৈরি (BOM ক্যারেক্টার সমস্যা সম্পূর্ণ ফিক্সড)
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
            
            // রেটিং এলিমেন্ট রিড করা
            const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]') || document.querySelector('span.ceNzKf');
            if (ratingEl) rating = ratingEl.innerText.trim();
            
            // গুগল ম্যাপসের নতুন ইন্টারনাল টেক্সট থেকে রিভিউ সংখ্যা বের করা
            const reviewEl = document.querySelector('div.F7nice button.HH2X1e') || document.querySelector('span.Zkbbqd') || document.querySelector('.fontBodyMedium span[aria-label*="reviews"]');
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

            const googleMapUrl = window.location.href;

            return { title, category, website, phone, address, googleMapUrl, rating, reviewCount };
          });

          if (!details || !details.title) continue;

          const lowerTitle = details.title.toLowerCase().trim();
          const cleanPhone = details.phone.replace(/[^\d]/g, '');

          if (uniqueTracker.has(lowerTitle) || (cleanPhone && uniqueTracker.has(cleanPhone))) continue;

          // ⭐ রেটিং ৩ বা তার বেশি ফিল্টারিং
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

          // নতুন অ্যাড্রেস পার্সার ব্যবহার
          const { street, city, state, country } = parseAddress(details.address);

          // চারকোনা বক্স বা ইনভ্যালিড টেক্সট ক্লিন করা
          const cleanRating = details.rating.replace(/[^0-9.]/g, '').trim();
          const cleanReviewCount = details.reviewCount.replace(/[^0-9]/g, '').trim();

          const csvRow = `"${searchUrl.replace(/"/g, '""')}","${details.googleMapUrl.replace(/"/g, '""')}","${details.title.replace(/"/g, '""')}","${details.website.replace(/"/g, '""')}","${details.phone}","${cleanReviewCount || '0'}","${cleanRating || '0'}","${street.replace(/"/g, '""')}","${city.replace(/"/g, '""')}","${state.replace(/"/g, '""')}","${country.replace(/"/g, '""')}","${details.category.replace(/"/g, '""')}"\n`;
          
          fs.appendFileSync(outputFile, csvRow, 'utf-8');
          console.log(`      [+] Saved: ${details.title} | Rating: ${cleanRating} | Reviews: ${cleanReviewCount} | City: ${city} | State: ${state}`);

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
  console.log(`\n🎉 আপডেট সম্পন্ন! এখন ডাটা একদম পারফেক্ট কলামে আসবে।`);
}

runUltimateScraper();
