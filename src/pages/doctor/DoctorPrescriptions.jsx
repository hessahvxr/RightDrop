import { useEffect, useState, useCallback } from 'react'
import {
  FilePlus, FileText, Edit2, Ban, X, CheckCircle2, AlertCircle,
  Eye, Calendar, Droplet, User, Clock, AlertCircle as AlertIcon,
} from 'lucide-react'
import SectionHeader from '../../components/SectionHeader'
import EmptyState from '../../components/EmptyState'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { toDateKey } from '../../core/dates.js'
import {
  EYE_LABELS, STATUS_LABELS, STATUS_COLORS, deriveStatus, formatDate,
} from '../../lib/prescriptionHelpers'

const EYE_OPTIONS = [
  { value: 'right', label: 'العين اليمنى' },
  { value: 'left', label: 'العين اليسرى' },
  { value: 'both', label: 'كلتا العينين' },
]

const EMPTY_FORM = {
  patient_id: '',
  medication_name: '',
  concentration: '',
  dosage: '',
  frequency_per_day: '1',
  eye: 'both',
  start_date: '', // set to the doctor's local "today" when the form opens
  end_date: '',
  instructions: '',
}

export default function DoctorPrescriptions() {
  const { user } = useAuth()
  const [patients, setPatients] = useState([])
  const [prescriptions, setPrescriptions] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState(null)

  // Dose time scheduling state
  const [showScheduleModal, setShowScheduleModal] = useState(false)
  const [scheduleRx, setScheduleRx] = useState(null)
  const [doseTimes, setDoseTimes] = useState([])
  const [doseTimeError, setDoseTimeError] = useState(null)
  const [savingTimes, setSavingTimes] = useState(false)

  // Load connected patients (for the dropdown).
  const loadPatients = useCallback(async () => {
    if (!user) return
    const { data } = await supabase
      .from('doctor_patients')
      .select('patient:profiles!doctor_patients_patient_id_fkey ( id, full_name, email )')
      .eq('doctor_id', user.id)
      .order('created_at', { ascending: false })
    if (data) {
      setPatients(data.map((d) => d.patient).filter(Boolean))
    }
  }, [user])

  // Load prescriptions created by this doctor, with patient info + dose times.
  const loadPrescriptions = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('prescriptions')
      .select(`
        id, medication_name, concentration, dosage, frequency_per_day,
        eye, start_date, end_date, instructions, status, created_at,
        patient:profiles!prescriptions_patient_id_fkey ( id, full_name ),
        dose_times:prescription_dose_times ( id, dose_time, sort_order )
      `)
      .eq('doctor_id', user.id)
      .order('created_at', { ascending: false })
    if (data) setPrescriptions(data)
    setLoading(false)
  }, [user])

  useEffect(() => {
    loadPatients()
    loadPrescriptions()
  }, [loadPatients, loadPrescriptions])

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, start_date: toDateKey() })
    setEditingId(null)
    setErrors({})
    setSubmitError(null)
    setShowForm(true)
  }

  const openEdit = (rx) => {
    setForm({
      patient_id: rx.patient_id || rx.patient?.id || '',
      medication_name: rx.medication_name || '',
      concentration: rx.concentration || '',
      dosage: rx.dosage || '',
      frequency_per_day: String(rx.frequency_per_day || '1'),
      eye: rx.eye || 'both',
      start_date: rx.start_date || '',
      end_date: rx.end_date || '',
      instructions: rx.instructions || '',
    })
    setEditingId(rx.id)
    setErrors({})
    setSubmitError(null)
    setShowForm(true)
  }

  const validate = () => {
    const e = {}
    if (!form.patient_id) e.patient_id = 'اختر المريض.'
    if (!form.medication_name.trim()) e.medication_name = 'اسم الدواء مطلوب.'
    if (!form.dosage.trim()) e.dosage = 'الجرعة مطلوبة.'
    const freq = parseInt(form.frequency_per_day, 10)
    if (!freq || freq < 1 || freq > 24) e.frequency_per_day = 'عدد المرات يجب أن يكون بين 1 و 24.'
    if (!form.eye) e.eye = 'اختر العين.'
    if (!form.start_date) e.start_date = 'تاريخ البداية مطلوب.'
    if (!form.end_date) e.end_date = 'تاريخ النهاية مطلوب.'
    if (form.start_date && form.end_date && form.end_date < form.start_date) {
      e.end_date = 'تاريخ النهاية يجب أن يكون بعد تاريخ البداية.'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError(null)
    if (!validate()) return

    setSaving(true)
    const payload = {
      doctor_id: user.id,
      patient_id: form.patient_id,
      medication_name: form.medication_name.trim(),
      concentration: form.concentration.trim() || null,
      dosage: form.dosage.trim(),
      frequency_per_day: parseInt(form.frequency_per_day, 10),
      eye: form.eye,
      start_date: form.start_date,
      end_date: form.end_date,
      instructions: form.instructions.trim() || null,
    }

    let error
    if (editingId) {
      ({ error } = await supabase
        .from('prescriptions')
        .update(payload)
        .eq('id', editingId))
    } else {
      ({ error } = await supabase
        .from('prescriptions')
        .insert(payload))
    }

    setSaving(false)
    if (error) {
      setSubmitError('تعذّر حفظ الوصفة. تأكد من أن المريض متصل بك.')
      return
    }

    setShowForm(false)
    setSuccessMsg(editingId ? 'تم تحديث الوصفة بنجاح.' : 'تم إنشاء الوصفة بنجاح.')
    setTimeout(() => setSuccessMsg(null), 3000)
    await loadPrescriptions()
  }

  const handleDiscontinue = async (rx) => {
    if (!confirm(`هل تريد إيقاف وصفة "${rx.medication_name}"؟`)) return
    const { error } = await supabase
      .from('prescriptions')
      .update({ status: 'discontinued' })
      .eq('id', rx.id)
    if (!error) {
      setSuccessMsg('تم إيقاف الوصفة.')
      setTimeout(() => setSuccessMsg(null), 3000)
      await loadPrescriptions()
    }
  }

  // --- Dose time scheduling ---
  const openSchedule = (rx) => {
    setScheduleRx(rx)
    const existing = (rx.dose_times || []).sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    const times = []
    for (let i = 0; i < rx.frequency_per_day; i++) {
      times.push(existing[i]?.dose_time || '08:00')
    }
    setDoseTimes(times)
    setDoseTimeError(null)
    setShowScheduleModal(true)
  }

  const handleDoseTimeChange = (idx, value) => {
    setDoseTimes((prev) => prev.map((t, i) => (i === idx ? value : t)))
  }

  const handleSaveDoseTimes = async () => {
    if (!scheduleRx) return
    // Validate all times are filled
    if (doseTimes.some((t) => !t)) {
      setDoseTimeError('يرجى تحديد جميع المواعيد.')
      return
    }
    if (doseTimes.length !== scheduleRx.frequency_per_day) {
      setDoseTimeError(`عدد المواعيد يجب أن يساوي ${scheduleRx.frequency_per_day}.`)
      return
    }

    setSavingTimes(true)
    // Delete existing times, then insert new ones.
    const { error: delError } = await supabase
      .from('prescription_dose_times')
      .delete()
      .eq('prescription_id', scheduleRx.id)

    if (delError) {
      setDoseTimeError('تعذّر حفظ المواعيد.')
      setSavingTimes(false)
      return
    }

    const rows = doseTimes.map((time, idx) => ({
      prescription_id: scheduleRx.id,
      dose_time: time,
      sort_order: idx,
    }))

    const { error: insError } = await supabase
      .from('prescription_dose_times')
      .insert(rows)

    setSavingTimes(false)
    if (insError) {
      setDoseTimeError('تعذّر حفظ المواعيد.')
      return
    }

    setShowScheduleModal(false)
    setSuccessMsg('تم حفظ مواعيد الجرعات بنجاح.')
    setTimeout(() => setSuccessMsg(null), 3000)
    await loadPrescriptions()
  }

  return (
    <div>
      <SectionHeader
        title="الوصفات الطبية"
        subtitle="إنشاء وإدارة وصفات قطرات العين"
        action={
          <button onClick={openCreate} className="btn-primary" disabled={patients.length === 0}>
            <FilePlus size={20} />
            <span>وصفة جديدة</span>
          </button>
        }
      />

      {patients.length === 0 && (
        <div className="mb-6 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          <AlertIcon size={16} />
          <span>يجب إضافة مريض أولاً من قسم "المرضى" قبل إنشاء وصفة.</span>
        </div>
      )}

      {successMsg && (
        <div className="mb-6 flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-600">
          <CheckCircle2 size={16} />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Prescription list */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Spinner size={28} />
        </div>
      ) : prescriptions.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="لا توجد وصفات بعد"
          subtitle="أنشئ أول وصفة طبية لمرضاك المتصلين."
        />
      ) : (
        <div className="space-y-4">
          {prescriptions.map((rx) => {
            const status = deriveStatus(rx)
            const hasSchedule = rx.dose_times && rx.dose_times.length > 0
            return (
              <div key={rx.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-600">
                      <Droplet size={22} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-semibold text-slate-800">{rx.medication_name}</h4>
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}>
                          {STATUS_LABELS[status]}
                        </span>
                      </div>
                      <p className="mt-0.5 text-sm text-slate-500">
                        المريض: {rx.patient?.full_name || 'غير مسمى'}
                      </p>
                    </div>
                  </div>

                  {status !== 'discontinued' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => openSchedule(rx)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                          hasSchedule
                            ? 'border-teal-200 text-teal-600 hover:bg-teal-50'
                            : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
                        }`}
                      >
                        <Clock size={15} />
                        <span>{hasSchedule ? 'تعديل المواعيد' : 'تحديد المواعيد'}</span>
                      </button>
                      <button
                        onClick={() => openEdit(rx)}
                        className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
                      >
                        <Edit2 size={15} />
                        <span>تعديل</span>
                      </button>
                      <button
                        onClick={() => handleDiscontinue(rx)}
                        className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-3 py-1.5 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
                      >
                        <Ban size={15} />
                        <span>إيقاف</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Schedule needs setup warning */}
                {status === 'active' && !hasSchedule && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    <AlertCircle size={15} />
                    <span>لم يتم تحديد مواعيد الجرعات بعد. اضغط "تحديد المواعيد" لضبط جدول المريض.</span>
                  </div>
                )}

                {/* Show scheduled times */}
                {hasSchedule && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-slate-400">المواعيد:</span>
                    {rx.dose_times
                      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                      .map((dt) => (
                        <span
                          key={dt.id}
                          className="rounded-lg bg-teal-50 px-2.5 py-1 font-mono text-sm text-teal-700"
                          dir="ltr"
                        >
                          {dt.dose_time.slice(0, 5)}
                        </span>
                      ))}
                  </div>
                )}

                <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="الجرعة" value={rx.dosage} />
                  <Detail label="التكرار" value={`${rx.frequency_per_day} مرات يومياً`} />
                  <Detail label="العين" value={EYE_LABELS[rx.eye]} icon={Eye} />
                  <Detail label="التركيز" value={rx.concentration || '—'} />
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
          })}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <PrescriptionFormModal
          form={form}
          setForm={setForm}
          errors={errors}
          submitError={submitError}
          saving={saving}
          editingId={editingId}
          patients={patients}
          onSubmit={handleSubmit}
          onClose={() => setShowForm(false)}
        />
      )}

      {/* Dose time schedule modal */}
      {showScheduleModal && scheduleRx && (
        <DoseTimeModal
          rx={scheduleRx}
          doseTimes={doseTimes}
          onTimeChange={handleDoseTimeChange}
          onSave={handleSaveDoseTimes}
          onClose={() => setShowScheduleModal(false)}
          error={doseTimeError}
          saving={savingTimes}
        />
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

function DoseTimeModal({ rx, doseTimes, onTimeChange, onSave, onClose, error, saving }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 py-8">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-lg font-bold text-slate-800">مواعيد الجرعات</h3>
            <p className="mt-0.5 text-sm text-slate-500">
              {rx.medication_name} — {rx.frequency_per_day} مرات يومياً
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-slate-600">
            حدد المواعيد الدقيقة لكل جرعة. يجب أن يكون عدد المواعيد مساوياً لعدد المرات اليومية.
          </p>

          {doseTimes.map((time, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-100 text-sm font-bold text-primary-600">
                {idx + 1}
              </span>
              <input
                type="time"
                value={time}
                onChange={(e) => onTimeChange(idx, e.target.value)}
                dir="ltr"
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-lg text-slate-800 outline-none transition-all focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
              />
            </div>
          ))}

          {error && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex gap-3 border-t border-slate-100 pt-4">
            <button onClick={onSave} disabled={saving} className="btn-primary disabled:opacity-60">
              {saving ? <Spinner size={20} /> : <CheckCircle2 size={20} />}
              <span>{saving ? 'جارٍ الحفظ...' : 'حفظ المواعيد'}</span>
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">
              إلغاء
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function PrescriptionFormModal({
  form, setForm, errors, submitError, saving, editingId, patients, onSubmit, onClose,
}) {
  const update = (field, value) => setForm((prev) => ({ ...prev, [field]: value }))

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <h3 className="text-lg font-bold text-slate-800">
            {editingId ? 'تعديل الوصفة' : 'وصفة جديدة'}
          </h3>
          <button
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="إغلاق"
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={onSubmit} className="space-y-4 p-5">
          {/* Patient select */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <User size={15} /> المريض
            </label>
            <select
              value={form.patient_id}
              onChange={(e) => update('patient_id', e.target.value)}
              disabled={!!editingId}
              className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-all focus:bg-white focus:ring-2 ${
                errors.patient_id ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                : 'border-slate-200 focus:border-primary-400 focus:ring-primary-100'
              } disabled:opacity-60`}
            >
              <option value="">اختر المريض...</option>
              {patients.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
            {errors.patient_id && <p className="mt-1.5 text-sm text-rose-600">{errors.patient_id}</p>}
          </div>

          {/* Medication name + concentration */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput
              label="اسم الدواء / القطرة"
              value={form.medication_name}
              onChange={(e) => update('medication_name', e.target.value)}
              placeholder="مثال: Timolol"
              error={errors.medication_name}
              required
            />
            <FormInput
              label="التركيز (اختياري)"
              value={form.concentration}
              onChange={(e) => update('concentration', e.target.value)}
              placeholder="مثال: 0.5%"
            />
          </div>

          {/* Dosage + frequency */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput
              label="الجرعة"
              value={form.dosage}
              onChange={(e) => update('dosage', e.target.value)}
              placeholder="مثال: قطرة واحدة"
              error={errors.dosage}
              required
            />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                التكرار (مرات يومياً) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                max="24"
                value={form.frequency_per_day}
                onChange={(e) => update('frequency_per_day', e.target.value)}
                className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-all focus:bg-white focus:ring-2 ${
                  errors.frequency_per_day ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
                  : 'border-slate-200 focus:border-primary-400 focus:ring-primary-100'
                }`}
              />
              {errors.frequency_per_day && <p className="mt-1.5 text-sm text-rose-600">{errors.frequency_per_day}</p>}
            </div>
          </div>

          {/* Eye selection */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              العين <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              {EYE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update('eye', opt.value)}
                  className={`rounded-xl border-2 py-2.5 text-sm font-medium transition-all ${
                    form.eye === opt.value
                      ? 'border-primary-400 bg-primary-50 text-primary-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {errors.eye && <p className="mt-1.5 text-sm text-rose-600">{errors.eye}</p>}
          </div>

          {/* Dates */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormInput
              label="تاريخ البداية"
              type="date"
              value={form.start_date}
              onChange={(e) => update('start_date', e.target.value)}
              error={errors.start_date}
              required
            />
            <FormInput
              label="تاريخ النهاية"
              type="date"
              value={form.end_date}
              onChange={(e) => update('end_date', e.target.value)}
              error={errors.end_date}
              required
            />
          </div>

          {/* Instructions */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">
              تعليمات إضافية (اختياري)
            </label>
            <textarea
              value={form.instructions}
              onChange={(e) => update('instructions', e.target.value)}
              rows={3}
              placeholder="أي تعليمات أخرى للمريض..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-all focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100"
            />
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 border-t border-slate-100 pt-4">
            <button type="submit" disabled={saving} className="btn-primary disabled:opacity-60">
              {saving ? <Spinner size={20} /> : <CheckCircle2 size={20} />}
              <span>{saving ? 'جارٍ الحفظ...' : editingId ? 'حفظ التعديلات' : 'إنشاء الوصفة'}</span>
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function FormInput({ label, value, onChange, placeholder, error, type = 'text', required }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        {label} {required && <span className="text-rose-500">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className={`w-full rounded-xl border bg-slate-50 px-4 py-3 text-slate-800 outline-none transition-all focus:bg-white focus:ring-2 ${
          error ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
          : 'border-slate-200 focus:border-primary-400 focus:ring-primary-100'
        }`}
      />
      {error && <p className="mt-1.5 text-sm text-rose-600">{error}</p>}
    </div>
  )
}
