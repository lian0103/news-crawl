const axios = require('axios');
const { isValidDateOnly } = require('./quality');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let puppeteer = null;
let browserPromise = null;

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
  let page = null;
  try {
    const p = await getPuppeteer();
    if (!browserPromise) {
      browserPromise = p.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
    let browser = await browserPromise;
    if (!browser.connected) {
      browserPromise = p.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      browser = await browserPromise;
    }
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 800 });
    
    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7'
    });

    // News pages commonly keep analytics connections open indefinitely.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const html = await page.content();
    return html;
  } catch (err) {
    console.error(`Puppeteer failed for ${url}:`, err.message);
    throw err;
  } finally {
    if (page) await page.close().catch(() => {});
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

function extractArticleBody(html, selectors = ['article p']) {
  if (!html) return '';
  const cheerio = require('cheerio');
  const { dedupeParagraphs } = require('./quality');
  const $ = cheerio.load(html);

  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).text());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const graph = node && Array.isArray(node['@graph']) ? node['@graph'] : [node];
        for (const item of graph) {
          const body = item && item.articleBody;
          if (typeof body === 'string' && body.trim().length >= 200) {
            return dedupeParagraphs(body).slice(0, 50000);
          }
        }
      }
    } catch (_) {
      // Fall through to publisher-specific selectors.
    }
  }

  for (const selector of selectors) {
    const paragraphs = [];
    $(selector).each((_, p) => {
      const text = cleanText($(p).text());
      if (text && !/^(廣告|贊助內容|延伸閱讀|更多新聞|相關新聞)$/.test(text)) {
        paragraphs.push(text);
      }
    });
    const body = dedupeParagraphs(paragraphs.join('\n'));
    if (body.length >= 200) return body.slice(0, 50000);
  }

  return '';
}

module.exports = {
  fetchHtml,
  sleep,
  cleanText,
  extractArticleBody,
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
// Date parsing utilities extracted from scripts/clean_publish_dates.js
function normalizeDateParts(y, m, d) {
  m = String(m).padStart(2, '0');
  d = String(d).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function validNormalizedDate(y, m, d) {
  const normalized = normalizeDateParts(y, m, d);
  return isValidDateOnly(normalized) ? normalized : null;
}

function tryParseDateString(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();

  // ISO datetime
  const iso = s.match(/(?:^|\D)(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
  if (iso) return validNormalizedDate(iso[1], iso[2], iso[3]);

  // YYYY/MM/DD or YYYY.MM.DD
  let m = s.match(/(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})/);
  if (m) return validNormalizedDate(m[1], m[2], m[3]);

  // Chinese format: YYYY年MM月DD日
  m = s.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return validNormalizedDate(m[1], m[2], m[3]);

  return null;
}

async function extractPublishDateFromHtml(html, url) {
  if (!html) return null;
  const cheerio = require('cheerio');
  const $ = cheerio.load(html);

  // Common meta tags
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[name="pubdate"]',
    'meta[name="publishdate"]',
    'meta[name="publish_date"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
    'meta[property="og:published_time"]',
    'meta[name="ptime"]'
  ];

  for (const sel of metaSelectors) {
    const m = $(sel).attr('content') || $(sel).attr('value');
    const d = tryParseDateString(m);
    if (d) return d;
  }

  // Structured data is generally more reliable than visible page chrome.
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(el).text());
      const nodes = Array.isArray(parsed) ? parsed : [parsed];
      for (const node of nodes) {
        const graph = node && Array.isArray(node['@graph']) ? node['@graph'] : [node];
        for (const item of graph) {
          const d = tryParseDateString(item && (item.datePublished || item.dateCreated));
          if (d) return d;
        }
      }
    } catch (_) {
      // Ignore malformed publisher JSON-LD and continue with other signals.
    }
  }

  // time tags with datetime
  const timeEl = $('time[datetime]').first();
  if (timeEl && timeEl.attr('datetime')) {
    const d = tryParseDateString(timeEl.attr('datetime'));
    if (d) return d;
  }

  // look for common date container classes
  const dateTexts = [];
  ['.time', '.date', '.publish-time', '.published', '.article-meta', '.meta'].forEach(cls => {
    $(cls).each((_, el) => dateTexts.push(cleanText($(el).text())));
  });

  // search within article header
  $('header, h1, h2').each((_, el) => {
    const t = cleanText($(el).text());
    if (t) dateTexts.push(t);
  });

  // fallback: search whole text for date patterns
  dateTexts.push(cleanText($('body').text()).slice(0, 2000));

  for (const txt of dateTexts) {
    const d = tryParseDateString(txt);
    if (d) return d;
  }

  // no date found
  return null;
}

// export helpers
module.exports = {
  fetchHtml,
  sleep,
  cleanText,
  extractArticleBody,
  mapConcurrent,
  extractPublishDateFromHtml,
  tryParseDateString
};
