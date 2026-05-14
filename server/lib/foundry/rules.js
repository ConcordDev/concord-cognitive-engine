// server/lib/foundry/rules.js
//
// Foundry — natural-language rule composition (Phase 6).
//
// A "rule" is an authored bit of game logic: "when a player enters the
// boss arena, lock the doors". foundry.compose_rule translates the
// natural-language sentence into this structured shape, which lands in
// the worldspec's rules[] array and is compiled into
// rule_modulators.foundry.rules on publish — a stable place a future
// runtime rule-evaluator reads from. (The evaluator that *fires* these
// against live world events is its own layer; Phase 6 ships the
// composition + persistence + the schema it consumes.)
//
// Two composition paths:
//   - LLM: the utility brain translates NL -> structured rule (best
//     fidelity). Used when a brain is reachable.
//   - deterministic: a keyword/grammar fallback that runs with no LLM
//     at all. Lower confidence, but a rule with composedBy:'deterministic'
//     still carries the author's intent and is fully persisted.
// The macro always returns a usable rule — it never hard-fails on a
// brain being offline (same posture as the dream/forward-sim engines).

import { randomUUID } from "node:crypto";

// ── Vocabulary ──────────────────────────────────────────────────────────────
export const RULE_TRIGGERS = Object.freeze([
  "player_enters",   // a player enters a named region/structure
  "player_leaves",   // a player leaves one
  "on_time",         // a time interval / schedule
  "on_combat",       // combat starts / a hit lands
  "on_death",        // an entity dies
  "on_gather",       // a resource node is harvested
  "world_state",     // a world-state condition is met
  "unknown",         // couldn't classify — still stored
]);

export const RULE_EFFECTS = Object.freeze([
  "lock",       // seal a region / structure / exit
  "unlock",     // open one
  "spawn",      // spawn an entity / encounter
  "announce",   // surface a message to players
  "reward",     // grant currency / items / xp
  "modifier",   // apply a temporary world/skill modifier
  "despawn",    // remove an entity
  "unknown",
]);

const TRIGGER_KEYWORDS = [
  [/\b(enters?|arriv\w+|steps? into|walks? into)\b/i, "player_enters"],
  [/\b(leaves?|exits?|steps? out|walks? out)\b/i, "player_leaves"],
  [/\b(every|each|after \d|per (minute|hour|day)|on a timer)\b/i, "on_time"],
  [/\b(fights?|attacks?|combat|battle|strikes?)\b/i, "on_combat"],
  [/\b(dies?|death|killed|defeated|falls?)\b/i, "on_death"],
  [/\b(gathers?|harvests?|mines?|collects?)\b/i, "on_gather"],
];

const EFFECT_KEYWORDS = [
  [/\b(unlocks?|opens?|reveals?)\b/i, "unlock"], // before "lock" so "unlock" wins
  [/\b(locks?|seals?|closes?|bars?)\b/i, "lock"],
  [/\b(spawns?|summons?|appears?|emerges?)\b/i, "spawn"],
  [/\b(despawns?|removes?|vanish\w*|disappears?)\b/i, "despawn"],
  [/\b(announces?|messages?|tells?|warns?|notif\w+|broadcasts?)\b/i, "announce"],
  [/\b(rewards?|grants?|gives?|awards?|drops?)\b/i, "reward"],
  [/\b(boosts?|buffs?|debuffs?|modif\w+|increases?|decreases?|slows?|hastens?)\b/i, "modifier"],
];

// ── Helpers ─────────────────────────────────────────────────────────────────

// Words that shouldn't start (or sit inside) a target noun phrase —
// trims the deterministic extractor from drifting into the verb clause.
const TARGET_STOPWORDS = new Set([
  "player", "players", "enters", "leaves", "arrives", "exits", "fights",
  "attacks", "dies", "gathers", "harvests", "spawns", "locks", "unlocks",
  "opens", "closes", "and", "then", "when", "will", "gets", "get",
]);

/**
 * Grab a short target phrase — up to 3 words after "the" (target noun
 * phrases overwhelmingly use the definite article), stopping at the
 * first stopword. Best-effort: this is the no-LLM fallback's extractor,
 * and the rule it feeds is explicitly low-confidence.
 */
function extractTarget(text) {
  const m = text.match(/\bthe\s+([a-z][a-z'-]*(?:\s+[a-z][a-z'-]*){0,2})/i);
  if (!m) return null;
  const words = m[1].toLowerCase().split(/\s+/);
  const kept = [];
  for (const w of words) {
    if (TARGET_STOPWORDS.has(w)) break;
    kept.push(w);
  }
  return kept.length ? kept.join(" ") : null;
}

/**
 * Deterministic NL -> rule. No LLM. Keyword classification + a
 * best-effort target extraction. Confidence is intentionally modest.
 */
export function composeRuleDeterministic(naturalLanguage) {
  const nl = String(naturalLanguage || "").trim();
  let triggerKind = "unknown";
  for (const [re, kind] of TRIGGER_KEYWORDS) { if (re.test(nl)) { triggerKind = kind; break; } }
  let effectKind = "unknown";
  for (const [re, kind] of EFFECT_KEYWORDS) { if (re.test(nl)) { effectKind = kind; break; } }

  const target = extractTarget(nl);
  // Confidence: 0.55 if we classified both halves, 0.35 if one, 0.2 if neither.
  const classified = (triggerKind !== "unknown" ? 1 : 0) + (effectKind !== "unknown" ? 1 : 0);
  const confidence = classified === 2 ? 0.55 : classified === 1 ? 0.35 : 0.2;

  return {
    id: `rule_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    source: nl.slice(0, 500),
    trigger: { kind: triggerKind, target },
    effect: { kind: effectKind, target, value: null },
    confidence,
    composedBy: "deterministic",
  };
}

/**
 * Validate + normalize a rule object (whatever produced it — LLM or
 * deterministic or hand-written). Unknown trigger/effect kinds are
 * coerced to 'unknown' rather than rejected: a rule the system can't
 * fully classify is still authored intent worth keeping.
 * @returns {{ ok, rule, warnings }}
 */
export function validateRule(raw) {
  const warnings = [];
  if (!raw || typeof raw !== "object") {
    return { ok: false, rule: null, warnings: ["rule must be an object"] };
  }
  const source = String(raw.source || "").slice(0, 500);
  if (!source) return { ok: false, rule: null, warnings: ["rule has no source text"] };

  const t = raw.trigger && typeof raw.trigger === "object" ? raw.trigger : {};
  const e = raw.effect && typeof raw.effect === "object" ? raw.effect : {};
  let triggerKind = String(t.kind || "unknown");
  let effectKind = String(e.kind || "unknown");
  if (!RULE_TRIGGERS.includes(triggerKind)) { warnings.push(`trigger '${triggerKind}' -> unknown`); triggerKind = "unknown"; }
  if (!RULE_EFFECTS.includes(effectKind)) { warnings.push(`effect '${effectKind}' -> unknown`); effectKind = "unknown"; }

  const conf = Number(raw.confidence);
  const rule = {
    id: typeof raw.id === "string" && raw.id ? raw.id : `rule_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    source,
    trigger: {
      kind: triggerKind,
      target: t.target ? String(t.target).slice(0, 80) : null,
    },
    effect: {
      kind: effectKind,
      target: e.target ? String(e.target).slice(0, 80) : null,
      value: e.value ?? null,
    },
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.3,
    composedBy: raw.composedBy === "llm" ? "llm" : "deterministic",
  };
  return { ok: true, rule, warnings };
}

/**
 * The prompt used when an LLM is available. Kept here so the macro and
 * any test can share the exact contract.
 */
export function buildRulePrompt(naturalLanguage) {
  return [
    "Translate a game rule written in plain language into a strict JSON object.",
    `Triggers (pick one): ${RULE_TRIGGERS.join(", ")}`,
    `Effects (pick one): ${RULE_EFFECTS.join(", ")}`,
    'Respond with ONLY this JSON shape, no prose:',
    '{"trigger":{"kind":"...","target":"..."},"effect":{"kind":"...","target":"...","value":null}}',
    "target is a short lowercase noun phrase or null. value is a number/string or null.",
    `Rule: ${String(naturalLanguage || "").slice(0, 500)}`,
  ].join("\n");
}

/**
 * Parse an LLM response into a rule. Returns null if the model didn't
 * produce usable JSON — the caller then falls back to deterministic.
 */
export function parseRuleFromLLM(naturalLanguage, llmText) {
  if (!llmText || typeof llmText !== "string") return null;
  const match = llmText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed;
  try { parsed = JSON.parse(match[0]); } catch { return null; }
  const candidate = {
    source: naturalLanguage,
    trigger: parsed.trigger,
    effect: parsed.effect,
    confidence: 0.8,
    composedBy: "llm",
  };
  const { ok, rule } = validateRule(candidate);
  return ok ? rule : null;
}

export const RULES_INTERNALS = Object.freeze({ TRIGGER_KEYWORDS, EFFECT_KEYWORDS, extractTarget });
