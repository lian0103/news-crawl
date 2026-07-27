const fs = require('fs');
const path = require('path');
const { dbOps } = require('./db');

/**
 * Basic helper to convert simple markdown to HTML.
 * @param {string} md 
 * @returns {string} HTML content
 */
function markdownToHtml(md) {
  if (!md) return '';
  
  let html = md;
  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  
  // Bold
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  
  // List items (supports - and *)
  html = html.replace(/^\s*[\-\*]\s+(.*$)/gim, '<li>$1</li>');
  
  // Group consecutive list items into ul
  // This is a simple regex grouping
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  
  // Paragraphs (split by double newlines)
  const paragraphs = html.split(/\n\n+/);
  html = paragraphs.map(p => {
    p = p.trim();
    if (!p) return '';
    // Skip wrapping if it's already a list or header block
    if (p.startsWith('<h') || p.startsWith('<ul') || p.startsWith('<li')) {
      return p;
    }
    return `<p>${p.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');

  return html;
}

/**
 * Generate a PDF summary report using Puppeteer.
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<string>} Path to the generated PDF file
 */
async function generatePDFReport(date) {
  console.log(`[PDF Generator] Starting PDF generation for date: ${date}`);
  
  // 1. Fetch data from database
  const summaryRow = await dbOps.getDailySummary(date);
  const articles = await dbOps.getArticlesByDate(date);
  
  if (!summaryRow && articles.length === 0) {
    throw new Error(`No data available for date: ${date} to generate PDF`);
  }

  const summaryText = summaryRow ? summaryRow.summary_text : '今日無 AI 綜合摘要報告。';
  const summaryHtml = markdownToHtml(summaryText);

  // Compute stats
  const totalCount = articles.length;
  const sourceStats = articles.reduce((acc, curr) => {
    acc[curr.source] = (acc[curr.source] || 0) + 1;
    return acc;
  }, {});

  const sentimentStats = articles.reduce((acc, curr) => {
    const s = curr.sentiment || 'Neutral';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, { Positive: 0, Neutral: 0, Negative: 0 });

  // 2. Build HTML content
  const ltnCount = sourceStats['自由時報'] || 0;
  const udnCount = sourceStats['聯合報'] || 0;
  const othersCount = totalCount - udnCount - ltnCount;

  // Build articles list HTML
  const articlesListHtml = articles.map((art, idx) => {
    let sentimentBadgeClass = 'badge-neutral';
    let sentimentText = '中立';
    if (art.sentiment === 'Positive') {
      sentimentBadgeClass = 'badge-positive';
      sentimentText = '正面';
    } else if (art.sentiment === 'Negative') {
      sentimentBadgeClass = 'badge-negative';
      sentimentText = '負面';
    }

    return `
      <div class="article-card">
        <div class="article-header">
          <span class="article-idx">#${idx + 1}</span>
          <span class="article-source">${art.source}</span>
          <span class="badge ${sentimentBadgeClass}">${sentimentText}</span>
          <span class="article-link"><a href="${art.url}" target="_blank">閱讀原文 ↗</a></span>
        </div>
        <h3 class="article-title">${art.title}</h3>
        <p class="article-summary">${art.summary || '無摘要'}</p>
        ${art.keywords ? `<div class="article-keywords"><strong>關鍵詞：</strong> ${art.keywords}</div>` : ''}
      </div>
    `;
  }).join('');

  const htmlContent = `
    <!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <title>新北市選舉輿情日報 - ${date}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+TC:wght@400;500;700&display=swap');
        
        body {
          font-family: 'Noto Sans TC', 'Outfit', sans-serif;
          color: #2D3748;
          margin: 0;
          padding: 0;
          line-height: 1.6;
          background-color: #FFFFFF;
        }
        .container {
          padding: 40px;
          max-width: 800px;
          margin: 0 auto;
        }
        .header {
          border-bottom: 3px solid #3182CE;
          padding-bottom: 20px;
          margin-bottom: 30px;
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
        }
        .header h1 {
          font-size: 28px;
          color: #1A365D;
          margin: 0 0 10px 0;
          font-weight: 700;
        }
        .header .date-tag {
          font-size: 16px;
          color: #4A5568;
          background: #EDF2F7;
          padding: 6px 14px;
          border-radius: 20px;
          font-weight: 600;
        }
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 35px;
        }
        .stat-card {
          background: #F7FAFC;
          border: 1px solid #E2E8F0;
          border-radius: 8px;
          padding: 15px;
          text-align: center;
        }
        .stat-card h4 {
          margin: 0 0 8px 0;
          font-size: 14px;
          color: #718096;
          text-transform: uppercase;
        }
        .stat-card .value {
          font-size: 24px;
          font-weight: 700;
          color: #2B6CB0;
        }
        .stat-card .sub-value {
          font-size: 12px;
          color: #718096;
          margin-top: 5px;
        }
        .section-title {
          font-size: 20px;
          color: #1A365D;
          border-left: 5px solid #3182CE;
          padding-left: 12px;
          margin: 35px 0 20px 0;
          font-weight: 700;
        }
        .ai-summary-block {
          background: #F0F4F8;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 35px;
          border: 1px dashed #CBD5E0;
        }
        .ai-summary-block p {
          margin: 0 0 15px 0;
        }
        .ai-summary-block ul {
          margin: 0;
          padding-left: 20px;
        }
        .ai-summary-block li {
          margin-bottom: 8px;
        }
        .article-card {
          border: 1px solid #E2E8F0;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 20px;
          page-break-inside: avoid;
        }
        .article-header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 12px;
          font-size: 12px;
        }
        .article-idx {
          font-weight: bold;
          color: #718096;
        }
        .article-source {
          background: #E2E8F0;
          color: #4A5568;
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 600;
        }
        .badge {
          padding: 2px 8px;
          border-radius: 4px;
          font-weight: 600;
        }
        .badge-positive {
          background: #C6F6D5;
          color: #22543D;
        }
        .badge-neutral {
          background: #EDF2F7;
          color: #4A5568;
        }
        .badge-negative {
          background: #FED7D7;
          color: #742A2A;
        }
        .article-link {
          margin-left: auto;
        }
        .article-link a {
          color: #3182CE;
          text-decoration: none;
        }
        .article-title {
          margin: 0 0 10px 0;
          font-size: 18px;
          color: #2D3748;
          font-weight: 700;
        }
        .article-summary {
          color: #4A5568;
          font-size: 14px;
          margin: 0 0 10px 0;
        }
        .article-keywords {
          font-size: 12px;
          color: #718096;
        }
        .footer {
          margin-top: 50px;
          border-top: 1px solid #E2E8F0;
          padding-top: 15px;
          text-align: center;
          font-size: 11px;
          color: #A0AEC0;
          page-break-before: avoid;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div>
            <h1>新北市選舉輿情每日摘要</h1>
            <div style="font-size: 14px; color: #718096;">自動化輿情爬網、AI 摘要與情感分析系統</div>
          </div>
          <span class="date-tag">${date}</span>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <h4>今日總聲量</h4>
            <div class="value">${totalCount}</div>
            <div class="sub-value">篇新聞報導</div>
          </div>
          <div class="stat-card">
            <h4>來源分佈</h4>
            <div class="value" style="font-size: 18px; line-height: 24px; padding-top: 4px;">
              聯合: ${udnCount} | 自由: ${ltnCount} | 其他來源: ${othersCount}
            </div>
            <div class="sub-value">主要報社覆蓋率</div>
          </div>
          <div class="stat-card">
            <h4>情感分析</h4>
            <div class="value" style="font-size: 18px; line-height: 24px; padding-top: 4px;">
              正: ${sentimentStats.Positive} | 中: ${sentimentStats.Neutral} | 負: ${sentimentStats.Negative}
            </div>
            <div class="sub-value">輿論傾向分佈</div>
          </div>
        </div>

        <div class="section-title">今日輿情大局觀與綜合分析</div>
        <div class="ai-summary-block">
          ${summaryHtml}
        </div>

        <div class="section-title">重點輿情新聞列表 (${totalCount} 篇)</div>
        <div class="articles-container">
          ${articlesListHtml}
        </div>

        <div class="footer">
          本報告由新北市選舉輿情系統自動產生。資料來源：聯合新聞網、自由電子報、中時新聞網。<br>
          產生時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
        </div>
      </div>
    </body>
    </html>
  `;

  // 3. Render HTML to PDF using Puppeteer
  let browser = null;
  try {
    const puppeteerModule = await import('puppeteer');
    const puppeteer = puppeteerModule.default || puppeteerModule;
    
    // Ensure output reports directory exists
    const reportsDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    
    const pdfPath = path.join(reportsDir, `election_report_${date}.pdf`);

    console.log('[PDF Generator] Launching headless browser...');
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    console.log('[PDF Generator] Setting page content...');
    await page.setContent(htmlContent, { waitUntil: 'networkidle2' });
    
    console.log('[PDF Generator] Rendering PDF to file...');
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: {
        top: '15mm',
        bottom: '15mm',
        left: '15mm',
        right: '15mm'
      },
      printBackground: true
    });

    console.log(`[PDF Generator] PDF generated successfully at: ${pdfPath}`);
    return pdfPath;
  } catch (err) {
    console.error('[PDF Generator] Failed to render PDF:', err.message);
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = {
  generatePDFReport
};

// Generate PDF for a list of article IDs
async function generatePDFForIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('No article ids provided');
  }

  console.log(`[PDF Generator] Generating PDF for selected IDs: ${ids.join(',')}`);
  const articles = await dbOps.getArticlesByIds(ids);
  if (!articles || articles.length === 0) {
    throw new Error('No articles found for provided ids');
  }

  const totalCount = articles.length;
  const sourceStats = articles.reduce((acc, curr) => {
    acc[curr.source] = (acc[curr.source] || 0) + 1;
    return acc;
  }, {});

  const sentimentStats = articles.reduce((acc, curr) => {
    const s = curr.sentiment || 'Neutral';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, { Positive: 0, Neutral: 0, Negative: 0 });

  const ltnCount = sourceStats['自由時報'] || 0;
  const udnCount = sourceStats['聯合報'] || 0;
  const othersCount = totalCount - udnCount - ltnCount;

  const articlesListHtml = articles.map((art, idx) => {
    let sentimentBadgeClass = 'badge-neutral';
    let sentimentText = '中立';
    if (art.sentiment === 'Positive') {
      sentimentBadgeClass = 'badge-positive';
      sentimentText = '正面';
    } else if (art.sentiment === 'Negative') {
      sentimentBadgeClass = 'badge-negative';
      sentimentText = '負面';
    }

    return `
      <div class="article-card">
        <div class="article-header">
          <span class="article-idx">#${idx + 1}</span>
          <span class="article-source">${art.source}</span>
          <span class="badge ${sentimentBadgeClass}">${sentimentText}</span>
          <span class="article-link"><a href="${art.url}" target="_blank">閱讀原文 ↗</a></span>
        </div>
        <h3 class="article-title">${art.title}</h3>
        <p class="article-summary">${art.summary || '無摘要'}</p>
        ${art.keywords ? `<div class="article-keywords"><strong>關鍵詞：</strong> ${art.keywords}</div>` : ''}
      </div>
    `;
  }).join('');

  const htmlContent = `<!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <title>新聞整理</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+TC:wght@400;500;700&display=swap');
        body { font-family: 'Noto Sans TC', 'Outfit', sans-serif; color: #2D3748; margin: 0; padding: 0; line-height: 1.6; background-color: #FFFFFF; }
        .container { padding: 28px 36px; max-width: 900px; margin: 0 auto; }
        .header { border-bottom: 3px solid #3182CE; padding-bottom: 16px; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:flex-end; }
        .header h1 { font-size: 22px; color:#1A365D; margin:0; }
        .date-tag { font-size: 13px; color:#4A5568; background:#EDF2F7; padding:6px 12px; border-radius:16px; font-weight:600; }
        .stats-grid { display:flex; gap:12px; margin:18px 0 22px 0; }
        .stat-card { background:#F7FAFC; padding:12px; border-radius:8px; flex:1; }
        .section-title { font-size:18px; color:#1A365D; margin:18px 0; font-weight:700; }
        .article-card { border:1px solid #E2E8F0; border-radius:8px; padding:12px; margin-bottom:12px; page-break-inside: avoid; }
        .article-header { display:flex; gap:8px; align-items:center; font-size:12px; margin-bottom:8px; }
        .article-title { margin:0 0 8px 0; font-size:16px; }
        .footer { margin-top:30px; border-top:1px solid #E2E8F0; padding-top:12px; font-size:12px; color:#A0AEC0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div>
            <h1>新聞整理</h1>
            <div style="font-size:13px; color:#718096;">選取篇數：${totalCount}</div>
          </div>
          <span class="date-tag">產出時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</span>
        </div>

        <div class="stats-grid">
          <div class="stat-card"><div style="font-size:14px;color:#718096;">總聲量</div><div style="font-size:20px;font-weight:700;color:#2B6CB0;">${totalCount}</div></div>
          <div class="stat-card"><div style="font-size:14px;color:#718096;">來源分佈</div><div style="font-size:14px;margin-top:6px;">聯合:${udnCount} | 自由:${ltnCount} | 其他來源:${othersCount}</div></div>
          <div class="stat-card"><div style="font-size:14px;color:#718096;">情感</div><div style="font-size:14px;margin-top:6px;">正:${sentimentStats.Positive} | 中:${sentimentStats.Neutral} | 負:${sentimentStats.Negative}</div></div>
        </div>

        <div class="section-title">文章清單 (${totalCount} 篇)</div>
        <div class="articles-container">${articlesListHtml}</div>

        <div class="footer">本報告由新北市選舉輿情系統自動產生。資料來源與分析僅供內部參考。</div>
      </div>
    </body>
    </html>`;

  // render
  let browser = null;
  try {
    const puppeteerModule = await import('puppeteer');
    const puppeteer = puppeteerModule.default || puppeteerModule;
    const reportsDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });
    const dateTag = new Date().toISOString().substring(0, 10);
    const pdfPath = path.join(reportsDir, `election_report_selected_${dateTag}.pdf`);

    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle2' });
    await page.pdf({ path: pdfPath, format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }, printBackground: true });

    console.log(`[PDF Generator] Selected PDF generated at: ${pdfPath}`);
    return pdfPath;
  } catch (err) {
    console.error('[PDF Generator] Failed to render selected PDF:', err.message);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

module.exports.generatePDFForIds = generatePDFForIds;

/**
 * Generate a PDF report for a date range (inclusive).
 * @param {string} start YYYY-MM-DD
 * @param {string} end YYYY-MM-DD
 * @returns {Promise<string>} Path to the generated PDF file
 */
async function generatePDFReportRange(start, end) {
  console.log(`[PDF Generator] Generating PDF for range: ${start} - ${end}`);

  // Fetch articles in range
  const articles = await dbOps.getArticlesRange(start, end);

  if (!articles || articles.length === 0) {
    throw new Error(`No data available for range: ${start} - ${end}`);
  }

  // Try to build a combined summary by concatenating available daily summaries
  const startDate = parseDateObj(start);
  const endDate = parseDateObj(end);
  const dayMs = 24 * 3600 * 1000;
  let aggregatedSummary = '';

  for (let d = startDate; d <= endDate; d = new Date(d.getTime() + dayMs)) {
    const ds = toDateString(d);
    try {
      const row = await dbOps.getDailySummary(ds);
      if (row && row.summary_text) {
        aggregatedSummary += `### ${ds}\n\n` + row.summary_text + '\n\n';
      }
    } catch (e) {
      // ignore
    }
  }

  if (!aggregatedSummary) {
    aggregatedSummary = '本區間內尚無 AI 綜合摘要。';
  }

  // Compute stats
  const totalCount = articles.length;
  const sourceStats = articles.reduce((acc, curr) => {
    acc[curr.source] = (acc[curr.source] || 0) + 1;
    return acc;
  }, {});

  const sentimentStats = articles.reduce((acc, curr) => {
    const s = curr.sentiment || 'Neutral';
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, { Positive: 0, Neutral: 0, Negative: 0 });

  const ltnCount = sourceStats['自由時報'] || 0;
  const udnCount = sourceStats['聯合報'] || 0;
  const othersCount = totalCount - udnCount - ltnCount;

  const articlesListHtml = articles.map((art, idx) => {
    let sentimentBadgeClass = 'badge-neutral';
    let sentimentText = '中立';
    if (art.sentiment === 'Positive') {
      sentimentBadgeClass = 'badge-positive';
      sentimentText = '正面';
    } else if (art.sentiment === 'Negative') {
      sentimentBadgeClass = 'badge-negative';
      sentimentText = '負面';
    }

    return `
      <div class="article-card">
        <div class="article-header">
          <span class="article-idx">#${idx + 1}</span>
          <span class="article-source">${art.source}</span>
          <span class="badge ${sentimentBadgeClass}">${sentimentText}</span>
          <span class="article-link"><a href="${art.url}" target="_blank">閱讀原文 ↗</a></span>
        </div>
        <h3 class="article-title">${art.title}</h3>
        <p class="article-summary">${art.summary || '無摘要'}</p>
        ${art.keywords ? `<div class="article-keywords"><strong>關鍵詞：</strong> ${art.keywords}</div>` : ''}
      </div>
    `;
  }).join('');

  const htmlContent = `<!DOCTYPE html>
    <html lang="zh-TW">
    <head>
      <meta charset="UTF-8">
      <title>新北市選舉輿情報告 ${start} - ${end}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&family=Noto+Sans+TC:wght@400;500;700&display=swap');
        body { font-family: 'Noto Sans TC', 'Outfit', sans-serif; color: #2D3748; margin: 0; padding: 0; line-height: 1.6; background-color: #FFFFFF; }
        .container { padding: 28px 36px; max-width: 900px; margin: 0 auto; }
        .header { border-bottom: 3px solid #3182CE; padding-bottom: 16px; margin-bottom: 20px; display:flex; justify-content:space-between; align-items:flex-end; }
        .header h1 { font-size: 22px; color:#1A365D; margin:0; }
        .date-tag { font-size: 13px; color:#4A5568; background:#EDF2F7; padding:6px 12px; border-radius:16px; font-weight:600; }
        .stats-grid { display:flex; gap:12px; margin:18px 0 22px 0; }
        .stat-card { background:#F7FAFC; padding:12px; border-radius:8px; flex:1; }
        .section-title { font-size:18px; color:#1A365D; margin:18px 0; font-weight:700; }
        .ai-summary-block { background:#F0F4F8; padding:14px; border-radius:8px; margin-bottom:20px; }
        .article-card { border:1px solid #E2E8F0; border-radius:8px; padding:12px; margin-bottom:12px; page-break-inside: avoid; }
        .article-header { display:flex; gap:8px; align-items:center; font-size:12px; margin-bottom:8px; }
        .article-title { margin:0 0 8px 0; font-size:16px; }
        .footer { margin-top:30px; border-top:1px solid #E2E8F0; padding-top:12px; font-size:12px; color:#A0AEC0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div>
            <h1>新北市選舉輿情區間報告</h1>
            <div style="font-size:13px; color:#718096;">區間：${start} — ${end}</div>
          </div>
          <span class="date-tag">產出時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}</span>
        </div>

        <div class="stats-grid">
          <div class="stat-card"><div style="font-size:14px;color:#718096;">總聲量</div><div style="font-size:20px;font-weight:700;color:#2B6CB0;">${totalCount}</div></div>
          <div class="stat-card"><div style="font-size:14px;color:#718096;">來源分佈</div><div style="font-size:14px;margin-top:6px;">聯合:${udnCount} | 自由:${ltnCount} | 其他來源:${othersCount}</div></div>
          <div class="stat-card"><div style="font-size:14px;color:#718096;">情感</div><div style="font-size:14px;margin-top:6px;">正:${sentimentStats.Positive} | 中:${sentimentStats.Neutral} | 負:${sentimentStats.Negative}</div></div>
        </div>

        <div class="section-title">綜合 AI 摘要</div>
        <div class="ai-summary-block">${markdownToHtml(aggregatedSummary)}</div>

        <div class="section-title">文章清單 (${totalCount} 篇)</div>
        <div class="articles-container">${articlesListHtml}</div>

        <div class="footer">本報告由新北市選舉輿情系統自動產生。資料來源與分析僅供內部參考。</div>
      </div>
    </body>
    </html>`;

  // Render to PDF (reuse puppeteer logic)
  let browser = null;
  try {
    const puppeteerModule = await import('puppeteer');
    const puppeteer = puppeteerModule.default || puppeteerModule;
    const reportsDir = path.join(__dirname, '..', 'reports');
    if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

    const pdfPath = path.join(reportsDir, `election_report_${start}_${end}.pdf`);

    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle2' });
    await page.pdf({ path: pdfPath, format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }, printBackground: true });

    console.log(`[PDF Generator] Range PDF generated at: ${pdfPath}`);
    return pdfPath;
  } catch (err) {
    console.error('[PDF Generator] Range render failed:', err.message);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
}

function parseDateObj(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function toDateString(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Extend exports
module.exports.generatePDFReportRange = generatePDFReportRange;
