// popup/popup.js

let currentDomain = '';
let goalEffectTimer = null;

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

async function sendMessage(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

async function loadData() {
  const ratioEl = document.getElementById('ratio');
  const domainEl = document.getElementById('current-domain');
  const classEl = document.getElementById('current-classification');

  try {
    const response = await sendMessage('GET_DAILY_DATA');

    if (!response?.success || !response.data) {
      showEmpty();
      return;
    }

    const data = response.data;
    const activities = data.activities || {};
    const settings = data.settings || {};
    const visibleTotals = calculateWebsiteTotals(activities);
    const totalSignalMs = visibleTotals.signalMs;
    const totalNoiseMs = visibleTotals.noiseMs;
    const total = totalSignalMs + totalNoiseMs;
    const ratio = total > 0 ? Math.round((totalSignalMs / total) * 100) : 0;

    document.getElementById('date').textContent = data.date || '';
    ratioEl.textContent = ratio + '%';
    ratioEl.style.color = ratio >= 70 ? '#10b981' : (ratio >= 50 ? '#fbbf24' : '#f87171');

    renderStatusLadder(ratio, settings);
    renderInsights({ data, activities, ratio, total, settings });
    renderActivityList(activities);
    await maybeShowGoalEffect({ date: data.date, ratio, total, settings });
    document.getElementById('total-time').textContent =
      `Website time today: ${formatDuration(total)}`;

    let domain = data.currentSite?.domain || data.currentSession?.domain || '';
    let liveClassification = data.currentSite?.classification || null;

    if (!domain) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        try {
          domain = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, '');
          const siteResponse = await sendMessage('CLASSIFY_SITE', { url: tab.url });
          liveClassification = siteResponse?.data?.classification || null;
        } catch {}
      }
    }

    currentDomain = domain;
    renderCurrentSite({ domain, classification: liveClassification, data, activities, paused: settings.trackingPaused });
  } catch (err) {
    console.error('loadData error:', err);
    showEmpty();
  }
}

function renderCurrentSite({ domain, classification, data, activities, paused }) {
  const domainEl = document.getElementById('current-domain');
  const classEl = document.getElementById('current-classification');
  const pauseBtn = document.getElementById('pause-btn');

  pauseBtn.textContent = paused ? 'Resume Tracking' : 'Pause Tracking';

  if (!domain) {
    domainEl.textContent = 'No active tab';
    classEl.textContent = paused ? 'PAUSED' : '-';
    classEl.className = `classification ${paused ? 'paused' : ''}`;
    return;
  }

  const resolvedClassification =
    classification ||
    (data.currentSession?.domain === domain ? data.currentSession.classification : null) ||
    activities[domain]?.classification ||
    'signal';

  domainEl.textContent = domain;
  classEl.textContent = paused ? 'PAUSED' : resolvedClassification.toUpperCase();
  classEl.className = `classification ${paused ? 'paused' : resolvedClassification}`;
}

function renderStatusLadder(ratio, settings) {
  const nameEl = document.getElementById('status-bar-name');
  const currentEl = document.getElementById('status-current-tier');
  const fillEl = document.getElementById('status-fill');
  const topTiersEl = document.getElementById('status-tiers-top');
  const goalTierEl = document.getElementById('status-tiers-goal');
  const tiers = getStatusTiers(settings);
  const next = [...tiers].sort((a, b) => a.goal - b.goal).find((tier) => ratio < tier.goal);

  nameEl.textContent = getStatusBarName(settings);
  currentEl.textContent = '';
  fillEl.style.width = `${clampNumber(ratio, 0, 100)}%`;

  const sortedTiers = [...tiers].sort((a, b) => a.goal - b.goal);
  const goalTier = sortedTiers[0];
  const topTiers = sortedTiers.slice(1);

  topTiersEl.textContent = '';
  topTiers.forEach((tier) => {
    topTiersEl.appendChild(createStatusMarker({ tier, ratio, next, showGoal: false, placement: 'top' }));
  });

  goalTierEl.textContent = '';
  if (goalTier) {
    goalTierEl.appendChild(createStatusMarker({
      tier: goalTier,
      ratio,
      next,
      showGoal: true,
      showName: true,
      placement: 'goal'
    }));
  }
}

function createStatusMarker({ tier, ratio, next, showGoal, showName = !showGoal, placement }) {
  const marker = document.createElement('div');
  const tierPosition = clampNumber(tier.goal, 0, 100);
  const classes = ['status-marker', `status-marker-${placement}`];

  if (ratio >= tier.goal) {
    classes.push('achieved');
  } else if (next?.goal === tier.goal) {
    classes.push('next');
  }

  if (tierPosition <= 2) {
    classes.push('edge-start');
  } else if (tierPosition >= 98) {
    classes.push('edge-end');
  } else if (tierPosition >= 75) {
    classes.push('before-end');
  }

  marker.className = classes.join(' ');
  marker.style.setProperty('--tier-position', `${tierPosition}%`);
  marker.title = `${tier.goal}% ${tier.label}`;

  const label = document.createElement('span');
  label.className = 'status-marker-label';
  if (showName) label.classList.add('with-name');

  const value = document.createElement('strong');
  value.textContent = `${tier.goal}%`;

  if (!showName) {
    label.appendChild(value);
  } else {
    const name = document.createElement('span');
    name.className = 'status-marker-name';
    name.textContent = tier.label;
    label.append(name, value);
  }

  marker.appendChild(label);
  return marker;
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
    .filter((tier) => tier.label);

  return tiers.length > 0 ? tiers : DEFAULT_STATUS_TIERS;
}

function normalizeStatusLabel(label) {
  const value = String(label || '').trim();
  return (STATUS_LABEL_ALIASES[value] || value).slice(0, 32);
}

function clampNumber(value, min, max, fallback = min) {
  const resolved = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, Math.round(resolved)));
}

function renderInsights({ data, activities, ratio, total, settings }) {
  const target = Number(settings.targetSignalRatio || 70);
  const goalEl = document.getElementById('goal-status');
  const topNoiseEl = document.getElementById('top-noise');
  const weeklyAverageEl = document.getElementById('weekly-average');
  const sessionEl = document.getElementById('session-duration');

  if (!total) {
    goalEl.textContent = `${target}% target`;
    topNoiseEl.textContent = 'None yet';
  } else if (ratio >= target) {
    goalEl.textContent = `${ratio}% / ${target}%`;
  } else {
    goalEl.textContent = `${target - ratio} pts short`;
  }

  const topNoise = Object.entries(activities)
    .map(([domain, item]) => [domain, getNoiseDurationMs(item)])
    .filter(([, noiseMs]) => noiseMs > 0)
    .sort((a, b) => b[1] - a[1])[0];

  topNoiseEl.textContent = topNoise ? `${topNoise[0]} ${formatDuration(topNoise[1])}` : 'None yet';

  const weeklyStats = data.weeklyStats || {};
  if (weeklyStats.totalMs > 0) {
    weeklyAverageEl.textContent = `${weeklyStats.ratio}%`;
    const filteredDays = Array.isArray(weeklyStats.includedWeekdays) && weeklyStats.includedWeekdays.length < 7
      ? `, ${weeklyStats.includedWeekdays.length} selected weekday${weeklyStats.includedWeekdays.length === 1 ? '' : 's'}`
      : '';
    const freshStart = weeklyStats.freshStartDate ? `, fresh since ${weeklyStats.freshStartDate}` : '';
    weeklyAverageEl.title = `${weeklyStats.daysWithData || 0} tracked day${weeklyStats.daysWithData === 1 ? '' : 's'} in the last 7 days${filteredDays}${freshStart}`;
  } else {
    weeklyAverageEl.textContent = 'No data';
    weeklyAverageEl.title = 'No tracked website time in the last 7 days';
  }

  if (settings.trackingPaused) {
    sessionEl.textContent = 'Paused';
  } else if (data.currentSession?.trackedElapsedMs > 0) {
    sessionEl.textContent = formatDurationPrecise(data.currentSession.trackedElapsedMs);
  } else if (settings.requireActivityToTrack) {
    sessionEl.textContent = getEngagementLabel(data.engagement);
  } else {
    sessionEl.textContent = 'Idle';
  }
}

async function maybeShowGoalEffect({ date, ratio, total, settings }) {
  if (!date) return;

  const target = clampNumber(Number(settings.targetSignalRatio || 70), 0, 100, 70);
  const stateKey = `${date}:${target}`;
  const atGoal = total > 0 && ratio >= target;
  const result = await chrome.storage.local.get(['goalEffectState']);
  const goalEffectState = result.goalEffectState || {};
  const previous = goalEffectState[stateKey];

  if (previous === undefined || total <= 0) {
    goalEffectState[stateKey] = atGoal;
    await chrome.storage.local.set({ goalEffectState });
    return;
  }

  if (!previous && atGoal && settings.goalCelebrationEnabled !== false) {
    showGoalEffect('celebrate', { ratio, target });
  } else if (previous && !atGoal && settings.goalDropAlertEnabled !== false) {
    showGoalEffect('drop', { ratio, target });
  }

  if (previous !== atGoal) {
    goalEffectState[stateKey] = atGoal;
    await chrome.storage.local.set({ goalEffectState });
  }
}

function showGoalEffect(type, { ratio, target }) {
  const overlay = document.getElementById('goal-effect');
  clearTimeout(goalEffectTimer);
  overlay.textContent = '';
  overlay.className = `goal-effect-overlay show ${type}`;

  if (type === 'celebrate') {
    renderConfetti(overlay);
    overlay.appendChild(createGoalPanel('Goal reached', `${ratio}% Signal / ${target}% goal`));
  } else {
    const panel = createGoalPanel('Below goal', `${ratio}% Signal / ${target}% goal`);
    const face = document.createElement('div');
    face.className = 'sad-face';
    face.textContent = ':(';
    panel.prepend(face);
    overlay.appendChild(panel);
  }

  goalEffectTimer = setTimeout(() => {
    overlay.className = 'goal-effect-overlay';
    overlay.textContent = '';
  }, type === 'celebrate' ? 3000 : 2400);
}

function createGoalPanel(title, detail) {
  const panel = document.createElement('div');
  panel.className = 'goal-effect-panel';
  const titleEl = document.createElement('div');
  titleEl.className = 'goal-effect-title';
  titleEl.textContent = title;
  const detailEl = document.createElement('div');
  detailEl.className = 'goal-effect-detail';
  detailEl.textContent = detail;
  panel.append(titleEl, detailEl);
  return panel;
}

function renderConfetti(container) {
  const colors = ['#10b981', '#fbbf24', '#ef4444', '#38bdf8', '#a78bfa'];

  for (let i = 0; i < 36; i += 1) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.floor(Math.random() * 100)}%`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${900 + Math.floor(Math.random() * 900)}ms`;
    piece.style.animationDelay = `${Math.floor(Math.random() * 350)}ms`;
    container.appendChild(piece);
  }
}

function getEngagementLabel(engagement = {}) {
  switch (engagement.reason) {
    case 'idle':
      return 'System idle';
    case 'locked':
      return 'Locked';
    case 'inactive':
      return 'Inactive';
    case 'waiting_for_activity':
      return 'Awaiting input';
    default:
      return 'Idle';
  }
}

function renderActivityList(activities) {
  const container = document.getElementById('activity-list');
  container.textContent = '';

  const items = Object.entries(activities)
    .filter(([domain]) => domain !== '__off_the_web__')
    .sort((a, b) => getActivityDurationMs(b[1]) - getActivityDurationMs(a[1]));

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No website time yet';
    container.appendChild(empty);
    return;
  }

  for (const [domain, data] of items) {
    for (const item of getActivityRows(domain, data)) {
      container.appendChild(createActivityRow(item));
    }
  }
}

function calculateWebsiteTotals(activities) {
  const totals = { signalMs: 0, noiseMs: 0 };

  for (const [domain, activity] of Object.entries(activities || {})) {
    if (domain === '__off_the_web__') continue;

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

function getActivityRows(domain, data) {
  if (!isSplitActivity(data)) {
    return [{
      domain,
      classification: data.classification === 'noise' ? 'noise' : 'signal',
      durationMs: data.durationMs || 0,
      canSplit: true,
      splitChild: false
    }];
  }

  const primary = data.classification === 'signal' ? 'signal' : 'noise';
  const secondary = primary === 'signal' ? 'noise' : 'signal';
  const rows = [];

  for (const classification of [primary, secondary]) {
    const durationMs = classification === 'signal' ? (data.signalMs || 0) : (data.noiseMs || 0);
    if (durationMs <= 0) continue;
    rows.push({
      domain,
      classification,
      durationMs,
      canSplit: false,
      splitChild: rows.length > 0
    });
  }

  return rows;
}

function createActivityRow({ domain, classification, durationMs, canSplit, splitChild }) {
  const row = document.createElement('div');
  row.className = `activity ${classification}${splitChild ? ' split-child' : ''}`;

  const name = document.createElement('span');
  name.className = 'activity-domain';
  name.textContent = domain;

  const actions = document.createElement('div');
  actions.className = 'activity-actions';

  const duration = document.createElement('button');
  duration.type = 'button';
  duration.className = 'activity-time';
  duration.textContent = formatDuration(durationMs);
  duration.title = `Edit minutes for ${domain}`;
  duration.setAttribute(
    'aria-label',
    `Edit minutes for ${domain}`
  );
  duration.dataset.action = 'duration';
  duration.dataset.domain = domain;
  duration.dataset.classification = classification;
  duration.dataset.durationMs = String(durationMs);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'icon-button';
  edit.textContent = '✎';
  edit.title = `Mark this time as ${classification === 'signal' ? 'Noise' : 'Signal'}`;
  edit.setAttribute('aria-label', edit.title);
  edit.dataset.action = 'flip';
  edit.dataset.domain = domain;
  edit.dataset.classification = classification;

  actions.append(duration, edit);

  if (canSplit) {
    const split = document.createElement('button');
    split.type = 'button';
    split.className = 'icon-button';
    split.textContent = '÷';
    split.title = `Split ${domain} time between Signal and Noise`;
    split.setAttribute('aria-label', split.title);
    split.dataset.action = 'split';
    split.dataset.domain = domain;
    actions.append(split);
  }

  row.append(name, actions);
  return row;
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

function getNoiseDurationMs(activity) {
  if (isSplitActivity(activity)) {
    return activity.noiseMs || 0;
  }

  return activity?.classification === 'noise' ? (activity.durationMs || 0) : 0;
}

function formatDuration(ms) {
  if (!ms || ms < 1000) return '0m';
  const min = Math.floor(ms / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatDurationPrecise(ms) {
  if (!ms || ms < 1000) return '0s';
  if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
  return formatDuration(ms);
}

function showEmpty() {
  document.getElementById('ratio').textContent = '-';
  document.getElementById('status-bar-name').textContent = DEFAULT_STATUS_BAR_NAME;
  document.getElementById('status-current-tier').textContent = '-';
  document.getElementById('status-fill').style.width = '0%';
  document.getElementById('status-tiers-top').textContent = '';
  document.getElementById('status-tiers-goal').textContent = '';
  document.getElementById('current-domain').textContent = '-';
  document.getElementById('current-classification').textContent = '-';
  document.getElementById('activity-list').textContent = '';
  document.getElementById('goal-status').textContent = '-';
  document.getElementById('top-noise').textContent = '-';
  document.getElementById('weekly-average').textContent = '-';
  document.getElementById('session-duration').textContent = '-';
}

function showFeedback(message) {
  const toast = document.getElementById('success-toast');
  toast.textContent = message;
  toast.style.display = 'block';
  setTimeout(() => {
    toast.style.display = 'none';
  }, 1600);
}

async function markCurrentSite(type) {
  if (!currentDomain) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url) {
      currentDomain = new URL(tab.url).hostname.toLowerCase().replace(/^www\./, '');
    }
  }

  if (!currentDomain) {
    alert('Could not detect current website.');
    return;
  }

  const response = await sendMessage('UPDATE_CLASSIFICATION', {
    domain: currentDomain,
    newClassification: type,
    remember: true
  });

  if (!response?.success || response.data?.updated === false) {
    alert('Could not update the current website classification.');
    return;
  }

  const classEl = document.getElementById('current-classification');
  classEl.textContent = type.toUpperCase();
  classEl.className = `classification ${type}`;

  showFeedback(type === 'signal' ? 'Marked as Signal' : 'Marked as Noise');
  setTimeout(loadData, 300);
}

async function editActivityClassification(domain, currentClassification) {
  const nextClassification = currentClassification === 'signal' ? 'noise' : 'signal';
  const response = await sendMessage('UPDATE_ACTIVITY_SEGMENT', {
    domain,
    fromClassification: currentClassification,
    toClassification: nextClassification
  });

  if (!response?.success || response.data?.updated === false) {
    alert('Could not update that website classification.');
    return;
  }

  showFeedback(`Marked ${domain} as ${nextClassification === 'signal' ? 'Signal' : 'Noise'}`);
  loadData();
}

async function editActivityDuration(domain, classification, durationMs) {
  const currentMinutes = formatMinutesForInput(durationMs);
  const label = classification ? `${domain} ${classification}` : domain;
  const value = prompt(`Set minutes for ${label}:`, currentMinutes);
  if (value === null) return;

  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) {
    alert('Enter a valid number of minutes.');
    return;
  }

  const response = await sendMessage('UPDATE_ACTIVITY_DURATION', {
    domain,
    classification,
    durationMs: Math.round(minutes * 60000)
  });

  if (!response?.success || response.data?.updated === false) {
    alert('Could not update that website time.');
    return;
  }

  showFeedback(`Updated ${domain} time`);
  loadData();
}

function formatMinutesForInput(ms) {
  const minutes = (ms || 0) / 60000;
  if (Number.isInteger(minutes)) return String(minutes);
  return String(Math.round(minutes * 10) / 10);
}

async function splitActivity(domain) {
  const response = await sendMessage('SPLIT_ACTIVITY', { domain });

  if (!response?.success || response.data?.updated === false) {
    alert('Could not split that website time.');
    return;
  }

  showFeedback(`Split ${domain} time`);
  loadData();
}

function handleActivityListClick(event) {
  const target = event.target instanceof Element ? event.target : event.target?.parentElement;
  const button = target?.closest('button[data-action]');
  if (!button) return;

  event.preventDefault();
  event.stopPropagation();

  if (button.dataset.action === 'duration') {
    editActivityDuration(
      button.dataset.domain,
      button.dataset.classification,
      Number(button.dataset.durationMs || 0)
    );
    return;
  }

  if (button.dataset.action === 'flip') {
    editActivityClassification(
      button.dataset.domain,
      button.dataset.classification
    );
    return;
  }

  if (button.dataset.action === 'split') {
    splitActivity(button.dataset.domain);
  }
}

async function toggleTracking() {
  const response = await sendMessage('GET_DAILY_DATA');
  const paused = !!response?.data?.settings?.trackingPaused;
  const toggleResponse = await sendMessage('TOGGLE_TRACKING', { paused: !paused });

  if (toggleResponse?.success) {
    showFeedback(!paused ? 'Tracking paused' : 'Tracking resumed');
    loadData();
  }
}

document.getElementById('mark-signal').onclick = () => markCurrentSite('signal');
document.getElementById('mark-noise').onclick = () => markCurrentSite('noise');
document.getElementById('pause-btn').onclick = toggleTracking;
document.getElementById('activity-list').addEventListener('click', handleActivityListClick);

document.getElementById('reset-btn').onclick = async () => {
  if (confirm("Reset today's data?")) {
    await sendMessage('RESET_TODAY');
    loadData();
  }
};

document.getElementById('settings-btn').onclick = () => chrome.runtime.openOptionsPage();

loadData();
setInterval(loadData, 5000);
