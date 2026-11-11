import { Link } from 'react-router-dom'
import Logo from './Logo'

// Shared layout shell for all auth pages (login + signup for both roles).
// variant: 'primary' (doctor) or 'teal' (patient).
export default function AuthLayout({ children, variant = 'primary', backTo = '/' }) {
  const accent =
    variant === 'teal'
      ? 'from-teal-500 to-primary-500'
      : 'from-primary-500 to-teal-500'

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-b from-slate-50 via-white to-primary-50">
      <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-primary-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-teal-200/30 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-6 py-10">
        <div className="mb-8 flex items-center justify-between">
          <Link to={backTo} className="text-sm font-medium text-slate-500 transition-colors hover:text-slate-700">
            ← رجوع
          </Link>
          <Logo size="sm" />
        </div>

        <div className={`mb-8 h-1.5 w-full rounded-full bg-gradient-to-l ${accent}`} />

        {children}
      </div>
    </div>
  )
}
