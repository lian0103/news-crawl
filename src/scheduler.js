const cron = require('node-cron');
const runCrawler = require('./crawl');
const { generatePDFReport } = require('./pdf');
const { sendDailyEmail } = require('./mailer');

/**
 * Start the daily scheduler.
 * Runs every day at 08:30 AM.
 */
function startScheduler() {
  const crawlCron = process.env.CRAWL_CRON || '0 */3 * * *';
  const reportCron = process.env.REPORT_CRON || '30 8 * * *';
  let running = false;

  async function withLock(label, task) {
    if (running) {
      console.warn(`[Scheduler] Skipping ${label}; another scheduled job is still running.`);
      return null;
    }
    running = true;
    try {
      return await task();
    } finally {
      running = false;
    }
  }

  console.log(`[Scheduler] Incremental crawl: ${crawlCron}; daily report: ${reportCron}`);

  cron.schedule(crawlCron, () => withLock('incremental crawl', async () => {
    console.log('[Scheduler] Starting incremental crawl...');
    const stats = await runCrawler(undefined, { generateSummary: false });
    console.log('[Scheduler] Incremental crawl completed:', stats);
  }).catch((err) => console.error('[Scheduler] Incremental crawl failed:', err.message)), {
    scheduled: true,
    timezone: 'Asia/Taipei'
  });
  
  // Cron expression: '30 8 * * *' (Minute=30, Hour=8, every day)
  // For testing, let's log the schedule.
  cron.schedule(reportCron, () => withLock('daily report', async () => {
    const { taipeiDateString } = require('./scrapers/quality');
    const todayDate = taipeiDateString();
    console.log(`[Scheduler] Cron triggered for ${todayDate} at ${new Date().toLocaleString()}`);
    
    try {
      // 1. Run the crawler
      console.log('[Scheduler] Starting daily crawl...');
      const stats = await runCrawler(undefined, { generateSummary: true });
      console.log('[Scheduler] Daily crawl completed stats:', stats);
      
      if (stats.success && stats.todayArticlesCount > 0) {
        // 2. Generate PDF report
        console.log('[Scheduler] Daily crawl success. Generating PDF report...');
        const pdfPath = await generatePDFReport(todayDate);
        
        // 3. Send Email
        console.log('[Scheduler] PDF generated. Sending daily email...');
        const emailSent = await sendDailyEmail(todayDate, pdfPath);
        console.log(`[Scheduler] Email dispatch result: ${emailSent ? 'Success' : 'Skipped/Failed'}`);
      } else {
        console.log('[Scheduler] No new articles found today or crawler failed. Skipping PDF & Email.');
      }
    } catch (err) {
      console.error('[Scheduler] Error occurred in scheduled task:', err.message);
    }
  }).catch((err) => console.error('[Scheduler] Daily report failed:', err.message)), {
    scheduled: true,
    timezone: 'Asia/Taipei' // Force Taiwan timezone for local timing consistency
  });
}

module.exports = startScheduler;
