import { CONFIG_PROBLEM_TEXT, CONFIG_VARIABLES } from '../core/config.js'

// Shown instead of the app when the site was built without usable connection
// settings. It names what is missing (never any value) and how to fix it.
export default function ConfigErrorScreen({ problems }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5 py-10">
      <div role="alert" className="w-full max-w-xl rounded-3xl border-2 border-amber-400 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">الموقع غير مربوط بقاعدة البيانات</h1>
        <p className="mt-3 text-lg leading-relaxed text-slate-700">
          التطبيق لم يبدأ لأن إعدادات الاتصال ناقصة في الاستضافة. حسابك وبياناتك لم تتأثر.
        </p>

        <h2 className="mt-5 text-lg font-bold text-slate-900">المشكلة</h2>
        <ul className="mt-2 list-disc space-y-2 pr-6 text-lg leading-relaxed text-slate-800">
          {problems.map((code) => (
            <li key={code}>{CONFIG_PROBLEM_TEXT[code] || code}</li>
          ))}
        </ul>

        <h2 className="mt-5 text-lg font-bold text-slate-900">الحل (لصاحب الموقع)</h2>
        <ol className="mt-2 list-decimal space-y-2 pr-6 text-lg leading-relaxed text-slate-800">
          <li>في Vercel: افتح المشروع ثم Settings ثم Environment Variables.</li>
          <li>
            أضف المتغيرين بهذين الاسمين بالضبط، لبيئة Production:
            <span dir="ltr" className="mt-1 block rounded-lg bg-slate-100 px-3 py-2 text-left font-mono text-base">
              {CONFIG_VARIABLES.url}
              <br />
              {CONFIG_VARIABLES.key}
            </span>
          </li>
          <li>من Deployments اختر آخر نشر ثم Redeploy. القيم تُثبَّت وقت البناء، فالإضافة وحدها لا تكفي.</li>
        </ol>

        <p className="mt-5 text-base text-slate-600">
          القيمتان من لوحة Supabase: رابط المشروع والمفتاح العام فقط. لا تضع مفتاحاً سرياً هنا.
        </p>
      </div>
    </div>
  )
}
