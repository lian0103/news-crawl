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
  
  try {
    const udnArticles = await scrapeUDN(keyword, options);
    results.push(...udnArticles);
    console.log(`[Scraper Engine] UDN scraped: ${udnArticles.length} articles`);
  } catch (err) {
    console.error('[Scraper Engine] UDN scraping failed:', err.message);
  }

  try {
    const ltnArticles = await scrapeLTN(keyword, options);
    results.push(...ltnArticles);
    console.log(`[Scraper Engine] LTN scraped: ${ltnArticles.length} articles`);
  } catch (err) {
    console.error('[Scraper Engine] LTN scraping failed:', err.message);
  }

  try {
    const searchArticles = await scrapeSearchEngine(keyword, options);
    results.push(...searchArticles);
    console.log(`[Scraper Engine] Search engine scraped: ${searchArticles.length} articles`);
  } catch (err) {
    console.error('[Scraper Engine] Search engine scraping failed:', err.message);
  }

  try {
    const yahooArticles = await scrapeYahoo(keyword, options);
    results.push(...yahooArticles);
    console.log(`[Scraper Engine] Yahoo scraped: ${yahooArticles.length} articles`);
  } catch (err) {
    console.error('[Scraper Engine] Yahoo scraping failed:', err.message);
  }

  console.log(`[Scraper Engine] Crawl complete. Total articles fetched: ${results.length}`);
  return results;
}

module.exports = {
  scrapeAll,
  scrapeUDN,
  scrapeLTN,
  scrapeSearchEngine,
  scrapeYahoo
};
