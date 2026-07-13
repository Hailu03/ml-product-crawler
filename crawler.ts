import * as fs from 'fs';
import { sleep } from 'bun';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

const DEFAULT_MAX_PAGES = 300;
const DEFAULT_SLEEP_TIME = 30000;// 2 * 60 * 1000;

interface CrawlConfig {
  outputDir: string;
  startUrls: string[];
  dataUrls?: string[]; // URL to fetch data from, if different from apiUrl
  blacklistUrls?: string[]; // URLs to ignore
  modalCloseButtonSelector?: string; // Selector for a modal close button, if needed
  nextButtonSelector: string;
  maxPages?: number;
  sleepTime?: number; // number of milliseconds to wait after clicking the next button
  openRandomLink?: boolean; // whether to open a random link from the current page
}

const siteConfigs: Record<string, CrawlConfig> = {
  'danmurphys.com.au': {
      outputDir: 'danmurphys.com.au',
      startUrls: [
          'https://www.danmurphys.com.au/red-wine/all',
          'https://www.danmurphys.com.au/white-wine/all',
          'https://www.danmurphys.com.au/champagne-sparkling/all',
          'https://www.danmurphys.com.au/fortified-wine/all',
          'https://www.danmurphys.com.au/spirits/all',
          'https://www.danmurphys.com.au/beer/all',
          'https://www.danmurphys.com.au/list/zero-alcohol-drinks?i_cid=dskmob:8938:mg-zero-browse-all'
      ],
      dataUrls: [
        '^https://api\.danmurphys\.com\.au/apis/ui/Browse$',
        '^https://api\.danmurphys\.com\.au/apis/ui/ProductGroup/Products/'
      ],
      nextButtonSelector: '.infinite-loader__load-more-button',
      maxPages: 200,
  },
  'liquorland.com.au': {
      outputDir: 'liquorland.com.au',
      startUrls: [
          'https://www.liquorland.com.au/offers',
          'https://www.liquorland.com.au/red-wine',
          'https://www.liquorland.com.au/white-wine',          
          'https://www.liquorland.com.au/beer',
          'https://www.liquorland.com.au/sparkling',
          'https://www.liquorland.com.au/spirits',
          'https://www.liquorland.com.au/rose',
      ],
      dataUrls: ['^https://www\.liquorland\.com\.au/api/partset/', '^https://www\.liquorland\.com\.au/api/products/'],
      modalCloseButtonSelector: 'button.ModalOverlay-CloseButton',
      nextButtonSelector: 'a.btnNext',
      maxPages: 200,
  },
  'bws.com.au': {
      outputDir: 'bws.com.au',
      startUrls: [
          'https://bws.com.au/wine/red-wine',
          'https://bws.com.au/wine/white-wine',
          'https://bws.com.au/wine/champagne-sparkling',
          'https://bws.com.au/wine/fortified-wine',
          'https://bws.com.au/wine/cask-wine',
          'https://bws.com.au/wine/organic-wine',
          'https://bws.com.au/wine/vegan-wine',

          'https://bws.com.au/beer/craft-beer',
          'https://bws.com.au/beer/imported-beer',
          'https://bws.com.au/beer/australian-beer',
          'https://bws.com.au/beer/premium-beer',
          'https://bws.com.au/beer/full-strength-beer',
          'https://bws.com.au/beer/mid-strength-beer',
          'https://bws.com.au/beer/light-beer',
          'https://bws.com.au/beer/low-carb-beer',
          'https://bws.com.au/beer/non-alcoholic-beer',
          'https://bws.com.au/beer/ginger-beer',
          'https://bws.com.au/beer/cider',

          'https://bws.com.au/spirits/whisky',
          'https://bws.com.au/spirits/bourbon',
          'https://bws.com.au/spirits/gin',
          'https://bws.com.au/spirits/premixed-drinks'
      ],
      dataUrls: ['apis/ui/Browse'],
      modalCloseButtonSelector: 'button.do-later-btn',
      blacklistUrls: [
          'apis/ui/Browse/v2/SponsoredAds',
      ],
      nextButtonSelector: 'a.btn-secondary, a.btn--full-width, button.action-btn',
      maxPages: 200,
  },
  'firstchoice.com.au': {
    outputDir: 'firstchoice.com.au',
    startUrls: [
      'https://www.firstchoiceliquor.com.au/offers',
      'https://www.firstchoiceliquor.com.au/red-wine',
      'https://www.firstchoiceliquor.com.au/white-wine',
      'https://www.firstchoiceliquor.com.au/spirits',
      'https://www.firstchoiceliquor.com.au/beer',
      'https://www.firstchoiceliquor.com.au/sparkling',
      'https://www.firstchoiceliquor.com.au/rose',
    ],
    dataUrls: ['^https://www\.firstchoiceliquor\.com\.au/api/products/'],
    modalCloseButtonSelector: 'button.ModalOverlay-CloseButton',
    nextButtonSelector: 'a.btnNext.brand-icon.brand-icon-chevron-right.link.internal-link',
    maxPages: 200,
  }
}

// Launch the browser and open a new blank page
const browser = await puppeteer.use(StealthPlugin()).launch({ 
    headless: true, 
    args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', 
        '--start-maximized'
    ] 
});

async function openPage(url: string) {
  const page = await browser.newPage();
  await page.goto(url);
  // close after randomly waiting between 5 to 10 seconds
  const waitTime = Math.floor(Math.random() * 5000) + 5000
  setTimeout(() => {
    // Close the page after 5 seconds
    page.close();
  }, waitTime);
}

async function crawlSite(config: CrawlConfig) {
  const date = `${new Date().toISOString().split('T')[0]}`;
  const outputDir = `data/${date}/${config.outputDir}`;
  fs.mkdirSync(outputDir, { recursive: true });

  const page = (await browser.pages())[0];
  await page.setRequestInterception(true);

  // Listen for Request events
  page.on("request", (request) => {
    // Allow the request to be sent
    request.continue();
  });

  let counter = 0;
  let category = '';
  const blacklistUrlRegExes = (config.blacklistUrls || []).map(url => new RegExp(url));
  const dataUrlRegExes = (config.dataUrls || []).map(url => new RegExp(url));
  page.on('response', async response => {
    try {
      const request = response.request();
      if (request.resourceType() === 'xhr') {
        const responseUrl = request.url();
        if (blacklistUrlRegExes.some(regex => regex.test(responseUrl))) {
          console.log('Ignoring blacklisted URL:', responseUrl);
          return;
        }
        if (dataUrlRegExes.some(regex => regex.test(responseUrl))) {
          const responseText = await response.text();
          const fileNumber = `${counter++}`.padStart(4, '0');
          const outputFilePath = `${outputDir}${category}/response_${fileNumber}.json`;
          fs.writeFileSync(outputFilePath, responseText);
          console.log(`Saved data from ${responseUrl} to ${outputFilePath}`);
        }
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });

  const maxPages = config.maxPages || DEFAULT_MAX_PAGES;
  for (const startUrl of config.startUrls) {
    const url = new URL(startUrl);
    url.origin
    url.protocol
    category = url.pathname;
    counter = 0;
    fs.mkdirSync(outputDir + '/' + category, { recursive: true });
    console.log(`Crawling ${startUrl} with max pages: ${maxPages}`);
    // Navigate the page to a URL
    try {
      await page.goto(startUrl);
    } catch (error) {
      fs.appendFileSync(`${outputDir}/errors.text`, startUrl + '\n');
    }

    if (config.modalCloseButtonSelector) {
      // Close any modal that might be open.
      try {
        console.log(`Closing modal if exists using selector: ${config.modalCloseButtonSelector}`);
        const modalCloseButton = page.locator(config.modalCloseButtonSelector);
        await modalCloseButton.click();
      } catch (error) {
        // console.error('Error closing modal:', error);
      }
    }

    let pageCount = 0;

    while (pageCount++ < maxPages - 1) {
      try {
        const sleepTime = Math.round((config.sleepTime || DEFAULT_SLEEP_TIME) * (0.7 + 0.3 * Math.random()));
        console.log(`Waiting for ${sleepTime}ms...`);
        await sleep(sleepTime);

        // 1. Tìm nút Next và đưa nó vào GIỮA màn hình (block: 'center')
        const nextButtonFound = await page.evaluate((selector) => {
          const btn = document.querySelector(selector) as HTMLElement;
          if (btn) {
            btn.scrollIntoView({ block: 'center', behavior: 'smooth' });
            return true;
          }
          return false;
        }, config.nextButtonSelector);

        if (!nextButtonFound) {
          console.log("Hết trang hoặc không tìm thấy nút Next.");
          break;
        }

        await sleep(1500); // Chờ 1.5s để trang ổn định sau khi cuộn

        // 2. Ép click bằng JavaScript (Xuyên thấu mọi vật cản)
        await page.evaluate((selector) => {
          const btn = document.querySelector(selector) as HTMLElement;
          btn?.click();
        }, config.nextButtonSelector);

        console.log(`Đã ép click chuyển trang thành công!`);

      } catch (error) {
        console.error('Lỗi khi chuyển trang:', error);
        break;
      }
    }
  }

  await page.close();
}

if (process.argv.length >= 2) {
  const site = process.argv[2];
  console.log(`Start crawling site: ${site}`);
  const config = siteConfigs[site];
  await crawlSite(config);
  console.log(`Finished crawling site: ${site}`);
} else {
  for (const site in siteConfigs) {
    const config = siteConfigs[site];
    console.log(`Start crawling site: ${site}`);
    await crawlSite(config);
    console.log(`Finished crawling site: ${site}`);
  }
}

await browser.close();
