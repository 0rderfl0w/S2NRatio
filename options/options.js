// options/options.js

import { normalizeDomain } from '../utils/classification.js';
import { getTodayKey } from '../utils/time.js';

const DEFAULT_STATUS_BAR_NAME = 'Signal Status';
const DEFAULT_STATUS_TIERS = [
  { goal: 100, label: 'Musk' },
  { goal: 90, label: 'Jobs' },
  { goal: 80, label: '80/20' }
];
const STATUS_LABEL_ALIASES = {
  'Elon Musk': 'Musk',
  'Steve Jobs': 'Jobs'
};

const DEFAULT_SETTINGS = {
  dayStartHour: 0,
  showPopup: true,
  promptMode: 'always',
  autoClassify: true,
  targetSignalRatio: 70,
  trackingPaused: false,
  requireActivityToTrack: true,
  inactivityThresholdSeconds: 120,
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
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
}

async function loadSettings() {
  const settings = await getSettings();
  document.getElementById('dayStartHour').value = settings.dayStartHour || 0;
  document.getElementById('targetSignalRatio').value = settings.targetSignalRatio || 70;
  document.getElementById('showPopup').checked = settings.showPopup !== false;
  document.getElementById('promptMode').value = settings.promptMode || 'always';
  document.getElementById('requireActivityToTrack').checked = settings.requireActivityToTrack !== false;
  document.getElementById('inactivityThresholdSeconds').value = settings.inactivityThresholdSeconds || 120;
  document.getElementById('goalCelebrationEnabled').checked = settings.goalCelebrationEnabled !== false;
  document.getElementById('goalDropAlertEnabled').checked = settings.goalDropAlertEnabled !== false;
  document.getElementById('statusBarName').value = getStatusBarName(settings);

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
      promptMode: document.getElementById('promptMode').value === 'noise' ? 'noise' : 'always',
      requireActivityToTrack: document.getElementById('requireActivityToTrack').checked,
      inactivityThresholdSeconds,
      goalCelebrationEnabled: document.getElementById('goalCelebrationEnabled').checked,
      goalDropAlertEnabled: document.getElementById('goalDropAlertEnabled').checked,
      statusBarName: getTextValue('statusBarName', DEFAULT_STATUS_BAR_NAME, 32),
      statusTiers: readStatusTiers()
    }
  });

  setStatus('Settings saved.');
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
    const settings = await getSettings();
    const todayKey = getTodayKey(settings.dayStartHour);
    const result = await chrome.storage.local.get(['dailyData']);
    const dailyData = result.dailyData || {};
    delete dailyData[todayKey];
    await chrome.storage.local.set({ dailyData });
    alert("Today's data cleared.");
  }
}

async function clearAll() {
  if (confirm('Delete ALL S2NRatio data? This cannot be undone.')) {
    await chrome.storage.local.clear();
    await chrome.storage.session.clear();
    alert('All data cleared.');
    location.reload();
  }
}

async function exportCsv() {
  const result = await chrome.storage.local.get(['dailyData']);
  const dailyData = result.dailyData || {};
  const rows = [['date', 'domain', 'classification', 'duration_minutes', 'signal_minutes', 'noise_minutes', 'signal_ratio']];

  for (const [date, day] of Object.entries(dailyData).sort()) {
    const signalMinutes = Math.round((day.totalSignalMs || 0) / 60000);
    const noiseMinutes = Math.round((day.totalNoiseMs || 0) / 60000);
    const total = (day.totalSignalMs || 0) + (day.totalNoiseMs || 0);
    const ratio = total > 0 ? Math.round(((day.totalSignalMs || 0) / total) * 100) : 0;

    for (const [domain, item] of Object.entries(day.activities || {})) {
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

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

document.getElementById('save-settings').onclick = saveSettings;
document.getElementById('save-goal-effects-settings').onclick = saveSettings;
document.getElementById('save-status-settings').onclick = saveSettings;
document.getElementById('add-rule').onclick = addRule;
document.getElementById('reset-today').onclick = resetToday;
document.getElementById('clear-all').onclick = clearAll;
document.getElementById('export-csv').onclick = exportCsv;

loadSettings();
loadRules();
