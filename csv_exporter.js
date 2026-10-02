/**
 * CSV Exporter for Post Comments
 * Handles RFC-4180 compliance, quote escaping, newlines, and UTF-8 BOM
 * for clean Excel / Numbers / Google Sheets compatibility.
 */

var CSVExporter = {
  defaultHeaders: [
    { key: 'record_id', label: 'record_id' },
    { key: 'platform', label: 'platform' },
    { key: 'record_type', label: 'record_type' },
    { key: 'comment_id', label: 'comment_id' },
    { key: 'parent_comment_id', label: 'parent_comment_id' },
    { key: 'content_id', label: 'content_id' },
    { key: 'content_url', label: 'content_url' },
    { key: 'text_raw', label: 'text_raw' },
    { key: 'id_status', label: 'id_status' },
    { key: 'author_id_hash', label: 'author_id_hash' },
    { key: 'author_id_type', label: 'author_id_type' },
    { key: 'published_at', label: 'published_at' },
    { key: 'collected_at', label: 'collected_at' },
    { key: 'like_count', label: 'like_count' },
    { key: 'manual_review', label: 'manual_review' },
    { key: 'reply_count', label: 'reply_count' },
    { key: 'collection_query', label: 'collection_query' },
    { key: 'scraper_version', label: 'scraper_version' },
    { key: 'selector_fingerprint', label: 'selector_fingerprint' }
  ],

  idLikeColumns: new Set([
    'record_id',
    'comment_id',
    'parent_comment_id',
    'content_id',
    'author_id_hash',
    'selector_fingerprint'
  ]),
  maxPlausibleCommentReactions: 100000,

  async hashValue(value, namespace) {
    if (!value || typeof crypto === 'undefined' || !crypto.subtle) return '';
    const bytes = new TextEncoder().encode(`fbeasy-${namespace}-v1:${value}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  },

  hashAuthorId(authorId) {
    if (!authorId || authorId === 'N/A') return Promise.resolve('');
    return this.hashValue(authorId, 'author');
  },

  normalizeCount(value) {
    if (value === null || value === undefined || value === '') return '';
    const match = String(value).trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)([kmb])?$/i);
    if (!match) return '';
    const multiplier = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] || '').toLowerCase()] || 1;
    return String(Math.round(Number(match[1]) * multiplier));
  },

  getManualReviewFlag(likeCount) {
    const normalizedCount = this.normalizeCount(likeCount);
    if (normalizedCount && Number(normalizedCount) > this.maxPlausibleCommentReactions) {
      return `Review like_count: ${normalizedCount} exceeds ${this.maxPlausibleCommentReactions}`;
    }
    return '';
  },

  extractContentId(contentUrl) {
    if (!contentUrl) return '';
    try {
      const url = new URL(contentUrl);
      for (const key of ['story_fbid', 'fbid', 'v', 'video_id']) {
        if (url.searchParams.has(key)) return url.searchParams.get(key) || '';
      }
      const match = url.pathname.match(/\/(?:reel|posts|videos|permalink)\/([^/?]+)/i);
      return match ? match[1] : '';
    } catch (e) {
      return '';
    }
  },

  getScraperVersion() {
    try {
      return typeof chrome !== 'undefined' && chrome.runtime?.getManifest
        ? chrome.runtime.getManifest().version || ''
        : '';
    } catch (e) {
      return '';
    }
  },

  /**
   * Escape and format a single field value for CSV
   * @param {any} value 
   * @returns {string}
   */
  escapeField(value, protectAsText = false) {
    if (value === null || value === undefined) {
      return '';
    }
    const stringValue = String(value);
    const outputValue = protectAsText && stringValue ? `'${stringValue}` : stringValue;
    // If field contains quotes, commas, newlines, or carriage returns, wrap in quotes and escape internal quotes
    if (/[",\n\r]/.test(outputValue)) {
      return `"${outputValue.replace(/"/g, '""')}"`;
    }
    return outputValue;
  },

  /**
   * Convert an array of comment objects into a formatted CSV string with UTF-8 BOM
   * @param {Array<Object>} comments 
   * @param {Array<string>} [customHeaders]
   * @returns {string}
   */
  async generateCSV(comments, customHeaders = null, metadata = {}) {
    const columns = customHeaders || this.defaultHeaders;

    // Header row
    const headerRow = columns.map(col => this.escapeField(col.label || col.key)).join(',');

    const collectedAt = new Date().toISOString();
    const scraperVersion = this.getScraperVersion();
    const collectionQuery = typeof metadata?.collectionQuery === 'string'
      ? metadata.collectionQuery
      : '';
    const normalizedRows = await Promise.all((comments || []).map(async item => {
      const rawAuthorId = item.userId && item.userId !== 'N/A' ? String(item.userId) : '';
      const contentUrl = item.postUrl || '';
      const likeCount = this.normalizeCount(item.likeCount);
      return {
        record_id: item.realId
          ? `facebook_${item.realId}`
          : `generated_${await this.hashValue(item.id || `${contentUrl}:${item.commentText || ''}`, 'record')}`,
        platform: 'facebook',
        record_type: item.level === 'Reply' ? 'reply' : 'comment',
        comment_id: item.realId || '',
        parent_comment_id: item.parentRealId || '',
        content_id: this.extractContentId(contentUrl),
        content_url: contentUrl,
        text_raw: item.commentText || '',
        id_status: item.realId ? 'native' : 'missing',
        author_id_hash: await this.hashAuthorId(rawAuthorId),
        author_id_type: rawAuthorId ? (/^\d+$/.test(rawAuthorId) ? 'facebook_id' : 'vanity') : '',
        published_at: item.publishedAt || item.timestamp || '',
        collected_at: collectedAt,
        like_count: likeCount,
        manual_review: this.getManualReviewFlag(likeCount),
        reply_count: this.normalizeCount(item.replyCount),
        collection_query: collectionQuery,
        scraper_version: scraperVersion,
        selector_fingerprint: 'facebook-comments-dom-v1'
      };
    }));

    const dataRows = normalizedRows.map(item => columns.map(col =>
      this.escapeField(item[col.key], this.idLikeColumns.has(col.key))
    ).join(','));

    // Combine with UTF-8 Byte Order Mark (\uFEFF)
    return '\uFEFF' + [headerRow, ...dataRows].join('\r\n');
  },

  /**
   * Generates a sanitized filename based on context and current date/time
   * @param {string} [postTitle] 
   * @returns {string}
   */
  generateFileName(postTitle = 'post') {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const sanitizedTitle = (postTitle || 'post')
      .replace(/[^a-zA-Z0-9_\-]/g, '_')
      .slice(0, 30)
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
    
    return `comments_${sanitizedTitle || 'export'}_${dateStr}.csv`;
  },

  /**
   * Trigger download in the browser DOM
   * @param {string} csvContent 
   * @param {string} fileName 
   */
  downloadCSVInBrowser(csvContent, fileName) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', fileName || this.generateFileName());
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
};

if (typeof window !== 'undefined') {
  window.CSVExporter = CSVExporter;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CSVExporter;
}
