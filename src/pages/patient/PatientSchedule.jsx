import { useEffect, useState, useMemo } from 'react'
import { CalendarDays, Droplet, Eye, CheckCircle2, XCircle, Clock, History } from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { EYE_LABELS, deriveStatus, formatDate } from '../../lib/prescriptionHelpers'
import { buildDoseLog, toDateKey } from '../../core'

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

function formatTimeLabel(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  const period = h >= 12 ? 'م' : 'ص'
  const displayH = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${displayH}:${String(m).padStart(2, '0')} ${period}`
}

function dateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const WEEKDAY_LABELS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

export default function PatientSchedule() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [schedule, setSchedule] = useState([])
  const [history, setHistory] = useState([])
  const [prescriptions, setPrescriptions] = useState([])
  const [historyFrom, setHistoryFrom] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [tab, setTab] = useState('week') // 'week' or 'history'

  // Load weekly schedule: active prescriptions with dose times.
  useEffect(() => {
    if (!user) return
    supabase
      .from('prescriptions')
      .select(`
        id, medication_name, concentration, dosage, eye, start_date, end_date, status, created_at,
        dose_times:prescription_dose_times ( id, dose_time, sort_order, created_at )
      `)
      .eq('patient_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (!data) {
          setLoading(false)
          return
        }
        setPrescriptions(data)
        // Build a weekly view: for each day of the current week, list all doses.
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const weekStart = new Date(today)
        weekStart.setDate(today.getDate() - today.getDay()) // Sunday start

        const weekDays = []
        for (let i = 0; i < 7; i++) {
          const day = new Date(weekStart)
          day.setDate(weekStart.getDate() + i)
          const dayStr = dateStr(day)
          const dayDoses = []

          for (const rx of data) {
            if (deriveStatus(rx) !== 'active') continue
            if (!rx.dose_times || rx.dose_times.length === 0) continue
            const start = new Date(rx.start_date)
            start.setHours(0, 0, 0, 0)
            const end = new Date(rx.end_date)
            end.setHours(0, 0, 0, 0)
            if (day < start || day > end) continue

            for (const dt of [...rx.dose_times].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))) {
              dayDoses.push({
                key: `${rx.id}_${dayStr}_${dt.dose_time}`,
                medication_name: rx.medication_name,
                dosage: rx.dosage,
                eye: rx.eye,
                eyeLabel: EYE_LABELS[rx.eye],
                dose_time: dt.dose_time,
                timeLabel: formatTimeLabel(dt.dose_time),
                timeMinutes: timeToMinutes(dt.dose_time),
                date: dayStr,
                dateLabel: day.toLocaleDateString('ar-EG', { weekday: 'short', day: 'numeric', month: 'short' }),
              })
            }
          }

          dayDoses.sort((a, b) => a.timeMinutes - b.timeMinutes)
          weekDays.push({
            date: dayStr,
            label: WEEKDAY_LABELS[day.getDay()],
            dateLabel: day.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }),
            isToday: dayStr === dateStr(today),
            doses: dayDoses,
          })
        }
        setSchedule(weekDays)
        setLoading(false)
      })
  }, [user])

  // Load dose history (last 30 days of records).
  useEffect(() => {
    if (!user) return
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    setHistoryFrom(dateStr(thirtyDaysAgo))
    supabase
      .from('dose_records')
      .select(`
        id, prescription_id, dose_time, scheduled_date, status, taken_at, created_at,
        prescription:prescriptions ( medication_name, dosage, eye )
      `)
      .eq('patient_id', user.id)
      .gte('scheduled_date', dateStr(thirtyDaysAgo))
      .order('scheduled_date', { ascending: false })
      .order('dose_time', { ascending: false })
      .then(({ data }) => {
        if (data) setHistory(data)
        setHistoryLoading(false)
      })
  }, [user])

  // Finished doses of the last 30 days, newest first: taken, taken late, and
  // missed. A dose nobody confirmed counts as missed once its day is over,
  // even though no record was saved for it.
  const historyEntries = useMemo(() => {
    if (!historyFrom) return []
    const log = buildDoseLog(prescriptions, history, historyFrom, toDateKey())
    const entries = []
    for (const day of log) {
      for (const dose of [...day.doses].reverse()) {
        if (['taken', 'taken_late', 'missed'].includes(dose.status)) entries.push(dose)
      }
    }
    return entries
  }, [prescriptions, history, historyFrom])

  const hasScheduleData = useMemo(
    () => schedule.some((d) => d.doses.length > 0),
    [schedule]
  )

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">جدول الأدوية</h1>
        <p className="mt-1 text-slate-500">مواعيد قطرات العين وسجل الجرعات</p>
      </div>

      {/* Tab switcher */}
      <div className="mb-6 flex gap-2 rounded-xl bg-slate-100 p-1">
        <button
          onClick={() => setTab('week')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
            tab === 'week' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
          }`}
        >
          <CalendarDays size={18} />
          <span>الجدول الأسبوعي</span>
        </button>
        <button
          onClick={() => setTab('history')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
            tab === 'history' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
          }`}
        >
          <History size={18} />
          <span>سجل الجرعات</span>
        </button>
      </div>

      {/* Weekly schedule */}
      {tab === 'week' && (
        loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Spinner size={28} />
          </div>
        ) : !hasScheduleData ? (
          <EmptyState
            icon={CalendarDays}
            title="الجدول فارغ"
            subtitle="لا توجد مواعيد قطرات مرتبة لهذا الأسبوع. سيظهر الجدول بعد أن يحدد طبيبك المواعيد."
          />
        ) : (
          <div className="space-y-4">
            {schedule.map((day) => (
              <div key={day.date} className={`rounded-2xl border-2 p-4 ${
                day.isToday ? 'border-primary-300 bg-primary-50/30' : 'border-slate-100 bg-white'
              }`}>
                <div className="mb-3 flex items-center gap-2">
                  <h3 className="font-bold text-slate-800">{day.label}</h3>
                  <span className="text-sm text-slate-400">{day.dateLabel}</span>
                  {day.isToday && (
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">
                      اليوم
                    </span>
                  )}
                </div>
                {day.doses.length === 0 ? (
                  <p className="text-sm text-slate-300">لا توجد جرعات في هذا اليوم.</p>
                ) : (
                  <div className="space-y-2">
                    {day.doses.map((dose) => (
                      <div key={dose.key} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-600">
                          <Droplet size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-slate-800">{dose.medication_name}</p>
                          <p className="text-sm text-slate-500">
                            {dose.timeLabel} — {dose.dosage} — {dose.eyeLabel}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-sm text-slate-400" dir="ltr">
                          {dose.dose_time.slice(0, 5)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {/* Dose history */}
      {tab === 'history' && (
        historyLoading || loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Spinner size={28} />
          </div>
        ) : historyEntries.length === 0 ? (
          <EmptyState
            icon={History}
            title="لا يوجد سجل بعد"
            subtitle="ستظهر جرعاتك المسجلة (المأخوذة والفائتة) هنا."
          />
        ) : (
          <div className="space-y-3">
            {historyEntries.map((dose) => {
              const wasTaken = dose.status === 'taken' || dose.status === 'taken_late'
              return (
                <div key={dose.key} className="rounded-2xl border border-slate-100 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        wasTaken ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-500'
                      }`}>
                        {wasTaken ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-800">
                          {dose.medication_name}
                        </h4>
                        <p className="text-sm text-slate-500">
                          {[dose.dosage, dose.eyeLabel].filter(Boolean).join(' — ')}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
                          <span className="flex items-center gap-1">
                            <CalendarDays size={12} />
                            {formatDate(dose.scheduled_date)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock size={12} />
                            الموعد: {dose.timeLabel}
                          </span>
                          {dose.record?.taken_at && (
                            <span className="flex items-center gap-1 text-emerald-500">
                              <CheckCircle2 size={12} />
                              الأخذ الفعلي: {new Date(dose.record.taken_at).toLocaleTimeString('ar-EG', { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          )}
                          {!dose.record && <span>لم تُسجَّل</span>}
                        </div>
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      wasTaken ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
                    }`}>
                      {dose.status === 'taken' ? 'مأخوذة' : dose.status === 'taken_late' ? 'مأخوذة متأخرة' : 'فائتة'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </div>
  )
}
