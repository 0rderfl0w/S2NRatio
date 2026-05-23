// utils/classification.js
// Rule-based classification engine for S2NRatio v0.1

const SIGNAL_DOMAINS = new Set([
  'gmail.com', 'outlook.com', 'mail.google.com',
  'zoom.us', 'notion.so', 'linear.app',
  'calendar.google.com', 'docs.google.com',
  'github.com', 'slack.com', 'meet.google.com'
]);

const NOISE_DOMAINS = new Set([
  'youtube.com', 'x.com', 'twitter.com',
  'facebook.com', 'instagram.com', 'reddit.com',
  'tiktok.com', 'netflix.com', 'twitch.tv'
]);

export function extractDomain(url) {
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch (e) {
    return 'unknown';
  }
}

export function normalizeDomain(domain) {
  if (typeof domain !== 'string') return '';

  let normalized = domain.trim().toLowerCase();

  try {
    if (normalized.includes('://')) {
      normalized = new URL(normalized).hostname.toLowerCase();
    }
  } catch (e) {
    return '';
  }

  normalized = normalized.replace(/\.$/, '');
  if (normalized.startsWith('www.')) normalized = normalized.slice(4);

  return validateDomain(normalized) ? normalized : '';
}

function getMatchingRule(domain, rules) {
  if (!domain || !rules) return null;
  if (rules[domain]) return rules[domain];

  const parts = domain.split('.');
  for (let i = 1; i < parts.length - 1; i += 1) {
    const parent = parts.slice(i).join('.');
    if (rules[parent]) return rules[parent];
  }

  return null;
}

export function classifyDomain(domain, siteRules = {}) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return 'signal';
  }

  const savedRule = getMatchingRule(normalized, siteRules);
  if (savedRule === 'signal' || savedRule === 'noise') {
    return savedRule;
  }

  return classifyDefaultDomain(normalized);
}

export function classifyDomainWithRulePriority(domain, ruleSets = []) {
  const normalized = normalizeDomain(domain);
  if (!normalized) {
    return 'signal';
  }

  for (const rules of ruleSets) {
    const savedRule = getMatchingRule(normalized, rules);
    if (savedRule === 'signal' || savedRule === 'noise') {
      return savedRule;
    }
  }

  return classifyDefaultDomain(normalized);
}

function classifyDefaultDomain(normalized) {
  for (const d of SIGNAL_DOMAINS) {
    if (normalized === d || normalized.endsWith('.' + d)) {
      return 'signal';
    }
  }

  for (const d of NOISE_DOMAINS) {
    if (normalized === d || normalized.endsWith('.' + d)) {
      return 'noise';
    }
  }

  return 'signal';
}

export function validateDomain(domain) {
  if (typeof domain !== 'string' || domain.length > 253) return false;
  const labels = domain.split('.');
  if (labels.length < 2) return false;

  return labels.every((label) => (
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ));
}
