import { Link } from 'react-router-dom'

export default function PageButton({ to, icon: Icon, title, subtitle, variant = 'primary' }) {
  const styles = {
    primary: 'border-primary-200 hover:border-primary-400 hover:bg-primary-50 hover:shadow-primary-100',
    teal: 'border-teal-200 hover:border-teal-400 hover:bg-teal-50 hover:shadow-teal-100',
  }

  const iconBg = {
    primary: 'bg-primary-100 text-primary-600',
    teal: 'bg-teal-100 text-teal-600',
  }

  return (
    <Link
      to={to}
      className={`group flex flex-col items-center gap-4 rounded-2xl border-2 bg-white p-8 shadow-sm transition-all hover:shadow-lg active:scale-[0.98] ${styles[variant]}`}
    >
      <div className={`flex h-16 w-16 items-center justify-center rounded-2xl ${iconBg[variant]} transition-transform group-hover:scale-110`}>
        {Icon && <Icon size={32} strokeWidth={2} />}
      </div>
      <div className="text-center">
        <h3 className="text-xl font-bold text-slate-800">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
    </Link>
  )
}
