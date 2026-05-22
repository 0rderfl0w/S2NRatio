// background.js
// S2NRatio v0.1 - Background Service Worker

import { classifyDomain, extractDomain, normalizeDomain } from './utils/classification.js';
import {
  getSettings,
  getDailyData,
  updateDailyData,
  getSiteRules,
  getTodaySiteRules,
  saveTodaySiteRule,
  removeTodaySiteRule,
  clearTodaySiteRules,
  getCurrentSession,
  setCurrentSession,
  clearCurrentSession
} from './utils/storage.js';
import { getTodayKey } from './utils/time.js';

const HEARTBEAT_ALARM = 's2nr-heartbeat';
const MIDNIGHT_ALARM = 's2nr-midnight';
const OFF_WEB_KEY = '__off_the_web__';
const OFF_WEB_MIN_MS = 5000;
const RETENTION_DAYS = 30;
const MIN_INACTIVITY_SECONDS = 30;
const MAX_INACTIVITY_SECONDS = 900;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'Unauthorized' });
    return true;
  }

  (async () => {
    try {
      const { type, payload } = message || {};

      switch (type) {
        case 'GET_DAILY_DATA':
          sendResponse({ success: true, data: await getDailyDataResponse() });
          break;

        case 'UPDATE_CLASSIFICATION':
          sendResponse({
            success: true,
            data: await handleClassificationUpdate(payload)
          });
          break;

        case 'SPLIT_ACTIVITY':
          sendResponse({
            success: true,
            data: await splitActivity(payload)
          });
          break;

        case 'UPDATE_ACTIVITY_SEGMENT':
          sendResponse({
            success: true,
            data: await updateActivitySegment(payload)
          });
          break;

        case 'UPDATE_ACTIVITY_DURATION':
          sendResponse({
            success: true,
            data: await updateActivityDuration(payload)
          });
          break;

        case 'CLASSIFY_SITE':
          sendResponse({
            success: true,
            data: await classifySite(payload)
          });
          break;

        case 'VISIBILITY_CHANGE':
          sendResponse({
            success: true,
            data: await handleVisibilityChange(payload, sender)
          });
          break;

        case 'ACTIVITY_PING':
          sendResponse({
            success: true,
            data: await handleActivityPing(payload, sender)
          });
          break;

        case 'RESET_TODAY':
          await resetToday();
          sendResponse({ success: true });
          break;

        case 'TOGGLE_TRACKING':
          sendResponse({
            success: true,
            data: await toggleTracking(payload?.paused)
          });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('Background message error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true;
});

async function getDailyDataResponse() {
  const settings = await getSettings();
  await enforceCurrentSessionActivity(settings);

  const todayKey = getTodayKey(settings.dayStartHour);
  const daily = await getDailyData(todayKey);
  const current = await getCurrentSession();
  const currentSite = await getActiveTabSite(current);
  const engagement = await getEngagementSnapshot(current, settings);

  return {
    ...addLiveSessionToDailyData(daily, current),
    currentSession: current,
    currentSite,
    engagement,
    settings,
    date: todayKey
  };
}

function addLiveSessionToDailyData(daily, current) {
  const copy = {
    activities: Object.fromEntries(
      Object.entries(daily.activities || {}).map(([domain, activity]) => [domain, { ...activity }])
    ),
    totalSignalMs: 0,
    totalNoiseMs: 0
  };
  recalculateDailyTotals(copy);

  if (!current?.domain || !current.startTime) return copy;

  const elapsedMs = Date.now() - current.startTime;
  if (elapsedMs < 1000) return copy;

  const domain = current.domain;
  const existing = copy.activities[domain] || {
    classification: current.classification,
    durationMs: 0
  };
  const elapsedClassification = current.classification === 'noise' ? 'noise' : 'signal';

  if (isSplitActivity(existing)) {
    copy.activities[domain] = {
      ...existing,
      durationMs: getActivityDurationMs(existing) + elapsedMs,
      signalMs: (existing.signalMs || 0) + (elapsedClassification === 'signal' ? elapsedMs : 0),
      noiseMs: (existing.noiseMs || 0) + (elapsedClassification === 'noise' ? elapsedMs : 0)
    };
  } else {
    copy.activities[domain] = {
      ...existing,
      classification: elapsedClassification,
      durationMs: (existing.durationMs || 0) + elapsedMs
    };
  }

  if (elapsedClassification === 'signal') {
    copy.totalSignalMs += elapsedMs;
  } else {
    copy.totalNoiseMs += elapsedMs;
  }

  return copy;
}

async function classifySite(payload = {}) {
  const settings = await getSettings();
  const rules = await getEffectiveSiteRules(settings);
  const domain = extractDomain(payload.url || '');
  const classification = classifyDomain(domain, rules);
  const hasRule = hasSavedRule(domain, rules);

  return {
    domain,
    classification,
    hasRule,
    promptMode: settings.promptMode || 'always',
    showPopup: settings.showPopup !== false && !settings.trackingPaused
  };
}

function hasSavedRule(domain, rules) {
  if (!domain || !rules) return false;
  if (rules[domain]) return true;

  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i += 1) {
    if (rules[parts.slice(i).join('.')]) return true;
  }

  return false;
}

async function handleClassificationUpdate({ domain, newClassification, remember = true, rememberToday = false } = {}) {
  const normalized = normalizeDomain(domain);
  if (!normalized || !['signal', 'noise'].includes(newClassification)) {
    return { updated: false };
  }

  const session = await getCurrentSession();
  if (session?.domain === normalized) {
    session.classification = newClassification;
    await setCurrentSession(session);
  }

  if (remember) {
    const rules = await getSiteRules();
    rules[normalized] = newClassification;
    await chrome.storage.local.set({ siteRules: rules });
    await removeTodaySiteRule(normalized);
  } else if (rememberToday) {
    await saveTodaySiteRule(normalized, newClassification);
  }

  await updateExistingActivityClassification(normalized, newClassification);

  return {
    updated: true,
    domain: normalized,
    classification: newClassification,
    remembered: remember ? 'always' : (rememberToday ? 'today' : 'session')
  };
}

async function updateExistingActivityClassification(domain, newClassification) {
  const todayKey = getTodayKey((await getSettings()).dayStartHour);
  const daily = await getDailyData(todayKey);
  const activity = daily.activities?.[domain];

  if (!activity) return;

  const durationMs = getActivityDurationMs(activity);
  activity.classification = newClassification;
  activity.durationMs = durationMs;
  delete activity.signalMs;
  delete activity.noiseMs;
  recalculateDailyTotals(daily);
  await updateDailyDataAndMaybeShowGoalEffect(todayKey, daily);
}

async function splitActivity({ domain } = {}) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { updated: false };

  await checkpointCurrentSessionForDomain(normalized);

  const todayKey = getTodayKey((await getSettings()).dayStartHour);
  const daily = await getDailyData(todayKey);
  const activity = daily.activities?.[normalized];
  if (!activity) return { updated: false };

  const durationMs = getActivityDurationMs(activity);
  if (durationMs < 1000) return { updated: false };

  const primaryClassification = activity.classification === 'signal' ? 'signal' : 'noise';
  const secondaryClassification = primaryClassification === 'signal' ? 'noise' : 'signal';
  const primaryMs = Math.floor(durationMs / 2);
  const secondaryMs = durationMs - primaryMs;

  activity.classification = primaryClassification;
  activity.durationMs = durationMs;
  activity.signalMs = primaryClassification === 'signal' ? primaryMs : secondaryMs;
  activity.noiseMs = primaryClassification === 'noise' ? primaryMs : secondaryMs;

  if (secondaryClassification === 'signal') {
    activity.signalMs = secondaryMs;
  } else {
    activity.noiseMs = secondaryMs;
  }

  recalculateDailyTotals(daily);
  await updateDailyDataAndMaybeShowGoalEffect(todayKey, daily);

  return { updated: true, domain: normalized };
}

async function updateActivitySegment({ domain, fromClassification, toClassification } = {}) {
  const normalized = normalizeDomain(domain);
  if (!normalized || !['signal', 'noise'].includes(fromClassification) || !['signal', 'noise'].includes(toClassification)) {
    return { updated: false };
  }

  await checkpointCurrentSessionForDomain(normalized);

  const todayKey = getTodayKey((await getSettings()).dayStartHour);
  const daily = await getDailyData(todayKey);
  const activity = daily.activities?.[normalized];
  if (!activity) return { updated: false };

  if (!isSplitActivity(activity)) {
    await updateExistingActivityClassification(normalized, toClassification);
    return { updated: true, domain: normalized };
  }

  const fromKey = fromClassification === 'signal' ? 'signalMs' : 'noiseMs';
  const toKey = toClassification === 'signal' ? 'signalMs' : 'noiseMs';
  const movedMs = activity[fromKey] || 0;
  if (movedMs <= 0 || fromKey === toKey) return { updated: false };

  activity[fromKey] = 0;
  activity[toKey] = (activity[toKey] || 0) + movedMs;
  activity.durationMs = getActivityDurationMs(activity);
  activity.classification = activity.noiseMs > activity.signalMs ? 'noise' : 'signal';

  if (!activity.signalMs || !activity.noiseMs) {
    activity.classification = activity.signalMs > 0 ? 'signal' : 'noise';
    activity.durationMs = getActivityDurationMs(activity);
    delete activity.signalMs;
    delete activity.noiseMs;
  }

  recalculateDailyTotals(daily);
  await updateDailyDataAndMaybeShowGoalEffect(todayKey, daily);

  return { updated: true, domain: normalized };
}

async function updateActivityDuration({ domain, classification, durationMs } = {}) {
  const normalized = normalizeDomain(domain);
  const nextDurationMs = Number(durationMs);
  if (!normalized || !Number.isFinite(nextDurationMs) || nextDurationMs < 0) {
    return { updated: false };
  }

  await checkpointCurrentSessionForDomain(normalized);

  const todayKey = getTodayKey((await getSettings()).dayStartHour);
  const daily = await getDailyData(todayKey);
  const activity = daily.activities?.[normalized];
  if (!activity) return { updated: false };

  if (isSplitActivity(activity)) {
    if (!['signal', 'noise'].includes(classification)) {
      return { updated: false };
    }

    if (classification === 'signal') {
      activity.signalMs = nextDurationMs;
    } else {
      activity.noiseMs = nextDurationMs;
    }

    activity.durationMs = getActivityDurationMs(activity);
    activity.classification = (activity.noiseMs || 0) > (activity.signalMs || 0) ? 'noise' : 'signal';
  } else {
    activity.durationMs = nextDurationMs;
  }

  recalculateDailyTotals(daily);
  await updateDailyDataAndMaybeShowGoalEffect(todayKey, daily);

  return { updated: true, domain: normalized };
}

async function checkpointCurrentSessionForDomain(domain) {
  await enforceCurrentSessionActivity();

  const session = await getCurrentSession();
  if (session?.domain !== domain) return;

  await endSession(session);
  await setCurrentSession({ ...session, startTime: Date.now() });
}

function isSplitActivity(activity) {
  return Number.isFinite(activity?.signalMs) || Number.isFinite(activity?.noiseMs);
}

function getActivityDurationMs(activity) {
  if (isSplitActivity(activity)) {
    return (activity.signalMs || 0) + (activity.noiseMs || 0);
  }

  return activity?.durationMs || 0;
}

function recalculateDailyTotals(daily) {
  daily.totalSignalMs = 0;
  daily.totalNoiseMs = 0;

  for (const activity of Object.values(daily.activities || {})) {
    if (isSplitActivity(activity)) {
      activity.durationMs = getActivityDurationMs(activity);
      daily.totalSignalMs += activity.signalMs || 0;
      daily.totalNoiseMs += activity.noiseMs || 0;
    } else if (activity.classification === 'signal') {
      daily.totalSignalMs += activity.durationMs || 0;
    } else {
      daily.totalNoiseMs += activity.durationMs || 0;
    }
  }
}

async function updateDailyDataAndMaybeShowGoalEffect(todayKey, daily) {
  await updateDailyData(todayKey, daily);
  await maybeShowGoalCrossingPopup(todayKey, daily);
}

async function maybeShowLiveGoalCrossingPopup(settings = null) {
  const resolvedSettings = settings || await getSettings();
  const todayKey = getTodayKey(resolvedSettings.dayStartHour);
  const daily = await getDailyData(todayKey);
  const current = await getCurrentSession();
  await maybeShowGoalCrossingPopup(todayKey, addLiveSessionToDailyData(daily, current), resolvedSettings);
}

async function maybeShowGoalCrossingPopup(todayKey, daily, settings = null) {
  const resolvedSettings = settings || await getSettings();
  const target = clampPercent(Number(resolvedSettings.targetSignalRatio || 70), 70);
  const totals = calculateWebsiteTotals(daily);
  const total = totals.signalMs + totals.noiseMs;
  const ratio = total > 0 ? Math.round((totals.signalMs / total) * 100) : 0;
  const atGoal = total > 0 && ratio >= target;
  const stateKey = `${todayKey}:${target}`;
  const result = await chrome.storage.local.get(['goalEffectState']);
  const goalEffectState = result.goalEffectState || {};
  const previous = goalEffectState[stateKey];

  if (previous === undefined || total <= 0) {
    goalEffectState[stateKey] = atGoal;
    await chrome.storage.local.set({ goalEffectState });
    return;
  }

  let effectType = null;
  if (!previous && atGoal && resolvedSettings.goalCelebrationEnabled !== false) {
    effectType = 'celebrate';
  } else if (previous && !atGoal && resolvedSettings.goalDropAlertEnabled !== false) {
    effectType = 'drop';
  }

  if (previous !== atGoal) {
    goalEffectState[stateKey] = atGoal;
    await chrome.storage.local.set({ goalEffectState });
  }

  if (effectType) {
    await showGoalEffectOnActiveTab(effectType, { ratio, target });
  }
}

function calculateWebsiteTotals(daily = {}) {
  const totals = { signalMs: 0, noiseMs: 0 };

  for (const [domain, activity] of Object.entries(daily.activities || {})) {
    if (domain === OFF_WEB_KEY) continue;

    if (isSplitActivity(activity)) {
      totals.signalMs += activity.signalMs || 0;
      totals.noiseMs += activity.noiseMs || 0;
    } else if (activity.classification === 'noise') {
      totals.noiseMs += activity.durationMs || 0;
    } else {
      totals.signalMs += activity.durationMs || 0;
    }
  }

  return totals;
}

function clampPercent(value, fallback = 0) {
  const resolved = Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, Math.round(resolved)));
}

async function showGoalEffectOnActiveTab(effectType, { ratio, target }) {
  const tab = await getFocusedActiveTab();
  if (!tab?.id) return;

  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'SHOW_GOAL_EFFECT',
      payload: { effectType, ratio, target }
    });
  } catch (e) {
    // Some pages cannot receive content-script messages, such as chrome:// pages.
  }
}

async function clearGoalEffectStateForDate(dateKey) {
  const result = await chrome.storage.local.get(['goalEffectState']);
  const goalEffectState = result.goalEffectState || {};
  let changed = false;

  for (const key of Object.keys(goalEffectState)) {
    if (key.startsWith(`${dateKey}:`)) {
      delete goalEffectState[key];
      changed = true;
    }
  }

  if (changed) {
    await chrome.storage.local.set({ goalEffectState });
  }
}

async function getActiveTabSite(currentSession = null) {
  const tab = await getFocusedActiveTab();
  if (!tab?.url) return null;

  const domain = extractDomain(tab.url);
  if (!domain || domain === 'unknown') return null;

  if (currentSession?.domain === domain) {
    return { domain, classification: currentSession.classification };
  }

  const rules = await getSiteRules();
  const todayRules = await getTodaySiteRules();
  return { domain, classification: classifyDomain(domain, mergeSiteRules(rules, todayRules)) };
}

async function handleVisibilityChange(payload = {}, sender = {}) {
  const tabId = sender.tab?.id;
  const domain = extractDomain(sender.tab?.url || '');
  if (!tabId || !domain || domain === 'unknown') return { tracked: false };

  if (payload.visible) {
    const tab = await chrome.tabs.get(tabId);
    if (!(await isTrackableTab(tab))) return { tracked: false };
    await finishOffWebSession();
    await startSessionForTab(tab, { markActivity: true });
    return { tracked: true, domain };
  }

  const current = await getCurrentSession();
  if (current?.tabId === tabId) {
    await endSession(current);
    await clearCurrentSession();
    await stopHeartbeat();
  }

  return { tracked: false, domain };
}

async function handleActivityPing(payload = {}, sender = {}) {
  const tab = sender.tab;
  const domain = extractDomain(tab?.url || '');
  if (!tab?.id || !domain || domain === 'unknown') return { tracked: false };

  await recordTabActivity(tab, payload.source || 'input');

  if (!(await isTrackableTab(tab))) {
    return { tracked: false, domain };
  }

  await startSessionForTab(tab);
  return { tracked: true, domain };
}

async function startSessionForTab(tab, { markActivity = false } = {}) {
  const settings = await getSettings();
  if (settings.trackingPaused) {
    await clearCurrentSession();
    await stopHeartbeat();
    return;
  }

  if (markActivity) {
    await recordTabActivity(tab, 'activation');
  }

  await enforceCurrentSessionActivity(settings);

  if (!(await isTrackableTab(tab))) {
    const current = await getCurrentSession();
    if (current) {
      await endSession(current);
      await clearCurrentSession();
      await stopHeartbeat();
    }
    return;
  }

  const domain = extractDomain(tab.url);
  if (!domain || domain === 'unknown') return;

  const current = await getCurrentSession();
  if (current?.tabId === tab.id && current.domain === domain) return;

  if (current) {
    await endSession(current);
  }

  const engagement = await getTabEngagementState(tab, settings);
  if (!engagement.engaged) return;

  await finishOffWebSession();

  await setCurrentSession({
    tabId: tab.id,
    domain,
    startTime: Date.now(),
    classification: await classifyCurrent(domain),
    lastActivityAt: engagement.lastActivityAt || Date.now()
  });

  await startHeartbeat();
}

async function enforceCurrentSessionActivity(settings = null, { idleStateOverride = null } = {}) {
  const current = await getCurrentSession();
  if (!current) {
    return { engaged: false, reason: 'no_session' };
  }

  const resolvedSettings = settings || await getSettings();
  const engagement = await getSessionEngagementState(current, resolvedSettings, { idleStateOverride });
  if (engagement.engaged) return engagement;

  await endSession(current, { endTime: engagement.endTime });
  await clearCurrentSession();
  await stopHeartbeat();

  return engagement;
}

async function getEngagementSnapshot(current, settings) {
  if (!settings.requireActivityToTrack) {
    return { engaged: true, reason: 'activity_gate_off' };
  }

  if (!current) {
    return {
      engaged: false,
      reason: 'waiting_for_activity',
      thresholdSeconds: getInactivityThresholdSeconds(settings)
    };
  }

  return getSessionEngagementState(current, settings);
}

async function getSessionEngagementState(session, settings, { idleStateOverride = null } = {}) {
  if (!settings.requireActivityToTrack) {
    return { engaged: true, reason: 'activity_gate_off' };
  }

  const thresholdSeconds = getInactivityThresholdSeconds(settings);
  const thresholdMs = thresholdSeconds * 1000;
  const idleState = idleStateOverride || await queryIdleState(thresholdSeconds);
  const activity = await getStoredTabActivity(session.tabId, session.domain);
  const lastActivityAt = activity?.lastActivityAt || session.lastActivityAt || null;
  const now = Date.now();

  if (idleState !== 'active') {
    return {
      engaged: false,
      reason: idleState,
      idleState,
      lastActivityAt,
      thresholdSeconds,
      endTime: getInactivityEndTime(session, lastActivityAt, thresholdMs, now)
    };
  }

  if (!lastActivityAt) {
    return {
      engaged: false,
      reason: 'waiting_for_activity',
      idleState,
      thresholdSeconds,
      endTime: session.startTime
    };
  }

  if (now - lastActivityAt > thresholdMs) {
    return {
      engaged: false,
      reason: 'inactive',
      idleState,
      lastActivityAt,
      thresholdSeconds,
      endTime: getInactivityEndTime(session, lastActivityAt, thresholdMs, now)
    };
  }

  return {
    engaged: true,
    reason: 'active',
    idleState,
    lastActivityAt,
    thresholdSeconds
  };
}

async function getTabEngagementState(tab, settings) {
  if (!settings.requireActivityToTrack) {
    return { engaged: true, reason: 'activity_gate_off' };
  }

  const domain = extractDomain(tab?.url || '');
  const thresholdSeconds = getInactivityThresholdSeconds(settings);
  const thresholdMs = thresholdSeconds * 1000;
  const idleState = await queryIdleState(thresholdSeconds);
  const activity = await getStoredTabActivity(tab.id, domain);
  const lastActivityAt = activity?.lastActivityAt || null;

  if (idleState !== 'active') {
    return { engaged: false, reason: idleState, idleState, lastActivityAt, thresholdSeconds };
  }

  if (!lastActivityAt) {
    return { engaged: false, reason: 'waiting_for_activity', idleState, thresholdSeconds };
  }

  if (Date.now() - lastActivityAt > thresholdMs) {
    return { engaged: false, reason: 'inactive', idleState, lastActivityAt, thresholdSeconds };
  }

  return { engaged: true, reason: 'active', idleState, lastActivityAt, thresholdSeconds };
}

function getInactivityEndTime(session, lastActivityAt, thresholdMs, now) {
  if (!lastActivityAt) return session.startTime;
  return Math.max(session.startTime, Math.min(now, lastActivityAt + thresholdMs));
}

async function recordTabActivity(tab, source = 'input') {
  const domain = extractDomain(tab?.url || '');
  if (!tab?.id || !domain || domain === 'unknown') return null;

  const tabActivity = (await chrome.storage.session.get(['tabActivity'])).tabActivity || {};
  const key = String(tab.id);
  const activity = {
    domain,
    source,
    lastActivityAt: Date.now()
  };

  tabActivity[key] = activity;
  await chrome.storage.session.set({ tabActivity });
  return activity;
}

async function getStoredTabActivity(tabId, domain) {
  if (!tabId) return null;

  const tabActivity = (await chrome.storage.session.get(['tabActivity'])).tabActivity || {};
  const activity = tabActivity[String(tabId)];
  if (!activity) return null;

  if (domain && activity.domain !== domain) return null;
  return activity;
}

function getInactivityThresholdSeconds(settings = {}) {
  const raw = Number.parseInt(settings.inactivityThresholdSeconds, 10);
  const seconds = Number.isFinite(raw) ? raw : 120;
  return Math.min(MAX_INACTIVITY_SECONDS, Math.max(MIN_INACTIVITY_SECONDS, seconds));
}

async function queryIdleState(thresholdSeconds) {
  if (!chrome.idle?.queryState) return 'active';

  try {
    const maybePromise = chrome.idle.queryState(thresholdSeconds);
    if (maybePromise && typeof maybePromise.then === 'function') {
      return await maybePromise;
    }
    if (typeof maybePromise === 'string') return maybePromise;
  } catch (e) {
    // Fall back to the callback form below for older Chrome builds.
  }

  return new Promise((resolve) => {
    try {
      chrome.idle.queryState(thresholdSeconds, (state) => resolve(state || 'active'));
    } catch (e) {
      resolve('active');
    }
  });
}

async function configureIdleDetection(settings = null) {
  if (!chrome.idle?.setDetectionInterval) return;

  const resolvedSettings = settings || await getSettings();
  try {
    chrome.idle.setDetectionInterval(getInactivityThresholdSeconds(resolvedSettings));
  } catch (e) {}
}

async function isTrackableTab(tab) {
  if (!tab?.id || !tab.active || !tab.url) return false;
  const domain = extractDomain(tab.url);
  if (!domain || domain === 'unknown') return false;

  const win = await chrome.windows.get(tab.windowId);
  return !!win?.focused;
}

async function getFocusedActiveTab(windowId = null) {
  const query = { active: true };
  if (windowId) {
    query.windowId = windowId;
  } else {
    query.lastFocusedWindow = true;
  }

  const [tab] = await chrome.tabs.query(query);
  if (!tab || !(await isTrackableTab(tab))) return null;
  return tab;
}

async function classifyCurrent(domain) {
  const rules = await getEffectiveSiteRules();
  return classifyDomain(domain, rules);
}

async function getEffectiveSiteRules(settings = null) {
  const resolvedSettings = settings || await getSettings();
  const todayKey = getTodayKey(resolvedSettings.dayStartHour);
  const [siteRules, todayRules] = await Promise.all([
    getSiteRules(),
    getTodaySiteRules(todayKey)
  ]);

  return mergeSiteRules(siteRules, todayRules);
}

function mergeSiteRules(siteRules = {}, todayRules = {}) {
  return { ...todayRules, ...siteRules };
}

async function endSession(session, { endTime = Date.now() } = {}) {
  if (!session?.startTime) return;

  const duration = endTime - session.startTime;
  if (duration < 1000) return;

  await addDurationToToday(session.domain || OFF_WEB_KEY, session.classification || 'signal', duration);
}

async function addDurationToToday(domain, classification, durationMs) {
  const todayKey = getTodayKey((await getSettings()).dayStartHour);
  const daily = await getDailyData(todayKey);
  const key = domain || OFF_WEB_KEY;

  const activity = daily.activities[key];
  if (!activity) {
    daily.activities[key] = { classification, durationMs };
  } else if (isSplitActivity(activity)) {
    if (classification === 'signal') {
      activity.signalMs = (activity.signalMs || 0) + durationMs;
    } else {
      activity.noiseMs = (activity.noiseMs || 0) + durationMs;
    }
    activity.durationMs = getActivityDurationMs(activity);
  } else {
    activity.classification = classification;
    activity.durationMs = (activity.durationMs || 0) + durationMs;
  }

  if (classification === 'signal') {
    daily.totalSignalMs = (daily.totalSignalMs || 0) + durationMs;
  } else {
    daily.totalNoiseMs = (daily.totalNoiseMs || 0) + durationMs;
  }

  await updateDailyDataAndMaybeShowGoalEffect(todayKey, daily);
}

async function startOffWebSession() {
  await chrome.storage.session.set({ offWebStart: Date.now() });
}

async function finishOffWebSession({ restart = false } = {}) {
  const result = await chrome.storage.session.get(['offWebStart']);
  const offWebStart = result.offWebStart;
  if (!offWebStart) return;

  const duration = Date.now() - offWebStart;
  await chrome.storage.session.remove('offWebStart');

  if (duration >= OFF_WEB_MIN_MS) {
    await addDurationToToday(OFF_WEB_KEY, 'signal', duration);
  }

  if (restart) {
    await startOffWebSession();
  }
}

async function resetToday() {
  const settings = await getSettings();
  const todayKey = getTodayKey(settings.dayStartHour);
  const result = await chrome.storage.local.get(['dailyData']);
  const dailyData = result.dailyData || {};
  delete dailyData[todayKey];
  await chrome.storage.local.set({ dailyData });
  await clearTodaySiteRules(todayKey);
  await clearGoalEffectStateForDate(todayKey);
}

async function toggleTracking(paused = null) {
  const settings = await getSettings();
  const nextPaused = paused === null ? !settings.trackingPaused : !!paused;
  const updatedSettings = { ...settings, trackingPaused: nextPaused };
  await chrome.storage.local.set({ settings: updatedSettings });

  if (nextPaused) {
    const current = await getCurrentSession();
    if (current) {
      await endSession(current);
      await clearCurrentSession();
    }
    await stopHeartbeat();
  } else {
    await finishOffWebSession();
    const tab = await getFocusedActiveTab();
    if (tab) await startSessionForTab(tab, { markActivity: true });
  }

  return { trackingPaused: nextPaused };
}

async function startHeartbeat() {
  try {
    await chrome.alarms.clear(HEARTBEAT_ALARM);
    await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
  } catch (e) {}
}

async function stopHeartbeat() {
  await chrome.alarms.clear(HEARTBEAT_ALARM);
}

async function handleMidnightReset() {
  const current = await getCurrentSession();
  if (current) {
    await endSession(current);
    await clearCurrentSession();
  }

  await finishOffWebSession({ restart: true });
  await pruneOldDailyData();
  await pruneTodaySiteRules();

  const tab = await getFocusedActiveTab();
  if (tab) await startSessionForTab(tab);
}

async function scheduleMidnightAlarm(dayStartHour = null) {
  const settings = dayStartHour === null ? await getSettings() : { dayStartHour };
  const now = new Date();
  const nextReset = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    settings.dayStartHour || 0,
    0,
    0
  );

  if (nextReset <= now) {
    nextReset.setDate(nextReset.getDate() + 1);
  }

  await chrome.alarms.clear(MIDNIGHT_ALARM);
  await chrome.alarms.create(MIDNIGHT_ALARM, { when: nextReset.getTime(), periodInMinutes: 1440 });
}

async function pruneOldDailyData() {
  const result = await chrome.storage.local.get(['dailyData']);
  const dailyData = result.dailyData || {};
  const cutoff = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);

  for (const key of Object.keys(dailyData)) {
    if (new Date(`${key}T00:00:00`).getTime() < cutoff) {
      delete dailyData[key];
    }
  }

  await chrome.storage.local.set({ dailyData });
}

async function pruneTodaySiteRules() {
  const settings = await getSettings();
  const todayKey = getTodayKey(settings.dayStartHour);
  const result = await chrome.storage.local.get(['todaySiteRules']);
  const todaySiteRules = result.todaySiteRules || {};

  for (const key of Object.keys(todaySiteRules)) {
    if (key !== todayKey) {
      delete todaySiteRules[key];
    }
  }

  await chrome.storage.local.set({ todaySiteRules });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) {
    await enforceCurrentSessionActivity();
    const current = await getCurrentSession();
    if (current) {
      await maybeShowLiveGoalCrossingPopup();
      await setCurrentSession({ ...current, lastHeartbeat: Date.now() });
    } else {
      await chrome.alarms.clear(HEARTBEAT_ALARM);
    }
  } else if (alarm.name === MIDNIGHT_ALARM) {
    await handleMidnightReset();
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await startSessionForTab(tab, { markActivity: true });
  } catch (e) {}
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const current = await getCurrentSession();
  if (current?.tabId === tabId) {
    await endSession(current);
    await clearCurrentSession();
    await stopHeartbeat();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active || !(changeInfo.url || changeInfo.status === 'complete')) return;
  try {
    await startSessionForTab(tab, { markActivity: !!changeInfo.url });
  } catch (e) {}
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    const current = await getCurrentSession();
    if (current) {
      await endSession(current);
      await clearCurrentSession();
      await stopHeartbeat();
    }
    await startOffWebSession();
    return;
  }

  await finishOffWebSession();

  try {
    const tab = await getFocusedActiveTab(windowId);
    if (tab) await startSessionForTab(tab, { markActivity: true });
  } catch (e) {}
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings?.newValue) {
    scheduleMidnightAlarm(changes.settings.newValue.dayStartHour).catch(() => {});
    configureIdleDetection(changes.settings.newValue).catch(() => {});
  }
});

if (chrome.idle?.onStateChanged) {
  chrome.idle.onStateChanged.addListener(async (idleState) => {
    if (idleState === 'active') {
      try {
        const tab = await getFocusedActiveTab();
        if (tab) await startSessionForTab(tab, { markActivity: true });
      } catch (e) {}
      return;
    }

    await enforceCurrentSessionActivity(null, { idleStateOverride: idleState });
  });
}

chrome.runtime.onStartup.addListener(async () => {
  const current = await getCurrentSession();
  if (!current || Date.now() - current.startTime > 5 * 60 * 1000) {
    await clearCurrentSession();
  }

  try {
    const tab = await getFocusedActiveTab();
    if (tab) await startSessionForTab(tab);
  } catch (e) {}
});

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleMidnightAlarm();
  await configureIdleDetection();
});

console.log('S2NRatio background service worker ready');
