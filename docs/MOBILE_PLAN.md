# RightDrop mobile plan (iOS + Android)

> **Current decision (hackathon):** development is on the existing React + Vite web application only.
> No React Native or Expo work is to be started for now. This document describes a possible later
> conversion; nothing in it is in progress.

## Decision

Build a real native app with **React Native + Expo** in a new `mobile/` folder, talking to the
**same Supabase project**. Not a WebView or a wrapped website.

Why: the one feature the product depends on, a reminder that fires when the app is closed and the
phone is offline, is not possible from a web page. The current web reminders only fire while the
page is open. Native local notifications solve this.

## What is reused unchanged

- Database, RLS policies, the `connect_patient_by_code` function, sign-up triggers
- Supabase Auth accounts (same users, same roles)
- `scan-medication` and `patient-assistant` server functions
- `src/core/` rules: daily dose list, dose status, late-dose prompts and wording, next dose, dose log, reminder planning, assistant wording, limits and urgent-symptom detection.
  The mobile app imports these files as they are.
- All Arabic wording

## What is rebuilt for mobile

| Web today | Mobile |
| --- | --- |
| HTML + Tailwind screens | Native screens (same layout ideas, larger touch targets) |
| react-router | expo-router |
| Browser `Notification` while the page is open | `expo-notifications` local scheduled notifications, fed by `planReminders()` |
| `<input type="file" capture>` | `expo-image-picker` (camera) |
| `dir="rtl"` in HTML | `I18nManager.forceRTL` + Arabic-only layout |
| Session in localStorage | Session in secure device storage |

## Stages

- **Stage 7 (done):** shared rules extracted and tested, backend hardened, patient Today screen reworked on web.
- **Stage 7b (done):** late-dose question on Today, taken-late and end-of-day missed, in the shared rules.
- **Stage 8 (done on web + server):** AI patient assistant «مساعدك الذكي», opened from a card on the Today page. Server function, shared rules in `src/core/assistant.js`, web chat screen. See `docs/ASSISTANT.md`.
- **Later, if a native app is decided (Stage 9):** Expo project, sign-in / sign-up, patient Today screen (next dose + one-tap confirm), assistant chat screen on top of the same server function and `src/core/assistant.js`.
- **Stage 10:** local reminders: schedule on login, reschedule when prescriptions or records change, tap opens Today.
- **Stage 11:** remaining patient screens: schedule and history, prescriptions, profile with Patient ID, bottle scan.
- **Stage 12:** doctor essentials in the app: patients, prescriptions with dose times, per-patient dose record.
- **Stage 13:** store readiness: in-app account deletion (required by Apple), privacy policy, icons, test builds (TestFlight / Play internal testing).

The web app keeps working throughout and can remain the doctor's desktop console.

## Current status of the mobile app

Not started. There is no `mobile/` folder yet. The development sandbox used so far cannot download
packages, so an Expo project could not be created or run there. Everything built so far that the
mobile app needs is platform-neutral: the Supabase backend, the two server functions, and `src/core/`.

## Needed from the project owner

- Apple Developer account and Google Play Console account (for store builds)
- A decision on doctor verification and patient consent for connections
- A decision on the wording and cut-off for late doses
- `GEMINI_API_KEY` set as a Supabase Edge Function secret if the scan and assistant features are to ship
