import { Stethoscope, User, ShieldCheck, Clock, HeartPulse } from 'lucide-react'
import Logo from '../components/Logo'
import PageButton from '../components/PageButton'

export default function WelcomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-primary-50 via-white to-teal-50">
      {/* Decorative blobs */}
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary-200/40 blur-3xl" />
      <div className="pointer-events-none absolute top-1/2 -right-24 h-96 w-96 rounded-full bg-teal-200/30 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-12">
        {/* Logo */}
        <div className="mb-8 animate-[fadeIn_0.6s_ease]">
          <Logo size="xl" />
        </div>

        {/* Headline */}
        <div className="mb-12 max-w-2xl text-center">
          <h1 className="text-4xl font-bold leading-tight text-slate-800 sm:text-5xl">
            إدارة ذكية لقطرات العين
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-slate-500">
            تطبيق رايت دروب يساعد المرضى على متابعة أدوية العين في مواعيدها،
            ويتيح للأطباء إنشاء الوصفات وإرسالها للمرضى بسهولة.
          </p>
        </div>

        {/* Login options */}
        <div className="grid w-full max-w-2xl gap-5 sm:grid-cols-2">
          <PageButton
            to="/auth/doctor/login"
            icon={Stethoscope}
            title="دخول الطبيب"
            subtitle="إدارة المرضى والوصفات الطبية"
            variant="primary"
          />
          <PageButton
            to="/auth/patient/login"
            icon={User}
            title="دخول المريض"
            subtitle="متابعة الأدوية والوصفات"
            variant="teal"
          />
        </div>

        {/* Features strip */}
        <div className="mt-16 grid w-full max-w-3xl gap-6 sm:grid-cols-3">
          <Feature icon={Clock} text="تذكير بمواعيد القطرات" />
          <Feature icon={ShieldCheck} text="وصفات طبية آمنة" />
          <Feature icon={HeartPulse} text="متابعة حالة العين" />
        </div>
      </div>
    </div>
  )
}

function Feature({ icon: Icon, text }) {
  return (
    <div className="flex items-center gap-3 justify-center text-slate-600">
      <Icon size={20} className="text-primary-500 shrink-0" />
      <span className="text-sm font-medium">{text}</span>
    </div>
  )
}
