// server/domains/translation.js
//
// Machine translation — the subsystem the Sci-Fi Feasibility Map flagged as
// "0 files — does not exist" (only an i18n UI provider existed). This wires
// real natural-language → natural-language translation through Concord's local
// LLM stack (no external API, no data egress — sovereignty-preserving).
//
// Macros:
//   translate  — translate text into a target language (LLM, async)
//   detect     — identify the source language of text (LLM, async)
//   batch      — translate an array of strings in one pass (LLM, async)
//   languages  — supported-language catalog (pure, utility)
//
// System prompts live in lib/prompt-registry.js (machineTranslate /
// detectSourceLanguage) per the no-inline-prompt invariant. The LLM routes to
// the local "utility" brain (fast, 65% of requests) with a "conscious" caller
// override; on LLM failure the handler returns an honest { ok:false } — it
// never fabricates a translation.

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

export default function registerTranslationActions(registerLensAction) {
  // languages — static catalog. Pure, exercised, no I/O (utility tier).
  registerLensAction("translation", "languages", (_ctx, _artifact, _params) => {
    return { ok: true, result: { languages: LANGUAGES, formalities: FORMALITIES, count: LANGUAGES.length } };
  });

  // translate — text → targetLanguage via the local LLM.
  registerLensAction("translation", "translate", async (ctx, artifact, params) => {
    const data = { ...(artifact?.data || {}), ...(params || {}) };
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

    const system = TASK_PROMPTS.machineTranslate({
      targetLanguage,
      sourceLanguage: resolveLanguageName(sourceLanguage) || "auto",
      formality,
      preserveFormatting,
    });

    try {
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
  });

  // detect — identify the source language. Returns a parsed JSON verdict.
  registerLensAction("translation", "detect", async (ctx, artifact, params) => {
    const data = { ...(artifact?.data || {}), ...(params || {}) };
    const text = typeof data.text === "string" ? data.text : "";
    if (!text.trim()) return { ok: false, error: "text required" };

    try {
      const res = await ctx.llm.chat({
        system: TASK_PROMPTS.detectSourceLanguage(),
        messages: [{ role: "user", content: text.slice(0, 2000) }],
        temperature: 0,
        maxTokens: 128,
        slot: "utility",
      });
      const raw = llmText(res);
      let parsed = null;
      try {
        const m = raw.match(/\{[\s\S]*\}/); // tolerate stray fences/prose
        parsed = m ? JSON.parse(m[0]) : null;
      } catch {
        parsed = null;
      }
      if (!parsed || !parsed.language) return { ok: false, error: "detection_unavailable", raw };
      return {
        ok: true,
        result: {
          language: String(parsed.language),
          code: parsed.code ? String(parsed.code).toLowerCase() : null,
          confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
        },
      };
    } catch (e) {
      return { ok: false, error: "detection_unavailable", detail: String(e?.message || e) };
    }
  });

  // batch — translate an array of strings, one LLM pass, order-preserving.
  registerLensAction("translation", "batch", async (ctx, artifact, params) => {
    const data = { ...(artifact?.data || {}), ...(params || {}) };
    const items = Array.isArray(data.items) ? data.items.map((x) => String(x ?? "")) : [];
    const targetLanguage = resolveLanguageName(data.targetLanguage || data.target || data.to);
    const formality = FORMALITIES.includes(data.formality) ? data.formality : "neutral";

    if (!items.length) return { ok: false, error: "items[] required" };
    if (items.length > MAX_BATCH) return { ok: false, error: `too many items (${items.length} > ${MAX_BATCH})` };
    if (!targetLanguage) return { ok: false, error: "targetLanguage required" };
    const totalLen = items.reduce((n, s) => n + s.length, 0);
    if (totalLen > MAX_TEXT_LEN) return { ok: false, error: `batch too long (${totalLen} > ${MAX_TEXT_LEN} chars)` };

    const system =
      TASK_PROMPTS.machineTranslate({ targetLanguage, formality, preserveFormatting: true }) +
      `\nThe user message is a JSON array of strings. Return ONLY a JSON array of the same length, in the same order, each element the translation of the corresponding input. No other text.`;

    try {
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
        return { ok: false, error: "batch_translation_malformed", raw };
      }
      return {
        ok: true,
        result: { translations: arr.map((x) => String(x ?? "")), targetLanguage, formality, count: arr.length },
      };
    } catch (e) {
      return { ok: false, error: "translation_unavailable", detail: String(e?.message || e) };
    }
  });
}

// Exported for tests + the lens-feature manifest.
export { LANGUAGES, FORMALITIES, resolveLanguageName, MAX_TEXT_LEN, MAX_BATCH };
