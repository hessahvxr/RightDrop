import { Loader2 } from 'lucide-react'

// Full-screen centered loader shown while the auth session is being restored.
export default function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <Loader2 size={32} className="animate-spin" />
        <p className="text-sm font-medium">جارٍ التحميل...</p>
      </div>
    </div>
  )
}
