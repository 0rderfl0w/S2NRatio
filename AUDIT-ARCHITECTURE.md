# Architecture Audit Report — S2NRatio Spec v0.1

**Auditor:** Architecture & System Design Lane  
**Date:** 2026-05-18  
**Scope:** Full updated SPEC.md (post Audit #1 fixes)  
**Model:** grok-4.3 (as required)

---

## Summary

| Severity | Count |
|----------|-------|
| CRITICAL | 0     |
| HIGH     | 0     |
| MEDIUM   | 7     |
| LOW      | 4     |

**Result: Clean architecture audit — 0 CRITICAL, 0 HIGH.** The Audit #1 fixes have substantively addressed the previously-flagged issues (service worker lifecycle, storage.session, Date.now(), alarms, sender validation, domain-only storage, CSP). The remaining findings are MEDIUM (implementation ambiguities that will cause divergent builds if unresolved) and LOW (minor hygiene). No blockers to implementation.

---

## MEDIUM Findings

### M1 — Contradictory Data Retention Period

**Location:** Section 4 (Data Storage), Line 124 vs Line 126  
**Issue:** Line 124 states "Old daily data retained for 7 days then pruned." Line 126 states "Max retention 30 days to prevent unbounded growth." These directly contradict each other — a developer implementing pruning logic could pick either value.  
**Recommendation:** Pick one value. Recommend 30 days for useful weekly retrospective (4+ weeks of history). Update Line 124 to: "Old daily data retained for 30 days then pruned." Delete or reconcile the duplicate statement on Line 126.

---

### M2 — `dailyData` Storage Schema Not Fully Defined

**Location:** Section 4 (Data Storage), Lines 110-115  
**Issue:** The spec defines top-level storage keys (`currentSession`, `dailyData`, `siteRules`, `settings`) but never specifies the internal structure of a single day's entry in `dailyData`. The popup response schema (Line 137) references `totalSignalMs`, `totalNoiseMs`, `activities`, and `currentSession` — but the on-disk format for `dailyData["2026-05-18"]` is left implicit. Two developers could build incompatible structures (e.g., one aggregates into counters, another stores individual session records).  
**Recommendation:** Add an explicit schema block:
```
dailyData["YYYY-MM-DD"] = {
  totalSignalMs: number,
  totalNoiseMs: number,
  activities: {
    [domain: string]: {
      classification: "signal" | "noise",
      durationMs: number
    }
  }
}
```

---

### M3 — Domain Matching Strategy Ambiguous

**Location:** Section 2 (Classification), Line 96  
**Issue:** The spec states both "Use registered domain matching (subdomains inherit)" and "Only exact domain matching with `===` or `endsWith()`." These are two different strategies:

- **Registered domain strategy:** Extract the registered/eTLD+1 domain (e.g., `mail.google.com` → `google.com`) and look up that key in rules. Subdomains automatically inherit.
- **Exact/endsWith strategy:** Check the full hostname, falling back to parent domains via `endsWith()`.

The default Signal list includes both `gmail.com` (a registered domain) and `mail.google.com` (a subdomain). Under the registered-domain strategy, `mail.google.com` would resolve to `google.com` — which is NOT in any list and would default to Signal (unknown=Signal). The explicit `mail.google.com` entry becomes unreachable. Under the exact/endsWith strategy, `mail.google.com` would be checked first (found in Signal list).

**Recommendation:** Choose one strategy explicitly. Recommend: **exact hostname match first, then registered-domain fallback.** Remove individual subdomain entries from default lists if using pure registered-domain matching. The implementation should use a single `extractDomain(url)` function that returns the hostname stripped of `www.`, then check: (1) exact hostname in siteRules, (2) exact hostname in default lists, (3) registered domain in siteRules, (4) registered domain in default lists, (5) default to Signal.

---

### M4 — Debounce and "Off the Web" Interaction Undefined

**Location:** Section 3 (Timer & Session Logic), Lines 105-107  
**Issue:** Debounce delays new session start by 1 second (time attributed to previous session). "Off the web" detection triggers on gaps >5 seconds between sessions. The spec doesn't define how these interact:

- Does the 1-second debounce delay count as a "gap" for off-the-web detection?
- If a user switches from tab A to the desktop (WINDOW_ID_NONE), debounce starts. After 1s, no new tab is active — is this a session end (creating a gap) or does the debounce period keep extending the previous session indefinitely?
- What happens when debounce is waiting and the user returns to tab A within 1s? The spec says "attributed to previous session" but the previous session's tab was left — is the attribution to A correct?

**Recommendation:** Add explicit rule: "Debounce period does NOT create gaps. Time during debounce is attributed to the previous session's domain. Gaps for 'off the web' detection only begin AFTER debounce completes and no new session has started (i.e., the previous session was explicitly ended by debounce timeout with no active tab)."

---

### M5 — Recovery Action "Clear or Update" Is Ambiguous

**Location:** Section 1 (Service Worker Lifecycle), Line 59  
**Issue:** The spec says: "if `currentSession` exists and startTime is recent (<5min), calculate and persist duration, then **clear or update**." The decision criteria for clearing vs. updating are not defined. This affects whether a recovered session continues tracking or is finalized.  
**Recommendation:** Replace with explicit logic: "If the recovered session's `tabId` is still the active tab in the focused window AND its visibility is 'visible', update `startTime` to `Date.now()` and resume the session. Otherwise, calculate elapsed duration since `startTime`, persist to `dailyData`, and clear `currentSession`."

---

### M6 — Non-Deterministic "May" Language for Off-the-Web Tracking

**Location:** Section 3 (Timer & Session Logic), Line 107  
**Issue:** "Gaps between sessions >5 seconds **may** be attributed to 'off the web'." The word "may" is permissive, not prescriptive. Two implementations could make opposite choices. In a spec, this must be deterministic.  
**Recommendation:** Change to: "Gaps between sessions >5 seconds ARE attributed to 'off the web' (counted as Signal)." Or, if the intent is to not implement this in v0.1: "Off-the-web tracking is deferred to post-v0.1. Gaps between sessions are not attributed to any category." Pick one.

---

### M7 — Heartbeat Alarm Interval Below Chrome API Minimum

**Location:** Section 1 (Service Worker Lifecycle), Line 57  
**Issue:** The spec specifies a "25-second interval" heartbeat alarm. Per Chrome's official `chrome.alarms` documentation (verified against developer.chrome.com): the minimum `periodInMinutes` is **0.5 (30 seconds)** in packed extensions. Chrome will silently clamp 25s to 30s in production, but during unpacked development it will work at 25s — creating a dev/prod behavior divergence.

The 30-second alarm period exactly matches the 30-second service worker inactivity termination window (confirmed: "After 30 seconds of inactivity" per Chrome docs). This means there is a race: the alarm fires at ~30s and the worker termination timer also fires at ~30s. In practice Chrome delivers the alarm event before termination, but this is implementation-dependent and not guaranteed.

**Recommendation:** Update spec to: "Use `chrome.alarms` with `periodInMinutes: 0.5` (30 seconds, the Chrome minimum). Acknowledge this is at the boundary of the service worker termination window. The recovery logic (Line 59) serves as the safety net for any missed heartbeat. On every alarm tick, also re-persist `currentSession` to `storage.session` as a checkpoint."

---

## LOW Findings

### L1 — Override Popup Auto-Dismiss Default Not Stated

**Location:** Section 6 (Override Popup), Line 147  
**Issue:** "Auto-dismiss after 8 seconds if no interaction" — but the spec doesn't state what classification the domain retains after auto-dismiss. Since the popup only appears for Noise-classified domains (Line 94), the domain should stay Noise, but this should be explicit.  
**Recommendation:** Add: "On auto-dismiss, the domain retains its default classification (Noise, since the popup only appears for Noise-classified domains). No rule is saved."

---

### L2 — Redundant Permissions (`activeTab`, `scripting`)

**Location:** Section (Permissions), Lines 28-32  
**Issue:** `activeTab` is redundant when `<all_urls>` host_permissions are present — the broader permission already covers what `activeTab` grants. `scripting` is marked "kept for flexibility" but content scripts are statically declared, making dynamic injection unnecessary. Both permissions increase the Chrome install warning severity without providing value.  
**Recommendation:** Remove `activeTab` and `scripting` from permissions. Keep only: `["tabs", "storage", "alarms"]`. This reduces the install warning from "Read and change all your data on all websites" (the <all_urls> warning remains regardless) and simplifies the permission model.

---

### L3 — Event Ordering Between Content Script and Tab Events Not Defined

**Location:** Section 1 (Tab & Visibility Monitoring), Lines 66-75  
**Issue:** When a user switches tabs, both `chrome.tabs.onActivated` (background) and `VISIBILITY_CHANGE` (content script) fire. The spec says "Background is the single source of truth" but doesn't define priority/ordering when both arrive simultaneously or out-of-order. Different orderings could cause a brief double-session or dropped session.  
**Recommendation:** Add: "Background events (`onActivated`, `onFocusChanged`) take precedence over content script `VISIBILITY_CHANGE` messages. If a `VISIBILITY_CHANGE` arrives for a tab that is no longer the active tab per `chrome.tabs.query`, ignore it."

---

### L4 — Browser Restart Loses Current Session Data

**Location:** Section 1 (Service Worker Lifecycle), Line 55  
**Issue:** `chrome.storage.session` is ephemeral and cleared on browser close. If Chrome is closed (not just the service worker killed), the current session's accumulated time since last persist is lost. The recovery logic (Line 59) only handles service worker restarts, not browser restarts.  
**Recommendation:** This is acceptable for v0.1. Add to Known Gotchas in AUDIT.md: "Browser close/restart loses the current active session's time (storage.session is ephemeral). Maximum loss: <30 seconds if alarm-tick persistence is implemented."

---

## Previously Raised Issues — Now Resolved

The following CRITICAL/HIGH issues from Audit #1 are confirmed as properly addressed in the updated spec:

1. **Service worker lifecycle** → Lines 52-61: storage.session, alarms heartbeat, Date.now(), recovery logic. RESOLVED.
2. **Missing alarms permission** → Line 32: `"alarms"` added. RESOLVED.
3. **No content_scripts declaration** → Lines 35-41: Static declaration with `<all_urls>`. RESOLVED.
4. **Message sender validation** → Lines 153-156, 282-289: `sender.id` check, `externally_connectable: {}`. RESOLVED.
5. **Full URL storage** → Lines 71, 120, 128: Domain only, `extractDomain()` helper. RESOLVED.
6. **Missing CSP** → Lines 199, 273-279: Explicit CSP policy. RESOLVED.
7. **Regex in user rules** → Line 97: Removed regex, exact domain matching only. RESOLVED.
8. **"When in work repos" conditional** → Line 81: Removed (cannot be implemented without AI). RESOLVED.
9. **Message schema undefined** → Lines 157-166: Full message/response schema defined. RESOLVED.
10. **Debounce undefined** → Line 105: 1-second debounce explicitly defined. RESOLVED.
11. **Midnight reset undefined** → Line 124: Alarm-based rollover with day boundary attribution. RESOLVED.
12. **Multi-window tracking** → Lines 68, 107: Only focused window's active tab. RESOLVED.

---

## Architecture Assessment

### What's Working Well

- **Single source of truth:** Background service worker owns all session state. Content scripts are pure sensors. This is correct MV3 architecture.
- **storage.session for ephemeral state:** The right choice for currentSession — survives worker restarts, auto-cleans on browser close.
- **Recovery logic:** The 5-minute threshold with persist-on-checkpoint is a sound pattern for MV3 time tracking.
- **Shadow DOM for override popup:** Correct isolation strategy. `mode: 'closed'` prevents host page manipulation.
- **Security posture:** Sender validation, no innerHTML, domain-only storage, empty externally_connectable, explicit CSP — all strong choices.
- **Debounce:** 1-second tab switch debounce prevents noise from rapid Alt-Tab cycles.
- **Message schema:** Typed messages with response format and retry — good inter-component contract.

### Blast Radius Assessment

| Change Area | Blast Radius | Risk |
|------------|-------------|------|
| Classification rules | Per-domain only | LOW — isolated to affected domain |
| Message schema | All components | MEDIUM — breaks popup + content script |
| Storage schema | Background + popup | MEDIUM — migration needed if changed |
| Session logic | Core timer | HIGH — affects all time tracking |
| Permissions | Install experience | LOW — only affects install warning |

The highest blast radius area is session/timer logic — changes there affect all tracked data. The spec's modular structure (classification.js, storage.js, time.js) provides reasonable isolation for other changes.

---

*End of Architecture Audit Report*
