const scrapeUDN = require('./udn');
const scrapeLTN = require('./ltn');
// China Times removed; use search engine scraper instead
const scrapeSearchEngine = require('./searchengine');
const scrapeYahoo = require('./yahoo');

/**
 * Scrape all three newspapers for a keyword.
 * @param {string} keyword 
 * @returns {Promise<Array>} List of merged articles
 */
async function scrapeAll(keyword, options = {}) {
  console.log(`[Scraper Engine] Starting crawl for keyword: "${keyword}"`);
  options = Object.assign({ maxArticles: 8, recentDays: 3, delayMs: 500 }, options);
  const results = [];
  const sourceStats = [];
  
  try {
    const udnArticles = await scrapeUDN(keyword, options);
    results.push(...udnArticles);
    sourceStats.push({ source: 'udn', status: 'success', count: udnArticles.length });
    console.log(`[Scraper Engine] UDN scraped: ${udnArticles.length} articles`);
  } catch (err) {
    sourceStats.push({ source: 'udn', status: 'failed', count: 0, error: err.message });
    console.error('[Scraper Engine] UDN scraping failed:', err.message);
  }

  try {
    const ltnArticles = await scrapeLTN(keyword, options);
    results.push(...ltnArticles);
    sourceStats.push({ source: 'ltn', status: 'success', count: ltnArticles.length });
    console.log(`[Scraper Engine] LTN scraped: ${ltnArticles.length} articles`);
  } catch (err) {
    sourceStats.push({ source: 'ltn', status: 'failed', count: 0, error: err.message });
    console.error('[Scraper Engine] LTN scraping failed:', err.message);
  }

  try {
    const searchArticles = await scrapeSearchEngine(keyword, options);
    results.push(...searchArticles);
    sourceStats.push({ source: 'bing', status: 'success', count: searchArticles.length });
    console.log(`[Scraper Engine] Search engine scraped: ${searchArticles.length} articles`);
  } catch (err) {
    sourceStats.push({ source: 'bing', status: 'failed', count: 0, error: err.message });
    console.error('[Scraper Engine] Search engine scraping failed:', err.message);
  }

  try {
    const yahooArticles = await scrapeYahoo(keyword, options);
    results.push(...yahooArticles);
    sourceStats.push({ source: 'yahoo', status: 'success', count: yahooArticles.length });
    console.log(`[Scraper Engine] Yahoo scraped: ${yahooArticles.length} articles`);
  } catch (err) {
    sourceStats.push({ source: 'yahoo', status: 'failed', count: 0, error: err.message });
    console.error('[Scraper Engine] Yahoo scraping failed:', err.message);
  }

  console.log(`[Scraper Engine] Crawl complete. Total articles fetched: ${results.length}`);
  Object.defineProperty(results, 'sourceStats', { value: sourceStats, enumerable: false });
  return results;
}

module.exports = {
  scrapeAll,
  scrapeUDN,
  scrapeLTN,
  scrapeSearchEngine,
  scrapeYahoo
};
