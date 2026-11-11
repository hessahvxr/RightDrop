// Shared logic for "مساعدك الذكي" (the AI patient assistant).
// Pure JavaScript: used by the web app now and by the mobile app later.
//
// What lives here is everything that must NOT depend on the AI service:
//   - the wording and suggested questions;
//   - input limits;
//   - urgent-symptom detection, which runs on the device BEFORE any network
//     call, so a patient describing an emergency is told to seek urgent care
//     even when the AI service is down or not configured.
//
// The server (supabase/functions/patient-assistant) repeats the same urgent
// rules, because a server must not trust its clients. A test keeps the two
// copies identical.

export const ASSISTANT_TEXT = {
  title: 'مساعدك الذكي',
  cardSubtitle: 'اسأل عن قطراتك أو أي صعوبة تواجهك',
  backToToday: 'رجوع إلى اليوم',
  intro: 'اسألني عن قطرات عينك: طريقة الاستخدام، المواعيد، أو أي صعوبة تواجهك. تقدر تكتب بالعربية أو الإنجليزية.',
  disclaimer: 'المساعد يشرح ويساعدك فقط، ولا يغني عن طبيبك. في الحالات الطارئة توجّه إلى الطوارئ.',
  suggestedTitle: 'أسئلة تساعدك على البداية',
  inputPlaceholder: 'اكتب سؤالك هنا',
  send: 'إرسال',
  thinking: 'المساعد يكتب الرد…',
  newConversation: 'محادثة جديدة',
  retry: 'إعادة المحاولة',
  shareButton: 'أرسل ملخص مشكلتي لطبيبي',
  sharePreparing: 'جارٍ تجهيز الملخص…',
  shareReviewTitle: 'هذا ما سيصل إلى طبيبك',
  shareQuestion: 'هل توافق على إرسال هذا الملخص؟',
  shareYes: 'نعم، أرسله لطبيبي',
  shareNo: 'لا، لا ترسله',
  shareNotice: 'قد لا يقرأ طبيبك الملخص فوراً. إذا كانت حالتك طارئة فلا تنتظر: توجّه إلى الطوارئ.',
  shareSent: 'تم إرسال الملخص إلى طبيبك.',
  shareCancelled: 'لم يُرسل أي شيء إلى طبيبك.',
  shareUndo: 'تراجع عن الإرسال',
  shareUndone: 'تم سحب الملخص. لن يراه طبيبك.',
  shareEmpty: 'لم أجد مشكلة واضحة لتلخيصها. اكتب ما تشعر به أولاً، ثم حاول مرة أخرى.',
  shareChooseDoctor: 'اختر الطبيب',
}

export const SUGGESTED_QUESTIONS = [
  'عيني تحمر بعد استخدام القطرة، وش أسوي؟',
  'نسيت جرعة من القطرات، وش أسوي؟',
  'أواجه صعوبة في وضع القطرة بعيني.',
  'ممكن تشرح لي طريقة استخدام قطرتي؟',
  'عندي مشكلة مع مواعيد القطرات.',
]

export const ASSISTANT_LIMITS = {
  maxMessageChars: 1000, // one patient message
  maxHistoryMessages: 12, // messages sent to the server per request
  maxHistoryChars: 6000, // total characters sent per request
  maxSummaryChars: 1500, // summary shared with the doctor
}

// ---- Urgent symptoms ---------------------------------------------------------
// Every message is sorted, by fixed rules and before any AI is involved, into:
//   'urgent'  -> show the fixed emergency message;
//   'clarify' -> ask one fixed clarifying question (the symptom could be
//                serious but the sentence is negated or unsure);
//   'none'    -> an ordinary message for the assistant.
// The rules read Arabic and English. Fixed messages exist in both languages
// and are shown in the language the patient wrote in.
//
// ALL WORDING IN THIS SECTION NEEDS APPROVAL BY A QUALIFIED OPHTHALMOLOGIST
// before use with real patients. See docs/ASSISTANT.md.
export const EMERGENCY_NUMBER = '997' // Saudi Red Crescent ambulance

export const URGENT_MESSAGES = {
  ar:
    'ما وصفته قد يكون حالة طارئة ولا يحتمل الانتظار.\n' +
    `توجّه الآن إلى أقرب قسم طوارئ، أو اتصل بالإسعاف على الرقم ${EMERGENCY_NUMBER}.\n` +
    'لا تنتظر رداً من التطبيق أو من طبيبك عبر الرسائل.',
  en:
    'What you describe may be an emergency and should not wait.\n' +
    `Go to the nearest emergency department now, or call an ambulance on ${EMERGENCY_NUMBER}.\n` +
    'Do not wait for a reply from the app or from your doctor by message.',
}

// Chemical exposure: rinse at once. No duration is stated on purpose; the
// duration must be set by ophthalmology review.
export const URGENT_CHEMICAL_NOTES = {
  ar: 'إذا دخلت مادة كيميائية في عينك: اغسلها فوراً بماء نظيف جارٍ، وتوجّه للتقييم الطبي العاجل دون تأخير.',
  en: 'If a chemical got into your eye: rinse it immediately with clean running water, and get urgent medical assessment without delay.',
}

// Suspected eye injury: three simple precautions, kept at the project owner's
// instruction. No rinsing advice here.
export const URGENT_INJURY_NOTES = {
  ar: 'عند الاشتباه بإصابة العين: لا تفرك عينك، ولا تضغط عليها، ولا تحاول إخراج أي شيء عالق فيها.',
  en: 'If you suspect an eye injury: do not rub your eye, do not press on it, and do not try to remove anything stuck in it.',
}

// One fixed question per kind of symptom, with two ready answers.
export const CLARIFY_QUESTIONS = {
  ar: {
    vision_loss: 'حتى أساعدك بشكل صحيح: هل ضعف نظرك أو تغيّر فجأة؟',
    chemical: 'حتى أساعدك بشكل صحيح: هل دخلت مادة كيميائية أو منظف في عينك؟',
    injury: 'حتى أساعدك بشكل صحيح: هل تعرضت عينك لضربة أو إصابة، أو دخل فيها شيء؟',
    bleeding: 'حتى أساعدك بشكل صحيح: هل يوجد نزيف من عينك؟',
    severe_pain: 'حتى أساعدك بشكل صحيح: هل الألم في عينك شديد؟',
  },
  en: {
    vision_loss: 'So I can help you properly: has your vision become weaker or changed suddenly?',
    chemical: 'So I can help you properly: did a chemical or a cleaning product get into your eye?',
    injury: 'So I can help you properly: was your eye hit or injured, or did something get into it?',
    bleeding: 'So I can help you properly: is there bleeding from your eye?',
    severe_pain: 'So I can help you properly: is the pain in your eye severe?',
  },
}

export const CLARIFY_ANSWERS = {
  ar: {
    vision_loss: { yes: 'نعم، نظري تغيّر فجأة', no: 'لا، نظري كما هو' },
    chemical: { yes: 'نعم، دخلت مادة كيميائية في عيني', no: 'لا، لم يدخل شيء في عيني' },
    injury: { yes: 'نعم، تعرضت عيني لإصابة', no: 'لا، عيني سليمة' },
    bleeding: { yes: 'نعم، يوجد نزيف من عيني', no: 'لا، لا يوجد نزيف' },
    severe_pain: { yes: 'نعم، الألم شديد', no: 'لا، الألم خفيف' },
  },
  en: {
    vision_loss: { yes: 'Yes, my vision changed suddenly', no: 'No, my vision is the same' },
    chemical: { yes: 'Yes, a chemical got into my eye', no: 'No, nothing got into my eye' },
    injury: { yes: 'Yes, my eye was injured', no: 'No, my eye is fine' },
    bleeding: { yes: 'Yes, my eye is bleeding', no: 'No, there is no bleeding' },
    severe_pain: { yes: 'Yes, the pain is severe', no: 'No, the pain is mild' },
  },
}

export const CLARIFY_NOTES = {
  ar: `إذا لم تكن متأكداً وتشعر أن الأمر خطير، توجّه إلى الطوارئ أو اتصل بالإسعاف على الرقم ${EMERGENCY_NUMBER}.`,
  en: `If you are not sure and you feel it may be serious, go to the emergency department or call an ambulance on ${EMERGENCY_NUMBER}.`,
}

// Headings and notes of the fixed cards, in both languages.
export const SAFETY_LABELS = {
  ar: { urgentTitle: 'تنبيه عاجل', clarifyTitle: 'سؤال مهم', contactDoctor: 'يُفضّل أن تتواصل مع طبيبك بخصوص هذا.' },
  en: { urgentTitle: 'Urgent warning', clarifyTitle: 'Important question', contactDoctor: 'It is best to contact your doctor about this.' },
}

// When several questions could be asked, the most time-critical comes first.
export const CLARIFY_PRIORITY = ['vision_loss', 'chemical', 'injury', 'bleeding', 'severe_pain']

// 'ar' or 'en': the language a text is mostly written in (Arabic when unclear).
export function detectLanguage(text) {
  const value = String(text == null ? '' : text)
  const arabic = (value.match(/[ء-ي]/g) || []).length
  const latin = (value.match(/[A-Za-z]/g) || []).length
  return latin > arabic ? 'en' : 'ar'
}

// Make Arabic text comparable: no diacritics, unified alef / yaa / taa marbuta,
// punctuation removed, lower-case Latin.
export function normalizeArabic(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^ء-يa-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Words of a message, with '|' wherever punctuation ends a clause, so that
// "لا، عندي ألم شديد" is not read as "no pain".
export const CLAUSE_BREAK = '|'
export function tokenize(text) {
  const words = []
  for (const clause of String(text == null ? '' : text).split(/[.,;:!?؟،؛\n\r()«»"]+/)) {
    const part = normalizeArabic(clause)
    if (!part) continue
    if (words.length > 0) words.push(CLAUSE_BREAK)
    words.push(...part.split(' '))
  }
  return words
}

// Rules are plain data so that the device and the server can share them.
//   any: one of these phrases appears.
//   all: at least one phrase from EVERY group appears in the same message.
// A word ending in * matches any word that starts with it (عين* = عيني، عينه…).
// Words are matched whole (so «الم» never matches inside «المريض»), after
// removing attached prefixes such as و، ب، ال.
//
//   negation: what a negated match means for this rule.
//     'cancels' -> not this symptom ("ما عندي ألم شديد").
//     'clarify' -> too serious to drop on a "no": ask.
//     'ignore'  -> negation is not looked at.
//   uncertain: 'clarify' -> if the patient sounds unsure, ask instead of escalating.
//   core: the group that names the symptom itself; unsure + that word alone = ask.
export const URGENT_RULES = [
  {
    category: 'vision_loss',
    negation: 'clarify',
    any: [
      'فقدت النظر', 'فقدت نظري', 'فقدت البصر', 'فقدت بصري', 'فقدت الرؤية', 'فقدان النظر', 'فقدان البصر',
      'فقدان الرؤية', 'راح نظري', 'راح النظر', 'نظري راح', 'النظر راح', 'اختفى النظر', 'اختفى نظري',
      'نظري اختفى', 'اختفت الرؤية', 'انعدمت الرؤية', 'ما عاد أشوف', 'ما عدت أشوف', 'ما صرت أشوف',
      'صرت ما أشوف', 'ما أشوف شي', 'ما أشوف شيء', 'ما أشوف أبد', 'ما أشوف بعين*', 'ما أشوف فيها',
      'ما أشوف بها', 'ما أشوف منها', 'ما أقدر أشوف', 'مو قادر أشوف', 'مش قادر أشوف', 'لا أرى شيئا',
      'لا أرى شيء', 'لا أستطيع الرؤية', 'لا أستطيع أن أرى', 'عميت', 'العمى', 'ستارة', 'ظل أسود',
      'غشاوة سوداء', 'غشاوة سودا', 'ومضات', 'وميض',
    ],
  },
  {
    category: 'vision_loss',
    negation: 'clarify',
    all: [
      ['فجأة', 'فجاءة', 'مفاجئ', 'مفاجئة', 'مرة وحدة', 'بشكل مفاجئ'],
      [
        'نظري', 'النظر', 'الرؤية', 'أشوف', 'ما أشوف', 'ما عاد أشوف', 'ما صرت أشوف', 'ما أقدر أشوف',
        'مو قادر أشوف', 'لا أرى', 'البصر', 'بصري', 'غشاوة', 'زغللة', 'ضبابية', 'ضباب',
      ],
    ],
  },
  {
    category: 'severe_pain',
    negation: 'cancels',
    uncertain: 'clarify',
    core: 0,
    all: [
      ['ألم', 'وجع', 'يوجعني', 'توجعني', 'تؤلمني', 'يؤلمني', 'تألمني', 'موجعتني', 'توجع', 'يوجع'],
      [
        'شديد', 'شديدة', 'قوي', 'قوية', 'مرة', 'ما ينتحمل', 'ما أتحمل', 'ما أقدر أتحمل', 'لا يحتمل',
        'لا يطاق', 'فظيع', 'حيل', 'واجد', 'رهيب', 'موت', 'يذبحني', 'تذبحني',
      ],
    ],
  },
  {
    category: 'chemical',
    negation: 'clarify',
    all: [
      [
        'كيميائي*', 'كيماوي*', 'كلور', 'كلوركس', 'منظف*', 'مطهر*', 'معقم*', 'حمض', 'أسيد', 'مبيض', 'تيزاب',
        'بنزين', 'غراء', 'صمغ', 'ديتول', 'فلاش', 'مبيد*', 'عطر', 'إسمنت', 'جير',
      ],
      ['عين*', 'عيون*'],
    ],
  },
  {
    category: 'injury',
    negation: 'clarify',
    all: [
      [
        'ضربة', 'انضربت', 'ضربني', 'ضربتني', 'انضرب*', 'إصابة', 'أصبت', 'انصبت', 'جرح', 'انجرح*', 'جرحت',
        'خدش', 'انخدش*', 'طعن*', 'ثقب', 'انثقب*', 'شظية', 'صدمة', 'اصطدم*', 'حادث', 'خبطة', 'انخبط*',
      ],
      ['عين*', 'عيون*'],
    ],
  },
  {
    category: 'injury',
    negation: 'clarify',
    all: [
      ['دخل', 'دخلت', 'طار', 'طاح'],
      ['شي', 'شيء', 'جسم', 'حديد', 'حديدة', 'زجاج', 'قزاز', 'شظية', 'مسمار', 'عود', 'خشب', 'حشرة'],
      ['عين*', 'عيون*'],
    ],
  },
  {
    category: 'bleeding',
    negation: 'clarify',
    all: [
      ['نزيف', 'تنزف', 'ينزف', 'دم'],
      ['عين*', 'عيون*'],
    ],
  },
  // ---- English ----
  {
    category: 'vision_loss',
    negation: 'clarify',
    any: [
      'lost my vision', 'lost vision', 'lost the vision', 'lost my sight', 'lost sight', 'losing my vision',
      'losing my sight', 'vision loss', 'loss of vision', 'loss of sight', 'went blind', 'gone blind',
      'going blind', 'vision is gone', 'sight is gone', 'vision went black', 'everything went black',
      'everything went dark', 'can t see anything', 'cant see anything', 'cannot see anything',
      'can not see anything', 'can t see at all', 'cannot see at all', 'can t see with', 'cant see with',
      'cannot see with', 'can t see out of', 'cannot see out of', 'can t see from', 'cannot see from',
      'can t see in my', 'cannot see in my', 'can t see anymore', 'cannot see anymore', 'can no longer see',
      'no longer see', 'curtain', 'black shadow', 'dark shadow', 'flashes', 'flashing lights',
    ],
  },
  {
    category: 'vision_loss',
    negation: 'clarify',
    all: [
      ['sudden', 'suddenly', 'all of a sudden', 'out of nowhere'],
      [
        'vision', 'sight', 'eyesight', 'see', 'seeing', 'blurry', 'blurred', 'blur', 'blind', 'can t see',
        'cant see', 'cannot see', 'can not see', 'don t see', 'couldn t see',
      ],
    ],
  },
  {
    category: 'severe_pain',
    negation: 'cancels',
    uncertain: 'clarify',
    core: 0,
    all: [
      ['pain', 'pains', 'painful', 'hurts', 'hurting', 'hurt', 'ache', 'aches', 'aching', 'agony'],
      [
        'severe', 'severely', 'intense', 'terrible', 'horrible', 'unbearable', 'excruciating', 'extreme',
        'extremely', 'awful', 'agonizing', 'agony', 'worst', 'very bad', 'really bad', 'so bad', 'badly',
        'a lot', 'so much', 'very much', 'very strong', 'can t bear', 'cannot bear', 'can t stand',
        'cannot stand', 'can t take', 'cannot take', 'killing me',
      ],
    ],
  },
  {
    category: 'chemical',
    negation: 'clarify',
    all: [
      [
        'chemical', 'chemicals', 'bleach', 'chlorine', 'detergent', 'cleaner', 'disinfectant', 'sanitizer',
        'sanitiser', 'alkali', 'lye', 'ammonia', 'glue', 'superglue', 'gasoline', 'petrol', 'pesticide',
        'perfume', 'cement', 'battery acid',
      ],
      ['eye', 'eyes'],
    ],
  },
  {
    category: 'injury',
    negation: 'clarify',
    any: [
      'hit in the eye', 'hit in my eye', 'hit on the eye', 'hit on my eye', 'hit me in the eye',
      'something hit my eye', 'got hit in', 'poked my eye', 'poked in the eye', 'poked me in the eye',
      'scratched my eye', 'scratch on my eye', 'eye injury', 'injury to my eye', 'injury to the eye',
      'eye trauma', 'trauma to my eye', 'stabbed', 'pierced', 'something in my eye', 'something in the eye',
      'something stuck in my eye', 'something got in my eye', 'something got into my eye',
      'something went in my eye', 'something went into my eye', 'something flew in my eye',
      'something flew into my eye', 'object in my eye', 'metal in my eye', 'glass in my eye',
      'splinter in my eye', 'piece of metal', 'piece of glass', 'foreign body', 'foreign object',
      'cut my eye', 'cut on my eye', 'cut in my eye', 'cut to my eye', 'cut the eye',
    ],
  },
  {
    category: 'injury',
    negation: 'clarify',
    all: [
      ['flew', 'went', 'got', 'entered', 'fell', 'stuck', 'lodged'],
      ['object', 'metal', 'iron', 'glass', 'splinter', 'shard', 'nail', 'wood', 'insect', 'bug'],
      ['eye', 'eyes'],
    ],
  },
  {
    category: 'injury',
    negation: 'clarify',
    all: [
      ['punched', 'struck', 'elbowed', 'kicked', 'injured', 'injury', 'trauma', 'accident', 'wound', 'wounded'],
      ['eye', 'eyes'],
    ],
  },
  {
    category: 'bleeding',
    negation: 'clarify',
    all: [
      ['bleeding', 'bleeds', 'bleed', 'blood'],
      ['eye', 'eyes'],
    ],
  },
]

// Words that negate what follows them.
export const NEGATORS = [
  'ما', 'مو', 'مهو', 'ماهو', 'ماهي', 'مش', 'مب', 'موب', 'ليس', 'ليست', 'لست', 'لم', 'لن', 'ماني', 'مانيب',
  'مافي', 'مافيه', 'مافيها', 'ماعندي', 'بدون', 'بلا', 'عدم', 'غير', 'لا',
  // English ("don't" is read as the two words «don» «t»)
  'not', 'no', 'never', 'without', 'nothing', 'none', 'nor', 'neither', 'don', 'dont', 'doesn', 'doesnt',
  'didn', 'didnt', 'isn', 'isnt', 'wasn', 'wasnt', 'haven', 'havent', 'hasn', 'hasnt',
]
// «لا» / "no" before one of these is an answer ("لا عندي ألم شديد",
// "no my pain is severe"), not a negation.
export const LA_IS_AN_ANSWER_BEFORE = ['عندي', 'فيني', 'معي', 'انا', 'بس', 'لكن', 'والله', 'i', 'my', 'it', 'but', 'the', 'im']
// A negator reaches the symptom only across these small words:
// "ما عندي ألم", "ما أحس بأي ألم", "الألم مو مرة شديد".
// It does not reach across other words: "ما نمت من الألم الشديد" is still severe pain.
export const NEGATION_CARRIERS = [
  'عندي', 'عنده', 'عندها', 'فيني', 'فيه', 'فيها', 'في', 'معي', 'أحس', 'حاس', 'حاسة', 'أشعر', 'يوجد', 'توجد',
  'هناك', 'أي', 'عاد', 'صار', 'صارت', 'يصير', 'لي', 'لدي', 'بي', 'كان', 'يكون', 'هو', 'هي', 'جاني', 'يجيني',
  'مرة', 'جدا', 'كثير', 'حيل', 'واجد', 'أبد', 'أبدا', 'دخل', 'دخلت', 'طاح', 'جا',
  // English: "don't have any severe pain", "not that severe", "no chemical in ..."
  't', 'have', 'having', 'has', 'had', 'any', 'a', 'an', 'feel', 'feeling', 'felt', 'got', 'get', 'getting',
  'is', 'are', 'was', 'been', 'be', 's', 'that', 'very', 'really', 'too', 'so', 'much', 'such', 'in', 'there',
  'experiencing',
]
// Ways of sounding unsure.
export const UNCERTAINTY_PHRASES = [
  'ماني متأكد*', 'مني متأكد*', 'مو متأكد*', 'مش متأكد*', 'مب متأكد*', 'موب متأكد*', 'لست متأكد*', 'غير متأكد*',
  'ماني عارف*', 'مو عارف*', 'مش عارف*', 'ما أدري', 'مدري', 'مادري', 'ما أعرف', 'لا أعرف', 'لا أدري', 'يمكن',
  'ربما', 'قد يكون', 'أظن', 'أعتقد', 'أشك', 'كأن', 'كأنه', 'كأنها', 'كأني', 'شكله', 'شكلها', 'احتمال',
  'مو واضح', 'مش واضح',
  // English
  'not sure', 'unsure', 'not certain', 'maybe', 'perhaps', 'possibly', 'probably', 'might', 'i think',
  'i guess', 'don t know', 'dont know', 'do not know', 'can t tell', 'cannot tell', 'no idea',
]
// Short answers to a clarifying question.
export const YES_WORDS = [
  'نعم', 'إيه', 'ايه', 'اي', 'ايوه', 'ايوا', 'أيوه', 'اه', 'أكيد', 'صح', 'بلى', 'طبعا', 'فعلا', 'yes',
  'شديد', 'شديدة', 'قوي', 'قوية', 'كثير', 'واجد', 'حيل',
  'yeah', 'yep', 'yup', 'sure', 'definitely', 'absolutely', 'correct', 'right', 'severe', 'strong', 'badly',
]
export const NO_WORDS = [
  'لا', 'لأ', 'كلا', 'مو', 'ما', 'مش', 'مب', 'أبد', 'أبدا', 'خفيف', 'بسيط', 'شوي',
  'no', 'nope', 'nah', 'not', 'never', 'mild', 'slight', 'little',
]

const NEGATION_REACH = 4 // words
const UNCERTAINTY_REACH = 6 // words

const PREFIXES = ['وبال', 'فبال', 'وال', 'فال', 'بال', 'كال', 'لل', 'ال', 'و', 'ف', 'ب', 'ل', 'ك']

// Every form a word may be compared as: itself, and itself without one
// attached prefix (and without a prefix + article).
function wordForms(word) {
  const forms = [word]
  for (const prefix of PREFIXES) {
    if (word.length > prefix.length + 1 && word.startsWith(prefix)) forms.push(word.slice(prefix.length))
  }
  return forms
}

function wordMatches(textWord, ruleWord) {
  const prefixMatch = ruleWord.endsWith('*')
  const target = prefixMatch ? ruleWord.slice(0, -1) : ruleWord
  return wordForms(textWord).some((form) => (prefixMatch ? form.startsWith(target) : form === target))
}

function phraseParts(phrase) {
  return phrase
    .split(' ')
    .map((p) => (p.endsWith('*') ? `${normalizeArabic(p.slice(0, -1))}*` : normalizeArabic(p)))
    .filter(Boolean)
}

// All places where a phrase occurs: [{ start, end }] (word positions, end exclusive).
function findPhrase(words, phrase) {
  const parts = phraseParts(phrase)
  const found = []
  if (parts.length === 0) return found
  for (let i = 0; i + parts.length <= words.length; i++) {
    if (parts.every((part, j) => wordMatches(words[i + j], part))) found.push({ start: i, end: i + parts.length })
  }
  return found
}

function findAny(words, phrases) {
  return phrases.flatMap((phrase) => findPhrase(words, phrase))
}

const normalizedSet = (list) => new Set(list.map((w) => normalizeArabic(w)))
const NEGATOR_SET = normalizedSet(NEGATORS)
const CARRIER_SET = normalizedSet(NEGATION_CARRIERS)
const LA_ANSWER_SET = normalizedSet(LA_IS_AN_ANSWER_BEFORE)
const YES_SET = normalizedSet(YES_WORDS)
const NO_SET = normalizedSet(NO_WORDS)

// A word, or the word without a leading و / ف ("ولا", "وما").
function bareForms(word) {
  return word.length > 2 && (word[0] === 'و' || word[0] === 'ف') ? [word, word.slice(1)] : [word]
}

function isNegatorAt(words, index) {
  const forms = bareForms(words[index])
  if (!forms.some((f) => NEGATOR_SET.has(f))) return false
  if (forms.includes('لا') || forms.includes('no')) {
    const next = words[index + 1]
    if (next === undefined || next === CLAUSE_BREAK || LA_ANSWER_SET.has(next)) return false
  }
  return true
}

function isCarrier(word) {
  return wordForms(word).some((f) => CARRIER_SET.has(f))
}

// Is this match negated? A negator up to four words before it, with only
// "carrier" words in between, and not itself part of a matched phrase
// (the «ما» of «ما أشوف» or «ما ينتحمل» is the symptom, not a negation).
function isNegated(words, match, taken) {
  for (let n = match.start - 1; n >= 0 && match.start - n <= NEGATION_REACH; n--) {
    if (words[n] === CLAUSE_BREAK) return false
    if (!taken.has(n) && isNegatorAt(words, n)) return true
    if (!isCarrier(words[n])) return false
  }
  return false
}

function isUncertainBefore(words, match, uncertainSpans) {
  return uncertainSpans.some((u) => {
    if (u.end > match.start || match.start - u.end > UNCERTAINTY_REACH) return false
    for (let k = u.end; k < match.start; k++) if (words[k] === CLAUSE_BREAK) return false
    return true
  })
}

// The fixed-rule reading of ONE message, without conversation context.
function analyze(words) {
  const uncertainSpans = findAny(words, UNCERTAINTY_PHRASES)
  const urgent = []
  const clarify = []
  const add = (list, category) => { if (!list.includes(category)) list.push(category) }

  for (const rule of URGENT_RULES) {
    const groups = (rule.any ? [rule.any] : rule.all).map((phrases) => findAny(words, phrases))
    if (groups.some((g) => g.length === 0)) {
      // Not the full symptom. Unsure + the symptom word alone ("ماني متأكد إذا عندي ألم") -> ask.
      if (rule.uncertain === 'clarify' && rule.core !== undefined) {
        const taken = new Set()
        for (const span of [...groups.flat(), ...uncertainSpans]) for (let k = span.start; k < span.end; k++) taken.add(k)
        const unsure = groups[rule.core].some((m) => !isNegated(words, m, taken) && isUncertainBefore(words, m, uncertainSpans))
        if (unsure) add(clarify, rule.category)
      }
      continue
    }

    // Words that belong to a matched phrase or to an "unsure" phrase are not negators.
    const taken = new Set()
    for (const span of [...groups.flat(), ...uncertainSpans]) for (let k = span.start; k < span.end; k++) taken.add(k)

    const clear = groups.map((g) => (rule.negation === 'ignore' ? g : g.filter((m) => !isNegated(words, m, taken))))
    const fired = clear.every((g) => g.length > 0)

    if (!fired) {
      if (rule.negation === 'clarify') add(clarify, rule.category)
      continue
    }
    if (rule.uncertain === 'clarify' && clear.flat().some((m) => isUncertainBefore(words, m, uncertainSpans))) {
      add(clarify, rule.category)
      continue
    }
    add(urgent, rule.category)
  }
  return { urgent, clarify: clarify.filter((c) => !urgent.includes(c)) }
}

function leadingWords(words, count) {
  const firstBreak = words.indexOf(CLAUSE_BREAK)
  return (firstBreak === -1 ? words : words.slice(0, firstBreak)).slice(0, count)
}

// The full reading of a message.
//   context.pendingClarify: the category of the clarifying question that the
//   assistant asked just before this message, if any.
// Returns { level: 'urgent' | 'clarify' | 'none', urgent, categories, clarify, lang }
//   categories: what makes it urgent; clarify: the ONE category to ask about;
//   lang: 'ar' or 'en', the language the patient wrote in.
export function assessMessage(text, context = {}) {
  const words = tokenize(text)
  const result = analyze(words)
  let urgent = result.urgent
  let clarify = result.clarify

  const pending = context.pendingClarify
  if (pending && CLARIFY_QUESTIONS.ar[pending]) {
    const lead = leadingWords(words, 3)
    const saysNo = lead.length > 0 && NO_SET.has(lead[0])
    const saysYes = !saysNo && lead.some((w) => YES_SET.has(w))
    if (saysYes && !urgent.includes(pending)) urgent = [...urgent, pending]
    // Never ask the same question twice in a row; after a "no", ask nothing more.
    clarify = saysNo ? [] : clarify.filter((c) => c !== pending)
  }

  const lang = detectLanguage(text)
  if (urgent.length > 0) return { level: 'urgent', urgent: true, categories: urgent, clarify: null, lang }
  const ask = CLARIFY_PRIORITY.find((c) => clarify.includes(c)) || null
  if (ask) return { level: 'clarify', urgent: false, categories: [], clarify: ask, lang }
  return { level: 'none', urgent: false, categories: [], clarify: null, lang }
}

// Kept for callers that only need "is this urgent?".
export function detectUrgent(text) {
  const { urgent, categories } = assessMessage(text)
  return { urgent, categories }
}

// Which clarifying question (if any) is this assistant message? (either language)
export function clarifyCategoryOf(messageText) {
  const text = String(messageText == null ? '' : messageText).trim()
  return CLARIFY_PRIORITY.find(
    (c) => text.startsWith(CLARIFY_QUESTIONS.ar[c]) || text.startsWith(CLARIFY_QUESTIONS.en[c])
  ) || null
}

const pick = (byLanguage, lang) => byLanguage[lang === 'en' ? 'en' : 'ar']

// Chemical exposure and an injury call for different first steps (rinse vs do
// not touch). When a message suggests both, neither specific step is shown:
// only the instruction to get emergency care now.
export function urgentMessageFor(categories = [], lang = 'ar') {
  const chemical = categories.includes('chemical')
  const injury = categories.includes('injury')
  const main = pick(URGENT_MESSAGES, lang)
  if (chemical && !injury) return `${pick(URGENT_CHEMICAL_NOTES, lang)}\n\n${main}`
  if (injury && !chemical) return `${pick(URGENT_INJURY_NOTES, lang)}\n\n${main}`
  return main
}

export function clarifyMessageFor(category, lang = 'ar') {
  return `${pick(CLARIFY_QUESTIONS, lang)[category]}\n${pick(CLARIFY_NOTES, lang)}`
}

// ---- Input -------------------------------------------------------------------
// null when the text can be sent, otherwise an Arabic message for the patient.
export function validateMessageText(text) {
  const trimmed = String(text == null ? '' : text).trim()
  if (!trimmed) return 'اكتب سؤالك أولاً.'
  if (trimmed.length > ASSISTANT_LIMITS.maxMessageChars) {
    return `الرسالة طويلة. اختصرها إلى ${ASSISTANT_LIMITS.maxMessageChars} حرف أو أقل.`
  }
  return null
}

// The part of the conversation that is sent to the server: only real patient
// and assistant messages (no error notices or share confirmations), newest
// last, cut to the limits. Always ends with the latest patient message.
export function buildRequestHistory(messages) {
  const usable = (messages || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, ASSISTANT_LIMITS.maxMessageChars) }))
  const picked = []
  let chars = 0
  for (let i = usable.length - 1; i >= 0 && picked.length < ASSISTANT_LIMITS.maxHistoryMessages; i--) {
    chars += usable[i].content.length
    if (chars > ASSISTANT_LIMITS.maxHistoryChars && picked.length > 0) break
    picked.unshift(usable[i])
  }
  while (picked.length > 0 && picked[0].role !== 'user') picked.shift()
  return picked
}

// ---- Errors ------------------------------------------------------------------
// Server error code -> what the patient reads. Never a made-up answer.
export const ASSISTANT_ERRORS = {
  ai_not_configured: 'المساعد الذكي غير مفعّل حالياً. يلزم إكمال إعداد الخدمة من إدارة التطبيق.',
  rate_limit_unavailable: 'المساعد الذكي غير مفعّل حالياً. يلزم إكمال إعداد الخدمة من إدارة التطبيق.',
  server_not_configured: 'المساعد الذكي غير مفعّل حالياً. يلزم إكمال إعداد الخدمة من إدارة التطبيق.',
  ai_service_error: 'تعذّر الوصول إلى المساعد الآن. حاول مرة أخرى بعد قليل.',
  ai_timeout: 'تأخر رد المساعد. حاول مرة أخرى.',
  rate_limited: 'وصلت إلى الحد الأعلى من الأسئلة حالياً. حاول مرة أخرى لاحقاً.',
  not_authenticated: 'انتهت جلستك. سجّل الدخول من جديد.',
  patients_only: 'المساعد الذكي متاح للمرضى فقط.',
  message_too_long: 'الرسالة طويلة. اختصرها ثم أرسلها مرة أخرى.',
  invalid_request: 'تعذّر إرسال الرسالة. حاول مرة أخرى.',
  network: 'لا يوجد اتصال بالإنترنت. تأكد من الاتصال ثم حاول مرة أخرى.',
  unknown: 'حدث خطأ غير متوقع. حاول مرة أخرى.',
}

export function assistantErrorMessage(code) {
  return ASSISTANT_ERRORS[code] || ASSISTANT_ERRORS.unknown
}
