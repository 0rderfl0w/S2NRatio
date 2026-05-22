// content.js
// S2NRatio Content Script

let overridePopup = null;
let lastPromptedDomain = null;
let lastActivityPingAt = 0;

const ACTIVITY_THROTTLE_MS = 15000;

function extractDomainFromLocation() {
  try {
    return new URL(window.location.href).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

function sendToBackground(type, payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { success: false });
    });
  });
}

function notifyVisibility() {
  sendToBackground('VISIBILITY_CHANGE', {
    visible: document.visibilityState === 'visible',
    domain: extractDomainFromLocation()
  });
}

function notifyActivity(source = 'input', { force = false } = {}) {
  if (document.visibilityState !== 'visible') return;

  const now = Date.now();
  if (!force && now - lastActivityPingAt < ACTIVITY_THROTTLE_MS) return;

  lastActivityPingAt = now;
  sendToBackground('ACTIVITY_PING', {
    domain: extractDomainFromLocation(),
    source,
    at: now
  });
}

async function checkAndShowOverridePopup() {
  const domain = extractDomainFromLocation();
  if (!domain || domain === 'unknown' || domain === lastPromptedDomain) return;

  const resp = await sendToBackground('CLASSIFY_SITE', { url: window.location.href });
  if (!resp.success || !resp.data) return;

  lastPromptedDomain = domain;

  const { classification, hasRule, showPopup, promptMode = 'always' } = resp.data;
  const shouldPrompt = showPopup
    && !hasRule
    && (promptMode === 'always' || classification === 'noise');

  if (!shouldPrompt) return;

  showOverridePopup(domain, classification);
}

function showOverridePopup(domain, classification = 'signal') {
  closeOverridePopup(true);

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    .card {
      background: #1f2937;
      color: #f9fafb;
      padding: 14px 18px;
      border-radius: 12px;
      box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.3);
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      max-width: 300px;
      border: 1px solid #374151;
    }
    .title { margin-bottom: 10px; font-weight: 600; }
    .domain { display: block; font-size: 12px; color: #9ca3af; margin-top: 2px; }
    .actions { display: flex; gap: 8px; margin-bottom: 10px; }
    button {
      flex: 1;
      padding: 8px 14px;
      border: 0;
      border-radius: 8px;
      color: white;
      font-weight: 600;
      cursor: pointer;
    }
    .signal { background: #10b981; }
    .noise { background: #ef4444; }
    .meta { font-size: 11px; color: #94a3b8; display: flex; gap: 12px; align-items: center; }
    label { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  `;

  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('div');
  title.className = 'title';
  title.append('Classify this site.');
  const domainEl = document.createElement('span');
  domainEl.className = 'domain';
  domainEl.textContent = `Currently: ${classification.toUpperCase()} - ${domain}`;
  title.append(document.createElement('br'), domainEl);

  const actions = document.createElement('div');
  actions.className = 'actions';

  const signalBtn = document.createElement('button');
  signalBtn.className = 'signal';
  signalBtn.textContent = 'Signal';

  const noiseBtn = document.createElement('button');
  noiseBtn.className = 'noise';
  noiseBtn.textContent = 'Noise';
  actions.append(signalBtn, noiseBtn);

  const meta = document.createElement('div');
  meta.className = 'meta';

  const rememberAlwaysLabel = document.createElement('label');
  const rememberAlwaysCheck = document.createElement('input');
  rememberAlwaysCheck.type = 'checkbox';
  rememberAlwaysCheck.checked = true;
  rememberAlwaysLabel.append(rememberAlwaysCheck, ' Remember always');

  const rememberTodayLabel = document.createElement('label');
  const rememberTodayCheck = document.createElement('input');
  rememberTodayCheck.type = 'checkbox';
  rememberTodayCheck.checked = false;
  rememberTodayLabel.append(rememberTodayCheck, ' Remember today');
  meta.append(rememberAlwaysLabel, rememberTodayLabel);

  card.append(title, actions, meta);
  shadow.append(style, card);
  document.documentElement.appendChild(host);
  overridePopup = host;

  const handleChoice = async (choice) => {
    await sendToBackground('UPDATE_CLASSIFICATION', {
      domain,
      newClassification: choice,
      remember: rememberAlwaysCheck.checked,
      rememberToday: rememberTodayCheck.checked
    });
    closeOverridePopup();
  };

  rememberAlwaysCheck.addEventListener('change', () => {
    rememberTodayCheck.checked = !rememberAlwaysCheck.checked;
  });
  rememberTodayCheck.addEventListener('change', () => {
    rememberAlwaysCheck.checked = !rememberTodayCheck.checked;
  });
  signalBtn.addEventListener('click', () => handleChoice('signal'));
  noiseBtn.addEventListener('click', () => handleChoice('noise'));

  setTimeout(() => closeOverridePopup(), 8000);
}

function closeOverridePopup(immediate = false) {
  if (!overridePopup) return;

  const popup = overridePopup;
  overridePopup = null;

  if (immediate) {
    popup.remove();
    return;
  }

  popup.style.transition = 'opacity 0.25s';
  popup.style.opacity = '0';
  setTimeout(() => popup.remove(), 250);
}

document.addEventListener('visibilitychange', notifyVisibility);
window.addEventListener('pageshow', () => {
  notifyVisibility();
  notifyActivity('pageshow', { force: true });
  checkAndShowOverridePopup();
});
window.addEventListener('focus', () => {
  notifyVisibility();
  notifyActivity('focus', { force: true });
});
window.addEventListener('beforeunload', () => closeOverridePopup(true));

for (const eventName of ['pointerdown', 'keydown', 'scroll', 'wheel', 'touchstart', 'mousemove']) {
  document.addEventListener(eventName, () => notifyActivity(eventName), {
    capture: true,
    passive: true
  });
}

window.addEventListener('scroll', () => notifyActivity('scroll'), {
  capture: true,
  passive: true
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAndShowOverridePopup);
} else {
  checkAndShowOverridePopup();
}

notifyVisibility();
notifyActivity('load', { force: true });

let lastUrl = location.href;
new MutationObserver(() => {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastPromptedDomain = null;
    notifyVisibility();
    checkAndShowOverridePopup();
  }
}).observe(document, { subtree: true, childList: true });
