const cron = require('node-cron');
const runCrawler = require('./crawl');
const { generatePDFReport } = require('./pdf');
const { sendDailyEmail } = require('./mailer');

/**
 * Start the daily scheduler.
 * Runs every day at 08:30 AM.
 */
function startScheduler() {
  console.log('[Scheduler] Initializing daily scheduler (every day at 08:30)...');
  
  // Cron expression: '30 8 * * *' (Minute=30, Hour=8, every day)
  // For testing, let's log the schedule.
  cron.schedule('30 8 * * *', async () => {
    const todayDate = new Date().toISOString().substring(0, 10);
    console.log(`[Scheduler] Cron triggered for ${todayDate} at ${new Date().toLocaleString()}`);
    
    try {
      // 1. Run the crawler
      console.log('[Scheduler] Starting daily crawl...');
      const stats = await runCrawler('新北市選舉');
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
  }, {
    scheduled: true,
    timezone: 'Asia/Taipei' // Force Taiwan timezone for local timing consistency
  });
}

module.exports = startScheduler;
