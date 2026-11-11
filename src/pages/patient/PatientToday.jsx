import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import {
  Droplet, Eye, CheckCircle2, Clock, Bell, BellOff, AlertCircle, X, RefreshCw, MessageCircle, ArrowLeft,
} from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { loadDeferred, saveDeferred } from '../../lib/deferredDoses'
import { useNotifications } from '../../hooks/useNotifications'
import {
  toDateKey, formatTimeLabel, formatDurationAr, dosesForDay, indexRecords, getDoseStatus,
  canConfirm, pickNextDose, minutesUntil, summarizeDay,
  LATE_DOSE_TEXT, lateCountLabel, buildLatePrompts, deferredKeysFor, addDeferredKey, ASSISTANT_TEXT,
} from '../../core'

const DOSE_STATUS = {
  upcoming: { label: 'قادمة', color: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  due: { label: 'حان الوقت', color: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  late: { label: 'متأخرة', color: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
  taken: { label: 'تم الأخذ', color: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  taken_late: { label: 'أُخذت متأخرة', color: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  missed: { label: 'فائتة', color: 'bg-rose-100 text-rose-800', dot: 'bg-rose-500' },
}

// Timestamp -> '8:05 ص', in the same style as the schedule times.
function clockLabel(isoString) {
  const d = new Date(isoString)
  return formatTimeLabel(`${d.getHours()}:${d.getMinutes()}`)
}

function medicationTitle(dose) {
  return dose.concentration ? `${dose.medication_name} ${dose.concentration}` : dose.medication_name
}

export default function PatientToday() {
  const { user } = useAuth()
  const [prescriptions, setPrescriptions] = useState([])
  const [records, setRecords] = useState({})
  const [loadedDay, setLoadedDay] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [actionLoading, setActionLoading] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [now, setNow] = useState(() => new Date())
  // "لا، ما أخذتها" answers for today, remembered on this device only.
  const [deferred, setDeferred] = useState(null)
  // Doses with a save in progress: blocks a second tap before React re-renders.
  const savingRef = useRef(new Set())
  const {
    permission, requestPermission, checkDueDoses, inAppReminder, dismissInAppReminder,
  } = useNotifications()

  // Load the prescriptions (with the doctor's dose times) and the records
  // already saved for today. Dose statuses are then worked out from the
  // current local date and time.
  const loadDoses = useCallback(async ({ silent = false } = {}) => {
    if (!user) return
    if (!silent) setLoading(true)
    const today = toDateKey()

    const [rxRes, recRes] = await Promise.all([
      supabase
        .from('prescriptions')
        .select(`
          id, medication_name, concentration, dosage, eye, frequency_per_day,
          start_date, end_date, status, created_at,
          dose_times:prescription_dose_times ( id, dose_time, sort_order, created_at )
        `)
        .eq('patient_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('dose_records')
        .select('id, prescription_id, dose_time, scheduled_date, status, taken_at')
        .eq('patient_id', user.id)
        .eq('scheduled_date', today),
    ])

    if (rxRes.error || recRes.error || !rxRes.data) {
      // Never show "no medications today" when the truth is "could not load".
      // On a background refresh keep what is already on screen.
      if (!silent) setLoadError(true)
      setLoading(false)
      return
    }

    setPrescriptions(rxRes.data)
    setRecords(indexRecords(recRes.data))
    setLoadedDay(today)
    setDeferred(loadDeferred(user.id))
    setNow(new Date())
    setLoadError(false)
    setLoading(false)
  }, [user])

  // 1) When the screen opens.
  useEffect(() => {
    loadDoses()
  }, [loadDoses])

  // 2) Keep the clock fresh every 30 seconds (a dose turns late on its own).
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(interval)
  }, [])

  // 3) When the patient returns to the app: tab or app back in the foreground,
  //    page restored from the back/forward cache, or the connection comes back.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      setNow(new Date())
      loadDoses({ silent: true })
    }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    window.addEventListener('online', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('online', refresh)
    }
  }, [loadDoses])

  // 4) When the calendar day changes while the screen is open.
  useEffect(() => {
    if (loadedDay && loadedDay !== toDateKey(now)) loadDoses({ silent: true })
  }, [now, loadedDay, loadDoses])

  const doses = useMemo(
    () => (loadedDay ? dosesForDay(prescriptions, records, loadedDay) : []),
    [prescriptions, records, loadedDay]
  )

  // Fire a reminder for doses that are due and not yet recorded.
  useEffect(() => {
    const dueDoses = doses
      .filter((d) => getDoseStatus(d, records[d.key], now) === 'due')
      .map((d) => ({ ...d, medicationName: medicationTitle(d), dedupKey: d.key }))
    if (dueDoses.length > 0) checkDueDoses(dueDoses)
  }, [doses, records, now, checkDueDoses])

  // Save "taken" with the actual confirmation time. One record per dose:
  // guarded here against double taps, and by the database's unique rule.
  const handleTakeDose = async (dose) => {
    if (records[dose.key] || savingRef.current.has(dose.key)) return
    savingRef.current.add(dose.key)
    setActionLoading(dose.key)
    setActionError(null)
    const { data, error } = await supabase
      .from('dose_records')
      .insert({
        prescription_id: dose.prescription_id,
        patient_id: user.id,
        dose_time: dose.dose_time,
        scheduled_date: dose.scheduled_date,
        status: 'taken',
        taken_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (!error && data) {
      setRecords((prev) => ({ ...prev, [dose.key]: data }))
    } else if (error?.code === '23505') {
      // Already recorded (e.g. from another device): just show the saved state.
      await loadDoses({ silent: true })
    } else {
      setActionError('لم يتم تسجيل القطرة. تأكد من اتصال الإنترنت ثم اضغط مرة أخرى.')
    }
    savingRef.current.delete(dose.key)
    setActionLoading(null)
  }

  // "لا، ما أخذتها": nothing is saved to the database. The dose stays
  // unconfirmed and can still be recorded later today.
  const handleNotTaken = (dose) => {
    const next = addDeferredKey(deferred, toDateKey(now), dose.key)
    setDeferred(next)
    saveDeferred(user.id, next)
  }

  const summary = summarizeDay(doses, records, now)
  const latePrompts = buildLatePrompts(doses, records, now, deferredKeysFor(deferred, toDateKey(now)))
  const next = pickNextDose(doses, records, now, { includeLate: false })
  const showNotifPrompt = permission === 'default'
  const notifDenied = permission === 'denied'
  const notifUnsupported = permission === 'unsupported'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500">
        <Spinner size={36} />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-3xl border-2 border-rose-200 bg-rose-50 p-6 text-center">
        <AlertCircle size={44} className="mx-auto text-rose-600" />
        <h1 className="mt-3 text-2xl font-bold text-slate-900">تعذّر تحميل أدوية اليوم</h1>
        <p className="mt-2 text-lg text-slate-700">تأكد من اتصال الإنترنت ثم حاول مرة أخرى.</p>
        <button
          onClick={() => loadDoses()}
          className="mt-5 flex w-full items-center justify-center gap-3 rounded-2xl bg-primary-700 py-5 text-xl font-bold text-white active:scale-[0.98]"
        >
          <RefreshCw size={26} />
          <span>إعادة المحاولة</span>
        </button>
      </div>
    )
  }

  if (summary.total === 0) {
    return (
      <div>
        <h1 className="mb-6 text-3xl font-bold text-slate-900">أدوية اليوم</h1>
        <EmptyState
          icon={Clock}
          title="لا توجد أدوية لليوم"
          subtitle="ستظهر قطرات العين ومواعيدها هنا بمجرد إضافتها من قبل طبيبك."
        />
        <div className="mt-6">
          <AssistantCard />
        </div>
      </div>
    )
  }

  return (
    <div>
      {actionError && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-2xl border-2 border-rose-300 bg-rose-50 p-4 text-lg font-medium text-rose-800">
          <AlertCircle size={26} className="mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Late doses come first, before anything else on the screen. */}
      {latePrompts.length > 0 && (
        <section className="mb-6" aria-label={lateCountLabel(latePrompts.length)}>
          {latePrompts.length > 1 && (
            <h2 className="mb-3 flex items-center gap-2 text-2xl font-bold text-orange-900">
              <AlertCircle size={28} />
              {`لديك ${lateCountLabel(latePrompts.length)}`}
            </h2>
          )}
          <div className="space-y-5">
            {latePrompts.map(({ dose, deferred: answeredNo }, index) => (
              <LateDoseCard
                key={dose.key}
                dose={dose}
                answeredNo={answeredNo}
                position={latePrompts.length > 1 ? `${index + 1} من ${latePrompts.length}` : null}
                compact={latePrompts.length > 1}
                busy={actionLoading === dose.key}
                disabled={!!actionLoading}
                onYes={handleTakeDose}
                onNo={handleNotTaken}
              />
            ))}
          </div>
          {latePrompts.length > 1 && (
            <p className="mt-4 text-lg font-medium text-slate-800">{LATE_DOSE_TEXT.unsure}</p>
          )}
        </section>
      )}

      {/* Then the next dose that is due now or coming up. */}
      <NextDoseCard
        next={next}
        summary={summary}
        now={now}
        hasLate={latePrompts.length > 0}
        canConfirmNext={next ? canConfirm(next.dose, records[next.dose.key], now) : false}
        busy={next ? actionLoading === next.dose.key : false}
        disabled={!!actionLoading}
        onTake={handleTakeDose}
      />

      {/* The way into "مساعدك الذكي": one large card, right after the doses. */}
      <AssistantCard />

      {/* In-app reminder banner */}
      {inAppReminder && (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white">
            <Bell size={24} />
          </div>
          <div className="flex-1">
            <p className="text-lg font-bold text-amber-950">{inAppReminder.title}</p>
            <p className="text-base text-amber-900">{inAppReminder.body}</p>
          </div>
          <button
            onClick={dismissInAppReminder}
            aria-label="إغلاق التذكير"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-amber-800 hover:bg-amber-100"
          >
            <X size={24} />
          </button>
        </div>
      )}

      {/* Progress */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between text-lg font-bold text-slate-800">
          <span>أخذت اليوم</span>
          <span>{summary.takenTotal} من {summary.total}</span>
        </div>
        <div className="mt-3 h-4 overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div
            className="h-full rounded-full bg-emerald-600 transition-all"
            style={{ width: `${(summary.takenTotal / summary.total) * 100}%` }}
          />
        </div>
      </div>

      {/* Notification permission prompt */}
      {showNotifPrompt && (
        <div className="mb-6 rounded-2xl border-2 border-teal-200 bg-teal-50 p-4">
          <div className="flex items-start gap-3">
            <Bell size={28} className="mt-1 shrink-0 text-teal-700" />
            <div>
              <p className="text-lg font-bold text-teal-900">تفعيل التذكيرات</p>
              <p className="mt-1 text-base text-teal-800">
                يرسل لك التطبيق تذكيراً عند موعد قطرة العين حتى لا تنساها.
              </p>
            </div>
          </div>
          <button
            onClick={requestPermission}
            className="mt-3 w-full rounded-xl bg-teal-700 py-3.5 text-lg font-bold text-white transition-colors hover:bg-teal-800"
          >
            السماح بالتذكيرات
          </button>
        </div>
      )}

      {/* Full list for today */}
      <h2 className="mb-3 text-xl font-bold text-slate-900">جدول اليوم</h2>
      <div className="space-y-3">
        {doses.map((dose) => {
          const record = records[dose.key]
          const status = getDoseStatus(dose, record, now)
          const config = DOSE_STATUS[status]
          const isNext = next?.dose.key === dose.key
          // Late doses are answered in the section at the top; the next due
          // dose has its big button above. Any other due dose is confirmed here.
          const showButton = status === 'due' && !isNext

          return (
            <div
              key={dose.key}
              className={`rounded-2xl border-2 bg-white p-4 ${
                status === 'due' || status === 'late' ? 'border-amber-300' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className={`h-4 w-4 shrink-0 rounded-full ${config.dot}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-xl font-bold text-slate-900">{dose.timeLabel}</p>
                    <p className="text-lg font-semibold text-slate-800">{medicationTitle(dose)}</p>
                    <p className="flex items-center gap-1.5 text-base text-slate-600">
                      <Eye size={18} />
                      {[dose.eyeLabel, dose.dosage].filter(Boolean).join(' — ')}
                    </p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-3 py-1.5 text-base font-bold ${config.color}`}>
                  {config.label}
                </span>
              </div>

              {record?.status === 'taken' && record.taken_at && (
                <p className="mt-3 flex items-center gap-2 text-base font-medium text-emerald-800">
                  <CheckCircle2 size={20} />
                  أخذتها الساعة {clockLabel(record.taken_at)}
                </p>
              )}

              {showButton && (
                <button
                  onClick={() => handleTakeDose(dose)}
                  disabled={!!actionLoading}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 py-4 text-lg font-bold text-white transition-colors hover:bg-emerald-800 active:scale-[0.98] disabled:opacity-60"
                >
                  {actionLoading === dose.key ? <Spinner size={24} /> : <CheckCircle2 size={24} />}
                  <span>أخذت القطرة</span>
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Notification status info */}
      {(notifDenied || notifUnsupported) && (
        <div className="mt-6 flex items-center gap-2 rounded-xl bg-slate-100 px-4 py-3 text-base text-slate-700">
          <BellOff size={20} className="shrink-0" />
          <span>
            {notifUnsupported
              ? 'المتصفح لا يدعم الإشعارات. ستظهر التذكيرات داخل التطبيق فقط.'
              : 'تم رفض إشعارات المتصفح. ستظهر التذكيرات داخل التطبيق فقط.'}
          </span>
        </div>
      )}
    </div>
  )
}

// Entry to the AI patient assistant. A card on this page instead of a sixth
// item in the bottom navigation, to keep the navigation simple.
function AssistantCard() {
  return (
    <Link
      to="/patient/assistant"
      className="mb-6 flex min-h-[96px] items-center gap-4 rounded-3xl border-2 border-teal-600 bg-teal-50 p-4 transition-colors hover:bg-teal-100 active:scale-[0.99]"
    >
      <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-teal-700 text-white">
        <MessageCircle size={36} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-2xl font-bold text-slate-900">{ASSISTANT_TEXT.title}</span>
        <span className="block text-lg text-slate-800">{ASSISTANT_TEXT.cardSubtitle}</span>
      </span>
      <ArrowLeft size={30} className="shrink-0 text-teal-800" aria-hidden="true" />
    </Link>
  )
}

// One late, unconfirmed dose. Before an answer it asks "هل أخذت القطرة؟" with
// two large buttons. After "لا، ما أخذتها" it becomes a quiet card that still
// lets the patient record the dose later the same day.
// It only ever asks and records: it never says to take, skip or double a dose.
// `compact` (several late doses at once) tightens the layout so the list stays short.
function LateDoseCard({ dose, answeredNo, position, compact, busy, disabled, onYes, onNo }) {
  const details = (
    <>
      <h3 className={`font-bold leading-tight text-slate-900 ${answeredNo ? 'text-2xl' : compact ? 'mt-2 text-3xl' : 'mt-3 text-4xl'}`}>
        {dose.medication_name}
        {dose.concentration && (
          <span className="text-2xl font-semibold text-slate-700"> {dose.concentration}</span>
        )}
      </h3>
      <p className={`flex items-center gap-3 font-semibold text-slate-900 ${answeredNo ? 'mt-1 text-xl' : 'mt-2 text-2xl'}`}>
        <Eye size={answeredNo ? 24 : 28} className="shrink-0 text-slate-600" />
        <span>{dose.eyeLabel}</span>
      </p>
    </>
  )

  if (answeredNo) {
    return (
      <article className="rounded-3xl border-2 border-slate-300 bg-white p-5">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-bold text-slate-800">
          <Clock size={24} className="shrink-0" />
          <span>{dose.timeLabel}</span>
          <span className="rounded-full bg-orange-100 px-3 py-1 text-base text-orange-800">
            {LATE_DOSE_TEXT.notRecorded}
          </span>
        </p>
        <div className="mt-2">{details}</div>
        <p className="mt-3 text-lg text-slate-700">{LATE_DOSE_TEXT.recordLater}</p>
        <button
          onClick={() => onYes(dose)}
          disabled={disabled}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-emerald-700 bg-white py-4 text-xl font-bold text-emerald-800 transition-colors hover:bg-emerald-50 active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? <Spinner size={26} /> : <CheckCircle2 size={26} />}
          <span>{LATE_DOSE_TEXT.recordNow}</span>
        </button>
        {!compact && <p className="mt-3 text-base text-slate-700">{LATE_DOSE_TEXT.unsure}</p>}
      </article>
    )
  }

  return (
    <article className="rounded-3xl border-4 border-orange-500 bg-orange-50 p-5 shadow-lg" role="group" aria-label={`${LATE_DOSE_TEXT.title}: ${dose.medication_name} ${dose.timeLabel}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`flex items-center gap-2 whitespace-nowrap font-bold text-orange-900 ${compact ? 'text-2xl' : 'text-3xl'}`}>
          <AlertCircle size={compact ? 28 : 34} className="shrink-0" />
          {LATE_DOSE_TEXT.title}
        </p>
        {position && (
          <span className="shrink-0 rounded-full bg-white px-3 py-1 text-base font-bold text-orange-900">{position}</span>
        )}
      </div>

      <p className="mt-3 flex items-center gap-3 text-2xl font-semibold text-slate-900">
        <Clock size={28} className="shrink-0 text-slate-600" />
        <span>{LATE_DOSE_TEXT.scheduledAt} {dose.timeLabel}</span>
      </p>

      {details}

      <p className={`font-bold text-slate-900 ${compact ? 'mt-4 text-2xl' : 'mt-5 text-3xl'}`}>{LATE_DOSE_TEXT.question}</p>
      <div className={`mt-3 grid gap-3 ${compact ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <button
          onClick={() => onYes(dose)}
          disabled={disabled}
          className={`flex min-h-[76px] w-full items-center justify-center gap-2 rounded-2xl bg-emerald-700 px-2 font-bold text-white shadow transition-colors hover:bg-emerald-800 active:scale-[0.98] disabled:opacity-60 ${compact ? 'text-xl' : 'text-2xl'}`}
        >
          {busy ? <Spinner size={28} /> : !compact && <CheckCircle2 size={28} className="shrink-0" />}
          <span className="whitespace-nowrap">{LATE_DOSE_TEXT.yes}</span>
        </button>
        <button
          onClick={() => onNo(dose)}
          disabled={disabled}
          className={`flex min-h-[76px] w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-500 bg-white px-2 font-bold text-slate-900 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60 ${compact ? 'text-xl' : 'text-2xl'}`}
        >
          {!compact && <X size={28} className="shrink-0" />}
          <span className="whitespace-nowrap">{LATE_DOSE_TEXT.no}</span>
        </button>
      </div>
      {!compact && <p className="mt-4 text-lg text-slate-800">{LATE_DOSE_TEXT.unsure}</p>}
    </article>
  )
}

// The next dose that is on time: due now (one big button), coming up later
// today, or the "all done" message. Late doses are handled by LateDoseCard.
function NextDoseCard({ next, summary, now, hasLate, canConfirmNext, busy, disabled, onTake }) {
  if (!next) {
    // With late doses still open the day is not finished: say nothing here.
    if (hasLate) return null
    const allTaken = summary.takenTotal === summary.total
    return (
      <section className="mb-6 rounded-3xl border-2 border-emerald-300 bg-emerald-50 p-6 text-center">
        <CheckCircle2 size={56} className="mx-auto text-emerald-700" />
        <h1 className="mt-3 text-3xl font-bold text-slate-900">
          {allTaken ? 'أكملت قطرات اليوم' : 'انتهت قطرات اليوم'}
        </h1>
        <p className="mt-2 text-xl text-slate-700">
          أخذت {summary.takenTotal} من {summary.total}
        </p>
      </section>
    )
  }

  const { dose, status } = next
  const isNow = status === 'due'
  const tone = isNow ? 'border-amber-400 bg-amber-50' : 'border-primary-300 bg-white'
  const heading = isNow ? 'حان وقت القطرة' : 'القطرة القادمة'
  // Below a late-dose question this card steps back so the question stays on top.
  const nameSize = hasLate ? 'text-3xl' : 'text-4xl'

  return (
    <section className={`mb-6 rounded-3xl p-5 ${hasLate ? 'border-2' : 'border-4'} ${tone}`} aria-live="polite">
      <p className="flex items-center gap-2 text-xl font-bold text-slate-800">
        <Clock size={24} />
        {heading}
      </p>

      <h1 className={`mt-3 font-bold leading-tight text-slate-900 ${nameSize}`}>{dose.medication_name}</h1>
      {dose.concentration && (
        <p className="mt-1 text-2xl font-semibold text-slate-700" dir="ltr" style={{ textAlign: 'right' }}>
          {dose.concentration}
        </p>
      )}

      <div className="mt-4 space-y-2 text-2xl font-semibold text-slate-900">
        <p className="flex items-center gap-3">
          <Clock size={28} className="shrink-0 text-slate-600" />
          <span>
            {dose.timeLabel}
            {!isNow && (
              <span className="block text-xl font-medium text-slate-700">
                {formatDurationAr(minutesUntil(dose, now))}
              </span>
            )}
          </span>
        </p>
        <p className="flex items-center gap-3">
          <Eye size={28} className="shrink-0 text-slate-600" />
          <span>{dose.eyeLabel}</span>
        </p>
        <p className="flex items-center gap-3">
          <Droplet size={28} className="shrink-0 text-slate-600" />
          <span>{dose.dosage}</span>
        </p>
      </div>

      {canConfirmNext && (
        <button
          onClick={() => onTake(dose)}
          disabled={disabled}
          className={`mt-5 flex w-full items-center justify-center gap-3 rounded-2xl py-6 text-2xl font-bold transition-colors active:scale-[0.98] disabled:opacity-60 ${
            isNow
              ? 'bg-emerald-700 text-white shadow-lg hover:bg-emerald-800'
              : 'border-2 border-emerald-700 bg-white text-emerald-800 hover:bg-emerald-50'
          }`}
        >
          {busy ? <Spinner size={32} /> : <CheckCircle2 size={34} />}
          <span>{isNow ? 'أخذت القطرة' : 'أخذتها مبكراً'}</span>
        </button>
      )}
    </section>
  )
}
