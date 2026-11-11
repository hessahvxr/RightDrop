// Date and time helpers shared by every RightDrop client (web today, the
// mobile app next). Pure JavaScript: no React, no DOM, no Supabase.
//
// Calendar days are handled as "date keys" ('YYYY-MM-DD' strings in the
// device's local time zone). They compare correctly as plain strings and
// avoid the classic bug where `new Date('2026-11-10')` is read as UTC and
// lands on the wrong local day.

const pad = (n) => String(n).padStart(2, '0')

// Local calendar day of a Date -> 'YYYY-MM-DD'.
export function toDateKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// 'YYYY-MM-DD' -> Date at local midnight of that day.
export function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(key, days) {
  const d = parseDateKey(key)
  d.setDate(d.getDate() + days)
  return toDateKey(d)
}

// 'HH:MM' or 'HH:MM:SS' -> minutes since midnight.
export function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

export function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes()
}

// The exact local moment of a dose: date key + 'HH:MM[:SS]'.
export function doseDateTime(dateKey, timeStr) {
  const d = parseDateKey(dateKey)
  const [h, m] = timeStr.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d
}

// '14:30:00' -> '2:30 م' (12-hour clock with Arabic AM/PM marker).
export function formatTimeLabel(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'م' : 'ص'
  const displayH = h % 12 === 0 ? 12 : h % 12
  return `${displayH}:${pad(m)} ${period}`
}

// Arabic "in how long" phrase for a number of minutes, with correct
// singular / dual / plural forms. Used for "the next drop is in ...".
export function formatDurationAr(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes))
  if (mins < 1) return 'الآن'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  const hours =
    h === 0 ? '' : h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h <= 10 ? `${h} ساعات` : `${h} ساعة`
  const minutes =
    m === 0 ? '' : m === 1 ? 'دقيقة' : m === 2 ? 'دقيقتين' : m <= 10 ? `${m} دقائق` : `${m} دقيقة`
  return `بعد ${[hours, minutes].filter(Boolean).join(' و')}`
}
