# S2NRatio

S2NRatio is a local-first Chrome extension for tracking whether browser time is
Signal or Noise.

It is built for people who want a clear daily read on whether their web time is
moving the work forward or leaking into distraction.

## What It Does

- Tracks the active, visible Chrome tab while the user is actually engaging with it.
- Stops counting stale tabs after inactivity, so a site left open does not keep running forever.
- Uses Chrome idle state to stop website tracking when the computer is idle or locked.
- Classifies domains as Signal or Noise through built-in rules and user overrides.
- Prompts once for new or unclassified websites so the user can label them quickly.
- Supports permanent rules with `Remember always` and date-scoped rules with `Remember today`.
- Shows a daily Website Signal Ratio in the extension popup.
- Lets users edit minutes, flip Signal/Noise status, or split one site's time between both.
- Provides configurable goals, status tiers, and goal-crossing effects.
- Exports local tracking data to CSV from Settings.
- Keeps tracking data local in Chrome storage.

## Install for Development

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click `Load unpacked`.
4. Select this project folder.
5. Pin `S2NRatio`.
6. After local code changes, reload the unpacked extension before testing.

## Core Features

### Active Website Tracking

S2NRatio tracks only the current active tab in the focused Chrome window. By
default, the tab also needs recent mouse, keyboard, scroll, wheel, touch, page
load, or focus activity before time counts.

If the tab goes stale, the extension stops counting that website after the
configured activity timeout. The default timeout is 120 seconds.

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
- the current site and its classification
- goal progress
- top Noise source
- current session state
- combined website list
- pause/resume tracking
- reset-today shortcut
- link to Settings

The ratio shown in the popup is based on visible website rows, including split
Signal/Noise segments, so the percentage matches the list math.

### Website List Editing

The Websites list supports three separate actions:

- click the time to edit the number of minutes
- click the pencil icon to flip that row between Signal and Noise
- click the divider icon to split one site's time between Signal and Noise

When a row is split, the extension creates separate Signal and Noise portions
under the same domain. Each segment can be edited again afterward.

### Status Bar and Goals

The popup includes a configurable status bar. The default tiers are:

- `80%` -> `80/20`
- `90%` -> `Jobs`
- `100%` -> `Musk`

Settings let the user change the status bar name, tier names, and tier
percentages.

Goal effects can also be enabled or disabled:

- confetti when the daily website Signal ratio crosses up through the goal
- a sad-face alert when the ratio drops back below the goal

### Settings

The Settings page includes:

- day start hour
- target Signal ratio
- active-tab activity requirement
- inactivity timeout
- quick prompt behavior
- goal-crossing effect toggles
- status bar tier editor
- manual site rules
- CSV export
- reset today's data
- `Support Open Source Devs` section with a Buy Me a Coffee link

## Permissions

S2NRatio uses a small set of Chrome extension permissions:

- `tabs`: detect the active tab, active window, and current domain
- `storage`: store settings, rules, daily totals, and session state locally
- `alarms`: run periodic tracking checkpoints and day rollover cleanup
- `idle`: avoid counting website time while the computer is idle or locked
- `<all_urls>` host permission: inject the prompt and activity listener on visited pages

## Privacy

S2NRatio is local-first.

- No external server is used for tracking.
- Data is stored in Chrome extension storage.
- The extension stores normalized domains, not full URLs, paths, query strings,
  page titles, or page contents.
- CSV export is user-triggered from Settings.

## Local Data Model

Main storage keys:

- `settings`: user preferences, goals, prompt mode, status tiers, and tracking toggles
- `siteRules`: permanent domain-level Signal/Noise overrides
- `todaySiteRules`: date-scoped domain overrides
- `dailyData`: daily domain activity, totals, and split Signal/Noise durations
- `goalEffectState`: per-date/per-goal state for crossing effects
- `currentSession`: active tracking session in `chrome.storage.session`

## Project Files

- `manifest.json`: Manifest V3 extension definition
- `background.js`: service worker, session tracking, classification updates, edits, splits, and alarms
- `content.js`: quick classifier prompt and user-activity pings
- `popup/`: extension popup dashboard
- `options/`: settings page, rules editor, reset, and CSV export
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
- Icons currently exist as local project assets and can be replaced before any
  packaged release.
- The extension has not been packaged for Chrome Web Store submission.

## License

S2NRatio is open source under the MIT License. See `LICENSE`.
