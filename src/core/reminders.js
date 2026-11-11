// Works out WHICH reminders should exist; it does not show them.
// The mobile app will hand this list to the phone's local notification
// scheduler (so reminders fire with the app closed and without internet).
// Pure JavaScript: no platform APIs here.

import { toDateKey, addDays, doseDateTime } from './dates.js'
import { buildDosesForDate, indexRecords } from './schedule.js'

// iOS keeps at most 64 pending local notifications per app; stay under it.
export const MAX_PENDING_REMINDERS = 60

export const REMINDER_TITLE = 'حان وقت قطرة العين'

export function reminderBody(dose) {
  const name = dose.concentration ? `${dose.medication_name} ${dose.concentration}` : dose.medication_name
  return `${name} — ${dose.dosage} — ${dose.eyeLabel}`
}

// Future doses that still need a reminder, soonest first.
// Doses already recorded (taken or skipped) are left out.
export function planReminders(prescriptions, records, now = new Date(), options = {}) {
  const { daysAhead = 7, limit = MAX_PENDING_REMINDERS } = options
  const recordsByKey = indexRecords(records)
  const todayKey = toDateKey(now)
  const reminders = []

  for (let i = 0; i <= daysAhead && reminders.length < limit; i++) {
    const dateKey = addDays(todayKey, i)
    for (const dose of buildDosesForDate(prescriptions, dateKey)) {
      if (recordsByKey[dose.key]) continue
      const fireAt = doseDateTime(dateKey, dose.dose_time)
      if (fireAt <= now) continue
      reminders.push({
        id: dose.key, // stable: lets the scheduler replace instead of duplicate
        fireAt,
        title: REMINDER_TITLE,
        body: `${reminderBody(dose)} — ${dose.timeLabel}`,
        doseKey: dose.key,
        prescription_id: dose.prescription_id,
      })
      if (reminders.length >= limit) break
    }
  }
  return reminders
}
