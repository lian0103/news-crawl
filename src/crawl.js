require('dotenv').config();
const { initDatabase, dbOps } = require('./db');
const { scrapeAll } = require('./scrapers');
const { summarizeArticle, generateDailySummary } = require('./ai');
const { mapConcurrent } = require('./scrapers/utils');
const { canonicalizeUrl, normalizeSource, scoreRelevance, storyKey, taipeiDateString } = require('./scrapers/quality');

const DEFAULT_QUERIES = [
  '新北市長', '新北選舉', '新北市議員 選舉',
  '李四川 新北', '蘇巧慧 新北', '吳亞倫 新北',
];
let crawlInProgress = false;

/**
 * Main crawler execution function.
 * @param {string} keyword Defaults to '新北市選舉'
 * @returns {Promise<Object>} Summary statistics of the run
 */
async function runCrawler(keywordsInput, runOptions = {}) {
  if (crawlInProgress) {
    return { success: false, busy: true, error: 'A crawler run is already in progress' };
  }
  crawlInProgress = true;
  let crawlRunId = null;
  let keywords = process.env.CRAWL_KEYWORDS
    ? process.env.CRAWL_KEYWORDS.split(',').map((item) => item.trim()).filter(Boolean)
    : DEFAULT_QUERIES.slice();
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
  
  const generateSummary = runOptions.generateSummary !== false;

  try {
    // 1. Initialize database
    await initDatabase();
    
    crawlRunId = await dbOps.startCrawlRun(keywords);

    // 2. Fetch search results with bounded keyword concurrency and deduplicate by canonical URL.
    let rawArticlesMap = new Map();
    await mapConcurrent(keywords, 2, async (kw) => {
      console.log(`[Crawler Run] Scraping for keyword: "${kw}"`);
      try {
        const results = await scrapeAll(kw, scrapeOptions);
        console.log(`[Crawler Run] Keyword "${kw}" returned ${results.length} articles`);
        if (Array.isArray(results.sourceStats)) {
          await Promise.all(results.sourceStats.map((stats) =>
            dbOps.saveCrawlSourceRun(crawlRunId, kw, stats)
          ));
        }
        for (const art of results) {
          const url = canonicalizeUrl(art.url);
          const relevanceScore = scoreRelevance(art.title, kw);
          const current = rawArticlesMap.get(url);
          if (!current || relevanceScore > current.relevance_score) {
            rawArticlesMap.set(url, {
              ...art,
              url,
              source: normalizeSource(art.source, url),
              relevance_score: relevanceScore,
              story_key: storyKey(art.title),
            });
          }
        }
      } catch (err) {
        console.error(`[Crawler Run] Scraping failed for keyword "${kw}":`, err.message);
      }
    });
    
    const rawArticles = Array.from(rawArticlesMap.values());
    console.log(`[Crawler Run] Total unique scraped articles from all keywords: ${rawArticles.length}`);

    let newCount = 0;
    let skippedCount = 0;
    let savedArticlesForToday = [];

    // Today's date in YYYY-MM-DD format
    const todayDate = taipeiDateString();

    // 3. Process each article
    for (let i = 0; i < rawArticles.length; i++) {
      const art = rawArticles[i];
      console.log(`[Crawler Run] Processing ${i + 1}/${rawArticles.length}: ${art.title}`);

      // Check if article is already in DB
      const existing = await dbOps.getArticleByUrl(art.url);
      
      if (existing && existing.summary && existing.sentiment) {
        console.log(`[Crawler Run] Article already exists with summary. Skipping AI analysis.`);
        skippedCount++;
        await dbOps.touchArticle(existing.id);
        
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

    if (generateSummary && todayArticles.length > 0) {
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
    } else if (generateSummary) {
      console.log('[Crawler Run] No articles found for today. Skipping daily summary report generation.');
    }

    const result = {
      success: true,
      newCount,
      skippedCount,
      discoveredCount: rawArticles.length,
      todayArticlesCount: todayArticles.length
    };
    await dbOps.finishCrawlRun(crawlRunId, { status: 'success', ...result });
    return result;

  } catch (err) {
    console.error('[Crawler Run] Critical error during execution:', err);
    if (crawlRunId) {
      try {
        await dbOps.finishCrawlRun(crawlRunId, { status: 'failed', error: err.message });
      } catch (logErr) {
        console.error('[Crawler Run] Failed to finalize crawl log:', logErr.message);
      }
    }
    return {
      success: false,
      error: err.message
    };
  } finally {
    crawlInProgress = false;
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
