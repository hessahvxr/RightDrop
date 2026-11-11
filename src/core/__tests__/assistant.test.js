// Shared assistant logic (no AI involved). Run with: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ASSISTANT_TEXT, SUGGESTED_QUESTIONS, ASSISTANT_LIMITS, URGENT_MESSAGES, URGENT_CHEMICAL_NOTES, URGENT_INJURY_NOTES,
  EMERGENCY_NUMBER, CLARIFY_QUESTIONS, CLARIFY_ANSWERS, CLARIFY_NOTES, CLARIFY_PRIORITY, SAFETY_LABELS,
  normalizeArabic, tokenize, detectLanguage, detectUrgent, assessMessage, clarifyCategoryOf, clarifyMessageFor, urgentMessageFor,
  validateMessageText, buildRequestHistory,
  ASSISTANT_ERRORS, assistantErrorMessage,
} from '../index.js'

test('the section name and the five suggested questions are exactly as specified', () => {
  assert.equal(ASSISTANT_TEXT.title, 'مساعدك الذكي')
  assert.deepEqual(SUGGESTED_QUESTIONS, [
    'عيني تحمر بعد استخدام القطرة، وش أسوي؟',
    'نسيت جرعة من القطرات، وش أسوي؟',
    'أواجه صعوبة في وضع القطرة بعيني.',
    'ممكن تشرح لي طريقة استخدام قطرتي؟',
    'عندي مشكلة مع مواعيد القطرات.',
  ])
})

test('Arabic text is normalized so spelling variants compare equal', () => {
  assert.equal(normalizeArabic('أَلَمٌ شَدِيدٌ'), normalizeArabic('الم شديد'))
  assert.equal(normalizeArabic('فجأةً!!'), normalizeArabic('فجأة'))
  assert.equal(normalizeArabic('الرؤية'), normalizeArabic('الرؤيه'))
  assert.equal(normalizeArabic('عيـــني'), 'عيني')
  assert.equal(normalizeArabic('  Can’t   SEE  '), 'can t see')
  assert.equal(normalizeArabic(null), '')
})

test('urgent symptoms are recognised in everyday Arabic, in several spellings', () => {
  const cases = {
    vision_loss: [
      'فجأة ما صرت أشوف بعيني اليمين', 'فقدتُ النظر في عيني', 'نظري راح فجأة', 'صار عندي غشاوة مفاجئة',
      'ما عاد اشوف بالعين اليسار', 'أشوف ومضات وستارة سوداء', 'ما أقدر أشوف', 'I suddenly cannot see',
    ],
    severe_pain: ['ألم شديد في عيني', 'الم شديد بالعين', 'عيني توجعني مرة', 'عندي وجع قوي بالعين', 'والألم ما ينتحمل', 'severe eye pain'],
    chemical: ['دخل كلور في عيني', 'طاح منظف بعيني', 'جات مادة كيميائية على عيوني', 'رش عطر في عينه'],
    injury: ['انضربت على عيني', 'جاني حادث وانجرحت عيني', 'دخل شي بعيني', 'طار مسمار ودخل شي في العين', 'ضربة قوية على العين'],
    bleeding: ['عيني تنزف', 'في دم بعيني', 'نزيف من العين'],
  }
  for (const [category, phrases] of Object.entries(cases)) {
    for (const phrase of phrases) {
      const result = detectUrgent(phrase)
      assert.equal(result.urgent, true, phrase)
      if (!/[a-z]/i.test(phrase)) assert.ok(result.categories.includes(category), `${phrase} -> ${result.categories}`)
    }
  }
})

test('ordinary questions are not treated as emergencies', () => {
  const ordinary = [
    ...SUGGESTED_QUESTIONS,
    'المشكلة قوية مع المواعيد', 'ما أشوف القطرة وهي تنزل', 'عيني تدمع بعد القطرة', 'سقطت القطرة على خدي',
    'المريض عنده موعد شديد الأهمية', 'عيني توجعني شوي', 'متى موعد القطرة الجاية؟', 'كم مرة أستخدم القطرة؟',
    'أحس بحرقان خفيف بعد القطرة', 'هل أستخدم القطرة مرة وحدة باليوم؟', 'نظري ضبابي شوي بعد القطرة',
    'دخلت القطرة في عيني زين', 'الدواء قوي؟', 'شكراً', '',
  ]
  for (const phrase of ordinary) assert.equal(detectUrgent(phrase).urgent, false, phrase)
})

// level of a message, as 'urgent' | 'none' | 'clarify:<category>'
const read = (text, pendingClarify = null) => {
  const r = assessMessage(text, { pendingClarify })
  return r.level === 'clarify' ? `clarify:${r.clarify}` : r.level
}

test('negation: the five examples from the specification', () => {
  assert.equal(read('عندي ألم شديد'), 'urgent')
  assert.equal(read('ما عندي ألم شديد'), 'none') // no escalation on pain alone
  assert.equal(read('ما أحس بألم'), 'none')
  assert.equal(read('ماني متأكد إذا عندي ألم'), 'clarify:severe_pain') // asks a clarifying question
  assert.equal(read('فجأة ما عاد أشوف'), 'urgent') // here «ما» IS the symptom
})

test('negation: denied pain is not escalated, in MSA and in colloquial forms', () => {
  for (const text of [
    'ما عندي ألم شديد', 'مافي ألم شديد', 'ما فيه ألم قوي', 'بدون ألم شديد', 'لا يوجد ألم شديد', 'لا أشعر بألم شديد',
    'الألم مو شديد', 'الألم ما هو قوي', 'الألم مو مرة شديد', 'ما أحس بأي ألم شديد', 'ما توجعني مرة', 'عيني ما توجعني',
    'ولا ألم شديد', 'ألم خفيف مو شديد', 'ليس عندي ألم شديد', 'لا، ما عندي ألم شديد',
  ]) assert.equal(read(text), 'none', text)
})

test('negation: genuine emergencies are kept when a «ما» or «لا» is nearby but does not negate the symptom', () => {
  for (const text of [
    'لا، عندي ألم شديد', // "no" answers something else; the pain is real
    'لا عندي ألم شديد',
    'ما أقدر أتحمل الألم', // «ما» belongs to "cannot bear"
    'الألم ما ينتحمل',
    'ما نمت من الألم الشديد', // «ما» negates sleeping, not the pain
    'ما عندي حرارة وعندي ألم شديد',
    'ما عندي احمرار بس الألم قوي',
    'الألم شديد مو خفيف',
    'ما عندي ألم بس نظري راح', // pain denied, vision loss reported
    'ما عندي ألم شديد بس فجأة ما أشوف زين',
    'فجأة ما أشوف زين', 'ما عاد أشوف بعيني', 'صرت ما أشوف', 'ما أقدر أشوف',
  ]) assert.equal(read(text), 'urgent', text)
})

test('negation of the most serious symptoms is not trusted blindly: it asks, or escalates', () => {
  assert.equal(read('ما فقدت النظر'), 'clarify:vision_loss')
  assert.equal(read('ما دخل كلور في عيني'), 'clarify:chemical')
  assert.equal(read('ما انضربت على عيني'), 'clarify:injury')
  assert.equal(read('عيني ما تنزف'), 'clarify:bleeding')
  assert.equal(read('ما أشوف ومضات'), 'urgent') // cannot be read confidently -> safer path
})

test('uncertainty: unsure about pain -> one clarifying question; unsure about a time-critical exposure -> escalate', () => {
  for (const text of ['ماني متأكد إذا عندي ألم', 'يمكن عندي ألم شديد', 'ماني متأكد إذا الألم شديد', 'مدري أحس بوجع', 'مو متأكدة إذا يوجعني'])
    assert.equal(read(text), 'clarify:severe_pain', text)
  for (const text of ['يمكن دخل كلور في عيني', 'ما أدري وش دخل في عيني يمكن منظف', 'أظن نظري راح فجأة']) assert.equal(read(text), 'urgent', text)
  // being unsure about something ordinary is ordinary
  for (const text of ['ماني متأكد من موعد القطرة', 'يمكن نسيت القطرة', 'ما أدري كم مرة أستخدم القطرة']) assert.equal(read(text), 'none', text)
})

test('clarifying questions: ready answers and typed answers are understood; the same question is never asked twice in a row', () => {
  for (const lang of ['ar', 'en']) {
    assert.deepEqual(Object.keys(CLARIFY_ANSWERS[lang]).sort(), [...CLARIFY_PRIORITY].sort())
    for (const [category, answers] of Object.entries(CLARIFY_ANSWERS[lang])) {
      assert.equal(read(answers.yes, category), 'urgent', answers.yes)
      assert.ok(assessMessage(answers.yes, { pendingClarify: category }).categories.includes(category))
      assert.equal(read(answers.no, category), 'none', answers.no)
      assert.equal(read(answers.yes), 'urgent', `${answers.yes} (even without context)`)
      assert.equal(clarifyCategoryOf(clarifyMessageFor(category, lang)), category)
      assert.ok(clarifyMessageFor(category, lang).startsWith(CLARIFY_QUESTIONS[lang][category]))
      assert.ok(clarifyMessageFor(category, lang).includes(CLARIFY_NOTES[lang]))
    }
  }
  assert.equal(clarifyMessageFor('severe_pain'), clarifyMessageFor('severe_pain', 'ar')) // Arabic unless told otherwise
  assert.equal(read('ايه شديد', 'severe_pain'), 'urgent')
  assert.equal(read('نعم', 'severe_pain'), 'urgent')
  assert.equal(read('ايوه', 'vision_loss'), 'urgent')
  assert.equal(read('لا', 'severe_pain'), 'none')
  assert.equal(read('لا خفيف', 'severe_pain'), 'none')
  assert.equal(read('مو شديد', 'severe_pain'), 'none')
  assert.equal(read('لا بس نظري راح فجأة', 'severe_pain'), 'urgent') // "no" to the question, but a new emergency
  assert.equal(read('ماني متأكد إذا عندي ألم', 'severe_pain'), 'none') // not asked again: goes to the assistant
  assert.equal(read('ما أعرف', 'severe_pain'), 'none')
  // the same short words mean nothing without a pending question
  assert.equal(read('نعم'), 'none')
  assert.equal(read('ايه شديد'), 'none')
  assert.equal(clarifyCategoryOf('معلومة عامة: اغسل يديك.'), null)
})

test('clause punctuation is respected when reading negation', () => {
  assert.deepEqual(tokenize('لا، عندي ألمٌ شديد!'), ['لا', '|', 'عندي', 'الم', 'شديد'])
  assert.deepEqual(tokenize(''), [])
})

test('the emergency wording sends the patient to urgent care and never to the app or to waiting', () => {
  assert.equal(EMERGENCY_NUMBER, '997')
  const URGENT_MESSAGE = URGENT_MESSAGES.ar
  assert.match(URGENT_MESSAGE, /توجّه الآن إلى أقرب قسم طوارئ/)
  assert.match(URGENT_MESSAGE, /997/)
  assert.match(URGENT_MESSAGE, /لا تنتظر/)
  assert.equal(urgentMessageFor(['severe_pain']), URGENT_MESSAGE)
  assert.equal(urgentMessageFor(['severe_pain'], 'ar'), URGENT_MESSAGE)
  for (const calm of ['لا تقلق', 'طبيعي', 'بسيط']) assert.equal(URGENT_MESSAGE.includes(calm), false)
  assert.match(CLARIFY_NOTES.ar, /997/)
})

test('English emergency wording says the same thing: emergency department now, 997, do not wait', () => {
  const message = URGENT_MESSAGES.en
  assert.match(message, /Go to the nearest emergency department now, or call an ambulance on 997\./)
  assert.match(message, /Do not wait/)
  assert.equal(urgentMessageFor(['severe_pain'], 'en'), message)
  assert.equal(urgentMessageFor([], 'something-else'), URGENT_MESSAGES.ar) // unknown language -> Arabic
  for (const calm of [/don.t worry/i, /normal/i, /minor/i, /nothing serious/i]) assert.equal(calm.test(message), false)
  assert.equal(/[\u0621-\u064A]/.test(message), false)
  assert.match(CLARIFY_NOTES.en, /997/)
  assert.deepEqual(Object.keys(SAFETY_LABELS.en).sort(), Object.keys(SAFETY_LABELS.ar).sort())
  for (const lang of ['ar', 'en']) for (const label of Object.values(SAFETY_LABELS[lang])) assert.ok(label.trim().length > 0)
})

test('chemical exposure and eye injury get different first steps, and no rinsing duration is stated', () => {
  const URGENT_MESSAGE = URGENT_MESSAGES.ar, URGENT_CHEMICAL_NOTE = URGENT_CHEMICAL_NOTES.ar, URGENT_INJURY_NOTE = URGENT_INJURY_NOTES.ar
  const chemical = urgentMessageFor(detectUrgent('دخل كلور في عيني').categories)
  assert.ok(chemical.startsWith(URGENT_CHEMICAL_NOTE) && chemical.endsWith(URGENT_MESSAGE))
  assert.match(URGENT_CHEMICAL_NOTE, /اغسلها فوراً بماء نظيف جارٍ/)
  assert.match(URGENT_CHEMICAL_NOTE, /للتقييم الطبي العاجل/)
  assert.equal(/\d|دقيقة|دقائق|ساعة/.test(URGENT_CHEMICAL_NOTE), false, 'no duration until ophthalmology review')

  const injury = urgentMessageFor(detectUrgent('طار مسمار ودخل شي في عيني').categories)
  assert.ok(injury.startsWith(URGENT_INJURY_NOTE) && injury.endsWith(URGENT_MESSAGE))
  assert.equal(/اغسل|ماء/.test(injury), false, 'no rinsing advice for an injury or a foreign body')
  // the three precautions, exactly as specified by the project owner
  assert.equal(URGENT_INJURY_NOTE, 'عند الاشتباه بإصابة العين: لا تفرك عينك، ولا تضغط عليها، ولا تحاول إخراج أي شيء عالق فيها.')
  for (const blow of ['انضربت على عيني', 'جاني حادث وانجرحت عيني', 'دخل شي بعيني']) {
    assert.ok(urgentMessageFor(detectUrgent(blow).categories).startsWith(URGENT_INJURY_NOTE), blow)
  }

  // both suspected: conflicting first steps -> only "get emergency care now"
  const both = detectUrgent('انفجر منظف وجرح عيني')
  assert.deepEqual([...both.categories].sort(), ['chemical', 'injury'])
  assert.equal(urgentMessageFor(both.categories), URGENT_MESSAGE)
})

test('English: chemical exposure and eye injury get different first steps, and no rinsing duration is stated', () => {
  const chemical = urgentMessageFor(detectUrgent('bleach got in my eye').categories, 'en')
  assert.ok(chemical.startsWith(URGENT_CHEMICAL_NOTES.en) && chemical.endsWith(URGENT_MESSAGES.en))
  assert.match(URGENT_CHEMICAL_NOTES.en, /rinse it immediately with clean running water/)
  assert.equal(/\d|minute|hour/i.test(URGENT_CHEMICAL_NOTES.en), false, 'no duration until ophthalmology review')

  const injury = urgentMessageFor(detectUrgent('a nail flew into my eye').categories, 'en')
  assert.ok(injury.startsWith(URGENT_INJURY_NOTES.en) && injury.endsWith(URGENT_MESSAGES.en))
  assert.equal(/rinse|water/i.test(injury), false, 'no rinsing advice for an injury or a foreign body')
  // the same three precautions as the Arabic text, nothing added
  assert.match(URGENT_INJURY_NOTES.en, /do not rub your eye, do not press on it, and do not try to remove anything stuck in it/)
  for (const blow of ['I was punched in the eye', 'something flew into my eye', 'I got hit in the eye']) {
    assert.ok(urgentMessageFor(detectUrgent(blow).categories, 'en').startsWith(URGENT_INJURY_NOTES.en), blow)
  }
  const both = detectUrgent('the cleaner bottle exploded and cut my eye')
  assert.deepEqual([...both.categories].sort(), ['chemical', 'injury'])
  assert.equal(urgentMessageFor(both.categories, 'en'), URGENT_MESSAGES.en)
})

test('the language of a message is detected from its letters; Arabic is the default', () => {
  assert.equal(detectLanguage('عيني تحمر بعد القطرة'), 'ar')
  assert.equal(detectLanguage('My eye gets red after the drop'), 'en')
  assert.equal(detectLanguage('Timolol تحرق عيني شوي'), 'ar') // an English medicine name inside an Arabic question
  assert.equal(detectLanguage('My eye hurts after قطرة'), 'en')
  for (const empty of ['', '   ', '123 ؟', null, undefined]) assert.equal(detectLanguage(empty), 'ar')
  assert.equal(assessMessage('I have severe pain').lang, 'en')
  assert.equal(assessMessage('عندي ألم شديد').lang, 'ar')
})

test('English: urgent symptoms are recognised', () => {
  const cases = {
    vision_loss: ['I suddenly cannot see with my right eye', 'I lost my vision', 'sudden loss of vision', "I can't see anything", 'I see flashes and a dark curtain'],
    severe_pain: ['I have severe pain in my eye', 'severe eye pain', 'My eye hurts a lot', 'the pain is unbearable', 'terrible pain in my eye'],
    chemical: ['bleach got in my eye', 'a chemical splashed in my eyes', 'cleaner got into my eye'],
    injury: ['I was punched in the eye', 'something flew into my eye', 'I got hit in the eye', 'a nail flew into my eye'],
    bleeding: ['my eye is bleeding', 'there is blood coming from my eye'],
  }
  for (const [category, phrases] of Object.entries(cases)) {
    for (const phrase of phrases) {
      const result = detectUrgent(phrase)
      assert.equal(result.urgent, true, phrase)
      assert.ok(result.categories.includes(category), `${phrase} -> ${result.categories}`)
    }
  }
})

test('English: ordinary questions, and words that only look alarming, are not emergencies', () => {
  for (const text of [
    'My eye gets red after the drop, what should I do?', 'I forgot a dose, what should I do?', 'I have trouble putting the drop in my eye.',
    'Can you explain how to use my drop?', 'I have a problem with my drop schedule.', "I can't see the drop going in", 'the drop hit my eye fine',
    'My eye hurts a little', 'my eye is red and bloodshot', 'Is hyaluronic acid eye drop the same as mine?', 'my vision is a bit blurry after the drop',
    'When is my next dose?', 'thanks',
  ]) assert.equal(read(text), 'none', text)
})

test('English negation: denied pain is not escalated; real emergencies near a "no" or "not" are kept', () => {
  for (const text of [
    "I don't have severe pain", 'I do not have any severe pain', 'no severe pain', 'the pain is not severe', 'there is no severe pain',
    "it doesn't hurt a lot", 'without severe pain', 'No, I do not have severe pain',
  ]) assert.equal(read(text), 'none', text)
  for (const text of [
    'No, I have severe pain', 'no my pain is severe', "I couldn't sleep because of the severe pain", "I can't bear the pain, it is severe",
    "I don't have a fever but I have severe pain", 'no pain but I suddenly cannot see', "I can't see anything",
  ]) assert.equal(read(text), 'urgent', text)
  // the most serious symptoms are not waved away on a "no": ask
  assert.equal(read("I haven't lost my vision"), 'clarify:vision_loss')
  assert.equal(read('no chemical got in my eye'), 'clarify:chemical')
  assert.equal(read('my eye is not bleeding'), 'clarify:bleeding')
})

test('English uncertainty and answers; a mixed Arabic / English message is read as a whole', () => {
  for (const text of ['not sure if I have pain', 'maybe I have severe pain', "I'm not sure if it is severe pain", "I don't know if it hurts a lot"])
    assert.equal(read(text), 'clarify:severe_pain', text)
  for (const text of ['maybe bleach got in my eye', 'I think I suddenly lost my vision']) assert.equal(read(text), 'urgent', text)
  for (const text of ["I'm not sure about the time of my drop", 'maybe I forgot the drop']) assert.equal(read(text), 'none', text)

  assert.equal(read('yes it is severe', 'severe_pain'), 'urgent')
  assert.equal(read('yeah', 'vision_loss'), 'urgent')
  assert.equal(read('no', 'severe_pain'), 'none')
  assert.equal(read("no it's mild", 'severe_pain'), 'none')
  assert.equal(read('no but I suddenly cannot see', 'severe_pain'), 'urgent')
  assert.equal(read('yes'), 'none') // means nothing without a pending question
  // an English answer to an Arabic question, and the other way round
  assert.equal(read('yes', clarifyCategoryOf(clarifyMessageFor('severe_pain', 'ar'))), 'urgent')
  assert.equal(read('نعم', clarifyCategoryOf(clarifyMessageFor('severe_pain', 'en'))), 'urgent')

  assert.equal(read('عندي severe pain في عيني'), 'urgent')
  assert.equal(read('ما عندي severe pain'), 'none')
  assert.equal(read("I don't have ألم شديد"), 'none')
})

test('message validation', () => {
  assert.equal(validateMessageText('متى موعد القطرة؟'), null)
  assert.match(validateMessageText('   '), /اكتب سؤالك/)
  assert.match(validateMessageText(null), /اكتب سؤالك/)
  assert.equal(validateMessageText('س'.repeat(ASSISTANT_LIMITS.maxMessageChars)), null)
  assert.match(validateMessageText('س'.repeat(ASSISTANT_LIMITS.maxMessageChars + 1)), /طويلة/)
})

test('request history: only real chat turns, newest kept, limits respected, starts with the patient', () => {
  const conversation = [
    { role: 'user', content: ' السلام عليكم ' },
    { role: 'assistant', content: 'وعليكم السلام' },
    { role: 'notice', content: 'تم إرسال الملخص إلى طبيبك.' }, // app notice: never sent
    { role: 'error', content: 'تعذّر الوصول' }, // error card: never sent
    { role: 'assistant', content: '' },
    { role: 'user', content: 'متى موعد القطرة؟' },
  ]
  assert.deepEqual(buildRequestHistory(conversation), [
    { role: 'user', content: 'السلام عليكم' },
    { role: 'assistant', content: 'وعليكم السلام' },
    { role: 'user', content: 'متى موعد القطرة؟' },
  ])

  const long = []
  for (let i = 1; i <= 20; i++) long.push({ role: 'user', content: `سؤال ${i}` }, { role: 'assistant', content: `جواب ${i}` })
  long.push({ role: 'user', content: 'آخر سؤال' })
  const history = buildRequestHistory(long)
  assert.ok(history.length <= ASSISTANT_LIMITS.maxHistoryMessages)
  assert.equal(history[0].role, 'user')
  assert.deepEqual(history.at(-1), { role: 'user', content: 'آخر سؤال' })

  const huge = [{ role: 'user', content: 'ا'.repeat(1000) }, { role: 'assistant', content: 'ب'.repeat(1000) }]
  const many = Array.from({ length: 6 }, () => huge).flat().concat({ role: 'user', content: 'الأخير' })
  const cut = buildRequestHistory(many)
  assert.ok(cut.reduce((n, m) => n + m.content.length, 0) <= ASSISTANT_LIMITS.maxHistoryChars)
  assert.equal(cut.at(-1).content, 'الأخير')
  assert.deepEqual(buildRequestHistory([{ role: 'user', content: 'س'.repeat(5000) }])[0].content.length, ASSISTANT_LIMITS.maxMessageChars)
  assert.deepEqual(buildRequestHistory(null), [])
})

test('every failure has clear patient wording, and "not configured" is said plainly', () => {
  assert.match(assistantErrorMessage('ai_not_configured'), /غير مفعّل/)
  assert.match(assistantErrorMessage('rate_limit_unavailable'), /غير مفعّل/)
  assert.match(assistantErrorMessage('ai_service_error'), /تعذّر الوصول/)
  assert.match(assistantErrorMessage('rate_limited'), /الحد الأعلى/)
  assert.match(assistantErrorMessage('network'), /الإنترنت/)
  assert.equal(assistantErrorMessage('something_new'), ASSISTANT_ERRORS.unknown)
})

test('wording: sharing with the doctor is asked, and is not presented as an emergency channel', () => {
  assert.equal(ASSISTANT_TEXT.shareYes, 'نعم، أرسله لطبيبي')
  assert.equal(ASSISTANT_TEXT.shareNo, 'لا، لا ترسله')
  assert.match(ASSISTANT_TEXT.shareNotice, /طارئة/)
  assert.match(ASSISTANT_TEXT.disclaimer, /لا يغني عن طبيبك/)
})
