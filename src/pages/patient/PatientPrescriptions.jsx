import { useEffect, useState } from 'react'
import { FileText, Eye, Calendar, Droplet, Clock, User } from 'lucide-react'
import EmptyState from '../../components/EmptyState'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import {
  EYE_LABELS, STATUS_LABELS, STATUS_COLORS, deriveStatus, formatDate,
} from '../../lib/prescriptionHelpers'

export default function PatientPrescriptions() {
  const { user } = useAuth()
  const [prescriptions, setPrescriptions] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    supabase
      .from('prescriptions')
      .select(`
        id, medication_name, concentration, dosage, frequency_per_day,
        eye, start_date, end_date, instructions, status, created_at,
        doctor:profiles!prescriptions_doctor_id_fkey ( id, full_name )
      `)
      .eq('patient_id', user.id)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setPrescriptions(data)
        setLoading(false)
      })
  }, [user])

  // Group by derived status for clear display.
  const active = prescriptions.filter((rx) => deriveStatus(rx) === 'active')
  const completed = prescriptions.filter((rx) => deriveStatus(rx) === 'completed')
  const discontinued = prescriptions.filter((rx) => deriveStatus(rx) === 'discontinued')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">وصفاتي الطبية</h1>
        <p className="mt-1 text-slate-500">الوصفات التي أرسلها لك طبيبك</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Spinner size={28} />
        </div>
      ) : prescriptions.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="لا توجد وصفات بعد"
          subtitle="ستظهر الوصفات الطبية هنا فور إرسالها من قبل طبيبك."
        />
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <Section title="نشطة" count={active.length}>
              {active.map((rx) => (
                <PrescriptionCard key={rx.id} rx={rx} />
              ))}
            </Section>
          )}
          {completed.length > 0 && (
            <Section title="مكتملة" count={completed.length}>
              {completed.map((rx) => (
                <PrescriptionCard key={rx.id} rx={rx} />
              ))}
            </Section>
          )}
          {discontinued.length > 0 && (
            <Section title="متوقفة" count={discontinued.length}>
              {discontinued.map((rx) => (
                <PrescriptionCard key={rx.id} rx={rx} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, count, children }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-lg font-semibold text-slate-700">{title}</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-sm font-medium text-slate-500">
          {count}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

function PrescriptionCard({ rx }) {
  const status = deriveStatus(rx)
  return (
    <div className="card">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-600">
          <Droplet size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-800">{rx.medication_name}</h3>
            {rx.concentration && (
              <span className="text-sm text-slate-400">{rx.concentration}</span>
            )}
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
              {STATUS_LABELS[status]}
            </span>
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-slate-500">
            <User size={13} />
            {rx.doctor?.full_name || 'الطبيب'}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <Detail label="الجرعة" value={rx.dosage} />
        <Detail label="التكرار" value={`${rx.frequency_per_day} مرات يومياً`} />
        <Detail label="العين" value={EYE_LABELS[rx.eye]} icon={Eye} />
        <Detail label="تاريخ البداية" value={formatDate(rx.start_date)} icon={Calendar} />
        <Detail label="تاريخ النهاية" value={formatDate(rx.end_date)} icon={Calendar} />
      </div>

      {rx.instructions && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span className="font-medium text-slate-700">تعليمات إضافية: </span>
          {rx.instructions}
        </div>
      )}
    </div>
  )
}

function Detail({ label, value, icon: Icon }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-xs text-slate-400">
        {Icon && <Icon size={12} />}
        {label}
      </span>
      <span className="text-sm font-medium text-slate-700">{value}</span>
    </div>
  )
}
