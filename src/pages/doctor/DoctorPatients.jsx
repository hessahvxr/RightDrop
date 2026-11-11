import { useEffect, useState, useCallback } from 'react'
import { UserPlus, Users, Search, Trash2, Mail, Phone, CheckCircle2, AlertCircle, X } from 'lucide-react'
import SectionHeader from '../../components/SectionHeader'
import EmptyState from '../../components/EmptyState'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'

export default function DoctorPatients() {
  const { user } = useAuth()
  const [patients, setPatients] = useState([])
  const [loading, setLoading] = useState(true)

  // Connect-patient form state
  const [code, setCode] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState(null)
  const [connectSuccess, setConnectSuccess] = useState(null)

  // Remove-patient state
  const [removingId, setRemovingId] = useState(null)

  const loadPatients = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data, error } = await supabase
      .from('doctor_patients')
      .select(`
        id,
        created_at,
        patient:profiles!doctor_patients_patient_id_fkey ( id, full_name, email, phone, patient_code )
      `)
      .eq('doctor_id', user.id)
      .order('created_at', { ascending: false })

    if (!error && data) {
      setPatients(data)
    }
    setLoading(false)
  }, [user])

  useEffect(() => {
    loadPatients()
  }, [loadPatients])

  const handleConnect = async (e) => {
    e.preventDefault()
    setConnectError(null)
    setConnectSuccess(null)

    if (!code.trim()) {
      setConnectError('أدخل رمز المريض أولاً.')
      return
    }

    setConnecting(true)
    const { data, error } = await supabase.rpc('connect_patient_by_code', {
      p_code: code.trim().toUpperCase(),
    })

    if (error) {
      const msg = error.message || ''
      if (msg.includes('only_doctors')) {
        setConnectError('هذه الميزة متاحة للأطباء فقط.')
      } else if (msg.includes('patient_not_found')) {
        setConnectError('رمز المريض غير صحيح أو غير موجود.')
      } else if (msg.includes('already_connected')) {
        setConnectError('أنت متصل بهذا المريض بالفعل.')
      } else if (msg.includes('too_many_attempts')) {
        setConnectError('محاولات خاطئة كثيرة. انتظر ساعة ثم حاول مرة أخرى، وتأكد من الرمز مع المريض.')
      } else {
        setConnectError('تعذّر الاتصال بالمريض. حاول مرة أخرى.')
      }
      setConnecting(false)
      return
    }

    if (data && data.length > 0) {
      const p = data[0]
      setConnectSuccess(`تم الاتصال بالمريض: ${p.out_full_name || p.out_email}`)
      setCode('')
      await loadPatients()
    } else {
      // The server answers a wrong code with an empty result (and counts the attempt).
      setConnectError('رمز المريض غير صحيح أو غير موجود.')
    }
    setConnecting(false)
  }

  const handleRemove = async (connectionId, patientName) => {
    if (!confirm(`هل تريد إزالة المريض "${patientName || 'غير مسمى'}" من قائمتك؟`)) return
    setRemovingId(connectionId)
    const { error } = await supabase
      .from('doctor_patients')
      .delete()
      .eq('id', connectionId)

    if (!error) {
      setPatients((prev) => prev.filter((p) => p.id !== connectionId))
    }
    setRemovingId(null)
  }

  return (
    <div>
      <SectionHeader
        title="المرضى"
        subtitle="إدارة ومتابعة المرضى المتصلين معك"
      />

      {/* Connect form */}
      <div className="card mb-6">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus size={20} className="text-primary-600" />
          <h3 className="text-lg font-semibold text-slate-800">إضافة مريض جديد</h3>
        </div>
        <p className="mb-4 text-sm text-slate-500">
          اطلب من المريض رمزه (يظهر في صفحة حسابه) ثم أدخله هنا للاتصال به.
        </p>

        <form onSubmit={handleConnect} className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <div className="relative">
              <Search size={18} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="مثال: RD-7K2M-9XQ4-HT3W"
                dir="ltr"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pr-11 pl-4 text-slate-800 outline-none transition-all focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
                style={{ textAlign: 'right' }}
              />
            </div>
          </div>
          <button type="submit" disabled={connecting} className="btn-primary sm:whitespace-nowrap disabled:opacity-60">
            {connecting ? <Spinner size={20} /> : <UserPlus size={20} />}
            <span>{connecting ? 'جارٍ الاتصال...' : 'اتصال بالمريض'}</span>
          </button>
        </form>

        {connectError && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{connectError}</span>
          </div>
        )}
        {connectSuccess && (
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-600">
            <CheckCircle2 size={16} />
            <span>{connectSuccess}</span>
            <button
              onClick={() => setConnectSuccess(null)}
              className="mr-auto shrink-0"
              aria-label="إغلاق"
            >
              <X size={16} />
            </button>
          </div>
        )}
      </div>

      {/* Patient list */}
      <div className="mb-4 flex items-center gap-2">
        <Users size={20} className="text-slate-400" />
        <h3 className="text-lg font-semibold text-slate-700">قائمة المرضى</h3>
        {patients.length > 0 && (
          <span className="rounded-full bg-primary-100 px-2.5 py-0.5 text-sm font-medium text-primary-700">
            {patients.length}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Spinner size={28} />
        </div>
      ) : patients.length === 0 ? (
        <EmptyState
          icon={Users}
          title="لا يوجد مرضى بعد"
          subtitle="استخدم النموذج أعلاه لإضافة أول مريض عبر رمزه."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {patients.map((conn) => {
            const p = conn.patient
            if (!p) return null
            return (
              <div key={conn.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-lg font-bold text-primary-600">
                      {(p.full_name || p.email || 'م').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <h4 className="truncate font-semibold text-slate-800">
                        {p.full_name || 'بدون اسم'}
                      </h4>
                      <p className="text-xs text-slate-400">
                        أُضيف في {new Date(conn.created_at).toLocaleDateString('ar-EG')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(conn.id, p.full_name)}
                    disabled={removingId === conn.id}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-500"
                    aria-label="إزالة المريض"
                  >
                    {removingId === conn.id ? <Spinner size={16} /> : <Trash2 size={16} />}
                  </button>
                </div>

                <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                  <InfoRow icon={Mail} text={p.email} />
                  {p.phone && <InfoRow icon={Phone} text={p.phone} />}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-500" dir="ltr">
                      {p.patient_code}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InfoRow({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-2 text-sm text-slate-600">
      <Icon size={15} className="shrink-0 text-slate-400" />
      <span className="truncate" dir="ltr" style={{ textAlign: 'right' }}>{text}</span>
    </div>
  )
}
