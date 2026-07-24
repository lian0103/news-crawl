document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('date-select');
  const btnPrevDate = document.getElementById('btn-prev-date');
  const btnNextDate = document.getElementById('btn-next-date');
  const btnToday = document.getElementById('btn-today');
  const btnCrawl = document.getElementById('btn-crawl');
  const btnDownload = document.getElementById('btn-download');
  const loadingOverlay = document.getElementById('loading-overlay');

  const weekRangeLabel = document.getElementById('week-range-label');
  const weekContainer = document.getElementById('week-container');
  const rangeStart = document.getElementById('range-start');
  const rangeEnd = document.getElementById('range-end');
  const toast = document.getElementById('toast');

  const statTotal = document.getElementById('stat-total');
  const lblUdn = document.getElementById('lbl-udn');
  const lblLtn = document.getElementById('lbl-ltn');
  const lblChinatimes = document.getElementById('lbl-chinatimes');
  const segUdn = document.querySelector('.p-udn');
  const segLtn = document.querySelector('.p-ltn');
  const segChinatimes = document.querySelector('.p-chinatimes');

  const todayStr = getTaipeiTodayString();
  dateInput.value = todayStr;
  dateInput.max = todayStr;

  loadWeekData(todayStr);

  dateInput.addEventListener('change', (e) => {
    loadWeekData(e.target.value);
  });

  btnPrevDate.addEventListener('click', () => {
    const newDate = shiftDate(dateInput.value, -7);
    dateInput.value = newDate;
    loadWeekData(newDate);
  });

  btnNextDate.addEventListener('click', () => {
    const newDate = shiftDate(dateInput.value, 7);
    if (newDate <= getTaipeiTodayString()) {
      dateInput.value = newDate;
      loadWeekData(newDate);
    }
  });

  btnToday.addEventListener('click', () => {
    const today = getTaipeiTodayString();
    dateInput.value = today;
    loadWeekData(today);
  });

  btnCrawl.addEventListener('click', async () => {
    loadingOverlay.classList.remove('hidden');

    try {
      const res = await fetch('/api/crawl', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        showToast(`爬網完成：新增 ${data.stats.newCount} 篇，跳過 ${data.stats.skippedCount} 篇`);
        loadWeekData(dateInput.value);
      } else {
        showToast('爬網失敗：' + (data.error || '未知錯誤'));
      }
    } catch (err) {
      showToast('請求失敗：' + err.message);
    } finally {
      loadingOverlay.classList.add('hidden');
    }
  });

  btnDownload.addEventListener('click', () => {
    const start = rangeStart && rangeStart.value ? rangeStart.value : null;
    const end = rangeEnd && rangeEnd.value ? rangeEnd.value : null;

    if (start && end) {
      // basic validation
      if (start > end) {
        showToast('區間起日不可晚於迄日');
        return;
      }
      window.open(`/api/download-pdf?start=${start}&end=${end}`, '_blank');
    } else {
      const date = dateInput.value;
      window.open(`/api/download-pdf?date=${date}`, '_blank');
    }
  });

  function updateDateButtonsState(selectedDate) {
    const selectedWeekStart = getWeekStart(selectedDate);
    const todayWeekStart = getWeekStart(getTaipeiTodayString());
    const lockForward = selectedWeekStart >= todayWeekStart;
    btnNextDate.disabled = lockForward;
    btnToday.disabled = lockForward;
  }

  async function loadWeekData(anchorDate) {
    updateDateButtonsState(anchorDate);

    const weekDates = getWeekDates(anchorDate);
    weekRangeLabel.innerText = `${formatDateLabel(weekDates[0])} - ${formatDateLabel(weekDates[6])}`;
    // Update range inputs to match current week selection
    if (rangeStart) rangeStart.value = weekDates[0];
    if (rangeEnd) rangeEnd.value = weekDates[6];
    weekContainer.innerHTML = '<div class="empty-state glass"><div class="spinner small"></div><p>正在讀取本週新聞資料...</p></div>';

    try {
      // Use the new range API to fetch all 7 days in one request
      const res = await fetch(`/api/news-range?start=${weekDates[0]}&end=${weekDates[6]}`);

      // Read raw text first to avoid json parse errors when server returns HTML/error pages
      const raw = await res.text();
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch (parseErr) {
        throw new Error(`伺服器回傳不可解析內容 (status=${res.status}): ${raw}`);
      }

      if (!res.ok) {
        throw new Error(payload.error || `伺服器錯誤 (status=${res.status})`);
      }

      const allArticles = Array.isArray(payload.articles) ? payload.articles : [];

      // Group articles by publish_date to build dailyData for rendering
      const dailyData = weekDates.map(date => {
        const records = allArticles.filter(a => a.publish_date === date);
        return { date, articles: records };
      });

      const weeklyArticles = dailyData.flatMap(day => day.articles);
      updateStats(weeklyArticles);
      renderWeekBlocks(dailyData);
    } catch (err) {
      console.error('Error loading weekly data:', err);
      showToast('載入失敗：' + (err.message || '請檢查伺服器連線後再試一次。'));
      weekContainer.innerHTML = `<div class="empty-state glass"><h3>載入失敗</h3><p>${err.message ? escapeHtml(err.message) : '請檢查伺服器連線後再試一次。'}</p></div>`;
    }
  }

  // Simple HTML escape for embedding server messages into the UI
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderWeekBlocks(dailyData) {
    weekContainer.innerHTML = dailyData.map(day => renderDayCard(day)).join('');

    document.querySelectorAll('.btn-toggle-text').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-id');
        const contentBox = document.getElementById(`content-${id}`);
        if (!contentBox) return;

        if (contentBox.classList.contains('expanded')) {
          contentBox.classList.remove('expanded');
          e.target.innerText = '展開全文';
        } else {
          contentBox.classList.add('expanded');
          e.target.innerText = '收合全文';
        }
      });
    });
  }

  function renderDayCard(dayData) {
    const dayLabel = getWeekdayName(dayData.date);
    const articles = dayData.articles;

    const articlesMarkup = articles.length
      ? articles.map(renderNewsItem).join('')
      : '<div class="day-empty">本日沒有爬取到新聞資料</div>';

    return `
      <section class="day-card glass">
        <header class="day-header">
          <div>
            <h3>${formatDateLabel(dayData.date)} <span>${dayLabel}</span></h3>
            <p>${articles.length} 篇新聞</p>
          </div>
        </header>
        <div class="day-articles">${articlesMarkup}</div>
      </section>
    `;
  }

  function renderNewsItem(art) {
    const sourceClass = art.source === '聯合報'
      ? 'udn'
      : (art.source === '自由時報' ? 'ltn' : 'chinatimes');

    const keywordsArray = art.keywords
      ? art.keywords.split(',').map(k => k.trim()).filter(Boolean)
      : [];

    const content = art.content || '';
    const snippet = content.slice(0, 120);

    return `
      <article class="news-card">
        <div class="news-header">
          <span class="news-source ${sourceClass}">${art.source || '未知來源'}</span>
          <span class="news-time">${art.publish_date || ''}</span>
        </div>

        <h4>${art.title || '（無標題）'}</h4>

        <p class="news-snippet">${snippet || '（無內文）'}${snippet.length >= 120 ? '...' : ''}</p>

        <div class="news-original-box">
          <div class="news-original collapsible" id="content-${art.id}">
            ${content ? content.replace(/\n/g, '<br>') : '（無內文）'}
          </div>
          <button class="btn-toggle-text" data-id="${art.id}">展開全文</button>
        </div>

        <div class="news-footer">
          <div class="news-tags">
            ${keywordsArray.map(tag => `<span class="news-tag">#${tag}</span>`).join('')}
          </div>
          <div class="news-link">
            <a href="${art.url}" target="_blank" rel="noopener noreferrer">看原文 ↗</a>
          </div>
        </div>
      </article>
    `;
  }

  function updateStats(newsList) {
    const total = newsList.length;
    statTotal.innerText = total;

    let udn = 0;
    let ltn = 0;
    let chinatimes = 0;

    newsList.forEach(art => {
      if (art.source === '聯合報') udn += 1;
      else if (art.source === '自由時報') ltn += 1;
      else if (art.source === '中國時報') chinatimes += 1;
    });

    lblUdn.innerText = udn;
    lblLtn.innerText = ltn;
    lblChinatimes.innerText = chinatimes;

    if (total > 0) {
      segUdn.style.width = `${(udn / total) * 100}%`;
      segLtn.style.width = `${(ltn / total) * 100}%`;
      segChinatimes.style.width = `${(chinatimes / total) * 100}%`;
    } else {
      segUdn.style.width = '0%';
      segLtn.style.width = '0%';
      segChinatimes.style.width = '0%';
    }

  }

  function getWeekStart(dateStr) {
    const date = parseDate(dateStr);
    const day = date.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + offset);
    return toDateString(date);
  }

  function getWeekDates(anchorDate) {
    const monday = parseDate(getWeekStart(anchorDate));
    const dates = [];

    for (let i = 0; i < 7; i += 1) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      dates.push(toDateString(date));
    }

    return dates;
  }

  function shiftDate(dateStr, days) {
    const dateObj = parseDate(dateStr);
    dateObj.setDate(dateObj.getDate() + days);
    return toDateString(dateObj);
  }

  function parseDate(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }

  function toDateString(dateObj) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatDateLabel(dateStr) {
    const [year, month, day] = dateStr.split('-');
    return `${year}/${month}/${day}`;
  }

  function getWeekdayName(dateStr) {
    const names = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    return names[parseDate(dateStr).getDay()];
  }

  function getTaipeiTodayString() {
    const options = {
      timeZone: 'Asia/Taipei',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    };

    const dateParts = new Intl.DateTimeFormat('en-US', options).formatToParts(new Date());

    const year = dateParts.find(p => p.type === 'year').value;
    const month = dateParts.find(p => p.type === 'month').value;
    const day = dateParts.find(p => p.type === 'day').value;

    return `${year}-${month}-${day}`;
  }

  // Simple toast helper
  let _toastTimer = null;
  function showToast(message, ms = 4000) {
    if (!toast) return;
    toast.innerText = message;
    toast.classList.remove('hidden');
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => {
      toast.classList.add('hidden');
      _toastTimer = null;
    }, ms);
  }
});
