# Signal to Noise Ratio

## Project Overview
Signal to Noise Ratio is a lightweight Chrome extension that helps users understand and optimize their daily browsing time by categorizing activities into **Signal** (productive, work-related) and **Noise** (leisurely or distracting). The goal is to provide clear visibility into how time is spent online, encouraging more intentional use of the browser.

## Core Concept
- **Active Engaged-Tab Tracking**: The extension tracks the currently active and visible tab only while there is recent tab activity, such as mouse, keyboard, scroll, touch input, browser tab activation/navigation, or active media playback. This avoids counting a site that is merely left open.
- **Automatic Classification**: Detects the current website and classifies it as Signal or Noise based on predefined rules and user overrides.
  - Default Signal sites: email providers (Gmail, Outlook), productivity tools (Notion, Linear, Zoom, calendars), work-related domains.
  - Default Noise sites: social networks (X/Twitter, Facebook, Instagram, YouTube, Reddit), entertainment (Netflix, Twitch).
- **Off-Browser Time as Signal**: When the browser is not the active application or there are no active tabs, time is automatically attributed to "Signal" (e.g., "off the web" or deep work outside the browser).
- **Idle Protection**: When Chrome reports the machine as idle or locked, active website tracking stops instead of continuing to count the last open tab. Recent user engagement and visible active media playback keep the active tab engaged inside the configured timeout.
- **Quick Override Popup**: By default, when visiting any website without a saved rule, a small, non-intrusive popup appears offering two buttons:
  - "Signal" (with default for known productive contexts like email, Zoom, or when user is on X for work)
  - "Noise" (default for traditional social networks)
  - This allows immediate correction so work sessions on X count toward Signal.
  - Once a site is remembered as Signal or Noise, the popup should not reappear for that same domain.
  - Popup choices default to "Remember always"; users can choose "Remember today" for a date-scoped rule instead.
  - Settings can restrict this back to default Noise sites only.
- **Daily Dashboard on Click**: Clicking the extension icon opens a popup showing:
  - Overall Signal-to-Noise ratio as a percentage (e.g., 72% Signal)
  - Seven-day average Signal-to-Noise ratio based on recent website time
  - Optional toolbar badge showing today's Website Signal Ratio, colored by the current site's Signal/Noise classification
  - A customizable status bar with named ratio tiers (defaults: 70% "Goal", 80% "Jobs", 100% "Musk")
  - Optional goal-crossing effects: confetti popup when crossing above the daily goal and a below-goal popup when dropping under it.
  - Breakdown lists:
    - **Signal**: "off the web" (3h 28m), Gmail (32m), Linear (1h 5m), etc.
    - **Noise**: YouTube (1h 11m), X (1h 8m), Reddit (45m), etc.
  - Total tracked time and session history for the current day.

## Key Features for v0.1
- Real-time timer that only runs on the active visible tab when the user has recently engaged with that tab.
- Persistent local storage for daily logs (resets at midnight or user-defined day start).
- Seven-day average ratio calculated from local daily logs, with Settings controls for which weekdays count and whether the average starts fresh from today.
- Optional extension-icon badge that shows today's Website Signal Ratio every 60 seconds.
- Simple classification engine with hardcoded initial rules + ability to mark sites as Signal/Noise permanently or for today only.
- Clean, minimal UI focused on the ratio and lists.
- Customizable status bar name and tier goals in Settings.
- Configurable goal-crossing effects in Settings.
- Privacy-first: All data stays local in Chrome storage; no external servers in v0.1.
- Debugging: If tracking feels wrong, use Settings -> Data Management -> Export Tracking Debug Log before clearing data. The temporary log is local/session-scoped and shows recent activity sources, session starts/stops, and duration writes.

## Target Users
Builders, founders, solopreneurs, and knowledge workers who want honest data on where their attention goes without complex setup or SaaS subscriptions.

## Philosophy
Time is the ultimate currency. Signal to Noise Ratio gives users a mirror to see whether they're investing it in Signal or letting it leak into Noise. The override mechanism respects that context matters — X can be pure noise or vital work depending on the session.

## Development Guidelines
- Use Manifest V3.
- Prefer service workers for background logic.
- Keep the extension lightweight and performant.
- Focus on accurate active-tab time tracking.
- Make the override popup fast and dismissible.
- Store data in chrome.storage.local with daily aggregation.

## Next Steps
See spec.md for the initial v0.1 architecture and implementation plan.

This project is local-first on macOS. Use terminal for builds, testing in Chrome's extension developer mode.
