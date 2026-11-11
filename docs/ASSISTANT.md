# مساعدك الذكي: the AI patient assistant (web application)

**Status: built and tested locally with stand-ins. Not deployed. The AI provider is Google Gemini; no
request has been sent to Gemini and no reply has come from a real AI model. Not clinically validated.**
See "What has and has not been tested" at the end.

## What it does

A chat screen for patients, opened from a large card on the Today page (`/patient/assistant`). It can
explain how to use eye drops, explain the patient's own prescription and schedule, help describe a
difficulty, ask a follow-up question, say when to contact the doctor or seek urgent care, and draft a
short summary of a reported problem that the patient may choose to send to a connected doctor.

It is not a diagnostic or treatment system.

## Languages: Arabic and English

- The patient can write in Arabic or in English. The reply is in the language of the patient's latest
  message. Nothing has to be chosen: `detectLanguage()` counts Arabic and Latin letters (Arabic when unclear).
- The fixed safety texts (emergency message, clarifying questions and their ready answers, the safe
  message shown when a reply is withheld, the card headings) exist in both languages and follow the
  patient's message. An English reply is laid out left-to-right.
- The prescription can be in a different language from the question. The medicine name, dose and the
  doctor's instructions are sent to the model exactly as the doctor wrote them, and the model is told to
  explain them in the patient's language and to keep medicine names as written.
- A message that mixes the two languages (for example «عندي severe pain») is read as a whole.
- The screen itself (buttons, headings, suggested questions) stays in Arabic. The app has no language switch.

## How a message is handled

| Step | Where | What happens |
| --- | --- | --- |
| 1 | Device | The text is read by fixed rules (`src/core/assistant.js`): **urgent**, **clarify** or **ordinary**. Urgent: fixed emergency message at once. Clarify: one fixed question with two ready answers. Neither needs the network. |
| 2 | Server | Caller identified from their own access token. Must be a patient. |
| 3 | Server | Input validated: roles `user` / `assistant` only, 1000 characters per message, 12 messages, 32 KB. |
| 4 | Server | The same fixed rules run again (the server does not trust the device). |
| 5 | Server | AI key present? Rate limit (20 per hour, 60 per day per patient)? |
| 6 | Server | The patient's active prescriptions, dose times and last 7 days of dose records are read **with the patient's own token**, through the existing RLS policies. No service-role key. |
| 7 | Google Gemini | Receives: the rules, that prescription data, the conversation. Never: name, email, phone, ids. |
| 8 | Server | The reply is checked by fixed patterns (Arabic and English). A reply that tells the patient to stop, skip, double or change a medicine, to take a missed dose now, names a diagnosis, recommends a medicine, or gives blanket reassurance is discarded and replaced with a safe message. If the AI flags an emergency, the fixed emergency message is used. |

The fixed rules in steps 1, 4 and 8 are backstops. They catch known wordings; they are not a guarantee.
The main control on the AI's behaviour is its instructions (`SYSTEM_PROMPT` in the function). How well a
real model follows them has **not** been tested.

## Negation and uncertainty (steps 1 and 4)

| Patient writes | Result | Why |
| --- | --- | --- |
| عندي ألم شديد | urgent | pain + severity |
| ما عندي ألم شديد / ما أحس بألم / الألم مو شديد / مافي ألم قوي | ordinary | the pain, or its severity, is negated |
| ماني متأكد إذا عندي ألم / يمكن عندي ألم شديد / مدري أحس بوجع | clarify: «هل الألم في عينك شديد؟» | unsure about pain |
| فجأة ما عاد أشوف / ما أقدر أشوف | urgent | here «ما» is the symptom, not a negation |
| لا، عندي ألم شديد | urgent | «لا» answers something else |
| ما أقدر أتحمل الألم / ما نمت من الألم الشديد | urgent | «ما» does not negate the pain |
| ما عندي ألم بس نظري راح | urgent | pain denied, vision loss reported |
| ما فقدت النظر / ما دخل كلور في عيني / ما انضربت على عيني | clarify | a denied vision loss, chemical exposure, injury or bleeding is asked about, not dropped |
| يمكن دخل كلور في عيني | urgent | unsure about a time-critical exposure: the safer path |
| I have severe pain / My eye hurts a lot | urgent | pain + severity |
| I don't have severe pain / the pain is not severe / no severe pain | ordinary | negated |
| not sure if I have pain / maybe I have severe pain | clarify: "is the pain in your eye severe?" | unsure about pain |
| I suddenly cannot see / I can't see anything | urgent | here "cannot" is the symptom |
| No, I have severe pain / I couldn't sleep because of the severe pain | urgent | the "no" / "not" does not negate the pain |
| I haven't lost my vision / no chemical got in my eye / my eye is not bleeding | clarify | asked about, not dropped |
| I can't see the drop going in / My eye hurts a little | ordinary | not an emergency wording |

How it works: a negator (ما، مو، مش، لا، ليس، بدون، مافي… / no, not, don't, never, without…) cancels a symptom only when it stands directly
before it, or with only small "carrier" words in between (عندي، أحس، فيه، أي… / have, any, feel, a…). Punctuation ends a clause.
A negator that is part of the symptom phrase itself is not a negation. After a clarifying question, short
answers (نعم، ايه، لا، مو شديد… / yes, yeah, no, not severe…) are understood, and the same question is never asked twice in a row.

Known limits: this is word matching, not understanding. Unusual phrasings, sarcasm, long sentences and
misspellings can be read wrongly in either direction. When in doubt the rules ask or escalate. The English
lists are newer and shorter than the Arabic ones. Other languages are not read by the rules at all.

## Emergency and safety wording that needs clinical approval

Every text below was written during development and is shown to patients by fixed rules. **None has been
approved by an ophthalmologist, in either language.** The English texts are translations of the Arabic
ones and add no instruction that the Arabic does not have. All are constants in `src/core/assistant.js`
(mirrored in the function), each with an `ar` and an `en` version.

| # | Constant | When shown | Arabic | English |
| --- | --- | --- | --- | --- |
| 1 | `URGENT_MESSAGES` | Any urgent symptom | ما وصفته قد يكون حالة طارئة ولا يحتمل الانتظار. توجّه الآن إلى أقرب قسم طوارئ، أو اتصل بالإسعاف على الرقم 997. لا تنتظر رداً من التطبيق أو من طبيبك عبر الرسائل. | What you describe may be an emergency and should not wait. Go to the nearest emergency department now, or call an ambulance on 997. Do not wait for a reply from the app or from your doctor by message. |
| 2 | `URGENT_CHEMICAL_NOTES` | Chemical exposure (shown before #1) | إذا دخلت مادة كيميائية في عينك: اغسلها فوراً بماء نظيف جارٍ، وتوجّه للتقييم الطبي العاجل دون تأخير. | If a chemical got into your eye: rinse it immediately with clean running water, and get urgent medical assessment without delay. |
| 3 | `URGENT_INJURY_NOTES` | Suspected eye injury: blow, cut, or something entering the eye (shown before #1) | عند الاشتباه بإصابة العين: لا تفرك عينك، ولا تضغط عليها، ولا تحاول إخراج أي شيء عالق فيها. | If you suspect an eye injury: do not rub your eye, do not press on it, and do not try to remove anything stuck in it. |
| 4 | `CLARIFY_QUESTIONS` | Negated or unsure serious symptom | هل ضعف نظرك أو تغيّر فجأة؟ · هل دخلت مادة كيميائية أو منظف في عينك؟ · هل تعرضت عينك لضربة أو إصابة، أو دخل فيها شيء؟ · هل يوجد نزيف من عينك؟ · هل الألم في عينك شديد؟ (each prefixed «حتى أساعدك بشكل صحيح:») | has your vision become weaker or changed suddenly? · did a chemical or a cleaning product get into your eye? · was your eye hit or injured, or did something get into it? · is there bleeding from your eye? · is the pain in your eye severe? (each prefixed "So I can help you properly:") |
| 5 | `CLARIFY_NOTES` | Under every clarifying question | إذا لم تكن متأكداً وتشعر أن الأمر خطير، توجّه إلى الطوارئ أو اتصل بالإسعاف على الرقم 997. | If you are not sure and you feel it may be serious, go to the emergency department or call an ambulance on 997. |
| 6 | `SAFE_FALLBACK_REPLIES` (function) | An AI reply was withheld | لا أستطيع أن أعطيك توجيهاً يخص تغيير علاجك أو تشخيص حالتك. اتبع تعليمات طبيبك كما هي، وتواصل معه إذا كان عندك سؤال عن الجرعة أو المواعيد أو أي عرض يقلقك. | I cannot give you guidance about changing your treatment or about what condition you have. Follow your doctor's instructions as they are, and contact your doctor if you have a question about the dose, the timing, or any symptom that worries you. |

Decisions inside these that also need approval:

- **No rinsing duration** is stated for chemical exposure. The duration is to be set by ophthalmology review.
- **Injury guidance** (#3) is three simple precautions: do not rub the eye, do not press on it, do not try
  to remove anything stuck in it. Kept at the project owner's instruction as basic precautionary guidance;
  still to be confirmed in the ophthalmology review.
- **Injury gets no rinsing advice.** Chemical exposure and injury are told apart. If one message suggests
  both, neither first step is shown, only #1.
- **997** is used as the ambulance number.
- The **urgent word lists** (`URGENT_RULES`), Arabic and English: what is missing, what is too broad.
- The **English wording** of every text above.
- The assistant's **instructions** (`SYSTEM_PROMPT`), especially the missed-dose rule.

## Privacy

- **Conversations are not stored on any server.** There is no conversations table. The function cannot
  write to anything and does not log message text.
- On the device the conversation is kept for the current browser session only (`sessionStorage`). It is
  erased by «محادثة جديدة», on sign-out, and when the tab is closed.
- Doctors never see conversations. A doctor sees only a summary the patient reviewed and approved with
  «نعم، أرسله لطبيبي». The patient can withdraw it («تراجع عن الإرسال»).
- Message text and prescription details do go to Google (Gemini API) to produce a reply, and bottle photos
  go to Google for the scan. This must be covered by the app's privacy policy and patient consent before
  real use. The functions send `store: false` with every request (the API's flag for not keeping the
  request in the developer's logs). How Google itself handles API data depends on the Google account and
  its terms (free and paid tiers differ); check that before any real patient data is used.

## Provider and model

- **Google Gemini, model `gemini-3.8-flash`**, for both server functions: `patient-assistant` (chat) and
  `scan-medication` (reading the bottle label from a photo). One model that takes text and images.
- Called through the Gemini API `generateContent` endpoint
  (`https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent`), without any SDK.
  Each request is complete in itself; nothing is kept on Google's side between messages by the functions.
- The key is sent in the `x-goog-api-key` header, never in the URL.
- "Thinking" is set to `low` (short answers, lower cost). `temperature` is not sent.
- Nothing is configured from this repository. Whether the key exists in the live project is unknown.

| Secret | Needed | Meaning |
| --- | --- | --- |
| `GEMINI_API_KEY` | yes | The Gemini API key. Read by both functions. |
| `GEMINI_MODEL` | no | Another Gemini model id, without code changes. It must accept images, or the scan stops working. |
| `GEMINI_THINKING_LEVEL` | no | `low` (default), `medium`, `high`, or `none` to send no thinking setting (for a model that does not accept one). |

## Setup (none of this has been done)

1. Review, then apply `supabase/migrations/20261110230000_patient_assistant.sql` (SQL editor or `supabase db push`).
2. Add the key as an Edge Function secret named exactly `GEMINI_API_KEY`:
   Supabase Dashboard → the project → **Edge Functions** → **Secrets** → add `GEMINI_API_KEY` → Save.
   (With the CLI: `supabase secrets set GEMINI_API_KEY` followed by the key, typed in your own terminal.)
3. Deploy both functions: `supabase functions deploy patient-assistant` and
   `supabase functions deploy scan-medication`.
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions by Supabase.

The key must never be put in `.env`, in a `VITE_` variable, anywhere in `src/`, or in any file of this
repository. No file here contains a key, real or placeholder.

| Missing | Patient sees |
| --- | --- |
| Function not deployed, no API key, or migration not applied | «المساعد الذكي غير مفعّل حالياً…». No answer is invented. The function's response and log say which secret to set. |
| Any of the above, but the message is an emergency or needs clarifying | The emergency message or the clarifying question, from the device. |
| Migration not applied | No «أرسل ملخص مشكلتي لطبيبي» button. The doctor dashboard shows no summaries section. |

## Kept ready for a future native app (no mobile code exists)

- Rules, wording, limits and urgent detection are in `src/core/assistant.js`: plain JavaScript, no React,
  no browser APIs.
- The server function and the database work the same for any client.
- Browser-specific code is confined to `src/lib/assistantStore.js` (sessionStorage) and the page component.

## What has and has not been tested

Tested locally, with synthetic patients and stand-ins for Supabase and the AI service:

- `npm test`: shared logic. Urgent detection, negation, uncertainty, clarifying answers, emergency wording
  and limits, in Arabic and in English, plus language detection and mixed-language messages.
- `bun test supabase/tests/`: authentication, role check, input limits, prescription context, patient
  isolation, data minimization, missing key, AI failures, rate limit, urgent escalation, negation and
  uncertainty, the reply safety check, no logging of content, summary drafting, and that the device and
  server rules are identical. Also the shape of the request sent to Gemini (endpoint, model, key in a
  header, `store: false`), how Gemini answers are read (thinking parts dropped, cut-off and blocked
  answers refused), English conversations, and a prescription in one language with a question in the
  other. For the scan: Arabic and English labels, Arabic digits, and matching an Arabic label to an
  English prescription and the reverse. In these tests the Gemini service is a stand-in that returns
  prepared answers.
- `supabase/tests/run.sh`: the migrations on a local PostgreSQL. Who can create, read and withdraw a
  summary; the doctor list; the rate counter; all earlier access rules.
- Browser scenarios of the Today card, the chat screen and the doctor dashboard (run in a private harness
  with stand-ins; not part of this repository).

NOT tested:

- Any real AI model. No request was sent to Gemini and no reply in any test came from a model. The
  request format follows Google's published API reference but has never been accepted by the real service.
  Whether `gemini-3.8-flash` follows the rules, how good its Arabic is for elderly patients, whether it
  really answers in the patient's language, how well it reads Arabic and English bottle labels, and how
  often the safety check wrongly blocks a good reply are all unknown.
- The functions running on Supabase (Deno), real tokens, real RLS on the live project.
- The production build (`npm run build`). Packages could not be installed in the development sandbox.
- Any clinical evaluation.
