const cheerio = require('cheerio');
const { fetchHtml, cleanText, sleep, extractPublishDateFromHtml, extractArticleBody } = require('./utils');
const { canonicalizeUrl, dedupeParagraphs, isRelevantCandidate, isWithinRecentDays } = require('./quality');

/**
 * Scrape articles from LTN search results.
 * @param {string} keyword 
 * @returns {Promise<Array>} List of articles
 */
async function scrapeLTN(keyword, options = {}) {
  console.log(`[LTN] Scraping keyword: ${keyword}`);
  const encodedKeyword = encodeURIComponent(keyword);
  const searchUrl = `https://search.ltn.com.tw/list?keyword=${encodedKeyword}`;
  
  const articles = [];
  let filtered = [];
  try {
    const html = await fetchHtml(searchUrl);
    const $ = cheerio.load(html);

    $('div.cont').each((_, el) => {
      const aTit = $(el).find('a.tit');
      const title = cleanText(aTit.attr('title') || aTit.text());
      const url = aTit.attr('href');
      
      const timeText = $(el).find('span.time').text().trim();
      // Format 2026/03/10 to 2026-03-10
      let publishDate = '';
      const match = timeText.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
      if (match) {
        publishDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
      } else {
        publishDate = '';
      }

      if (url && title) {
        const cleanUrl = canonicalizeUrl(url);
        articles.push({
          title,
          source: '自由時報',
          url: cleanUrl,
          publish_date: publishDate
        });
      }
    });

    console.log(`[LTN] Found ${articles.length} search results`);

    // Apply options: limit count and recentDays filter
    const max = options.maxArticles || 8;
    const recentDays = typeof options.recentDays === 'number' ? options.recentDays : 3;
    filtered = articles.filter(a => {
      return isRelevantCandidate(a.title, keyword) && isWithinRecentDays(a.publish_date, recentDays);
    });
    filtered = filtered.slice(0, max);

    // Fetch content for each article using concurrency
    const concurrency = options.concurrency || 4;
    const { mapConcurrent } = require('./utils');
    await mapConcurrent(filtered, concurrency, async (art, i) => {
      console.log(`[LTN] Fetching content for article ${i + 1}/${filtered.length}: ${art.title}`);
      try {
        const artHtml = await fetchHtml(art.url);
        const $art = cheerio.load(artHtml);
        
        art.content = extractArticleBody(artHtml, [
          'div.text p', '.articlebody p', '.whitecon.articlebody p', 'article p',
        ]);
        try {
          const found = await extractPublishDateFromHtml(artHtml, art.url);
          if (found) art.publish_date = found;
        } catch (e) {
          // ignore
        }
        if (options.delayMs) await sleep(options.delayMs);
      } catch (err) {
        console.error(`[LTN] Failed to fetch article content from ${art.url}:`, err.message);
        art.content = '';
      }
    });

  } catch (err) {
    console.error('[LTN] Scrape failed:', err.message);
    throw err;
  }

  return (filtered || []).filter(a => a.content && isWithinRecentDays(a.publish_date, options.recentDays ?? 3));
}

module.exports = scrapeLTN;
