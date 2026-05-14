// server/lib/persona/blocklists.js
//
// Canonical AI-tell blocklists distilled from the May 2026 detection-tells
// research. Used by the humanizer (post-generation) and surfaced into the
// conscious-brain prompt (pre-generation). Keep this file the single source
// of truth — both layers import from here so the surface stays consistent.

// ── 1. Sentence-initial openers ─────────────────────────────────────────────
// If a response begins with any of these (case-insensitive, leading
// punctuation trimmed), strip the opener.
export const BANNED_OPENERS = Object.freeze([
  "certainly",
  "absolutely",
  "great question",
  "great point",
  "excellent question",
  "fantastic question",
  "of course",
  "sure thing",
  "i'd be happy to",
  "i'd be glad to",
  "i hope this message finds you well",
  "in today's fast-paced world",
  "in this article",
  "in this response",
  "as an ai",
  "as a language model",
  "as a large language model",
]);

// ── 2. Phrase reflexes (hedges, transitions, closers) ───────────────────────
// Detected anywhere in the text. Each entry is { pattern, replacement }.
// Replacement empty string = strip outright. The pattern is matched
// case-insensitive with word boundaries; the humanizer collapses doubled
// spaces and orphaned punctuation after stripping.
export const BANNED_PHRASES = Object.freeze([
  { pattern: /\bit'?s important to note that\b/gi, replacement: "" },
  { pattern: /\bit is important to note that\b/gi, replacement: "" },
  { pattern: /\bit'?s worth (?:mentioning|noting) that\b/gi, replacement: "" },
  { pattern: /\bit is worth (?:mentioning|noting) that\b/gi, replacement: "" },
  { pattern: /\bplease (?:note|be aware) that\b/gi, replacement: "" },
  { pattern: /\bkeep in mind that\b/gi, replacement: "" },
  { pattern: /\bit'?s essential to (?:remember|understand) that\b/gi, replacement: "" },
  { pattern: /\bi hope (?:this|that) helps\b[.!]?/gi, replacement: "" },
  { pattern: /\bfeel free to ask\b[^.!?\n]*[.!?]?/gi, replacement: "" },
  { pattern: /\blet me know if (?:you have|there are) any (?:other |further )?questions\b[.!]?/gi, replacement: "" },
  { pattern: /\bin conclusion,?\s*/gi, replacement: "" },
  { pattern: /\bto (?:sum up|summarize),?\s*/gi, replacement: "" },
  { pattern: /\bultimately,?\s*/gi, replacement: "" },
  { pattern: /\bin essence,?\s*/gi, replacement: "" },
  { pattern: /\bmoreover,?\s*/gi, replacement: "" },
  { pattern: /\bfurthermore,?\s*/gi, replacement: "" },
  { pattern: /\badditionally,?\s*/gi, replacement: "" },
  { pattern: /\bi'?m just an ai\b[^.!?\n]*[.!?]?/gi, replacement: "" },
  { pattern: /\bas requested,?\s*/gi, replacement: "" },
  { pattern: /\bas mentioned (?:above|earlier|previously),?\s*/gi, replacement: "" },
]);

// ── 3. Tell words ───────────────────────────────────────────────────────────
// Words with disproportionate appearance in LLM output vs human writing.
// The humanizer does NOT auto-substitute these (substitution would mangle
// meaning); instead they're surfaced into the conscious prompt as a
// don't-use list. We also expose `scoreText` so the idiolect-store can
// reject candidate sentences containing them.
export const TELL_WORDS = Object.freeze([
  "delve",
  "delving",
  "tapestry",
  "navigate",
  "navigating",
  "leverage",
  "leveraging",
  "utilize",
  "utilizing",
  "harness",
  "harnessing",
  "streamline",
  "streamlining",
  "underscore",
  "underscores",
  "elevate",
  "embark",
  "unlock",
  "unveil",
  "embrace",
  "foster",
  "robust",
  "pivotal",
  "seamless",
  "seamlessly",
  "innovative",
  "cutting-edge",
  "holistic",
  "multifaceted",
  "intricate",
  "vibrant",
  "profound",
  "noteworthy",
  "versatile",
  "commendable",
  "comprehensive",
  "landscape",
  "realm",
  "synergy",
  "testament",
  "underpinnings",
  "ecosystem",
  "myriad",
  "plethora",
]);

// ── 4. Tricolon patterns ────────────────────────────────────────────────────
// Three-item lists with parallel structure: "fast, reliable, and affordable".
// Detected via regex on the OXFORD-COMMA shape: `, X, and X[.,;]`. We don't
// break ALL three-item lists (some are factual); only ones with adjective-
// like single-word items that read as rhetorical filler.
export const TRICOLON_REGEX = /\b((?:\w+)),\s+((?:\w+)),\s+and\s+((?:\w+))(?=[\s.,;:!?]|$)/g;

// ── 5. Negative parallelism ─────────────────────────────────────────────────
// "It's not just X, it's Y" / "X isn't merely Y, it's Z".
// One of Bloomberry's top-4 structural fingerprints.
export const NEG_PARALLEL_PATTERNS = Object.freeze([
  /\b(it'?s|this is|that is|they'?re) not just\b/gi,
  /\b(it'?s|this is|that is|they'?re) not merely\b/gi,
  /\b(?:isn'?t|aren'?t|wasn'?t|weren'?t) just (?:a |an |the )?\w+,?\s+(?:it'?s|they'?re|this is)\b/gi,
]);

// ── 6. Helpers ──────────────────────────────────────────────────────────────

/**
 * Score a sentence for AI-tell density. Lower = more human-sounding.
 * Returns an integer count of tell-words + banned-phrase hits.
 */
export function scoreText(text) {
  if (!text || typeof text !== "string") return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const w of TELL_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, "g");
    const matches = lower.match(re);
    if (matches) score += matches.length;
  }
  for (const { pattern } of BANNED_PHRASES) {
    pattern.lastIndex = 0;
    const m = lower.match(new RegExp(pattern.source, pattern.flags));
    if (m) score += m.length;
  }
  for (const opener of BANNED_OPENERS) {
    if (lower.trimStart().startsWith(opener)) {
      score += 1;
      break;
    }
  }
  return score;
}

/**
 * Returns true if the text contains zero tell-words and zero banned phrases.
 * Used by the idiolect-store to decide which Concord sentences are
 * voice-faithful enough to preserve as exemplars.
 */
export function isCleanVoice(text) {
  return scoreText(text) === 0;
}
