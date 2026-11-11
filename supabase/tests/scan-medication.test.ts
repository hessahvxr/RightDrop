// Tests for the scan-medication edge function, run locally with Bun:
//   bun test supabase/tests/scan-medication.test.ts
//
// Supabase, storage and the AI service are replaced by in-memory fakes HERE
// ONLY, to prove the function's own rules (who may scan what, how names are
// compared). They say nothing about whether a real Gemini key is configured or
// about how the real model reads a label.
import { test, expect, mock, beforeEach } from "bun:test";

// No key, real or placeholder, is written in this repository. The tests make up a random
// value on every run, only to check that the function passes its secret on in the right place.
const STAND_IN_KEY = `stand-in-${crypto.randomUUID()}`;

const PATIENT_A = "aaaaaaaa-0000-0000-0000-000000000001";
const PATIENT_B = "bbbbbbbb-0000-0000-0000-000000000002";
const TOKENS: Record<string, string> = { "token-a": PATIENT_A, "token-b": PATIENT_B };
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

// ---- fake backend state ------------------------------------------------------
let files: Record<string, Uint8Array>;
let prescriptions: any[];
let aiReply: any;
let aiStatus: number;
let aiCalls: any[];
let rxQueries: string[];
let env: Record<string, string>;

let clientKeys: string[] = [];
mock.module("https://esm.sh/@supabase/supabase-js@2", () => ({
  createClient: (_url: string, key: string) => (clientKeys.push(key), {
    auth: {
      getUser: async (token: string) =>
        TOKENS[token]
          ? { data: { user: { id: TOKENS[token] } }, error: null }
          : { data: { user: null }, error: { message: "invalid JWT" } },
    },
    storage: {
      from: () => ({
        download: async (path: string) =>
          files[path]
            ? { data: new Blob([files[path]]), error: null }
            : { data: null, error: { message: "not found" } },
        remove: async (paths: string[]) => {
          for (const p of paths) delete files[p];
          return { error: null };
        },
      }),
    },
    from: () => {
      const filters: Record<string, string> = {};
      const q: any = {
        select: () => q,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return q;
        },
        then: (resolve: any) => {
          rxQueries.push(filters.patient_id);
          resolve({
            data: prescriptions.filter((p) => p.patient_id === filters.patient_id && p.status === filters.status),
            error: null,
          });
        },
      };
      return q;
    },
  }),
}));

let handler: (req: Request) => Promise<Response>;
(globalThis as any).Deno = {
  env: { get: (k: string) => env[k] },
  serve: (h: any) => { handler = h; },
};
const realFetch = globalThis.fetch;
let aiParts: any[] | null; // overrides the answer parts (e.g. to add a "thought" part)
let aiFinish: string;
let logs: string[];
const realConsoleError = console.error;
console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
(globalThis as any).fetch = async (url: string, init: any) => {
  if (String(url).startsWith("https://generativelanguage.googleapis.com/")) {
    aiCalls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (aiStatus !== 200) return new Response(JSON.stringify({ error: { code: aiStatus, message: "SHOULD-NOT-BE-LOGGED", status: "RESOURCE_EXHAUSTED" } }), { status: aiStatus });
    const text = typeof aiReply === "string" ? aiReply : JSON.stringify(aiReply);
    return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: aiParts ?? [{ text }] }, finishReason: aiFinish }] }), { status: 200 });
  }
  return realFetch(url, init);
};

const fn = await import("../functions/scan-medication/index.ts");

const today = new Date().toISOString().slice(0, 10);
const rx = (id: string, patient_id: string, medication_name: string, concentration: string | null, extra = {}) => ({
  id, patient_id, medication_name, concentration, dosage: "1 drop", eye: "both",
  status: "active", start_date: "2020-01-01", end_date: "2999-01-01", ...extra,
});

beforeEach(() => {
  env = { SUPABASE_URL: "http://local", SUPABASE_SERVICE_ROLE_KEY: "service", GEMINI_API_KEY: STAND_IN_KEY };
  aiParts = null; aiFinish = "STOP"; logs = [];
  files = { [`${PATIENT_A}/1.jpg`]: JPEG, [`${PATIENT_B}/9.jpg`]: JPEG };
  prescriptions = [
    rx("rx-a1", PATIENT_A, "Timolol", "0.5%"),
    rx("rx-b1", PATIENT_B, "Ketorolac", "0.5%"),
  ];
  aiReply = { medication_name: "Timolol Maleate Ophthalmic Solution", active_ingredient: "timolol", concentration: "0.5%", brand_name: null, confidence: "high" };
  aiStatus = 200;
  aiCalls = [];
  rxQueries = [];
  clientKeys = [];
});

const call = (token: string | null, body: unknown) =>
  handler(new Request("http://local/functions/v1/scan-medication", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));

// ---- project keys ----------------------------------------------------------------
test("project keys: the legacy service-role key is used when present; otherwise the default secret key; without either the function refuses", async () => {
  expect((await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).status).toBe(200);
  expect(clientKeys).toEqual(["service"]);
  // a newer Supabase project: only the key dictionaries exist
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  env.SUPABASE_SECRET_KEYS = JSON.stringify({ default: "secret-default" });
  env.SUPABASE_PUBLISHABLE_KEYS = JSON.stringify({ default: "publishable-default" });
  files[`${PATIENT_A}/1.jpg`] = JPEG;
  expect((await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).status).toBe(200);
  expect(clientKeys[1]).toBe("secret-default");
  // the caller is still checked the same way
  expect((await call(null, { imagePath: `${PATIENT_A}/1.jpg` })).status).toBe(401);
  expect((await call("token-a", { imagePath: `${PATIENT_B}/9.jpg` })).status).toBe(403);
  // no usable key at all
  for (const broken of ["", "not json", JSON.stringify({ other: "x" })]) {
    env.SUPABASE_SECRET_KEYS = broken;
    const res = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
    expect([broken, res.status]).toEqual([broken, 500]);
  }
  expect(aiCalls.length).toBe(2); // nothing was sent to the AI service when the function was not configured
});

// ---- authorization -------------------------------------------------------------
test("rejects calls without a valid user token", async () => {
  expect((await call(null, { imagePath: `${PATIENT_A}/1.jpg` })).status).toBe(401);
  expect((await call("forged", { imagePath: `${PATIENT_A}/1.jpg` })).status).toBe(401);
  expect(aiCalls.length).toBe(0);
});

test("a user cannot scan against another patient's prescriptions", async () => {
  const res = await call("token-b", { imagePath: `${PATIENT_B}/9.jpg`, patientId: PATIENT_A });
  expect(res.status).toBe(403);
  expect(rxQueries).toEqual([]); // patient A's prescriptions were never read
  expect(aiCalls.length).toBe(0);
});

test("a user cannot read or delete another patient's scan image", async () => {
  const res = await call("token-b", { imagePath: `${PATIENT_A}/1.jpg` });
  expect(res.status).toBe(403);
  expect(files[`${PATIENT_A}/1.jpg`]).toBeDefined(); // not deleted
  const sneaky = await call("token-b", { imagePath: `${PATIENT_B}/../${PATIENT_A}/1.jpg` });
  expect(sneaky.status).toBe(403);
  expect(files[`${PATIENT_A}/1.jpg`]).toBeDefined();
});

test("prescriptions are always looked up for the token's user", async () => {
  const res = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg`, patientId: PATIENT_A });
  expect(res.status).toBe(200);
  expect(rxQueries).toEqual([PATIENT_A]);
  const withoutId = await call("token-b", { imagePath: `${PATIENT_B}/9.jpg` }); // patientId is optional now
  expect(withoutId.status).toBe(200);
  expect(rxQueries).toEqual([PATIENT_A, PATIENT_B]);
});

// ---- full flow -----------------------------------------------------------------
test("match: returns the matched prescription, sends a typed image, deletes it after", async () => {
  const res = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  const body = await res.json();
  expect(body.matchResult).toBe("match");
  expect(body.matchedPrescription.id).toBe("rx-a1");
  const image = aiCalls[0].body.contents[0].parts[1].inline_data;
  expect(image.mime_type).toBe("image/jpeg");
  expect(image.data.startsWith("/9j/")).toBe(true);
  expect(files[`${PATIENT_A}/1.jpg`]).toBeUndefined();
});

test("a different drug with a similar label is a mismatch, not a match", async () => {
  aiReply = { medication_name: "Ketorolac Tromethamine Ophthalmic Solution", active_ingredient: "ketorolac tromethamine", concentration: "0.5%", brand_name: "Acular", confidence: "high" };
  const body = await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json();
  expect(body.matchResult).toBe("mismatch");
  expect(body.matchedPrescription).toBeNull();
});

test("right drug, wrong strength is a mismatch", async () => {
  aiReply = { ...aiReply, concentration: "0.25%" };
  const body = await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json();
  expect(body.matchResult).toBe("mismatch");
  expect(body.matches[0]).toMatchObject({ nameMatch: true, concentrationMismatch: true });
});

test("unsure or unreadable results never produce a match", async () => {
  aiReply = { ...aiReply, confidence: "low" };
  expect((await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json()).matchResult).toBe("unable_to_identify");
  files[`${PATIENT_A}/1.jpg`] = JPEG;
  aiReply = "Sorry, I cannot read this image.";
  expect((await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json()).matchResult).toBe("unable_to_identify");
  files[`${PATIENT_A}/1.jpg`] = JPEG;
  aiReply = "```json\n[1,2,3]\n```";
  expect((await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json()).matchResult).toBe("unable_to_identify");
});

test("finished or discontinued prescriptions are not matched", async () => {
  prescriptions = [rx("old", PATIENT_A, "Timolol", "0.5%", { end_date: "2020-02-01" }), rx("stop", PATIENT_A, "Timolol", "0.5%", { status: "discontinued" })];
  const body = await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json();
  expect(body.matchResult).toBe("unable_to_identify");
  expect(body.matches).toEqual([]);
});

test("image is deleted even when the AI service fails; missing key is reported honestly", async () => {
  aiStatus = 500;
  const res = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  expect(res.status).toBe(502);
  expect(files[`${PATIENT_A}/1.jpg`]).toBeUndefined();

  files[`${PATIENT_A}/1.jpg`] = JPEG;
  delete env.GEMINI_API_KEY;
  aiCalls = [];
  const noKey = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  expect(noKey.status).toBe(503);
  const noKeyBody = await noKey.json();
  expect(noKeyBody.error).toBe("ai_not_configured");
  expect(noKeyBody.setup).toContain("GEMINI_API_KEY");
  expect(aiCalls.length).toBe(0);
  expect(logs.join("\n")).toContain("GEMINI_API_KEY is not set");
});

test("a real-size photo (3 MB) is encoded without crashing; non-images are refused", async () => {
  const big = new Uint8Array(3 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff;
  big.set([0xff, 0xd8, 0xff]);
  files[`${PATIENT_A}/1.jpg`] = big;
  const res = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  expect(res.status).toBe(200);
  const sent = aiCalls[0].body.contents[0].parts[1].inline_data.data;
  expect(Buffer.from(sent, "base64").equals(Buffer.from(big))).toBe(true);

  files[`${PATIENT_A}/2.jpg`] = new TextEncoder().encode("this is not an image");
  expect((await call("token-a", { imagePath: `${PATIENT_A}/2.jpg` })).status).toBe(400);
  expect(files[`${PATIENT_A}/2.jpg`]).toBeUndefined();
});

// ---- name / strength comparison ------------------------------------------------
test("name matching ignores label boilerplate and salt names", () => {
  const { namesMatch, normalizeName, concentrationsMatch, sniffImageType, deriveStatus } = fn;
  expect(normalizeName("Timolol Maleate 0.5% Ophthalmic Solution, USP")).toBe("timolol");
  expect(namesMatch("Timolol Maleate Ophthalmic Solution", "Timolol")).toBe(true);
  expect(namesMatch("TIMOLOL eye drops 0.5%", "timolol")).toBe(true);
  expect(namesMatch("Pred Forte", "Prednisolone acetate")).toBe(true);
  expect(namesMatch("Timolol ophthalmic solution", "Ketorolac ophthalmic solution")).toBe(false);
  expect(namesMatch("Diclofenac sodium eye drops", "Cromolyn sodium eye drops")).toBe(false);
  expect(namesMatch("Moxifloxacin hydrochloride", "Olopatadine hydrochloride")).toBe(false);
  expect(namesMatch("Eye drops", "Timolol")).toBe(false); // nothing but boilerplate
  expect(namesMatch("قطرة تيمولول للعين", "تيمولول")).toBe(true);
  expect(concentrationsMatch("0.5 %", "0.50%")).toBe(true);
  expect(concentrationsMatch("0.25%", "0.5%")).toBe(false);
  expect(concentrationsMatch(null, "0.5%")).toBe(true);
  expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
  expect(deriveStatus({ status: "active", start_date: "2020-01-01", end_date: today }, today)).toBe("active");
});

// ---- Gemini request and response handling ---------------------------------------
test("Gemini request: right endpoint and model, key in a header (never in the URL), bilingual instructions, no logging asked", async () => {
  await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  const c = aiCalls[0];
  expect(c.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  expect(c.url).not.toContain(STAND_IN_KEY);
  expect(c.url).not.toContain("key=");
  expect(c.headers["x-goog-api-key"]).toBe(STAND_IN_KEY);
  expect(c.body.systemInstruction.parts[0].text).toBe(fn.SCAN_SYSTEM_PROMPT);
  expect(fn.SCAN_SYSTEM_PROMPT).toContain("Arabic, in English, or in both");
  expect(fn.SCAN_SYSTEM_PROMPT).toContain("Never guess");
  expect(c.body.contents.length).toBe(1);
  expect(c.body.contents[0].role).toBe("user");
  expect(c.body.contents[0].parts[0].text).toBe(fn.SCAN_USER_PROMPT);
  expect(c.body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  expect(c.body.generationConfig.maxOutputTokens).toBeGreaterThanOrEqual(2048);
  expect(c.body.store).toBe(false);
  // nothing about the patient is sent with the image
  const sent = JSON.stringify(c.body);
  for (const secret of [PATIENT_A, "token-a", "rx-a1", "Timolol"]) expect(sent).not.toContain(secret);
  expect(JSON.stringify(c)).not.toContain("openai");
});

test("model and thinking level can be changed with secrets; bad values fall back to the defaults", async () => {
  env.GEMINI_MODEL = "gemini-3.6-flash"; env.GEMINI_THINKING_LEVEL = "none";
  await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  expect(aiCalls[0].url).toContain("/models/gemini-3.6-flash:generateContent");
  expect(aiCalls[0].body.generationConfig.thinkingConfig).toBeUndefined();
  files[`${PATIENT_A}/1.jpg`] = JPEG;
  env.GEMINI_MODEL = "../../evil?x="; env.GEMINI_THINKING_LEVEL = "maximum";
  await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  expect(aiCalls[1].url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
  expect(aiCalls[1].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
});

test("Gemini answers: thinking parts are ignored; cut-off or empty answers are errors, never a guess", async () => {
  aiParts = [{ text: "The label might be Ketorolac...", thought: true }, { text: "```json\n" + JSON.stringify(aiReply) + "\n```" }];
  let res = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  expect((await res.json()).matchResult).toBe("match");

  files[`${PATIENT_A}/1.jpg`] = JPEG; aiParts = null; aiFinish = "MAX_TOKENS";
  res = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  expect(res.status).toBe(502);
  files[`${PATIENT_A}/1.jpg`] = JPEG; aiFinish = "STOP"; aiParts = [];
  res = await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` });
  expect(res.status).toBe(502);
  files[`${PATIENT_A}/1.jpg`] = JPEG; aiParts = [{ text: "only private reasoning", thought: true }];
  expect((await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).status).toBe(502);
  files[`${PATIENT_A}/1.jpg`] = JPEG; aiParts = null; aiStatus = 429;
  expect((await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).status).toBe(502);
  const allLogs = logs.join("\n");
  expect(allLogs).toContain("RESOURCE_EXHAUSTED"); // the error category helps the developer
  for (const s of ["SHOULD-NOT-BE-LOGGED", STAND_IN_KEY, "Ketorolac", "private reasoning"]) expect(allLogs).not.toContain(s);
});

// ---- Arabic and English labels ----------------------------------------------------
test("Arabic label, English prescription: matched through the transliterated name", async () => {
  aiReply = { medication_name: "تيمولول", active_ingredient: "تيمولول ماليات", concentration: "٠٫٥٪", brand_name: null, other_names: ["Timolol", "Timolol maleate"], confidence: "high" };
  const body = await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json();
  expect(body.matchResult).toBe("match");
  expect(body.matchedPrescription.id).toBe("rx-a1");
  expect(body.recognized.medication_name).toBe("تيمولول"); // the patient sees what is printed
});

test("English label, Arabic prescription: matched; different Arabic medicine: mismatch", async () => {
  prescriptions = [rx("rx-ar", PATIENT_A, "قطرة تيمولول للعين", "٠٫٥٪")];
  aiReply = { medication_name: "Timolol Maleate Ophthalmic Solution", active_ingredient: "Timolol", concentration: "0.5%", brand_name: null, other_names: ["تيمولول"], confidence: "high" };
  let body = await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json();
  expect(body.matchResult).toBe("match");

  files[`${PATIENT_A}/1.jpg`] = JPEG;
  aiReply = { medication_name: "قطرة كيتورولاك للعين", active_ingredient: "كيتورولاك", concentration: "٠٫٥٪", brand_name: null, other_names: ["Ketorolac"], confidence: "high" };
  body = await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json();
  expect(body.matchResult).toBe("mismatch");

  files[`${PATIENT_A}/1.jpg`] = JPEG;
  aiReply = { medication_name: "تيمولول", active_ingredient: null, concentration: "٠٫٢٥٪", brand_name: null, other_names: [], confidence: "high" };
  body = await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json();
  expect(body.matchResult).toBe("mismatch"); // right medicine, wrong strength, both written in Arabic
  expect(body.matches[0]).toMatchObject({ nameMatch: true, concentrationMismatch: true });
});

test("transliterated names alone never count: nothing printed was read -> unable to identify", async () => {
  aiReply = { medication_name: null, active_ingredient: null, concentration: null, brand_name: null, other_names: ["Timolol"], confidence: "high" };
  const body = await (await call("token-a", { imagePath: `${PATIENT_A}/1.jpg` })).json();
  expect(body.matchResult).toBe("unable_to_identify");
});

test("Arabic names and strengths are compared regardless of spelling variants and digit style", () => {
  const { namesMatch, normalizeName, concentrationsMatch, parseRecognized } = fn;
  expect(normalizeName("قطرة تيمولول للعين ٠٫٥٪ محلول معقّم")).toBe("تيمولول");
  expect(namesMatch("قَطْرَة تيمولول", "تيمولول")).toBe(true); // diacritics
  expect(namesMatch("أزوبت", "ازوبت")).toBe(true); // hamza forms
  expect(namesMatch("قطرة للعين", "تيمولول")).toBe(false); // label words only
  expect(namesMatch("تيمولول محلول للعين", "كيتورولاك محلول للعين")).toBe(false);
  expect(concentrationsMatch("٠٫٥٪", "0.5%")).toBe(true);
  expect(concentrationsMatch("0,5 %", "0.5%")).toBe(true);
  expect(concentrationsMatch("٠٫٢٥٪", "0.5%")).toBe(false);
  expect(parseRecognized('Here it is: {"medication_name":"Timolol","other_names":["تيمولول",42,null,""],"confidence":"high"} done').other_names).toEqual(["تيمولول"]);
  expect(parseRecognized("no json here").confidence).toBe("low");
});
