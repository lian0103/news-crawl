const cheerio = require('cheerio');
const { fetchHtml, cleanText, sleep } = require('./utils');

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

      const cleanUrl = absoluteUrl.split('?')[0];

      if (!articleMap.has(cleanUrl)) {
        articleMap.set(cleanUrl, {
          title,
          source: 'Yahoo新聞',
          url: cleanUrl,
          publish_date: new Date().toISOString().substring(0, 10)
        });
      }
    });

    const allArticles = Array.from(articleMap.values());

    // Apply options: limit count and recentDays filter
    const max = options.maxArticles || 8;
    const recentDays = typeof options.recentDays === 'number' ? options.recentDays : 3;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - recentDays);

    let filtered = allArticles.filter(a => {
      if (!a.publish_date) return true;
      const pd = new Date(a.publish_date);
      return pd >= cutoff;
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

        const publishDate =
          toDateOnly($art('meta[property="article:published_time"]').attr('content')) ||
          toDateOnly($art('time').first().attr('datetime')) ||
          toDateOnly($art('time').first().text()) ||
          art.publish_date;

        const publisherText =
          cleanText($art('meta[property="og:site_name"]').attr('content')) ||
          cleanText($art('[data-test-locator="stream-provider-name"]').first().text()) ||
          cleanText($art('.caas-attr-provider').first().text()) ||
          'Yahoo新聞';

        let contentText = '';
        $art('div.caas-body p, #caas-art-content p, article p, .article-body p, main p').each((_, p) => {
          const text = cleanText($art(p).text());
          if (text && !/廣告|Sponsored|立即下載|延伸閱讀/.test(text)) {
            contentText += `${text}\n`;
          }
        });

        art.publish_date = publishDate;
        art.source = publisherText;
        art.content = contentText.trim();

        if (options.delayMs) await sleep(options.delayMs);
      } catch (err) {
        console.error(`[Yahoo] Failed to fetch article content from ${art.url}:`, err.message);
        art.content = '';
      }
    });

    return articles.filter((a) => a.content);
  } catch (err) {
    console.error('[Yahoo] Scrape failed:', err.message);
    return [];
  }
}

module.exports = scrapeYahoo;