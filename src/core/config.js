// Connection settings for the front end (plain JavaScript: no React, no network).
//
// The app needs two PUBLIC values, and Vite copies them into the page when the
// site is BUILT: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY. If one is missing
// at build time, the Supabase library throws while the page is loading and the
// visitor is left with a completely white page. checkSupabaseConfig() runs
// first, so the app can say what is missing instead.

export const CONFIG_VARIABLES = { url: 'VITE_SUPABASE_URL', key: 'VITE_SUPABASE_ANON_KEY' }

// A value as it should be used: a string with no spaces or line breaks around it.
export function cleanConfigValue(value) {
  return typeof value === 'string' ? value.trim() : ''
}

const isPlaceholder = (value) => /^(undefined|null|your[-_ ].*|<.*>|xxx+)$/i.test(value)

// True when the key is one that must never be in a browser: a secret key, or
// the old service_role key. (The public keys are "publishable" or "anon".)
function isSecretKey(key) {
  if (/^sb_secret_/i.test(key)) return true
  const parts = key.split('.')
  if (parts.length !== 3) return false
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

// Returns the list of problems, as codes (see CONFIG_PROBLEM_TEXT). An empty
// list means the settings can be used. It never returns the values themselves.
export function checkSupabaseConfig(rawUrl, rawKey) {
  const url = cleanConfigValue(rawUrl)
  const key = cleanConfigValue(rawKey)
  const problems = []

  if (!url || isPlaceholder(url)) {
    problems.push('url_missing')
  } else {
    let parsed = null
    try {
      parsed = /^https?:\/\/[^\s"'<>]+$/i.test(url) ? new URL(url) : null
    } catch {
      parsed = null
    }
    const hostLooksReal = parsed && (parsed.hostname.includes('.') || parsed.hostname === 'localhost')
    if (!hostLooksReal) problems.push('url_invalid')
  }

  if (!key || isPlaceholder(key)) {
    problems.push('key_missing')
  } else if (isSecretKey(key)) {
    problems.push('key_is_secret')
  } else if (/[\s"'<>]/.test(key)) {
    problems.push('key_invalid')
  }

  return problems
}

// Wording for each problem. The variable NAME is shown, never its value.
export const CONFIG_PROBLEM_TEXT = {
  url_missing: `المتغير ${CONFIG_VARIABLES.url} غير موجود (رابط مشروع Supabase).`,
  url_invalid: `قيمة ${CONFIG_VARIABLES.url} ليست رابطاً صحيحاً. لازم تبدأ بـ https:// وبدون علامات تنصيص أو مسافات.`,
  key_missing: `المتغير ${CONFIG_VARIABLES.key} غير موجود (المفتاح العام للمشروع).`,
  key_invalid: `قيمة ${CONFIG_VARIABLES.key} فيها مسافات أو علامات تنصيص. الصق المفتاح كما هو فقط.`,
  key_is_secret: `قيمة ${CONFIG_VARIABLES.key} مفتاح سري (secret أو service_role). هذا المفتاح ممنوع في الموقع. استخدم المفتاح العام (publishable أو anon) وغيّر المفتاح السري من لوحة Supabase.`,
  client_failed: 'تعذّر تجهيز الاتصال بـ Supabase بهذه الإعدادات. راجع القيمتين.',
}
