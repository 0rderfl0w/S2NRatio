# Signal to Noise Ratio

Signal to Noise Ratio is a local-first Chrome extension for tracking whether
browser time is Signal or Noise.

It is built for people who want a clear daily read on whether their web time is
moving the work forward or leaking into distraction.

The idea is inspired by Kevin O'Leary's story about Steve Jobs and focus: keep
the few priorities that matter, cut the rest, and ask how high you can keep your
own Signal to Noise Ratio.

## What It Does

- Tracks the active, visible Chrome tab while the user is actually engaging with it.
- Keeps active video/audio playback counting as engagement so watching YouTube or other media does not silently stop after the idle timeout.
- Stops counting stale tabs after inactivity, so a site left open does not keep running forever.
- Uses Chrome idle state to stop website tracking when the computer is idle or locked.
- Classifies domains as Signal or Noise through built-in rules and user overrides.
- Prompts once for new or unclassified websites so the user can label them quickly.
- Supports permanent rules with `Remember always` and date-scoped rules with `Remember today`.
- Shows daily and seven-day Website Signal Ratios in the extension popup.
- Shows today's Website Signal Ratio on the extension icon by default.
- Lets users edit minutes, flip Signal/Noise status, or split one site's time between both.
- Provides configurable goals, status tiers, and goal-crossing effects in the popup and active page.
- Exports local tracking data to CSV from Settings.
- Exports a temporary local tracking debug log from Settings for troubleshooting session starts/stops and duration writes.
- Keeps tracking data local in Chrome storage.

## Install for Development

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this project folder.
5. Pin `Signal to Noise Ratio`.
6. After local code changes, reload the unpacked extension before testing.

## Core Features

### Active Website Tracking

Signal to Noise Ratio tracks only the current active tab in the focused Chrome
window. By default, the tab also needs recent mouse, keyboard, scroll, wheel,
touch, tab activation/navigation, or active media-playback activity before time
counts.

If the tab goes stale, the extension stops counting that website after the
configured activity timeout. The default timeout is 120 seconds. Active
video/audio playback is intentionally treated as engagement; otherwise watching a
YouTube video, reel, or Facebook/social video without touching the keyboard or
mouse could stall around the two-minute timeout even though the media is still
playing.

### Signal and Noise Classification

The extension classifies domains using:

- built-in Signal defaults such as Gmail, Google Docs, GitHub, Slack, Zoom, Notion, and Linear
- built-in Noise defaults such as YouTube, X, Facebook, Instagram, Reddit, TikTok, Netflix, and Twitch
- user-saved permanent rules
- user-saved today-only rules

Saved domain rules apply across paths and subpages. For example, labeling
`mail.proton.me` should cover inboxes, messages, folders, and other routes under
that domain.

### Quick Classification Prompt

When visiting a new or unclassified website, a small page prompt can appear with
`Signal` and `Noise` buttons.

The default selection behavior is:

- `Remember always` is checked by default.
- `Remember today` is optional and mutually exclusive with `Remember always`.
- Once a domain has a saved rule, the prompt should not keep reappearing for
  every route on that same site.

Settings can switch prompt behavior between every unclassified website and the
older default-Noise-only mode.

### Popup Dashboard

The extension popup shows:

- today's Website Signal Ratio
- seven-day average Website Signal Ratio
- optional toolbar badge with today's Website Signal Ratio
- the current site and its classification
- goal progress
- top Noise source
- current session state
- combined website list
- pause/resume tracking
- reset-today shortcut
- link to Settings
- Buy the creator a coffee link

The ratio shown in the popup is based on visible website rows, including split
Signal/Noise segments, so the percentage matches the list math.

The seven-day average can be filtered in Settings by weekday. Users can also
start the average fresh from today without deleting stored history.

### Website List Editing

The Websites list supports three separate actions:

- click the time to edit the number of minutes
- click the pencil icon to flip that row between Signal and Noise
- click the divider icon to split one site's time between Signal and Noise

When a row is split, the extension creates separate Signal and Noise portions
under the same domain. Each segment can be edited again afterward.

### Status Bar and Goals

The popup includes a configurable status bar. The default tiers are:

- `70%` -> `Goal`
- `80%` -> `Jobs`
- `100%` -> `Musk`

Settings let the user change the status bar name, tier names, and tier
percentages.

Goal effects can also be enabled or disabled:

- confetti popup when the daily website Signal ratio crosses up through the goal
- below-goal popup when the ratio drops back below the goal

### Settings

The Settings page includes:

- day start hour
- target Signal ratio
- active-tab activity requirement
- inactivity timeout
- quick prompt behavior
- toolbar ratio badge toggle
- weekly average weekday filters
- start-average-fresh control that keeps stored history
- goal-crossing effect toggles
- status bar tier editor
- manual site rules
- CSV export
- temporary tracking debug log export and clear controls
- reset today's data
- local storage summary and tracking-history trash action
- `Support Open Source Devs` section with a Buy Me a Coffee link

## Permissions

Signal to Noise Ratio uses a small set of Chrome extension permissions:

- `tabs`: detect the active tab, active window, and current domain
- `storage`: store settings, rules, daily totals, and session state locally
- `alarms`: run periodic tracking checkpoints and day rollover cleanup
- `idle`: avoid counting website time while the computer is idle or locked
- `<all_urls>` content script match: run the local prompt and activity/media listener on visited pages

## Privacy

Signal to Noise Ratio is local-first.

- No external server is used for tracking.
- Data is stored in Chrome extension storage.
- The extension stores normalized domains, not full URLs, paths, query strings,
  page titles, or page contents.
- CSV export is user-triggered from Settings.
- Debug-log export is user-triggered from Settings and contains local troubleshooting metadata only.

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.

## Local Data Model

Main storage keys:

- `settings`: user preferences, goals, weekly average filters, prompt mode, toolbar badge, status tiers, and tracking toggles
- `siteRules`: permanent domain-level Signal/Noise overrides
- `todaySiteRules`: date-scoped domain overrides
- `dailyData`: daily domain activity, totals, and split Signal/Noise durations
- `goalEffectState`: per-date/per-goal state for crossing effects
- `currentSession`: active tracking session in `chrome.storage.session`
- `tabActivity`: recent per-tab activity source/timestamps in `chrome.storage.session`
- `trackingDebugLog`: temporary recent tracking events in `chrome.storage.session`, exportable from Settings for troubleshooting

## Project Files

- `manifest.json`: Manifest V3 extension definition
- `background.js`: service worker, session tracking, classification updates, edits, splits, and alarms
- `content.js`: quick classifier prompt, user-activity pings, and media-playback engagement detection
- `popup/`: extension popup dashboard
- `options/`: settings page, weekly-average controls, rules editor, storage summary, reset, and CSV export
- `utils/`: classification, storage, and time helpers
- `CHANGELOG.md`: local change history
- `spec.md`: original product and implementation spec
- `AGENTS.md`: project operating notes

## Development Checks

There is no build step. Useful local checks:

```sh
node --check content.js
node --check popup/popup.js
node --input-type=module --check < background.js
node --input-type=module --check < options/options.js
git diff --check
```

Runtime testing still requires reloading the unpacked extension in Chrome and
testing real pages.

## Known Notes

- Existing local Chrome storage can contain stale data from earlier builds. Use
  `Reset Today's Data` in Settings for cleaner manual testing.
- Media playback engagement is detected from the top-level page content script.
  Normal YouTube/Facebook/social video pages should count while playing; embedded
  iframe-only video players may need a future `all_frames: true` manifest change.
- If minute counting feels wrong, export `Tracking Debug Log` from Settings before
  clearing data; it shows recent activity sources, session starts/stops, and
  persisted duration writes.
- Icons use the simple Signal/Noise mark in `icons/`.
- Chrome Web Store packages are generated under `dist/` when needed.

## License

Signal to Noise Ratio is open source under the MIT License. See `LICENSE`.
