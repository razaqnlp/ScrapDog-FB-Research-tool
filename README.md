# ScrapDog

ScrapDog is a Chrome Manifest V3 extension, version 1.1.2, for collecting comments and replies visible on Facebook post and Reel pages and exporting them as CSV. It is not affiliated with or endorsed by Meta or Facebook.

## Demo and Overview

- Watch the walkthrough video: [ScrapDog demo](https://lnkd.in/p/d5Fm-5JW)
- Download the overview document: [ScrapDog Overview.docx](ScrapDog%20Overview.docx)

## Intended Use

ScrapDog is intended by its maintainer for academic and authorized research, such as NLP research on lower-resource languages, sentiment analysis, and social-media studies. It is not intended for commercial scraping, marketing, profiling or tracking people, surveillance, or harassment. These are project-use rules; the extension does not technically enforce them.

## Why ScrapDog for Research

- **Structured output:** the CSV exporter uses stable named fields, normalized counts, and escaping for CSV-special characters to support spreadsheet and data-analysis workflows. Proof: `csv_exporter.js`, `defaultHeaders`, `generateCSV()`.
- **Reply relationships:** reply rows include their immediate `parent_comment_id`, including a tested reply-to-reply chain. Proof: `content_script.js`, `extractSingleComment()`, `resolveReplyParents()`; fixture: `test/fixtures/facebook/reel_1633922011378403_nested.test.html`.
- **Local-time-aware dates:** parseable Facebook aria-label dates are converted from the browser's IANA timezone to ISO 8601 UTC. Proof: `content_script.js`, `normalizePublishedAt()`.
- **Collection context:** an optional key/value query entered in the popup is copied into `collection_query` for each exported row. This is metadata; it does not search Facebook by hashtag. Proof: `popup.js`, `getCollectionQuery()`; `csv_exporter.js`, `generateCSV()`.
- **Unicode-friendly CSV:** exports include a UTF-8 BOM and escape commas, quotation marks, and line breaks. The fixtures include Urdu text, but exhaustive encoding tests for Urdu, Pashto, Hindko, and romanized/code-mixed text have not been performed. Proof: `csv_exporter.js`, `escapeField()` and `generateCSV()`.
- **Review signal for unusual counts:** a `manual_review` value is set when an individual comment's normalized `like_count` exceeds 100,000; the count is retained, not discarded. Proof: `csv_exporter.js`, `getManualReviewFlag()`.

These features support research workflows; they do not ensure completeness, anonymity, legal compliance, or reproducibility of Facebook's changing page data.

## Features

- Start from a Facebook post or Reel URL, or use the active tab.
- Expand available comments, replies, and shortened comment text.
- Choose All Comments, Newest, or Most Relevant when Facebook exposes those options.
- Choose a comment limit of 100, 250, 500, 1,000, or Unlimited.
- Choose a loading pace shown as Safe (1.6 seconds), Normal (1.1 seconds), or Fast (0.7 seconds). The scraper also has additional fixed waits while interacting with the page; these settings do not guarantee a request rate or prevent Facebook throttling.
- Optionally close Messenger interruptions during collection.
- View progress in an in-page overlay, stop while keeping collected results, and download the CSV when ready.
- Review, redownload, or clear recent collection history in the popup.

The expansion loop stops when the user stops it, a configured comment limit is reached, or there have been 10 consecutive cycles without progress. Facebook controls what the current session exposes, so the resulting collection can be partial.

## Requirements

- A current Chromium-based browser with Manifest V3 support, such as Google Chrome.
- A Facebook browser session that can access the target post or Reel.
- Node.js is only needed to run the included Node regression tests; the extension has no dependency-install or build step.

The extension runs on matching Facebook pages and reads the page DOM available in the current browser session. It does not restrict collection to public posts in code, and it does not bypass Facebook login, permissions, or access controls. Follow the public/authorized-use policy above.

## Install for Development

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this project folder, the one containing `manifest.json`.
4. Sign in to Facebook in the browser if needed, then open a post or Reel you are authorized to research.
5. Open ScrapDog, enter the post URL or choose **Use this tab**, set options, and select **Start scraping**.

After changing extension files, choose **Reload** on its card at `chrome://extensions`. Refresh the Facebook tab too so the new content script is injected.

## Collection Query

The popup has two optional text fields. For example:

```text
hashtag : #pashtofunny
```

ScrapDog combines them as `hashtag: #pashtofunny` and repeats that text in the `collection_query` column for every CSV row. It is descriptive metadata only: it does not discover posts or filter comments by hashtag. If both fields are empty, `collection_query` is empty.

## CSV Schema

CSV columns are emitted in this exact order:

| Column | Contents | Example |
| --- | --- | --- |
| `record_id` | `facebook_<comment_id>` when a native ID exists; otherwise a generated hash-based ID | `facebook_886141177568186` |
| `platform` | Platform identifier | `facebook` |
| `record_type` | Record kind | `comment` or `reply` |
| `comment_id` | Native Facebook comment ID when found | `886141177568186` |
| `parent_comment_id` | Immediate parent comment/reply ID; empty for top-level comments or when unavailable | `1243082430647571` |
| `content_id` | Post/Reel ID extracted from the URL | `1633922011378403` |
| `content_url` | URL of the post or Reel being collected | `https://www.facebook.com/reel/1633922011378403` |
| `text_raw` | Comment text read from the rendered page; outer whitespace is trimmed | `[visible comment text]` |
| `id_status` | Whether a native comment ID was found | `native` or `missing` |
| `author_id_hash` | Deterministic SHA-256 digest derived from the detected author identifier | `[64-character digest]` |
| `author_id_type` | Whether the detected author identifier looked numeric or like a vanity path | `facebook_id`, `vanity`, or empty |
| `published_at` | Parseable comment date normalized to an ISO 8601 UTC timestamp | `2026-10-01T00:19:00Z` |
| `collected_at` | UTC time when the CSV is generated | `2026-10-01T11:15:34.694Z` |
| `like_count` | Normalized reaction count when found | `2` |
| `manual_review` | Warning text if `like_count` is greater than 100,000 | `Review like_count: 14000000 exceeds 100000` |
| `reply_count` | Normalized reply count when available | `3` |
| `collection_query` | Optional popup query metadata | `hashtag: #pashtofunny` |
| `scraper_version` | Manifest version used for the export | `1.1.2` |
| `selector_fingerprint` | Identifier for the current DOM extraction schema | `facebook-comments-dom-v1` |

Missing values are empty CSV cells. `record_id`, comment IDs, parent IDs, content IDs, author hashes, and the selector fingerprint are prefixed with an apostrophe in CSV output so spreadsheet software treats them as text. This prefix is a spreadsheet-safety measure, not part of the logical identifier.

Only CSV export is implemented. JSONL, Parquet, a separate content/metadata table, hashtag discovery, and raw Facebook API-response archival are not implemented.

## Data and Privacy

### What the Extension Reads

The content script reads visible comment text, author display names and profile links/IDs, timestamps, reaction/reply indicators, and page URLs from Facebook's rendered DOM. It also inspects whether a comment contains an image element, but does not export or download image or video data. It does not collect friend lists or crawl user profiles as a separate feature.

The author display name, profile link, and raw detected author ID are not separate CSV columns. However, the CSV does contain comment IDs, parent comment IDs, content IDs/URLs, and `author_id_hash`. Comment text itself may contain names, contact details, or other identifying information.

`author_id_hash` is an unsalted, deterministic SHA-256 hash of the detected identifier with a fixed namespace prefix. The same identifier produces the same hash; likely identifiers can be tested against the hash. It is pseudonymous, not anonymized, and must not be treated as a privacy guarantee. `record_id` and the comment/content IDs can also be linkable to Facebook content.

### Storage and Network Behavior

- The source code has no application-server upload, analytics, or telemetry endpoint for collected comments. The content script sends records to the extension's own background service worker through Chrome runtime messaging.
- Job state and recent progress previews are saved in `chrome.storage.local`. Previews can contain author display names and comment-text snippets; the last CSV and recent history are also stored locally in extension storage.
- Recent history is pruned after 30 days and capped at 50 entries. The popup provides **Clear All**. Clearing extension history does not delete CSV files already downloaded by the browser.
- Preferences, including the collection query, are stored in `chrome.storage.sync`; Chrome may synchronize these settings according to the user's browser account settings.
- CSV files are generated in the extension/browser and downloaded through Chrome. Facebook itself still receives the browser requests needed to load Facebook pages. The manifest also declares Chrome's standard extension update URL.

### Test Data Privacy

Raw Facebook HTML samples used during local parser verification contain real display names, profile URLs, comment IDs, timestamps, and comment text. Those samples are excluded from the public repository by `.gitignore`. Do not publish them or add collected CSVs or other scraped datasets to this repository. The committed CSV exporter tests use synthetic identifiers.

## Responsible Use

- Collect only public posts, or other material for which you have explicit authorization and a valid research basis. The code does not enforce public-only access.
- Do not bypass logins, privacy settings, access controls, or platform restrictions.
- Use reasonable comment limits and loading delays; the controls do not guarantee Facebook will allow a collection to complete.
- Follow Facebook's current terms and policies, your institution's research ethics requirements, and the laws that apply to you.
- Do not publish raw collected data. Before sharing, remove direct comment/content IDs and URLs, review comment text for personal information, and do not assume `author_id_hash` anonymizes people. Share only necessary fields with named collaborators for a defined purpose.

## Known Limitations

- Facebook can change DOM markup, labels, and loading behavior at any time. Selectors or language patterns may stop matching.
- Only comments Facebook renders in the current session can be collected. Hidden, filtered, unavailable, or not-yet-loaded comments may be missed; reply loading may be incomplete.
- Dates are converted to UTC only when Facebook exposes a parseable absolute aria-label date, or an explicitly zoned `datetime` attribute. Relative labels such as `30w` do not provide a calendar timestamp and remain blank.
- Comment text is taken from the rendered DOM, trimmed at the ends, and not translated. Unicode is handled as browser text and CSV uses a UTF-8 BOM, but there is no exhaustive encoding round-trip test for Urdu, Pashto, Hindko, or all romanized/code-mixed content.
- The maximum comment setting offers 100, 250, 500, 1,000, and Unlimited. Current `popup.js` maps a saved value of 100 to Unlimited when restoring settings; verify the selection after reopening the popup if you rely on the 100-comment limit.
- Reaction counts above 100,000 are retained but flagged in `manual_review`; this threshold is a screening aid, not proof that a count is wrong.
- No guarantees are made about completeness, rate-limit avoidance, or stable operation after Facebook changes its interface.

## Permissions

| Permission | Purpose in this extension |
| --- | --- |
| `tabs` | Query, create, focus, and update the target tab; wait for navigation to finish. |
| `activeTab` | Support actions initiated from the extension on the current tab. |
| `scripting` | Inject the scraper into the selected Facebook page when needed. |
| `storage` | Save preferences, current job state, and recent collection history. |
| `unlimitedStorage` | Permit larger job state/history data in extension storage. |
| `downloads` | Download generated CSV files through Chrome. |
| Facebook host access (`facebook.com`, `fb.com`) | Run the content script and access the target page DOM on matching pages. |

## Project Structure

```text
manifest.json
popup.html
popup.css
popup.js
background.js
content_script.js
csv_exporter.js
icons/
  ScrapDog logo.png
test/
  csv_exporter_id_protection.test.js
LICENSE
.gitignore
```

## Development Checks

Node.js is not required to install or use the extension. To run the CSV tests and syntax checks from the project directory:

```sh
node --test test/csv_exporter_id_protection.test.js
node --check popup.js
node --check background.js
node --check content_script.js
node --check csv_exporter.js
```

During development, local-only HTML fixture runners exercised the production content script in a browser DOM, including three-level reply-parent resolution and duplicate-name disambiguation. Their raw Facebook captures are not included in this repository because they contain identifying user data.

## License

This repository includes an Apache License 2.0 `LICENSE` file. Review it before reuse or redistribution.

## Disclaimer

The extension is provided as is, for research and authorized use, without warranty. The maintainer is not responsible for misuse or for data collected or shared by users. This README is informational and is not legal advice.
