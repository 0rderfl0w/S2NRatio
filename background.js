// background.js
// S2NRatio v0.1 - Background Service Worker

import { classifyDomainWithRulePriority, extractDomain, normalizeDomain } from './utils/classification.js';
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
const BADGE_ALARM = 's2nr-ratio-badge';
const OFF_WEB_KEY = '__off_the_web__';
const OFF_WEB_MIN_MS = 5000;
const TRACKING_DEBUG_LOG_KEY = 'trackingDebugLog';
const TRACKING_DEBUG_LOG_LIMIT = 200;
let startSessionQueue = Promise.resolve();
const RETENTION_DAYS = 30;
const MIN_INACTIVITY_SECONDS = 30;
const MAX_INACTIVITY_SECONDS = 900;
const SIGNAL_BADGE_COLOR = '#10b981';
const NOISE_BADGE_COLOR = '#ef4444';
const ENGAGEMENT_ACTIVITY_SOURCES = new Set([
  'input',
  'pointerdown',
  'keydown',
  'scroll',
  'wheel',
  'touchstart',
  'mousemove',
  // Browser-level user navigation is engagement too. After Reset Today clears
  // content-script activity, relying only on page DOM input means tab switches,
  // address-bar navigations, and link-driven page changes can sit at "Awaiting
  // input" and drop real reading time until the next scroll/click.
  'activation',
  'navigation',
  'media-playback'
]);

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

        case 'GET_TRACKING_DEBUG_LOG':
          sendResponse({ success: true, data: await getTrackingDebugLog() });
          break;

        case 'CLEAR_TRACKING_DEBUG_LOG':
          await clearTrackingDebugLog();
          sendResponse({ success: true });
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

        case 'CLEAR_TRACKING_HISTORY':
          await clearTrackingHistory();
          sendResponse({ success: true });
          break;

        case 'CLEAR_ALL_DATA':
          await clearAllData();
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

function compactDebugValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(compactDebugValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .slice(0, 20)
        .map(([key, item]) => [key, compactDebugValue(item)])
    );
  }
  return String(value);
}

async function logTrackingEvent(event, details = {}) {
  try {
    const result = await chrome.storage.session.get([TRACKING_DEBUG_LOG_KEY]);
    const events = Array.isArray(result[TRACKING_DEBUG_LOG_KEY])
      ? result[TRACKING_DEBUG_LOG_KEY]
      : [];
    events.push({
      at: new Date().toISOString(),
      event,
      ...compactDebugValue(details)
    });
    await chrome.storage.session.set({
      [TRACKING_DEBUG_LOG_KEY]: events.slice(-TRACKING_DEBUG_LOG_LIMIT)
    });
  } catch (e) {
    // Debug logging must never affect tracking.
  }
}

async function getTrackingDebugLog() {
  const [session, settings] = await Promise.all([
    chrome.storage.session.get([TRACKING_DEBUG_LOG_KEY, 'currentSession', 'tabActivity', 'offWebStart']),
    getSettings()
  ]);

  return {
    events: Array.isArray(session[TRACKING_DEBUG_LOG_KEY]) ? session[TRACKING_DEBUG_LOG_KEY] : [],
    currentSession: session.currentSession || null,
    tabActivity: session.tabActivity || {},
    offWebStart: session.offWebStart || null,
    settings: {
      requireActivityToTrack: settings.requireActivityToTrack !== false,
      inactivityThresholdSeconds: getInactivityThresholdSeconds(settings),
      trackingPaused: !!settings.trackingPaused
    }
  };
}

async function clearTrackingDebugLog() {
  await chrome.storage.session.remove(TRACKING_DEBUG_LOG_KEY);
}

async function getDailyDataResponse() {
  const settings = await getSettings();
  await enforceCurrentSessionActivity(settings);

  const todayKey = getTodayKey(settings.dayStartHour);
  const daily = await getDailyData(todayKey);
  const current = await getCurrentSession();
  const currentSite = await getActiveTabSite(current);
  const engagement = await getEngagementSnapshot(current, settings);
  const liveDaily = await addLiveSessionToDailyData(daily, current, settings);
  const responseSession = current
    ? { ...current, trackedElapsedMs: await getSessionDurationMs(current, { settings }) }
    : null;

  return {
    ...liveDaily,
    weeklyStats: await getWeeklyStats(todayKey, liveDaily, settings),
    currentSession: responseSession,
    currentSite,
    engagement,
    settings,
    date: todayKey
  };
}

async function addLiveSessionToDailyData(daily, current, settings = null) {
  const copy = {
    activities: Object.fromEntries(
      Object.entries(daily.activities || {}).map(([domain, activity]) => [domain, { ...activity }])
    ),
    totalSignalMs: 0,
    totalNoiseMs: 0
  };
  recalculateDailyTotals(copy);

  if (!current?.domain || !current.startTime) return copy;

  const elapsedMs = await getSessionDurationMs(current, { settings });
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
  const todayKey = getTodayKey(settings.dayStartHour);
  const [siteRules, todayRules] = await Promise.all([
    getSiteRules(),
    getTodaySiteRules(todayKey)
  ]);
  const domain = extractDomain(payload.url || '');
  const classification = classifyEffectiveDomain(domain, siteRules, todayRules);
  const hasRule = hasSavedRule(domain, todayRules) || hasSavedRule(domain, siteRules);

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
  await updateActionBadge();

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
  await updateActionBadge();

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
    await updateActionBadge();
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
  await updateActionBadge();

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
    collapseSplitActivityIfOneSided(activity);
  } else {
    activity.durationMs = nextDurationMs;
  }

  recalculateDailyTotals(daily);
  await updateDailyDataAndMaybeShowGoalEffect(todayKey, daily);
  await updateActionBadge();

  return { updated: true, domain: normalized };
}

async function checkpointCurrentSessionForDomain(domain) {
  await enforceCurrentSessionActivity();

  const session = await getCurrentSession();
  if (session?.domain !== domain) return;

  await clearCurrentSession();
  await stopHeartbeat();
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

function collapseSplitActivityIfOneSided(activity) {
  if (!isSplitActivity(activity)) return;
  if ((activity.signalMs || 0) > 0 && (activity.noiseMs || 0) > 0) return;

  activity.classification = (activity.signalMs || 0) > 0 ? 'signal' : 'noise';
  activity.durationMs = getActivityDurationMs(activity);
  delete activity.signalMs;
  delete activity.noiseMs;
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
  await maybeShowGoalCrossingPopup(
    todayKey,
    await addLiveSessionToDailyData(daily, current, resolvedSettings),
    resolvedSettings
  );
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

async function getWeeklyStats(todayKey, liveDaily, settings = {}) {
  const result = await chrome.storage.local.get(['dailyData']);
  const dailyData = result.dailyData || {};
  const dateKeys = getRecentDateKeys(todayKey, 7);
  const includedWeekdays = getIncludedWeeklyAverageDays(settings);
  const startDate = parseDateKeyOrNull(settings.weeklyAverageStartDate);
  const stats = {
    signalMs: 0,
    noiseMs: 0,
    totalMs: 0,
    ratio: 0,
    daysWithData: 0,
    startDate: dateKeys[0],
    endDate: todayKey,
    includedWeekdays,
    freshStartDate: settings.weeklyAverageStartDate || null
  };

  for (const dateKey of dateKeys) {
    const date = parseDateKey(dateKey);
    if (startDate && date < startDate) continue;
    if (!includedWeekdays.includes(date.getDay())) continue;

    const source = dateKey === todayKey ? liveDaily : dailyData[dateKey];
    if (!source) continue;

    const day = cloneDailyData(source);
    recalculateDailyTotals(day);
    const totals = calculateWebsiteTotals(day);
    const total = totals.signalMs + totals.noiseMs;

    if (total > 0) {
      stats.daysWithData += 1;
      stats.signalMs += totals.signalMs;
      stats.noiseMs += totals.noiseMs;
      stats.totalMs += total;
    }
  }

  stats.ratio = stats.totalMs > 0 ? Math.round((stats.signalMs / stats.totalMs) * 100) : 0;
  return stats;
}

function getIncludedWeeklyAverageDays(settings = {}) {
  const days = Array.isArray(settings.weeklyAverageDays) ? settings.weeklyAverageDays : [];
  const normalized = [...new Set(days
    .map((day) => Number.parseInt(day, 10))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b);

  return normalized.length > 0 ? normalized : [0, 1, 2, 3, 4, 5, 6];
}

function getRecentDateKeys(endDateKey, days) {
  const date = parseDateKey(endDateKey);
  const keys = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const item = new Date(date);
    item.setDate(item.getDate() - offset);
    keys.push(formatLocalDateKey(item));
  }

  return keys;
}

function parseDateKey(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function parseDateKeyOrNull(dateKey) {
  const [year, month, day] = String(dateKey || '').split('-').map((value) => Number.parseInt(value, 10));
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function cloneDailyData(daily = {}) {
  return {
    ...daily,
    activities: Object.fromEntries(
      Object.entries(daily.activities || {}).map(([domain, activity]) => [domain, { ...activity }])
    )
  };
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

  const settings = await getSettings();
  const todayKey = getTodayKey(settings.dayStartHour);
  const [siteRules, todayRules] = await Promise.all([
    getSiteRules(),
    getTodaySiteRules(todayKey)
  ]);
  return { domain, classification: classifyEffectiveDomain(domain, siteRules, todayRules) };
}

async function handleVisibilityChange(payload = {}, sender = {}) {
  const tabId = sender.tab?.id;
  const domain = extractDomain(sender.tab?.url || '');
  if (!tabId || !domain || domain === 'unknown') return { tracked: false };

  if (payload.visible) {
    const tab = await chrome.tabs.get(tabId);
    if (!(await isTrackableTab(tab))) return { tracked: false };
    await finishOffWebSession();
    await startSessionForTab(tab);
    await updateActionBadge();
    return { tracked: true, domain };
  }

  const current = await getCurrentSession();
  if (current?.tabId === tabId) {
    await clearCurrentSession();
    await stopHeartbeat();
    await endSession(current);
    await updateActionBadge();
  }

  return { tracked: false, domain };
}

async function handleActivityPing(payload = {}, sender = {}) {
  const tab = sender.tab;
  const domain = extractDomain(tab?.url || '');
  if (!tab?.id || !domain || domain === 'unknown') return { tracked: false };

  await enforceCurrentSessionActivity();
  await recordTabActivity(tab, payload.source || 'input');

  if (!(await isTrackableTab(tab))) {
    return { tracked: false, domain };
  }

  await startSessionForTab(tab);
  await updateActionBadge();
  return { tracked: true, domain };
}

async function startSessionForTab(tab, options = {}) {
  const run = () => startSessionForTabInternal(tab, options);
  const task = startSessionQueue.then(run, run);
  startSessionQueue = task.catch(() => {});
  return task;
}

async function startSessionForTabInternal(tab, { markActivity = false, markActivitySource = 'activation' } = {}) {
  const settings = await getSettings();
  if (settings.trackingPaused) {
    await clearCurrentSession();
    await stopHeartbeat();
    return;
  }

  await enforceCurrentSessionActivity(settings);

  if (markActivity) {
    await recordTabActivity(tab, markActivitySource);
  }

  if (!(await isTrackableTab(tab))) {
    await logTrackingEvent('session_not_trackable', { tabId: tab?.id, source: markActivitySource });
    const current = await getCurrentSession();
    if (current) {
      await clearCurrentSession();
      await stopHeartbeat();
      await endSession(current);
    }
    return;
  }

  const domain = extractDomain(tab.url);
  if (!domain || domain === 'unknown') return;

  const current = await getCurrentSession();
  if (current?.tabId === tab.id && current.domain === domain) return;

  if (current) {
    await clearCurrentSession();
    await stopHeartbeat();
    await endSession(current);
  }

  const engagement = await getTabEngagementState(tab, settings);
  if (!engagement.engaged) {
    await logTrackingEvent('session_not_started', {
      tabId: tab.id,
      domain,
      reason: engagement.reason,
      source: markActivitySource,
      lastActivityAt: engagement.lastActivityAt || null,
      thresholdSeconds: engagement.thresholdSeconds
    });
    return;
  }

  await finishOffWebSession();

  const latestCurrent = await getCurrentSession();
  if (latestCurrent?.tabId === tab.id && latestCurrent.domain === domain) return;

  const nextSession = {
    tabId: tab.id,
    domain,
    startTime: Date.now(),
    classification: await classifyCurrent(domain),
    lastActivityAt: engagement.lastActivityAt || Date.now()
  };

  await setCurrentSession(nextSession);
  await logTrackingEvent('session_start', {
    tabId: nextSession.tabId,
    domain: nextSession.domain,
    classification: nextSession.classification,
    source: markActivitySource,
    lastActivityAt: nextSession.lastActivityAt,
    thresholdSeconds: engagement.thresholdSeconds
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

  await logTrackingEvent('session_stop', {
    tabId: current.tabId,
    domain: current.domain,
    reason: engagement.reason,
    endTime: engagement.endTime || null,
    lastActivityAt: engagement.lastActivityAt || null,
    thresholdSeconds: engagement.thresholdSeconds
  });
  await clearCurrentSession();
  await stopHeartbeat();
  await endSession(current, { endTime: engagement.endTime, endTimeIsBounded: true });

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
  const thresholdSeconds = getInactivityThresholdSeconds(settings);
  const thresholdMs = thresholdSeconds * 1000;
  const idleState = idleStateOverride || await queryIdleState(thresholdSeconds);
  const activity = await getStoredTabActivity(session.tabId, session.domain);
  const lastActivityAt = activity?.lastActivityAt || session.lastActivityAt || null;
  const now = Date.now();

  if (idleState !== 'active') {
    if (lastActivityAt && now - lastActivityAt <= thresholdMs) {
      return {
        engaged: true,
        reason: 'recent_activity_while_idle',
        idleState,
        lastActivityAt,
        thresholdSeconds
      };
    }

    const idleLastActivityAt = settings.requireActivityToTrack ? lastActivityAt : null;
    return {
      engaged: false,
      reason: idleState,
      idleState,
      lastActivityAt,
      thresholdSeconds,
      endTime: getIdleEndTime(session, idleLastActivityAt, thresholdMs, now, idleState)
    };
  }

  if (!settings.requireActivityToTrack) {
    return { engaged: true, reason: 'activity_gate_off', idleState, thresholdSeconds };
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
  const domain = extractDomain(tab?.url || '');
  const thresholdSeconds = getInactivityThresholdSeconds(settings);
  const thresholdMs = thresholdSeconds * 1000;
  const idleState = await queryIdleState(thresholdSeconds);
  const activity = await getStoredTabActivity(tab.id, domain);
  const lastActivityAt = activity?.lastActivityAt || null;
  const now = Date.now();

  if (idleState !== 'active') {
    if (lastActivityAt && now - lastActivityAt <= thresholdMs) {
      return { engaged: true, reason: 'recent_activity_while_idle', idleState, lastActivityAt, thresholdSeconds };
    }

    return { engaged: false, reason: idleState, idleState, lastActivityAt, thresholdSeconds };
  }

  if (!settings.requireActivityToTrack) {
    return { engaged: true, reason: 'activity_gate_off', idleState, thresholdSeconds };
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

function getIdleEndTime(session, lastActivityAt, thresholdMs, now, idleState) {
  if (idleState === 'locked') {
    return Math.max(session.startTime, now);
  }

  if (lastActivityAt) {
    return getInactivityEndTime(session, lastActivityAt, thresholdMs, now);
  }

  return Math.max(session.startTime, now - thresholdMs);
}

async function recordTabActivity(tab, source = 'input') {
  const domain = extractDomain(tab?.url || '');
  if (!tab?.id || !domain || domain === 'unknown') return null;

  const tabActivity = (await chrome.storage.session.get(['tabActivity'])).tabActivity || {};
  const key = String(tab.id);
  const previous = tabActivity[key]?.domain === domain ? tabActivity[key] : {};
  const now = Date.now();
  const activity = {
    ...previous,
    domain,
    source,
    lastSeenAt: now
  };

  if (isEngagementActivitySource(source)) {
    activity.lastActivityAt = now;
  }

  tabActivity[key] = activity;
  await chrome.storage.session.set({ tabActivity });
  await logTrackingEvent('activity', {
    tabId: tab.id,
    domain,
    source,
    isEngagement: isEngagementActivitySource(source),
    lastActivityAt: activity.lastActivityAt || null
  });
  return activity;
}

function isEngagementActivitySource(source) {
  return ENGAGEMENT_ACTIVITY_SOURCES.has(source);
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
  const settings = await getSettings();
  const todayKey = getTodayKey(settings.dayStartHour);
  const [siteRules, todayRules] = await Promise.all([
    getSiteRules(),
    getTodaySiteRules(todayKey)
  ]);
  return classifyEffectiveDomain(domain, siteRules, todayRules);
}

function classifyEffectiveDomain(domain, siteRules = {}, todayRules = {}) {
  return classifyDomainWithRulePriority(domain, [todayRules, siteRules]);
}

async function endSession(session, { endTime = Date.now(), endTimeIsBounded = false } = {}) {
  if (!session?.startTime) return;

  const settings = await getSettings();
  const boundedEndTime = endTimeIsBounded
    ? Math.max(session.startTime, endTime)
    : await getSessionEndTime(session, { settings, endTime });
  const duration = Math.max(0, boundedEndTime - session.startTime);
  if (duration < 1000) {
    await logTrackingEvent('session_ignored_short', {
      tabId: session.tabId || null,
      domain: session.domain || OFF_WEB_KEY,
      durationMs: duration
    });
    return;
  }

  await logTrackingEvent('session_end', {
    tabId: session.tabId || null,
    domain: session.domain || OFF_WEB_KEY,
    classification: session.classification || 'signal',
    durationMs: duration,
    boundedEndTime
  });
  await addDurationAcrossDateKeys(
    session.domain || OFF_WEB_KEY,
    session.classification || 'signal',
    session.startTime,
    boundedEndTime,
    settings
  );
}

async function getSessionDurationMs(session, { settings = null, endTime = Date.now() } = {}) {
  if (!session?.startTime) return 0;

  const boundedEndTime = await getSessionEndTime(session, { settings, endTime });
  return Math.max(0, boundedEndTime - session.startTime);
}

async function getSessionEndTime(session, { settings = null, endTime = Date.now() } = {}) {
  if (!session?.startTime) return endTime;

  const resolvedSettings = settings || await getSettings();
  const thresholdSeconds = getInactivityThresholdSeconds(resolvedSettings);
  const thresholdMs = thresholdSeconds * 1000;
  const activity = await getStoredTabActivity(session.tabId, session.domain);
  const lastActivityAt = activity?.lastActivityAt || session.lastActivityAt || null;
  const idleState = await queryIdleState(thresholdSeconds);

  if (idleState !== 'active') {
    const idleLastActivityAt = resolvedSettings.requireActivityToTrack ? lastActivityAt : null;
    return getIdleEndTime(session, idleLastActivityAt, thresholdMs, endTime, idleState);
  }

  if (!resolvedSettings.requireActivityToTrack) {
    return Math.max(session.startTime, endTime);
  }

  if (!lastActivityAt) return session.startTime;

  return Math.max(session.startTime, Math.min(endTime, lastActivityAt + thresholdMs));
}

async function addDurationAcrossDateKeys(domain, classification, startTime, endTime, settings = null) {
  const resolvedSettings = settings || await getSettings();
  const segments = getDateSegments(startTime, endTime, resolvedSettings.dayStartHour);

  for (const segment of segments) {
    const durationMs = segment.endTime - segment.startTime;
    if (durationMs >= 1000) {
      await addDurationToDate(segment.dateKey, domain, classification, durationMs);
    }
  }
}

async function addDurationToDate(dateKey, domain, classification, durationMs) {
  const daily = await getDailyData(dateKey);
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

  await logTrackingEvent('duration_added', {
    dateKey,
    domain: key,
    classification,
    durationMs,
    totalSignalMs: daily.totalSignalMs || 0,
    totalNoiseMs: daily.totalNoiseMs || 0
  });
  await updateDailyDataAndMaybeShowGoalEffect(dateKey, daily);
}

function getDateSegments(startTime, endTime, dayStartHour = 0) {
  const segments = [];
  let cursor = Math.max(0, Number(startTime) || 0);
  const finalTime = Math.max(cursor, Number(endTime) || cursor);

  while (cursor < finalTime) {
    const nextBoundary = getNextDayStartMs(cursor, dayStartHour);
    const segmentEnd = Math.min(finalTime, nextBoundary);
    segments.push({
      dateKey: getTodayKey(dayStartHour, new Date(cursor)),
      startTime: cursor,
      endTime: segmentEnd
    });
    cursor = segmentEnd;
  }

  return segments;
}

function getNextDayStartMs(timestamp, dayStartHour = 0) {
  const date = new Date(timestamp);
  const dayStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    dayStartHour || 0,
    0,
    0,
    0
  );

  if (date >= dayStart) {
    dayStart.setDate(dayStart.getDate() + 1);
  }

  return dayStart.getTime();
}

async function startOffWebSession(settings = null) {
  const resolvedSettings = settings || await getSettings();
  if (resolvedSettings.trackingPaused) {
    await chrome.storage.session.remove('offWebStart');
    return;
  }

  const result = await chrome.storage.session.get(['offWebStart']);
  if (result.offWebStart) return;

  await chrome.storage.session.set({ offWebStart: Date.now() });
}

async function finishOffWebSession({ restart = false, endTime = Date.now(), settings = null } = {}) {
  const resolvedSettings = settings || await getSettings();
  const result = await chrome.storage.session.get(['offWebStart']);
  const offWebStart = result.offWebStart;
  if (!offWebStart) return;

  if (resolvedSettings.trackingPaused) {
    await chrome.storage.session.remove('offWebStart');
    return;
  }

  const boundedEndTime = Math.max(offWebStart, endTime);
  const duration = boundedEndTime - offWebStart;
  await chrome.storage.session.remove('offWebStart');

  if (duration >= OFF_WEB_MIN_MS) {
    await addDurationAcrossDateKeys(OFF_WEB_KEY, 'signal', offWebStart, boundedEndTime, resolvedSettings);
  }

  if (restart) {
    await startOffWebSession(resolvedSettings);
  }
}

async function resetToday() {
  const settings = await getSettings();
  const todayKey = getTodayKey(settings.dayStartHour);
  const result = await chrome.storage.local.get(['dailyData']);
  const dailyData = result.dailyData || {};
  delete dailyData[todayKey];

  await clearCurrentSession();
  await stopHeartbeat();
  await chrome.storage.session.remove(['tabActivity', 'offWebStart']);
  await chrome.storage.local.set({ dailyData });
  await clearTodaySiteRules(todayKey);
  await clearGoalEffectStateForDate(todayKey);
  await logTrackingEvent('reset_today', { dateKey: todayKey });
  await updateActionBadge();
}

async function clearTrackingHistory() {
  await clearCurrentSession();
  await stopHeartbeat();
  await chrome.storage.session.remove(['tabActivity', 'offWebStart']);
  await chrome.storage.local.remove(['dailyData', 'goalEffectState']);
  await logTrackingEvent('clear_tracking_history', {});
  await updateActionBadge();
}

async function clearAllData() {
  await clearCurrentSession();
  await stopHeartbeat();
  await chrome.storage.session.clear();
  await chrome.storage.local.clear();
  await scheduleMidnightAlarm();
  await configureIdleDetection();
  await startBadgeUpdater();
}

async function toggleTracking(paused = null) {
  const settings = await getSettings();
  const nextPaused = paused === null ? !settings.trackingPaused : !!paused;
  const updatedSettings = { ...settings, trackingPaused: nextPaused };
  await chrome.storage.local.set({ settings: updatedSettings });

  if (nextPaused) {
    const current = await getCurrentSession();
    if (current) {
      await clearCurrentSession();
      await endSession(current);
    }
    await chrome.storage.session.remove('offWebStart');
    await stopHeartbeat();
  } else {
    await finishOffWebSession({ settings: updatedSettings });
    const tab = await getFocusedActiveTab();
    if (tab) await startSessionForTab(tab, { markActivity: true });
  }

  await updateActionBadge();
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

async function startBadgeUpdater(settings = null) {
  const resolvedSettings = settings || await getSettings();
  await chrome.alarms.clear(BADGE_ALARM);

  if (resolvedSettings.showRatioBadge === false) {
    await clearActionBadge();
    return;
  }

  await chrome.alarms.create(BADGE_ALARM, { periodInMinutes: 1 });
  await updateActionBadge(resolvedSettings);
}

async function clearActionBadge() {
  if (!chrome.action?.setBadgeText) return;
  await chrome.action.setBadgeText({ text: '' });
}

async function updateActionBadge(settings = null, { enforceActivity = true } = {}) {
  if (!chrome.action?.setBadgeText) return;

  const resolvedSettings = settings || await getSettings();
  if (resolvedSettings.showRatioBadge === false) {
    await clearActionBadge();
    return;
  }

  if (enforceActivity) {
    await enforceCurrentSessionActivity(resolvedSettings);
  }

  const current = await getCurrentSession();
  const currentSite = await getActiveTabSite(current);
  if (!currentSite?.domain) {
    await clearActionBadge();
    return;
  }

  const todayKey = getTodayKey(resolvedSettings.dayStartHour);
  const daily = await getDailyData(todayKey);
  const liveDaily = await addLiveSessionToDailyData(daily, current, resolvedSettings);
  const totals = calculateWebsiteTotals(liveDaily);
  const total = totals.signalMs + totals.noiseMs;
  const ratio = total > 0 ? Math.round((totals.signalMs / total) * 100) : 0;
  const classification = currentSite.classification === 'noise' ? 'noise' : 'signal';

  await chrome.action.setBadgeBackgroundColor({
    color: classification === 'noise' ? NOISE_BADGE_COLOR : SIGNAL_BADGE_COLOR
  });
  await chrome.action.setBadgeText({ text: `${ratio}%` });

  if (chrome.action.setBadgeTextColor) {
    try {
      await chrome.action.setBadgeTextColor({ color: '#ffffff' });
    } catch (e) {}
  }

  if (chrome.action.setTitle) {
    await chrome.action.setTitle({
      title: `Signal to Noise Ratio - ${ratio}% Today's Website Signal Ratio`
    });
  }
}

async function handleMidnightReset() {
  const current = await getCurrentSession();
  if (current) {
    await clearCurrentSession();
    await endSession(current);
  }

  await finishOffWebSession({ restart: true });
  await pruneOldDailyData();
  await pruneTodaySiteRules();

  const tab = await getFocusedActiveTab();
  if (tab) await startSessionForTab(tab);
  await updateActionBadge();
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
      const latest = await getCurrentSession();
      if (
        latest?.tabId === current.tabId &&
        latest?.domain === current.domain &&
        latest?.startTime === current.startTime
      ) {
        await setCurrentSession({ ...latest, lastHeartbeat: Date.now() });
      }
    } else {
      await chrome.alarms.clear(HEARTBEAT_ALARM);
    }
  } else if (alarm.name === MIDNIGHT_ALARM) {
    await handleMidnightReset();
  } else if (alarm.name === BADGE_ALARM) {
    await updateActionBadge();
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    await startSessionForTab(tab, { markActivity: true });
    await updateActionBadge();
  } catch (e) {
    await updateActionBadge().catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const current = await getCurrentSession();
  if (current?.tabId === tabId) {
    await clearCurrentSession();
    await stopHeartbeat();
    await endSession(current);
    await updateActionBadge();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.active || !(changeInfo.url || changeInfo.status === 'complete')) return;
  try {
    await startSessionForTab(tab, { markActivity: !!changeInfo.url, markActivitySource: 'navigation' });
    await updateActionBadge();
  } catch (e) {
    await updateActionBadge().catch(() => {});
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  const settings = await getSettings();
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    const current = await getCurrentSession();
    if (current) {
      await clearCurrentSession();
      await stopHeartbeat();
      await endSession(current);
    }
    await startOffWebSession(settings);
    await updateActionBadge();
    return;
  }

  if (settings.trackingPaused) {
    await chrome.storage.session.remove('offWebStart');
    await updateActionBadge(settings);
    return;
  }

  await finishOffWebSession({ settings });

  try {
    const tab = await getFocusedActiveTab(windowId);
    if (tab) await startSessionForTab(tab, { markActivity: true });
    await updateActionBadge();
  } catch (e) {
    await updateActionBadge().catch(() => {});
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.settings) {
    const settingsTask = changes.settings.newValue ? Promise.resolve(changes.settings.newValue) : getSettings();
    settingsTask.then((settings) => {
      scheduleMidnightAlarm(settings.dayStartHour).catch(() => {});
      configureIdleDetection(settings).catch(() => {});
      startBadgeUpdater(settings).catch(() => {});
    }).catch(() => {});
  } else if (areaName === 'local' && (changes.dailyData || changes.siteRules || changes.todaySiteRules)) {
    updateActionBadge(null, { enforceActivity: false }).catch(() => {});
  }
});

if (chrome.idle?.onStateChanged) {
  chrome.idle.onStateChanged.addListener(async (idleState) => {
    const settings = await getSettings();
    if (idleState === 'active') {
      try {
        const tab = await getFocusedActiveTab();
        if (tab) {
          await startSessionForTab(tab, { markActivity: true });
        } else {
          await startOffWebSession(settings);
        }
        await updateActionBadge();
      } catch (e) {
        await updateActionBadge().catch(() => {});
      }
      return;
    }

    await enforceCurrentSessionActivity(settings, { idleStateOverride: idleState });
    await finishOffWebSession({
      endTime: idleState === 'locked'
        ? Date.now()
        : Date.now() - (getInactivityThresholdSeconds(settings) * 1000),
      settings
    });
    await updateActionBadge();
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
    await updateActionBadge();
  } catch (e) {
    await updateActionBadge().catch(() => {});
  }

  await startBadgeUpdater();
});

chrome.runtime.onInstalled.addListener(async () => {
  await scheduleMidnightAlarm();
  await configureIdleDetection();
  await startBadgeUpdater();
});

console.log('Signal to Noise Ratio background service worker ready');
