# RightDrop (رايت دروب)

Helps patients take doctor-prescribed eye drops correctly, especially after eye surgery.
Two roles: **patient** (today's doses, reminders, confirm a dose, scan a bottle) and
**doctor** (connect patients by Patient ID, prescribe, set dose times).

## What is in this repository

| Path | What it is |
| --- | --- |
| `src/` | The current web app (React + Vite + Tailwind, Arabic RTL) |
| `src/core/` | Dose and schedule rules in plain JavaScript (no React, no browser APIs). Shared with the future mobile app. Unit-tested. |
| `supabase/migrations/` | Database schema and access rules (RLS), in order |
| `supabase/functions/scan-medication/` | Server function for the AI bottle scan (keeps the AI key on the server) |
| `supabase/functions/patient-assistant/` | Server function for «مساعدك الذكي», the AI patient assistant |
| `supabase/tests/` | Local tests for the access rules and the scan function |
| `docs/MOBILE_PLAN.md` | Plan for the iOS / Android app |
| `docs/ASSISTANT.md` | How the AI assistant works, its safety rules, setup, and what is and is not tested |
| `docs/DEMO_SECURITY_SCOPE.md` | What sign-up, roles and patient linking do and do not protect in this demo version |

## Late doses (patient Today screen)

- A dose is *due* from 15 minutes before to 30 minutes after its time. After that it is *late*.
- A late, unconfirmed dose is shown first on the Today screen with the question «هل أخذت القطرة؟».
  - «نعم، أخذتها» saves a normal `taken` record with the real confirmation time. It reads back as
    **taken late** (worked out from `taken_at`; the database keeps its two statuses, `taken` and `missed`).
  - «لا، ما أخذتها» saves nothing. The dose stays unconfirmed and can still be recorded later that day.
    The answer is remembered on the device for that day only.
- A late dose is never locked during its day. When the day ends, an unconfirmed dose counts as **missed**
  (shown in the history tab).
- The app never tells the patient to take, skip or double a late dose. It only points to the doctor's instructions.
- Rules: `src/core/schedule.js`, `src/core/lateDose.js`. Tests: `src/core/__tests__/lateDose.test.js`.

## Running

```bash
npm install
npm run dev        # needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see .env.example)
npm test           # unit tests for src/core
```

## Backend tests (local only, never touch the real project)

```bash
# Access rules: needs a local PostgreSQL (any recent version)
PGHOST=localhost PGUSER=postgres supabase/tests/run.sh

# Server function rules (scan + assistant): needs Bun
bun test supabase/tests/
```

## Deploying backend changes

**Step-by-step guide (Arabic) for a Supabase project you own, plus Vercel: `deploy/DEPLOY-AR.md`.**
It comes with ready SQL files in `deploy/sql/` (a read-only status check, and migrations 7 to 9 each
wrapped in one transaction with safety checks).

Changes under `supabase/` do nothing until they are applied to the Supabase project:

1. Migration `20261110190000_security_hardening.sql`: run it in the Supabase SQL editor
   (or `supabase db push`).
2. Function `scan-medication`: redeploy it (`supabase functions deploy scan-medication`,
   or through Bolt).
3. Migration `20261110230000_patient_assistant.sql` and function `patient-assistant`: see `docs/ASSISTANT.md`.
   Migration `20261111010000_link_code_hardening.sql`: longer patient codes for new patients and a
   server-side limit on wrong codes. See `docs/DEMO_SECURITY_SCOPE.md`.
4. The AI scan and the AI assistant use Google Gemini (`gemini-3.8-flash`). They only work when the
   Edge Function secret `GEMINI_API_KEY` is set in Supabase (Dashboard → Edge Functions → Secrets) and both
   functions are deployed. Without the key the functions answer "service not enabled" and the app shows
   that message. No answer is invented. Never put the key in `.env` or in any file. See `docs/ASSISTANT.md`.
