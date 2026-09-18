document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('date-select');
  const btnPrevDate = document.getElementById('btn-prev-date');
  const btnNextDate = document.getElementById('btn-next-date');
  const btnToday = document.getElementById('btn-today');
  const btnCrawl = document.getElementById('btn-crawl');
  const btnDownload = document.getElementById('btn-download');
  // removed toggle button; always show table view
  const loadingOverlay = document.getElementById('loading-overlay');

  const weekRangeLabel = document.getElementById('week-range-label');
  const weekContainer = document.getElementById('week-container');
  const rangeStart = document.getElementById('range-start');
  const rangeEnd = document.getElementById('range-end');
  const toast = document.getElementById('toast');
  const syncStatus = document.getElementById('sync-status');

  const statTotal = document.getElementById('stat-total');
  const lblUdn = document.getElementById('lbl-udn');
  const lblLtn = document.getElementById('lbl-ltn');
  const lblChinatimes = document.getElementById('lbl-chinatimes');
  const segUdn = document.querySelector('.p-udn');
  const segLtn = document.querySelector('.p-ltn');
  const segChinatimes = document.querySelector('.p-chinatimes');

  const todayStr = getTaipeiTodayString();
  let loadInProgress = false;
  // default range to today
  if (rangeStart) rangeStart.value = todayStr;
  if (rangeEnd) rangeEnd.value = todayStr;

  loadWeekData();
  loadCrawlStatus();
  window.setInterval(() => {
    loadWeekData({ silent: true });
    loadCrawlStatus();
  }, 60 * 1000);

  // always use table/list view
  let currentArticles = [];
  let selectedIds = new Set();
  let titleFilter = '';
  let sortField = 'publish_date';
  let sortDir = 'desc'; // 'asc' or 'desc'

  // range inputs trigger reload
  if (rangeStart) rangeStart.addEventListener('change', () => loadWeekData());
  if (rangeEnd) rangeEnd.addEventListener('change', () => loadWeekData());

  const titleFilterInput = document.getElementById('title-filter');
  if (titleFilterInput) {
    titleFilterInput.addEventListener('input', (e) => {
      titleFilter = (e.target.value || '').trim().toLowerCase();
      renderTableView(currentArticles);
    });
  }

  btnCrawl.addEventListener('click', async () => {
    loadingOverlay.classList.remove('hidden');

    try {
      const res = await fetch('/api/crawl', { method: 'POST' });
      const data = await res.json();

      if (data.success) {
        showToast(`爬網完成：新增 ${data.stats.newCount} 篇，跳過 ${data.stats.skippedCount} 篇`);
        loadWeekData();
      } else {
        showToast('爬網失敗：' + (data.error || data.stats?.error || '未知錯誤'));
      }
    } catch (err) {
      showToast('請求失敗：' + err.message);
    } finally {
      loadingOverlay.classList.add('hidden');
    }
  });

  btnDownload.addEventListener('click', () => {
    // if any rows selected, download selected PDF (respect selection across filters)
    const checked = Array.from(selectedIds);
    if (checked && checked.length > 0) {
      window.open(`/api/download-pdf-selected?ids=${checked.join(',')}`, '_blank');
      return;
    }

    const start = rangeStart && rangeStart.value ? rangeStart.value : null;
    const end = rangeEnd && rangeEnd.value ? rangeEnd.value : null;

    if (start && end) {
      if (start > end) {
        showToast('區間起日不可晚於迄日');
        return;
      }
      window.open(`/api/download-pdf?start=${start}&end=${end}`, '_blank');
    } else {
      showToast('請先設定下載區間或選取至少一筆文章');
    }
  });

  function updateDateButtonsState(selectedDate) {
    const selectedWeekStart = getWeekStart(selectedDate);
    const todayWeekStart = getWeekStart(getTaipeiTodayString());
    const lockForward = selectedWeekStart >= todayWeekStart;
    btnNextDate.disabled = lockForward;
    btnToday.disabled = lockForward;
  }

  async function loadWeekData({ silent = false } = {}) {
    if (loadInProgress) return;
    loadInProgress = true;
    if (!silent) {
      weekContainer.innerHTML = '<div class="empty-state glass"><div class="spinner small"></div><p>正在讀取新聞資料...</p></div>';
    }

    const start = rangeStart && rangeStart.value ? rangeStart.value : todayStr;
    const end = rangeEnd && rangeEnd.value ? rangeEnd.value : todayStr;

    if (weekRangeLabel) weekRangeLabel.innerText = `${start} - ${end}`;

    try {
      const res = await fetch(`/api/news-range?start=${start}&end=${end}`);
      const raw = await res.text();
      let payload;
      try { payload = raw ? JSON.parse(raw) : {}; } catch (parseErr) { throw new Error(`伺服器回傳不可解析內容 (status=${res.status}): ${raw}`); }
      if (!res.ok) throw new Error(payload.error || `伺服器錯誤 (status=${res.status})`);

      const allArticles = Array.isArray(payload.articles) ? payload.articles : [];
      currentArticles = allArticles;
      updateStats(allArticles);
      renderTableView(currentArticles);
    } catch (err) {
      console.error('Error loading data:', err);
      if (!silent) {
        showToast('載入失敗：' + (err.message || '請檢查伺服器連線後再試一次。'));
        weekContainer.innerHTML = `<div class="empty-state glass"><h3>載入失敗</h3><p>${err.message ? escapeHtml(err.message) : '請檢查伺服器連線後再試一次。'}</p></div>`;
      }
    } finally {
      loadInProgress = false;
    }
  }

  async function loadCrawlStatus() {
    if (!syncStatus) return;
    try {
      const res = await fetch('/api/crawl-runs?limit=1');
      const payload = await res.json();
      const run = payload.runs && payload.runs[0];
      if (!res.ok || !run) throw new Error(payload.error || '尚無執行紀錄');
      const timestamp = run.finished_at || run.started_at;
      const localTime = timestamp ? new Date(`${timestamp.replace(' ', 'T')}Z`).toLocaleString('zh-TW') : '未知';
      syncStatus.textContent = run.status === 'success'
        ? `最近更新：${localTime}・發現 ${run.discovered_count} 篇／新增 ${run.new_count} 篇`
        : `最近更新失敗：${localTime}`;
      syncStatus.dataset.state = run.status;
    } catch (_) {
      syncStatus.textContent = '尚無可用的爬蟲執行狀態';
      syncStatus.dataset.state = 'unknown';
    }
  }

  function renderTableView(articles) {
    if (!articles || articles.length === 0) {
      weekContainer.innerHTML = '<div class="empty-state glass"><p>在所選區間內沒有新聞資料。</p></div>';
      return;
    }

    // apply title filter then sorting
    let filtered = Array.isArray(articles) ? articles.slice() : [];
    if (titleFilter) {
      filtered = filtered.filter(a => (a.title || '').toLowerCase().includes(titleFilter));
    }
    let sorted = filtered;
    if (sortField) {
      sorted.sort((a, b) => {
        const va = a[sortField] || '';
        const vb = b[sortField] || '';
        const ta = Date.parse(va) || 0;
        const tb = Date.parse(vb) || 0;
        if (ta === tb) return 0;
        return sortDir === 'asc' ? ta - tb : tb - ta;
      });
    }

    const rows = sorted.map(art => {
      const title = art.title ? escapeHtml(art.title) : '（無標題）';
      const source = art.source ? escapeHtml(art.source) : '未知來源';
      const publishDate = art.publish_date ? escapeHtml(art.publish_date) : '';
      const link = art.url ? `<a href="${escapeHtml(art.url)}" target="_blank" rel="noopener noreferrer">原文</a>` : '';
      return `
        <tr>
          <td><input type="checkbox" class="row-select" data-id="${art.id}" ${selectedIds.has(String(art.id)) ? 'checked' : ''}></td>
          <td>${title}</td>
          <td>${publishDate}</td>
          <td>${source}</td>
          <td>${link}</td>
          <td><button class="btn-delete" data-id="${art.id}">刪除</button></td>
        </tr>
      `;
    }).join('');

    weekContainer.innerHTML = `
      <div class="table-view glass">
        <table class="simple-table">
          <thead><tr><th><input type="checkbox" id="select-all"></th><th>標題</th><th id="th-publish" style="cursor:pointer;">發佈日 <span id="sort-indicator">${sortField==='publish_date'?(sortDir==='asc'?'▲':'▼'):''}</span></th><th>來源</th><th>連結</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;

    // attach sort handler
    const thPublish = document.getElementById('th-publish');
    if (thPublish) {
      thPublish.addEventListener('click', () => {
        if (sortField === 'publish_date') {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortField = 'publish_date';
          sortDir = 'desc';
        }
        renderTableView(currentArticles);
      });
    }

    // update select-all handler and other bindings below

    const selectAll = document.getElementById('select-all');
    if (selectAll) {
      selectAll.addEventListener('change', (e) => {
        const checked = !!e.target.checked;
        // only affect visible row checkboxes and update selectedIds set
        document.querySelectorAll('.row-select').forEach(cb => {
          const id = cb.getAttribute('data-id');
          cb.checked = checked;
          if (checked) selectedIds.add(id);
          else selectedIds.delete(id);
        });
      });
    }

    // attach per-row checkbox listeners to track selection across filters
    document.querySelectorAll('.row-select').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-id');
        if (!id) return;
        if (e.target.checked) selectedIds.add(id);
        else selectedIds.delete(id);
      });
    });
    // reflect select-all checked state based on visible rows
    if (selectAll) {
      const visibleIds = Array.from(document.querySelectorAll('.row-select')).map(cb => cb.getAttribute('data-id'));
      const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id));
      selectAll.checked = allSelected;
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

  // card/list rendering removed — only table/list view is used now

  // Attach delete handlers after rendering
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('.btn-delete');
    if (!btn) return;

    const id = btn.getAttribute('data-id');
    if (!id) return;

    if (!confirm('確定要刪除此筆新聞？此動作無法復原。')) return;

    try {
      const res = await fetch(`/api/article/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('刪除成功');
        // Reload current view
        loadWeekData();
      } else {
        showToast('刪除失敗：' + (data.error || '未知錯誤'));
      }
    } catch (err) {
      showToast('刪除請求失敗：' + err.message);
    }
  });

  function updateStats(newsList) {
    const total = newsList.length;
    statTotal.innerText = total;

    let udn = 0;
    let ltn = 0;
    let others = 0;

    newsList.forEach(art => {
      if (art.source === '聯合報') udn += 1;
      else if (art.source === '自由時報') ltn += 1;
      else others += 1;
    });

    lblUdn.innerText = udn;
    lblLtn.innerText = ltn;
    lblChinatimes.innerText = others; // repurposed label for '其他來源'

    if (total > 0) {
      segUdn.style.width = `${(udn / total) * 100}%`;
      segLtn.style.width = `${(ltn / total) * 100}%`;
      segChinatimes.style.width = `${(others / total) * 100}%`;
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
