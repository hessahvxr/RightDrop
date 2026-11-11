import { Eye } from 'lucide-react'

export default function Logo({ size = 'md', showText = true }) {
  const sizes = {
    sm: { box: 'h-9 w-9', icon: 18, text: 'text-lg' },
    md: { box: 'h-12 w-12', icon: 24, text: 'text-2xl' },
    lg: { box: 'h-16 w-16', icon: 32, text: 'text-3xl' },
    xl: { box: 'h-20 w-20', icon: 40, text: 'text-4xl' },
  }
  const s = sizes[size]

  return (
    <div className="flex items-center gap-3">
      <div className={`${s.box} flex items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-teal-500 shadow-lg shadow-primary-200`}>
        <Eye size={s.icon} className="text-white" strokeWidth={2.5} />
      </div>
      {showText && (
        <div className="flex flex-col leading-tight">
          <span className={`${s.text} font-bold text-slate-800`}>رايت دروب</span>
          <span className="text-xs font-medium text-primary-500">RightDrop</span>
        </div>
      )}
    </div>
  )
}
