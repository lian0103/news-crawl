const cheerio = require('cheerio');
const { fetchHtml, cleanText, sleep } = require('./utils');

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
        publishDate = new Date().toISOString().substring(0, 10);
      }

      if (url && title) {
        const cleanUrl = url.split('?')[0];
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
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - recentDays);

    let filtered = articles.filter(a => {
      if (!a.publish_date) return true;
      const pd = new Date(a.publish_date);
      return pd >= cutoff;
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
        
        let contentText = '';
        $art('div.text p, .articlebody p, .text p').each((_, p) => {
          // Avoid text that is inside sub-elements or scripts/advertisements if any
          const text = $art(p).text().trim();
          if (text && !$art(p).hasClass('appE112') && !$art(p).find('script').length) {
            contentText += text + '\n';
          }
        });

        art.content = contentText.trim();
        if (options.delayMs) await sleep(options.delayMs);
      } catch (err) {
        console.error(`[LTN] Failed to fetch article content from ${art.url}:`, err.message);
        art.content = '';
      }
    });

  } catch (err) {
    console.error('[LTN] Scrape failed:', err.message);
  }

  return (filtered || []).filter(a => a.content);
}

module.exports = scrapeLTN;
