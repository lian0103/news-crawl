document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dateInput = document.getElementById('date-select');
  const btnCrawl = document.getElementById('btn-crawl');
  const btnDownload = document.getElementById('btn-download');
  const btnEmail = document.getElementById('btn-email');
  const loadingOverlay = document.getElementById('loading-overlay');
  
  // Stats
  const statTotal = document.getElementById('stat-total');
  const lblUdn = document.getElementById('lbl-udn');
  const lblLtn = document.getElementById('lbl-ltn');
  const lblChinatimes = document.getElementById('lbl-chinatimes');
  const segUdn = document.querySelector('.p-udn');
  const segLtn = document.querySelector('.p-ltn');
  const segChinatimes = document.querySelector('.p-chinatimes');
  
  // Sentiment
  const lblPosCount = document.getElementById('lbl-pos-count');
  const lblNeuCount = document.getElementById('lbl-neu-count');
  const lblNegCount = document.getElementById('lbl-neg-count');
  const barPos = document.getElementById('bar-pos');
  const barNeu = document.getElementById('bar-neu');
  const barNeg = document.getElementById('bar-neg');
  
  // Content areas
  const aiOverviewContent = document.getElementById('ai-overview-content');
  const newsContainer = document.getElementById('news-container');
  
  // Filters
  const searchInput = document.getElementById('search-input');
  const filterSource = document.getElementById('filter-source');
  const filterSentiment = document.getElementById('filter-sentiment');

  // Application State
  let articles = [];
  let currentSummary = null;

  // Initialize Date Input to Taipei Today
  const todayStr = getTaipeiTodayString();
  dateInput.value = todayStr;
  dateInput.max = todayStr;

  // Initial Load
  loadDashboardData(todayStr);

  // Event Listeners
  dateInput.addEventListener('change', (e) => {
    loadDashboardData(e.target.value);
  });

  searchInput.addEventListener('input', renderNewsList);
  filterSource.addEventListener('change', renderNewsList);
  filterSentiment.addEventListener('change', renderNewsList);

  btnCrawl.addEventListener('click', async () => {
    // Show Loading
    loadingOverlay.classList.remove('hidden');
    
    try {
      const res = await fetch('/api/crawl', { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        alert(`爬網完成！新增 ${data.stats.newCount} 篇新聞，跳過 ${data.stats.skippedCount} 篇。`);
        // Reload data
        loadDashboardData(dateInput.value);
      } else {
        alert('爬網失敗：' + (data.error || '未知錯誤'));
      }
    } catch (err) {
      alert('請求失敗：' + err.message);
    } finally {
      loadingOverlay.classList.add('hidden');
    }
  });

  btnDownload.addEventListener('click', () => {
    const date = dateInput.value;
    window.open(`/api/download-pdf?date=${date}`, '_blank');
  });

  btnEmail.addEventListener('click', async () => {
    const date = dateInput.value;
    btnEmail.disabled = true;
    btnEmail.innerText = '📧 正在寄送...';
    
    try {
      const res = await fetch(`/api/send-email?date=${date}`, { method: 'POST' });
      const data = await res.json();
      
      if (data.success) {
        alert('PDF 報告已成功寄送至您的信箱！');
      } else {
        alert('郵件寄送失敗：' + (data.error || '請檢查後端 SMTP 配置'));
      }
    } catch (err) {
      alert('連線失敗：' + err.message);
    } finally {
      btnEmail.disabled = false;
      btnEmail.innerText = '📧 寄送 PDF 摘要至信箱';
    }
  });

  // Load All Data for a Date
  async function loadDashboardData(date) {
    console.log('Loading data for:', date);
    
    // Reset Views
    aiOverviewContent.innerHTML = '<div class="spinner" style="width: 25px; height: 25px;"></div> 正在讀取 AI 輿情摘要...';
    newsContainer.innerHTML = '<div class="spinner"></div>';
    
    try {
      // 1. Fetch Summary
      const summaryRes = await fetch(`/api/summary?date=${date}`);
      const summaryData = await summaryRes.json();
      
      // 2. Fetch News
      const newsRes = await fetch(`/api/news?date=${date}`);
      const newsData = await newsRes.json();

      articles = newsData.articles || [];
      currentSummary = summaryData.summary;

      // Update Statistics
      updateStats(articles);
      
      // Update AI Summary Card
      updateAISummary(currentSummary, articles.length);
      
      // Render News Cards
      renderNewsList();

    } catch (err) {
      console.error('Error loading dashboard data:', err);
      aiOverviewContent.innerHTML = '<span style="color: var(--color-neg)">無法讀取今日 AI 輿情摘要</span>';
      newsContainer.innerHTML = '<div class="empty-state"><h3>載入失敗</h3><p>請檢查您的伺服器連線。</p></div>';
    }
  }

  // Update Statistic Indicators & Progress Bars
  function updateStats(newsList) {
    const total = newsList.length;
    statTotal.innerText = total;

    // Source count
    let udn = 0;
    let ltn = 0;
    let chinatimes = 0;

    // Sentiment count
    let pos = 0;
    let neu = 0;
    let neg = 0;

    newsList.forEach(art => {
      if (art.source === '聯合報') udn++;
      else if (art.source === '自由時報') ltn++;
      else if (art.source === '中國時報') chinatimes++;

      if (art.sentiment === 'Positive') pos++;
      else if (art.sentiment === 'Negative') neg++;
      else neu++;
    });

    // Update labels
    lblUdn.innerText = udn;
    lblLtn.innerText = ltn;
    lblChinatimes.innerText = chinatimes;

    // Update segments
    if (total > 0) {
      segUdn.style.width = `${(udn / total) * 100}%`;
      segLtn.style.width = `${(ltn / total) * 100}%`;
      segChinatimes.style.width = `${(chinatimes / total) * 100}%`;
    } else {
      segUdn.style.width = '0%';
      segLtn.style.width = '0%';
      segChinatimes.style.width = '0%';
    }

    // Sentiment updates
    const getPercentStr = (count) => total > 0 ? `${count} 篇 (${Math.round((count / total) * 100)}%)` : '0 篇 (0%)';
    const getPercentVal = (count) => total > 0 ? (count / total) * 100 : 0;

    lblPosCount.innerText = getPercentStr(pos);
    lblNeuCount.innerText = getPercentStr(neu);
    lblNegCount.innerText = getPercentStr(neg);

    barPos.style.width = `${getPercentVal(pos)}%`;
    barNeu.style.width = `${getPercentVal(neu)}%`;
    barNeg.style.width = `${getPercentVal(neg)}%`;
  }

  // Update AI Overview Card
  function updateAISummary(summaryObj, articlesCount) {
    if (!summaryObj) {
      if (articlesCount === 0) {
        aiOverviewContent.innerHTML = '今日無輿情文章，故無 AI 分析報告。您可以點擊右上角「手動更新數據」來爬取最新資料。';
      } else {
        aiOverviewContent.innerHTML = `
          <div style="padding: 10px 0;">
            <p>目前資料庫中有今日的 ${articlesCount} 篇新聞，但尚未生成每日輿情綜合報告。</p>
            <p>請重新執行爬網或點擊下方按鈕以強制生成今日 AI 摘要：</p>
            <button id="btn-force-summary" class="btn btn-sm btn-primary" style="margin-top: 10px;">
              生成 AI 綜合報告
            </button>
          </div>
        `;
        document.getElementById('btn-force-summary').addEventListener('click', async () => {
          // Temporarily trigger crawl (which also regenerates daily summary)
          loadingOverlay.classList.remove('hidden');
          try {
            await fetch('/api/crawl', { method: 'POST' });
            loadDashboardData(dateInput.value);
          } catch(e) {
            alert('生成失敗: ' + e.message);
          } finally {
            loadingOverlay.classList.add('hidden');
          }
        });
      }
      return;
    }

    // Simple markdown rendering in frontend
    aiOverviewContent.innerHTML = formatMarkdown(summaryObj.summary_text);
  }

  // Render Articles Cards
  function renderNewsList() {
    const query = searchInput.value.toLowerCase().trim();
    const source = filterSource.value;
    const sentiment = filterSentiment.value;

    const filtered = articles.filter(art => {
      // Source match
      if (source !== 'all' && art.source !== source) return false;
      
      // Sentiment match
      if (sentiment !== 'all' && art.sentiment !== sentiment) return false;
      
      // Keyword/search match
      if (query) {
        const titleMatch = art.title.toLowerCase().includes(query);
        const summaryMatch = (art.summary || '').toLowerCase().includes(query);
        const contentMatch = (art.content || '').toLowerCase().includes(query);
        const keywordMatch = (art.keywords || '').toLowerCase().includes(query);
        return titleMatch || summaryMatch || contentMatch || keywordMatch;
      }

      return true;
    });

    if (filtered.length === 0) {
      newsContainer.innerHTML = `
        <div class="empty-state card glass">
          <span class="empty-icon">🔍</span>
          <h3>沒有符合條件的新聞</h3>
          <p>請嘗試調整篩選條件或重新搜尋。</p>
        </div>
      `;
      return;
    }

    newsContainer.innerHTML = filtered.map((art, idx) => {
      let sentimentText = '中立';
      let sentimentClass = 'neu';
      if (art.sentiment === 'Positive') {
        sentimentText = '正面';
        sentimentClass = 'pos';
      } else if (art.sentiment === 'Negative') {
        sentimentText = '負面';
        sentimentClass = 'neg';
      }

      const sourceClass = art.source === '聯合報' ? 'udn' : (art.source === '自由時報' ? 'ltn' : 'chinatimes');
      const keywordsArray = art.keywords ? art.keywords.split(',').map(k => k.trim()).filter(k => k) : [];

      return `
        <article class="news-card glass ${sentimentClass}">
          <div class="news-header">
            <span class="news-source ${sourceClass}">${art.source}</span>
            <span class="news-badge ${sentimentClass}">${sentimentText}</span>
            <span class="news-time">${art.publish_date}</span>
          </div>
          
          <h3>${art.title}</h3>
          
          <div class="news-summary-box">
            <strong>💡 AI 輿情摘要</strong>
            <p class="news-summary">${art.summary || '點擊手動更新生成摘要'}</p>
          </div>
          
          <div class="news-original-box">
            <div class="news-original collapsible" id="content-${art.id}">
              ${art.content ? art.content.replace(/\n/g, '<br>') : '（無內文）'}
            </div>
            <button class="btn-toggle-text" data-id="${art.id}">展開完整新聞</button>
          </div>

          <div class="news-footer">
            <div class="news-tags">
              ${keywordsArray.map(tag => `<span class="news-tag">#${tag}</span>`).join('')}
            </div>
            <div class="news-link">
              <a href="${art.url}" target="_blank">看報紙原文 ↗</a>
            </div>
          </div>
        </article>
      `;
    }).join('');

    // Expand / Collapse listeners
    document.querySelectorAll('.btn-toggle-text').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        const contentBox = document.getElementById(`content-${id}`);
        
        if (contentBox.classList.contains('expanded')) {
          contentBox.classList.remove('expanded');
          e.target.innerText = '展開完整新聞';
        } else {
          contentBox.classList.add('expanded');
          e.target.innerText = '收合完整新聞';
        }
      });
    });
  }

  // Simple Markdown Parser for Frontend
  function formatMarkdown(md) {
    if (!md) return '';
    let html = md;
    
    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
    
    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Lists
    html = html.replace(/^\s*[\-\*]\s+(.*$)/gim, '<li>$1</li>');
    
    // Wrap lists in ul (simple hack)
    html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
    
    // Paragraphs
    const blocks = html.split('\n\n');
    html = blocks.map(block => {
      const trimmed = block.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul') || trimmed.startsWith('<li')) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');
    
    return html;
  }

  // Get Taipei Today date string YYYY-MM-DD
  function getTaipeiTodayString() {
    const options = { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' };
    const dateParts = new Intl.DateTimeFormat('en-US', options).formatToParts(new Date());
    
    const year = dateParts.find(p => p.type === 'year').value;
    const month = dateParts.find(p => p.type === 'month').value;
    const day = dateParts.find(p => p.type === 'day').value;
    
    return `${year}-${month}-${day}`;
  }
});
