// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toDateKey, parseDateKey, addDays, timeToMinutes, formatTimeLabel, formatDurationAr, doseDateTime,
  deriveStatus, isScheduledOn, buildDosesForDate, indexRecords, getDoseStatus, canConfirm,
  pickNextDose, summarizeDay, buildDoseLog, adherencePercent, doseKey,
  planReminders, MAX_PENDING_REMINDERS,
} from '../index.js'

const at = (dateKey, hhmm) => doseDateTime(dateKey, hhmm)
const TODAY = '2026-11-10'

const timolol = {
  id: 'rx1', medication_name: 'Timolol', concentration: '0.5%', dosage: 'قطرة واحدة', eye: 'both',
  status: 'active', start_date: '2026-11-08', end_date: '2026-11-12',
  dose_times: [{ dose_time: '20:00:00', sort_order: 1 }, { dose_time: '08:00:00', sort_order: 0 }],
}
const pred = {
  id: 'rx2', medication_name: 'Prednisolone', concentration: '1%', dosage: 'قطرة واحدة', eye: 'right',
  status: 'active', start_date: '2026-11-10', end_date: '2026-11-20',
  dose_times: [{ dose_time: '08:00:00' }, { dose_time: '14:00:00' }],
}
const stopped = { ...pred, id: 'rx3', medication_name: 'Stopped', status: 'discontinued' }
const noTimes = { ...pred, id: 'rx4', medication_name: 'NoTimes', dose_times: [] }
const all = [timolol, pred, stopped, noTimes]
const rec = (rx, date, time, status) => ({ prescription_id: rx.id, scheduled_date: date, dose_time: time, status })

test('date keys are local calendar days and round-trip', () => {
  assert.equal(toDateKey(new Date(2026, 10, 10, 0, 30)), '2026-11-10')
  assert.equal(toDateKey(new Date(2026, 10, 10, 23, 59)), '2026-11-10')
  assert.equal(toDateKey(parseDateKey('2026-03-01')), '2026-03-01')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

test('time helpers', () => {
  assert.equal(timeToMinutes('08:30:00'), 510)
  assert.equal(formatTimeLabel('00:05:00'), '12:05 ص')
  assert.equal(formatTimeLabel('12:00'), '12:00 م')
  assert.equal(formatTimeLabel('20:00:00'), '8:00 م')
  assert.equal(formatDurationAr(0), 'الآن')
  assert.equal(formatDurationAr(1), 'بعد دقيقة')
  assert.equal(formatDurationAr(45), 'بعد 45 دقيقة')
  assert.equal(formatDurationAr(60), 'بعد ساعة')
  assert.equal(formatDurationAr(125), 'بعد ساعتين و5 دقائق')
  assert.equal(formatDurationAr(180), 'بعد 3 ساعات')
})

test('prescription status and active days', () => {
  assert.equal(deriveStatus(timolol, '2026-11-12'), 'active') // last day still active
  assert.equal(deriveStatus(timolol, '2026-11-13'), 'completed')
  assert.equal(deriveStatus(stopped, TODAY), 'discontinued')
  assert.equal(isScheduledOn(timolol, '2026-11-07'), false) // before start
  assert.equal(isScheduledOn(timolol, '2026-11-08'), true)
  assert.equal(isScheduledOn(timolol, '2026-11-13'), false)
  assert.equal(isScheduledOn(stopped, TODAY), false)
})

test('daily dose list: sorted, skips discontinued / unscheduled / out-of-range', () => {
  const doses = buildDosesForDate(all, TODAY)
  assert.deepEqual(doses.map((d) => `${d.medication_name}@${d.dose_time}`), [
    'Prednisolone@08:00:00', 'Timolol@08:00:00', 'Prednisolone@14:00:00', 'Timolol@20:00:00',
  ])
  assert.equal(doses[1].key, doseKey('rx1', TODAY, '08:00:00'))
  assert.equal(doses[1].eyeLabel, 'كلتا العينين')
  assert.equal(buildDosesForDate(all, '2026-11-09').length, 2) // pred not started yet
  assert.equal(buildDosesForDate(all, '2026-11-25').length, 0)
  assert.deepEqual(buildDosesForDate(null, TODAY), [])
})

test('dose status over the day', () => {
  const dose = buildDosesForDate([timolol], TODAY)[0] // 08:00
  assert.equal(getDoseStatus(dose, null, at(TODAY, '07:44')), 'upcoming')
  assert.equal(getDoseStatus(dose, null, at(TODAY, '07:45')), 'due')
  assert.equal(getDoseStatus(dose, null, at(TODAY, '08:30')), 'due')
  assert.equal(getDoseStatus(dose, null, at(TODAY, '08:31')), 'late')
  assert.equal(getDoseStatus(dose, null, at(TODAY, '23:59')), 'late') // never auto-locked the same day
  assert.equal(getDoseStatus(dose, null, at('2026-11-11', '00:01')), 'missed') // day over, nothing recorded
  assert.equal(getDoseStatus(dose, { status: 'taken' }, at(TODAY, '06:00')), 'taken')
  assert.equal(getDoseStatus(dose, { status: 'missed' }, at(TODAY, '08:00')), 'missed')
  const tomorrow = buildDosesForDate([timolol], '2026-11-11')[0]
  assert.equal(getDoseStatus(tomorrow, null, at(TODAY, '08:00')), 'upcoming')
})

test('confirming: from one hour early, late doses stay confirmable, never twice, never other days', () => {
  const dose = buildDosesForDate([timolol], TODAY)[0] // 08:00
  assert.equal(canConfirm(dose, null, at(TODAY, '06:59')), false)
  assert.equal(canConfirm(dose, null, at(TODAY, '07:00')), true)
  assert.equal(canConfirm(dose, null, at(TODAY, '15:00')), true)
  assert.equal(canConfirm(dose, { status: 'taken' }, at(TODAY, '08:00')), false)
  assert.equal(canConfirm(dose, null, at('2026-11-11', '08:00')), false)
})

test('next dose: due/late first, then next upcoming, null when the day is done', () => {
  const doses = buildDosesForDate(all, TODAY)
  let records = {}
  assert.equal(pickNextDose(doses, records, at(TODAY, '06:00')).status, 'upcoming')
  assert.equal(pickNextDose(doses, records, at(TODAY, '06:00')).dose.medication_name, 'Prednisolone')

  // 08:05: both 08:00 drops are due -> first one shown, then the second after confirming
  let next = pickNextDose(doses, records, at(TODAY, '08:05'))
  assert.deepEqual([next.dose.medication_name, next.status], ['Prednisolone', 'due'])
  records = indexRecords([rec(pred, TODAY, '08:00:00', 'taken')])
  next = pickNextDose(doses, records, at(TODAY, '08:05'))
  assert.deepEqual([next.dose.medication_name, next.status], ['Timolol', 'due'])

  // 13:50: the unconfirmed 08:00 Timolol is late and still comes first
  next = pickNextDose(doses, records, at(TODAY, '13:50'))
  assert.deepEqual([next.dose.medication_name, next.status], ['Timolol', 'late'])

  records = indexRecords([
    rec(pred, TODAY, '08:00:00', 'taken'), rec(timolol, TODAY, '08:00:00', 'taken'),
    rec(pred, TODAY, '14:00:00', 'missed'), rec(timolol, TODAY, '20:00:00', 'taken'),
  ])
  assert.equal(pickNextDose(doses, records, at(TODAY, '21:00')), null)
  assert.deepEqual(summarizeDay(doses, records, at(TODAY, '21:00')),
    { total: 4, taken: 3, taken_late: 0, missed: 1, late: 0, due: 0, upcoming: 0, takenTotal: 3 })
})

test('dose log reports unrecorded past doses as missed; adherence ignores unfinished doses', () => {
  const records = [
    rec(timolol, '2026-11-08', '08:00:00', 'taken'),
    rec(timolol, '2026-11-08', '20:00:00', 'taken'),
    rec(timolol, '2026-11-09', '08:00:00', 'taken'),
    // 2026-11-09 20:00 never recorded -> missed
    rec(timolol, TODAY, '08:00:00', 'taken'),
  ]
  const log = buildDoseLog([timolol], records, '2026-11-01', TODAY, at(TODAY, '12:00'))
  assert.deepEqual(log.map((d) => d.date), [TODAY, '2026-11-09', '2026-11-08']) // newest first, empty days dropped
  assert.deepEqual(log[1].doses.map((d) => d.status), ['taken', 'missed'])
  assert.deepEqual(log[0].doses.map((d) => d.status), ['taken', 'upcoming'])
  assert.equal(adherencePercent(log), 80) // 4 taken, 1 missed; today's 20:00 not counted
  assert.equal(adherencePercent([]), null)
})

test('reminder plan: future unrecorded doses only, soonest first, capped', () => {
  const now = at(TODAY, '09:00')
  const records = [rec(pred, TODAY, '14:00:00', 'taken')] // confirmed early -> no reminder
  const plan = planReminders(all, records, now, { daysAhead: 2 })
  assert.deepEqual(plan.map((r) => r.id), [
    doseKey('rx1', TODAY, '20:00:00'),
    doseKey('rx2', '2026-11-11', '08:00:00'), doseKey('rx1', '2026-11-11', '08:00:00'),
    doseKey('rx2', '2026-11-11', '14:00:00'), doseKey('rx1', '2026-11-11', '20:00:00'),
    doseKey('rx2', '2026-11-12', '08:00:00'), doseKey('rx1', '2026-11-12', '08:00:00'),
    doseKey('rx2', '2026-11-12', '14:00:00'), doseKey('rx1', '2026-11-12', '20:00:00'),
  ])
  assert.ok(plan.every((r) => r.fireAt > now))
  assert.equal(plan[0].fireAt.getHours(), 20)
  assert.match(plan[0].body, /Timolol 0\.5% — قطرة واحدة — كلتا العينين — 8:00 م/)
  // timolol ends on the 12th: nothing after that
  const long = planReminders([timolol], [], now, { daysAhead: 30 })
  assert.equal(long.at(-1).id, doseKey('rx1', '2026-11-12', '20:00:00'))

  const hourly = { ...pred, id: 'rxh', end_date: '2026-12-31',
    dose_times: Array.from({ length: 24 }, (_, h) => ({ dose_time: `${String(h).padStart(2, '0')}:00:00` })) }
  assert.equal(planReminders([hourly], [], now, { daysAhead: 7 }).length, MAX_PENDING_REMINDERS)
})
