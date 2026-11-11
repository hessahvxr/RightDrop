import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { CalendarDays, FileText, Home, ScanLine, UserCircle } from 'lucide-react'
import Logo from '../components/Logo'
import { useAuth } from '../context/AuthContext'

const navItems = [
  { to: '/patient', label: 'اليوم', icon: Home, end: true },
  { to: '/patient/schedule', label: 'الجدول', icon: CalendarDays, end: false },
  { to: '/patient/scan', label: 'فحص', icon: ScanLine, end: false },
  { to: '/patient/prescriptions', label: 'وصفاتي', icon: FileText, end: false },
  { to: '/patient/profile', label: 'حسابي', icon: UserCircle, end: false },
]

export default function PatientLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const displayName = profile?.full_name || 'المريض'

  const handleLogout = async () => {
    await signOut()
    navigate('/')
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <Logo size="sm" />
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-slate-600">{displayName}</span>
            <div className="text-sm font-medium text-slate-400">
              {new Date().toLocaleDateString('ar-EG', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </div>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-2xl px-4 pb-24 pt-6">
        <Outlet />
      </main>

      {/* Bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-stretch justify-around">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-1 py-3 transition-colors ${
                  isActive ? 'text-primary-600' : 'text-slate-400 hover:text-slate-600'
                }`
              }
            >
              <item.icon size={24} />
              <span className="text-xs font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
