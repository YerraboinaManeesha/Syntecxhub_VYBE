export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Stable colour bucket (0-5) from an id, so a person always gets the same avatar colour.
export function avatarHue(id = '') {
  let hash = 0;
  for (const char of String(id)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 6;
}

const timeFormat = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat([], { day: 'numeric', month: 'short', year: 'numeric' });
const shortDateFormat = new Intl.DateTimeFormat([], { day: 'numeric', month: 'short' });
const weekdayFormat = new Intl.DateTimeFormat([], { weekday: 'long' });
const shortWeekdayFormat = new Intl.DateTimeFormat([], { weekday: 'short' });

export const formatTime = (value) => timeFormat.format(new Date(value));

export function isSameDay(a, b) {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

function daysAgo(value) {
  const start = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((start(new Date()) - start(new Date(value))) / 86_400_000);
}

// Date separator inside a conversation
export function formatDayLabel(value) {
  const diff = daysAgo(value);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return weekdayFormat.format(new Date(value));
  return dateFormat.format(new Date(value));
}

// Compact timestamp for the conversation list
export function formatListTime(value) {
  const diff = daysAgo(value);
  if (diff === 0) return formatTime(value);
  if (diff === 1) return 'Yesterday';
  if (diff > 1 && diff < 7) return shortWeekdayFormat.format(new Date(value));
  return shortDateFormat.format(new Date(value));
}

export const formatDate = (value) => dateFormat.format(new Date(value));

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const fullFormat = new Intl.DateTimeFormat([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
export const formatFull = (value) => fullFormat.format(new Date(value));

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
