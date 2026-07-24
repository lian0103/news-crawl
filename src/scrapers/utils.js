const axios = require('axios');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let puppeteer = null;

async function getPuppeteer() {
  if (!puppeteer) {
    try {
      const puppeteerModule = await import('puppeteer');
      puppeteer = puppeteerModule.default || puppeteerModule;
    } catch (err) {
      console.error('Failed to import puppeteer:', err.message);
      throw err;
    }
  }
  return puppeteer;
}

/**
 * Fetch HTML content from a URL using Axios or Puppeteer.
 * @param {string} url 
 * @param {boolean} forcePuppeteer 
 * @returns {Promise<string>} HTML content
 */
async function fetchHtml(url, forcePuppeteer = false) {
  // If we want to bypass 403 (like China Times), or force Puppeteer
  if (forcePuppeteer || url.includes('chinatimes.com')) {
    return fetchHtmlWithPuppeteer(url);
  }

  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 15000 // 15 seconds timeout
    });
    return response.data;
  } catch (err) {
    console.warn(`Axios failed for ${url} (${err.message}). Falling back to Puppeteer...`);
    return fetchHtmlWithPuppeteer(url);
  }
}

async function fetchHtmlWithPuppeteer(url) {
  let browser = null;
  try {
    const p = await getPuppeteer();
    browser = await p.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    const html = await page.content();
    return html;
  } catch (err) {
    console.error(`Puppeteer failed for ${url}:`, err.message);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/\s+/g, ' ')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

module.exports = {
  fetchHtml,
  sleep,
  cleanText
};

// Concurrency helper: run iterator over items with a fixed number of concurrent workers
async function mapConcurrent(items, limit, iterator) {
  if (!Array.isArray(items) || items.length === 0) return;
  const workerCount = Math.max(1, Math.min(limit || 4, items.length));
  let idx = 0;
  const workers = new Array(workerCount).fill(null).map(async () => {
    while (true) {
      const current = idx++;
      if (current >= items.length) return;
      try {
        await iterator(items[current], current);
      } catch (err) {
        // swallow individual errors to allow other workers to continue
        console.error('[mapConcurrent] iterator error:', err && err.message ? err.message : err);
      }
    }
  });
  await Promise.all(workers);
}

// expose helper
module.exports.mapConcurrent = mapConcurrent;
