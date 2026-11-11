import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, User, Phone, UserPlus } from 'lucide-react'
import AuthLayout from '../../components/AuthLayout'
import FormField from '../../components/FormField'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import {
  translateAuthError,
  validateEmail,
  validatePassword,
  validateName,
} from '../../lib/authHelpers'

export default function PatientRegister() {
  const navigate = useNavigate()
  const { signUp } = useAuth()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError(null)
    const newErrors = {}
    const nameErr = validateName(fullName)
    const emailErr = validateEmail(email)
    const passErr = validatePassword(password)
    if (nameErr) newErrors.fullName = nameErr
    if (emailErr) newErrors.email = emailErr
    if (passErr) newErrors.password = passErr
    setErrors(newErrors)
    if (Object.keys(newErrors).length) return

    setLoading(true)
    const { error } = await signUp({
      email: email.trim(),
      password,
      fullName: fullName.trim(),
      phone: phone.trim() || null,
      role: 'patient',
    })
    setLoading(false)

    if (error) {
      setSubmitError(translateAuthError(error.message))
      return
    }
    navigate('/patient')
  }

  return (
    <AuthLayout variant="teal" backTo="/">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-800">حساب مريض جديد</h1>
        <p className="mt-1 text-sm text-slate-500">أنشئ حسابك لمتابعة أدوية العين</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="الاسم الكامل"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="اسم المريض"
          icon={User}
          error={errors.fullName}
          autoComplete="name"
        />
        <FormField
          label="البريد الإلكتروني"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="patient@example.com"
          icon={Mail}
          error={errors.email}
          autoComplete="email"
        />
        <FormField
          label="رقم الهاتف (اختياري)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="٠٥xxxxxxxx"
          icon={Phone}
          autoComplete="tel"
        />
        <FormField
          label="كلمة المرور"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="6 أحرف على الأقل"
          icon={Lock}
          error={errors.password}
          autoComplete="new-password"
        />

        {submitError && (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {submitError}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
          {loading ? <Spinner size={20} /> : <UserPlus size={20} />}
          <span>{loading ? 'جارٍ الإنشاء...' : 'إنشاء الحساب'}</span>
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        لديك حساب بالفعل؟{' '}
        <Link to="/auth/patient/login" className="font-medium text-teal-600 hover:text-teal-700">
          تسجيل الدخول
        </Link>
      </p>
    </AuthLayout>
  )
}
