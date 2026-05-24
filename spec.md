# S2NRatio - Chrome Extension v0.1 Spec

## Version
v0.1 - Initial MVP Architecture, updated through extension version 0.1.10

## Goals for v0.1
- Accurate tracking of time spent on the currently active (visible) browser tab only.
- Automatic classification of websites into Signal (work/productive) or Noise (leisure).
- Manual override capability via quick popup for context-aware decisions.
- Daily summary view showing Signal-to-Noise ratio percentage and time breakdowns.
- All data stored locally with daily reset.
- Simple, performant, privacy-respecting implementation using Manifest V3.

## High-Level Architecture

### Chrome Extension Structure (Manifest V3)
- **manifest.json**: Defines permissions, background service worker, content scripts, popup, icons, and action.
- **Background Service Worker** (`background.js` or `sw.js`): Core logic for tab monitoring, timer management, classification, storage, and message handling.
- **Content Script** (`content.js`): Injected into every page to detect visibility changes, send active tab info, and handle the override popup.
- **Popup** (`popup.html` + `popup.js`): The dashboard shown when the extension icon is clicked. Displays ratio, lists, and controls.
- **Options Page** (optional for v0.1, `options.html`): Basic settings for custom rules or day reset time.
- **Icons**: 16px, 48px, 128px for different states (maybe color-coded for Signal/Noise).

### Permissions Required (manifest.json)
```json
{
  "permissions": [
    "tabs",
    "storage",
    "alarms",
    "idle"
  ],
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content.js"],
      "run_at": "document_start"
    }
  ]
}
```
- `tabs`: To query active tab and listen to tab events (background monitoring).
- `storage`: For persisting settings, daily data, siteRules, and temporary session/debug state.
- `alarms`: For heartbeat to keep service worker state fresh during active sessions, badge refresh, and midnight reset.
- `idle`: To avoid counting abandoned tabs while the computer is idle or locked. Recent tab activity and active media playback can keep a visible tab engaged inside the configured activity timeout.
- Static `<all_urls>` content script match: required for the local classifier prompt, page visibility/activity listeners, and media playback detection on visited pages. The manifest intentionally does not use separate `host_permissions`, `activeTab`, or `scripting` permissions in the current static-content-script design.
- Content scripts declared statically for reliable injection on every page load. Current manifest does not set `all_frames`; media detection is expected to work for normal top-level YouTube/Facebook/social video pages, but embedded iframe-only players may require `all_frames: true` in a future release.

### Service Worker Lifecycle Management (NEW - Critical for Accuracy)
Manifest V3 service workers are terminated by Chrome after ~30 seconds of inactivity. To prevent loss of current session timing:

- Persist `currentSession` to `chrome.storage.session` (ephemeral, survives worker restarts) on every state change.
- On service worker wake (e.g., on tab event or alarm), read persisted `currentSession`, calculate elapsed time since `startTime`, close the old session, and start new if applicable.
- Use `chrome.alarms` with a 30-second heartbeat during active sessions to keep session state fresh and run bounded activity checks.
- Use `Date.now()` exclusively for all timestamps (wall-clock, survives restarts). Never use `performance.now()` in the background worker.
- Add explicit recovery logic in background startup: if `currentSession` exists and startTime is recent (<5min), calculate and persist duration, then clear or update.

This ensures no time is lost when the worker is killed mid-session.

### Key Components

#### 1. Tab & Visibility Monitoring (Background + Content Script)
- Use `chrome.tabs.onActivated`, `chrome.tabs.onUpdated`, `chrome.windows.onFocusChanged`.
- Content script listens for `document.visibilityState` changes (`visible` / `hidden`).
- Only the foreground, visible tab in the *focused* Chrome window accumulates time. When multiple windows are open, only the active tab in the focused (frontmost) window accumulates time.
- Background worker maintains a single "current session" object persisted to `chrome.storage.session`:
  - `tabId`
  - `domain` (NEVER full URL — see Data Storage)
  - `startTime`
  - `classification` (signal | noise)
- When tab changes or visibility changes to hidden, end current session, classify if needed, and persist the duration to dailyData.
- Content script sends `{ type: "VISIBILITY_CHANGE", visible: boolean, tabId: number, domain: string }` to background. Background is the single source of truth and arbitrates all session transitions.

#### 2. Classification Engine
- **Rule-based defaults** (hardcoded in v0.1, stored in storage for future editing):
  - **Signal defaults**:
    - Domains: `gmail.com`, `outlook.com`, `mail.google.com`, `zoom.us`, `notion.so`, `linear.app`, `calendar.google.com`, `docs.google.com`, `github.com`, `slack.com`, `meet.google.com`
    - Patterns: email providers, video conferencing, productivity SaaS, work tools. (Removed conditional "when in work repos" as it cannot be implemented in rule-based v0.1 without AI.)
  - **Noise defaults**:
    - Domains: `youtube.com`, `x.com`, `twitter.com`, `facebook.com`, `instagram.com`, `reddit.com`, `tiktok.com`, `netflix.com`, `twitch.tv`
    - Patterns: social media, video entertainment, news feeds.
- **Default for unknown domains**: Unknown domains default to Signal (optimistic). Current implementation can prompt for every new/unclassified site or only default Noise sites based on settings.
- **Override logic**:
  - On page load for an eligible site with no saved always/today rule, content script shows a small floating popup (positioned bottom-right or as a toast).
  - Popup contains:
    - Current classification label + site name.
    - Two prominent buttons: "Count as Signal" and "Count as Noise".
    - Default selection highlighted based on rules (social = Noise button pre-selected, email/zoom = Signal pre-selected).
  - User click immediately updates the current session classification and saves an always or today-only site-level rule.
  - "Remember always" is selected by default and saves to `siteRules`.
  - "Remember today" is optional and saves a date-scoped rule to `todaySiteRules`.
  - Show override popup only when no saved always/today rule exists for this domain. If a rule exists, skip the popup.
- Site rules stored as `siteRules: { "x.com": "signal", "youtube.com": "noise" }` in chrome.storage.local.
- Today-only rules stored as `todaySiteRules: { "YYYY-MM-DD": { "x.com": "signal" } }` in chrome.storage.local and pruned on day rollover.
- Domain extraction: Use `new URL(url).hostname` stripped of 'www.'. Use registered domain matching (subdomains inherit). Path-based classification is post-v0.1.
- No regex in user rules for v0.1. Only exact domain matching with `===` or `endsWith()`. Domain keys validated against hostname regex: `/^[a-z0-9]+([\\-\\.]{1}[a-z0-9]+)*\\.[a-z]{2,}$/`. Max 500 custom rules. Values exactly "signal" or "noise".

#### 3. Timer & Session Logic
- Timer only runs while:
  - Browser window is focused.
  - Tab is active and `visibilityState === 'visible'`.
  - The tab has recent engagement if `requireActivityToTrack` is enabled. Engagement sources are page input events (`pointerdown`, `keydown`, `scroll`, `wheel`, `touchstart`, `mousemove`), browser-level activation/navigation, and active media playback.
- The default inactivity timeout is 120 seconds. Before v0.1.10, passive video watching could stop at roughly 2 minutes because YouTube/Reels/Facebook video playback did not refresh tab activity. Current behavior treats visible playing `<video>`/`<audio>` elements as `media-playback` engagement, so video/audio should continue counting while it is actively playing.
- Media playback detection runs in the top-level content script. Normal YouTube/Facebook/social video pages should be covered; iframe-only embedded players remain a known caveat unless `all_frames: true` is added later.
- Use `Date.now()` exclusively for timestamps.
- Sessions are short-lived: created on tab activation/visibility change, ended on tab switch or visibility hidden.
- Debounce: Tab switches within 1 second are debounced. Timer does not start a new session until the active tab has been stable for 1 second. Very short glances (<1s) are attributed to the previous session.
- Aggregate into daily buckets (see Data Storage).
- "Off the web" tracking: For v0.1, "off the web" (Signal when browser not active) is best-effort using `chrome.windows.onFocusChanged` returning `WINDOW_ID_NONE`. Gaps between sessions >5 seconds may be attributed to "off the web". This is acknowledged as approximate; false positives possible. Future versions may improve detection.

#### 4. Data Storage Model
Use `chrome.storage.local` for durable data and `chrome.storage.session` for ephemeral runtime state with the following structure:
- `currentSession`: Stored in `chrome.storage.session` for ephemerality: { tabId, domain, startTime, classification, lastActivityAt }
- `tabActivity`: Stored in `chrome.storage.session`, keyed by tab id, tracking normalized domain plus recent activity timestamps and source.
- `trackingDebugLog`: Temporary `chrome.storage.session` ring buffer of recent tracking events for troubleshooting. It records event names, normalized domains, timestamps, tab ids, reasons, and durations, but not full URLs or page content.
- `dailyData`: Map keyed by date string (YYYY-MM-DD). Each day resets at midnight local time or configurable `dayStartHour`.
- `siteRules`: Persistent user overrides.
- `todaySiteRules`: Date-scoped user overrides for "Remember today".
- `settings`: { dayStartHour: 0, showPopup: true, autoClassify: true, schemaVersion: 1 }

Helper functions:
- `getTodayKey()`: Returns current date string adjusted by dayStartHour.
- `calculateRatio(signalMs, noiseMs)`: Returns percentage (signal / (signal + noise) * 100).
- `formatDuration(ms)`: "3h 28m" or "1h 11m".
- `extractDomain(url)`: Returns registered domain only (never full URL, paths, or query strings).

**Reclassification semantics**: When a user overrides classification, only time from the current session is moved from noise to signal buckets. Previously completed sessions retain their original classification.

**Midnight Reset**: At midnight (or dayStartHour), the current session is ended, its duration attributed to the ending day, and a new session starts for the new day. Use `chrome.alarms` to trigger rollover. Old daily data retained for 7 days then pruned.

**Error handling**: Every `chrome.storage.local.set()` must check `chrome.runtime.lastError`. If quota exceeded, prune oldest day and retry. Wrap in try/catch. Max retention 30 days to prevent unbounded growth.

**Privacy**: Only normalized domains and timing/activity metadata are stored, never full URLs, paths, query params (which could contain tokens), page titles, page contents, keystroke contents, or media titles. Plaintext Chrome storage is a known limitation for v0.1; consider encryption in future.

#### 5. Popup Dashboard (popup.html + popup.js)
- Clean, minimal design (plain CSS for lightness — no Tailwind in v0.1 to meet <200KB and no-dependency constraints).
- Header: "S2NRatio" + big percentage circle or bar (e.g., 68% Signal).
- Two columns or tabs:
  - **Signal** (green accent): List of activities with time. Sorted by duration desc. "off the web" always prominent.
  - **Noise** (red/orange accent): Similar list.
- Footer: Total tracked time today, "Reset Today" button (requires explicit confirmation dialog), link to options.
- Real-time update: Popup loads data on open via `GET_DAILY_DATA`. While open, polls every 5 seconds for updates. On close, polling stops. Response schema: `{ success: boolean, data?: { date, totalSignalMs, totalNoiseMs, activities, currentSession }, error?: string }`.
- Empty state: When dailyData for today is empty, show welcome message: 'Start browsing to see your Signal-to-Noise ratio.' Hide the ratio circle.

#### 6. Override Popup / Toast
- Injected via content script as a shadow DOM element (`mode: 'closed'`) to avoid site CSS conflicts and host page manipulation.
- Small, elegant card:
  - "This looks like Noise. Quick classification?"
  - Buttons: [Signal] [Noise] with subtle default styling.
  - "Remember always" checkbox selected by default.
  - "Remember today" checkbox unselected by default and mutually exclusive with "Remember always".
- Auto-dismiss after 8 seconds if no interaction, or on tab change.
- Position: fixed bottom: 20px; right: 20px; z-index high (note: arms race with site overlays; prefer native UI in future).
- Visual authenticity: Include extension icon or specific styling hard to replicate.
- All DOM construction uses `textContent`, `createElement` — never `innerHTML`.

#### 7. Background Message API
Messages between popup/content/background use strict schema and sender validation:

- All handlers MUST verify `sender.id === chrome.runtime.id` (own extension only). Reject external messages.
- Declare `"externally_connectable": {}` in manifest (no external messaging).
- Message envelope: `{ type: string, payload?: any }`
- Response format: `{ success: boolean, data?: any, error?: string }`
- Retry: If `chrome.runtime.sendMessage` fails (worker asleep), retry once after 500ms.
- Message types:
  - `GET_DAILY_DATA`: payload none; returns daily aggregates + currentSession.
  - `GET_TRACKING_DEBUG_LOG`: payload none; returns temporary session debug events and runtime tracking state for troubleshooting.
  - `CLEAR_TRACKING_DEBUG_LOG`: payload none; clears the temporary debug event ring buffer.
  - `UPDATE_CLASSIFICATION`: payload { domain, newClassification, remember: boolean }
  - `GET_CURRENT_SESSION`
  - `CLASSIFY_SITE`: payload { url } — URL sanitized to domain only.
  - `VISIBILITY_CHANGE`: payload { visible: boolean, tabId, domain }

All incoming URLs/domains validated and sanitized before processing.

## Implementation Order (Recommended)

1. **Setup**:
   - Create `manifest.json` with correct V3 structure, content_scripts, alarms, CSP.
   - Add icons and basic popup HTML skeleton.
   - Load extension in chrome://extensions (developer mode).

2. **Core Tracking**:
   - Implement background service worker with tab listeners, alarms heartbeat, session persistence to storage.session, recovery on wake.
   - Add content script for visibility detection and VISIBILITY_CHANGE messaging.
   - Build session start/end logic + storage persistence.
   - Test: Switch tabs, hide/show browser, verify only active time is counted, test worker termination recovery.

3. **Classification & Rules**:
   - Implement default rule engine (exact domain matching only).
   - Add siteRules storage and lookup with validation.
   - Build override popup UI in content script (shadow DOM, safe APIs).
   - Wire button clicks to update session and save rule.

4. **Dashboard**:
   - Build popup UI with ratio calculation and activity lists (plain CSS).
   - Connect popup to background for live data with schema.
   - Add duration formatting helpers.

5. **Polish & Edge Cases**:
   - Handle browser restart / extension reload (recover current session if recent).
   - Midnight reset logic with alarms.
   - Incognito: Set `"incognito": "not_allowed"` in manifest for v0.1.
   - Performance: Debounce rapid tab switches (1s window).
   - Error handling for storage quota, lastError.
   - CSP: Add `"content_security_policy": { "extension_pages": "script-src 'self'; object-src 'self'" }` in manifest.

## Data Flow Example
1. User opens Chrome, focuses Gmail tab.
2. Content script detects visible + active, sends VISIBILITY_CHANGE.
3. Background starts session: domain="gmail.com", classification="signal", startTime=Date.now(). Persisted to storage.session.
4. User switches to YouTube.
5. Previous session ends: calculate duration using Date.now(), add to dailyData (only domain).
6. New session for youtube.com starts as "noise".
7. Content script shows override popup because it's default noise and no rule yet.
8. User clicks "Signal" (work research). Session updated, rule saved.
9. User clicks extension icon → popup shows updated lists and 74% Signal ratio.

## Non-Goals for v0.1
- Cloud sync or multi-device.
- AI-based classification (rule-based only).
- Historical charts beyond today.
- Custom categories or tags.
- Notifications or gamification.
- Export data.
- Full "off the web" OS-level detection (best-effort only).

## Technical Constraints
- Keep bundle size tiny (< 200KB unpacked).
- No external dependencies in v0.1 (vanilla JS + plain CSS).
- Use modern Chrome APIs only.
- Support Chrome 120+.
- All time tracking strictly limited to active visible tab in focused window.

## Future Considerations (Post v0.1)
- Options page for editing rules and blacklists.
- Weekly/monthly summaries.
- Export to CSV.
- Integration with calendar or task apps.
- Dark mode and better theming.
- Mobile Chrome support (limited).
- Narrow host permissions.
- AI classification for github repos etc.
- Encryption for storage.

## Testing Strategy
- Manual: Switch between productive and distracting sites, verify timer and overrides.
- Edge cases: Multiple windows, incognito (disabled), browser minimize, tab close, extension reload, service worker termination, midnight rollover, quota exceeded.
- Storage inspection via Chrome DevTools (Application tab → Storage → Local Storage / Session Storage).
- Verify only domain stored, no full URLs.

## Repository Structure (Initial)
```
S2NRatio/
├── AGENTS.md
├── spec.md
├── AUDIT.md
├── manifest.json
├── background.js
├── content.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── utils/
│   ├── classification.js
│   ├── storage.js
│   └── time.js
└── README.md
```

This spec provides a complete blueprint for building a functional v0.1 Chrome extension. Start implementation by creating the manifest and background worker, then layer on the classification and UI components.

All time tracking must be strictly limited to the active visible tab to maintain accuracy and user trust.

## CSP and Security Additions (NEW)
Add to manifest.json:
```json
"content_security_policy": {
  "extension_pages": "script-src 'self'; object-src 'self'"
}
```
All domain names and user input validated before storage and rendering. No innerHTML.

## Message Sender Validation (NEW)
Every background message handler must include:
```js
if (sender.id !== chrome.runtime.id) {
  return; // reject
}
```
Declare externally_connectable empty.

This addresses the main security, architecture, and completeness gaps identified in the initial audit. The spec is now ready for a fresh comprehensive audit.
