#!/usr/bin/env node
const cheerio = require('cheerio');
const { dbOps, initDatabase } = require('../src/db');
const { fetchHtml, cleanText } = require('../src/scrapers/utils');

function normalizeDateParts(y, m, d) {
  m = String(m).padStart(2, '0');
  d = String(d).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function tryParseDateString(s) {
  if (!s || typeof s !== 'string') return null;
  s = s.trim();

  // ISO datetime
  const iso = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  // YYYY/MM/DD or YYYY.MM.DD
  let m = s.match(/(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})/);
  if (m) return normalizeDateParts(m[1], m[2], m[3]);

  // Chinese format: YYYY年MM月DD日
  m = s.match(/(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return normalizeDateParts(m[1], m[2], m[3]);

  // Short formats like 2023/7/5
  m = s.match(/(\d{4}).?(\d{1,2}).?(\d{1,2})/);
  if (m) return normalizeDateParts(m[1], m[2], m[3]);

  return null;
}

async function extractPublishDateFromHtml(html, url) {
  if (!html) return null;
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

function isSuspiciousPublishDate(article) {
  const pub = article.publish_date || '';
  const crawl = article.crawled_at ? article.crawled_at.substring(0, 10) : '';
  const today = new Date().toISOString().substring(0, 10);
  if (!pub) return true;
  if (pub === today) return true;
  if (crawl && pub === crawl) return true;
  return false;
}

async function main() {
  await initDatabase();
  const articles = await dbOps.getAllArticles();
  console.log(`Total articles in DB: ${articles.length}`);

  let processed = 0;
  let updated = 0;

  for (const art of articles) {
    if (!isSuspiciousPublishDate(art)) continue;
    processed++;
    console.log(`\n[${processed}] Checking id=${art.id} ${art.source} - ${art.url}`);
    try {
      const html = await fetchHtml(art.url);
      const found = await extractPublishDateFromHtml(html, art.url);
      if (found && found !== art.publish_date) {
        await dbOps.updatePublishDate(art.id, found);
        console.log(`  Updated publish_date: ${art.publish_date} -> ${found}`);
        updated++;
      } else if (found) {
        console.log(`  Found same publish_date (${found}), no update.`);
      } else {
        console.log('  No publish date found on page.');
      }
      // be gentle
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error('  Failed to fetch/parse:', err && err.message ? err.message : err);
    }
  }

  console.log(`\nDone. Processed: ${processed}, Updated: ${updated}`);
  process.exit(0);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err && err.message ? err.message : err);
    process.exit(1);
  });
}
