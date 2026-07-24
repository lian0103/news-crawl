const scrapeUDN = require('./udn');
const scrapeLTN = require('./ltn');
const scrapeChinatimes = require('./chinatimes');
const scrapeYahoo = require('./yahoo');

/**
 * Scrape all three newspapers for a keyword.
 * @param {string} keyword 
 * @returns {Promise<Array>} List of merged articles
 */
async function scrapeAll(keyword) {
  console.log(`[Scraper Engine] Starting crawl for keyword: "${keyword}"`);
  
  const results = [];
  
  try {
    const udnArticles = await scrapeUDN(keyword);
    results.push(...udnArticles);
    console.log(`[Scraper Engine] UDN scraped: ${udnArticles.length} articles`);
  } catch (err) {
    console.error('[Scraper Engine] UDN scraping failed:', err.message);
  }

  try {
    const ltnArticles = await scrapeLTN(keyword);
    results.push(...ltnArticles);
    console.log(`[Scraper Engine] LTN scraped: ${ltnArticles.length} articles`);
  } catch (err) {
    console.error('[Scraper Engine] LTN scraping failed:', err.message);
  }

  try {
    const chinatimesArticles = await scrapeChinatimes(keyword);
    results.push(...chinatimesArticles);
    console.log(`[Scraper Engine] China Times scraped: ${chinatimesArticles.length} articles`);
  } catch (err) {
    console.error('[Scraper Engine] China Times scraping failed:', err.message);
  }

  try {
    const yahooArticles = await scrapeYahoo(keyword);
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
  scrapeChinatimes,
  scrapeYahoo
};
