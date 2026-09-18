require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { dbOps, initDatabase } = require('./db');
const runCrawler = require('./crawl');
const { generatePDFReport, generatePDFReportRange, generatePDFForIds } = require('./pdf');
const { sendDailyEmail } = require('./mailer');
const startScheduler = require('./scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// API: Get articles by date
app.get('/api/news', async (req, res) => {
  const date = req.query.date || new Date().toISOString().substring(0, 10);
  try {
    const articles = await dbOps.getArticlesByDate(date);
    res.json({ success: true, date, count: articles.length, articles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get daily summary by date
app.get('/api/summary', async (req, res) => {
  const date = req.query.date || new Date().toISOString().substring(0, 10);
  try {
    const summary = await dbOps.getDailySummary(date);
    res.json({ success: true, date, summary });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get recent summaries
app.get('/api/recent-summaries', async (req, res) => {
  const limit = req.query.limit ? parseInt(req.query.limit) : 7;
  try {
    const summaries = await dbOps.getRecentSummaries(limit);
    res.json({ success: true, count: summaries.length, summaries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Inspect recent crawler health and discovery counts
app.get('/api/crawl-runs', async (req, res) => {
  try {
    const runs = await dbOps.getRecentCrawlRuns(req.query.limit || 20);
    res.json({ success: true, count: runs.length, runs });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/crawl-runs/:id/sources', async (req, res) => {
  try {
    const sources = await dbOps.getCrawlSourceRuns(Number(req.params.id));
    res.json({ success: true, count: sources.length, sources });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Get articles in a date range (inclusive)
app.get('/api/news-range', async (req, res) => {
  const start = req.query.start;
  const end = req.query.end;

  if (!start || !end) {
    return res.status(400).json({ success: false, error: '請提供 start 與 end 參數，格式 YYYY-MM-DD' });
  }

  try {
    const articles = await dbOps.getArticlesRange(start, end);
    res.json({ success: true, start, end, count: articles.length, articles });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Manually trigger crawler
app.post('/api/crawl', async (req, res) => {
  console.log('[Server] Manual crawl triggered via API');
  try {
    const stats = await runCrawler();
    res.status(stats.success ? 200 : (stats.busy ? 409 : 500)).json({ success: stats.success, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Delete an article by id
app.delete('/api/article/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!id) return res.status(400).json({ success: false, error: 'Invalid id' });

  try {
    const changes = await dbOps.deleteArticleById(id);
    if (changes > 0) {
      res.json({ success: true, id, deleted: true });
    } else {
      res.status(404).json({ success: false, error: 'Article not found' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Download PDF report
app.get('/api/download-pdf', async (req, res) => {
  const start = req.query.start;
  const end = req.query.end;

  try {
    if (start && end) {
      const pdfPath = await generatePDFReportRange(start, end);
      const filename = `新北市選舉輿情報告_${start}_to_${end}.pdf`;
      res.download(pdfPath, filename, (err) => {
        if (err) console.error('[Server] PDF download error:', err.message);
      });
    } else {
      const date = req.query.date || new Date().toISOString().substring(0, 10);
      const pdfPath = await generatePDFReport(date);
      res.download(pdfPath, `新北市選舉輿情報告_${date}.pdf`, (err) => {
        if (err) console.error('[Server] PDF download error:', err.message);
      });
    }
  } catch (err) {
    console.error('[Server] PDF download generation failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Download PDF for selected article IDs (ids as comma-separated list)
app.get('/api/download-pdf-selected', async (req, res) => {
  const idsParam = req.query.ids;
  if (!idsParam) return res.status(400).json({ success: false, error: '請提供 ids 參數 (逗號分隔的 article IDs)' });

  const ids = idsParam.split(',').map(s => parseInt(s, 10)).filter(n => !Number.isNaN(n));
  if (ids.length === 0) return res.status(400).json({ success: false, error: '無效的 ids 參數' });

  try {
    const pdfPath = await generatePDFForIds(ids);
    const dateTag = new Date().toISOString().substring(0, 10);
    const filename = `新聞整理_${dateTag}.pdf`;
    res.download(pdfPath, filename, (err) => {
      if (err) console.error('[Server] PDF selected download error:', err.message);
    });
  } catch (err) {
    console.error('[Server] PDF selected generation failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Send email with PDF
app.post('/api/send-email', async (req, res) => {
  const date = req.query.date || new Date().toISOString().substring(0, 10);
  try {
    const pdfPath = await generatePDFReport(date);
    const success = await sendDailyEmail(date, pdfPath);
    if (success) {
      res.json({ success: true, message: `Email sent to ${process.env.EMAIL_TO}` });
    } else {
      res.status(400).json({ success: false, error: 'Failed to send email. Check SMTP settings.' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Start server
async function start() {
  try {
    await initDatabase();
    
    // Start the cron scheduler
    startScheduler();

    app.listen(PORT, () => {
      console.log(`=========================================`);
      console.log(`  Election Public Opinion System Running`);
      console.log(`  Dashboard: http://localhost:${PORT}`);
      console.log(`=========================================`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
