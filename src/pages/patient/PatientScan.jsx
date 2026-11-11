import { useState, useRef, useCallback } from 'react'
import {
  Camera, Upload, X, RefreshCw, ScanLine, AlertCircle,
  CheckCircle2, XCircle, HelpCircle, ShieldCheck, Phone,
} from 'lucide-react'
import Spinner from '../../components/Spinner'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabaseClient'
import { EYE_LABELS } from '../../lib/prescriptionHelpers'

const SCAN_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scan-medication`
// The project's public key, sent in the `apikey` header as the Supabase client does. Not a secret.
const PUBLIC_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export default function PatientScan() {
  const { user, session } = useAuth()
  const [state, setState] = useState('idle')
  const [imageData, setImageData] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [consentGiven, setConsentGiven] = useState(false)
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)

  const handleFileSelected = useCallback((file) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('الرجاء اختيار صورة فقط.')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      setImageData(e.target?.result)
      setState('preview')
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleCameraCapture = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelected(file)
  }

  const handleUploadSelect = (e) => {
    const file = e.target.files?.[0]
    if (file) handleFileSelected(file)
  }

  const handleRetake = () => {
    setImageData(null)
    setState('idle')
    setResult(null)
    setError(null)
    if (cameraInputRef.current) cameraInputRef.current.value = ''
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleAnalyze = async () => {
    if (!imageData || !user || !session) return
    setState('analyzing')
    setError(null)

    try {
      const base64 = imageData.split(',')[1]
      const byteChars = atob(base64)
      const byteNumbers = new Array(byteChars.length)
      for (let i = 0; i < byteChars.length; i++) {
        byteNumbers[i] = byteChars.charCodeAt(i)
      }
      const byteArray = new Uint8Array(byteNumbers)
      const file = new Blob([byteArray], { type: 'image/jpeg' })

      const fileName = `${user.id}/${Date.now()}.jpg`
      const { error: uploadError } = await supabase.storage
        .from('medication-scans')
        .upload(fileName, file, { contentType: 'image/jpeg' })

      if (uploadError) {
        setError('تعذّر رفع الصورة. حاول مرة أخرى.')
        setState('preview')
        return
      }

      const response = await fetch(SCAN_FUNCTION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          ...(PUBLIC_KEY ? { apikey: PUBLIC_KEY } : {}),
        },
        body: JSON.stringify({
          imagePath: fileName,
          patientId: user.id,
        }),
      })

      const data = await response.json()

      await supabase.storage.from('medication-scans').remove([fileName])

      if (!response.ok) {
        if (data.error === 'ai_not_configured') {
          setError(data.message || 'خدمة التعرف على الأدوية غير مفعّلة.')
        } else if (data.error === 'ai_service_error') {
          setError(data.message || 'تعذّر الاتصال بخدمة التعرف.')
        } else {
          setError(data.message || 'حدث خطأ أثناء التحليل. حاول مرة أخرى.')
        }
        setState('preview')
        return
      }

      setResult(data)
      setState('result')
    } catch {
      setError('حدث خطأ غير متوقع. حاول مرة أخرى.')
      setState('preview')
    }
  }

  if (state === 'idle') {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">فحص الدواء</h1>
          <p className="mt-1 text-slate-500">صوّر عبوة قطرة العين للتحقق من تطابقها مع وصفتك</p>
        </div>

        <div className="mb-6 rounded-2xl border-2 border-teal-200 bg-teal-50 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck size={24} className="text-teal-600" />
            <h2 className="text-lg font-bold text-teal-800">خصوصية صورتك</h2>
          </div>
          <p className="mb-4 text-sm leading-relaxed text-teal-700">
            سيتم استخدام صورتك مؤقتاً للتعرف على الدواء ومقارنته بوصفتك فقط.
            لا يتم تخزين الصورة بشكل دائم — تُحذف فور انتهاء التحليل.
            لا تُشارك الصورة مع أي مستخدم آخر.
          </p>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consentGiven}
              onChange={(e) => setConsentGiven(e.target.checked)}
              className="h-6 w-6 rounded-lg border-2 border-teal-300 text-teal-600 focus:ring-2 focus:ring-teal-200"
            />
            <span className="text-sm font-medium text-teal-800">
              أوافق على استخدام الصورة لهذا الغرض
            </span>
          </label>
        </div>

        <div className={`space-y-4 ${!consentGiven ? 'opacity-50 pointer-events-none' : ''}`}>
          <button
            onClick={() => cameraInputRef.current?.click()}
            disabled={!consentGiven}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-primary-600 py-6 text-lg font-bold text-white transition-colors hover:bg-primary-700 active:scale-[0.98] disabled:opacity-50"
          >
            <Camera size={32} />
            <span>التقاط صورة بالكاميرا</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!consentGiven}
            className="flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-slate-200 bg-white py-5 text-lg font-medium text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98] disabled:opacity-50"
          >
            <Upload size={28} />
            <span>اختيار صورة من المعرض</span>
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCameraCapture}
          className="hidden"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleUploadSelect}
          className="hidden"
        />

        <div className="mt-8 rounded-2xl bg-slate-50 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-700">
            <ScanLine size={20} className="text-slate-400" />
            نصائح للحصول على نتيجة دقيقة
          </h3>
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              صوّر العبوة في مكان جيد الإضاءة
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              اجعل اسم الدواء والتركيز واضحين في الصورة
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
              اقترب من العبوة حتى تظهر الكتابة بوضوح
            </li>
          </ul>
        </div>

        {error && (
          <div className="mt-6 flex items-center gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
      </div>
    )
  }

  if (state === 'preview') {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">مراجعة الصورة</h1>
          <p className="mt-1 text-slate-500">تأكد من وضوح اسم الدواء قبل التحليل</p>
        </div>

        <div className="mb-6 overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-50">
          <img
            src={imageData || ''}
            alt="صورة الدواء"
            className="mx-auto max-h-96 w-full object-contain"
          />
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleAnalyze}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-primary-600 py-5 text-lg font-bold text-white transition-colors hover:bg-primary-700 active:scale-[0.98]"
          >
            <ScanLine size={28} />
            <span>تحليل الصورة</span>
          </button>
          <button
            onClick={handleRetake}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-slate-200 bg-white py-4 text-base font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <RefreshCw size={22} />
            <span>إعادة التقاط الصورة</span>
          </button>
          <button
            onClick={handleRetake}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm text-slate-400 transition-colors hover:text-slate-600"
          >
            <X size={18} />
            <span>إلغاء</span>
          </button>
        </div>
      </div>
    )
  }

  if (state === 'analyzing') {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Spinner size={48} />
        <p className="mt-6 text-lg font-medium text-slate-600">جارٍ تحليل الصورة...</p>
        <p className="mt-2 text-sm text-slate-400">يستغرق التحليل بضع ثوانٍ</p>
      </div>
    )
  }

  if (state === 'result' && result) {
    const { matchResult, recognized, matchedPrescription } = result

    const resultConfig = {
      match: {
        icon: CheckCircle2,
        color: 'text-emerald-600',
        bg: 'bg-emerald-50 border-emerald-200',
        title: 'تطابق مع الوصفة',
        explanation: matchedPrescription
          ? `الدواء المُصوّر يطابق وصفتك: ${matchedPrescription.medication_name}. استخدم الدواء حسب تعليمات طبيبك.`
          : 'يبدو أن الدواء يطابق إحدى وصفاتك.',
      },
      mismatch: {
        icon: XCircle,
        color: 'text-rose-600',
        bg: 'bg-rose-50 border-rose-200',
        title: 'لا يوجد تطابق',
        explanation:
          'الدواء المُصوّر لا يطابق وصفاتك النشطة. لا تستخدم هذا الدواء قبل مراجعة طبيبك أو الصيدلي.',
      },
      unable_to_identify: {
        icon: HelpCircle,
        color: 'text-amber-600',
        bg: 'bg-amber-50 border-amber-200',
        title: 'تعذّر التعرف على الدواء',
        explanation:
          'لم يتمكن النظام من التعرف على الدواء من الصورة. الرجاء التقاط صورة أوضح أو راجع طبيبك أو الصيدلي.',
      },
    }

    const cfg = resultConfig[matchResult]
    const Icon = cfg.icon

    return (
      <div>
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-800">نتيجة الفحص</h1>
        </div>

        <div className={`mb-6 rounded-2xl border-2 p-6 ${cfg.bg}`}>
          <div className="mb-4 flex items-center gap-3">
            <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-white ${cfg.color}`}>
              <Icon size={32} />
            </div>
            <h2 className={`text-xl font-bold ${cfg.color}`}>{cfg.title}</h2>
          </div>
          <p className="text-base leading-relaxed text-slate-700">{cfg.explanation}</p>
        </div>

        <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="mb-4 text-base font-semibold text-slate-700">الدواء المُصوّر</h3>
          <div className="space-y-3">
            <DetailRow label="اسم الدواء" value={recognized.medication_name} />
            <DetailRow label="المادة الفعالة" value={recognized.active_ingredient} />
            <DetailRow label="التركيز" value={recognized.concentration} />
            <DetailRow label="الاسم التجاري" value={recognized.brand_name} />
          </div>
        </div>

        {matchedPrescription && (
          <div className="mb-6 rounded-2xl border-2 border-emerald-200 bg-emerald-50/50 p-5">
            <h3 className="mb-4 text-base font-semibold text-emerald-700">الدواء الموصوف لك</h3>
            <div className="space-y-3">
              <DetailRow label="اسم الدواء" value={matchedPrescription.medication_name} />
              <DetailRow label="التركيز" value={matchedPrescription.concentration} />
              <DetailRow label="الجرعة" value={matchedPrescription.dosage} />
              <DetailRow label="العين" value={EYE_LABELS[matchedPrescription.eye]} />
            </div>
          </div>
        )}

        {matchResult !== 'match' && (
          <div className="mb-6 rounded-2xl bg-amber-50 border border-amber-200 p-4">
            <div className="flex items-start gap-3">
              <AlertCircle size={22} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <p className="font-semibold text-amber-800">تنبيه طبي</p>
                <p className="mt-1 text-sm text-amber-700">
                  لا تستخدم أي دواء إلا بعد التأكد من أنه موصوف لك من طبيبك.
                  راجع طبيبك أو الصيدلي إذا كان لديك أي شك.
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <button
            onClick={handleRetake}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-600 py-4 text-base font-bold text-white transition-colors hover:bg-primary-700 active:scale-[0.98]"
          >
            <RefreshCw size={22} />
            <span>فحص دواء آخر</span>
          </button>
        </div>

        {matchResult !== 'match' && (
          <div className="mt-6 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-500">
            <Phone size={16} className="text-slate-400" />
            <span>إذا كان لديك أي سؤال، راجع طبيبك أو الصيدلي.</span>
          </div>
        )}
      </div>
    )
  }

  return null
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-base font-medium text-slate-800">
        {value || 'غير متاح'}
      </span>
    </div>
  )
}
