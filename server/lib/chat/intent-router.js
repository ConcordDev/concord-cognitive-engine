// server/lib/chat/intent-router.js
//
// RQ3 — lightweight, deterministic chat-intent classifier.
//
// Concord's chat path today either (a) always runs the message through
// the conscious brain, optionally pre-seeded with real compute results
// by `chat-compute-preflight.js`'s keyword-scored `compute-registry.js`
// pass, or (b) escalates research-grade prompts to the Oracle Engine via
// `chat-router.js#detectOracleIntent`. Neither of those is a general
// three-way "what KIND of request is this" classification — they're
// both narrower, single-purpose heuristics layered onto the same chat
// turn. This module adds that general classification as a small,
// standalone, dependency-light building block: `classifyIntent(text)`
// returns one of three coarse buckets so a caller (chat path, ConKay,
// an agent loop, a future router) can decide what to do with a message
// BEFORE spending an LLM call on it — the same "compute-don't-guess"
// principle CLAUDE.md documents for math/FEA/economy/combat, applied to
// the routing decision itself.
//
// This is intentionally NOT an LLM call. It is pure string/regex
// matching — microseconds, no network, no brain-availability
// dependency, always available even when every Ollama instance is down.
//
// Buckets:
//   - "deterministic-engine": the message is unambiguously asking for a
//     computation the codebase has a REAL engine for (today: `math` via
//     `domains/math.js`'s CAS, `fea` via `lib/simulation/fea-solver.js`'s
//     beam-frame solver). Carries `engineHint`.
//   - "tool-action": the message names a macro/domain action the
//     platform already has (e.g. "create a DTU about X", "search my
//     archive for Y"). Carries `domainHint` when a specific lens/domain
//     is recognized.
//   - "language": everything else — the default/fallback for open-ended
//     conversation, research questions, opinions, stories.
//
// Conservatism policy (the load-bearing invariant): a FALSE NEGATIVE
// (falling through to "language" for a message that actually was
// computable) is harmless — the brain still answers, just without a
// pre-computed shortcut. A FALSE POSITIVE (routing a genuine language
// question at an engine that can't handle it, or worse, silently
// returning a wrong/garbage "ground truth") is not — it would inject
// authoritative-looking nonsense ahead of the brain's own reasoning.
// Every deterministic-engine pattern below therefore requires an
// unambiguous *computational shape* (an equation, a bare arithmetic
// expression, a named CAS verb + expression, or a conjunction of two
// independent structural-analysis signals) — never a single topic
// keyword. When a message could plausibly go either way, this module
// returns "language". See `classifyIntent`'s doc comment for the exact
// per-bucket reasoning, and the "biased conservative" test in
// `server/tests/chat-intent-router.test.js` for a concrete example of
// the policy in action.

import { LENS_FEATURES } from "../lens-features.js";

// ── deterministic-engine: math ──────────────────────────────────────────────
//
// Three narrow, unambiguous shapes — not "any message with a number":
//
//   1. A bare arithmetic expression, optionally preceded by a "what
//      is"/"calculate"/"compute"/"evaluate" lead-in and a trailing "?".
//      After stripping the lead-in and the "?", the remainder must
//      contain ONLY digits/operators/whitespace/parens — this is what
//      keeps "what is the meaning of life" (no operators at all) and
//      "what is 5 apples worth" (contains letters) from matching.
//   2. "solve <anything> = <anything>" — the "=" is the one signal that
//      unambiguously marks a message as an equation to solve rather
//      than prose that happens to contain the word "solve" ("solve
//      world hunger" has no "=" and correctly falls through).
//   3. A named CAS verb (derivative/integral/differentiate/simplify/
//      factorize/etc.) whose argument, after the verb, is itself
//      expression-shaped (letters/digits/operators only — no sentence
//      punctuation, no "and", no question words). This excludes
//      "simplify my life" (argument isn't expression-shaped) while
//      still catching "simplify 2x + 4x" and "derivative of x^2 + 3x".

const _MATH_LEAD_RE = /^(?:what(?:'s|\s+is)|calculate|compute|evaluate)\s+/i;
const _TRAILING_PUNCT_RE = /[?.!]+$/;
const _BARE_ARITH_RE = /^[\d\s.+\-*/^()%]+$/; // digits + operators only, no letters
const _HAS_DIGIT_RE = /\d/;
const _HAS_OPERATOR_RE = /[+\-*/^%]/;

const _SOLVE_EQ_RE = /\bsolve\b.+=.+/i;

const _CAS_VERB_RE =
  /\b(?:derivative of|differentiate|integrate|integral of|antiderivative of|factorize|factorise|simplify|expand)\s+([a-z0-9\s.+\-*/^()!]+)$/i;
const _EXPR_SHAPE_RE = /^[a-z0-9\s.+\-*/^()!]+$/i;

function detectMath(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // (1) bare arithmetic, optional lead-in / trailing punctuation stripped
  const stripped = trimmed.replace(_MATH_LEAD_RE, "").replace(_TRAILING_PUNCT_RE, "").trim();
  if (
    stripped.length > 0 &&
    _HAS_DIGIT_RE.test(stripped) &&
    _HAS_OPERATOR_RE.test(stripped) &&
    _BARE_ARITH_RE.test(stripped)
  ) {
    return { engineHint: "math", confidence: 0.95, matched: "bare-arithmetic" };
  }

  // (2) explicit "solve ... = ..."
  if (_SOLVE_EQ_RE.test(trimmed)) {
    return { engineHint: "math", confidence: 0.9, matched: "solve-equation" };
  }

  // (3) CAS verb + expression-shaped argument
  const casMatch = trimmed.match(_CAS_VERB_RE);
  if (casMatch && _EXPR_SHAPE_RE.test(casMatch[1].trim()) && casMatch[1].trim().length > 0) {
    return { engineHint: "math", confidence: 0.85, matched: "cas-verb" };
  }

  return null;
}

// ── deterministic-engine: fea (structural / beam-frame analysis) ───────────
//
// Requires BOTH a structural-member noun (beam/truss/frame/cantilever/
// column/girder) AND a structural-analysis noun/verb (stress/deflection/
// load/moment/stiffness/shear/bending/analy[sz]e) in the same message.
// Neither alone is safe: "beam" alone could be a flashlight beam or a
// smile ("beaming"); "load" alone is everyday language ("that's a lot to
// load on you"). The conjunction of an unrelated structural noun AND an
// unrelated analysis term is what makes the combination unambiguous —
// real beam-FEA questions name both; casual language rarely does.

const _FEA_STRUCT_NOUN_RE = /\b(beam|truss|frame|cantilever|column|girder|structural member)\b/i;
const _FEA_ANALYSIS_RE = /\b(stress|deflection|load|moment|stiffness|shear|bending|analy[sz]e|analysis)\b/i;

function detectFea(text) {
  if (_FEA_STRUCT_NOUN_RE.test(text) && _FEA_ANALYSIS_RE.test(text)) {
    return { engineHint: "fea", confidence: 0.8, matched: "structural-conjunction" };
  }
  return null;
}

// ── tool-action ──────────────────────────────────────────────────────────
//
// Reuses the REAL domain vocabulary already catalogued in
// `lens-features.js` (`LENS_FEATURES`'s keys — the same lens roster
// `score-lenses` and the manifest use) instead of hand-rolling a second,
// driftable domain list. `dtu`/`archive`/`marketplace` are added
// explicitly because they're core platform nouns that aren't themselves
// lens ids in `LENS_FEATURES` (DTUs are the atomic substrate every lens
// shares, not a lens of their own).
//
// A message only matches when an ACTION VERB and a KNOWN NOUN both
// appear — "tell me about the market" has the noun but no action verb
// (that's a language/QUERY-shaped ask, not a create/search/list
// command), so it correctly falls through. "search my archive for
// recipes" has both → tool-action.

const _TOOL_ACTION_VERBS = [
  "create", "make", "search", "find", "browse", "list",
  "open", "start", "generate", "build", "publish", "post",
];
const _TOOL_VERB_RE = new RegExp(`\\b(${_TOOL_ACTION_VERBS.join("|")})\\b`, "i");

function _escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let _toolNouns = null;
function _toolActionNouns() {
  if (_toolNouns) return _toolNouns;
  const nouns = new Set(["dtu", "dtus", "archive", "marketplace"]);
  try {
    for (const key of Object.keys(LENS_FEATURES || {})) {
      if (key && key.length >= 3) nouns.add(key.toLowerCase());
    }
  } catch {
    // LENS_FEATURES import failed for some reason — fall back to the
    // small hardcoded core-noun set above rather than throwing.
  }
  _toolNouns = nouns;
  return _toolNouns;
}

function detectToolAction(text) {
  if (!_TOOL_VERB_RE.test(text)) return null;
  const lower = text.toLowerCase();
  for (const noun of _toolActionNouns()) {
    const re = new RegExp(`\\b${_escapeRe(noun)}\\b`, "i");
    if (re.test(lower)) {
      return { domainHint: noun, confidence: 0.6, matched: "verb-noun-pair" };
    }
  }
  return null;
}

/**
 * Classify a chat message into one of three coarse intents.
 *
 * @param {string} messageText
 * @returns {{ intent: 'deterministic-engine'|'tool-action'|'language',
 *             engineHint?: string, domainHint?: string, confidence: number }}
 */
export function classifyIntent(messageText) {
  const text = typeof messageText === "string" ? messageText : String(messageText || "");
  const trimmed = text.trim();

  if (!trimmed) {
    return { intent: "language", confidence: 1.0 };
  }

  // Deterministic-engine checks first — the most specific, highest-precision
  // signals (an equation, a bare expression, a structural conjunction) beat
  // the broader tool-action verb/noun check when both could theoretically
  // fire on the same message (rare in practice, but math/FEA is the more
  // load-bearing "don't let the LLM guess" case per CLAUDE.md).
  const math = detectMath(trimmed);
  if (math) {
    return { intent: "deterministic-engine", engineHint: math.engineHint, confidence: math.confidence };
  }

  const fea = detectFea(trimmed);
  if (fea) {
    return { intent: "deterministic-engine", engineHint: fea.engineHint, confidence: fea.confidence };
  }

  const tool = detectToolAction(trimmed);
  if (tool) {
    return { intent: "tool-action", domainHint: tool.domainHint, confidence: tool.confidence };
  }

  // Default / fallback — the conservative-safe bucket. Every ambiguous
  // or unrecognized shape lands here, never at an engine.
  return { intent: "language", confidence: 0.5 };
}

export const INTENT_ROUTER_INTERNAL = Object.freeze({
  detectMath,
  detectFea,
  detectToolAction,
});
