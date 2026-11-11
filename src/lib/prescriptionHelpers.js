// Shared prescription helpers used by both doctor and patient pages.
// The rules themselves live in src/core (plain JavaScript, reusable by the
// mobile app); this file keeps the existing import paths working and adds
// the web-only display bits (Tailwind colour classes, date formatting).

import { parseDateKey } from '../core/dates.js'

export { EYE_LABELS, deriveStatus } from '../core/schedule.js'

export const STATUS_LABELS = {
  active: 'نشطة',
  discontinued: 'متوقفة',
  completed: 'مكتملة',
}

export const STATUS_COLORS = {
  active: 'bg-emerald-100 text-emerald-700',
  discontinued: 'bg-rose-100 text-rose-700',
  completed: 'bg-slate-100 text-slate-500',
}

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  // Plain dates ('YYYY-MM-DD') are calendar days: read them in local time so
  // they never shift by a day. Full timestamps are parsed as usual.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? parseDateKey(dateStr) : new Date(dateStr)
  return date.toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
