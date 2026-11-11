// Dose schedule rules shared by every RightDrop client. Pure JavaScript.
//
// Data shapes are the database rows as-is:
//   prescription: { id, medication_name, concentration, dosage, eye, status,
//                   start_date, end_date, created_at,
//                   dose_times: [{ dose_time, sort_order, created_at }] }
//   dose record:  { prescription_id, scheduled_date, dose_time, status, taken_at }
//
// The database stores only two record statuses: 'taken' and 'missed'.
// "Taken late" is worked out here from the record's own timestamps, so it
// needs no database change and applies to old records too.

import {
  toDateKey, timeToMinutes, minutesOfDay, formatTimeLabel, addDays, doseDateTime,
} from './dates.js'

export const EYE_LABELS = {
  right: 'العين اليمنى',
  left: 'العين اليسرى',
  both: 'كلتا العينين',
}

// A dose counts as "due" from 15 minutes before to 30 minutes after its time
// (unchanged from the original app). After that it is "late": the patient is
// asked about it, and it stays confirmable until the end of that day. It is
// never locked. Only when the day is over does an unconfirmed dose become
// "missed".
export const DUE_BEFORE_MIN = 15
export const DUE_AFTER_MIN = 30
// The patient may confirm a dose up to one hour early, not earlier.
export const CONFIRM_EARLY_MIN = 60

// 'active' | 'completed' (end date passed) | 'discontinued'.
export function deriveStatus(prescription, todayKey = toDateKey()) {
  if (prescription.status === 'discontinued') return 'discontinued'
  if (prescription.end_date < todayKey) return 'completed'
  return 'active'
}

// Is the prescription supposed to be taken on this calendar day?
export function isScheduledOn(prescription, dateKey) {
  if (prescription.status === 'discontinued') return false
  return prescription.start_date <= dateKey && dateKey <= prescription.end_date
}

// Same key format the database uniqueness rule uses:
// one record per (prescription, day, time).
export function doseKey(prescriptionId, dateKey, doseTime) {
  return `${prescriptionId}_${dateKey}_${doseTime}`
}

// The moment this exact dose time started to exist: the later of when the
// prescription was created and when the doctor set (or last changed) the time.
// null when the rows do not carry created_at.
function scheduledSince(rx, doseTimeRow) {
  let latest = null
  for (const value of [rx.created_at, doseTimeRow.created_at]) {
    if (!value) continue
    const d = new Date(value)
    if (!Number.isNaN(d.getTime()) && (!latest || d > latest)) latest = d
  }
  return latest
}

// False for a dose whose time had already passed when the doctor created the
// schedule (e.g. prescription written at 3 pm with an 8 am dose time). Such a
// dose was never expected, so it must not be shown as late or missed.
export function wasExpected(dose) {
  if (!dose.scheduledSince) return true
  return doseDateTime(dose.scheduled_date, dose.dose_time) >= dose.scheduledSince
}

// All doses planned for one day, in time order.
export function buildDosesForDate(prescriptions, dateKey) {
  const doses = []
  for (const rx of prescriptions || []) {
    if (!isScheduledOn(rx, dateKey)) continue
    for (const dt of rx.dose_times || []) {
      doses.push({
        key: doseKey(rx.id, dateKey, dt.dose_time),
        prescription_id: rx.id,
        medication_name: rx.medication_name,
        concentration: rx.concentration || null,
        dosage: rx.dosage,
        eye: rx.eye,
        eyeLabel: EYE_LABELS[rx.eye],
        dose_time: dt.dose_time,
        scheduled_date: dateKey,
        timeMinutes: timeToMinutes(dt.dose_time),
        timeLabel: formatTimeLabel(dt.dose_time),
        scheduledSince: scheduledSince(rx, dt),
      })
    }
  }
  return sortDoses(doses)
}

function sortDoses(doses) {
  return doses.sort(
    (a, b) => a.timeMinutes - b.timeMinutes || a.medication_name.localeCompare(b.medication_name)
  )
}

// The doses that count for one day, given what has been recorded:
//   - planned doses that were expected (see wasExpected) or already recorded;
//   - plus recorded doses that no longer appear in the plan (the doctor changed
//     the times or stopped the prescription afterwards). A saved record is
//     never dropped from the day.
export function dosesForDay(prescriptions, recordsByKey, dateKey) {
  const records = recordsByKey || {}
  const doses = buildDosesForDate(prescriptions, dateKey).filter(
    (dose) => records[dose.key] || wasExpected(dose)
  )
  const planned = new Set(doses.map((d) => d.key))
  const rxById = {}
  for (const rx of prescriptions || []) rxById[rx.id] = rx

  for (const [key, r] of Object.entries(records)) {
    if (r.scheduled_date !== dateKey || planned.has(key)) continue
    const rx = rxById[r.prescription_id] || r.prescription || {}
    doses.push({
      key,
      prescription_id: r.prescription_id,
      medication_name: rx.medication_name || 'دواء',
      concentration: rx.concentration || null,
      dosage: rx.dosage || '',
      eye: rx.eye || null,
      eyeLabel: EYE_LABELS[rx.eye] || '',
      dose_time: r.dose_time,
      scheduled_date: dateKey,
      timeMinutes: timeToMinutes(r.dose_time),
      timeLabel: formatTimeLabel(r.dose_time),
      scheduledSince: null,
      unplanned: true,
    })
  }
  return sortDoses(doses)
}

// Index dose records by dose key for quick lookup.
export function indexRecords(records) {
  const map = {}
  for (const r of records || []) {
    map[doseKey(r.prescription_id, r.scheduled_date, r.dose_time)] = r
  }
  return map
}

// Was this recorded dose confirmed after its due window had closed?
export function isTakenLate(record) {
  if (!record || record.status !== 'taken' || !record.taken_at) return false
  const takenAt = new Date(record.taken_at)
  if (Number.isNaN(takenAt.getTime())) return false
  const scheduled = doseDateTime(record.scheduled_date, record.dose_time)
  return takenAt.getTime() - scheduled.getTime() > DUE_AFTER_MIN * 60000
}

// Status of one dose at a given moment:
//   'taken'       -> recorded inside the due window (or early)
//   'taken_late'  -> recorded after the due window, same day
//   'missed'      -> a 'missed' record exists, OR the day is over and nothing
//                    was recorded
//   'upcoming'    -> not time yet
//   'due'         -> inside the due window
//   'late'        -> window passed today, not confirmed yet. Stays confirmable
//                    until the day ends; never becomes 'missed' the same day.
export function getDoseStatus(dose, record, now = new Date()) {
  if (record) {
    if (record.status === 'taken') return isTakenLate(record) ? 'taken_late' : 'taken'
    return record.status
  }
  const todayKey = toDateKey(now)
  if (dose.scheduled_date < todayKey) return 'missed'
  if (dose.scheduled_date > todayKey) return 'upcoming'
  const diff = minutesOfDay(now) - dose.timeMinutes
  if (diff < -DUE_BEFORE_MIN) return 'upcoming'
  if (diff <= DUE_AFTER_MIN) return 'due'
  return 'late'
}

// Can the patient confirm this dose right now?
export function canConfirm(dose, record, now = new Date()) {
  if (record) return false
  if (dose.scheduled_date !== toDateKey(now)) return false
  return minutesOfDay(now) >= dose.timeMinutes - CONFIRM_EARLY_MIN
}

// Late, unconfirmed doses for the day, earliest first.
export function getLateDoses(doses, recordsByKey, now = new Date()) {
  return doses.filter((dose) => getDoseStatus(dose, recordsByKey[dose.key], now) === 'late')
}

// The single dose the patient should look at now: the earliest one that is
// due or late; otherwise the next upcoming one; otherwise null (all done).
// With { includeLate: false } late doses are skipped, for screens that show
// late doses in their own section.
export function pickNextDose(doses, recordsByKey, now = new Date(), { includeLate = true } = {}) {
  let upcoming = null
  for (const dose of doses) {
    const status = getDoseStatus(dose, recordsByKey[dose.key], now)
    if (status === 'due' || (includeLate && status === 'late')) return { dose, status }
    if (status === 'upcoming' && !upcoming) upcoming = { dose, status }
  }
  return upcoming
}

export function minutesUntil(dose, now = new Date()) {
  return dose.timeMinutes - minutesOfDay(now)
}

export function summarizeDay(doses, recordsByKey, now = new Date()) {
  const summary = {
    total: doses.length, taken: 0, taken_late: 0, missed: 0, late: 0, due: 0, upcoming: 0,
  }
  for (const dose of doses) summary[getDoseStatus(dose, recordsByKey[dose.key], now)] += 1
  // Every dose the patient actually took, on time or late.
  summary.takenTotal = summary.taken + summary.taken_late
  return summary
}

// Day-by-day log between two date keys (inclusive), newest day first.
// Expected doses with no record on past days are reported as missed, so the
// log shows what was actually skipped, not only what the patient tapped.
// Doses that were never expected are left out, and every saved record is kept
// (see dosesForDay), so the log never invents a miss or hides a record.
// Intended for the patient's history and the doctor's patient record view.
export function buildDoseLog(prescriptions, records, fromKey, toKey, now = new Date()) {
  const recordsByKey = indexRecords(records)
  const days = []
  for (let key = toKey; key >= fromKey; key = addDays(key, -1)) {
    const doses = dosesForDay(prescriptions, recordsByKey, key).map((dose) => {
      const record = recordsByKey[dose.key] || null
      return { ...dose, record, status: getDoseStatus(dose, record, now) }
    })
    if (doses.length > 0) days.push({ date: key, doses })
  }
  return days
}

// Share of finished doses that were taken, 0-100, or null when nothing has
// finished yet. Upcoming / due / late doses are not counted either way.
export function adherencePercent(log) {
  let taken = 0
  let missed = 0
  for (const day of log) {
    for (const dose of day.doses) {
      if (dose.status === 'taken' || dose.status === 'taken_late') taken += 1
      else if (dose.status === 'missed') missed += 1
    }
  }
  const finished = taken + missed
  return finished === 0 ? null : Math.round((taken / finished) * 100)
}
