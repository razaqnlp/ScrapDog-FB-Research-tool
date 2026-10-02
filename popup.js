/**
 * Popup UI Logic - ScrapDog
 * Manages user interactions, settings, status synchronization,
 * and starting extraction on target post.
 */

document.addEventListener('DOMContentLoaded', async () => {
  // UI Elements
  const postUrlInput = document.getElementById('postUrl');
  const btnPaste = document.getElementById('btnPaste');
  const btnUseCurrentTab = document.getElementById('btnUseCurrentTab');
  const collectionQueryKeyInput = document.getElementById('collectionQueryKey');
  const collectionQueryValueInput = document.getElementById('collectionQueryValue');
  
  const optionsToggle = document.getElementById('optionsToggle');
  const optionsBody = document.getElementById('optionsBody');
  const chevronIcon = document.getElementById('chevronIcon');

  const historyToggle = document.getElementById('historyToggle');
  const historyBody = document.getElementById('historyBody');
  const historyChevronIcon = document.getElementById('historyChevronIcon');
  const historyContentView = document.getElementById('historyContentView');
  const historyTableBody = document.getElementById('historyTableBody');
  const historyEmptyState = document.getElementById('historyEmptyState');
  const historyCountLabel = document.getElementById('historyCountLabel');
  const btnClearHistory = document.getElementById('btnClearHistory');

  const otherFeaturesToggle = document.getElementById('otherFeaturesToggle');
  const otherFeaturesBody = document.getElementById('otherFeaturesBody');
  const otherChevronIcon = document.getElementById('otherChevronIcon');
  
  const optMaxComments = document.getElementById('optMaxComments');
  const optSpeed = document.getElementById('optSpeed');
  const chkIncludeReplies = document.getElementById('chkIncludeReplies');
  const optIncludeReplies = document.getElementById('optIncludeReplies');
  const optExpandSeeMore = document.getElementById('optExpandSeeMore');
  const optCommentFilter = document.getElementById('optCommentFilter');
  const optAutoCloseChats = document.getElementById('optAutoCloseChats');

  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');

  const statusBadge = document.getElementById('statusBadge');
  const statusLabel = document.getElementById('statusLabel');

  // App Version Element
  const appVersion = document.getElementById('appVersion');
  if (appVersion && typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
    try {
      const manifest = chrome.runtime.getManifest();
      if (manifest?.version) {
        appVersion.textContent = `Version ${manifest.version}`;
      }
    } catch (e) {}
  }

  // Options Accordion Toggle
  if (optionsToggle && optionsBody && chevronIcon) {
    optionsToggle.addEventListener('click', () => {
      optionsBody.classList.toggle('open');
      chevronIcon.classList.toggle('open');
    });
  }

  // History Accordion Toggle
  if (historyToggle && historyBody && historyChevronIcon) {
    historyToggle.addEventListener('click', () => {
      historyBody.classList.toggle('open');
      historyChevronIcon.classList.toggle('open');
      if (historyBody.classList.contains('open')) {
        loadAndRenderHistory();
      }
    });
  }

  // Other Features Accordion Toggle
  if (otherFeaturesToggle && otherFeaturesBody && otherChevronIcon) {
    otherFeaturesToggle.addEventListener('click', () => {
      otherFeaturesBody.classList.toggle('open');
      otherChevronIcon.classList.toggle('open');
    });
  }

  // =========================================================================
  // Extraction History
  // =========================================================================
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

  async function loadAndRenderHistory() {
    if (!historyBody) return;

    if (historyContentView) historyContentView.classList.remove('hidden');

    try {
      const data = await chrome.storage.local.get(['fb_extract_history']);
      let history = Array.isArray(data.fb_extract_history) ? data.fb_extract_history : [];

      const now = Date.now();
      const validHistory = history.filter(item => (now - (item.timestamp || 0)) < THIRTY_DAYS_MS);

      if (validHistory.length !== history.length) {
        history = validHistory;
        chrome.storage.local.set({ fb_extract_history: history });
      }

      if (historyCountLabel) {
        historyCountLabel.textContent = `${history.length} record${history.length === 1 ? '' : 's'} saved (30-day retention)`;
      }

      if (!historyTableBody) return;

      if (history.length === 0) {
        historyTableBody.innerHTML = '';
        if (historyEmptyState) historyEmptyState.classList.remove('hidden');
        return;
      }

      if (historyEmptyState) historyEmptyState.classList.add('hidden');

      historyTableBody.innerHTML = history.map(item => {
        const postLink = item.postUrl 
          ? `<a class="history-post-id" href="${escapeHtml(item.postUrl)}" target="_blank" title="${escapeHtml(item.postTitle || item.postUrl)}">${escapeHtml(item.postId || 'Post')}</a>`
          : `<span class="history-post-id" title="${escapeHtml(item.postTitle || '')}">${escapeHtml(item.postId || 'Post')}</span>`;

        const repliesClass = item.includeReplies === 'Yes' ? 'replies-yes' : 'replies-no';

        return `
          <tr data-id="${escapeHtml(item.id)}">
            <td>${postLink}</td>
            <td><span class="history-date">${escapeHtml(item.dateStr || 'Recent')}</span></td>
            <td><span class="history-badge sort-badge">${escapeHtml(item.sortOrder || 'All comments')}</span></td>
            <td><span class="history-badge ${repliesClass}">${escapeHtml(item.includeReplies || 'Yes')}</span></td>
            <td><span class="history-count">${escapeHtml(String(item.extractedCount || 0))}</span></td>
            <td class="history-action-cell">
              <button type="button" class="btn-table-action btn-table-download" data-id="${escapeHtml(item.id)}" title="Download CSV">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </button>
            </td>
            <td class="history-action-cell">
              <button type="button" class="btn-table-action btn-table-delete" data-id="${escapeHtml(item.id)}" title="Delete record">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  // History table action delegation (Download & Delete)
  if (historyTableBody) {
    historyTableBody.addEventListener('click', async (e) => {
      const downloadBtn = e.target.closest('.btn-table-download');
      if (downloadBtn) {
        const id = downloadBtn.getAttribute('data-id');
        try {
          const data = await chrome.storage.local.get(['fb_extract_history']);
          const list = Array.isArray(data.fb_extract_history) ? data.fb_extract_history : [];
          const item = list.find(r => r.id === id);
          if (item && item.csvData) {
            if (typeof CSVExporter !== 'undefined' && CSVExporter.downloadCSVInBrowser) {
              CSVExporter.downloadCSVInBrowser(item.csvData, item.fileName || 'comments.csv');
            } else {
              chrome.runtime.sendMessage({
                action: 'TRIGGER_DOWNLOAD',
                csvContent: item.csvData,
                fileName: item.fileName || 'comments.csv'
              }, () => {
                void chrome.runtime.lastError;
              });
            }
            const originalHTML = downloadBtn.innerHTML;
            downloadBtn.innerHTML = '✓';
            downloadBtn.style.color = '#3fb950';
            setTimeout(() => {
              downloadBtn.innerHTML = originalHTML;
              downloadBtn.style.color = '';
            }, 1400);
          }
        } catch (err) {
          console.error('Download history item error:', err);
        }
        return;
      }

      const deleteBtn = e.target.closest('.btn-table-delete');
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        try {
          const data = await chrome.storage.local.get(['fb_extract_history']);
          let list = Array.isArray(data.fb_extract_history) ? data.fb_extract_history : [];
          list = list.filter(r => r.id !== id);
          await chrome.storage.local.set({ fb_extract_history: list });
          loadAndRenderHistory();
        } catch (err) {
          console.error('Delete history item error:', err);
        }
      }
    });
  }

  // Clear all history
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to delete all saved extraction history?')) return;
      try {
        await chrome.storage.local.set({ fb_extract_history: [] });
        loadAndRenderHistory();
      } catch (err) {
        console.error('Clear history error:', err);
      }
    });
  }

  // Use Active Tab Button
  if (btnUseCurrentTab) {
    btnUseCurrentTab.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
          postUrlInput.value = tab.url;
          highlightInput();
        } else {
          alert('The active tab is not a regular web page.');
        }
      } catch (e) {
        console.error(e);
      }
    });
  }

  // Paste from Clipboard
  if (btnPaste) {
    btnPaste.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          postUrlInput.value = text.trim();
          highlightInput();
        }
      } catch (e) {
        postUrlInput.focus();
      }
    });
  }

  function highlightInput() {
    postUrlInput.classList.add('highlight');
    setTimeout(() => postUrlInput.classList.remove('highlight'), 400);
  }

  // Synchronize the checkbox under URL input with options checkbox
  if (chkIncludeReplies && optIncludeReplies) {
    chkIncludeReplies.addEventListener('change', () => {
      optIncludeReplies.checked = chkIncludeReplies.checked;
      saveOptions();
    });
    optIncludeReplies.addEventListener('change', () => {
      chkIncludeReplies.checked = optIncludeReplies.checked;
      saveOptions();
    });
  }

  function loadSavedOptions() {
    // Saved Options
    chrome.storage.sync?.get(['fb_extract_options'], (res) => {
      if (res && res.fb_extract_options) {
        const o = res.fb_extract_options;
        if (o.maxComments !== undefined && optMaxComments) {
          optMaxComments.value = o.maxComments === '100' || o.maxComments === 100 ? '0' : o.maxComments;
        }
        if (o.speed !== undefined && optSpeed) optSpeed.value = o.speed;
        if (o.includeReplies !== undefined) {
          if (optIncludeReplies) optIncludeReplies.checked = o.includeReplies;
          if (chkIncludeReplies) chkIncludeReplies.checked = o.includeReplies;
        }
        if (o.expandSeeMore !== undefined && optExpandSeeMore) optExpandSeeMore.checked = o.expandSeeMore;
        if (o.commentFilter !== undefined && optCommentFilter) {
          optCommentFilter.value = o.commentFilter;
        } else if (o.autoFilter !== undefined && optCommentFilter) {
          optCommentFilter.value = o.autoFilter ? 'all_comments' : 'most_relevant';
        }
        if (o.autoCloseChats !== undefined && optAutoCloseChats) optAutoCloseChats.checked = o.autoCloseChats;
        if (collectionQueryKeyInput) collectionQueryKeyInput.value = o.collectionQueryKey || '';
        if (collectionQueryValueInput) collectionQueryValueInput.value = o.collectionQueryValue || '';
      }
    });
  }
  loadSavedOptions();

  // Save Options Helper
  function getCollectionQuery() {
    const key = collectionQueryKeyInput?.value.trim() || '';
    const value = collectionQueryValueInput?.value.trim() || '';
    if (key && value) return `${key}: ${value}`;
    return key || value;
  }

  function saveOptions() {
    const opts = {
      maxComments: optMaxComments ? optMaxComments.value : 0,
      speed: optSpeed ? optSpeed.value : 1100,
      includeReplies: chkIncludeReplies ? chkIncludeReplies.checked : (optIncludeReplies ? optIncludeReplies.checked : true),
      expandSeeMore: optExpandSeeMore ? optExpandSeeMore.checked : true,
      commentFilter: optCommentFilter ? optCommentFilter.value : 'all_comments',
      autoFilter: optCommentFilter ? optCommentFilter.value !== 'most_relevant' : true,
      autoCloseChats: optAutoCloseChats ? optAutoCloseChats.checked : true,
      collectionQueryKey: collectionQueryKeyInput ? collectionQueryKeyInput.value.trim() : '',
      collectionQueryValue: collectionQueryValueInput ? collectionQueryValueInput.value.trim() : '',
      collectionQuery: getCollectionQuery()
    };
    chrome.storage.sync?.set({ fb_extract_options: opts });
  }

  if (optMaxComments) {
    optMaxComments.addEventListener('change', () => {
      saveOptions();
    });
  }

  [optSpeed, optExpandSeeMore, optCommentFilter, optAutoCloseChats, collectionQueryKeyInput, collectionQueryValueInput].forEach(el => {
    if (el) el.addEventListener('change', saveOptions);
  });

  // Always keep post URL box empty upon opening as requested
  if (postUrlInput) {
    postUrlInput.value = '';
  }

  // Restore State from Background (Only show active states, default to Idle on fresh open)
  chrome.storage.local.get(['fb_extract_state'], (res) => {
    if (res && res.fb_extract_state) {
      const s = res.fb_extract_state;
      const isRunning = ['LOADING_PAGE', 'EXPANDING', 'FILTERING', 'INITIALIZING', 'PARSING'].includes(s.status);
      if (isRunning) {
        renderState(s);
      } else {
        setStatus('Idle', 'status-idle');
        setUIActive(false);
      }
    } else {
      setStatus('Idle', 'status-idle');
      setUIActive(false);
    }
  });

  // Listen for Live State Changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.fb_extract_history) {
      loadAndRenderHistory();
    }
    if (area === 'local' && changes.fb_extract_state) {
      const newState = changes.fb_extract_state.newValue;
      if (newState) {
        const isRunning = ['LOADING_PAGE', 'EXPANDING', 'FILTERING', 'INITIALIZING', 'PARSING'].includes(newState.status);
        if (isRunning) {
          renderState(newState);
        } else if (newState.status === 'COMPLETED') {
          showCompletion(newState);
        } else {
          setStatus('Idle', 'status-idle');
          setUIActive(false);
        }
      }
    }
  });

  // Listen for direct runtime messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'SCRAPE_PROGRESS' && message.data) {
      updateProgressDisplay(message.data);
    } else if (message.action === 'SCRAPE_COMPLETED') {
      showCompletion(message);
    }
  });

  // Helper to compare Facebook post URLs
  function isSameFacebookUrl(url1, url2) {
    if (!url1 || !url2) return false;
    if (url1 === url2 || (url1 + '/') === url2 || url1 === (url2 + '/')) return true;
    try {
      const u1 = new URL(url1);
      const u2 = new URL(url2);
      const h1 = u1.hostname.replace(/^(www\.|m\.|web\.)/, '');
      const h2 = u2.hostname.replace(/^(www\.|m\.|web\.)/, '');
      if (h1 !== h2) return false;

      const p1 = u1.pathname.replace(/\/+$/, '');
      const p2 = u2.pathname.replace(/\/+$/, '');
      if (p1 === p2) {
        if (p1.includes('/photo')) {
          return u1.searchParams.get('fbid') === u2.searchParams.get('fbid');
        }
        return true;
      }
    } catch (e) {}
    return url1.trim().replace(/\/+$/, '') === url2.trim().replace(/\/+$/, '');
  }

  // Start Button Click
  if (btnStart) {
    btnStart.addEventListener('click', async () => {
      let url = postUrlInput.value.trim();
      if (!url) {
        alert('Add a Facebook post link to get started.');
        postUrlInput.focus();
        return;
      }

      // Ensure valid protocol so chrome.tabs never rejects the URL
      if (!/^https?:\/\//i.test(url)) {
        url = 'https://' + url;
        postUrlInput.value = url;
      }

      // Check active tab
      let activeTabId = null;
      let isSameUrl = false;
      try {
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const currentActive = tabs.find(t => t.active);

        if (currentActive && (currentActive.url.startsWith('chrome-extension://') || currentActive.url.startsWith('edge-extension://'))) {
          // If extension is opened in its own tab, find the target or active Facebook tab
          const fbTab = tabs.find(t => isSameFacebookUrl(t.url, url)) || tabs.find(t => t.url && t.url.includes('facebook.com'));
          if (fbTab) {
            activeTabId = fbTab.id;
            isSameUrl = isSameFacebookUrl(fbTab.url, url);
          }
        } else if (currentActive) {
          activeTabId = currentActive.id;
          isSameUrl = isSameFacebookUrl(currentActive.url, url);
        }
      } catch (e) {
        console.warn('Tab query note:', e);
      }

      const effectiveMax = optMaxComments ? parseInt(optMaxComments.value, 10) : 0;
      const scrapingOptions = {
        maxComments: effectiveMax,
        delayMs: optSpeed ? parseInt(optSpeed.value, 10) : 1100,
        includeReplies: chkIncludeReplies ? chkIncludeReplies.checked : (optIncludeReplies ? optIncludeReplies.checked : true),
        expandSeeMore: optExpandSeeMore ? optExpandSeeMore.checked : true,
        commentFilter: optCommentFilter ? optCommentFilter.value : 'all_comments',
        autoSwitchFilter: optCommentFilter ? optCommentFilter.value !== 'most_relevant' : true,
        autoCloseChats: optAutoCloseChats ? optAutoCloseChats.checked : true,
        collectionQuery: getCollectionQuery()
      };

      setUIActive(true);

      chrome.runtime.sendMessage({
        action: 'START_JOB',
        payload: {
          url,
          options: scrapingOptions,
          tabId: activeTabId,
          useCurrentTab: isSameUrl
        }
      }, (response) => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr || (response && !response.success)) {
          const err = lastErr ? lastErr.message : response?.error;
          setStatus('Error', 'status-error');
          alert('Could not start scraping: ' + (err || 'Unknown error'));
          setUIActive(false);
        } else {
          // If we are on the same page, close the extension popup/tab so user sees the in-page overlay directly!
          if (isSameUrl) {
            if (activeTabId) {
              chrome.tabs.update(activeTabId, { active: true }, () => {
                void chrome.runtime.lastError;
              });
            }
            setTimeout(() => {
              window.close();
            }, 250);
          }
        }
      });
    });
  }

  // Stop Button Click
  if (btnStop) {
    btnStop.addEventListener('click', () => {
      btnStop.textContent = 'Stopping collection...';
      btnStop.disabled = true;
      chrome.runtime.sendMessage({ action: 'STOP_JOB' }, () => {
        void chrome.runtime.lastError;
        btnStop.textContent = 'Stop and keep results';
        btnStop.disabled = false;
        setUIActive(false);
      });
    });
  }

  // Render Full State Object
  function renderState(state) {
    if (!state) return;

    const isRunning = ['LOADING_PAGE', 'EXPANDING', 'FILTERING', 'INITIALIZING', 'PARSING'].includes(state.status);
    setUIActive(isRunning);

    if (isRunning) {
      setStatus('Scraping', 'status-active');
    } else if (state.status === 'COMPLETED') {
      setStatus('Completed', 'status-active');
    } else if (state.status === 'STOPPED') {
      setStatus('Stopped', 'status-warn');
    } else if (state.status === 'ERROR') {
      setStatus('Error', 'status-error');
    } else {
      setStatus('Idle', 'status-idle');
    }
  }

  // Update Progress Display
  function updateProgressDisplay(data) {
    if (data.status) {
      const isRunning = ['LOADING_PAGE', 'EXPANDING', 'FILTERING', 'INITIALIZING', 'PARSING'].includes(data.status);
      setUIActive(isRunning);
      if (isRunning) setStatus('Scraping', 'status-active');
    }
  }

  // Show Completion Banner
  function showCompletion() {
    setUIActive(false);
    setStatus('Completed', 'status-active');
  }

  // UI Active State Toggle
  function setUIActive(active) {
    if (!btnStart || !btnStop) return;
    if (active) {
      btnStart.classList.add('hidden');
      btnStop.classList.remove('hidden');
    } else {
      btnStart.classList.remove('hidden');
      btnStop.classList.add('hidden');
    }
  }

  // Set Status Badge
  function setStatus(text, className) {
    if (!statusLabel || !statusBadge) return;
    statusLabel.textContent = text;
    statusBadge.className = `status-indicator ${className}`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // =========================================================================
  // Canvas Confetti Engine (Self-contained, CSP & MV3 compliant)
  // =========================================================================
  function launchConfetti(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width = canvas.parentElement.offsetWidth || 350;
    const height = canvas.height = canvas.parentElement.offsetHeight || 250;

    const colors = ['#f59e0b', '#388bfd', '#2ea043', '#f85149', '#a855f7', '#ec4899', '#fef08a'];
    const particles = [];
    const count = 70;

    for (let i = 0; i < count; i++) {
      particles.push({
        x: width / 2 + (Math.random() - 0.5) * 60,
        y: height / 2,
        w: Math.random() * 8 + 4,
        h: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 12,
        vy: -Math.random() * 9 - 3,
        rotation: Math.random() * 360,
        vRot: (Math.random() - 0.5) * 15,
        opacity: 1,
        gravity: 0.26,
        drag: 0.98
      });
    }

    let animFrame = null;
    const startTime = Date.now();

    function render() {
      ctx.clearRect(0, 0, width, height);
      let alive = false;

      for (const p of particles) {
        p.vy += p.gravity;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vRot;

        if (Date.now() - startTime > 1600) {
          p.opacity -= 0.025;
        }

        if (p.opacity > 0 && p.y < height + 20) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = Math.max(0, p.opacity);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }

      if (alive) {
        animFrame = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, width, height);
        cancelAnimationFrame(animFrame);
      }
    }
    render();
  }

  // =========================================================================
  // RFC-4180 CSV Parser (Handles quoted fields, newlines, and escaping)
  // =========================================================================
  function parseCSVText(csvText) {
    if (!csvText) return [];
    const cleanText = csvText.replace(/^\uFEFF/, '');
    const rows = [];
    let currentRow = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < cleanText.length; i++) {
      const char = cleanText[i];
      const nextChar = cleanText[i + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          currentField += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if ((char === '\r' || char === '\n') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') i++;
        currentRow.push(currentField.trim());
        if (currentRow.some(cell => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
    if (currentField.length > 0 || currentRow.length > 0) {
      currentRow.push(currentField.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
    }

    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const comments = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = row[idx] || '';
      });

      const authorName = obj['accountname'] || obj['authorname'] || obj['author'] || obj['name'] || 'Facebook User';
      const commentText = obj['commenttext'] || obj['comment'] || obj['text'] || '';
      const authorProfileUrl = obj['profileurl'] || obj['authorprofileurl'] || '';
      const userId = obj['userid'] || '';
      const id = obj['commentid'] || obj['id'] || `row_${i}`;
      const formattedTime = obj['datetime'] || obj['timestamp'] || '';
      const isReply = (obj['commentlevel'] === '2' || obj['isreply'] === 'true' || obj['parentid'] ? true : false);

      comments.push({
        id,
        authorName,
        commentText,
        authorProfileUrl,
        userId,
        formattedTime,
        isReply
      });
    }

    return comments;
  }

  // Initialize Modules
});
