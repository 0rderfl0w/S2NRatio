// utils/storage.js
// Storage helpers for S2NRatio

import { getTodayKey } from './time.js';
import { normalizeDomain } from './classification.js';

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
  weeklyAverageDays: [0, 1, 2, 3, 4, 5, 6],
  weeklyAverageStartDate: null,
  goalCelebrationEnabled: true,
  goalDropAlertEnabled: true,
  statusBarName: 'Signal Status',
  statusTiers: [
    { goal: 100, label: 'Musk' },
    { goal: 80, label: 'Jobs' },
    { goal: 70, label: 'Goal' }
  ],
  schemaVersion: 1
};

const STATUS_LABEL_ALIASES = {
  'Elon Musk': 'Musk',
  'Steve Jobs': 'Jobs',
  '80/20': 'Goal'
};

export async function getSettings() {
  const result = await chrome.storage.local.get(['settings']);
  return normalizeSettings({ ...DEFAULT_SETTINGS, ...(result.settings || {}) });
}

function normalizeSettings(settings) {
  const rawTiers = Array.isArray(settings.statusTiers) ? settings.statusTiers : [];
  if (isLegacyDefaultStatusTiers(rawTiers)) {
    return { ...settings, statusTiers: DEFAULT_SETTINGS.statusTiers };
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

function clampNumber(value, min, max, fallback = min) {
  const resolved = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(resolved)));
}

export async function getDailyData(dateKey = null) {
  const settings = await getSettings();
  const key = dateKey || getTodayKey(settings.dayStartHour);
  const result = await chrome.storage.local.get(['dailyData']);
  return result.dailyData?.[key] || { activities: {}, totalSignalMs: 0, totalNoiseMs: 0 };
}

export async function updateDailyData(dateKey, updates) {
  const result = await chrome.storage.local.get(['dailyData']);
  const dailyData = result.dailyData || {};
  dailyData[dateKey] = { ...(dailyData[dateKey] || { activities: {}, totalSignalMs: 0, totalNoiseMs: 0 }), ...updates };
  await chrome.storage.local.set({ dailyData });
}

export async function getSiteRules() {
  const result = await chrome.storage.local.get(['siteRules']);
  return result.siteRules || {};
}

export async function getTodaySiteRules(dateKey = null) {
  const settings = await getSettings();
  const key = dateKey || getTodayKey(settings.dayStartHour);
  const result = await chrome.storage.local.get(['todaySiteRules']);
  return result.todaySiteRules?.[key] || {};
}

export async function saveSiteRule(domain, classification) {
  const normalized = normalizeDomain(domain);
  if (!normalized || !['signal', 'noise'].includes(classification)) return false;

  const rules = await getSiteRules();
  rules[normalized] = classification;
  await chrome.storage.local.set({ siteRules: rules });
  return true;
}

export async function saveTodaySiteRule(domain, classification, dateKey = null) {
  const normalized = normalizeDomain(domain);
  if (!normalized || !['signal', 'noise'].includes(classification)) return false;

  const settings = await getSettings();
  const key = dateKey || getTodayKey(settings.dayStartHour);
  const result = await chrome.storage.local.get(['todaySiteRules']);
  const todaySiteRules = result.todaySiteRules || {};
  todaySiteRules[key] = todaySiteRules[key] || {};
  todaySiteRules[key][normalized] = classification;
  await chrome.storage.local.set({ todaySiteRules });
  return true;
}

export async function removeSiteRule(domain) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;

  const rules = await getSiteRules();
  delete rules[normalized];
  await chrome.storage.local.set({ siteRules: rules });
  return true;
}

export async function removeTodaySiteRule(domain, dateKey = null) {
  const normalized = normalizeDomain(domain);
  if (!normalized) return false;

  const settings = await getSettings();
  const key = dateKey || getTodayKey(settings.dayStartHour);
  const result = await chrome.storage.local.get(['todaySiteRules']);
  const todaySiteRules = result.todaySiteRules || {};

  if (!todaySiteRules[key]) return true;

  delete todaySiteRules[key][normalized];
  if (Object.keys(todaySiteRules[key]).length === 0) {
    delete todaySiteRules[key];
  }

  await chrome.storage.local.set({ todaySiteRules });
  return true;
}

export async function clearTodaySiteRules(dateKey = null) {
  const settings = await getSettings();
  const key = dateKey || getTodayKey(settings.dayStartHour);
  const result = await chrome.storage.local.get(['todaySiteRules']);
  const todaySiteRules = result.todaySiteRules || {};
  delete todaySiteRules[key];
  await chrome.storage.local.set({ todaySiteRules });
}

export async function getCurrentSession() {
  const result = await chrome.storage.session.get(['currentSession']);
  return result.currentSession || null;
}

export async function setCurrentSession(session) {
  await chrome.storage.session.set({ currentSession: session });
}

export async function clearCurrentSession() {
  await chrome.storage.session.remove('currentSession');
}
