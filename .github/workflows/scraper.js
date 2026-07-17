const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// গিটহাব ওয়েব প্যানেল থেকে পাঠানো ক্যাটাগরি ও ডোমেইন রিড করা
const rawInclude = process.env.INCLUDE_CATS || "";
const rawExclude = process.env.EXCLUDE_DOMAINS || "";

// প্যানেলে ইনপুট না দিলে এই ডিফল্ট কি-ওয়ার্ডগুলো কাজ করবে
const targetKeywords = rawInclude 
  ? rawInclude.split(',').map(item => item.trim().toLowerCase()) 
  : [
      "air duct", "asbestos", "restoration", "carpet", "construction", 
      "contractor", "damage", "debris", "demolition", "environmental", 
      "fire", "general contractor", "inspector", "mold", "plumber", 
      "remodel", "roofing", "water"
    ];

// প্যানেলে ইনপুট না দিলে এই ডিফল্ট ডোমেইনগুলো এক্সক্লুড হবে
const excludedDomainsRaw = rawExclude 
  ? rawExclude.split(',').map(item => item.trim().toLowerCase()) 
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

    // গিটহাব প্যানেল থেকে কোনো ডোমেইন দিলে সেটি ব্যবহার হবে, না দিলে ডিফল্ট লিস্ট কাজ করবে
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

  console.log(`[INFO] Total search links in input: ${searchLinks.length}`);
  console.log(`[INFO] Already processed: ${completedLinks.length} links.`);
  
  const remainingLinks = searchLinks.filter(link => !completedLinks.includes(link));
  console.log(`[INFO] Remaining to process: ${remainingLinks.length} links.\n`);

  if (remainingLinks.length === 0) {
    console.log("🎉 All links have already been processed!");
    return;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox', 
      '--window-size=1280,850',
      '--lang=en-US,en'
    ]
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9'
  });
  await page.setViewport({ width: 1280, height: 850 });

  const uniqueTracker = new Set();
  
  if (fs.existsSync(outputFile)) {
    console.log("[INFO] Loading existing phone/name data into memory for instant duplicate checking...");
    const existingContent = fs.readFileSync(outputFile, 'utf-8');
    const existingLines = existingContent.split(/\r?\n/);
    
    for (let k = 1; k < existingLines.length; k++) {
      const line = existingLines[k].trim();
      if (!line) continue;
      
      const parts = line.split('","');
      if (parts.length > 2) {
        const phone = parts[2].replace(/'/g, '').trim(); 
        const name = parts[0].replace(/"/g, '').toLowerCase().trim();
        if (phone) uniqueTracker.add(phone);
        if (name) uniqueTracker.add(name);
      }
    }
    console.log(`   └─ Loaded ${uniqueTracker.size} unique keys successfully.\n`);
  } else {
    const BOM = '\uFEFF';
    fs.writeFileSync(outputFile, BOM + 'Company Name,Website,Phone,Address,Google Maps Link\n', 'utf-8');
  }

  for (let i = 0; i < remainingLinks.length; i++) {
    const searchUrl = remainingLinks[i];
    const totalRemaining = remainingLinks.length;
    console.log(`\n[${i + 1}/${totalRemaining}] Processing: ${searchUrl.substring(0, 60)}...`);

    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await delay(4000); 

      const sidebarSelector = '.m6QErb[aria-label]';
      
      console.log(`   └─ Scrolling sidebar...`);
      for (let scrollCount = 0; scrollCount < 3; scrollCount++) {
        await page.evaluate((selector) => {
          const sidebar = document.querySelector(selector);
          if (sidebar) sidebar.scrollBy(0, 1500);
        }, sidebarSelector);
        await delay(1500); 
      }

      const companyElements = await page.$$('a[href*="/maps/place/"]');
      console.log(`   └─ Found ${companyElements.length} companies. Analyzing each...`);

      for (let j = 0; j < companyElements.length; j++) {
        let companyDetails = null;
        let attempts = 0;

        try {
          const element = companyElements[j];
          await page.evaluate(el => el.scrollIntoView(), element);
          await element.click();
          
          await delay(3000); 

          while (attempts < 3) {
            try {
              companyDetails = await page.evaluate(() => {
                const nameEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1');
                const companyName = nameEl ? nameEl.innerText.trim() : '';

                let category = '';
                const catBtn = document.querySelector('button[jsaction*="category"]');
                if (catBtn) {
                  category = catBtn.innerText.trim().toLowerCase();
                } else {
                  const buttons = Array.from(document.querySelectorAll('button'));
                  const foundBtn = buttons.find(b => (b.getAttribute('jsaction') || '').includes('category'));
                  if (foundBtn) category = foundBtn.innerText.trim().toLowerCase();
                }

                let website = '';
                const websiteEl = document.querySelector('a[data-item-id="authority"]');
                if (websiteEl) website = websiteEl.href || '';

                let phone = '';
                const phoneEl = document.querySelector('button[data-item-id^="phone:tel:"]');
                if (phoneEl) {
                  phone = phoneEl.getAttribute('data-item-id').replace('phone:tel:', '').trim();
                }

                let address = '';
                const addressEl = document.querySelector('button[data-item-id="address"]');
                if (addressEl) address = addressEl.innerText.trim();

                const currentUrl = window.location.href;

                return { companyName, category, website, phone, address, currentUrl };
              });
              
              break; 
            } catch (frameErr) {
              attempts++;
              if (frameErr.message.includes('detached Frame')) {
                await delay(1500); 
              } else {
                throw frameErr;
              }
            }
          }

          if (!companyDetails) continue;

          const { companyName, category, website, phone, address, currentUrl } = companyDetails;

          if (companyName) {
            const lowerName = companyName.toLowerCase().trim();
            if (uniqueTracker.has(lowerName) || (phone && uniqueTracker.has(phone))) {
              console.log(`      [-] Skipped: ${companyName} (Duplicate)`);
              continue;
            }

            let isTarget = false;
            if (category) {
              isTarget = targetKeywords.some(keyword => category.includes(keyword));
            } 
            if (!isTarget) {
              isTarget = targetKeywords.some(keyword => lowerName.includes(keyword));
            }

            if (!isTarget) {
              console.log(`      [-] Skipped: ${companyName} (No matching Category/Name found)`);
              continue;
            }

            if (website && isExcludedWebsite(website)) {
              console.log(`      [-] Skipped: ${companyName} (Excluded Website/Subdomain: ${website})`);
              continue;
            }

            if (phone) uniqueTracker.add(phone);
            uniqueTracker.add(lowerName);

            const safeName = companyName.replace(/"/g, '""');
            const safeWebsite = website.replace(/"/g, '""');
            const safePhone = phone ? `'${phone.replace(/"/g, '""')}` : '';
            const cleanAddress = address.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, ' ').trim();
            const safeAddress = cleanAddress.replace(/"/g, '""').replace(/\n/g, ' ');
            const safeMapLink = currentUrl.replace(/"/g, '""');

            const csvRow = `"${safeName}","${safeWebsite}","${safePhone}","${safeAddress}","${safeMapLink}"\n`;
            fs.appendFileSync(outputFile, csvRow, 'utf-8');
            
            console.log(`      [+] Saved: ${companyName} | Phone: ${phone || 'N/A'}`);
          }

        } catch (clickErr) {
          continue;
        }
      }

      completedLinks.push(searchUrl);
      fs.writeFileSync(progressFile, JSON.stringify(completedLinks, null, 2), 'utf-8');
      console.log(`   ✔️ Marked as completed in progress tracker.`);

    } catch (err) {
      console.error(`   ❌ Error: ${err.message}`);
    }
  }

  if (fs.existsSync(progressFile)) {
    fs.unlinkSync(progressFile);
  }

  await browser.close();
  console.log(`\n🎉 Process Finished! Output saved strictly filtered in '${outputFile}'.`);
}

runUltimateScraper();
