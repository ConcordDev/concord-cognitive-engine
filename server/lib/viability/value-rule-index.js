// server/lib/viability/value-rule-index.js
//
// Wave 4 — NPC ethics (#16): the sharpest "we already have it" win. The corpus
// loads ~1,000 kind:'rule' value-DTUs (the part-3b introspection/culture rules:
// principle_of_charity, harm_minimization_under_constraint,
// consent_boundary_respect, de_escalation_before_optimization,
// reversible_action_preference, …) into STATE.dtus — but nothing reads them for
// behavior. This indexes them and turns them into a deterministic, bounded
// bias on NPC decisions, COMPOSING WITH existing gates (never replacing them).
//
// Pure, no-LLM, never-throws. Behind CONCORD_VIABILITY_ETHICS at the callers.
// When the corpus carries no restraint rules (a minimal build), every score is
// 0 → today's behavior exactly.

import crypto from "node:crypto";

export function ethicsEnabled() {
  return process.env.CONCORD_VIABILITY_ETHICS === "1";
}

// Keyword → class. RESTRAINT-class rules counsel against hostile, often
// irreversible, non-consensual harm — exactly the scheme decision. The regex is
// grounded in the actual corpus semantic-tag vocabulary (156 restraint tags
// verified: harm_minimization_under_constraint, consent_boundary_respect,
// de_escalation_before_optimization, reversible_action_preference, …).
const RESTRAINT_RE = /harm|consent|de_?escalat|reversible|charity|non_?aggress|minimiz|repair|mercy|forgiv|peace|cooperat|trust|fair|protect|\bcare|legitimacy|restraint/i;
const HOSTILE_RE = /domin|coerc|exploit|deceiv|retaliat|vengeance|punish/i; // rare here, classified for completeness

export function classifyRule(tags = []) {
  for (const t of tags) {
    if (t === "introspection" || t === "culture" || /^introspection_\d+$/.test(t)) continue;
    if (RESTRAINT_RE.test(t)) return "restraint";
    if (HOSTILE_RE.test(t)) return "hostile";
  }
  return "epistemic";
}

function semanticTag(tags = []) {
  return tags.find((t) => t !== "introspection" && t !== "culture" && !/^introspection_\d+$/.test(t)) || null;
}

function asArray(dtus) {
  if (!dtus) return [];
  if (dtus instanceof Map) return [...dtus.values()];
  if (Array.isArray(dtus)) return dtus;
  if (typeof dtus.values === "function") { try { return [...dtus.values()]; } catch { return []; } }
  return [];
}

/**
 * Build an in-memory index of value-rule DTUs.
 * @returns {{ size:number, restraintCount:number, rules:object[], byClass:{restraint:object[],hostile:object[],epistemic:object[]} }}
 */
export function buildValueRuleIndex(dtus) {
  const out = { size: 0, restraintCount: 0, rules: [], byClass: { restraint: [], hostile: [], epistemic: [] } };
  for (const d of asArray(dtus)) {
    const kind = d?.machine?.kind || d?.machineKind || d?.meta?.machineKind;
    if (kind !== "rule") continue;
    const tags = d.tags || [];
    const cls = classifyRule(tags);
    const rule = {
      id: d.id,
      tag: semanticTag(tags),
      cls,
      summary: d?.human?.summary || "",
      invariant: (d?.core?.invariants || [])[0] || "",
    };
    out.rules.push(rule);
    (out.byClass[cls] || out.byClass.epistemic).push(rule);
    out.size++;
    if (cls === "restraint") out.restraintCount++;
  }
  return out;
}

// Memoized shared index (the corpus is static at runtime). Rebuilds only if the
// corpus size changes.
let _shared = null;
let _sharedSize = -1;
export function getSharedValueRuleIndex(dtus) {
  const arr = asArray(dtus);
  if (_shared && _sharedSize === arr.length) return _shared;
  _shared = buildValueRuleIndex(dtus);
  _sharedSize = arr.length;
  return _shared;
}

// Deterministic [0,1) hash for per-NPC variation.
function hashFloat(s) {
  const h = crypto.createHash("sha1").update(String(s)).digest();
  return ((h[0] << 16) | (h[1] << 8) | h[2]) / 0x1000000;
}
const clamp01 = (x) => Math.max(0, Math.min(1, x));

const PROSOCIAL_ARCHETYPES = new Set(["healer", "scholar", "mystic", "guard", "elder", "priest", "diplomat", "teacher", "monk", "sage"]);
const HOSTILE_COPING = new Set(["cruel", "paranoid", "reckless"]);

export const ETHICS_REFUSE_THRESHOLD = 0.6;

/**
 * How strongly does this NPC internalize harm-minimization / restraint?
 * Derived from disposition (prosocial archetype ↑, hostile coping ↓) + a
 * deterministic per-NPC selection over the restraint corpus, citing a real
 * rule for provenance. No restraint rules in the corpus → score 0 (no effect).
 *
 * @returns {{ score:number, citedRule:{id,tag,invariant}|null }}
 */
export function npcSchemeRestraint(index, npc = {}) {
  if (!index || index.restraintCount === 0) return { score: 0, citedRule: null };
  let r = 0.35; // baseline civility
  if (PROSOCIAL_ARCHETYPES.has(npc.archetype)) r += 0.4;
  if (HOSTILE_COPING.has(npc.coping_trait)) r -= 0.5;
  r += (hashFloat(npc.id || "") - 0.5) * 0.3; // ±0.15 per-individual
  r = clamp01(r);
  const pool = index.byClass.restraint;
  const cited = pool[Math.floor(hashFloat(`${npc.id || ""}:cite`) * pool.length)] || pool[0] || null;
  return { score: r, citedRule: cited ? { id: cited.id, tag: cited.tag, invariant: cited.invariant } : null };
}

/**
 * selectRules — rank rules by word-overlap between their semantic tag and a
 * context tag list (faction / aid-betray hooks use this). Deterministic.
 */
export function selectRules(index, ctxTags = [], k = 5) {
  if (!index) return [];
  const ctx = new Set(ctxTags.map((t) => String(t).toLowerCase()));
  return index.rules
    .map((rule) => {
      const tagWords = String(rule.tag || "").toLowerCase().split(/[_\s]+/);
      const overlap = tagWords.filter((w) => ctx.has(w)).length;
      return { rule, overlap };
    })
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap || String(a.rule.id).localeCompare(String(b.rule.id)))
    .slice(0, k)
    .map((x) => x.rule);
}

const HOSTILE_CHOICES = new Set(["scheme", "raid", "declare_war", "assassinate", "blackmail", "attack", "betray"]);
const COOP_CHOICES = new Set(["truce", "alliance", "tribute", "aid", "help", "propose_alliance", "seek_truce", "rebuild", "consolidate"]);

/**
 * ruleBias — additive, bounded per-choice bias from a set of selected rules.
 * Restraint rules push hostile choices down, cooperative choices up. Bounded to
 * ±0.3 so it can shade an additive-RNG decision but never dominate it.
 */
export function ruleBias(rules = [], choiceSet = [], weight = 1.0) {
  const restraint = rules.filter((r) => r.cls === "restraint").length;
  const mag = Math.min(0.3, restraint * 0.06) * weight;
  const out = {};
  for (const c of choiceSet) {
    const k = String(c).toLowerCase();
    if (HOSTILE_CHOICES.has(k)) out[c] = -mag;
    else if (COOP_CHOICES.has(k)) out[c] = +mag;
    else out[c] = 0;
  }
  return out;
}
