import { useEffect, useState } from 'react'
import { User, Mail, Phone, Save, CheckCircle2 } from 'lucide-react'
import SectionHeader from '../../components/SectionHeader'
import FormField from '../../components/FormField'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'

export default function DoctorProfile() {
  const { profile, updateProfile } = useAuth()
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState(null)

  // Populate the form once the profile loads from the database.
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '')
      setPhone(profile.phone || '')
      setLoading(false)
    }
  }, [profile])

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        <Spinner size={28} />
      </div>
    )
  }

  return (
    <div>
      <SectionHeader
        title="الملف الشخصي"
        subtitle="معلومات الطبيب والعيادة"
      />

      <div className="card mb-6">
        <div className="flex items-center gap-5">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary-100 text-3xl font-bold text-primary-600">
            {(fullName || 'د').charAt(0)}
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-800">{fullName || 'بيانات الطبيب'}</h3>
            <p className="text-sm text-slate-500">{profile?.email}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="card space-y-5">
        <FormField
          label="الاسم الكامل"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="د. اسم الطبيب"
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
    </div>
  )
}
