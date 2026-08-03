const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'news.db');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Ensure database file exists
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', DB_PATH);
  }
});

// Initialize database schema
function initDatabase() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Articles table
      db.run(`
        CREATE TABLE IF NOT EXISTS articles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          source TEXT NOT NULL,
          url TEXT UNIQUE NOT NULL,
          publish_date TEXT NOT NULL,
          content TEXT,
          summary TEXT,
          sentiment TEXT,
          keywords TEXT,
          crawled_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);
      });

      // Daily summaries table
      db.run(`
        CREATE TABLE IF NOT EXISTS daily_summaries (
          date TEXT PRIMARY KEY,
          summary_text TEXT NOT NULL,
          crawled_count INTEGER DEFAULT 0,
          sentiment_distribution TEXT, -- JSON string
          created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  });
}

// Database helper operations
const dbOps = {
  // Get a single article by URL
  getArticleByUrl(url) {
    return new Promise((resolve, reject) => {
      const query = `SELECT * FROM articles WHERE url = ?`;
      db.get(query, [url], (err, row) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  },

  // Save an article, skip if URL already exists (INSERT OR IGNORE)
  saveArticle(article) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO articles (title, source, url, publish_date, content, summary, sentiment, keywords)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          title = excluded.title,
          publish_date = excluded.publish_date,
          content = COALESCE(excluded.content, content),
          summary = COALESCE(excluded.summary, summary),
          sentiment = COALESCE(excluded.sentiment, sentiment),
          keywords = COALESCE(excluded.keywords, keywords)
      `;
      db.run(
        query,
        [
          article.title,
          article.source,
          article.url,
          article.publish_date,
          article.content || '',
          article.summary || '',
          article.sentiment || 'Neutral',
          article.keywords || ''
        ],
        function(err) {
          if (err) return reject(err);
          resolve(this.lastID);
        }
      );
    });
  },

  // Get articles by publish date
  getArticlesByDate(date) {
    return new Promise((resolve, reject) => {
      // Include articles where publish_date matches OR publish_date is empty but crawled_at falls on the date
      const query = `SELECT * FROM articles WHERE publish_date = ? OR (publish_date = '' AND date(crawled_at) = ?) ORDER BY crawled_at DESC`;
      db.all(query, [date, date], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  // Get articles in a date range
  getArticlesRange(startDate, endDate) {
    return new Promise((resolve, reject) => {
      // Include articles whose publish_date falls in range OR those without publish_date but crawled_at within range
      const query = `SELECT * FROM articles WHERE (publish_date >= ? AND publish_date <= ?) OR (publish_date = '' AND date(crawled_at) >= ? AND date(crawled_at) <= ?) ORDER BY publish_date DESC, crawled_at DESC`;
      db.all(query, [startDate, endDate, startDate, endDate], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  // Get articles by a list of IDs
  getArticlesByIds(ids) {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(ids) || ids.length === 0) return resolve([]);
      const placeholders = ids.map(() => '?').join(',');
      const query = `SELECT * FROM articles WHERE id IN (${placeholders}) ORDER BY publish_date DESC, crawled_at DESC`;
      db.all(query, ids, (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  // Get all articles
  getAllArticles() {
    return new Promise((resolve, reject) => {
      const query = `SELECT * FROM articles ORDER BY crawled_at DESC`;
      db.all(query, [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  },

  // Update publish_date for an article by id
  updatePublishDate(id, publish_date) {
    return new Promise((resolve, reject) => {
      const query = `UPDATE articles SET publish_date = ? WHERE id = ?`;
      db.run(query, [publish_date, id], function(err) {
        if (err) return reject(err);
        resolve(this.changes);
      });
    });
  },

  // Delete an article by id
  deleteArticleById(id) {
    return new Promise((resolve, reject) => {
      const query = `DELETE FROM articles WHERE id = ?`;
      db.run(query, [id], function(err) {
        if (err) return reject(err);
        resolve(this.changes); // number of rows deleted
      });
    });
  },

  // Save or update daily summary
  saveDailySummary(date, summaryText, crawledCount, sentimentDist) {
    return new Promise((resolve, reject) => {
      const query = `
        INSERT INTO daily_summaries (date, summary_text, crawled_count, sentiment_distribution)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          summary_text = excluded.summary_text,
          crawled_count = excluded.crawled_count,
          sentiment_distribution = excluded.sentiment_distribution,
          created_at = CURRENT_TIMESTAMP
      `;
      db.run(
        query,
        [date, summaryText, crawledCount, JSON.stringify(sentimentDist)],
        (err) => {
          if (err) return reject(err);
          resolve();
        }
      );
    });
  },

  // Get daily summary
  getDailySummary(date) {
    return new Promise((resolve, reject) => {
      const query = `SELECT * FROM daily_summaries WHERE date = ?`;
      db.get(query, [date], (err, row) => {
        if (err) return reject(err);
        if (row && row.sentiment_distribution) {
          row.sentiment_distribution = JSON.parse(row.sentiment_distribution);
        }
        resolve(row);
      });
    });
  },

  // Get recent daily summaries
  getRecentSummaries(limit = 7) {
    return new Promise((resolve, reject) => {
      const query = `SELECT * FROM daily_summaries ORDER BY date DESC LIMIT ?`;
      db.all(query, [limit], (err, rows) => {
        if (err) return reject(err);
        rows.forEach(row => {
          if (row.sentiment_distribution) {
            row.sentiment_distribution = JSON.parse(row.sentiment_distribution);
          }
        });
        resolve(rows);
      });
    });
  },

  // Close database connection
  close() {
    return new Promise((resolve, reject) => {
      db.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
};

module.exports = {
  db,
  initDatabase,
  dbOps
};
