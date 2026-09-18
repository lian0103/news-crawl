const cheerio = require('cheerio');
const axios = require('axios');
const { fetchHtml, cleanText, sleep, extractPublishDateFromHtml, extractArticleBody } = require('./utils');
const { canonicalizeUrl, dedupeParagraphs, isRelevantCandidate, isWithinRecentDays } = require('./quality');

/**
 * Scrape articles from UDN search results.
 * @param {string} keyword 
 * @returns {Promise<Array>} List of articles
 */
async function scrapeUDN(keyword, options = {}) {
  console.log(`[UDN] Scraping keyword: ${keyword}`);
  const encodedKeyword = encodeURIComponent(keyword);
  // We can fetch page 1
  const searchUrl = `https://udn.com/api/more?page=1&id=search:${encodedKeyword}&channelId=2&type=searchword`;
  
  const articles = [];
  let filtered = [];
  try {
    const res = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!res.data || !res.data.lists) {
      console.warn('[UDN] No lists found in search API response');
      return [];
    }

    const lists = res.data.lists;
    console.log(`[UDN] Found ${lists.length} search results`);

    for (const item of lists) {
      const title = cleanText(item.title);
      const url = item.titleLink;

      // Extract date: item.time.date format is YYYY-MM-DD HH:mm
      let publishDate = '';
      if (item.time && item.time.date) {
        publishDate = item.time.date.split(' ')[0]; // gets YYYY-MM-DD
      } else {
        publishDate = '';
      }

      if (!url || !title) continue;

      // Clean the URL (remove query params)
      const cleanUrl = canonicalizeUrl(url);

      articles.push({
        title,
        source: '聯合報',
        url: cleanUrl,
        publish_date: publishDate
      });
    }

    // Apply options: limit count and recentDays filter
    const max = options.maxArticles || 8;
    const recentDays = typeof options.recentDays === 'number' ? options.recentDays : 3;
    filtered = articles.filter(a => {
      return isRelevantCandidate(a.title, keyword) && isWithinRecentDays(a.publish_date, recentDays);
    });
    filtered = filtered.slice(0, max);

    // Now, fetch content for each article concurrently with a small worker pool
    const concurrency = options.concurrency || 4;
    const { mapConcurrent } = require('./utils');
    await mapConcurrent(filtered, concurrency, async (art, i) => {
      console.log(`[UDN] Fetching content for article ${i + 1}/${filtered.length}: ${art.title}`);
      try {
        const html = await fetchHtml(art.url);
        const $ = cheerio.load(html);

        art.content = extractArticleBody(html, [
          'section.article-content__editor p', '.article-content__editor p',
          '#article_body p', '.story p', 'article p',
        ]);
        try {
          const found = await extractPublishDateFromHtml(html, art.url);
          if (found) art.publish_date = found;
        } catch (e) {
          // ignore
        }
        if (options.delayMs) await sleep(options.delayMs);
      } catch (err) {
        console.error(`[UDN] Failed to fetch article content from ${art.url}:`, err.message);
        art.content = '';
      }
    });

  } catch (err) {
    console.error('[UDN] Scrape failed:', err.message);
    throw err;
  }

  return (filtered || []).filter(a => a.content && isWithinRecentDays(a.publish_date, options.recentDays ?? 3));
}

module.exports = scrapeUDN;
