import { useEffect, useState } from 'react'
import { User, Mail, Phone, Save, CheckCircle2, LogOut, Copy, Check, Hash } from 'lucide-react'
import FormField from '../../components/FormField'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'

export default function PatientProfile() {
  const { profile, updateProfile, signOut, refreshUser } = useAuth()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '')
      setPhone(profile.phone || '')
      setLoading(false)
    }
  }, [profile])

  // If the patient_code hasn't loaded yet (trigger may still be running),
  // refresh the auth context once after a short delay.
  useEffect(() => {
    if (profile && profile.role === 'patient' && !profile.patient_code) {
      const timer = setTimeout(() => refreshUser(), 1000)
      return () => clearTimeout(timer)
    }
  }, [profile, refreshUser])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    setSuccess(false)

    const { error: updateError } = await updateProfile({
      full_name: fullName.trim(),
      phone: phone.trim() || null,
    })

    setSaving(false)
    if (updateError) {
      setError('تعذّر حفظ التغييرات. حاول مرة أخرى.')
    } else {
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    }
  }

  const handleCopyCode = async () => {
    if (!profile?.patient_code) return
    try {
      await navigator.clipboard.writeText(profile.patient_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback for browsers without clipboard API
      const input = document.createElement('input')
      input.value = profile.patient_code
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Spinner size={28} />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">حسابي</h1>
        <p className="mt-1 text-slate-500">معلوماتك الشخصية</p>
      </div>

      {/* Patient ID card */}
      <div className="mb-6 overflow-hidden rounded-2xl bg-gradient-to-l from-teal-500 to-primary-500 p-5 text-white shadow-lg shadow-primary-200">
        <div className="flex items-center gap-2 text-white/80">
          <Hash size={18} />
          <span className="text-sm font-medium">رمز المريض</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-2xl font-bold tracking-wider">
            {profile?.patient_code || 'جارٍ التوليد...'}
          </span>
          {profile?.patient_code && (
            <button
              onClick={handleCopyCode}
              className="flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-2 text-sm font-medium transition-all hover:bg-white/30 active:scale-95"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-white/70">
          شارك هذا الرمز مع طبيبك ليتمكن من ربط حسابك به.
        </p>
      </div>

      {/* Avatar card */}
      <div className="mb-6 flex items-center gap-4 card">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-teal-100 text-2xl font-bold text-teal-600">
          {(fullName || 'م').charAt(0)}
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-800">{fullName || 'بيانات المريض'}</h3>
          <p className="text-sm text-slate-500">{profile?.email}</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="card mb-6 space-y-5">
        <FormField
          label="الاسم الكامل"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="اسم المريض"
          icon={User}
        />
        <FormField
          label="البريد الإلكتروني"
          type="email"
          value={profile?.email || ''}
          onChange={() => {}}
          icon={Mail}
        />
        <FormField
          label="رقم الهاتف"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="٠٥xxxxxxxx"
          icon={Phone}
        />

        {error && (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-600">
            <CheckCircle2 size={16} />
            <span>تم حفظ التغييرات بنجاح.</span>
          </div>
        )}

        <div className="pt-2">
          <button type="submit" disabled={saving} className="btn-primary disabled:opacity-60">
            {saving ? <Spinner size={20} /> : <Save size={20} />}
            <span>{saving ? 'جارٍ الحفظ...' : 'حفظ التغييرات'}</span>
          </button>
        </div>
      </form>

      {/* Logout */}
      <button
        onClick={() => signOut()}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-6 py-3 font-medium text-rose-600 transition-all hover:bg-rose-100"
      >
        <LogOut size={20} />
        <span>تسجيل الخروج</span>
      </button>
    </div>
  )
}
