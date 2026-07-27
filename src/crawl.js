require('dotenv').config();
const { initDatabase, dbOps } = require('./db');
const { scrapeAll } = require('./scrapers');
const { summarizeArticle, generateDailySummary } = require('./ai');

/**
 * Main crawler execution function.
 * @param {string} keyword Defaults to '新北市選舉'
 * @returns {Promise<Object>} Summary statistics of the run
 */
async function runCrawler(keywordsInput) {
  let keywords = [
    '新北市長',
    '新北市議員',
    '台灣民眾黨',
    '李四川',
    '蘇巧慧',
    '吳亞倫',
  ];
  if (Array.isArray(keywordsInput)) {
    keywords = keywordsInput;
  } else if (typeof keywordsInput === 'string' && keywordsInput.trim() !== '') {
    keywords = [keywordsInput];
  }

  console.log(`[Crawler Run] Starting crawler run at ${new Date().toISOString()} with keywords: ${keywords.join(', ')}`);
  // default scraping options to control volume and recency
  const scrapeOptions = {
    maxArticles: process.env.SCRAPE_MAX_ARTICLES ? parseInt(process.env.SCRAPE_MAX_ARTICLES) : 8,
    recentDays: process.env.SCRAPE_RECENT_DAYS ? parseInt(process.env.SCRAPE_RECENT_DAYS) : 3,
    delayMs: process.env.SCRAPE_DELAY_MS ? parseInt(process.env.SCRAPE_DELAY_MS) : 500,
    concurrency: process.env.SCRAPE_CONCURRENCY ? parseInt(process.env.SCRAPE_CONCURRENCY) : 4
  };
  
  try {
    // 1. Initialize database
    await initDatabase();
    
    // 2. Fetch search results for all keywords and deduplicate by URL
    let rawArticlesMap = new Map();
    for (const kw of keywords) {
      console.log(`[Crawler Run] Scraping for keyword: "${kw}"`);
      try {
        const results = await scrapeAll(kw, scrapeOptions);
        console.log(`[Crawler Run] Keyword "${kw}" returned ${results.length} articles`);
        for (const art of results) {
          rawArticlesMap.set(art.url, art);
        }
      } catch (err) {
        console.error(`[Crawler Run] Scraping failed for keyword "${kw}":`, err.message);
      }
    }
    
    const rawArticles = Array.from(rawArticlesMap.values());
    console.log(`[Crawler Run] Total unique scraped articles from all keywords: ${rawArticles.length}`);

    let newCount = 0;
    let skippedCount = 0;
    let savedArticlesForToday = [];

    // Today's date in YYYY-MM-DD format
    const todayDate = new Date().toISOString().substring(0, 10);

    // 3. Process each article
    for (let i = 0; i < rawArticles.length; i++) {
      const art = rawArticles[i];
      console.log(`[Crawler Run] Processing ${i + 1}/${rawArticles.length}: ${art.title}`);

      // Check if article is already in DB
      const existing = await dbOps.getArticleByUrl(art.url);
      
      if (existing && existing.summary && existing.sentiment) {
        console.log(`[Crawler Run] Article already exists with summary. Skipping AI analysis.`);
        skippedCount++;
        
        // If it's published today, keep it in the list for the daily summary
        if (art.publish_date === todayDate) {
          savedArticlesForToday.push(existing);
        }
        continue;
      }

      // If it's a new article (or lacks AI summary), we analyze it
      console.log(`[Crawler Run] Analyzing article: "${art.title}"`);
      
      // Perform AI summarization & sentiment analysis
      const aiResult = await summarizeArticle(art.title, art.content);
      
      const articleToSave = {
        ...art,
        summary: aiResult.summary,
        sentiment: aiResult.sentiment,
        keywords: aiResult.keywords
      };

      await dbOps.saveArticle(articleToSave);
      newCount++;

      if (art.publish_date === todayDate) {
        savedArticlesForToday.push(articleToSave);
      }
    }

    console.log(`[Crawler Run] Processing completed. New analyzed: ${newCount}, Skipped: ${skippedCount}`);

    // 4. Generate daily summary report for today
    // Get all articles published today from database to ensure completeness
    const todayArticles = await dbOps.getArticlesByDate(todayDate);
    console.log(`[Crawler Run] Total articles for today (${todayDate}): ${todayArticles.length}`);

    if (todayArticles.length > 0) {
      console.log('[Crawler Run] Generating daily summary report...');
      const dailySummaryText = await generateDailySummary(todayDate, todayArticles);

      // Compute sentiment distribution
      const sentimentDist = todayArticles.reduce((acc, curr) => {
        const s = curr.sentiment || 'Neutral';
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, { Positive: 0, Neutral: 0, Negative: 0 });

      // Save daily summary
      await dbOps.saveDailySummary(todayDate, dailySummaryText, todayArticles.length, sentimentDist);
      console.log(`[Crawler Run] Daily summary report for ${todayDate} saved successfully.`);
    } else {
      console.log('[Crawler Run] No articles found for today. Skipping daily summary report generation.');
    }

    return {
      success: true,
      newCount,
      skippedCount,
      todayArticlesCount: todayArticles.length
    };

  } catch (err) {
    console.error('[Crawler Run] Critical error during execution:', err);
    return {
      success: false,
      error: err.message
    };
  }
}

// Allow script to be run directly from CLI
if (require.main === module) {
  runCrawler()
    .then((stats) => {
      console.log('[Crawler Run] Success! Run Stats:', stats);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Crawler Run] Failed:', err);
      process.exit(1);
    });
}

module.exports = runCrawler;
