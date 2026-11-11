// The late-dose prompt: wording and the small piece of state behind
// "لا، ما أخذتها". Pure JavaScript, shared by web and the mobile app.
//
// Rules:
//   - A late dose is ASKED about, never advised on. The app does not tell the
//     patient to take, skip or double a late dose. The only guidance is to
//     follow the doctor's instructions.
//   - "Yes" saves a normal 'taken' record with the real confirmation time
//     (it reads back as 'taken_late').
//   - "No" saves NOTHING to the database. The dose stays unconfirmed and can
//     still be recorded later the same day. The answer is only remembered on
//     the device, for that day, so the question is not repeated.
//   - When the day ends, an unconfirmed dose is classified as missed
//     (see getDoseStatus).

import { getLateDoses } from './schedule.js'

export const LATE_DOSE_TEXT = {
  title: 'قطرتك تأخرت',
  scheduledAt: 'موعدها كان',
  question: 'هل أخذت القطرة؟',
  yes: 'نعم، أخذتها',
  no: 'لا، ما أخذتها',
  notRecorded: 'لم تُسجَّل بعد',
  recordLater: 'إذا أخذتها لاحقاً اليوم، سجّلها من هنا.',
  recordNow: 'أخذت القطرة',
  unsure: 'غير متأكد ماذا تفعل؟ اتبع تعليمات طبيبك.',
}

// "قطرتان متأخرتان" / "3 قطرات متأخرة" (Arabic number agreement).
export function lateCountLabel(count) {
  if (count <= 0) return ''
  if (count === 1) return 'قطرة متأخرة'
  if (count === 2) return 'قطرتان متأخرتان'
  if (count <= 10) return `${count} قطرات متأخرة`
  return `${count} قطرة متأخرة`
}

// ---- "No" answers remembered on the device -----------------------------------
// Stored shape: { date: 'YYYY-MM-DD', keys: [doseKey, ...] }. Anything from
// another day is ignored, so yesterday's answers never leak into today.

export function deferredKeysFor(stored, todayKey) {
  if (!stored || stored.date !== todayKey || !Array.isArray(stored.keys)) return []
  return stored.keys
}

export function addDeferredKey(stored, todayKey, key) {
  const keys = deferredKeysFor(stored, todayKey)
  return { date: todayKey, keys: keys.includes(key) ? keys : [...keys, key] }
}

export function removeDeferredKey(stored, todayKey, key) {
  return { date: todayKey, keys: deferredKeysFor(stored, todayKey).filter((k) => k !== key) }
}

// Late doses for the Today screen, earliest first. `deferred` is true once
// the patient has answered "no" for that dose today.
export function buildLatePrompts(doses, recordsByKey, now = new Date(), deferredKeys = []) {
  const deferred = new Set(deferredKeys)
  return getLateDoses(doses, recordsByKey, now).map((dose) => ({
    dose,
    deferred: deferred.has(dose.key),
  }))
}
