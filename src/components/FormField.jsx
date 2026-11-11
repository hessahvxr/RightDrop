import { AlertCircle } from 'lucide-react'

// Reusable labeled input field used across auth + profile forms.
export default function FormField({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  icon: Icon,
  dir,
  autoComplete,
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      <div className="relative">
        {Icon && (
          <Icon
            size={18}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
        )}
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          dir={dir}
          autoComplete={autoComplete}
          className={`w-full rounded-xl border bg-slate-50 py-3 pr-11 pl-4 text-slate-800 outline-none transition-all focus:bg-white focus:ring-2 ${
            error
              ? 'border-rose-300 focus:border-rose-400 focus:ring-rose-100'
              : 'border-slate-200 focus:border-primary-400 focus:ring-primary-100'
          }`}
        />
      </div>
      {error && (
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-rose-600">
          <AlertCircle size={14} />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}
