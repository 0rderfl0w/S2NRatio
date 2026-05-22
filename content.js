// content.js
// S2NRatio Content Script

let overridePopup = null;
let goalEffectPopup = null;
let goalEffectTimer = null;
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

function showGoalEffectPopup({ effectType = 'celebrate', ratio = 0, target = 0 } = {}) {
  closeGoalEffectPopup(true);

  const isDrop = effectType === 'drop';
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .overlay {
      position: fixed;
      inset: 0;
      display: grid;
      place-items: center;
      overflow: hidden;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: #f9fafb;
    }
    .card {
      position: relative;
      z-index: 1;
      width: min(320px, calc(100vw - 40px));
      padding: 20px 18px 18px;
      border-radius: 14px;
      background: #111827;
      border: 1px solid #334155;
      box-shadow: 0 24px 60px rgb(0 0 0 / 0.45);
      text-align: center;
      pointer-events: auto;
      animation: pop 0.22s ease forwards;
    }
    .celebrate .card { border-color: #10b981; }
    .drop .card { border-color: #ef4444; animation-name: pop, nudge; animation-duration: 0.22s, 0.36s; }
    .eyebrow {
      margin-bottom: 6px;
      color: #94a3b8;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .title {
      margin-bottom: 6px;
      font-size: 22px;
      line-height: 1.1;
      font-weight: 900;
    }
    .celebrate .title { color: #4ade80; }
    .drop .title { color: #f87171; }
    .detail {
      color: #cbd5e1;
      font-size: 13px;
      font-weight: 700;
    }
    .face {
      margin-bottom: 8px;
      color: #f87171;
      font-size: 54px;
      font-weight: 900;
      line-height: 0.85;
    }
    .close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 999px;
      background: #1f2937;
      color: #cbd5e1;
      cursor: pointer;
      font: 700 14px/1 system-ui, -apple-system, sans-serif;
    }
    .close:hover { background: #334155; color: white; }
    .confetti {
      position: absolute;
      top: -18px;
      width: 7px;
      height: 13px;
      border-radius: 2px;
      animation-name: fall;
      animation-timing-function: linear;
      animation-fill-mode: forwards;
    }
    @keyframes pop {
      from { transform: scale(0.94); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    @keyframes nudge {
      0%, 100% { transform: translateX(0) scale(1); }
      35% { transform: translateX(-5px) scale(1); }
      70% { transform: translateX(5px) scale(1); }
    }
    @keyframes fall {
      to { transform: translateY(105vh) rotate(620deg); opacity: 0.9; }
    }
  `;

  const overlay = document.createElement('div');
  overlay.className = `overlay ${isDrop ? 'drop' : 'celebrate'}`;

  if (!isDrop) {
    renderGoalConfetti(overlay);
  }

  const card = document.createElement('div');
  card.className = 'card';

  const close = document.createElement('button');
  close.className = 'close';
  close.type = 'button';
  close.setAttribute('aria-label', 'Close S2NRatio goal popup');
  close.textContent = 'x';

  const eyebrow = document.createElement('div');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'S2NRatio';

  const title = document.createElement('div');
  title.className = 'title';
  title.textContent = isDrop ? 'Below signal goal' : 'Signal goal reached';

  const detail = document.createElement('div');
  detail.className = 'detail';
  detail.textContent = `${ratio}% Signal / ${target}% goal`;

  if (isDrop) {
    const face = document.createElement('div');
    face.className = 'face';
    face.textContent = ':(';
    card.append(close, face, eyebrow, title, detail);
  } else {
    card.append(close, eyebrow, title, detail);
  }

  overlay.appendChild(card);
  shadow.append(style, overlay);
  document.documentElement.appendChild(host);
  goalEffectPopup = host;

  close.addEventListener('click', () => closeGoalEffectPopup());
  goalEffectTimer = setTimeout(() => closeGoalEffectPopup(), isDrop ? 4200 : 4800);
}

function renderGoalConfetti(container) {
  const colors = ['#10b981', '#fbbf24', '#ef4444', '#38bdf8', '#a78bfa'];

  for (let i = 0; i < 44; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti';
    piece.style.left = `${Math.floor(Math.random() * 100)}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${900 + Math.floor(Math.random() * 950)}ms`;
    piece.style.animationDelay = `${Math.floor(Math.random() * 420)}ms`;
    container.appendChild(piece);
  }
}

function closeGoalEffectPopup(immediate = false) {
  clearTimeout(goalEffectTimer);
  goalEffectTimer = null;

  if (!goalEffectPopup) return;

  const popup = goalEffectPopup;
  goalEffectPopup = null;

  if (immediate) {
    popup.remove();
    return;
  }

  popup.style.transition = 'opacity 0.2s';
  popup.style.opacity = '0';
  setTimeout(() => popup.remove(), 220);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SHOW_GOAL_EFFECT') {
    showGoalEffectPopup(message.payload || {});
    sendResponse({ success: true });
    return true;
  }

  return false;
});

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
window.addEventListener('beforeunload', () => {
  closeOverridePopup(true);
  closeGoalEffectPopup(true);
});

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
