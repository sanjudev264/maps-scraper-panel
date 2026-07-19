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
      if (parts.length > 3 || !isCoUkType) {
        return true; 
      }
    }
    return false;
  } catch (e) {
    return false;
  }
}

// অ্যাড্রেস টেক্সট থেকে Street, City, State, Country আলাদা করার ফাংশন
function parseAddress(addressStr) {
  let street = "", city = "", state = "", country = "United States"; 
  if (!addressStr) return { street, city, state, country };

  const parts = addressStr.split(',').map(p => p.trim());
  
  if (parts.length >= 3) {
    // সাধারণত শেষ পার্ট Country অথবা State+Zip হয়
    const lastPart = parts[parts.length - 1];
    const secondLast = parts[parts.length - 2];
    
    // US Zip Code ফরম্যাট ম্যাচিং (e.g., NY 10001)
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
    try {
      completedLinks = JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    } catch (e) {
      completedLinks = [];
    }
  }

  // 📋 ঠিক আপনার এক্সেল ফরম্যাট অনুযায়ী হেডার তৈরি
  if (!fs.existsSync(outputFile)) {
    const BOM = '\uFEFF';
    fs.writeFileSync(outputFile, BOM + '"Original Search URL","Google Map URL","Title","Website","Phone Number","Review Count","Rating","Street","City","State","Country","Category"\n', 'utf-8');
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

            // রানিং ক্যাটাগরি এক্সট্র্যাকশন
            let category = '';
            const catBtn = document.querySelector('button[jsaction*="category"]');
            if (catBtn) category = catBtn.innerText.trim();

            // রেটিং এবং রিভিউ কাউন্ট এক্সট্র্যাকশন
            let rating = '0';
            let reviewCount = '0';
            
            const ratingEl = document.querySelector('div.F7nice span[aria-hidden="true"]');
            if (ratingEl) rating = ratingEl.innerText.trim();
            
            const reviewEl = document.querySelector('div.F7nice button.HH2X1e');
            if (reviewEl) {
              reviewCount = reviewEl.innerText.replace(/[()]/g, '').trim();
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

          // ডুপ্লিকেট চেকার
          if (uniqueTracker.has(lowerTitle) || (cleanPhone && uniqueTracker.has(cleanPhone))) {
            continue;
          }

          // ⭐ ফিল্টারিং লজিক: রেটিং ৩ বা তার বেশি হতে হবে
          const numericRating = parseFloat(details.rating) || 0;
          if (numericRating < 3.0) {
            console.log(`      [-] Skipped: ${details.title} (Rating is ${details.rating}, less than 3)`);
            continue;
          }

          // ক্যাটাগরি ও কিওয়ার্ড ম্যাচিং ফিল্টার
          let isTarget = false;
          if (details.category) isTarget = targetKeywords.some(k => details.category.toLowerCase().includes(k));
          if (!isTarget) isTarget = targetKeywords.some(k => lowerTitle.includes(k));

          if (!isTarget) continue;
          if (details.website && isExcludedWebsite(details.website)) continue;

          // ইউনিক ট্র্যাকিং সেট করা
          uniqueTracker.add(lowerTitle);
          if (cleanPhone) uniqueTracker.add(cleanPhone);

          // অ্যাড্রেস স্প্লিট করা
          const { street, city, state, country } = parseAddress(details.address);

          // এক্সেল সেফ ফরম্যাটিং ডাটা রাইট
          const csvRow = `"${searchUrl.replace(/"/g, '""')}","${details.googleMapUrl.replace(/"/g, '""')}","${details.title.replace(/"/g, '""')}","${details.website.replace(/"/g, '""')}","${details.phone}","${details.reviewCount}","${details.rating}","${street.replace(/"/g, '""')}","${city.replace(/"/g, '""')}","${state.replace(/"/g, '""')}","${country.replace(/"/g, '""')}","${details.category.replace(/"/g, '""')}"\n`;
          
          fs.appendFileSync(outputFile, csvRow, 'utf-8');
          console.log(`      [+] Saved: ${details.title} | Rating: ${details.rating} ⭐`);

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
  console.log(`\n🎉 সম্পূর্ণ প্রসেস শেষ! আপনার দেওয়া ফরম্যাটে ডাটা ফিল্টার করে সেভ করা হয়েছে।`);
}

runUltimateScraper();
