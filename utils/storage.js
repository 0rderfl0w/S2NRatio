// utils/storage.js
// Storage helpers for S2NRatio

import { getTodayKey } from './time.js';
import { normalizeDomain } from './classification.js';

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
  statusBarName: 'Signal Status',
  statusTiers: [
    { goal: 100, label: 'Musk' },
    { goal: 90, label: 'Jobs' },
    { goal: 80, label: '80/20' }
  ],
  schemaVersion: 1
};

export async function getSettings() {
  const result = await chrome.storage.local.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...(result.settings || {}) };
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
