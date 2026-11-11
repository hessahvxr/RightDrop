import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mail, Lock, LogIn, ArrowLeft } from 'lucide-react'
import AuthLayout from '../../components/AuthLayout'
import FormField from '../../components/FormField'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { translateAuthError, validateEmail, validatePassword } from '../../lib/authHelpers'

export default function DoctorLogin() {
  const navigate = useNavigate()
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState({})
  const [submitError, setSubmitError] = useState(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitError(null)
    const emailErr = validateEmail(email)
    const passErr = validatePassword(password)
    const newErrors = {}
    if (emailErr) newErrors.email = emailErr
    if (passErr) newErrors.password = passErr
    setErrors(newErrors)
    if (Object.keys(newErrors).length) return

    setLoading(true)
    const { error } = await signIn({ email: email.trim(), password })
    setLoading(false)

    if (error) {
      setSubmitError(translateAuthError(error.message))
      return
    }
    // On success the auth listener fires; ProtectedRoute redirects by role.
    // We navigate explicitly for snappiness.
    navigate('/doctor')
  }

  return (
    <AuthLayout variant="primary" backTo="/">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-slate-800">تسجيل دخول الطبيب</h1>
        <p className="mt-1 text-sm text-slate-500">أدخل بياناتك للوصول إلى لوحة التحكم</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="البريد الإلكتروني"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="doctor@example.com"
          icon={Mail}
          error={errors.email}
          autoComplete="email"
        />
        <FormField
          label="كلمة المرور"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          icon={Lock}
          error={errors.password}
          autoComplete="current-password"
        />

        {submitError && (
          <div className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            {submitError}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full disabled:opacity-60">
          {loading ? <Spinner size={20} /> : <LogIn size={20} />}
          <span>{loading ? 'جارٍ الدخول...' : 'تسجيل الدخول'}</span>
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        ليس لديك حساب؟{' '}
        <Link to="/auth/doctor/register" className="font-medium text-primary-600 hover:text-primary-700">
          إنشاء حساب جديد
        </Link>
      </p>
    </AuthLayout>
  )
}
