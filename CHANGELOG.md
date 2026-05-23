# Changelog

All notable local changes to S2NRatio are documented here.

## 2026-05-23 - Navigation Tracking Regression Fix

### Changed

- Bumped the extension package version to `0.1.9`.
- Fixed post-reset active-site tracking so user-driven tab activations and active-tab URL navigations count as engagement.
- This prevents real browsing sessions from getting stuck at `Awaiting input` and only recording a tiny amount of time after Reset Today clears the previous tab-activity state.

## 2026-05-23 - Audit Gate Bug Fixes

### Changed

- Bumped the extension package version to `0.1.8`.
- Fixed stale live sessions when switching from an engaged tab to a visible tab that has not received real user input yet.
- Fixed day-start rollover attribution so sessions spanning midnight or a custom day boundary are split into the correct local tracking dates.
- Fixed Pause Tracking so off-browser Signal time cannot continue accruing while tracking is paused.
- Fixed off-browser Signal time so idle or locked machine time stops/caps the off-browser session instead of counting raw wall-clock time.
- Fixed idle/locked protection so it still applies when the user disables the per-tab activity requirement.
- Fixed no-activity-gate idle cutoff so it ignores stale tab activity timestamps and stops at the actual idle boundary.
- Fixed heartbeat updates so an alarm cannot restore a stale session after pause, reset, clear, or tab changes.
- Fixed badge refreshes triggered by storage changes so they cannot re-enter session-ending writes.
- Fixed Website list pencil edits so row-level Signal/Noise corrections no longer create permanent site rules.
- Fixed today-only rule precedence so a today parent-domain rule can override a permanent exact subdomain rule for the current day.
- Fixed CSV export so it includes the active live session and skips off-web rows when exporting website-ratio totals.
- Fixed tracking-history and all-data clearing so they go through background cleanup paths that clear live session state before storage changes.
- Removed the extra manifest `host_permissions` entry while keeping the required all-sites content script match.
- Updated README and privacy wording to match engagement-gated tracking, manifest permissions, and Chrome Web Store Limited Use disclosure expectations.

## 2026-05-23 - Pre-Submit Bug Sweep

### Changed

- Bumped the extension package version to `0.1.7`.
- Fixed today-only site rules so `Remember today` overrides a permanent rule for the current tracking day.
- Fixed Settings `Reset Today's Data` so it uses the background reset path, clearing today's tracking, today-only rules, goal-effect state, current session state, and badge state consistently.
- Fixed the background reset path so old live-session time cannot reappear immediately after a reset.
- Fixed CSV export so daily totals and ratios are recalculated from website activities instead of trusting stale aggregate counters.

## 2026-05-23 - Stale Session Duration Guard

### Changed

- Bumped the extension package version to `0.1.6`.
- Fixed a stale-session bug where a new activity event after a long idle/wake gap could make an old tab session look continuously active.
- Stopped page load, focus, and visibility events from counting as engaged website use; only actual page interaction events count for activity-gated tracking.
- Capped live session display and badge math to the last real input window so the popup does not add hours from an abandoned active tab.
- Preserved the existing `Awaiting input` behavior for visible tabs that have not received real page activity yet.

## 2026-05-23 - Toolbar Ratio Badge

### Changed

- Bumped the extension package version to `0.1.5`.
- Renamed the popup ratio label to `Today's Website Signal Ratio` so it is clear the number is daily and website-only.
- Added an optional toolbar badge that shows today's Website Signal Ratio on the extension icon.
- The toolbar badge updates every 60 seconds and also refreshes after tab changes, tracking edits, classification changes, resets, and settings changes.
- The badge background is green when the current site is Signal and red when the current site is Noise.
- Added a Settings checkbox for turning the toolbar ratio badge on or off. It is enabled by default.

## 2026-05-23 - Product Rename, Weekly Average, and Popup Support

### Changed

- Renamed the user-facing extension from `S2NRatio` to `Signal to Noise Ratio`.
- Bumped the extension package version to `0.1.4` for Chrome Web Store upload compatibility after the weekly-average settings work.
- Updated the manifest summary and docs to describe daily and weekly Signal/Noise tracking.
- Added Kevin O'Leary / Steve Jobs focus inspiration context to the README without implying endorsement.
- Replaced the packaged extension icons with the simple Signal/Noise mark.
- Fixed lowest-tier status labels so the popup can show the tier name below the bar.
- Changed the default status tiers to `70% Goal`, `80% Jobs`, and `100% Musk`.
- Added a migration for the previous default tiers so old saved defaults are upgraded without overwriting genuinely custom status tiers.
- Added Settings checkboxes for which weekdays affect the seven-day average.
- Added `Start Average Fresh Today`, which makes the weekly average ignore older days without deleting stored history.
- Added `Use Full 7-Day History` to remove the fresh-start cutoff.
- Added a local storage summary and a trash action for clearing tracking history while keeping settings and site rules.

### Verified

- Ran a headless Brave E2E pass against the unpacked extension in a temporary browser profile.
- Covered manifest load, default classification, remembered parent-domain rules, quick classifier suppression after Remember always, popup ratio math, weekly average, coffee link, row edit/flip/split actions, Settings status-label persistence, and pause/resume tracking.
- Verified weekly-average weekday filtering, fresh-start cutoff behavior, storage summary counts, and tracking-history clearing in a temporary browser profile.

### Added

- Added a seven-day weighted Website Signal Ratio average to the popup.
- Added a main-popup `Buy the creator a coffee` support block, matching the Settings support link.

## 2026-05-22 - Chrome Web Store Prep

### Changed

- Added a public privacy policy for Chrome Web Store review.
- Linked the privacy policy from the README.

## 2026-05-22 - On-Page Goal Popups

### Changed

- Added an active-page popup for the celebration effect when the website Signal ratio crosses above the daily goal.
- Added an active-page popup for the opposite direction when the ratio drops back below the daily goal.
- Reused the existing goal effect settings so users can still turn celebration and below-goal alerts on or off independently.
- Added live-session goal crossing checks on heartbeat so long-running sessions can trigger effects without waiting for the extension popup to open.
- Cleared today's goal effect state when today's data is reset.

## 2026-05-22 - Open Source v0.1 Prep

### Changed

- Added MIT License for the public open-source release.
- Added `.gitignore` for local machine files, environment files, build output, logs, and packaged extension artifacts.
- Added README license section.

## 2026-05-22 - Status Ladder Positioning

### Changed

- Positioned popup status tier labels by their actual goal percentage instead of equal thirds.
- Anchored the 100% tier at the end of the bar.
- Staggered crowded high-end labels so 80%, 90%, and 100% do not overlap.
- Moved status names above the bar and the lowest goal label below the bar to reduce crowding.
- Changed top markers to show percentage plus name and the lower goal marker to show percentage only.
- Stacked crowded top markers while keeping each label's right edge pinned to its percentage marker.
- Stacked each top marker internally with the name above its percentage.
- Shortened default/person tier labels to `Jobs` and `Musk`.
- Updated saved full-name labels to render as `Jobs` and `Musk`.

## 2026-05-22 - README Refresh

### Changed

- Replaced the thin MVP README with a current extension overview.
- Documented install steps, tracking behavior, prompt memory, popup editing, settings, permissions, privacy, storage keys, project files, and developer checks.
- Added notes for reload/manual testing, stale local data, icons, and packaging status.

## 2026-05-22 - Goal Crossing Effects

### Changed

- Added a popup confetti effect when the daily website Signal ratio crosses up through the configured goal.
- Added a popup sad-face alert when the ratio drops back below the configured goal.
- Added Settings toggles for enabling/disabling each effect independently.
- Stored goal-crossing state per date and goal percentage so effects only fire on actual crossings.

## 2026-05-22 - Settings Support Area

### Changed

- Added a bottom Settings section titled `Support Open Source Devs ☕`.
- Added short support copy and a `Buy the creator a coffee` link to `https://buymeacoffee.com/perspective`.

## 2026-05-22 - Custom Status Ladder

### Changed

- Added a compact popup status bar under the header.
- Added default status tiers:
  - `70%` -> `Goal`
  - `80%` -> `Jobs`
  - `100%` -> `Musk`
- Added Settings controls for:
  - status bar name
  - tier 1 percentage and name
  - tier 2 percentage and name
  - tier 3 percentage and name
- Stored status bar preferences in extension settings.

### Result

The popup now gives the daily Signal ratio a named progression target instead of only showing a raw percentage.

## 2026-05-22 - Rule-Based Prompt Memory

### Changed

- Removed the `Don't ask again today` dismiss action from the quick classifier.
- Renamed the default popup memory option to `Remember always`.
- Added an unchecked `Remember today` option.
- Made `Remember always` and `Remember today` mutually exclusive in the popup UI.
- Added backend support for date-scoped `todaySiteRules`.
- Classification now checks permanent rules and today-only rules before deciding whether to show the quick classifier.
- Today-only rules are cleared when today's data is reset and pruned on day rollover.

### Result

Users label an unclassified site once. By default that label is permanent; when `Remember today` is selected, the label suppresses prompts and drives classification for the current tracking day only.

## 2026-05-21 - Engagement-Gated Website Tracking

### Why

The extension could keep counting the active tab even when the user left a page open, walked away, or worked somewhere else while a site like YouTube remained visible.

### Changed

- Added the Chrome `"idle"` permission so the background worker can stop website tracking when the machine is idle or locked.
- Added throttled content-script activity pings for:
  - pointer clicks
  - keyboard input
  - scroll and wheel activity
  - touch input
  - mouse movement
  - page load/pageshow/focus
- Added an activity gate in `background.js`:
  - website sessions require recent tab activity by default
  - the default activity timeout is 120 seconds
  - the setting is clamped between 30 and 900 seconds
  - inactive sessions end at the inactivity cutoff instead of counting all the way to the next popup refresh
- Added Settings controls for:
  - requiring tab activity before website time counts
  - changing the inactivity timeout
- Updated the popup Session metric to show states like `Awaiting input`, `Inactive`, `System idle`, or `Locked`.

### Result

Leaving YouTube open no longer keeps adding YouTube time forever. If the tab has no recent interaction, it stops counting after the configured timeout.

## 2026-05-21 - Remembered Sites Stop Re-Prompting

### Changed

- Fixed the quick classifier so the `Every new website` mode still respects saved Signal/Noise rules.
- A remembered domain, such as `mail.proton.me`, no longer shows the classifier again for every folder, route, or email page.
- Updated Settings and project docs to describe the behavior as new/unclassified-site prompting instead of perpetual prompting.

## 2026-05-18 - Audit, Repair, and Interaction Pass

### Context

This entry covers the current local development pass for the Chrome extension. The comparison below separates:

- The earlier Grok/Hermes work described in the user-provided transcript.
- The staged project baseline that existed before the current Codex repair pass.
- The Codex changes made afterward to get the extension closer to the intended product behavior.

The repo still has no git commits, so this changelog is based on the working tree, staged baseline, local audit notes, and the user-provided Grok/Hermes conversation.

---

## What Grok/Hermes Changed or Attempted

### Initial Extension Baseline

The staged baseline contained the first MVP shape:

- Manifest V3 extension structure.
- Static `content.js` injection on `<all_urls>`.
- Background service worker for tab/session tracking.
- `chrome.storage.local` for daily data and site rules.
- `chrome.storage.session` for the current session.
- Rule-based Signal/Noise classification.
- Popup with separate Signal and Noise lists.
- Reset Today button.
- Basic settings/options scaffold.

### Current Site Classification Fix Attempt

The Grok/Hermes transcript shows two main attempted fixes for the X.com reclassification bug:

1. **Optimistic popup lock**
   - Added `lastManualClassification` in `popup/popup.js`.
   - Immediately changed the Current Site badge after clicking "Mark as Signal."
   - Temporarily prevented `loadData()` from overwriting the badge.
   - Cleared the lock after a few seconds.

   Result: The UI changed briefly, then reverted back to Noise because the underlying data source still returned the old classification.

2. **Background dailyData persistence**
   - Updated `handleClassificationUpdate()` to write the new classification into `dailyData.activities[domain]`.
   - Created an activity entry with `durationMs: 0` if one did not exist.

   Remaining issue: The function still returned early when there was no matching `currentSession`. That meant the update could still fail when the popup knew the active tab but the background session did not exist or did not match the domain.

### Limitations Left by Grok/Hermes

- Classification updates still depended on `currentSession`.
- Popup state could be correct while storage remained wrong.
- Existing time buckets were not reliably re-bucketed.
- The popup still trusted stale daily aggregate counters.
- Current visible tab classification was not treated as a first-class data source.
- No robust split/edit model existed for mixed Signal/Noise time on the same domain.

---

## What Codex Changed

### Manifest and Extension Runtime

- Marked the background service worker as an ES module with `"type": "module"` so `import` statements work correctly.
- Removed unnecessary permissions:
  - `activeTab`
  - `scripting`
- Kept the extension on static content scripts and core permissions:
  - `tabs`
  - `storage`
  - `alarms`
- Added `options_page` / `options_ui` so settings open from the popup.

### Background Tracking and Session Logic

- Reworked the background message API to return richer data:
  - `currentSession`
  - `currentSite`
  - normalized daily data
  - settings
  - current date key
- Added active tab lookup through the background so the popup can show the true current site classification.
- Changed content-script visibility handling to use `sender.tab` instead of trusting `tabId: null` from the content script.
- Added focused-window checks before starting sessions.
- Started tracking reliably on:
  - content script visibility/load pings
  - tab activation
  - tab URL updates
  - browser focus regain
- Added active-session checkpointing before split/edit operations so live time is materialized before edits.
- Added pause/resume tracking support.
- Added off-browser Signal tracking for browser focus gaps over 5 seconds.
- Added storage cleanup with a 30-day retention constant.

### Classification and Rule Handling

- Normalized domains through `normalizeDomain()`.
- Added safer domain validation without relying on one large regex.
- Added parent-domain rule inheritance, so a saved rule for `x.com` can apply to subdomains.
- Persisted manual classifications even when no matching `currentSession` exists.
- Re-bucketed existing daily activity when a classification changes.
- Added support for split-domain activity with separate:
  - `signalMs`
  - `noiseMs`
- Added segment-level updates for split rows.

### Date and Time Math

- Replaced UTC `toISOString().split('T')[0]` day keys with local date keys.
- Kept `dayStartHour` behavior while avoiding UTC day drift.
- Fixed stale aggregate math by recalculating totals from `activities`.
- Updated the popup ratio to calculate from the same website rows shown in the UI.
- Renamed the popup metric from "Today's Signal Ratio" to "Website Signal Ratio" so off-browser Signal time does not make the visible website math look impossible.
- Changed total text to "Website time today."

### Popup UI

- Replaced separate Signal and Noise lists with one combined Websites list.
- Left column: domain.
- Right side: time plus action controls.
- Signal rows render in green.
- Noise rows render in red.
- Added Current Site panel with live classification.
- Added daily goal/top-noise/session insight cards.
- Added Pause Tracking / Resume Tracking button.
- Added success toast feedback.

### Website Row Editing

The row controls now have distinct jobs:

- **Click the time**: edit the number of minutes.
- **Click the pencil**: flip the row between Signal and Noise.
- **Click the divider**: split the total time into Signal and Noise portions.

Example behavior:

- `facebook.com` starts as `18m` Noise.
- Clicking the divider splits it into:
  - `9m` Noise
  - `9m` Signal
- Each split segment can then have its time edited independently.
- Editing one segment recalculates totals and ratio.
- Flipping a split segment moves that segment into the other classification.
- If all split time ends up on one side, the activity collapses back into a normal single row.

### Options Page

- Converted options script to an ES module so it can reuse local helpers.
- Added Daily Signal Goal setting.
- Added Show Popup setting for default Noise prompts.
- Preserved existing settings instead of overwriting unrelated fields.
- Fixed Reset Today to respect `dayStartHour`.
- Added CSV export.
- Updated CSV export to handle split rows as separate Signal/Noise segments.
- Replaced unsafe `innerHTML` rule rendering with safe DOM construction.

### Content Script

- Rebuilt the override popup with safe DOM APIs instead of `innerHTML`.
- Uses closed shadow DOM for style isolation.
- Sends visibility notifications on:
  - load/pageshow
  - focus
  - visibility changes
  - SPA URL changes
- Shows the quick classification prompt on every new/unclassified website by default, while keeping it dismissible and non-persistent unless the user chooses a classification.
- Added a prompt behavior setting for switching between every-website prompts and the older default-Noise-only prompt behavior.

### Storage and Safety

- Stopped rendering stored domains through `innerHTML`.
- Added helpers for normalized site rule saves/removals.
- Kept data local-only.
- Continued storing domains only, not full URLs.
- Added mocked runtime checks for storage and background behavior.

---

## Bugs Fixed During Codex Pass

- Popup showed no percentage when the background module setup was invalid.
- Current site could show stale Noise after clicking Mark as Signal.
- Manual classification could silently fail without a matching current session.
- Current active session was not included in popup totals.
- Browser focus regain did not reliably restart tracking.
- Content script sent unusable `tabId: null` session updates.
- Local day keys could be wrong around timezone boundaries.
- Options reset could reset the wrong day.
- Stored domains could be rendered unsafely.
- Signal ratio could show impossible values, such as 99% Signal while visible website rows included significant Noise time.
- Clicking time had been incorrectly wired to flip classification instead of editing minutes.
- Split rows needed independent Signal/Noise duration edits.

---

## New Features Added by Codex

1. **Pause/Resume Tracking**
   - Added so users can stop tracking without disabling the extension.

2. **Daily Signal Goal and Insights**
   - Added goal progress, top Noise source, and current session duration.
   - Helps users understand what is driving the ratio.

3. **CSV Export**
   - Added from the settings page.
   - Lets users inspect local tracking data outside the extension.

4. **Combined Website List**
   - One list shows all visited websites.
   - Rows are colored by classification.
   - Easier to scan than separate Signal/Noise sections.

5. **Inline Time Editing**
   - Clicking the time edits the minutes.
   - Supports both whole-domain rows and split Signal/Noise segments.

6. **Pencil Classification Flip**
   - Pencil flips Signal/Noise without changing time.

7. **Signal/Noise Time Split**
   - Divider splits a domain's time into separate Signal and Noise portions.
   - Supports cases where one website was partly productive and partly distracting.

---

## Verification Run

The following checks were run during the Codex pass:

- `git diff --check`
- `node --check popup/popup.js`
- `node --check content.js`
- `node --input-type=module --check < background.js`
- `node --input-type=module --check < options/options.js`
- Manifest JSON parse with Node
- Mocked background runtime tests for:
  - X.com reclassification persistence
  - live session inclusion in totals
  - pause/resume behavior
  - off-browser Signal tracking
  - stale aggregate normalization
  - whole-row duration edits
  - split-row duration edits
  - Facebook 18-minute split into 9m Noise / 9m Signal

---

## Known Follow-Up Notes

- Reload the unpacked extension in Chrome after each code change.
- Existing local storage may contain stale aggregate counters from earlier builds; the current background and popup now normalize from activities, but clearing today's data can make manual testing cleaner.
- Icons are still placeholder project assets.
- The extension is still local-first and has not been packaged for Chrome Web Store review.
