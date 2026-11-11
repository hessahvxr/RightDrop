// Late-dose behaviour. Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  doseDateTime, toDateKey, dosesForDay, buildDosesForDate, indexRecords, getDoseStatus, isTakenLate,
  canConfirm, getLateDoses, pickNextDose, summarizeDay, buildDoseLog, adherencePercent, doseKey,
  wasExpected, planReminders,
  LATE_DOSE_TEXT, lateCountLabel, buildLatePrompts, deferredKeysFor, addDeferredKey, removeDeferredKey,
} from '../index.js'

const TODAY = '2026-11-10'
const TOMORROW = '2026-11-11'
const at = (dateKey, hhmm) => doseDateTime(dateKey, hhmm)
// A saved 'taken' record, confirmed at a local wall-clock time.
const taken = (rx, date, time, confirmedAt, confirmedDate = date) => ({
  prescription_id: rx.id, scheduled_date: date, dose_time: time, status: 'taken',
  taken_at: at(confirmedDate, confirmedAt).toISOString(),
})

const timolol = {
  id: 'rx1', medication_name: 'Timolol', concentration: '0.5%', dosage: 'قطرة واحدة', eye: 'both',
  status: 'active', start_date: '2026-11-08', end_date: '2026-11-20', created_at: '2026-11-08T05:00:00Z',
  dose_times: [
    { dose_time: '08:00:00', created_at: '2026-11-08T05:00:00Z' },
    { dose_time: '20:00:00', created_at: '2026-11-08T05:00:00Z' },
  ],
}
const pred = {
  id: 'rx2', medication_name: 'Prednisolone', concentration: '1%', dosage: 'قطرة واحدة', eye: 'right',
  status: 'active', start_date: '2026-11-08', end_date: '2026-11-20', created_at: '2026-11-08T05:00:00Z',
  dose_times: [
    { dose_time: '08:00:00', created_at: '2026-11-08T05:00:00Z' },
    { dose_time: '12:00:00', created_at: '2026-11-08T05:00:00Z' },
    { dose_time: '16:00:00', created_at: '2026-11-08T05:00:00Z' },
  ],
}
const dose0800 = () => dosesForDay([timolol], {}, TODAY)[0]

test('on-time: confirmed inside the due window is "taken", not "taken late"', () => {
  for (const confirmedAt of ['07:10', '07:50', '08:00', '08:30']) {
    const record = taken(timolol, TODAY, '08:00:00', confirmedAt)
    assert.equal(isTakenLate(record), false, confirmedAt)
    assert.equal(getDoseStatus(dose0800(), record, at(TODAY, '09:00')), 'taken', confirmedAt)
  }
})

test('late: after the due window an unconfirmed dose is "late" for the rest of the day and never locks', () => {
  const dose = dose0800()
  assert.equal(getDoseStatus(dose, null, at(TODAY, '08:30')), 'due')
  for (const t of ['08:31', '09:00', '13:00', '19:45', '23:59']) {
    assert.equal(getDoseStatus(dose, null, at(TODAY, t)), 'late', t)
    assert.equal(canConfirm(dose, null, at(TODAY, t)), true, `still confirmable at ${t}`)
  }
})

test('taken late: answering yes later the same day reads back as "taken_late" with the real time', () => {
  const record = taken(timolol, TODAY, '08:00:00', '15:10')
  assert.equal(record.status, 'taken') // what the database stores: no new status needed
  assert.equal(isTakenLate(record), true)
  assert.equal(getDoseStatus(dose0800(), record, at(TODAY, '15:11')), 'taken_late')
  assert.equal(new Date(record.taken_at).getHours(), 15)
  // boundary: 30 minutes after is still on time, 31 is late
  assert.equal(isTakenLate(taken(timolol, TODAY, '08:00:00', '08:30')), false)
  assert.equal(isTakenLate(taken(timolol, TODAY, '08:00:00', '08:31')), true)
  // a confirmed dose cannot be confirmed again
  assert.equal(canConfirm(dose0800(), record, at(TODAY, '16:00')), false)
  // records without a time (old data) are plain taken; 'missed' records stay missed
  assert.equal(isTakenLate({ ...record, taken_at: null }), false)
  assert.equal(getDoseStatus(dose0800(), { ...record, status: 'missed', taken_at: null }, at(TODAY, '16:00')), 'missed')
})

test('unconfirmed: answering no saves nothing, the dose stays late and recordable, and is not counted as taken', () => {
  const doses = dosesForDay([timolol], {}, TODAY)
  const now = at(TODAY, '11:00')
  const key = doseKey('rx1', TODAY, '08:00:00')

  let stored = null
  assert.deepEqual(buildLatePrompts(doses, {}, now, deferredKeysFor(stored, TODAY)), [{ dose: doses[0], deferred: false }])

  stored = addDeferredKey(stored, TODAY, key) // patient taps "لا، ما أخذتها"
  stored = addDeferredKey(stored, TODAY, key) // tapping twice changes nothing
  assert.deepEqual(stored, { date: TODAY, keys: [key] })

  const prompts = buildLatePrompts(doses, {}, now, deferredKeysFor(stored, TODAY))
  assert.equal(prompts.length, 1)
  assert.equal(prompts[0].deferred, true) // shown calmly, question not repeated
  assert.equal(getDoseStatus(doses[0], null, now), 'late') // still unconfirmed, not taken, not missed
  assert.equal(canConfirm(doses[0], null, at(TODAY, '18:00')), true) // can still record it later today
  assert.deepEqual(summarizeDay(doses, {}, now),
    { total: 2, taken: 0, taken_late: 0, missed: 0, late: 1, due: 0, upcoming: 1, takenTotal: 0 })

  // ...and if they do take it later, the yes path works as usual
  const records = indexRecords([taken(timolol, TODAY, '08:00:00', '18:00')])
  assert.deepEqual(buildLatePrompts(doses, records, at(TODAY, '18:01'), deferredKeysFor(stored, TODAY)), [])
  assert.equal(getDoseStatus(doses[0], records[key], at(TODAY, '18:01')), 'taken_late')

  // the remembered answer is for that day only
  assert.deepEqual(deferredKeysFor(stored, TOMORROW), [])
  assert.deepEqual(deferredKeysFor(null, TODAY), [])
  assert.deepEqual(deferredKeysFor({ date: TODAY, keys: 'broken' }, TODAY), [])
  assert.deepEqual(removeDeferredKey(stored, TODAY, key), { date: TODAY, keys: [] })
})

test('missed: an unconfirmed dose becomes missed only when its day is over', () => {
  const dose = dose0800()
  assert.equal(getDoseStatus(dose, null, at(TODAY, '23:59')), 'late')
  assert.equal(getDoseStatus(dose, null, at(TOMORROW, '00:00')), 'missed')
  assert.equal(canConfirm(dose, null, at(TOMORROW, '00:00')), false)
  // it is no longer asked about the next day
  assert.deepEqual(getLateDoses([dose], {}, at(TOMORROW, '09:00')), [])

  // history: yesterday's unconfirmed dose is reported as missed, taken-late counts as taken
  const records = [
    taken(timolol, '2026-11-09', '08:00:00', '08:05'),
    // 2026-11-09 20:00 never confirmed
    taken(timolol, TODAY, '08:00:00', '14:00'),
  ]
  const log = buildDoseLog([timolol], records, '2026-11-09', TODAY, at(TODAY, '15:00'))
  assert.deepEqual(log.map((d) => [d.date, d.doses.map((x) => x.status)]), [
    [TODAY, ['taken_late', 'upcoming']],
    ['2026-11-09', ['taken', 'missed']],
  ])
  assert.equal(adherencePercent(log), 67) // 2 taken (one of them late), 1 missed
})

test('multiple late doses: all listed, earliest first, each answered separately', () => {
  const now = at(TODAY, '17:00')
  let records = {}
  const doses = dosesForDay([timolol, pred], records, TODAY)
  // late: pred 08:00, timolol 08:00, pred 12:00, pred 16:00 (16:00 + 30 < 17:00)
  let late = getLateDoses(doses, records, now)
  assert.deepEqual(late.map((d) => `${d.timeLabel} ${d.medication_name}`), [
    '8:00 ص Prednisolone', '8:00 ص Timolol', '12:00 م Prednisolone', '4:00 م Prednisolone',
  ])
  assert.equal(lateCountLabel(late.length), '4 قطرات متأخرة')

  // yes to the first, no to the second, third and fourth untouched
  records = indexRecords([taken(pred, TODAY, '08:00:00', '17:00')])
  const stored = addDeferredKey(null, TODAY, doseKey('rx1', TODAY, '08:00:00'))
  const prompts = buildLatePrompts(doses, records, at(TODAY, '17:01'), deferredKeysFor(stored, TODAY))
  assert.deepEqual(prompts.map((p) => [p.dose.timeLabel, p.dose.medication_name, p.deferred]), [
    ['8:00 ص', 'Timolol', true],
    ['12:00 م', 'Prednisolone', false],
    ['4:00 م', 'Prednisolone', false],
  ])

  // the "next dose" card below the late section skips late doses
  const next = pickNextDose(doses, records, at(TODAY, '17:01'), { includeLate: false })
  assert.deepEqual([next.dose.medication_name, next.dose.timeLabel, next.status], ['Timolol', '8:00 م', 'upcoming'])
  // a dose that is due right now is not "late" and goes to the next-dose card instead
  const due = pickNextDose(doses, {}, at(TODAY, '12:10'), { includeLate: false })
  assert.deepEqual([due.dose.timeLabel, due.status], ['12:00 م', 'due'])
  assert.deepEqual(getLateDoses(doses, {}, at(TODAY, '12:10')).map((d) => d.timeLabel), ['8:00 ص', '8:00 ص'])

  assert.equal(lateCountLabel(1), 'قطرة متأخرة')
  assert.equal(lateCountLabel(2), 'قطرتان متأخرتان')
  assert.equal(lateCountLabel(11), '11 قطرة متأخرة')
})

test('a dose whose time passed before the doctor created the schedule is never late or missed', () => {
  // prescription written today at 15:00 local with 08:00 and 20:00 dose times
  const createdAt = at(TODAY, '15:00').toISOString()
  const fresh = { ...timolol, id: 'rx9', start_date: TODAY, created_at: createdAt,
    dose_times: timolol.dose_times.map((t) => ({ ...t, created_at: createdAt })) }
  assert.equal(wasExpected(buildDosesForDate([fresh], TODAY)[0]), false)
  const doses = dosesForDay([fresh], {}, TODAY)
  assert.deepEqual(doses.map((d) => d.timeLabel), ['8:00 م']) // 08:00 today is not expected
  assert.deepEqual(getLateDoses(doses, {}, at(TODAY, '15:30')), [])
  assert.equal(dosesForDay([fresh], {}, TOMORROW).length, 2) // from tomorrow both apply
  const log = buildDoseLog([fresh], [], '2026-11-01', TOMORROW, at(TOMORROW, '23:00'))
  assert.deepEqual(log.find((d) => d.date === TODAY).doses.map((d) => [d.timeLabel, d.status]), [['8:00 م', 'missed']])
  // reminders are about the future and are unaffected
  assert.equal(planReminders([fresh], [], at(TODAY, '15:30'), { daysAhead: 1 }).length, 3)
})

test('saved records are never dropped when the doctor later changes times or stops the prescription', () => {
  const record = taken(timolol, TODAY, '08:00:00', '08:05')
  const records = indexRecords([record])
  // doctor moves 08:00 -> 09:00 at 10:00 today
  const changedAt = at(TODAY, '10:00').toISOString()
  const changed = { ...timolol, dose_times: [
    { dose_time: '09:00:00', created_at: changedAt }, { dose_time: '20:00:00', created_at: changedAt },
  ] }
  let doses = dosesForDay([changed], records, TODAY)
  assert.deepEqual(doses.map((d) => [d.timeLabel, getDoseStatus(d, records[d.key], at(TODAY, '11:00'))]), [
    ['8:00 ص', 'taken'],  // the dose already taken is kept
    ['8:00 م', 'upcoming'], // new 09:00 slot had passed before the change: not asked about
  ])
  assert.equal(doses[0].medication_name, 'Timolol')
  // doctor discontinues the prescription
  doses = dosesForDay([{ ...timolol, status: 'discontinued' }], records, TODAY)
  assert.deepEqual(doses.map((d) => d.timeLabel), ['8:00 ص'])
  assert.deepEqual(getLateDoses(doses, records, at(TODAY, '23:00')), [])
})

test('wording: the late prompt asks, and never advises taking, skipping or doubling', () => {
  assert.equal(LATE_DOSE_TEXT.title, 'قطرتك تأخرت')
  assert.equal(LATE_DOSE_TEXT.question, 'هل أخذت القطرة؟')
  assert.equal(LATE_DOSE_TEXT.yes, 'نعم، أخذتها')
  assert.equal(LATE_DOSE_TEXT.no, 'لا، ما أخذتها')
  assert.match(LATE_DOSE_TEXT.unsure, /تعليمات طبيبك/)
  const everything = Object.values(LATE_DOSE_TEXT).join(' ')
  for (const advice of ['خذها', 'خذ القطرة', 'لا تأخذ', 'تجاوز', 'تخطَّ', 'ضاعف', 'جرعتين', 'قطرتين']) {
    assert.equal(everything.includes(advice), false, `must not contain "${advice}"`)
  }
})

test('date key sanity for this file', () => {
  assert.equal(toDateKey(at(TODAY, '23:59')), TODAY)
})
