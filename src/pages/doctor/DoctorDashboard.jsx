import { useEffect, useState } from 'react'
import { Users, FileText, CalendarClock, Activity, Droplet, MessageCircle } from 'lucide-react'
import SectionHeader from '../../components/SectionHeader'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { deriveStatus, formatDate } from '../../lib/prescriptionHelpers'

export default function DoctorDashboard() {
  const { user } = useAuth()
  const [patientCount, setPatientCount] = useState(null)
  const [recentPatients, setRecentPatients] = useState([])
  const [activeRxCount, setActiveRxCount] = useState(null)
  const [recentRx, setRecentRx] = useState([])
  // Summaries patients chose to send. null = not available (e.g. feature not set up yet).
  const [reports, setReports] = useState(null)

  useEffect(() => {
    if (!user) return

    // Load connected patients (count + 5 most recent).
    supabase
      .from('doctor_patients')
      .select(`
        id, created_at,
        patient:profiles!doctor_patients_patient_id_fkey ( id, full_name, email )
      `)
      .eq('doctor_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (data) {
          setRecentPatients(data)
          setPatientCount(data.length)
        }
      })

    // Load prescriptions (count active + 5 most recent).
    supabase
      .from('prescriptions')
      .select(`
        id, medication_name, start_date, end_date, status,
        patient:profiles!prescriptions_patient_id_fkey ( full_name )
      `)
      .eq('doctor_id', user.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (data) {
          setRecentRx(data)
          setActiveRxCount(data.filter((rx) => deriveStatus(rx) === 'active').length)
        }
      })

    // Summaries that patients explicitly approved sending to this doctor.
    supabase
      .from('patient_reports')
      .select(`
        id, summary, created_at,
        patient:profiles!patient_reports_patient_id_fkey ( full_name )
      `)
      .eq('doctor_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data, error }) => {
        if (!error && data) setReports(data)
      })
  }, [user])

  const stats = [
    { label: 'إجمالي المرضى', value: patientCount === null ? '...' : String(patientCount), icon: Users, color: 'primary' },
    { label: 'الوصفات النشطة', value: activeRxCount === null ? '...' : String(activeRxCount), icon: FileText, color: 'teal' },
    { label: 'مواعيد اليوم', value: '—', icon: CalendarClock, color: 'primary' },
    { label: 'متابعات معلقة', value: '—', icon: Activity, color: 'teal' },
  ]

  return (
    <div>
      <SectionHeader
        title="لوحة التحكم"
        subtitle="نظرة عامة على نشاط العيادة"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card">
            <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-${s.color}-100 text-${s.color}-600`}>
              <s.icon size={24} />
            </div>
            <p className="text-3xl font-bold text-slate-800">{s.value}</p>
            <p className="mt-1 text-sm text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-slate-800">آخر المرضى</h3>
          {patientCount === null ? (
            <div className="flex items-center gap-2 text-slate-400">
              <Spinner size={18} />
              <span className="text-sm">جارٍ التحميل...</span>
            </div>
          ) : recentPatients.length === 0 ? (
            <p className="text-sm text-slate-400">لا يوجد مرضى متصلون بعد.</p>
          ) : (
            <ul className="space-y-3">
              {recentPatients.map((conn) => (
                <li key={conn.id} className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-sm font-bold text-primary-600">
                    {(conn.patient?.full_name || conn.patient?.email || 'م').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">
                      {conn.patient?.full_name || 'بدون اسم'}
                    </p>
                    <p className="truncate text-xs text-slate-400">{conn.patient?.email}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card">
          <h3 className="mb-4 text-lg font-semibold text-slate-800">الوصفات الأخيرة</h3>
          {recentRx.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد وصفات بعد.</p>
          ) : (
            <ul className="space-y-3">
              {recentRx.map((rx) => (
                <li key={rx.id} className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-100 text-teal-600">
                    <Droplet size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-700">{rx.medication_name}</p>
                    <p className="truncate text-xs text-slate-400">
                      {rx.patient?.full_name || 'غير مسمى'}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {reports !== null && (
        <div className="card mt-6">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
            <MessageCircle size={20} className="text-teal-600" />
            ملخصات أرسلها المرضى
          </h3>
          <p className="mb-4 mt-1 text-sm text-slate-500">
            صاغها المساعد الذكي من كلام المريض، ووافق المريض على إرسالها. ليست تقييماً طبياً، وقد لا تكون كاملة.
          </p>
          {reports.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد ملخصات بعد.</p>
          ) : (
            <ul className="space-y-3">
              {reports.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-800">{r.patient?.full_name || 'مريض'}</p>
                    <p className="text-xs text-slate-500">{formatDate(r.created_at)}</p>
                  </div>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{r.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
