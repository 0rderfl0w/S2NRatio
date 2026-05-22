// utils/time.js
// Time formatting and duration helpers for S2NRatio

export function formatDuration(ms) {
  if (!ms || ms < 0) return '0m';
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function calculateRatio(signalMs, noiseMs) {
  const total = signalMs + noiseMs;
  if (total === 0) return 0;
  return Math.round((signalMs / total) * 100);
}

export function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTodayKey(dayStartHour = 0, now = new Date()) {
  const hour = now.getHours();
  const date = new Date(now);
  if (hour < dayStartHour) {
    date.setDate(date.getDate() - 1);
  }
  return formatDateKey(date);
}
