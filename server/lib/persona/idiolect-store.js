// server/lib/persona/idiolect-store.js
//
// The Concord idiolect: distinctive sentences Concord has previously
// generated that pass the AI-tell blocklist. Persisted as `voice:idiolect`
// DTUs so the conscious-brain prompt can surface real past phrasings as
// voice exemplars. This is what makes Concord's voice grow over time
// instead of regressing to the median LLM register.
//
// All callers pass STATE / runMacro / ctx in to avoid a circular import
// with server.js.

import { isCleanVoice, scoreText } from "./blocklists.js";

const IDIOLECT_TAG = "voice:idiolect";
const MIN_WORDS = 6;
const MAX_WORDS = 40;
const MAX_PER_RESPONSE = 2;
const SAMPLE_DEFAULT = 4;

// Sentinel for abbreviation periods. A non-printable control char that
// will never appear in normal LLM output.
const ABBR_SENTINEL = "";
const ABBREVIATIONS = /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|i\.e|e\.g|cf|U\.S|U\.K)\./g;

export function splitSentences(text) {
  if (!text || typeof text !== "string") return [];
  const guarded = text.replace(ABBREVIATIONS, (m) => m.replace(/\./g, ABBR_SENTINEL));
  const raw = guarded
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/g)
    .map((s) => s.split(ABBR_SENTINEL).join(".").trim())
    .filter(Boolean);
  return raw;
}

const DISTINCT_HINTS = [
  /^(?:And|But|So|Yet|Or|Because|Still|Honestly|Look|Listen|Yeah|No),?\s/,
  / - /,
  /\bI (?:think|don'?t|won'?t|can'?t|wouldn'?t|wonder|notice|suspect)\b/i,
  /\b(?:honestly|frankly|actually|maybe|probably)\b/i,
  /\?$/,
  /\b[A-Z][a-z]+ [A-Z][a-z]+\b/,
];

function distinctnessScore(sentence) {
  let s = 0;
  for (const re of DISTINCT_HINTS) {
    if (re.test(sentence)) s += 1;
  }
  return s;
}

/**
 * Given a response text, return up to MAX_PER_RESPONSE sentences that:
 *   - have MIN_WORDS..MAX_WORDS words
 *   - pass isCleanVoice (zero blocklist hits)
 *   - score >= 1 on distinctnessScore
 * Returns highest-scoring first.
 */
export function extractIdiolectCandidates(text) {
  if (!text || typeof text !== "string") return [];
  const sentences = splitSentences(text);
  const scored = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount < MIN_WORDS || wordCount > MAX_WORDS) continue;
    if (!isCleanVoice(sentence)) continue;
    const ds = distinctnessScore(sentence);
    if (ds < 1) continue;
    scored.push({ sentence, score: ds, length: wordCount });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_PER_RESPONSE);
}

/**
 * Persist idiolect candidates from a response. Each candidate becomes a
 * standalone DTU tagged `voice:idiolect`.
 *
 * @param {object} args
 * @param {Function} args.runMacro
 * @param {object}   args.ctx
 * @param {string}   args.response
 * @param {string}   [args.userId]
 * @param {string}   [args.lens]
 * @returns {Promise<Array<{sentence:string, dtuId?:string}>>}
 */
export async function persistIdiolect({ runMacro, ctx, response, userId, lens }) {
  const candidates = extractIdiolectCandidates(response);
  if (!candidates.length || typeof runMacro !== "function") return [];
  const out = [];
  for (const c of candidates) {
    try {
      const result = await runMacro("dtu", "create", {
        title: `Voice: ${c.sentence.slice(0, 72)}`,
        creti: c.sentence,
        tags: [IDIOLECT_TAG, "persona", lens].filter(Boolean),
        source: "persona.idiolect",
        meta: {
          voiceScore: c.score,
          wordCount: c.length,
          observedFromUserId: userId || null,
          observedAt: Date.now(),
          contentType: "voice-exemplar",
        },
      }, ctx);
      out.push({ sentence: c.sentence, dtuId: result?.id || result?.dtuId || null });
    } catch (_e) {
      out.push({ sentence: c.sentence, dtuId: null });
    }
  }
  return out;
}

/**
 * Pull N voice exemplars from STATE.dtus. Strategy:
 *   - filter by `voice:idiolect` tag
 *   - prefer recent (last 30 days), include some older for stable identity
 *   - return raw sentence text only
 */
export function getIdiolectSamples({ STATE, n = SAMPLE_DEFAULT, now = Date.now } = {}) {
  if (!STATE?.dtus || typeof STATE.dtus.values !== "function") return [];
  const all = [];
  for (const dtu of STATE.dtus.values()) {
    const tags = Array.isArray(dtu.tags) ? dtu.tags : [];
    if (!tags.includes(IDIOLECT_TAG)) continue;
    const text = (dtu.creti || dtu.content || dtu.title || "").trim();
    if (!text) continue;
    if (scoreText(text) > 0) continue;
    const observedAt = dtu.meta?.observedAt || dtu.createdAt || dtu.created_at || 0;
    all.push({ text, observedAt });
  }
  if (!all.length) return [];
  all.sort((a, b) => (b.observedAt || 0) - (a.observedAt || 0));
  const cutoff = (typeof now === "function" ? now() : Date.now()) - 30 * 24 * 60 * 60 * 1000;
  const recent = all.filter((x) => (x.observedAt || 0) >= cutoff);
  const older = all.filter((x) => (x.observedAt || 0) < cutoff);
  const targetRecent = Math.min(recent.length, Math.ceil(n * 0.7));
  const targetOlder = Math.min(older.length, n - targetRecent);
  const picked = [...recent.slice(0, targetRecent), ...older.slice(0, targetOlder)];
  const seen = new Set();
  const result = [];
  for (const p of picked) {
    if (seen.has(p.text)) continue;
    seen.add(p.text);
    result.push(p.text);
    if (result.length >= n) break;
  }
  return result;
}

export const IDIOLECT_INTERNALS = Object.freeze({
  IDIOLECT_TAG,
  MIN_WORDS,
  MAX_WORDS,
  MAX_PER_RESPONSE,
  SAMPLE_DEFAULT,
  distinctnessScore,
});
