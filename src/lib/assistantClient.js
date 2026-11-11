// Talks to the patient-assistant server function. The AI key lives only on
// the server; this file sends the signed-in patient's own access token and
// nothing else that identifies them.
import { buildRequestHistory, toDateKey, cleanConfigValue } from '../core'

const FUNCTION_URL = `${cleanConfigValue(import.meta.env.VITE_SUPABASE_URL)}/functions/v1/patient-assistant`
// The project's public key (the same one the Supabase client uses). Sent in
// the `apikey` header as the Supabase client itself does. It is not a secret.
const PUBLIC_KEY = cleanConfigValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

// Resolves to { ok: true, data } or { ok: false, code } (code: see ASSISTANT_ERRORS).
// Never throws and never returns made-up content.
export async function callAssistant(session, action, messages) {
  if (!session?.access_token) return { ok: false, code: 'not_authenticated' }
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')

  let response
  try {
    response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(PUBLIC_KEY ? { apikey: PUBLIC_KEY } : {}),
      },
      body: JSON.stringify({
        action,
        messages: buildRequestHistory(messages),
        localDate: toDateKey(now),
        localTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      }),
    })
  } catch {
    return { ok: false, code: 'network' }
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }
  if (!response.ok) return { ok: false, code: data?.error || (response.status === 404 ? 'ai_not_configured' : 'unknown') }
  if (!data || typeof data !== 'object') return { ok: false, code: 'unknown' }
  return { ok: true, data }
}
