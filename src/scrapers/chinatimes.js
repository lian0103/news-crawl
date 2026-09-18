const cheerio = require('cheerio');
const { fetchHtml, cleanText, sleep, extractPublishDateFromHtml } = require('./utils');

/**
 * Scrape articles from China Times search results.
 * @param {string} keyword 
 * @returns {Promise<Array>} List of articles
 */
async function scrapeChinatimes(keyword, options = {}) {
  console.log(`[China Times] Scraping keyword: ${keyword}`);
  const encodedKeyword = encodeURIComponent(keyword);
  // Using chdtv format for traditional news layout
  const searchUrl = `https://www.chinatimes.com/search/${encodedKeyword}?chdtv`;
  
  const articles = [];
  let filtered = [];
  try {
    // This will trigger Puppeteer automatically because of 'chinatimes.com' domain
    const html = await fetchHtml(searchUrl);
    const $ = cheerio.load(html);

    console.log('[China Times] Parsing search page...');
    
    // In Chinatimes search layout, news items are in `.search-result-list li` or `.row` items with `h3.title`
    // Let's inspect elements with `h3.title a`
    $('h3.title a').each((_, el) => {
      const href = $(el).attr('href');
      const title = cleanText($(el).text());
      
      // Filter out non-article URLs
      if (href && (/\/\d{10,14}-\d+/.test(href) || href.includes('realtimenews') && /\d+/.test(href))) {
        // Skip short navigation titles
        if (title.length < 5) return;

        // Try to find the time text
        const parentCol = $(el).closest('.col');
        let timeText = parentCol.find('.time, .date, span, time').first().text().trim();
        
        let publishDate = '';
        const match = timeText.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
        if (match) {
          publishDate = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
        } else {
          publishDate = '';
        }

        const absoluteUrl = href.startsWith('/') ? `https://www.chinatimes.com${href}` : href;
        const cleanUrl = absoluteUrl.split('?')[0];

        articles.push({
          title,
          source: '中國時報',
          url: cleanUrl,
          publish_date: publishDate
        });
      }
    });

    console.log(`[China Times] Found ${articles.length} search results`);

    // Apply options: limit count and recentDays filter
    const max = options.maxArticles || 8;
    const recentDays = typeof options.recentDays === 'number' ? options.recentDays : 3;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - recentDays);

    filtered = articles.filter(a => {
      if (!a.publish_date) return true;
      const pd = new Date(a.publish_date);
      return pd >= cutoff;
    });
    filtered = filtered.slice(0, max);

    // Fetch content for each article concurrently
    const concurrency = options.concurrency || 4;
    const { mapConcurrent } = require('./utils');
    await mapConcurrent(filtered, concurrency, async (art, i) => {
      console.log(`[China Times] Fetching content for article ${i + 1}/${filtered.length}: ${art.title}`);
      try {
        const artHtml = await fetchHtml(art.url);
        const $art = cheerio.load(artHtml);
        
        let contentText = '';
        $art('.article-body p, article .article-body p, .article-content p').each((_, p) => {
          const text = $art(p).text().trim();
          if (text) {
            contentText += text + '\n';
          }
        });

        art.content = contentText.trim();
        // Try to extract publish date from the article page if not present or suspicious
        try {
          const found = await extractPublishDateFromHtml(artHtml, art.url);
          if (found) art.publish_date = found;
        } catch (e) {
          // ignore extraction errors
        }
        if (options.delayMs) await sleep(options.delayMs);
      } catch (err) {
        console.error(`[China Times] Failed to fetch article content from ${art.url}:`, err.message);
        art.content = '';
      }
    });

  } catch (err) {
    console.error('[China Times] Scrape failed:', err.message);
    throw err;
  }

  return (filtered || []).filter(a => a.content);
}

module.exports = scrapeChinatimes;
