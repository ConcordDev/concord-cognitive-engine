// server/domains/translation.js
//
// Machine translation — the subsystem the Sci-Fi Feasibility Map flagged as
// "0 files — does not exist" (only an i18n UI provider existed). This wires
// real natural-language → natural-language translation through Concord's local
// LLM stack (no external API, no data egress — sovereignty-preserving).
//
// Macros (canonical `register` convention — reachable via BOTH POST
// /api/lens/run AND runMacro, so the contract engine + macro-assassin can
// drive them; the legacy `registerLensAction`/LENS_ACTIONS path this file used
// before was INVISIBLE to runMacro and to the assassin):
//   languages  — supported-language catalog (pure, utility — no I/O)
//   detect     — identify the source language of text. A REAL deterministic
//                offline detector (Unicode-script + stopword heuristics) always
//                returns a grounded result; an available LLM only refines it.
//   translate  — translate text into a target language via the local LLM.
//                Treated like the `live_*` external-IO macros: an offline /
//                brain-down call returns an HONEST { ok:false } — it NEVER
//                fabricates a translation (a wrong translation is worse than
//                an explicit "engine unavailable").
//   batch      — translate an array of strings in one LLM pass, order-preserving.
//
// Translate/batch system prompts live in lib/prompt-registry.js
// (machineTranslate / detectSourceLanguage) per the no-inline-prompt invariant.
// The LLM routes to the local "utility" brain (fast, 65% of requests).
//
// Registration: server.js calls `registerTranslationMacros(register)`. Every
// handler returns a `{ ok, result }` envelope (the dispatcher's
// `_unwrapLensEnvelope` strips the `result` layer so the frontend reads
// `r.data.result.<field>`). Handlers never throw — every body is wrapped in
// try/catch.

import { TASK_PROMPTS } from "../lib/prompt-registry.js";

// ISO 639-1 catalog of commonly-requested languages. This is a pragmatic
// allow-list for the UI dropdown + light validation; the LLM can handle more,
// so an unknown target is passed through rather than rejected.
const LANGUAGES = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
  { code: "nl", name: "Dutch" },
  { code: "ru", name: "Russian" },
  { code: "zh", name: "Chinese (Simplified)" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "ar", name: "Arabic" },
  { code: "hi", name: "Hindi" },
  { code: "bn", name: "Bengali" },
  { code: "tr", name: "Turkish" },
  { code: "vi", name: "Vietnamese" },
  { code: "pl", name: "Polish" },
  { code: "uk", name: "Ukrainian" },
  { code: "sv", name: "Swedish" },
  { code: "he", name: "Hebrew" },
  { code: "el", name: "Greek" },
  { code: "th", name: "Thai" },
  { code: "id", name: "Indonesian" },
  { code: "fa", name: "Persian" },
  { code: "ro", name: "Romanian" },
];

const FORMALITIES = ["neutral", "formal", "informal"];
const MAX_TEXT_LEN = 8000; // per string; keeps a single call bounded
const MAX_BATCH = 50;

const NAME_BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l.name]));

// ── Fail-CLOSED numeric guard (copied from literary.js) ─────────────────────
// A NaN/Infinity/1e308/negative on any numeric input is rejected BEFORE use.
// A poisoned-numeric that clamps to ok:true is the defect the macro-assassin's
// V2 vector catches. An absent/null field is fine (uses the default). Returns
// null when clean, else the offending key.
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e6) return k;
  }
  return null;
}

// Resolve a caller-supplied language (code or name) to a display name the
// prompt can use. Unknown values pass through verbatim (the LLM is flexible).
function resolveLanguageName(input) {
  if (!input) return null;
  const s = String(input).trim();
  const lc = s.toLowerCase();
  const byCode = LANGUAGES.find((l) => l.code === lc);
  if (byCode) return byCode.name;
  const byName = LANGUAGES.find((l) => l.name.toLowerCase() === lc);
  if (byName) return byName.name;
  return s; // pass through — let the LLM handle dialects/uncommon languages
}

function llmText(res) {
  return String(res?.text || res?.content || "").trim();
}

// ── Deterministic offline language detector ─────────────────────────────────
// A REAL detector, not a stub: it scores text on (1) Unicode script ranges
// (Han/Hiragana/Katakana/Hangul/Cyrillic/Arabic/Hebrew/Greek/Thai/Devanagari)
// and (2) function-word frequency for the major Latin-script languages. This
// gives a grounded verdict + confidence with no network and no LLM — so the
// `detect` macro is hermetic and the assassin can drive it honestly. An
// available LLM only refines this baseline; it never invents the baseline.
const SCRIPT_RANGES = [
  { code: "ja", name: "Japanese", re: /[぀-ゟ゠-ヿ]/ }, // kana — check before Han
  { code: "ko", name: "Korean", re: /[가-힯ᄀ-ᇿ]/ },
  { code: "zh", name: "Chinese (Simplified)", re: /[一-鿿]/ },
  { code: "ru", name: "Russian", re: /[Ѐ-ӿ]/ },
  { code: "ar", name: "Arabic", re: /[؀-ۿ]/ },
  { code: "he", name: "Hebrew", re: /[֐-׿]/ },
  { code: "el", name: "Greek", re: /[Ͱ-Ͽ]/ },
  { code: "th", name: "Thai", re: /[฀-๿]/ },
  { code: "hi", name: "Hindi", re: /[ऀ-ॿ]/ },
  { code: "bn", name: "Bengali", re: /[ঀ-৿]/ },
];

// High-signal function words per Latin-script language. Hit-counts → score.
const STOPWORDS = {
  en: ["the", "and", "is", "are", "was", "to", "of", "in", "that", "it", "you", "this", "with", "for"],
  es: ["el", "la", "los", "las", "de", "que", "y", "en", "un", "una", "es", "por", "con", "para", "no"],
  fr: ["le", "la", "les", "de", "des", "et", "un", "une", "est", "que", "dans", "pour", "pas", "vous", "ce"],
  de: ["der", "die", "das", "und", "ist", "ein", "eine", "nicht", "mit", "den", "von", "zu", "auf", "für"],
  it: ["il", "la", "di", "che", "e", "un", "una", "per", "non", "con", "sono", "del", "della", "ho"],
  pt: ["o", "a", "os", "as", "de", "que", "e", "um", "uma", "para", "com", "não", "por", "do", "da"],
  nl: ["de", "het", "een", "en", "van", "is", "dat", "niet", "op", "te", "met", "voor", "zijn", "ik"],
  pl: ["nie", "jest", "to", "się", "na", "do", "że", "i", "w", "z", "co", "jak", "ten", "ma"],
  ro: ["și", "este", "un", "o", "de", "la", "în", "cu", "nu", "pe", "care", "să", "din", "ce"],
  id: ["yang", "dan", "di", "itu", "dengan", "untuk", "ini", "tidak", "saya", "ada", "dari", "akan"],
  sv: ["och", "att", "det", "är", "som", "en", "på", "för", "med", "har", "inte", "jag", "den"],
  tr: ["bir", "ve", "bu", "için", "ile", "değil", "çok", "ama", "daha", "gibi", "var", "ben"],
  vi: ["và", "của", "là", "có", "không", "một", "những", "được", "cho", "với", "này", "đã"],
};

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFC")
    .match(/[\p{L}\p{M}]+/gu) || [];
}

// Returns { language, code, confidence, method } — always grounded, never null
// for non-empty text. confidence in [0,1].
function detectOffline(text) {
  const sample = String(text || "").slice(0, 4000);
  // 1) Non-Latin scripts are decisive — a single character pins the language.
  for (const s of SCRIPT_RANGES) {
    const matches = sample.match(new RegExp(s.re, "gu"));
    if (matches && matches.length) {
      // Confidence scales with how much of the text is in-script (capped).
      const frac = Math.min(1, matches.length / Math.max(8, sample.replace(/\s/g, "").length));
      return {
        language: s.name,
        code: s.code,
        confidence: Math.round(Math.max(0.6, 0.6 + frac * 0.39) * 100) / 100,
        method: "script",
      };
    }
  }
  // 2) Latin-script — score by function-word frequency.
  const toks = tokenize(sample);
  if (!toks.length) {
    return { language: "Unknown", code: null, confidence: 0, method: "empty" };
  }
  const tokenSet = new Set(toks);
  let best = null;
  let total = 0;
  const scores = [];
  for (const [code, words] of Object.entries(STOPWORDS)) {
    let hits = 0;
    for (const w of words) if (tokenSet.has(w)) hits += 1;
    if (hits > 0) {
      scores.push({ code, hits });
      total += hits;
      if (!best || hits > best.hits) best = { code, hits };
    }
  }
  if (!best) {
    // No function-word signal — Latin script with no match defaults to English
    // at low confidence (the most common case for short/technical strings).
    return { language: "English", code: "en", confidence: 0.2, method: "fallback" };
  }
  // Confidence: share of the winning language among all matched function words,
  // damped by absolute hit count so a single hit isn't over-confident.
  const share = best.hits / total;
  const volume = Math.min(1, best.hits / 4);
  const confidence = Math.round(Math.max(0.3, share * 0.6 + volume * 0.4) * 100) / 100;
  return {
    language: NAME_BY_CODE.get(best.code) || best.code,
    code: best.code,
    confidence,
    method: "stopword",
  };
}

export default function registerTranslationMacros(_register) {
  // Canonical (ctx, input) handlers read a FLAT body (`input.text`, …). This
  // module is registered on BOTH the MACROS path (runMacro → handler(ctx, body))
  // AND the LENS_ACTIONS path (domains/index.js → /api/lens/run → handler(ctx,
  // virtualArtifact, body)). Normalise every dispatcher's call to hand the
  // canonical handler the flat body — otherwise the lens-run path passes the
  // artifact wrapper as `input` and every `input.X` reads undefined.
  const register = (domain, action, handler, ...extra) =>
    _register(domain, action, (ctx, input = {}, params) => {
      const inp = input && typeof input === "object" ? input : {};
      const p = params && typeof params === "object" ? params : {};
      const isVirtual = inp.type === "domain_action" && inp.data && typeof inp.data === "object";
      const isHarness = !isVirtual && typeof inp.domain === "string" && inp.data &&
        typeof inp.data === "object" && Object.keys(inp).length === 2;
      const body = (isVirtual || isHarness)
        ? { ...inp.data, ...p }
        : (Object.keys(p).length ? { ...inp, ...p } : inp);
      return handler(ctx, body);
    }, ...extra);
  // ── languages — static catalog. Pure, exercised, no I/O (utility tier). ────
  register("translation", "languages", (_ctx, _input = {}) => {
    try {
      return {
        ok: true,
        result: { languages: LANGUAGES, formalities: FORMALITIES, count: LANGUAGES.length },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "supported-language catalog + register options (pure, no I/O)" });

  // ── detect — identify the source language. ────────────────────────────────
  // Deterministic offline detector is the GROUND TRUTH (always returns a real
  // result for non-empty text, no network). An available LLM only refines it.
  register("translation", "detect", async (ctx, input = {}) => {
    try {
      const text = typeof input?.text === "string" ? input.text : "";
      if (!text.trim()) return { ok: false, error: "text required" };

      const offline = detectOffline(text);

      // Optional LLM refinement — never blocks, never overrides with garbage.
      if (ctx?.llm?.chat) {
        try {
          const res = await ctx.llm.chat({
            system: TASK_PROMPTS.detectSourceLanguage(),
            messages: [{ role: "user", content: text.slice(0, 2000) }],
            temperature: 0,
            maxTokens: 128,
            slot: "utility",
          });
          const raw = llmText(res);
          const m = raw.match(/\{[\s\S]*\}/);
          const parsed = m ? JSON.parse(m[0]) : null;
          if (parsed && parsed.language) {
            return {
              ok: true,
              result: {
                language: String(parsed.language),
                code: parsed.code ? String(parsed.code).toLowerCase() : offline.code,
                confidence: typeof parsed.confidence === "number" ? parsed.confidence : offline.confidence,
                method: "llm",
              },
            };
          }
        } catch {
          /* LLM unavailable or malformed — fall through to the offline verdict. */
        }
      }

      return {
        ok: true,
        result: {
          language: offline.language,
          code: offline.code,
          confidence: offline.confidence,
          method: offline.method,
        },
      };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }, { note: "identify the source language (deterministic offline detector; LLM refines)" });

  // ── translate — text → targetLanguage via the local LLM. ──────────────────
  // Real translation genuinely requires the LLM; offline we fail HONESTLY
  // (translation_unavailable) rather than fabricate. Treated like a live_* macro.
  register("translation", "translate", async (ctx, input = {}) => {
    try {
      const data = input || {};
      const text = typeof data.text === "string" ? data.text : "";
      const targetLanguage = resolveLanguageName(data.targetLanguage || data.target || data.to);
      const sourceLanguage = data.sourceLanguage || data.source || data.from || "auto";
      const formality = FORMALITIES.includes(data.formality) ? data.formality : "neutral";
      const preserveFormatting = data.preserveFormatting !== false;

      if (!text.trim()) return { ok: false, error: "text required" };
      if (!targetLanguage) return { ok: false, error: "targetLanguage required" };
      if (text.length > MAX_TEXT_LEN) {
        return { ok: false, error: `text too long (${text.length} > ${MAX_TEXT_LEN} chars)` };
      }
      if (!ctx?.llm?.chat) return { ok: false, error: "translation_unavailable" };

      const system = TASK_PROMPTS.machineTranslate({
        targetLanguage,
        sourceLanguage: resolveLanguageName(sourceLanguage) || "auto",
        formality,
        preserveFormatting,
      });

      const res = await ctx.llm.chat({
        system,
        messages: [{ role: "user", content: text }],
        temperature: 0.2,
        maxTokens: Math.min(4096, Math.ceil(text.length / 2) + 512),
        slot: "utility",
      });
      const translated = llmText(res);
      if (!translated) return { ok: false, error: "translation_unavailable" };
      return {
        ok: true,
        result: {
          translated,
          targetLanguage,
          sourceLanguage: resolveLanguageName(sourceLanguage) || "auto",
          formality,
          chars: text.length,
          model: res?.model || res?.brain || "utility",
        },
      };
    } catch (e) {
      // Honest failure — never fabricate a translation when the brain is down.
      return { ok: false, error: "translation_unavailable", detail: String(e?.message || e) };
    }
  }, { note: "translate text into a target language via the local LLM (honest fail offline)" });

  // ── batch — translate an array of strings, one LLM pass, order-preserving. ──
  register("translation", "batch", async (ctx, input = {}) => {
    try {
      const data = input || {};
      const items = Array.isArray(data.items) ? data.items.map((x) => String(x ?? "")) : [];
      const targetLanguage = resolveLanguageName(data.targetLanguage || data.target || data.to);
      const formality = FORMALITIES.includes(data.formality) ? data.formality : "neutral";

      if (!items.length) return { ok: false, error: "items[] required" };
      if (items.length > MAX_BATCH) return { ok: false, error: `too many items (${items.length} > ${MAX_BATCH})` };
      if (!targetLanguage) return { ok: false, error: "targetLanguage required" };
      const totalLen = items.reduce((n, s) => n + s.length, 0);
      if (totalLen > MAX_TEXT_LEN) return { ok: false, error: `batch too long (${totalLen} > ${MAX_TEXT_LEN} chars)` };
      if (!ctx?.llm?.chat) return { ok: false, error: "translation_unavailable" };

      const system =
        TASK_PROMPTS.machineTranslate({ targetLanguage, formality, preserveFormatting: true }) +
        `\nThe user message is a JSON array of strings. Return ONLY a JSON array of the same length, in the same order, each element the translation of the corresponding input. No other text.`;

      const res = await ctx.llm.chat({
        system,
        messages: [{ role: "user", content: JSON.stringify(items) }],
        temperature: 0.2,
        maxTokens: Math.min(4096, Math.ceil(totalLen / 2) + 512),
        slot: "utility",
      });
      const raw = llmText(res);
      let arr = null;
      try {
        const m = raw.match(/\[[\s\S]*\]/);
        arr = m ? JSON.parse(m[0]) : null;
      } catch {
        arr = null;
      }
      if (!Array.isArray(arr) || arr.length !== items.length) {
        return { ok: false, error: "batch_translation_malformed" };
      }
      return {
        ok: true,
        result: { translations: arr.map((x) => String(x ?? "")), targetLanguage, formality, count: arr.length },
      };
    } catch (e) {
      return { ok: false, error: "translation_unavailable", detail: String(e?.message || e) };
    }
  }, { note: "translate an array of strings in one LLM pass, order-preserving (honest fail offline)" });
}

// Exported for tests + the lens-feature manifest.
export {
  LANGUAGES,
  FORMALITIES,
  resolveLanguageName,
  detectOffline,
  badNumericField,
  MAX_TEXT_LEN,
  MAX_BATCH,
};
