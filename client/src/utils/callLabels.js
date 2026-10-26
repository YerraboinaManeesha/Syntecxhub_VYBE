import { formatTime, formatDate, isSameDay } from './format.js';

export function formatDuration(sec = 0) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** "3:42 PM", "Yesterday, 3:42 PM" or "26 Oct 2026, 3:42 PM". */
export function formatCallTime(value) {
  const d = new Date(value);
  const now = new Date();
  if (isSameDay(d, now)) return formatTime(d);
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (isSameDay(d, y)) return `Yesterday, ${formatTime(d)}`;
  return `${formatDate(d)}, ${formatTime(d)}`;
}

/**
 * One wording for chat cards and the Calls page.
 * outgoing: this viewer placed the call; cancelledByCaller: the caller hung up while it rang.
 * Returns { label, missed, answered }.
 */
export function describeCall({ status, outgoing, cancelledByCaller }) {
  if (status === 'completed' || status === 'ongoing') return { label: outgoing ? 'Outgoing' : 'Incoming', missed: false, answered: true };
  if (status === 'declined') return { label: 'Declined', missed: false, answered: false };
  if (status === 'failed') return { label: 'Failed', missed: false, answered: false };
  if (status === 'ringing') return { label: outgoing ? 'Calling' : 'Ringing', missed: false, answered: false };
  if (outgoing) {
    if (status === 'busy') return { label: 'Busy', missed: false, answered: false };
    return { label: cancelledByCaller ? 'Cancelled' : 'No answer', missed: false, answered: false };
  }
  return { label: 'Missed', missed: true, answered: false };
}

export const callTypeLabel = (type) => (type === 'video' ? 'Video call' : 'Voice call');