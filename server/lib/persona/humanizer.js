// server/lib/persona/humanizer.js
//
// Post-generation pass that strips AI-tell phrasings and rebalances
// sentence cadence so Concord's responses don't read as median LLM
// output. Pure JS, deterministic (seeded RNG), no LLM call — runs in
// single-digit ms inside consciousChat right before the response is
// returned to the client.
//
// Three intensities are exposed:
//   light  — strip banned openers + banned phrases only
//   medium — light + tricolon break + neg-parallelism strip + burstiness
//            rebalance (the default for chat lens)
//   heavy  — medium + sentence-initial-conjunction injection + lowercase
//            selective starts (off by default; mainly for casual lenses)
//
// The pass NEVER inserts words Concord didn't generate. It transforms
// existing structure (splits long sentences at natural break points,
// merges adjacent shorts, drops filler clauses). The one exception is
// the tricolon repair, which may add or drop a single connector token.

import {
  BANNED_OPENERS,
  BANNED_PHRASES,
  TRICOLON_REGEX,
  NEG_PARALLEL_PATTERNS,
} from "./blocklists.js";
import { splitSentences } from "./idiolect-store.js";

// ── Determinism ─────────────────────────────────────────────────────────────
// xorshift32 keyed off a hash of the input text so the same response
// always humanizes the same way (regression-test stable).
function _hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}
function _rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return (x & 0xffffffff) / 0x100000000;
  };
}

// ── Stage 1: strip banned openers ───────────────────────────────────────────
function stripBannedOpeners(text, changes) {
  let working = text.trimStart();
  let stripped = true;
  let guard = 0;
  while (stripped && guard < 4) {
    stripped = false;
    guard += 1;
    const lower = working.toLowerCase();
    for (const opener of BANNED_OPENERS) {
      if (lower.startsWith(opener)) {
        // Find end of opener clause — either a sentence boundary
        // or a punctuation marker (! , ?).
        let end = opener.length;
        // Skip an immediate punctuation char.
        while (end < working.length && /[!,.?;:]/.test(working[end])) end += 1;
        while (end < working.length && /\s/.test(working[end])) end += 1;
        // Capture the rest, capitalize.
        const rest = working.slice(end);
        if (rest.length > 0) {
          working = rest[0].toUpperCase() + rest.slice(1);
          changes.push({ kind: "opener_stripped", opener });
          stripped = true;
          break;
        }
      }
    }
  }
  return working;
}

// ── Stage 2: strip banned phrases anywhere in the text ──────────────────────
function stripBannedPhrases(text, changes) {
  let out = text;
  for (const { pattern, replacement } of BANNED_PHRASES) {
    const before = out;
    out = out.replace(pattern, replacement);
    if (out !== before) {
      changes.push({ kind: "phrase_stripped", pattern: pattern.source });
    }
  }
  // Collapse the artefacts of stripping: doubled spaces, leading commas,
  // duplicate punctuation, doubled periods at sentence boundaries.
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/([.!?])\s*([.!?])+/g, "$1")
    .replace(/^[\s,;:]+/, "")
    .replace(/,\s*\./g, ".");
  return out;
}

// ── Stage 3: break tricolons ────────────────────────────────────────────────
// "fast, reliable, and affordable" → "fast and reliable" (drop the third
// item). This is the deterministic break — it loses one adjective but
// kills the rhetorical reflex. We only break tricolons made of three
// single-word adjective-ish items; longer phrases are left alone.
function breakTricolons(text, changes, rng) {
  let out = text;
  TRICOLON_REGEX.lastIndex = 0;
  out = out.replace(TRICOLON_REGEX, (match, a, b, c) => {
    // Skip if any item is long (>1 word equivalent — i.e. has spaces, but
    // since we captured single \w+ that's already enforced) OR looks like a
    // proper noun (capitalised, likely a name).
    if (/^[A-Z]/.test(a) || /^[A-Z]/.test(b) || /^[A-Z]/.test(c)) return match;
    // 50/50 — sometimes drop the third, sometimes keep the first two with
    // a period break: "fast and reliable. Affordable, too."
    const variant = rng() < 0.5 ? "drop3" : "split";
    changes.push({ kind: "tricolon_broken", items: [a, b, c], variant });
    if (variant === "drop3") {
      return `${a} and ${b}`;
    }
    return `${a} and ${b}. ${c.charAt(0).toUpperCase() + c.slice(1)}, too`;
  });
  return out;
}

// ── Stage 4: strip negative parallelism ─────────────────────────────────────
// "it's not just X, it's Y" → "it's Y" (drop the negation half).
function stripNegativeParallelism(text, changes) {
  let out = text;
  for (const pattern of NEG_PARALLEL_PATTERNS) {
    const before = out;
    out = out.replace(pattern, (m) => {
      // Replace with the trailing affirmative subject ("it's") if present.
      const lower = m.toLowerCase();
      if (lower.includes("it's") || lower.includes("its")) return "it's";
      if (lower.includes("this is")) return "this is";
      if (lower.includes("that is")) return "that is";
      if (lower.includes("they're")) return "they're";
      return "";
    });
    if (out !== before) {
      changes.push({ kind: "neg_parallel_stripped", pattern: pattern.source });
    }
  }
  return out;
}

// ── Stage 5: burstiness rebalance ───────────────────────────────────────────
// Computes std-dev of sentence lengths. If too uniform (std-dev < target),
// split the longest sentence at a natural breakpoint (comma + conjunction)
// or merge two adjacent short sentences. Adds NO new words.
const BURSTINESS_TARGET_STDDEV = 6;
const SPLIT_BREAKPOINT = /,\s+(?:and|but|so|because|though|while|which|that)\s+/i;

function rebalanceBurstiness(text, changes, _rng) {
  const sentences = splitSentences(text);
  // A flatline pattern needs at least 4 sentences — two short adjacent
  // sentences in a snappy answer are valid human cadence, not a tell.
  if (sentences.length < 4) return text;
  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  const stddev = Math.sqrt(variance);
  if (stddev >= BURSTINESS_TARGET_STDDEV) return text;

  // Find the longest sentence with a natural breakpoint.
  let mutated = false;
  const next = [...sentences];
  const sortedIdx = lengths
    .map((len, idx) => ({ len, idx }))
    .sort((a, b) => b.len - a.len)
    .map((o) => o.idx);

  for (const idx of sortedIdx) {
    const s = next[idx];
    const m = s.match(SPLIT_BREAKPOINT);
    if (!m || m.index === undefined) continue;
    const breakAt = m.index;
    const left = s.slice(0, breakAt).trim();
    const rightRaw = s.slice(breakAt + m[0].length).trim();
    if (!left || !rightRaw) continue;
    const right = rightRaw.charAt(0).toUpperCase() + rightRaw.slice(1);
    const leftFinal = /[.!?]$/.test(left) ? left : `${left}.`;
    next[idx] = leftFinal;
    next.splice(idx + 1, 0, right);
    changes.push({ kind: "burstiness_split", at: idx, lengthBefore: lengths[idx] });
    mutated = true;
    break;
  }

  if (!mutated) {
    // Fallback: merge two adjacent shortest sentences (both <8 words).
    for (let i = 0; i < next.length - 1; i++) {
      const a = next[i].split(/\s+/).length;
      const b = next[i + 1].split(/\s+/).length;
      if (a < 8 && b < 8) {
        const merged = `${next[i].replace(/[.!?]+$/, "")}; ${next[i + 1].charAt(0).toLowerCase() + next[i + 1].slice(1)}`;
        next.splice(i, 2, merged);
        changes.push({ kind: "burstiness_merge", at: i, lengths: [a, b] });
        mutated = true;
        break;
      }
    }
  }

  if (!mutated) return text;
  return next.join(" ");
}

// ── Sentence-start re-capitalisation ────────────────────────────────────────
function recapitalizeSentenceStarts(text) {
  if (!text) return text;
  let out = text;
  // First char of the whole doc.
  out = out.replace(/^(\s*)([a-z])/, (_m, ws, ch) => ws + ch.toUpperCase());
  // First char after every . ! ? boundary.
  out = out.replace(/([.!?]\s+)([a-z])/g, (_m, b, ch) => b + ch.toUpperCase());
  // First char after a newline (paragraph break).
  out = out.replace(/(\n\s*)([a-z])/g, (_m, b, ch) => b + ch.toUpperCase());
  return out;
}

// ── Stats ───────────────────────────────────────────────────────────────────
function computeVoiceStats(text) {
  const sentences = splitSentences(text);
  if (!sentences.length) {
    return { sentenceCount: 0, meanLen: 0, stddev: 0, words: 0 };
  }
  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length;
  const stddev = Math.sqrt(variance);
  const words = lengths.reduce((a, b) => a + b, 0);
  return {
    sentenceCount: sentences.length,
    meanLen: Number(mean.toFixed(2)),
    stddev: Number(stddev.toFixed(2)),
    words,
  };
}

// ── Public API ──────────────────────────────────────────────────────────────
/**
 * Humanize a response. Pure function — same input always yields same output
 * because the RNG is seeded off the text hash.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {"light"|"medium"|"heavy"} [opts.intensity="medium"]
 * @returns {{text:string, changes:Array, stats:object, intensity:string}}
 */
export function humanize(text, opts = {}) {
  const intensity = opts.intensity || "medium";
  if (!text || typeof text !== "string") {
    return { text: text || "", changes: [], stats: computeVoiceStats(""), intensity };
  }
  const seed = _hash32(text);
  const rng = _rng(seed);
  const changes = [];

  let out = text;
  out = stripBannedOpeners(out, changes);
  out = stripBannedPhrases(out, changes);

  if (intensity === "medium" || intensity === "heavy") {
    out = breakTricolons(out, changes, rng);
    out = stripNegativeParallelism(out, changes);
    out = rebalanceBurstiness(out, changes, rng);
  }

  // Final tidy: collapse trailing whitespace, normalize newlines, then
  // re-capitalize every sentence start because earlier stages may have
  // stripped a banned phrase from a sentence's head, leaving a lowercase
  // letter at the boundary.
  out = out.replace(/\s+$/g, "").replace(/\n{3,}/g, "\n\n");
  out = recapitalizeSentenceStarts(out);

  return {
    text: out,
    changes,
    stats: computeVoiceStats(out),
    intensity,
  };
}

export const HUMANIZER_INTERNALS = Object.freeze({
  BURSTINESS_TARGET_STDDEV,
  _hash32,
  _rng,
  stripBannedOpeners,
  stripBannedPhrases,
  breakTricolons,
  stripNegativeParallelism,
  rebalanceBurstiness,
  computeVoiceStats,
});
