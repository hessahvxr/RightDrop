// Connection settings check. Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkSupabaseConfig, cleanConfigValue, CONFIG_PROBLEM_TEXT, CONFIG_VARIABLES } from '../index.js'

// Values made up for these tests. They are not keys of any project.
const URL_OK = 'https://abcdefghijklmnop.supabase.co'
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')
const jwt = (role) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'supabase', role })}.c2lnbmF0dXJl`
const PUBLISHABLE = 'sb_publishable_' + 'x'.repeat(24)

test('usable settings: no problems, for the new publishable key and for the old anon key', () => {
  assert.deepEqual(checkSupabaseConfig(URL_OK, PUBLISHABLE), [])
  assert.deepEqual(checkSupabaseConfig(URL_OK, jwt('anon')), [])
  assert.deepEqual(checkSupabaseConfig('http://localhost:54321', jwt('anon')), [])
  assert.deepEqual(checkSupabaseConfig(URL_OK + '/', PUBLISHABLE), [])
})

test('a build without the variables (the cause of the white page) is reported, not thrown', () => {
  assert.deepEqual(checkSupabaseConfig(undefined, undefined), ['url_missing', 'key_missing'])
  assert.deepEqual(checkSupabaseConfig('', ''), ['url_missing', 'key_missing'])
  assert.deepEqual(checkSupabaseConfig(null, PUBLISHABLE), ['url_missing'])
  assert.deepEqual(checkSupabaseConfig(URL_OK, undefined), ['key_missing'])
  assert.deepEqual(checkSupabaseConfig('   ', '  \n'), ['url_missing', 'key_missing'])
  assert.deepEqual(checkSupabaseConfig('undefined', 'null'), ['url_missing', 'key_missing'])
  assert.deepEqual(checkSupabaseConfig('<your project url>', 'your-anon-key'), ['url_missing', 'key_missing'])
})

test('values pasted with spaces or line breaks around them are cleaned and accepted', () => {
  assert.equal(cleanConfigValue(`  ${URL_OK}\n`), URL_OK)
  assert.equal(cleanConfigValue(undefined), '')
  assert.equal(cleanConfigValue(42), '')
  assert.deepEqual(checkSupabaseConfig(`  ${URL_OK}\n`, ` ${PUBLISHABLE} `), [])
})

test('a URL that cannot work is reported', () => {
  for (const bad of ['abcdefghijklmnop.supabase.co', `"${URL_OK}"`, 'ftp://x.supabase.co', 'https://', 'https://abc def.supabase.co', 'https://nodots', 'not a url']) {
    assert.deepEqual(checkSupabaseConfig(bad, PUBLISHABLE), ['url_invalid'], bad)
  }
})

test('a key with quotes or spaces inside is reported', () => {
  for (const bad of [`"${PUBLISHABLE}"`, 'sb_publishable_abc def', "'abc'"]) {
    assert.deepEqual(checkSupabaseConfig(URL_OK, bad), ['key_invalid'], bad)
  }
})

test('a secret key is refused: the app does not start with it', () => {
  assert.deepEqual(checkSupabaseConfig(URL_OK, 'sb_secret_' + 'y'.repeat(24)), ['key_is_secret'])
  assert.deepEqual(checkSupabaseConfig(URL_OK, jwt('service_role')), ['key_is_secret'])
  assert.deepEqual(checkSupabaseConfig(URL_OK, 'a.not-base64!.c'), []) // unreadable token: left to Supabase to judge
})

test('every problem has wording that names the variable and never shows a value', () => {
  for (const code of ['url_missing', 'url_invalid', 'key_missing', 'key_invalid', 'key_is_secret', 'client_failed']) {
    assert.ok(CONFIG_PROBLEM_TEXT[code].length > 20, code)
  }
  assert.ok(CONFIG_PROBLEM_TEXT.url_missing.includes(CONFIG_VARIABLES.url))
  assert.ok(CONFIG_PROBLEM_TEXT.key_missing.includes(CONFIG_VARIABLES.key))
  assert.deepEqual(CONFIG_VARIABLES, { url: 'VITE_SUPABASE_URL', key: 'VITE_SUPABASE_ANON_KEY' })
  const all = Object.values(CONFIG_PROBLEM_TEXT).join(' ')
  assert.equal(/supabase\.co|sb_publishable_|eyJ/.test(all), false)
})
