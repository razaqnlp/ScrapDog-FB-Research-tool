/**
 * Content Script - Post Comment Scraper
 * Extracts comments from Facebook and generic web posts.
 * Handles:
 *  - Switching "Most relevant" to "All comments"
 *  - Unfolding "View more comments" / "View previous comments"
 *  - Unfolding "View X replies"
 *  - Expanding truncated "See more" comment text
 *  - Real-time progress broadcasting
 *  - Graceful stop / pause / resume
 */

(function () {
  // Prevent multiple injections
  if (window.__FB_EXTRACT_SCRAPER_LOADED__) {
    return;
  }
  window.__FB_EXTRACT_SCRAPER_LOADED__ = true;

  class InPageOverlay {
    constructor(options = {}) {
      this.options = options;
      this.host = null;
      this.shadow = null;
      this.csvData = null;
      this.fileName = null;
    }

    formatStatus(status) {
      const labels = {
        IDLE: 'Ready',
        LOADING_PAGE: 'Opening post',
        INITIALIZING: 'Getting ready',
        FILTERING: 'Setting comment order',
        EXPANDING: 'Loading comments',
        PARSING: 'Collecting comments',
        SCRAPING: 'Collecting comments',
        PAUSED: 'Paused',
        COMPLETED: 'Complete',
        STOPPED: 'Stopped',
        ERROR: 'Something went wrong'
      };
      return labels[status] || String(status || '').replace(/_/g, ' ').toLowerCase();
    }

    updateStatus(status, message) {
      if (!this.shadow) return;
      const hudStatus = this.shadow.getElementById('hudStatus');
      const hudMessage = this.shadow.getElementById('hudMessage');
      if (hudStatus && status) hudStatus.textContent = this.formatStatus(status);
      if (hudMessage && message) hudMessage.textContent = message;
    }

    mount() {
      const existing = document.getElementById('fbeasy-overlay-root') || document.getElementById('fbextract-overlay-root');
      if (existing) {
        try { existing.remove(); } catch (e) {}
      }

      this.host = document.createElement('div');
      this.host.id = 'fbeasy-overlay-root';
      this.host.style.position = 'fixed';
      this.host.style.top = '20px';
      this.host.style.right = '20px';
      this.host.style.zIndex = '2147483647';
      this.host.style.display = 'block';
      this.host.style.visibility = 'visible';
      this.host.style.pointerEvents = 'auto';
      this.host.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = `
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          .hud-card {
            width: 340px;
            max-width: calc(100vw - 32px);
            max-height: calc(100vh - 40px);
            overflow: hidden;
            background: #fffaf2;
            color: #18314f;
            border: 1px solid rgba(24, 49, 79, 0.12);
            border-radius: 12px;
            box-shadow: 0 12px 30px rgba(61, 42, 18, 0.14);
            transition: all 0.2s ease;
          }
          .hud-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            background: #edf4ef;
            border-bottom: 1px solid #d6e2da;
          }
          .hud-title-wrap {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .hud-logo {
            width: 24px;
            height: 24px;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: transparent;
            overflow: hidden;
          }
          .hud-logo img {
            width: 24px;
            height: 24px;
            display: block;
            object-fit: contain;
          }
          .hud-title {
            font-size: 12px;
            font-weight: 700;
            color: #18314f;
          }
          .hud-controls {
            display: flex;
            align-items: center;
            gap: 4px;
          }
          .hud-btn-icon {
            background: transparent;
            border: none;
            color: #60766d;
            cursor: pointer;
            font-size: 14px;
            width: 22px;
            height: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 6px;
          }
          .hud-btn-icon:hover {
            color: #183c36;
            background: #dce9e1;
          }
          .hud-body {
            padding: 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .status-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 11px;
          }
          .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #e5f2eb;
            color: #216b48;
            padding: 3px 8px;
            border-radius: 999px;
            font-weight: 600;
          }
          .status-badge[data-status="paused"],
          .status-badge[data-status="loading_page"],
          .status-badge[data-status="initializing"],
          .status-badge[data-status="filtering"] {
            background: #fff3df;
            color: #925710;
          }
          .status-badge[data-status="error"] {
            background: #fff0ee;
            color: #a83b31;
          }
          .status-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: #3fb950;
            box-shadow: 0 0 6px #3fb950;
            animation: pulse 1.8s infinite;
          }
          @keyframes pulse {
            0%, 100% { opacity: 0.8; transform: scale(0.95); }
            50% { opacity: 1; transform: scale(1.25); }
          }
          .timer-badge {
            font-family: monospace;
            color: #49615c;
            background: #f8fbf8;
            padding: 2px 6px;
            border-radius: 6px;
            border: 1px solid #d6e2da;
          }
          .progress-bar-wrap {
            width: 100%;
            height: 6px;
            background: #dce9e1;
            border-radius: 3px;
            overflow: hidden;
          }
          .progress-bar {
            height: 100%;
            width: 100%;
            background: linear-gradient(90deg, #168176, #63a77a, #168176);
            background-size: 200% 100%;
            animation: indeterminate 2s linear infinite;
          }
          @keyframes indeterminate {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
          .status-text {
            font-size: 12px;
            color: #49615c;
            line-height: 1.3;
          }
          .metrics-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
          }
          .metric-box {
            background: #f1f6f2;
            border: 1px solid #d8e4dc;
            border-radius: 8px;
            padding: 7px 6px;
            text-align: center;
          }
          .metric-val {
            font-size: 16px;
            font-weight: 700;
            color: #183c36;
          }
          .metric-lbl {
            font-size: 9px;
            color: #71827c;
            text-transform: uppercase;
          }
          .btn-stop {
            background: #fff0ee;
            border: 1px solid #efc2bc;
            color: #a83b31;
            padding: 7px 10px;
            border-radius: 8px;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.15s;
          }
          .btn-stop:hover {
            background: #bd4a3d;
            color: #fff;
          }
          /* Completed View */
          .completed-view {
            display: none;
            flex-direction: column;
            gap: 12px;
            text-align: center;
            padding: 6px 0;
          }
          .success-heading {
            font-size: 14px;
            font-weight: 700;
            color: #216b48;
            line-height: 1.3;
          }
          .success-sub {
            font-size: 12px;
            color: #62766e;
          }
          .btn-download {
            background: linear-gradient(135deg, #168176, #116b62);
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 10px 16px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 3px 10px rgba(22, 129, 118, 0.22);
            transition: all 0.15s;
          }
          .btn-download:hover {
            background: linear-gradient(135deg, #1b9083, #14776e);
            box-shadow: 0 5px 14px rgba(22, 129, 118, 0.28);
          }
          .hud-view-panel {
            display: none;
            flex-direction: column;
            gap: 8px;
          }
          .btn-hud-subtle {
            background: #f1f6f2;
            border: 1px solid #d5e0da;
            color: #49615c;
            padding: 6px 10px;
            border-radius: 5px;
            font-size: 11px;
            cursor: pointer;
            text-align: center;
            transition: all 0.15s;
          }
          .btn-hud-subtle:hover {
            background: #e4ede8;
            color: #183c36;
          }
          .btn-dismiss {
            background: transparent;
            border: 1px solid #d5e0da;
            color: #62766e;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 11px;
            cursor: pointer;
          }
          .btn-dismiss:hover {
            background: #edf4ef;
            color: #183c36;
          }
          .hud-card.minimized .hud-body {
            display: none;
          }
        </style>
        <div class="hud-card" id="hudCard">
          <div class="hud-header">
            <div class="hud-title-wrap">
              <div class="hud-logo">
                <img id="hudLogoImage" src="${chrome.runtime.getURL('icons/ScrapDog logo.png')}" alt="ScrapDog logo">
              </div>
              <span class="hud-title">ScrapDog</span>
            </div>
            <div class="hud-controls">
              <button class="hud-btn-icon" id="hudMinBtn" title="Minimize or expand overlay" aria-label="Minimize or expand overlay">−</button>
              <button class="hud-btn-icon" id="hudCloseBtn" title="Close overlay" aria-label="Close overlay">×</button>
            </div>
          </div>

          <div class="hud-body">
            <!-- Active Scraping View -->
            <div id="hudActiveView" style="display: flex; flex-direction: column; gap: 10px;">
              <div class="status-row">
                <span class="status-badge" id="hudBadge">
                  <span class="status-dot"></span>
                  <span id="hudStatus">Getting ready</span>
                </span>
                <span class="timer-badge" id="hudTimer">00:00</span>
              </div>

              <div class="progress-bar-wrap">
                <div class="progress-bar"></div>
              </div>

              <div class="status-text" id="hudMessage">
                Preparing to collect comments...
              </div>

              <div class="metrics-row">
                <div class="metric-box">
                  <div class="metric-val" id="hudTotal">0</div>
                  <div class="metric-lbl">Collected</div>
                </div>
                <div class="metric-box">
                  <div class="metric-val" id="hudTop">0</div>
                  <div class="metric-lbl">Comments</div>
                </div>
                <div class="metric-box">
                  <div class="metric-val" id="hudReplies">0</div>
                  <div class="metric-lbl">Replies</div>
                </div>
              </div>

              <button class="btn-stop" id="hudStopBtn">Stop and keep results</button>
            </div>

            <!-- Completed View -->
            <div class="completed-view" id="hudCompletedView">
              <div style="font-size: 26px; line-height: 1;">✓</div>
              <div class="success-heading">Comments are ready</div>
              <div class="success-sub" id="hudSuccessSub">Your collected comments are ready to download.</div>
              <button class="btn-download" id="hudDownloadBtn">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
                Download CSV
              </button>
              <button class="btn-dismiss" id="hudDismissBtn">Close</button>
            </div>
          </div>
        </div>
      `;

      (document.body || document.documentElement).appendChild(this.host);

      this.shadow?.getElementById('hudMinBtn')?.addEventListener('click', () => {
        const card = this.shadow?.getElementById('hudCard');
        const button = this.shadow?.getElementById('hudMinBtn');
        card?.classList.toggle('minimized');
        if (button && card) button.textContent = card.classList.contains('minimized') ? '+' : '−';
      });

      this.shadow?.getElementById('hudCloseBtn')?.addEventListener('click', () => {
        this.destroy();
      });

      this.shadow?.getElementById('hudDismissBtn')?.addEventListener('click', () => {
        this.destroy();
      });

      this.shadow?.getElementById('hudStopBtn')?.addEventListener('click', () => {
        if (this.options.onStop) this.options.onStop();
      });

      this.shadow?.getElementById('hudDownloadBtn')?.addEventListener('click', () => {
        this.triggerDownload();
      });

    }

    update(snapshot) {
      if (!this.shadow) return;
      const hudStatus = this.shadow.getElementById('hudStatus');
      const hudMessage = this.shadow.getElementById('hudMessage');
      const hudTotal = this.shadow.getElementById('hudTotal');
      const hudTop = this.shadow.getElementById('hudTop');
      const hudReplies = this.shadow.getElementById('hudReplies');
      const hudTimer = this.shadow.getElementById('hudTimer');

      if (hudStatus && snapshot.status) hudStatus.textContent = this.formatStatus(snapshot.status);
      const hudBadge = this.shadow.getElementById('hudBadge');
      if (hudBadge && snapshot.status) hudBadge.dataset.status = String(snapshot.status).toLowerCase();
      if (hudMessage && snapshot.statusMessage) hudMessage.textContent = snapshot.statusMessage;
      if (hudTotal && snapshot.totalCount !== undefined) hudTotal.textContent = snapshot.totalCount;
      if (hudTop && snapshot.topLevelCount !== undefined) hudTop.textContent = snapshot.topLevelCount;
      if (hudReplies && snapshot.replyCount !== undefined) hudReplies.textContent = snapshot.replyCount;
      if (hudTimer && snapshot.elapsedSeconds !== undefined) {
        const mins = Math.floor(snapshot.elapsedSeconds / 60).toString().padStart(2, '0');
        const secs = (snapshot.elapsedSeconds % 60).toString().padStart(2, '0');
        hudTimer.textContent = `${mins}:${secs}`;
      }
    }

    async showCompleted({ count, csvString, fileName, comments }) {
      if (!this.shadow || !this.host || !this.host.parentNode) {
        this.mount();
      }
      this.csvData = csvString;
      this.fileName = fileName;
      this.comments = comments || [];

      if (!this.shadow) return;
      const activeView = this.shadow.getElementById('hudActiveView');
      const completedView = this.shadow.getElementById('hudCompletedView');
      const hudSuccessSub = this.shadow.getElementById('hudSuccessSub');

      if (activeView) activeView.style.display = 'none';
      if (completedView) completedView.style.display = 'flex';
      if (hudSuccessSub) {
        hudSuccessSub.textContent = `Collected ${count} comments. Your CSV is ready to download.`;
      }
    }

    triggerDownload() {
      if (!this.csvData) return;
      try {
        if (typeof CSVExporter !== 'undefined' && CSVExporter.downloadCSVInBrowser) {
          CSVExporter.downloadCSVInBrowser(this.csvData, this.fileName);
        } else {
          chrome.runtime.sendMessage({
            action: 'TRIGGER_DOWNLOAD',
            csvContent: this.csvData,
            fileName: this.fileName
          }, () => {
            void chrome.runtime.lastError;
          });
        }
        const btn = this.shadow.getElementById('hudDownloadBtn');
        if (btn) {
          btn.innerHTML = `✓ Downloaded! (Download Again)`;
        }
      } catch (err) {
        console.error('Download error:', err);
      }
    }

    destroy() {
      if (this.host && this.host.parentNode) {
        this.host.parentNode.removeChild(this.host);
      }
      this.host = null;
      this.shadow = null;
    }
  }

  class CommentScraper {
    constructor() {
      this.isRunning = false;
      this.isPaused = false;
      this.shouldStop = false;
      this.startTime = null;
      this.options = {
        maxComments: 0,
        includeReplies: true,
        expandSeeMore: true,
        delayMs: 1200,
        commentFilter: 'all_comments',
        autoSwitchFilter: true,
        autoCloseChats: true
      };
      this.scrapedComments = new Map(); // id -> comment object
      this.status = 'IDLE';
      this.statusMessage = 'Ready to scrape';
      this.lastExpansionCount = 0;
      this.stuckCounter = 0;
      this.chatObserver = null;

      this.overlay = new InPageOverlay({
        onStop: () => this.stopScraping()
      });
      this.initMessageListener();
    }

    initMessageListener() {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        switch (message.action) {
          case 'PING':
            sendResponse({
              status: this.status,
              isRunning: this.isRunning,
              count: this.scrapedComments.size,
              title: document.title,
              url: window.location.href
            });
            break;

          case 'START_SCRAPING':
            sendResponse({ success: true, started: true });
            this.startScraping(message.options || {}).catch(err => {
              console.error('[FBEasyCommentExporter] Scraping error:', err);
            });
            break;

          case 'STOP_SCRAPING':
            this.stopScraping();
            sendResponse({
              success: true,
              count: this.scrapedComments.size,
              comments: Array.from(this.scrapedComments.values())
            });
            break;

          case 'PAUSE_SCRAPING':
            this.isPaused = true;
            this.status = 'PAUSED';
            this.notifyProgress('Scraping paused by user.');
            sendResponse({ success: true });
            break;

          case 'RESUME_SCRAPING':
            this.isPaused = false;
            this.status = 'SCRAPING';
            this.notifyProgress('Resuming scraping...');
            sendResponse({ success: true });
            break;

          case 'GET_STATUS':
            sendResponse(this.getProgressSnapshot());
            break;

          case 'GET_COMMENTS':
            sendResponse({
              comments: Array.from(this.scrapedComments.values()),
              count: this.scrapedComments.size
            });
            break;
        }
      });
    }

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    notifyProgress(customMessage = null) {
      if (customMessage) {
        this.statusMessage = customMessage;
      }
      const snapshot = this.getProgressSnapshot();
      if (this.overlay) {
        this.overlay.update(snapshot);
      }
      try {
        chrome.runtime.sendMessage({
          action: 'SCRAPE_PROGRESS',
          data: snapshot
        }, () => {
          void chrome.runtime.lastError;
        });
      } catch (e) {
        // Safe fail
      }
    }

    getProgressSnapshot() {
      const effectiveMax = this.options.maxComments || 0;
      let all = Array.from(this.scrapedComments.values());
      if (effectiveMax > 0 && all.length > effectiveMax) {
        all = all.slice(0, effectiveMax);
      }
      const topLevel = all.filter(c => c.level === 'Top-level').length;
      const replies = all.filter(c => c.level === 'Reply').length;
      const elapsedSeconds = this.startTime ? Math.round((Date.now() - this.startTime) / 1000) : 0;

      return {
        status: this.status,
        statusMessage: this.statusMessage,
        isRunning: this.isRunning,
        isPaused: this.isPaused,
        totalCount: all.length,
        topLevelCount: topLevel,
        replyCount: replies,
        maxComments: effectiveMax,
        elapsedSeconds,
        recentComments: all.slice(-3).map(c => ({
          authorName: c.authorName,
          commentText: c.commentText.slice(0, 80) + (c.commentText.length > 80 ? '...' : ''),
          level: c.level,
          formattedTime: c.formattedTime
        }))
      };
    }

    async startScraping(options = {}) {
      if (this.isRunning) {
        return { message: 'Already running' };
      }

      this.options = {
        ...this.options,
        ...options
      };
      this.isRunning = true;
      this.isPaused = false;
      this.shouldStop = false;
      this.startTime = Date.now();
      this.scrapedComments.clear();
      this.permalinkDebugCount = 0;
      this.clickedReplyButtons = new WeakSet();
      this.stuckCounter = 0;
      this.status = 'INITIALIZING';

      this.overlay.mount();
      this.notifyProgress('Initializing scraper...');

      try {
        // Auto-close open Messenger chat tabs and observe for any incoming chat popups
        if (this.options.autoCloseChats !== false && this.isFacebook()) {
          this.closeExistingChats();
          this.startChatDismissObserver();
        }

        // If on Facebook Reel, ensure comments drawer is opened first
        if (this.isReel()) {
          const commentsOpened = await this.ensureReelCommentsOpen();
          if (!commentsOpened) {
            throw new Error('Could not open the comments for this Reel. Open the comments panel and retry.');
          }
        }

        // 1. Trigger hydration without moving the Reel feed itself.
        if (!this.isReel()) {
          window.scrollBy({ top: 400, behavior: 'smooth' });
        }
        this.scrollPageAndContainers('down');
        await this.sleep(1500);

        // 2. Try switching comment filter if on Facebook
        const targetFilter = this.options.commentFilter || (this.options.autoSwitchFilter ? 'all_comments' : null);
        if (targetFilter && this.isFacebook()) {
          this.status = 'FILTERING';
          const filterNames = { all_comments: 'All comments', newest: 'Newest', most_relevant: 'Most relevant' };
          const label = filterNames[targetFilter] || targetFilter;
          this.notifyProgress(`Detecting comment filter (checking for "${label}")...`);
          await this.trySwitchCommentFilter(targetFilter);
          await this.sleep(1500);
        }

        // 3. Main expansion loop
        this.status = 'EXPANDING';
        this.notifyProgress('Starting comment expansion and extraction...');

        await this.expansionLoop();

        // 4. Final parse of all visible elements (only if under effectiveMax)
        const effectiveMax = this.options.maxComments || 0;
        if (effectiveMax === 0 || this.scrapedComments.size < effectiveMax) {
          this.status = 'FINALIZING';
          this.notifyProgress('Finalizing comment collection...');
          this.parseCurrentComments();
        }

        // Strictly clamp final comments to effectiveMax so it NEVER exceeds the limit!
        let finalComments = Array.from(this.scrapedComments.values());
        if (effectiveMax > 0 && finalComments.length > effectiveMax) {
          finalComments = finalComments.slice(0, effectiveMax);
        }

        this.status = 'COMPLETED';
        this.notifyProgress(`Collected ${finalComments.length} comments. Your CSV is ready to download.`);

        const csvString = typeof CSVExporter !== 'undefined' ? await CSVExporter.generateCSV(finalComments, null, this.options) : '';
        const fileName = typeof CSVExporter !== 'undefined' ? CSVExporter.generateFileName(document.title) : 'comments.csv';

        if (this.overlay) {
          this.overlay.showCompleted({
            count: finalComments.length,
            csvString,
            fileName,
            comments: finalComments
          });
        }

        // Notify background that scraping finished (stores state, no auto-download)
        chrome.runtime.sendMessage({
          action: 'SCRAPE_COMPLETED',
          comments: finalComments,
          count: finalComments.length,
          postUrl: window.location.href,
          postTitle: document.title
        }, () => {
          void chrome.runtime.lastError;
        });

        return {
          count: finalComments.length,
          comments: finalComments
        };

      } catch (err) {
        console.error('Error during scraping:', err);
        this.status = 'ERROR';
        this.notifyProgress(`Error: ${err.message}`);
        throw err;
      } finally {
        this.isRunning = false;
        this.stopChatDismissObserver();
      }
    }

    async stopScraping() {
      this.shouldStop = true;
      this.isRunning = false;
      this.stopChatDismissObserver();
      this.status = 'STOPPED';

      const effectiveMax = this.options.maxComments || 0;
      if (effectiveMax === 0 || this.scrapedComments.size < effectiveMax) {
        this.parseCurrentComments();
      }

      let finalComments = Array.from(this.scrapedComments.values());
      if (effectiveMax > 0 && finalComments.length > effectiveMax) {
        finalComments = finalComments.slice(0, effectiveMax);
      }

      const csvString = typeof CSVExporter !== 'undefined' ? await CSVExporter.generateCSV(finalComments, null, this.options) : '';
      const fileName = typeof CSVExporter !== 'undefined' ? CSVExporter.generateFileName(document.title + '_stopped') : 'comments_stopped.csv';

      this.notifyProgress(`Stopped. Extracted ${finalComments.length} comments.`);

      if (this.overlay) {
        this.overlay.showCompleted({
          count: finalComments.length,
          csvString,
          fileName,
          comments: finalComments
        });
      }
    }

    isFacebook() {
      return window.location.hostname.includes('facebook.com') || window.location.hostname.includes('fb.com');
    }

    isReel() {
      const path = window.location.pathname.toLowerCase();
      const href = window.location.href.toLowerCase();
      return path.includes('/reel') || href.includes('/reel');
    }

    isVisibleElement(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    }

    isReelCommentsTrayOpen() {
      const root = this.getTargetPostContainer();
      if (root === document) return false;

      const hasVisibleComment = Array.from(root.querySelectorAll(
        'div[role="article"], div[aria-label*="Comment by" i], div[aria-label*="Komento ni" i]'
      )).some(el => this.isVisibleElement(el));
      const hasVisibleCommentBox = Array.from(root.querySelectorAll(
        '[role="textbox"][aria-label*="comment" i], [role="textbox"][aria-label*="komento" i]'
      )).some(el => this.isVisibleElement(el));
      const rootLabel = `${root.getAttribute('aria-label') || ''} ${root.getAttribute('data-pagelet') || ''}`;
      const isCommentsPane = /comments?/i.test(rootLabel) ||
        root.getAttribute('role') === 'complementary' ||
        (root.getAttribute('role') === 'dialog' && !root.querySelector('video'));

      return hasVisibleCommentBox || (isCommentsPane && hasVisibleComment);
    }

    async ensureReelCommentsOpen() {
      if (!this.isReel()) return true;

      if (this.isReelCommentsTrayOpen()) {
        this.notifyProgress('Reels comments tray is open.');
        return true;
      }

      this.notifyProgress('Detecting Reels comments tray (opening drawer)...');

      // Facebook can render the Reel toolbar after the document load event.
      let commentBtn = null;
      for (let attempt = 0; attempt < 10 && !commentBtn; attempt++) {
        const commentPaths = Array.from(document.querySelectorAll('svg path[d^="M12 .5C18.351"]'));
        const visibleCommentPath = commentPaths.find(path =>
          this.isVisibleElement(path) && !this.isInsideForbiddenContainer(path)
        );
        if (visibleCommentPath) {
          commentBtn = visibleCommentPath.closest('button, [role="button"], [tabindex], a') || visibleCommentPath;
        }

        if (!commentBtn) {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], div[tabindex="0"], a[role="button"]'))
            .filter(btn => this.isVisibleElement(btn) && !this.isInsideForbiddenContainer(btn));
          commentBtn = buttons.find(btn => {
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            const combined = `${aria} ${text}`;

            if (/(comment|komento)/i.test(combined) && !/(comment by|komento ni|write a comment|write a reply)/i.test(combined)) {
              return true;
            }

            // Check for speech bubble SVG icon inside button
            const svg = btn.querySelector('svg');
            if (svg) {
              const svgContent = svg.innerHTML.toLowerCase();
              if (svgContent.includes('m18 10h-1.26') || svgContent.includes('18.25') || svgContent.includes('m21 15a2') || svgContent.includes('m12 2c5.5')) {
                return true;
              }
            }
            return false;
          });
        }

        if (!commentBtn) await this.sleep(500);
      }

      // Fallback: search for action buttons with numeric comment counts in vertical reel toolbar
      if (!commentBtn) {
        const svgs = Array.from(document.querySelectorAll('svg'));
        for (const s of svgs) {
          const btn = s.closest('button, [role="button"]');
          if (btn && this.isVisibleElement(btn) && !this.isInsideForbiddenContainer(btn)) {
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('share') || aria.includes('like') || aria.includes('react') || aria.includes('close')) continue;
            const num = (btn.innerText || '').trim();
            if (/^(\d+(\.\d+)?[kmb]?)$/i.test(num)) {
              commentBtn = btn;
              break;
            }
          }
        }
      }

      if (!commentBtn) {
        this.notifyProgress('Could not find the Reel comments button.');
        return false;
      }

      this.triggerClick(commentBtn);
      for (let attempt = 0; attempt < 10; attempt++) {
        await this.sleep(400);
        if (this.isReelCommentsTrayOpen()) {
          this.notifyProgress('Reels comments tray opened.');
          return true;
        }
      }

      if (commentBtn) {
        this.notifyProgress('Reel comments button clicked; starting extraction.');
        await this.sleep(1200);
        return true;
      }

      this.notifyProgress('Reel comments tray did not open.');
      return false;
    }

    /**
     * Finds and closes all active Messenger chat tabs / docks / popups
     */
    closeExistingChats() {
      if (!this.isFacebook()) return;
      try {
        // 1. Explicit close buttons on chat tabs, docks, and dialogs
        const closeSelectors = [
          '[data-pagelet*="Chat"] [role="button"][aria-label*="close" i]',
          '[data-pagelet*="Chat"] [role="button"][aria-label*="isara" i]',
          '[data-pagelet*="Dock"] [role="button"][aria-label*="close" i]',
          '[data-pagelet*="Dock"] [role="button"][aria-label*="isara" i]',
          'div[data-pagelet*="MWChat"] [role="button"][aria-label*="close" i]',
          'div[data-pagelet*="MWChat"] [role="button"][aria-label*="isara" i]',
          '[role="dialog"][aria-label*="chat" i] [role="button"][aria-label*="close" i]',
          '[role="dialog"][aria-label*="chat" i] [role="button"][aria-label*="isara" i]',
          '[aria-label="Close chat" i]',
          '[aria-label="Close tab" i]',
          '[aria-label="Isara ang chat" i]',
          '[aria-label="Cerrar chat" i]'
        ];

        const closeButtons = Array.from(document.querySelectorAll(closeSelectors.join(', ')));
        for (const btn of closeButtons) {
          try {
            this.triggerClick(btn);
          } catch (e) {}
        }

        // 2. Also search inside any chat dock pagelets for header close buttons
        const docks = Array.from(document.querySelectorAll('[data-pagelet*="Chat"], [data-pagelet*="Dock"], div[data-pagelet*="MWChatTab"]'));
        for (const dock of docks) {
          const btns = Array.from(dock.querySelectorAll('[role="button"]'));
          for (const b of btns) {
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const title = (b.getAttribute('title') || '').toLowerCase();
            if (aria.includes('close') || aria.includes('isara') || title.includes('close') || title.includes('isara')) {
              try {
                this.triggerClick(b);
              } catch (e) {}
            }
          }
        }
      } catch (e) {}
    }

    /**
     * Start MutationObserver to instantly close any chat tab that pops up during extraction
     */
    startChatDismissObserver() {
      if (this.chatObserver || !this.isFacebook()) return;
      try {
        this.chatObserver = new MutationObserver((mutations) => {
          let shouldClose = false;
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1) { // ELEMENT_NODE
                if (node.matches?.('[data-pagelet*="Chat"], [data-pagelet*="Dock"], [aria-label*="Chat with" i], [aria-label="Close chat" i]') ||
                    node.querySelector?.('[data-pagelet*="Chat"], [data-pagelet*="Dock"], [aria-label="Close chat" i], [aria-label="Isara ang chat" i]')) {
                  shouldClose = true;
                  break;
                }
              }
            }
            if (shouldClose) break;
          }
          if (shouldClose) {
            this.closeExistingChats();
          }
        });

        this.chatObserver.observe(document.body, {
          childList: true,
          subtree: true
        });
      } catch (e) {}
    }

    /**
     * Stop observing for chat tabs
     */
    stopChatDismissObserver() {
      if (this.chatObserver) {
        try {
          this.chatObserver.disconnect();
        } catch (e) {}
        this.chatObserver = null;
      }
    }

    /**
     * Locate the root search root for comments (modal dialog if visible, otherwise document)
     */
    getTargetPostContainer() {
      if (this.isReel()) {
        const candidates = Array.from(document.querySelectorAll(
          '[role="dialog"], [role="complementary"], div[aria-label*="Comments" i], div[data-pagelet*="Comment" i], div[data-pagelet*="Reel" i]'
        )).filter(el => el.offsetParent !== null && !this.isInsideForbiddenContainer(el));

        const commentContainers = candidates.map(el => {
          const comments = el.querySelectorAll(
            'div[role="article"], div[aria-label*="Comment by" i], div[aria-label*="Komento ni" i]'
          ).length;
          const hasCommentBox = !!el.querySelector('[role="textbox"][aria-label*="comment" i], [role="textbox"][aria-label*="komento" i]');
          if (comments === 0 && !hasCommentBox) return null;

          const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('data-pagelet') || ''}`;
          let score = Math.min(comments, 20);
          if (/comments?/i.test(label)) score += 100;
          if (/comment/i.test(el.getAttribute('data-pagelet') || '')) score += 50;
          if (el.getAttribute('role') === 'complementary') score += 30;
          if (el.getAttribute('role') === 'dialog') score += 20;
          if (el.querySelector('video')) score -= 100;
          return { element: el, score };
        }).filter(Boolean);

        commentContainers.sort((a, b) => b.score - a.score);
        if (commentContainers.length > 0) {
          return commentContainers[0].element;
        }
      } else if (window.location.href.includes('/photo') || window.location.href.includes('/watch')) {
        const mediaPane = document.querySelector('[role="complementary"], div[data-pagelet*="Photo"], div[data-pagelet*="MediaViewer"]');
        if (mediaPane && mediaPane.offsetParent !== null) return mediaPane;
      }

      // If a modal dialog is open and visible containing articles, scope to it (ignoring chat boxes and share menus)
      const dialogs = Array.from(document.querySelectorAll('div[role="dialog"]'));
      for (const d of dialogs) {
        if (this.isInsideForbiddenContainer(d)) continue;
        const aria = (d.getAttribute('aria-label') || '').toLowerCase();
        if (aria.includes('chat') || aria.includes('message') || aria.includes('share') || aria.includes('notification')) continue;
        if (d.offsetParent !== null && d.querySelector('div[role="article"], div[aria-label*="Comment"], div[aria-label*="Komento"]')) {
          return d;
        }
      }
      return document;
    }

    /**
     * Check if an element is inside Messenger chats, chat docks, right rail, or overlay
     */
    isInsideForbiddenContainer(el) {
      if (!el) return true;
      try {
        if (el.closest('#fbeasy-overlay-root') || el.closest('#fbextract-overlay-root')) return true;

        // Messenger Chat Tabs in bottom-right corner or chat dock
        if (el.closest('[data-pagelet*="Chat"], [data-pagelet*="Dock"], [aria-label="Chat"], [aria-label="Chats"], [aria-label*="Messenger"]')) {
          return true;
        }
        // Feed right sidebar ads/contacts (only on main feed, never in photo, media, or reel viewer)
        const rightRail = el.closest('[data-pagelet="RightRail"]');
        if (rightRail && !el.closest('[role="dialog"], [data-pagelet*="Photo"], [data-pagelet*="MediaViewer"], [data-pagelet*="Reel"], [role="complementary"]')) {
          return true;
        }
      } catch (e) {}
      return false;
    }

    /**
     * Clean account name by stripping relative timestamps (e.g. "27 minutes ago", "a week ago") and badges
     */
    cleanAccountName(raw) {
      if (!raw) return 'Anonymous';
      let clean = raw.split('\n')[0].trim();
      // Strip bullet points e.g. "Rj Panelo · 27m"
      clean = clean.replace(/\s*[·•]\s*.*$/, '');
      // Strip trailing relative time expressions
      clean = clean.replace(/\s+(just now|\d+\s*(?:m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|mo|month|months|y|yr|yrs|year|years)\s*(?:ago)?)$/i, '');
      clean = clean.replace(/\s+(?:a|an)\s+(?:minute|hour|day|week|month|year)\s+ago$/i, '');
      clean = clean.replace(/\s+(?:yesterday|today)(?:\s+at\s+.*)?$/i, '');
      clean = clean.replace(/\s+\d{1,2}\s+[A-Za-z]+(?:\s+at\s+\d{1,2}:\d{2}(?:\s*[ap]m)?)?$/i, '');
      // Strip badges like Top fan, Author, etc.
      clean = clean.replace(/\s+(?:top fan|author|moderator|group expert|admin)$/i, '');
      return clean.trim() || raw.split('\n')[0].trim() || 'Anonymous';
    }

    /**
     * Synthesizes full pointer, mouse, and click events for React/Comet elements
     */
    triggerClick(el) {
      if (!el) return;
      const target = el.closest('[role="button"], [role="menuitemradio"], [role="menuitem"], [role="option"]') || el;
      try {
        const rect = target.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;
        const eventInit = { bubbles: true, cancelable: true, view: window, clientX, clientY };

        target.dispatchEvent(new PointerEvent('pointerdown', eventInit));
        target.dispatchEvent(new MouseEvent('mousedown', eventInit));
        target.dispatchEvent(new PointerEvent('pointerup', eventInit));
        target.dispatchEvent(new MouseEvent('mouseup', eventInit));
      } catch (e) {}
      try {
        target.click();
      } catch (e) {}
    }

    /**
     * Tries to find and select the desired comment filter in Facebook's comment filter dropdown:
     * - 'all_comments': All comments (including hidden/potential spam)
     * - 'newest': Newest comments first
     * - 'most_relevant': Most relevant comments first
     */
    async trySwitchCommentFilter(targetFilter = 'all_comments') {
      const filterConfig = {
        all_comments: {
          label: 'All comments',
          matches: (text) => {
            const t = text.toLowerCase();
            return (t.includes('all comments') || t.includes('lahat ng komento') || t.includes('todos los comentarios') || t.includes('potential spam') || t.includes('potensyal na spam')) &&
                   !t.includes('newest') && !t.includes('pinakabago') && !t.includes('most relevant');
          },
          isCurrentActive: (text) => {
            const t = text.toLowerCase();
            return (t.includes('all comments') || t.includes('lahat ng komento')) && !t.includes('newest') && !t.includes('most relevant');
          }
        },
        newest: {
          label: 'Newest',
          matches: (text) => {
            const t = text.toLowerCase();
            return (t.includes('newest') || t.includes('pinakabago') || t.includes('más recientes') || t.includes('recent comments')) &&
                   !t.includes('all comments') && !t.includes('most relevant');
          },
          isCurrentActive: (text) => {
            const t = text.toLowerCase();
            return (t.includes('newest') || t.includes('pinakabago') || t.includes('más recientes')) && !t.includes('all comments');
          }
        },
        most_relevant: {
          label: 'Most relevant',
          matches: (text) => {
            const t = text.toLowerCase();
            return (t.includes('most relevant') || t.includes('top comments') || t.includes('pinaka-may kaugnayan') || t.includes('más relevantes')) &&
                   !t.includes('all comments') && !t.includes('newest');
          },
          isCurrentActive: (text) => {
            const t = text.toLowerCase();
            return (t.includes('most relevant') || t.includes('top comments') || t.includes('pinaka-may kaugnayan') || t.includes('más relevantes')) && !t.includes('all comments');
          }
        }
      };

      const cfg = filterConfig[targetFilter] || filterConfig.all_comments;

      try {
        const root = this.getTargetPostContainer();
        for (let attempt = 1; attempt <= 4; attempt++) {
          if (this.shouldStop) break;

          // 1. Look for buttons that typically hold the comment filter dropdown
          const candidates = Array.from(root.querySelectorAll('[role="button"], [aria-haspopup="menu"], span[dir="auto"], div[dir="auto"]'));
          const filterBtn = candidates.find(el => {
            if (this.isInsideForbiddenContainer(el)) return false;
            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
            const combined = `${text} ${aria}`;
            return (
              combined.includes('most relevant') ||
              combined.includes('top comments') ||
              combined.includes('newest') ||
              combined.includes('all comments') ||
              combined.includes('pinaka-may kaugnayan') ||
              combined.includes('pinakabago') ||
              combined.includes('lahat ng komento')
            ) && !combined.includes('view') && !combined.includes('reply') && !combined.includes('comment by');
          });

          if (!filterBtn) {
            await this.sleep(800);
            continue;
          }

          const currentText = (filterBtn.innerText || filterBtn.textContent || '').trim().toLowerCase();
          // If the button text is already set to target filter, we are done!
          if (cfg.isCurrentActive(currentText)) {
            this.notifyProgress(`Comment filter is already set to "${cfg.label}".`);
            return true;
          }

          this.notifyProgress(`Opening comment filter dropdown (setting to "${cfg.label}")...`);
          const clickableBtn = filterBtn.closest('[role="button"]') || filterBtn;
          if (!this.isReel()) {
            clickableBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          await this.sleep(400);
          this.triggerClick(clickableBtn);
          await this.sleep(1200);

          // 2. Locate the open menu in popovers or portals
          const menuItems = Array.from(document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"], div[role="menu"] div[role="button"]'));
          let targetOption = null;

          for (const item of menuItems) {
            const rawText = (item.innerText || item.textContent || '').trim();
            const firstLine = rawText.split('\n')[0].trim();
            if (cfg.matches(firstLine) || cfg.matches(rawText)) {
              targetOption = item;
              break;
            }
          }

          // Fallback if role="menuitemradio" was not used
          if (!targetOption) {
            const allElements = Array.from(document.querySelectorAll('[role="menu"] span[dir="auto"], div[data-pagelet="Popovers"] span[dir="auto"], [role="dialog"] span[dir="auto"]'));
            for (const span of allElements) {
              const rawText = (span.innerText || span.textContent || '').trim();
              const spanFirstLine = rawText.split('\n')[0].trim();
              if (cfg.matches(spanFirstLine) || cfg.matches(rawText)) {
                targetOption = span;
                break;
              }
            }
          }

          if (targetOption) {
            this.notifyProgress(`Selecting "${cfg.label}" option...`);
            const clickableItem = targetOption.closest('[role="menuitemradio"], [role="menuitem"], [role="option"], [role="button"]') || targetOption;
            this.triggerClick(clickableItem);
            if (clickableItem !== targetOption) {
              this.triggerClick(targetOption);
            }
            this.notifyProgress(`Selected "${cfg.label}"! Waiting for comments to reload...`);
            await this.sleep(3000); // Give Facebook 3 seconds to fetch the filtered comments tree
            return true;
          } else {
            document.body.click(); // Dismiss menu
            await this.sleep(1000);
          }
        }
      } catch (e) {
        console.warn('Could not switch filter:', e);
      }
      return false;
    }

    /**
     * Scroll window, scrollable containers, and target comments to mimic human mouse scrolling
     */
    scrollPageAndContainers(direction = 'down') {
      const delta = direction === 'up' ? -850 : 850;

      if (this.isReel()) {
        const root = this.getTargetPostContainer();
        const selector = 'div[role="article"], div[aria-label*="Comment" i]';
        const comments = Array.from(root.querySelectorAll(selector));
        const comment = direction === 'down' ? comments[comments.length - 1] : comments[0];

        if (comment) {
          let container = comment.parentElement;
          while (container && container !== root && container !== document.body && container !== document.documentElement) {
            if (container.querySelector('video')) break;
            const style = window.getComputedStyle(container);
            if (container.scrollHeight > container.clientHeight + 40 && /auto|scroll|overlay|hidden/.test(style.overflowY)) {
              container.scrollTop += delta;
              return;
            }
            container = container.parentElement;
          }

          const rootStyle = root !== document ? window.getComputedStyle(root) : null;
          const rootIsCommentsPane = root !== document && (
            root.getAttribute('role') === 'complementary' ||
            root.getAttribute('role') === 'dialog' ||
            /comments/i.test(root.getAttribute('aria-label') || '') ||
            /comment/i.test(root.getAttribute('data-pagelet') || '')
          );
          if (rootIsCommentsPane && !root.querySelector('video') && root.scrollHeight > root.clientHeight + 40 && /auto|scroll|overlay|hidden/.test(rootStyle.overflowY)) {
            root.scrollTop += delta;
          }
        }
        return;
      }

      // 1. Scroll the window and document scrolling element
      try {
        window.scrollBy({ top: delta, behavior: 'instant' });
      } catch (e) {}

      try {
        if (document.scrollingElement) {
          document.scrollingElement.scrollTop += delta;
        } else if (document.documentElement) {
          document.documentElement.scrollTop += delta;
        }
        if (document.body) {
          document.body.scrollTop += delta;
        }
      } catch (e) {}

      // 2. Scroll the last or first comment article into view (native browser ancestor scroll)
      try {
        const root = this.getTargetPostContainer();
        const articles = Array.from(root.querySelectorAll('div[role="article"]'))
          .filter(el => !this.isInsideForbiddenContainer(el));
        if (articles.length > 0) {
          if (direction === 'down') {
            const target = articles[articles.length - 1];
            target.scrollIntoView({ behavior: 'smooth', block: 'end' });
          } else {
            const target = articles[0];
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      } catch (e) {}

      // 3. Find and scroll ANY element on the page that has a scrollbar
      try {
        const allElements = Array.from(document.querySelectorAll('div, main, section, [role="main"], [role="dialog"], [role="feed"], [role="complementary"], div[data-pagelet*="Reel"]'));
        for (const el of allElements) {
          if (el.scrollHeight > el.clientHeight + 40) {
            try {
              el.scrollTop += delta;
              el.scrollBy({ top: delta, behavior: 'instant' });
            } catch (e) {}
          }
        }
      } catch (e) {}

      // 4. Dispatch synthetic WheelEvent exactly like mouse wheel
      try {
        const root = this.getTargetPostContainer();
        const articles = Array.from(root.querySelectorAll('div[role="article"], div[aria-label*="Comment"]'))
          .filter(el => !this.isInsideForbiddenContainer(el));
        let centerX = Math.floor(window.innerWidth / 2);
        if (articles.length > 0) {
          const rect = articles[articles.length - 1].getBoundingClientRect();
          if (rect.width > 0 && rect.left > 0) {
            centerX = Math.floor(rect.left + rect.width / 2);
          }
        } else if (window.location.href.includes('/photo') || window.location.href.includes('/watch') || window.location.href.includes('/reel')) {
          centerX = Math.floor(window.innerWidth * 0.82);
        }
        const centerY = Math.floor(window.innerHeight / 2);
        const targetNode = document.elementFromPoint(centerX, centerY) || document.body || window;
        const wheelEvt = new WheelEvent('wheel', {
          deltaY: delta,
          deltaMode: 0,
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: centerX,
          clientY: centerY
        });
        targetNode.dispatchEvent(wheelEvt);
        window.dispatchEvent(wheelEvt);
      } catch (e) {}
    }

    /**
     * Main loop that repeatedly expands comments, replies, and "See more" text from top to bottom
     */
    async expansionLoop() {
      let consecutiveNoNewComments = 0;

      while (!this.shouldStop) {
        // Handle user pause
        while (this.isPaused && !this.shouldStop) {
          await this.sleep(500);
        }

        if (this.shouldStop) break;

        const postContainer = this.getTargetPostContainer();

        // 1. Expand "View replies" on visible comments FIRST so all reply layers are loaded!
        let repliesClicked = false;
        if (this.options.includeReplies) {
          repliesClicked = await this.clickViewReplies(postContainer);
        }

        // 2. Expand "See more" text on comments to reveal full text
        if (this.options.expandSeeMore) {
          await this.expandSeeMoreButtons(postContainer);
        }

        // 3. Parse comments currently rendered in target post container (including newly expanded replies!)
        const prevCount = this.scrapedComments.size;
        this.parseCurrentComments();
        const currentCount = this.scrapedComments.size;

        // 4. Check whether the selected comment limit has been reached.
        const effectiveMax = this.options.maxComments || 0;
        if (effectiveMax > 0 && currentCount >= effectiveMax) {
          const limitMsg = `Reached comment limit (${effectiveMax}).`;
          this.notifyProgress(limitMsg);
          break;
        }

        // 5. Find and click "View previous comments" (top) or "View more comments" (bottom)
        const moreCommentsClicked = await this.clickViewMoreComments();

        // 6. Scroll automatically EVERY cycle to feed Facebook's infinite scroll loader!
        this.scrollPageAndContainers('down');

        // 7. Auto-close Messenger chats if any opened
        if (this.options.autoCloseChats !== false && this.isFacebook()) {
          this.closeExistingChats();
        }

        this.notifyProgress(`Extracted ${currentCount} comments so far...`);

        // Check if making real progress (new comments extracted or expansions actively in-flight)
        if (currentCount > prevCount || repliesClicked || moreCommentsClicked) {
          consecutiveNoNewComments = 0; // Fresh comments extracted or expansion actively in-flight, reset counter!
        } else {
          consecutiveNoNewComments++;

          // When progress pauses, scroll up to reveal "View previous comments" at top
          if (consecutiveNoNewComments % 2 === 1) {
            this.scrollPageAndContainers('up');
          }
        }

        // If no new comments have been added for 10 consecutive cycles (~18-22s), we are done!
        if (consecutiveNoNewComments >= 10) {
          // Final recovery attempt: scroll to top of page and re-parse
          if (!this.isReel()) {
            window.scrollTo({ top: 0, behavior: 'instant' });
          }
          await this.sleep(1200);
          this.parseCurrentComments();

          this.notifyProgress(`Extraction complete. Collected ${this.scrapedComments.size} comments.`);
          break;
        }

        // Wait before next cycle
        await this.sleep(this.options.delayMs || 1000);
      }
    }

    /**
     * Expand "See more" buttons strictly within target post comments
     */
    async expandSeeMoreButtons(container) {
      try {
        const root = container || this.getTargetPostContainer();
        const buttons = Array.from(root.querySelectorAll('[role="button"], span[dir="auto"]'));
        const seeMoreBtns = buttons.filter(el => {
          if (this.isInsideForbiddenContainer(el)) return false;
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          return text === 'see more' || text.endsWith('see more') || text === 'show more';
        });

        for (const btn of seeMoreBtns.slice(0, 10)) {
          if (this.shouldStop) break;
          try {
            this.triggerClick(btn);
            await this.sleep(60);
          } catch (e) {}
        }
      } catch (e) {}
    }

    /**
     * Find and click "View previous comments" (top) or "View more comments" (bottom) across document
     */
    async clickViewMoreComments() {
      try {
        const root = this.getTargetPostContainer();
        const candidates = Array.from(root.querySelectorAll('[role="button"], span[dir="auto"], div[dir="auto"], a'));
        
        const isTargetButton = (el) => {
          if (this.isInsideForbiddenContainer(el)) return false;
          const text = (el.innerText || el.textContent || '').trim().toLowerCase();
          const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          const combined = `${text} ${aria}`.trim();

          if (combined.includes('write a reply') || combined.includes('write a comment')) return false;

          // Reject menu filter buttons
          if (combined === 'most relevant' || combined === 'all comments' || combined === 'newest') return false;

          // Match English patterns:
          if (/(view|load|see|show)\s+(?:all\s+)?(?:\d+\s+)?(?:more\s+|previous\s+|earlier\s+|other\s+)?comments?/i.test(combined)) return true;
          if (/(view|load|see|show)\s+(?:previous|earlier|older|more)\s+(?:\d+\s+)?comments?/i.test(combined)) return true;
          if (/^\d+\s+more\s+comments?$/i.test(combined) || /^view\s+\d+\s+comments?$/i.test(combined)) return true;
          if (/^(older|previous)\s+comments?$/i.test(combined)) return true;
          if (/view\s+\d+\s+(?:previous\s+|more\s+)?comments?/i.test(combined)) return true;

          // Match Tagalog / Filipino patterns:
          if (combined.includes('tingnan') && combined.includes('komento')) return true;
          if (combined.includes('ipakita') && combined.includes('komento')) return true;
          if (combined.includes('higit pang') && combined.includes('komento')) return true;
          if (combined.includes('mga nakaraang komento') || combined.includes('nakaraang mga komento')) return true;

          return false;
        };

        // Deduplicate so we don't click child spans of the same button
        const uniqueButtons = [];
        const seen = new Set();
        for (const candidate of candidates) {
          if (isTargetButton(candidate)) {
            const btn = candidate.closest('[role="button"]') || candidate;
            if (!seen.has(btn) && (btn.offsetParent !== null || candidate.offsetParent !== null)) {
              seen.add(btn);
              uniqueButtons.push(btn);
            }
          }
        }

        let clickedAny = false;
        for (const btn of uniqueButtons.slice(0, 2)) {
          if (this.shouldStop) break;
          if (!this.isReel()) {
            btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
          await this.sleep(250);
          this.triggerClick(btn);
          clickedAny = true;
          this.notifyProgress('Loading more comments...');
          await this.sleep(1200); // Give Facebook network time to fetch comments
        }
        return clickedAny;
      } catch (e) {}
      return false;
    }

    /**
     * Find and click "View X replies", "View more replies", and nested reply buttons across all discussion layers
     */
    async clickViewReplies(container) {
      if (!this.clickedReplyButtons) {
        this.clickedReplyButtons = new WeakSet();
      }

      try {
        const root = container || this.getTargetPostContainer();

        const findCandidateButtons = () => {
          const candidates = Array.from(root.querySelectorAll('[role="button"], span[dir="auto"], div[dir="auto"], a'));
          const matched = [];
          const seen = new Set();

          for (const el of candidates) {
            if (this.isInsideForbiddenContainer(el)) continue;

            // Check if already clicked
            if (this.clickedReplyButtons.has(el)) continue;
            if (el.getAttribute('data-fbeasy-clicked') === 'true' || el.getAttribute('data-fbextract-clicked') === 'true') continue;

            const text = (el.innerText || el.textContent || '').trim().toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
            const combined = `${text} ${aria}`.trim();

            if (!combined) continue;
            if (combined.includes('write a reply') || combined.includes('write a comment')) continue;
            if (combined.includes('like') && !combined.includes('reply') && !combined.includes('replies') && !combined.includes('tugon')) continue;

            let isReply = false;

            // English reply patterns:
            // "View 3 replies", "View all 8 replies", "View 5 more replies", "View previous replies"
            // "3 replies", "Author replied · 1 reply"
            if (/(?:view|show|load|see)\s+(?:all\s+)?(?:\d+\s+)?(?:more\s+|previous\s+|earlier\s+|other\s+)?repl(?:y|ies)/i.test(combined)) isReply = true;
            else if (/(?:view|show|load|see)\s+(?:previous|earlier|more|other)\s+repl(?:y|ies)/i.test(combined)) isReply = true;
            else if (/^\d+\s+repl(?:y|ies)$/i.test(combined)) isReply = true;
            else if (/(?:replied|replies)\s*[·•]\s*\d+\s+repl(?:y|ies)/i.test(combined)) isReply = true;

            // Tagalog / Filipino patterns:
            else if (combined.includes('tingnan') && (combined.includes('tugon') || combined.includes('sagot') || combined.includes('reply') || combined.includes('replies'))) isReply = true;
            else if (combined.includes('ipakita') && (combined.includes('tugon') || combined.includes('sagot') || combined.includes('reply'))) isReply = true;
            else if (combined.includes('higit pang') && (combined.includes('tugon') || combined.includes('sagot') || combined.includes('reply'))) isReply = true;
            else if (/^\d+\s+(?:na\s+)?(?:tugon|sagot)$/i.test(combined)) isReply = true;

            // Spanish patterns:
            else if (/(?:ver|mostrar)\s+(?:todas\s+las\s+)?(?:\d+\s+)?(?:más\s+|anteriores\s+)?respuestas?/i.test(combined)) isReply = true;
            else if (/^\d+\s+respuestas?$/i.test(combined)) isReply = true;

            // If inside an already opened reply group container, any "view more comments" or "view previous comments" is a reply expander!
            const insideGroup = el.closest('[role="group"], .replies-container, [data-pagelet*="Reply"], [data-pagelet*="replies"]');
            if (insideGroup && /(?:view|show|load|see|tingnan)\s+(?:all\s+)?(?:\d+\s+)?(?:more\s+|previous\s+|earlier\s+)?(?:comments?|repl(?:y|ies)|tugon|sagot)/i.test(combined)) {
              isReply = true;
            }

            if (isReply) {
              const btn = el.closest('[role="button"]') || el;
              if (!seen.has(btn) && !this.clickedReplyButtons.has(btn) && btn.getAttribute('data-fbeasy-clicked') !== 'true' && btn.getAttribute('data-fbextract-clicked') !== 'true') {
                seen.add(btn);
                matched.push(btn);
              }
            }
          }
          return matched;
        };

        // Pass 1: Click available reply buttons (up to 8 buttons per cycle)
        let candidateButtons = findCandidateButtons();
        if (candidateButtons.length === 0) {
          return false;
        }

        let clickedCount = 0;
        for (const btn of candidateButtons.slice(0, 8)) {
          if (this.shouldStop) break;

          this.clickedReplyButtons.add(btn);
          btn.setAttribute('data-fbeasy-clicked', 'true');

          try {
            if (!this.isReel()) {
              btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }
            await this.sleep(120);
            this.triggerClick(btn);
            clickedCount++;
            this.notifyProgress(`Expanding comment replies (${clickedCount} threads)...`);
            await this.sleep(300);
          } catch (e) {}
        }

        // Pass 2: Nested reply layers (e.g. "View X more replies" inside opened threads)
        if (clickedCount > 0) {
          await this.sleep(600); // Allow DOM to update with nested layer buttons
          const nestedButtons = findCandidateButtons();
          for (const nestedBtn of nestedButtons.slice(0, 4)) {
            if (this.shouldStop) break;
            this.clickedReplyButtons.add(nestedBtn);
            nestedBtn.setAttribute('data-fbeasy-clicked', 'true');
            try {
              if (!this.isReel()) {
                nestedBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }
              await this.sleep(120);
              this.triggerClick(nestedBtn);
              clickedCount++;
              await this.sleep(300);
            } catch (e) {}
          }
        }

        return clickedCount > 0;
      } catch (e) {}
      return false;
    }

    /**
     * Helper hash function for deterministic fingerprinting
     */
    hashString(str) {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash).toString(36);
    }

    /**
     * Parse and extract comment data strictly from target post DOM elements
     */
    parseCurrentComments() {
      const root = this.getTargetPostContainer();

      // Facebook comment items are typically marked as role="article"
      let commentElements = Array.from(root.querySelectorAll('div[role="article"], div[aria-label*="Comment by"], div[aria-label*="Reply by"], div[aria-label*="Komento ni"], div[aria-label*="Komentaryo ni"], div[aria-label*="Sagot ni"]'));

      // If scoped to a modal/dialog that didn't yield any elements, fall back to entire document
      if (commentElements.length === 0 && root !== document) {
        commentElements = Array.from(document.querySelectorAll('div[role="article"], div[aria-label*="Comment by"], div[aria-label*="Reply by"]'));
      }

      // Fallback for non-standard containers
      if (commentElements.length === 0) {
        commentElements = Array.from(document.querySelectorAll('[data-ad-preview="message"], ul > li, div[aria-label*="Comment"]'));
      }

      const effectiveMax = this.options.maxComments || 0;

      for (const el of commentElements) {
        if (effectiveMax > 0 && this.scrapedComments.size >= effectiveMax) {
          break;
        }
        try {
          if (this.isInsideForbiddenContainer(el)) {
            continue;
          }

          const parsed = this.extractSingleComment(el);
          if (parsed && parsed.commentText && parsed.commentText.trim().length > 0) {
            // If user unchecked "Include comment replies?", skip replies and only keep top-level
            if (!this.options.includeReplies && parsed.level === 'Reply') {
              continue;
            }

            // Canonical author key and normalized text
            const authorKey = (parsed.userId && parsed.userId !== 'N/A')
              ? parsed.userId.toLowerCase()
              : (parsed.accountName || 'anonymous').toLowerCase().trim();
            const textNorm = parsed.commentText.replace(/\s+/g, ' ').trim().toLowerCase();
            const textSnippet = textNorm.slice(0, 70);

            // Deterministic primary unique key
            const primaryKey = parsed.realId
              ? `fb_${parsed.realId}`
              : `c_${authorKey}_${parsed.level}_${this.hashString(textSnippet)}`;

            if (this.scrapedComments.has(primaryKey)) {
              const existing = this.scrapedComments.get(primaryKey);
              if (parsed.commentText.length > existing.commentText.length) {
                existing.commentText = parsed.commentText;
              }
              if (parsed.likeCount && parsed.likeCount !== '0') existing.likeCount = parsed.likeCount;
              if (parsed.replyCount && parsed.replyCount !== '0') existing.replyCount = parsed.replyCount;
              if (parsed.formattedTime && !existing.formattedTime) existing.formattedTime = parsed.formattedTime;
            } else {
              let matchedKey = null;
              for (const [k, ex] of this.scrapedComments.entries()) {
                const exAuthor = (ex.userId && ex.userId !== 'N/A')
                  ? ex.userId.toLowerCase()
                  : (ex.accountName || 'anonymous').toLowerCase().trim();
                if (exAuthor === authorKey && ex.level === parsed.level) {
                  const exNorm = ex.commentText.replace(/\s+/g, ' ').trim().toLowerCase();
                  if (textNorm.startsWith(exNorm.slice(0, 35)) || exNorm.startsWith(textNorm.slice(0, 35))) {
                    matchedKey = k;
                    break;
                  }
                }
              }

              if (matchedKey) {
                const existing = this.scrapedComments.get(matchedKey);
                if (parsed.commentText.length > existing.commentText.length) {
                  existing.commentText = parsed.commentText;
                }
                if (parsed.likeCount && parsed.likeCount !== '0') existing.likeCount = parsed.likeCount;
                if (parsed.replyCount && parsed.replyCount !== '0') existing.replyCount = parsed.replyCount;
              } else {
                if (effectiveMax > 0 && this.scrapedComments.size >= effectiveMax) {
                  break;
                }
                parsed.id = primaryKey;
                this.scrapedComments.set(primaryKey, parsed);
              }
            }
          }
        } catch (err) {
          console.warn('[FBEasy] Comment extraction failed', {
            ariaLabel: el.getAttribute('aria-label') || '',
            elementId: el.getAttribute('id') || '',
            error: err
          });
        }
      }
      this.resolveReplyParents();
    }

    resolveReplyParents() {
      const comments = Array.from(this.scrapedComments.values());
      for (let index = 0; index < comments.length; index++) {
        const comment = comments[index];
        if (comment.level !== 'Reply' || comment.parentRealId || comment.parentLevel !== 'Reply' || !comment.parentAuthor) {
          continue;
        }

        const parentName = comment.parentAuthor.toLowerCase().replace(/\s+/g, ' ').trim();
        const matchingReplies = comments.slice(0, index).filter(candidate =>
          candidate.level === 'Reply' &&
          candidate.realId &&
          candidate.accountName.toLowerCase().replace(/\s+/g, ' ').trim() === parentName
        );
        const parentReply = comment.parentUserId
          ? matchingReplies.find(candidate => candidate.userId && candidate.userId.toLowerCase() === comment.parentUserId.toLowerCase())
          : matchingReplies.length === 1 ? matchingReplies[0] : null;
        if (parentReply) {
          comment.parentRealId = parentReply.realId;
          comment.parentId = parentReply.realId;
        }
      }
    }

    extractProfileUserId(href) {
      try {
        const url = new URL(href, window.location.href);
        if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return '';
        const numericId = url.searchParams.get('id');
        if (numericId) return numericId;

        const slug = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] || '');
        const excludedPaths = new Set([
          'events', 'groups', 'hashtag', 'pages', 'permalink', 'photo', 'profile.php',
          'reel', 'story', 'videos', 'watch'
        ]);
        return slug && !excludedPaths.has(slug.toLowerCase()) ? slug : '';
      } catch (e) {
        return '';
      }
    }

    parseCommentPermalink(href) {
      try {
        const url = new URL(href, window.location.href);
        const commentId = url.searchParams.get('comment_id') || '';
        const replyCommentId = url.searchParams.get('reply_comment_id') || '';
        return {
          commentId: /^\d+$/.test(commentId) ? commentId : '',
          replyCommentId: /^\d+$/.test(replyCommentId) ? replyCommentId : ''
        };
      } catch (e) {
        return { commentId: '', replyCommentId: '' };
      }
    }

    normalizePublishedAt(value) {
      const normalized = String(value || '').replace(/\u202f/g, ' ').replace(/\s+/g, ' ').trim();
      const match = normalized.match(/(?:^[A-Za-z]+,\s*)?([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      if (!match) return '';

      const months = {
        jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
        apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
        aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
        nov: 11, november: 11, dec: 12, december: 12
      };
      const month = months[match[1].toLowerCase()];
      const day = Number(match[2]);
      const year = Number(match[3]);
      let hour = Number(match[4]);
      const minute = Number(match[5]);
      const meridiem = match[6].toUpperCase();
      if (!month || day < 1 || day > 31 || hour < 1 || hour > 12 || minute > 59) return '';
      if (meridiem === 'PM' && hour !== 12) hour += 12;
      if (meridiem === 'AM' && hour === 12) hour = 0;

      const localDateTime = Date.UTC(year, month - 1, day, hour, minute, 0);
      const localDate = new Date(localDateTime);
      if (localDate.getUTCFullYear() !== year || localDate.getUTCMonth() !== month - 1 || localDate.getUTCDate() !== day) {
        return '';
      }

      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
      });
      let utcTime = localDateTime;
      for (let attempt = 0; attempt < 4; attempt++) {
        const parts = Object.fromEntries(formatter.formatToParts(new Date(utcTime))
          .filter(part => part.type !== 'literal')
          .map(part => [part.type, Number(part.value)]));
        const formattedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
        const adjustedUtcTime = utcTime + (localDateTime - formattedAsUtc);
        if (adjustedUtcTime === utcTime) break;
        utcTime = adjustedUtcTime;
      }

      return new Date(utcTime).toISOString().replace(/\.000Z$/, 'Z');
    }

    /**
     * Extract structured data from a single comment DOM element
     */
    extractSingleComment(el) {
      if (this.isInsideForbiddenContainer(el)) {
        return null;
      }

      const ariaLabel = (el.getAttribute('aria-label') || '').trim();

      // Skip post wrapper container if this represents the main post itself
      if (ariaLabel.toLowerCase().includes('post by') && !ariaLabel.toLowerCase().includes('comment')) {
        return null;
      }
      if (ariaLabel.toLowerCase() === 'story') {
        return null;
      }

      if (this.permalinkDebugCount < 5) {
        const rawPermalinks = Array.from(el.querySelectorAll('abbr, a[href]'))
          .filter(node => node.closest('div[role="article"]') === el)
          .map(node => {
            const link = node.matches('a') ? node : node.closest('a');
            const href = link?.getAttribute('href') || '';
            const ariaLabel = link?.getAttribute('aria-label') || node.getAttribute('aria-label') || '';
            const text = (node.innerText || node.textContent || '').trim();
            const looksLikeTimestamp = node.tagName === 'ABBR' ||
              /(?:reply_)?comment_id=\d+/i.test(href) ||
              /\b(?:\d+(?:\.\d+)?\s*[smhdwy]|just now|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(`${ariaLabel} ${text}`);
            return looksLikeTimestamp ? { href, ariaLabel } : null;
          })
          .filter(Boolean);
        console.debug('[FBEasy] Raw timestamp permalink candidates', {
          commentIndex: this.permalinkDebugCount + 1,
          rawPermalinks
        });
        this.permalinkDebugCount++;
      }

      // Timestamp / Date (scoped to direct article)
      let formattedTime = '';
      let timestamp = '';
      let publishedAt = '';
      const timeLink = Array.from(el.querySelectorAll('a[aria-label][href*="comment_id="], a[aria-label][href*="reply_comment_id="], abbr[aria-label], abbr[datetime], abbr[title]'))
        .find(node => node.closest('div[role="article"]') === el);
      if (timeLink) {
        formattedTime = (timeLink.innerText || timeLink.textContent || '').trim();
        const dateLabel = timeLink.getAttribute('aria-label') || '';
        publishedAt = this.normalizePublishedAt(dateLabel);
        if (!publishedAt) {
          const dateTime = timeLink.getAttribute('datetime') || '';
          if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(dateTime)) {
            const timestampValue = Date.parse(dateTime);
            if (!Number.isNaN(timestampValue)) publishedAt = new Date(timestampValue).toISOString();
          }
        }
      }
      if (!formattedTime) {
        const timeMatch = (el.innerText || '').match(/\b(\d+[mhdwy]|Just now|Yesterday|\d{1,2}\s+[A-Za-z]+\s+at\s+\d{1,2}:\d{2})\b/);
        if (timeMatch) {
          formattedTime = timeMatch[0];
        }
      }

      // Author extraction: search all links belonging directly to this comment article
      let authorName = '';
      let authorProfileUrl = '';
      let userId = '';

      const directLinks = Array.from(el.querySelectorAll('a')).filter(a => a.closest('div[role="article"]') === el);
      
      // 1. First pass: find a link that contains text (author name link), skipping empty avatar images
      for (const link of directLinks) {
        const text = (link.innerText || link.textContent || '').trim();
        if (text && text.length >= 2 && !['like', 'reply', 'share', 'view', 'see more', 'react', 'edited'].includes(text.toLowerCase())) {
          const cleaned = this.cleanAccountName(text);
          if (cleaned && cleaned !== 'Anonymous') {
            authorName = cleaned;
            authorProfileUrl = link.href || '';
            break;
          }
        }
      }

      // 2. Also harvest userId and authorProfileUrl from any profile link (even avatar)
      for (const link of directLinks) {
        const href = link.getAttribute('href') || '';
        const profileUserId = this.extractProfileUserId(href);
        if (profileUserId) {
          userId = profileUserId;
          if (!authorProfileUrl) authorProfileUrl = link.href;
          break;
        }
      }

      // 3. Fallback: check direct bold/strong/heading elements
      if (!authorName) {
        const strongNodes = Array.from(el.querySelectorAll('strong, b, h3, h4, span[dir="auto"]'))
          .filter(n => n.closest('div[role="article"]') === el);
        for (const node of strongNodes) {
          const text = (node.innerText || node.textContent || '').trim();
          if (text && text.length >= 2 && !['like', 'reply', 'share', 'view more', 'see more', 'top fan', 'author'].includes(text.toLowerCase())) {
            const cleaned = this.cleanAccountName(text);
            if (cleaned && cleaned !== 'Anonymous') {
              authorName = cleaned;
              break;
            }
          }
        }
      }

      // 4. Fallback: check aria-label e.g. "Comment by John Doe 2 hours ago"
      if (!authorName && ariaLabel) {
        const m = ariaLabel.match(/(?:comment|reply)\s+by\s+(.+?)(?:\s+(?:just now|\d+\s*(?:m|min|mins|h|hr|hrs|d|day|days|w|wk|wks|mo|yr)|yesterday|today|a\s+(?:minute|hour|day)|·)|$)/i);
        if (m && m[1]) {
          authorName = this.cleanAccountName(m[1]);
        }
      }

      const accountName = authorName || 'Anonymous';

      // Comment Text: find elements with dir="auto" or paragraph/span DIRECTLY belonging to this article
      let commentText = '';
      const textContainers = Array.from(el.querySelectorAll('div[dir="auto"], span[dir="auto"]'))
        .filter(container => container.closest('div[role="article"]') === el);

      for (const container of textContainers) {
        const text = (container.innerText || container.textContent || '').trim();
        if (text &&
            text !== accountName &&
            !['like', 'reply', 'share', 'edited', 'react', 'see translation', 'write a reply...', 'write a comment...'].includes(text.toLowerCase()) &&
            !/^\d+\s+(reply|replies)$/i.test(text) &&
            !/^\d+[mhdws]$/i.test(text)) {
          if (text.length > commentText.length) {
            commentText = text;
          }
        }
      }

      if (!commentText) {
        const allText = el.innerText || '';
        const lines = allText.split('\n').map(l => l.trim()).filter(Boolean);
        const candidateLines = lines.filter(l =>
          l !== accountName &&
          !['like', 'reply', 'share', 'view more', 'see more'].includes(l.toLowerCase())
        );
        commentText = candidateLines.join(' ');
      }

      if (!commentText || commentText.trim().length === 0) {
        return null;
      }

      // Extract real Facebook comment ID if present in permalinks
      const permalinkNodes = Array.from(el.querySelectorAll('a[href*="comment_id="], a[href*="reply_comment_id="]'))
        .filter(node => node.closest('div[role="article"]') === el);
      const permalinkIds = permalinkNodes
        .map(node => this.parseCommentPermalink(node.getAttribute('href') || ''))
        .find(ids => ids.replyCommentId) || permalinkNodes
        .map(node => this.parseCommentPermalink(node.getAttribute('href') || ''))
        .find(ids => ids.commentId) || { commentId: '', replyCommentId: '' };
      const realId = permalinkIds.replyCommentId || permalinkIds.commentId;
      // Determine level (Top-level vs. Reply)
      let level = 'Top-level';
      let parentAuthor = '';
      let parentUserId = '';
      let parentId = '';
      let parentRealId = '';

      const ariaLower = ariaLabel.toLowerCase();
      const parentArticle = el.parentElement ? el.parentElement.closest('div[role="article"]') : null;
      const rootContainer = this.getTargetPostContainer();

      // Facebook wraps all comment reply threads inside a [role="group"] or .replies-container
      const replyGroup = el.parentElement ? el.parentElement.closest('[role="group"], .replies-container, [data-pagelet*="Reply"], [data-pagelet*="replies"]') : null;

      // An article is a parent comment if it is NOT the main post container and has comment aria-labels
      const parentAria = parentArticle ? (parentArticle.getAttribute('aria-label') || '').toLowerCase() : '';
      const isParentComment = parentArticle &&
        parentArticle !== rootContainer &&
        parentArticle !== document.body &&
        (parentAria.includes('comment') || parentAria.includes('komento') || parentAria.includes('kuro-kuro')) &&
        !parentAria.includes('post by') &&
        parentAria !== 'story';

      const isReply = !!replyGroup ||
                      ariaLower.includes('reply') ||
                      ariaLower.includes('sagot') ||
                      ariaLower.includes('tugon') ||
                      isParentComment;
      const parentReference = ariaLabel.match(/\bto\s+(.+?)['’]s\s+(comment|reply)\b/i);
      let parentLevel = '';
      if (parentReference) {
        parentAuthor = this.cleanAccountName(parentReference[1]);
        parentLevel = parentReference[2].toLowerCase() === 'reply' ? 'Reply' : 'Top-level';
        if (parentLevel === 'Reply') {
          const normalizedParentName = parentAuthor.toLowerCase().replace(/\s+/g, ' ').trim();
          const parentProfileLink = directLinks.find(link => {
            const linkedName = this.cleanAccountName(link.innerText || link.textContent || '')
              .toLowerCase().replace(/\s+/g, ' ').trim();
            return linkedName === normalizedParentName && this.extractProfileUserId(link.getAttribute('href') || '');
          });
          parentUserId = this.extractProfileUserId(parentProfileLink?.getAttribute('href') || '');
        }
      }

      if (isReply) {
        level = 'Reply';

        // Find parent comment for author and ID
        let parentComment = null;
        if (replyGroup) {
          parentComment = replyGroup.closest('div[role="article"]');
          if (parentComment === el && replyGroup.parentElement) {
            parentComment = replyGroup.parentElement.closest('div[role="article"]');
          }
        } else if (isParentComment) {
          parentComment = parentArticle;
        }

        if (parentComment && parentComment !== el) {
          const pAuthorLink = parentComment.querySelector('a[role="link"], a[href*="facebook.com"]');
          if (pAuthorLink) {
            const domParentAuthor = this.cleanAccountName(pAuthorLink.innerText || pAuthorLink.textContent || '');
            if (domParentAuthor && domParentAuthor !== 'Anonymous') parentAuthor = domParentAuthor;
          }
          const parentPermalink = Array.from(parentComment.querySelectorAll('a[href*="comment_id="], a[href*="reply_comment_id="]'))
            .find(node => node.closest('div[role="article"]') === parentComment);
          const parentIds = this.parseCommentPermalink(parentPermalink?.getAttribute('href') || '');
          parentRealId = parentIds.replyCommentId || parentIds.commentId;
          parentId = parentRealId;
        }
        if (!parentRealId && permalinkIds.replyCommentId && parentLevel !== 'Reply') {
          parentRealId = permalinkIds.commentId;
          parentId = parentRealId;
        }
      }

      // Reaction / Like Count (scoped to direct article)
      const likeCount = this.extractReactionCount(el);

      // Reply Count (for top-level comments)
      let replyCount = '';
      if (level === 'Top-level') {
        const replyMatches = (el.innerText || '').match(/(\d+)\s+repl(y|ies)/i);
        const childArticles = el.querySelectorAll('div[role="article"]').length;

        if (replyMatches) {
          replyCount = replyMatches[1];
        } else if (childArticles > 0) {
          replyCount = String(childArticles);
        }
      }

      // Gender inference
      const contextText = `${ariaLabel} ${el.innerText || ''}`;
      const gender = this.inferGender(accountName, contextText);

      // Media attachment
      const hasImage = el.querySelector('img:not([alt*="profile"]):not([alt*="avatar"])') !== null;

      // Deterministic ID (no Date.now or Math.random)
      const authorKey = (userId && userId !== 'N/A') ? userId.toLowerCase() : accountName.toLowerCase().trim();
      const textNorm = commentText.replace(/\s+/g, ' ').trim().toLowerCase();
      const commentId = realId
        ? `fb_${realId}`
        : `c_${authorKey}_${level === 'Reply' ? 'r' : 't'}_${this.hashString(textNorm.slice(0, 70))}`;

      return {
        id: commentId,
        realId: realId || '',
        parentRealId,
        accountName,
        userId: userId || 'N/A',
        gender,
        authorName: accountName,
        authorProfileUrl: authorProfileUrl || '',
        commentText: commentText.trim(),
        likeCount,
        replyCount,
        level,
        parentId,
        parentAuthor,
        parentUserId,
        parentLevel,
        timestamp: timestamp || '',
        formattedTime: formattedTime || '',
        publishedAt,
        reactionCount: likeCount,
        mediaAttached: hasImage ? 'Yes' : 'No',
        postUrl: window.location.href
      };
    }

    /**
     * Extract reaction count from comment element badges and aria-labels
     */
    extractReactionCount(el) {
      // 1. Search for elements with aria-label mentioning reactions or likes
      const reactionNodes = Array.from(el.querySelectorAll('[aria-label*="reaction" i], [aria-label*="reacted" i], [aria-label*="like" i], [role="toolbar"]'))
        .filter(node => node.closest('div[role="article"]') === el);

      for (const node of reactionNodes) {
        const aria = (node.getAttribute('aria-label') || '').trim();
        const text = (node.innerText || node.textContent || '').trim();

        // Pattern 1: aria-label contains count: "14 reactions", "Like: 12 people", "25"
        const m1 = aria.match(/(\d+[\d,.]*[kKmM]?)\s*(?:reaction|people|like)?/i);
        if (m1 && m1[1] && m1[1] !== '0') {
          return m1[1];
        }

        // Pattern 2: node innerText has count: "14", "1.2K"
        const m2 = text.match(/(\d+[\d,.]*[kKmM]?)/);
        if (m2 && m2[1] && m2[1] !== '0') {
          return m2[1];
        }
      }

      // 2. Search for any button or span in the comment that is purely a number or K/M (e.g. "12", "1.5K")
      const badgeNodes = Array.from(el.querySelectorAll('span, div[role="button"]'))
        .filter(node => node.closest('div[role="article"]') === el);

      for (const node of badgeNodes) {
        const text = (node.innerText || node.textContent || '').trim();
        if (/^(\d+[\d,.]*[kKmM]?)$/.test(text)) {
          return text;
        }
      }

      return '';
    }

    /**
     * Infer gender based on account name, prefixes, and pronoun context
     */
    inferGender(name, contextText = '') {
      if (!name || name === 'Anonymous') return 'Not Disclosed';

      const firstName = name.trim().split(/\s+/)[0].toLowerCase();
      const ctx = (contextText || '').toLowerCase();

      // 1. Context pronoun matching
      if (/\b(his\s+comment|to\s+his\s+post|his\s+reply|he\s+said|he\s+wrote)\b/.test(ctx)) {
        return 'Male (Inferred)';
      }
      if (/\b(her\s+comment|to\s+her\s+post|her\s+reply|she\s+said|she\s+wrote)\b/.test(ctx)) {
        return 'Female (Inferred)';
      }

      // 2. Titles / Prefixes
      if (/^(mr|sir|bro|kuya|tatay|lolo|boy)\b/i.test(name)) return 'Male (Inferred)';
      if (/^(ms|mrs|maam|ma'am|ate|nanay|lola|girl)\b/i.test(name)) return 'Female (Inferred)';

      // 3. Common Filipino and International name dictionaries
      const maleNames = new Set([
        'john', 'james', 'michael', 'david', 'robert', 'joseph', 'daniel', 'juan', 'jose',
        'carlos', 'mark', 'rj', 'emmanuel', 'christian', 'paolo', 'gabriel', 'joshua', 'angelo',
        'justin', 'noel', 'kevin', 'jason', 'ryan', 'richard', 'edward', 'paul', 'brian',
        'eric', 'kenneth', 'jonathan', 'alexander', 'peter', 'andrew', 'anthony', 'matthew',
        'jorge', 'luis', 'miguel', 'pedro', 'antonio', 'francisco', 'rafael', 'fernando',
        'alberto', 'victor', 'manuel', 'ramon', 'eduardo', 'ricardo', 'salvador', 'cesar',
        'rodrigo', 'enrique', 'arturo', 'felipe', 'gustavo', 'alfredo', 'ernesto', 'humberto',
        'raul', 'gerardo', 'julio', 'oscar', 'armando', 'hector', 'sergio', 'alejandro',
        'marlon', 'carlo', 'jay', 'renato', 'rodolfo', 'ronaldo', 'dante', 'danilo',
        'edwin', 'elmer', 'eugene', 'ferdinand', 'gilbert', 'ian', 'joel', 'jun', 'leo',
        'nestor', 'reymund', 'reynaldo', 'rodel', 'rodrigo', 'rolando', 'rommel', 'ronnie',
        'rowel', 'samuel', 'vincent', 'wilfredo', 'benjamin', 'christopher', 'edgar', 'alden',
        'bong', 'dingdong', 'gerald', 'jericho', 'piolo', 'vic', 'tito', 'joey'
      ]);

      const femaleNames = new Set([
        'maria', 'mary', 'sarah', 'jessica', 'jennifer', 'elizabeth', 'patricia', 'linda',
        'karen', 'michelle', 'emily', 'anna', 'joy', 'bea', 'nicole', 'angel', 'christine',
        'princess', 'rose', 'grace', 'katherine', 'samantha', 'rachel', 'diane', 'stephanie',
        'melissa', 'rebecca', 'kimberly', 'angela', 'laura', 'sharon', 'cynthia', 'kathleen',
        'amy', 'shirley', 'angela', 'helen', 'anna', 'brenda', 'pamela', 'nicole', 'samantha',
        'katherine', 'christine', 'debra', 'rachel', 'carolyn', 'janet', 'catherine', 'maria',
        'heather', 'diane', 'virginia', 'julie', 'joyce', 'victoria', 'olivia', 'kelly',
        'cristina', 'ana', 'carmen', 'rosa', 'isabel', 'lucia', 'elena', 'teresa', 'claudia',
        'paula', 'alicia', 'monica', 'patricia', 'susana', 'gloria', 'marina', 'leticia',
        'mercedes', 'lorena', 'silvia', 'yolanda', 'maricel', 'rowena', 'marites', 'arceli',
        'chona', 'divina', 'florencia', 'imelda', 'jocelyn', 'leilani', 'lorna', 'lourdes',
        'marilou', 'nerissa', 'remedios', 'rosario', 'vilma', 'zenaida', 'charito', 'cherry',
        'regine', 'sarah', 'judy', 'claudine', 'kris', 'marian', 'heart', 'nadine', 'kathryn',
        'anne', 'liza', 'gwen', 'ivana', 'pia', 'catriona'
      ]);

      if (maleNames.has(firstName)) return 'Male (Inferred)';
      if (femaleNames.has(firstName)) return 'Female (Inferred)';

      return 'Not Disclosed';
    }
  }

  // Initialize scraper singleton
  window.__fbScraperInstance = new CommentScraper();
  console.log('[FBEasyCommentExporter] Comment Scraper Content Script Loaded.');
})();
