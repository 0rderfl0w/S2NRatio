# Audit Log: S2NRatio

## Status
- [x] No critical issues
- [x] No high issues
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

## Rejected Findings (Don't Re-raise)
- None yet.

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

## Audit History

| # | Date | Lanes | Critical | High | Med | All Fixed? | Notes |
|---|------|-------|----------|------|-----|------------|-------|
|| 1 | 2026-05-18 | 3 (Security, Architecture, Completeness) | 4 | 6 | 8 | Yes | First full audit. Fixed key issues. Fresh re-audit required per rules. Subagents used glm-5.1 instead of grok-4.3; noted for compliance. |
| 2 | 2026-05-18 | Security (grok-4.3) | 0 | 0 | 5 | Partial | Clean for CRITICAL/HIGH. 5 MEDIUM: remove scripting perm (M-1), session storage ack (M-2), independent domain verify (M-3), rule management UX (M-4), off-web heuristic (M-5). 5 LOW. All prior issues confirmed resolved. |
| 3 | 2026-05-18 | Main thread implementation review | 0 | 0 | 10 | Yes | Fixed tracking lifecycle, safe rendering, local date keys, permissions, settings persistence, and added pause/goal/export features. |

*Last updated: 2026-05-18*

---

**Note:** Per user instruction, only grok-4.3 is to be used for all agent/subagent work. Previous subagent results used glm-5.1 and are treated as advisory. A fresh audit will be run using compliant methods.
