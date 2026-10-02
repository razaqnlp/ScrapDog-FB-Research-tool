/**
 * Background Service Worker - ScrapDog
 * Coordinates tab loading, content script injection, message routing,
 * state persistence in chrome.storage.local, and automatic CSV download.
 */

// Import CSV exporter logic inside service worker
importScripts('csv_exporter.js');

const STATE_KEY = 'fb_extract_state';
const HISTORY_KEY = 'fb_extract_history';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const defaultState = {
  activeTabId: null,
  postUrl: '',
  jobOptions: null,
  status: 'IDLE', // IDLE, LOADING_PAGE, SCRAPING, PAUSED, COMPLETED, STOPPED, ERROR
  statusMessage: 'Ready',
  totalCount: 0,
  topLevelCount: 0,
  replyCount: 0,
  elapsedSeconds: 0,
  recentComments: [],
  lastCsvData: null,
  lastFileName: null
};

// Update and persist state
async function updateState(patch) {
  try {
    const data = await chrome.storage.local.get(STATE_KEY);
    const current = data[STATE_KEY] || defaultState;
    const next = { ...current, ...patch };
    await chrome.storage.local.set({ [STATE_KEY]: next });
    return next;
  } catch (e) {
    console.error('Failed to update state:', e);
  }
}

// Reset state
async function resetState() {
  await chrome.storage.local.set({ [STATE_KEY]: defaultState });
}

// Listener for messages from popup or content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'START_JOB':
      handleStartJob(message.payload)
        .then(res => sendResponse({ success: true, ...res }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SCRAPE_PROGRESS':
      handleScrapeProgress(message.data, sender);
      sendResponse({ received: true });
      break;

    case 'SCRAPE_COMPLETED':
      handleScrapeCompleted(message, sender)
        .then(res => sendResponse({ success: true, ...res }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'STOP_JOB':
      handleStopJob()
        .then(res => sendResponse({ success: true, ...res }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'DOWNLOAD_LAST_CSV':
      handleDownloadLastCSV()
        .then(res => sendResponse({ success: true, ...res }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'TRIGGER_DOWNLOAD':
      triggerDownload(message.csvContent, message.fileName)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
  }
});

/**
 * Handle job start request from Popup UI
 */
async function handleStartJob({ url, options, tabId = null, useCurrentTab = false }) {
  options = options || {};

  let targetTabId = null;

  let targetUrl = (url || '').trim();
  if (targetUrl && !/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  await updateState({
    status: 'LOADING_PAGE',
    statusMessage: 'Opening and loading target post...',
    postUrl: targetUrl,
    jobOptions: options,
    totalCount: 0,
    topLevelCount: 0,
    replyCount: 0,
    elapsedSeconds: 0,
    recentComments: [],
    lastCsvData: null
  });

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

  // 1. If tabId provided by popup, check if we can reuse or update it
  if (tabId) {
    try {
      const existingTab = await chrome.tabs.get(tabId);
      if (existingTab && !existingTab.url.startsWith('chrome://') && !existingTab.url.startsWith('edge://')) {
        targetTabId = tabId;
        // If URLs differ, navigate this tab to target URL
        if (!isSameFacebookUrl(existingTab.url, targetUrl)) {
          await chrome.tabs.update(targetTabId, { url: targetUrl, active: true });
          await waitForTabComplete(targetTabId);
        }
      }
    } catch (e) {
      targetTabId = null;
    }
  }

  // 2. If no reusable tab, open a new active tab with the target URL
  if (!targetTabId) {
    const newTab = await chrome.tabs.create({ url: targetUrl, active: true });
    targetTabId = newTab.id;
    await waitForTabComplete(targetTabId);
  }

  await updateState({ activeTabId: targetTabId });

  // Check if content script is already active in the tab via script execution (avoids unhandled PING port errors)
  let isAlreadyActive = false;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: targetTabId },
      func: () => Boolean(window.__FB_EXTRACT_SCRAPER_LOADED__)
    });
    isAlreadyActive = Boolean(results?.[0]?.result);
  } catch (e) {
    isAlreadyActive = false;
  }

  // Only inject if not already present
  if (!isAlreadyActive) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: targetTabId },
        files: ['csv_exporter.js', 'content_script.js']
      });
      await new Promise(r => setTimeout(r, 600));
    } catch (err) {
      console.warn('Script injection notice:', err.message);
    }
  } else {
    await new Promise(r => setTimeout(r, 150));
  }

  // Send START_SCRAPING to the tab with automatic retry if content script is still settling
  return new Promise((resolve, reject) => {
    function trySend(attemptsLeft) {
      chrome.tabs.sendMessage(targetTabId, { action: 'START_SCRAPING', options }, response => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) {
          const errMsg = lastErr.message;
          if (attemptsLeft > 0) {
            setTimeout(() => trySend(attemptsLeft - 1), 600);
          } else {
            reject(new Error(errMsg));
          }
        } else {
          resolve(response || { started: true });
        }
      });
    }
    trySend(3);
  });
}

/**
 * Wait until a tab reaches complete status
 */
async function waitForTabComplete(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab && tab.status === 'complete') {
      return; // Already completed, no need to hang
    }
  } catch (e) {}

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(); // Proceed anyway after timeout
    }, 12000);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Handle live progress updates from content script
 */
async function handleScrapeProgress(data, sender) {
  await updateState({
    status: data.status,
    statusMessage: data.statusMessage,
    totalCount: data.totalCount,
    topLevelCount: data.topLevelCount,
    replyCount: data.replyCount,
    elapsedSeconds: data.elapsedSeconds,
    recentComments: data.recentComments || []
  });
}

/**
 * Handle completion of scraping, generating CSV without automatic download
 */
async function handleScrapeCompleted({ comments, postTitle, postUrl }, sender) {
  const currentState = await chrome.storage.local.get(STATE_KEY);
  const activeOpts = currentState[STATE_KEY]?.jobOptions || {};
  const csvString = await CSVExporter.generateCSV(comments, null, activeOpts);
  const fileName = CSVExporter.generateFileName(postTitle || 'facebook');

  await updateState({
    status: 'COMPLETED',
    statusMessage: `Collected ${comments.length} comments. Your CSV is ready to download.`,
    totalCount: comments.length,
    lastCsvData: csvString,
    lastFileName: fileName
  });

  // Persist completed job to history

  try {
    await saveJobToHistory({
      postUrl: postUrl || currentState[STATE_KEY]?.postUrl,
      postTitle: postTitle || 'Facebook Post',
      commentsCount: comments.length,
      csvString,
      fileName,
      options: activeOpts
    });
  } catch (e) {
    console.warn('History save note:', e);
  }

  // Do NOT auto-download. The user will be asked to download via overlay or popup button.
  return { fileName, count: comments.length, csvString };
}

/**
 * Stop running scraping job without automatic download
 */
async function handleStopJob() {
  const data = await chrome.storage.local.get(STATE_KEY);
  const state = data[STATE_KEY];
  if (state && state.activeTabId) {
    try {
      chrome.tabs.sendMessage(state.activeTabId, { action: 'STOP_SCRAPING' }, async response => {
        const lastErr = chrome.runtime.lastError;
        if (lastErr) return;
        if (response && response.comments) {
          const csvString = await CSVExporter.generateCSV(response.comments, null, state.jobOptions || {});
          const fileName = CSVExporter.generateFileName('stopped_export');
          await updateState({
            status: 'STOPPED',
            statusMessage: `Stopped by user. Extracted ${response.comments.length} comments.`,
            totalCount: response.comments.length,
            lastCsvData: csvString,
            lastFileName: fileName
          });

          // Persist stopped job to history
          try {
            await saveJobToHistory({
              postUrl: state.postUrl,
              postTitle: 'Stopped Extraction',
              commentsCount: response.comments.length,
              csvString,
              fileName,
              options: state.jobOptions || {}
            });
          } catch (e) {}
          // Do not auto-download
        }
      });
    } catch (e) {}
  }
}

/**
 * Download the last generated CSV again
 */
async function handleDownloadLastCSV() {
  const data = await chrome.storage.local.get(STATE_KEY);
  const state = data[STATE_KEY];
  if (state && state.lastCsvData) {
    await triggerDownload(state.lastCsvData, state.lastFileName || 'comments_export.csv');
    return { success: true };
  }
  throw new Error('No CSV data available to download.');
}

/**
 * Extract clean Post ID from various Facebook post URL patterns
 */
function extractPostId(url) {
  if (!url) return 'N/A';
  try {
    const u = new URL(url);
    if (u.searchParams.has('story_fbid')) return u.searchParams.get('story_fbid');
    if (u.searchParams.has('fbid')) return u.searchParams.get('fbid');
    if (u.searchParams.has('v')) return u.searchParams.get('v');

    const path = u.pathname.replace(/\/+$/, '');
    const segments = path.split('/').filter(Boolean);
    for (let i = 0; i < segments.length - 1; i++) {
      if (['posts', 'videos', 'reel', 'photos', 'permalink'].includes(segments[i].toLowerCase())) {
        return segments[i + 1];
      }
    }
    const last = segments[segments.length - 1];
    if (last && /^[0-9]+$/.test(last)) return last;
    if (last && last.length > 5 && !['php', 'index', 'watch'].includes(last)) return last.slice(0, 16);
  } catch (e) {}
  const numMatch = url.match(/[0-9]{8,25}/);
  if (numMatch) return numMatch[0];
  return 'Post';
}

/**
 * Save completed or stopped scraping job to Pro history (prunes entries older than 30 days)
 */
async function saveJobToHistory({ postUrl, postTitle, commentsCount, csvString, fileName, options }) {
  if (!csvString || !commentsCount || commentsCount <= 0) return;
  try {
    const data = await chrome.storage.local.get(HISTORY_KEY);
    let history = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];

    const now = Date.now();
    // 30-day auto-pruning
    history = history.filter(item => (now - (item.timestamp || 0)) < THIRTY_DAYS_MS);

    const nowObj = new Date(now);
    const dateStr = nowObj.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const postId = extractPostId(postUrl);
    let sortOrder = 'All comments';
    if (options && options.commentFilter === 'newest') {
      sortOrder = 'Newest';
    } else if (options && options.commentFilter === 'most_relevant') {
      sortOrder = 'Most relevant';
    } else if (options && options.autoSwitchFilter === false) {
      sortOrder = 'Most relevant';
    }
    const includeReplies = (options && options.includeReplies === false) ? 'No' : 'Yes';

    const newRecord = {
      id: 'job_' + now + '_' + Math.random().toString(36).slice(2, 7),
      timestamp: now,
      dateStr: dateStr,
      postId: postId,
      postUrl: postUrl || '',
      postTitle: postTitle || 'Facebook Post',
      sortOrder: sortOrder,
      includeReplies: includeReplies,
      extractedCount: commentsCount,
      csvData: csvString,
      fileName: fileName || 'comments.csv'
    };

    history.unshift(newRecord);

    if (history.length > 50) {
      history = history.slice(0, 50);
    }

    await chrome.storage.local.set({ [HISTORY_KEY]: history });
  } catch (err) {
    console.warn('Failed to save extraction history:', err);
  }
}

/**
 * Helper to trigger browser download from a string
 */
async function triggerDownload(csvContent, filename) {
  try {
    const base64Data = btoa(unescape(encodeURIComponent(csvContent)));
    const dataUrl = `data:text/csv;charset=utf-8;base64,${base64Data}`;

    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    });
  } catch (err) {
    console.error('Download failed via chrome.downloads:', err);
  }
}


