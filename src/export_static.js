const path = require('path');
const fs = require('fs');
const { initDatabase, dbOps } = require('./db');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (const a of args) {
    if (a.startsWith('--date=')) out.date = a.split('=')[1];
    if (a.startsWith('--start=')) out.start = a.split('=')[1];
    if (a.startsWith('--end=')) out.end = a.split('=')[1];
  }
  return out;
}

async function exportForDate(date) {
  const articles = await dbOps.getArticlesByDate(date);
  const summary = await dbOps.getDailySummary(date);

  const dataDir = path.join(__dirname, '..', 'public', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  // write date-specific file and a latest shortcut
  const dateFile = path.join(dataDir, `news-${date}.json`);
  const latestFile = path.join(dataDir, `news.json`);
  fs.writeFileSync(dateFile, JSON.stringify({ success: true, date, count: articles.length, articles }, null, 2));
  fs.writeFileSync(latestFile, JSON.stringify({ success: true, date, count: articles.length, articles }, null, 2));

  // write summary
  const summaryFile = path.join(dataDir, `summary-${date}.json`);
  fs.writeFileSync(summaryFile, JSON.stringify({ success: true, date, summary }, null, 2));

  console.log(`[export_static] Wrote ${articles.length} articles for ${date} to ${dateFile}`);
}

async function exportRange(start, end) {
  const articles = await dbOps.getArticlesRange(start, end);
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const rangeFile = path.join(dataDir, `news-range-${start}_to_${end}.json`);
  fs.writeFileSync(rangeFile, JSON.stringify({ success: true, start, end, count: articles.length, articles }, null, 2));
  console.log(`[export_static] Wrote ${articles.length} articles for range ${start} - ${end} to ${rangeFile}`);
}

async function exportRecentSummaries(limit = 7) {
  const summaries = await dbOps.getRecentSummaries(limit);
  const dataDir = path.join(__dirname, '..', 'public', 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const file = path.join(dataDir, `daily_summaries.json`);
  fs.writeFileSync(file, JSON.stringify({ success: true, count: summaries.length, summaries }, null, 2));
  console.log(`[export_static] Wrote ${summaries.length} recent summaries to ${file}`);
}

async function main() {
  const args = parseArgs();
  const today = new Date().toISOString().substring(0, 10);
  const date = args.date || today;

  try {
    await initDatabase();

    if (args.start && args.end) {
      await exportRange(args.start, args.end);
    }

    await exportForDate(date);
    await exportRecentSummaries(7);

    console.log('[export_static] Export completed.');
    process.exit(0);
  } catch (err) {
    console.error('[export_static] Failed:', err);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = main;
