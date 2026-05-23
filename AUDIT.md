# Audit Log: S2NRatio

## Status
- [x] No critical issues
- [x] No high issues (Audit #6 gate check found 0 critical/high validated findings)
- [ ] No medium issues (Audit #2 spec cleanup noted; implementation fixes applied in Audit #3)
- [ ] Ready for implementation

## Resolved Decisions

### Audit #1 - Initial Spec Audit (2026-05-18)
**Issue:** Multiple CRITICAL and HIGH findings from security, architecture, and completeness lanes regarding service worker lifecycle, permissions, "off the web" tracking, message validation, URL storage, CSP, regex risks, and more.
**Decision:** Addressed top CRITICAL and HIGH issues by updating spec with Service Worker Lifecycle section, changed to Date.now(), added alarms permission, added content_scripts declaration, added sender validation requirement, changed to store only domain, added CSP, removed regex from v0.1, removed "when in work repos" conditional, fixed repository tree, added message schema, defined "off the web" as best-effort or removed for v0.1, etc.
**Why:** To make the spec production-ready and pass subsequent audit gate with 0 CRITICAL / 0 HIGH.
**Resolved:** 2026-05-18, Audit #1

## Known Gotchas
- Service worker termination is the #1 risk for time tracking accuracy in MV3.
- Broad <all_urls> will trigger Chrome install warning; document it clearly.
- "off the web" tracking is best-effort and may have false positives/negatives.
- Override popup UX must not annoy users with repeated prompts.
- Content-script visibility messages must be verified against the sender tab and focused window before starting a session.
- Any stored domain or rule value rendered in extension UI must use textContent/createElement, not innerHTML.
- Turning off the per-tab activity requirement must not turn off Chrome idle/locked protection.
- Package readiness must compare the upload zip contents against source, not just inspect local files.

## Rejected Findings (Don't Re-raise)
| Finding | Why Rejected | Audit # |
|---------|--------------|---------|
| `dist/signal-to-noise-ratio-v0.1.8.zip` had stale `background.js` after the idle fix | Rejected after `unzip -p dist/signal-to-noise-ratio-v0.1.8.zip background.js \| cmp -s background.js -` returned `0`, and source/zip line ranges matched | #6 |

## Audit #2 Findings — Security Lane (grok-4.3, 2026-05-18)

### CRITICAL: 0 | HIGH: 0
All prior CRITICAL/HIGH findings from Audit #1 confirmed resolved.

### MEDIUM (5)
1. **M-1** | Lines 31,34,47,49 | `scripting` permission unnecessary for v0.1 | Remove `scripting` from permissions; static content_scripts handles all injection.
2. **M-2** | Line 55,128 | `chrome.storage.session` plaintext not acknowledged | Add session storage to plaintext acknowledgment at line 128.
3. **M-3** | Lines 75,165,167 | Background should verify domain independently via `chrome.tabs.get()` rather than trusting content script domain | Add requirement for independent domain verification in background message handlers.
4. **M-4** | Lines 92-94,145-146 | No UI to manage/delete saved siteRules in v0.1 | Add minimal "Manage Rules" to popup or document as known UX gap.
5. **M-5** | Line 107 | "Off the web" gap heuristic is approximate; may mislead | Document in UI and Known Gotchas; informational.

### LOW (5)
1. **L-1** | Line 97 | Domain regex ReDoS potential on crafted input (mitigated by URL parser pre-sanitization)
2. **L-2** | Line 159 | SendMessage retry could cause duplicate processing; operations should be idempotent
3. **L-3** | Lines 148-149 | Override popup z-index arms race with sites (best-effort, safe default)
4. **L-4** | Lines 196 vs 25-42 | `incognito: "not_allowed"` mentioned in implementation but missing from manifest snippet
5. **L-5** | Lines 124 vs 126 | Contradictory retention: 7-day prune vs 30-day max

## Implementation Audit #3 Findings — Main Thread Review (2026-05-18)

### Fixed
1. Current-site reclassification depended on `currentSession` and reverted when no session existed; updates now persist as site rules and refresh from live active-tab classification.
2. Content-script visibility messages used `tabId: null`; background now uses `sender.tab` and focused-window checks before starting or ending sessions.
3. Active tab tracking did not reliably start after extension reload or browser focus regain; content load pings and focus handlers now start the active visible tab session.
4. Browser focus loss discarded off-browser time; focus gaps over 5 seconds now count as Signal under `__off_the_web__`.
5. Popup totals ignored the in-progress session; `GET_DAILY_DATA` now returns live totals without waiting for tab switches.
6. Date keys used UTC via `toISOString()`, which could put local early-morning data in the wrong day; date keys now use local calendar dates with `dayStartHour`.
7. Stored domains were rendered through `innerHTML` in popup/options/content script; UI now uses safe DOM APIs.
8. Options reset ignored `dayStartHour`; reset now uses the configured local day key.
9. `activeTab` and `scripting` permissions were unnecessary for the current static-content-script design; manifest permissions are reduced.
10. Settings save overwrote unrelated settings; settings now merge with defaults and preserve pause/prompt/goal values.

### Added Features
1. Popup pause/resume tracking control.
2. Daily Signal goal setting with popup goal/top-noise/session insight cards.
3. CSV export for local daily tracking data.

## Implementation Audit #4 Findings — Pre-Submit Bug Sweep (2026-05-23)

### Fixed
1. Stale session duration guard introduced a badge-update recursion risk when session duration writes triggered badge refresh before the current session was cleared; badge refreshes now happen after outer event handlers reach stable state.
2. Settings reset and background reset could let live current-session time reappear after clearing today's rows; reset now clears current session, heartbeat, tab activity, off-web state, today-only rules, goal-effect state, and badge state.
3. Today-only rules were lower priority than permanent rules, so `Remember today` could not override an existing permanent site rule; today's rules now win for the current day.
4. Settings `Reset Today's Data` bypassed the background reset path; it now sends `RESET_TODAY` to the service worker.
5. CSV export trusted stored aggregate counters that can be stale after older builds or manual edits; export now recalculates website totals from activity rows.

## Implementation Audit #5 Findings — Dedicated Bug Sweep (2026-05-23)

### Fixed
1. Switching from an engaged tab to a trackable but unengaged tab left the old `currentSession` live; session switches now clear the old session before duration writes and do not resurrect it if the new tab is awaiting input.
2. Sessions spanning midnight or a custom `dayStartHour` were written to the wrong day; session duration now splits across local tracking date boundaries.
3. Pause Tracking did not stop off-browser Signal time; pause, focus loss, history clearing, and reset paths now clear off-web state before storage mutation.
4. Off-browser time could include idle/locked wall-clock time; idle and locked events now finalize or cap off-web sessions.
5. Badge refreshes triggered by storage changes could re-enter session-ending writes; storage-triggered badge refreshes are now read-only against session state.
6. Website-list pencil edits created permanent site rules; row-level classification edits now update only today's activity row.
7. Today-only parent rules could lose to permanent exact subdomain rules; today rules now resolve before permanent rules by source priority.
8. CSV export omitted live session time and included off-web rows while reporting website-only totals; export now overlays live data and skips off-web rows.
9. Tracking-history and all-data clearing bypassed background cleanup; both actions now route through service-worker cleanup paths.
10. The manifest carried an unnecessary `host_permissions` entry; it was removed while preserving the required all-sites content script match.
11. The privacy policy missed Chrome Web Store Limited Use disclosure language; `PRIVACY.md` now includes a Limited Use section.
12. Disabling the per-tab activity requirement also disabled idle/locked protection; idle/locked protection now remains active in no-activity-gate mode.
13. Heartbeat could write an old session back after async goal-check work; heartbeat now re-reads and matches the session before writing metadata.

## Implementation Audit #6 Findings — Gate Check (2026-05-23)

### Result
Dedicated re-audit lanes for timing/session math, popup/options storage workflows, rules/data model/weekly averages, and Chrome Web Store package/privacy readiness found 0 validated CRITICAL and 0 validated HIGH findings after Audit #5 fixes.

## Audit History

| # | Date | Lanes | Critical | High | Med | All Fixed? | Notes |
|---|------|-------|----------|------|-----|------------|-------|
| 1 | 2026-05-18 | 3 (Security, Architecture, Completeness) | 4 | 6 | 8 | Yes | First full audit. Fixed key issues. Fresh re-audit required per rules. Subagents used glm-5.1 instead of grok-4.3; noted for compliance. |
| 2 | 2026-05-18 | Security (grok-4.3) | 0 | 0 | 5 | Partial | Clean for CRITICAL/HIGH. 5 MEDIUM: remove scripting perm (M-1), session storage ack (M-2), independent domain verify (M-3), rule management UX (M-4), off-web heuristic (M-5). 5 LOW. All prior issues confirmed resolved. |
| 3 | 2026-05-18 | Main thread implementation review | 0 | 0 | 10 | Yes | Fixed tracking lifecycle, safe rendering, local date keys, permissions, settings persistence, and added pause/goal/export features. |
| 4 | 2026-05-23 | Main thread pre-submit review | 0 | 2 | 3 | Yes | Fixed badge/session recursion risk, reset consistency, today-only rule precedence, and CSV aggregate recalculation. |
| 5 | 2026-05-23 | 4 (Timing, Popup/Options, Rules/Data, Web Store) | 0 | 10 | 7 | Yes | Dedicated bug audit found and fixed session lifecycle, idle/off-web, row-edit, rule precedence, export, cleanup, manifest, and privacy issues. |
| 6 | 2026-05-23 | 4 (Timing, Popup/Options, Rules/Data, Web Store) | 0 | 0 | Not counted | Yes | Gate check passed for 0 CRITICAL/HIGH validated findings. One stale-package finding was rejected by source/zip byte comparison. |

*Last updated: 2026-05-23*

---

**Note:** Audit #5 and Audit #6 used dedicated focused Codex subagents available in this session. Main-thread validation remained authoritative for accepting or rejecting findings.
