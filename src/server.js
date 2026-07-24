require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { dbOps, initDatabase } = require('./db');
const runCrawler = require('./crawl');
const { generatePDFReport } = require('./pdf');
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

// API: Manually trigger crawler
app.post('/api/crawl', async (req, res) => {
  console.log('[Server] Manual crawl triggered via API');
  try {
    const stats = await runCrawler();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Download PDF report
app.get('/api/download-pdf', async (req, res) => {
  const date = req.query.date || new Date().toISOString().substring(0, 10);
  try {
    const pdfPath = await generatePDFReport(date);
    res.download(pdfPath, `新北市選舉輿情報告_${date}.pdf`, (err) => {
      if (err) {
        console.error('[Server] PDF download error:', err.message);
      }
    });
  } catch (err) {
    console.error('[Server] PDF download generation failed:', err.message);
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
