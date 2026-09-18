const cheerio = require('cheerio');
const { fetchHtml, cleanText, sleep, extractArticleBody } = require('./utils');
const { canonicalizeUrl, dedupeParagraphs, isRelevantCandidate, isWithinRecentDays } = require('./quality');

const YAHOO_NEWS_HOST = 'https://tw.news.yahoo.com';

function normalizeYahooUrl(url) {
  if (!url) return '';

  if (url.startsWith('/')) {
    return `${YAHOO_NEWS_HOST}${url}`;
  }

  if (!/^https?:\/\//.test(url)) {
    return '';
  }

  return url;
}

function isYahooArticleUrl(url) {
  if (!url) return false;
  if (!url.includes('tw.news.yahoo.com/')) return false;
  return /-\d+\.html(?:\?|$)/.test(url);
}

function toDateOnly(value) {
  if (!value) return '';

  const m = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    return `${m[1]}-${m[2]}-${m[3]}`;
  }

  return '';
}

async function scrapeYahoo(keyword, options = {}) {
  console.log(`[Yahoo] Scraping keyword: ${keyword}`);
  const encodedKeyword = encodeURIComponent(keyword);
  const searchUrl = `${YAHOO_NEWS_HOST}/search?p=${encodedKeyword}`;

  const articleMap = new Map();

  try {
    const html = await fetchHtml(searchUrl, true);
    const $ = cheerio.load(html);

    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const title = cleanText($(el).text());
      const absoluteUrl = normalizeYahooUrl(href);

      if (!isYahooArticleUrl(absoluteUrl)) return;
      if (!title || title.length < 8) return;

      const cleanUrl = canonicalizeUrl(absoluteUrl);

      if (!articleMap.has(cleanUrl) && isRelevantCandidate(title, keyword)) {
        articleMap.set(cleanUrl, {
          title,
          source: 'Yahoo新聞',
          url: cleanUrl,
          publish_date: ''
        });
      }
    });

    const allArticles = Array.from(articleMap.values());

    // Apply options: limit count and recentDays filter
    const max = options.maxArticles || 8;
    const recentDays = typeof options.recentDays === 'number' ? options.recentDays : 3;
    let filtered = allArticles.filter(a => {
      return isWithinRecentDays(a.publish_date, recentDays);
    });
    const articles = filtered.slice(0, max);
    console.log(`[Yahoo] Found ${articles.length} search results (after filtering)`);

    const concurrency = options.concurrency || 4;
    const { mapConcurrent } = require('./utils');
    await mapConcurrent(articles, concurrency, async (art, i) => {
      console.log(`[Yahoo] Fetching content for article ${i + 1}/${articles.length}: ${art.title}`);

      try {
        const artHtml = await fetchHtml(art.url, true);
        const $art = cheerio.load(artHtml);

        let publishDate =
          toDateOnly($art('meta[property="article:published_time"]').attr('content')) ||
          toDateOnly($art('time').first().attr('datetime')) ||
          toDateOnly($art('time').first().text()) ||
          art.publish_date || '';

        // As a fallback, try the shared extractor
        try {
          const { extractPublishDateFromHtml } = require('./utils');
          const found = await extractPublishDateFromHtml(artHtml, art.url);
          if (found) publishDate = publishDate || found;
        } catch (e) {
          // ignore
        }

        const publisherText =
          cleanText($art('meta[property="og:site_name"]').attr('content')) ||
          cleanText($art('[data-test-locator="stream-provider-name"]').first().text()) ||
          cleanText($art('.caas-attr-provider').first().text()) ||
          'Yahoo新聞';

        art.publish_date = publishDate;
        art.source = publisherText;
        art.content = extractArticleBody(artHtml, [
          '#caas-art-content p', 'div.caas-body > p', 'article p',
        ]);

        if (options.delayMs) await sleep(options.delayMs);
      } catch (err) {
        console.error(`[Yahoo] Failed to fetch article content from ${art.url}:`, err.message);
        art.content = '';
      }
    });

    return articles.filter((a) => a.content && isWithinRecentDays(a.publish_date, recentDays));
  } catch (err) {
    console.error('[Yahoo] Scrape failed:', err.message);
    throw err;
  }
}

module.exports = scrapeYahoo;
