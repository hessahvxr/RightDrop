import { createClient } from '@supabase/supabase-js'
import { checkSupabaseConfig, cleanConfigValue } from '../core/config.js'

// The two public settings, copied into the page when the site is built.
export const supabaseUrl = cleanConfigValue(import.meta.env.VITE_SUPABASE_URL)
export const supabasePublicKey = cleanConfigValue(import.meta.env.VITE_SUPABASE_ANON_KEY)

// Problems with those settings, as codes (empty when they are usable).
// main.jsx shows a clear setup message when this list is not empty, instead of
// starting the app: createClient() throws on a missing value, and an error at
// this point would leave the visitor with a white page.
export const supabaseConfigProblems = checkSupabaseConfig(supabaseUrl, supabasePublicKey)

let client = null
if (supabaseConfigProblems.length === 0) {
  try {
    client = createClient(supabaseUrl, supabasePublicKey)
  } catch (error) {
    console.error('Supabase client could not be created:', error?.message)
    supabaseConfigProblems.push('client_failed')
  }
}

// null only while the setup message is on screen (the app itself is not started then).
export const supabase = client
