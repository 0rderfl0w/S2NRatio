// options/options.js

import { normalizeDomain } from '../utils/classification.js';
import { getTodayKey } from '../utils/time.js';

const DEFAULT_STATUS_BAR_NAME = 'Signal Status';
const DEFAULT_STATUS_TIERS = [
  { goal: 100, label: 'Musk' },
  { goal: 80, label: 'Jobs' },
  { goal: 70, label: 'Goal' }
];
const STATUS_LABEL_ALIASES = {
  'Elon Musk': 'Musk',
  'Steve Jobs': 'Jobs',
  '80/20': 'Goal'
};
const DEFAULT_WEEKLY_AVERAGE_DAYS = [0, 1, 2, 3, 4, 5, 6];

const DEFAULT_SETTINGS = {
  dayStartHour: 0,
  showPopup: true,
  showRatioBadge: true,
  promptMode: 'always',
  autoClassify: true,
  targetSignalRatio: 70,
  trackingPaused: false,
  requireActivityToTrack: true,
  inactivityThresholdSeconds: 120,
  weeklyAverageDays: DEFAULT_WEEKLY_AVERAGE_DAYS,
  weeklyAverageStartDate: null,
  goalCelebrationEnabled: true,
  goalDropAlertEnabled: true,
  statusBarName: DEFAULT_STATUS_BAR_NAME,
  statusTiers: DEFAULT_STATUS_TIERS,
  schemaVersion: 1
};

function setStatus(message) {
  const status = document.getElementById('settings-status');
  status.textContent = message;
  if (message) setTimeout(() => { status.textContent = ''; }, 1800);
}

async function getSettings() {
  const result = await chrome.storage.local.get(['settings']);
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
}

async function loadSettings() {
  const settings = await getSettings();
  document.getElementById('dayStartHour').value = settings.dayStartHour || 0;
  document.getElementById('targetSignalRatio').value = settings.targetSignalRatio || 70;
  document.getElementById('showPopup').checked = settings.showPopup !== false;
  document.getElementById('showRatioBadge').checked = settings.showRatioBadge !== false;
  document.getElementById('promptMode').value = settings.promptMode || 'always';
  document.getElementById('requireActivityToTrack').checked = settings.requireActivityToTrack !== false;
  document.getElementById('inactivityThresholdSeconds').value = settings.inactivityThresholdSeconds || 120;
  document.getElementById('goalCelebrationEnabled').checked = settings.goalCelebrationEnabled !== false;
  document.getElementById('goalDropAlertEnabled').checked = settings.goalDropAlertEnabled !== false;
  document.getElementById('statusBarName').value = getStatusBarName(settings);
  setWeeklyAverageDays(settings.weeklyAverageDays);
  renderWeeklyAverageStart(settings.weeklyAverageStartDate);

  const tiers = getStatusTiers(settings);
  tiers.forEach((tier, index) => {
    document.getElementById(`statusTier${index + 1}Goal`).value = tier.goal;
    document.getElementById(`statusTier${index + 1}Label`).value = tier.label;
  });
}

async function saveSettings() {
  const existing = await getSettings();
  const dayStartHour = Number.parseInt(document.getElementById('dayStartHour').value, 10);
  const targetSignalRatio = Math.min(
    100,
    Math.max(0, Number.parseInt(document.getElementById('targetSignalRatio').value, 10) || 70)
  );
  const inactivityThresholdSeconds = Math.min(
    900,
    Math.max(30, Number.parseInt(document.getElementById('inactivityThresholdSeconds').value, 10) || 120)
  );

  await chrome.storage.local.set({
    settings: {
      ...existing,
      dayStartHour,
      targetSignalRatio,
      showPopup: document.getElementById('showPopup').checked,
      showRatioBadge: document.getElementById('showRatioBadge').checked,
      promptMode: document.getElementById('promptMode').value === 'noise' ? 'noise' : 'always',
      requireActivityToTrack: document.getElementById('requireActivityToTrack').checked,
      inactivityThresholdSeconds,
      weeklyAverageDays: readWeeklyAverageDays(),
      weeklyAverageStartDate: existing.weeklyAverageStartDate || null,
      goalCelebrationEnabled: document.getElementById('goalCelebrationEnabled').checked,
      goalDropAlertEnabled: document.getElementById('goalDropAlertEnabled').checked,
      statusBarName: getTextValue('statusBarName', DEFAULT_STATUS_BAR_NAME, 32),
      statusTiers: readStatusTiers()
    }
  });

  setWeeklyAverageDays(readWeeklyAverageDays());
  setStatus('Settings saved.');
}

function setWeeklyAverageDays(days) {
  const selected = normalizeWeeklyAverageDays(days);
  for (const day of DEFAULT_WEEKLY_AVERAGE_DAYS) {
    document.getElementById(`weeklyDay${day}`).checked = selected.includes(day);
  }
}

function readWeeklyAverageDays() {
  const days = DEFAULT_WEEKLY_AVERAGE_DAYS.filter((day) => document.getElementById(`weeklyDay${day}`).checked);
  return days.length > 0 ? days : DEFAULT_WEEKLY_AVERAGE_DAYS;
}

function normalizeWeeklyAverageDays(days) {
  const normalized = Array.isArray(days)
    ? [...new Set(days
      .map((day) => Number.parseInt(day, 10))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      .sort((a, b) => a - b)
    : [];

  return normalized.length > 0 ? normalized : DEFAULT_WEEKLY_AVERAGE_DAYS;
}

function renderWeeklyAverageStart(startDate) {
  const target = document.getElementById('weekly-average-start');
  target.textContent = startDate
    ? `Fresh average started ${startDate}. Stored history is still kept.`
    : 'Using all stored history inside the 7-day window.';
}

async function startWeeklyAverageFresh() {
  const settings = await getSettings();
  const todayKey = getTodayKey(settings.dayStartHour);
  await chrome.storage.local.set({
    settings: {
      ...settings,
      weeklyAverageDays: readWeeklyAverageDays(),
      weeklyAverageStartDate: todayKey
    }
  });

  renderWeeklyAverageStart(todayKey);
  setStatus('Weekly average now starts today.');
}

async function restoreWeeklyAverageHistory() {
  const settings = await getSettings();
  await chrome.storage.local.set({
    settings: {
      ...settings,
      weeklyAverageDays: readWeeklyAverageDays(),
      weeklyAverageStartDate: null
    }
  });

  renderWeeklyAverageStart(null);
  setStatus('Weekly average uses full 7-day history.');
}

function readStatusTiers() {
  return [0, 1, 2]
    .map((index) => ({
      goal: clampNumber(
        Number.parseInt(document.getElementById(`statusTier${index + 1}Goal`).value, 10),
        0,
        100,
        DEFAULT_STATUS_TIERS[index].goal
      ),
      label: getTextValue(`statusTier${index + 1}Label`, DEFAULT_STATUS_TIERS[index].label, 32)
    }))
    .sort((a, b) => b.goal - a.goal);
}

function getStatusBarName(settings = {}) {
  const value = String(settings.statusBarName || '').trim();
  return value || DEFAULT_STATUS_BAR_NAME;
}

function getStatusTiers(settings = {}) {
  const rawTiers = Array.isArray(settings.statusTiers) ? settings.statusTiers : [];
  const source = rawTiers.length > 0 ? rawTiers : DEFAULT_STATUS_TIERS;
  const tiers = source
    .slice(0, 3)
    .map((tier, index) => ({
      goal: clampNumber(Number(tier?.goal), 0, 100, DEFAULT_STATUS_TIERS[index]?.goal || 0),
      label: normalizeStatusLabel(tier?.label || DEFAULT_STATUS_TIERS[index]?.label || 'Goal')
    }))
    .filter((tier) => tier.label)
    .sort((a, b) => b.goal - a.goal);

  return tiers.length === 3 ? tiers : DEFAULT_STATUS_TIERS;
}

function normalizeSettings(settings) {
  const rawTiers = Array.isArray(settings.statusTiers) ? settings.statusTiers : [];
  if (isLegacyDefaultStatusTiers(rawTiers)) {
    return { ...settings, statusTiers: DEFAULT_STATUS_TIERS };
  }

  return settings;
}

function isLegacyDefaultStatusTiers(tiers) {
  if (tiers.length !== 3) return false;

  const normalized = tiers
    .map((tier) => ({
      goal: clampNumber(Number(tier?.goal), 0, 100, 0),
      label: normalizeStatusLabel(tier?.label)
    }))
    .sort((a, b) => b.goal - a.goal);

  return (
    normalized[0]?.goal === 100 &&
    normalized[0]?.label === 'Musk' &&
    normalized[1]?.goal === 90 &&
    normalized[1]?.label === 'Jobs' &&
    normalized[2]?.goal === 80 &&
    ['Goal', '80/20'].includes(normalized[2]?.label)
  );
}

function normalizeStatusLabel(label) {
  const value = String(label || '').trim();
  return (STATUS_LABEL_ALIASES[value] || value).slice(0, 32);
}

function getTextValue(id, fallback, maxLength) {
  const value = String(document.getElementById(id).value || '').trim();
  return (value || fallback).slice(0, maxLength);
}

function clampNumber(value, min, max, fallback = min) {
  const resolved = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(resolved)));
}

async function loadRules() {
  const result = await chrome.storage.local.get(['siteRules']);
  const rules = result.siteRules || {};
  const container = document.getElementById('rules-list');
  container.textContent = '';

  if (Object.keys(rules).length === 0) {
    const empty = document.createElement('p');
    empty.style.color = '#64748b';
    empty.textContent = 'No custom rules yet.';
    container.appendChild(empty);
    return;
  }

  for (const [domain, classification] of Object.entries(rules).sort()) {
    const row = document.createElement('div');
    row.className = 'rule';

    const label = document.createElement('span');
    const domainEl = document.createElement('strong');
    domainEl.textContent = domain;
    const classificationEl = document.createElement('span');
    classificationEl.style.color = classification === 'signal' ? '#10b981' : '#ef4444';
    classificationEl.textContent = classification;
    label.append(domainEl, ' -> ', classificationEl);

    const removeButton = document.createElement('button');
    removeButton.className = 'danger';
    removeButton.dataset.domain = domain;
    removeButton.textContent = 'Remove';
    removeButton.addEventListener('click', () => removeRule(domain));

    row.append(label, removeButton);
    container.appendChild(row);
  }
}

async function addRule() {
  const input = document.getElementById('new-domain');
  const domain = normalizeDomain(input.value);
  const classification = document.getElementById('new-classification').value;

  if (!domain || !['signal', 'noise'].includes(classification)) {
    alert('Enter a valid domain like example.com.');
    return;
  }

  const rules = (await chrome.storage.local.get(['siteRules'])).siteRules || {};
  rules[domain] = classification;
  await chrome.storage.local.set({ siteRules: rules });

  input.value = '';
  loadRules();
}

async function removeRule(domain) {
  const rules = (await chrome.storage.local.get(['siteRules'])).siteRules || {};
  delete rules[domain];
  await chrome.storage.local.set({ siteRules: rules });
  loadRules();
}

async function resetToday() {
  if (confirm("Reset today's tracking data?")) {
    await sendMessage('RESET_TODAY');
    await loadStorageSummary();
    alert("Today's data cleared.");
  }
}

async function clearTrackingHistory() {
  if (confirm('Clear all stored tracking history? Settings and site rules will stay.')) {
    await sendMessage('CLEAR_TRACKING_HISTORY');
    await loadStorageSummary();
    alert('Tracking history cleared.');
  }
}

async function clearAll() {
  if (confirm('Delete ALL Signal to Noise Ratio data? This cannot be undone.')) {
    await sendMessage('CLEAR_ALL_DATA');
    alert('All data cleared.');
    location.reload();
  }
}

async function loadStorageSummary() {
  const result = await chrome.storage.local.get(null);
  const dailyData = result.dailyData || {};
  const siteRules = result.siteRules || {};
  const todaySiteRules = result.todaySiteRules || {};
  const days = Object.keys(dailyData);
  const websiteRows = Object.values(dailyData).reduce(
    (total, day) => total + Object.keys(day.activities || {}).filter((domain) => domain !== '__off_the_web__').length,
    0
  );
  const todayRuleCount = Object.values(todaySiteRules).reduce(
    (total, rules) => total + Object.keys(rules || {}).length,
    0
  );
  const sizeBytes = new Blob([JSON.stringify(result)]).size;

  document.getElementById('stored-days').textContent = String(days.length);
  document.getElementById('stored-websites').textContent = String(websiteRows);
  document.getElementById('stored-rules').textContent = String(Object.keys(siteRules).length + todayRuleCount);
  document.getElementById('stored-size').textContent = formatBytes(sizeBytes);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb * 10) / 10} KB`;
  return `${Math.round((kb / 1024) * 10) / 10} MB`;
}

async function exportCsv() {
  const result = await chrome.storage.local.get(['dailyData']);
  const dailyData = result.dailyData || {};
  const liveResponse = await sendMessage('GET_DAILY_DATA');
  if (liveResponse?.success && liveResponse.data?.date) {
    const { date, activities = {}, totalSignalMs = 0, totalNoiseMs = 0 } = liveResponse.data;
    dailyData[date] = { activities, totalSignalMs, totalNoiseMs };
  }

  const rows = [['date', 'domain', 'classification', 'duration_minutes', 'signal_minutes', 'noise_minutes', 'signal_ratio']];

  for (const [date, day] of Object.entries(dailyData).sort()) {
    const totals = calculateWebsiteTotals(day.activities || {});
    const signalMinutes = Math.round(totals.signalMs / 60000);
    const noiseMinutes = Math.round(totals.noiseMs / 60000);
    const total = totals.signalMs + totals.noiseMs;
    const ratio = total > 0 ? Math.round((totals.signalMs / total) * 100) : 0;

    for (const [domain, item] of Object.entries(day.activities || {})) {
      if (domain === '__off_the_web__') continue;

      for (const segment of getExportSegments(item)) {
        rows.push([
          date,
          domain,
          segment.classification,
          Math.round(segment.durationMs / 60000),
          signalMinutes,
          noiseMinutes,
          ratio
        ]);
      }
    }
  }

  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `s2nratio-export-${getTodayKey()}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function getExportSegments(item) {
  if (Number.isFinite(item?.signalMs) || Number.isFinite(item?.noiseMs)) {
    return [
      { classification: 'signal', durationMs: item.signalMs || 0 },
      { classification: 'noise', durationMs: item.noiseMs || 0 }
    ].filter((segment) => segment.durationMs > 0);
  }

  return [{
    classification: item.classification,
    durationMs: item.durationMs || 0
  }];
}

function calculateWebsiteTotals(activities = {}) {
  const totals = { signalMs: 0, noiseMs: 0 };

  for (const [domain, activity] of Object.entries(activities)) {
    if (domain === '__off_the_web__') continue;

    if (Number.isFinite(activity?.signalMs) || Number.isFinite(activity?.noiseMs)) {
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

function sendMessage(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

document.getElementById('save-settings').onclick = saveSettings;
document.getElementById('save-weekly-settings').onclick = saveSettings;
document.getElementById('fresh-weekly-average').onclick = startWeeklyAverageFresh;
document.getElementById('restore-weekly-average').onclick = restoreWeeklyAverageHistory;
document.getElementById('save-goal-effects-settings').onclick = saveSettings;
document.getElementById('save-status-settings').onclick = saveSettings;
document.getElementById('add-rule').onclick = addRule;
document.getElementById('reset-today').onclick = resetToday;
document.getElementById('clear-history').onclick = clearTrackingHistory;
document.getElementById('clear-all').onclick = clearAll;
document.getElementById('export-csv').onclick = exportCsv;

loadSettings();
loadRules();
loadStorageSummary();
