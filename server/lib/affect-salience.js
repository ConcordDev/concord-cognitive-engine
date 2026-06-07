// server/lib/affect-salience.js
//
// Wave 7 / Layer 5 — the SALIENCE INTERRUPT as a constraint-ladder. This is the
// centerpiece and the whole cost story: deliberation (an expensive LLM call) is NOT
// gated on a single threshold — it's the cheapest-first ladder
//
//     route-around (tier 1)  →  abandon/repick goal (tier 2)  →  deliberate (tier 3)
//
// ~95% of ticks resolve at tier 1/2 with pure arithmetic and ZERO LLM cost; the
// brain wakes ONLY at tier 3, the genuine irreducible dilemma. "Feeling decides
// when to think." A whole village runs on instinct for free; the rare dilemma pays.
//
// Three constraint streams fold into one detector (the intertwining — Track B7):
//   need     — an internal threshold crossed (hunger urgent, FEAR spike)
//   obstacle — an external affordance blocking the current goal
//   agent    — another agent's executing plan colliding with mine (last bread taken)
//
// Temperament (A3b copingStyle) bends the ladder: a bold/proactive agent pushes
// through (tier 1, wider route search) before abandoning; a shy/reactive one
// freezes/abandons sooner (tier 2). Same constraint, different branch by personality.
//
// Pure + total (except the token-bucket budget, which is an explicit stateful object
// with an injectable clock). Kill-switch CONCORD_AFFECT_SALIENCE=0 is enforced by the
// CALLER (this lib is gate logic; the wire ANDs it in front of existing *_LLM gates).
//
//   detectConstraint(self, world, others)  -> { kind, ref, severity } | null
//   resolveConstraint(constraint, ctx)     -> { tier, action, reason }
//   shouldEscalate(current, prior, opts)   -> { escalate, reason, score }
//   makeEscalationBudget({ perWorldPerMin })-> { tryConsume, peek, _state }

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// thresholds (env-tunable by the caller, defaults here)
const NEED_URGENT = 0.7;        // a need deficit at/above this is a constraint
const DRIVE_SPIKE = 0.3;        // a drive jump of this much in one step = drive_spike
const VALENCE_DROP = 0.4;       // a valence fall of this much = valence_shock
const AROUSAL_HIGH = 0.7;       // crossing into this arousal band = arousal_band
const NOVELTY_HI = 0.7;         // novelty score at/above this escalates
const SHY_BIAS = -0.25;         // proactiveReactive below this → abandon-sooner
const BOLD_BIAS = 0.25;         // proactiveReactive above this → push-through-harder

/**
 * Fold the three constraint streams into the single most-pressing constraint, or
 * null when the agent's world is clear (the common case — a free tick). Total.
 *
 * @param {object} self   { needs?:{...}, goal?:{ resource? } }
 * @param {object} world  { obstacle?:{ id, severity }, blockedGoal?:bool }
 * @param {Array}  others [{ id, collides?:bool, claimsResource?, severity? }]
 */
export function detectConstraint(self = {}, world = {}, others = []) {
  const s = self || {};
  const candidates = [];

  // 1. need stream — the most urgent internal deficit
  const needs = s.needs || {};
  let needRef = null, needSev = 0;
  for (const k of Object.keys(needs)) {
    const d = clamp01(needs[k]);
    if (d >= NEED_URGENT && d > needSev) { needSev = d; needRef = k; }
  }
  if (needRef) candidates.push({ kind: "need", ref: needRef, severity: needSev });

  // 2. obstacle stream — an external affordance blocking the current goal
  const w = world || {};
  if (w.obstacle && (w.obstacle.id || w.obstacle.severity != null)) {
    candidates.push({ kind: "obstacle", ref: w.obstacle.id ?? "obstacle", severity: clamp01(w.obstacle.severity ?? 0.6) });
  } else if (w.blockedGoal) {
    candidates.push({ kind: "obstacle", ref: "blocked_goal", severity: 0.6 });
  }

  // 3. agent stream — another agent's plan colliding with mine
  const list = Array.isArray(others) ? others : [];
  for (const o of list) {
    if (!o) continue;
    const collides = o.collides === true
      || (o.claimsResource != null && s.goal && o.claimsResource === s.goal.resource);
    if (collides) candidates.push({ kind: "agent", ref: o.id ?? "agent", severity: clamp01(o.severity ?? 0.5) });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.severity - a.severity);
  return candidates[0];
}

/**
 * Walk the constraint-ladder for one detected constraint. Returns the cheapest tier
 * that resolves it. Temperament (ctx.coping) bends the branch. Pure + total.
 *
 * @param {object} constraint  output of detectConstraint
 * @param {object} ctx  {
 *    hasRouteAround?:bool,   // a deterministic detour/defer exists
 *    hasFallbackGoal?:bool,  // another goal can be popped
 *    coping?:{ boldShy, proactiveReactive },  // A3b copingStyle
 * }
 * @returns {{ tier:1|2|3, action:'route_around'|'abandon'|'escalate', reason:string }}
 */
export function resolveConstraint(constraint, ctx = {}) {
  if (!constraint) return { tier: 0, action: "noop", reason: "no_constraint" };
  const c = ctx || {};
  const coping = c.coping || {};
  const pr = Number(coping.proactiveReactive) || 0;
  const shy = pr <= SHY_BIAS;
  const bold = pr >= BOLD_BIAS;

  const hasRoute = !!c.hasRouteAround;
  const hasFallback = !!c.hasFallbackGoal;

  // A shy/reactive agent abandons sooner: if it has a fallback goal it bails to it
  // rather than pushing through an obstacle (freeze/flee temperament). A need
  // constraint is never "abandoned away" — you can't repick your way out of hunger —
  // so the shy short-circuit only applies to obstacle/agent constraints.
  if (shy && hasFallback && constraint.kind !== "need") {
    return { tier: 2, action: "abandon", reason: "shy_abandon" };
  }

  // Tier 1 — route around. A bold/proactive agent searches wider, so it route-arounds
  // even when only a "maybe" path exists (ctx.maybeRouteAround).
  if (hasRoute || (bold && c.maybeRouteAround)) {
    return { tier: 1, action: "route_around", reason: bold && !hasRoute ? "bold_pushthrough" : "route_exists" };
  }

  // Tier 2 — abandon and pop the next goal (deterministic arbitration). Again, a
  // need can't be abandoned — a hungry agent with no food path is a real dilemma.
  if (hasFallback && constraint.kind !== "need") {
    return { tier: 2, action: "abandon", reason: "repick_goal" };
  }

  // Tier 3 — genuine dilemma: can't route around AND can't trivially abandon.
  return { tier: 3, action: "escalate", reason: "dilemma" };
}

/**
 * The tier-3 gate, as pure arithmetic over the affect/drive transition. Fires when a
 * real dilemma is present OR affect moved sharply (a spike worth thinking about).
 * Returns the strongest reason. Total.
 *
 * @param {object} current { affect?:{v,a}, drives?:{...}, constraintTier?:number }
 * @param {object} prior   previous { affect, drives }
 * @param {object} opts    { novelty?:0..1 } + threshold overrides
 */
export function shouldEscalate(current = {}, prior = {}, opts = {}) {
  const cur = current || {};
  const pre = prior || {};
  const curA = cur.affect || {};
  const preA = pre.affect || {};
  const o = opts || {};

  const reasons = [];

  // dilemma — the ladder bottomed out
  if (Number(cur.constraintTier) >= 3) reasons.push(["dilemma", 1.0]);

  // drive_spike — any Panksepp drive jumped
  const curD = cur.drives || {};
  const preD = pre.drives || {};
  let maxDelta = 0, spiked = null;
  for (const k of Object.keys(curD)) {
    const d = clamp01(curD[k]) - clamp01(preD[k] ?? curD[k]);
    if (d > maxDelta) { maxDelta = d; spiked = k; }
  }
  if (maxDelta >= (o.driveSpike ?? DRIVE_SPIKE)) reasons.push(["drive_spike", maxDelta]);

  // valence_shock — affect dropped sharply
  if (Number.isFinite(Number(preA.v)) && Number.isFinite(Number(curA.v))) {
    const drop = Number(preA.v) - Number(curA.v);
    if (drop >= (o.valenceDrop ?? VALENCE_DROP)) reasons.push(["valence_shock", drop]);
  }

  // arousal_band — crossed up into the high-arousal band
  if (clamp01(curA.a) >= (o.arousalHigh ?? AROUSAL_HIGH) && clamp01(preA.a) < (o.arousalHigh ?? AROUSAL_HIGH)) {
    reasons.push(["arousal_band", clamp01(curA.a)]);
  }

  // novelty — something genuinely new
  const nov = clamp01(o.novelty);
  if (nov >= (o.noveltyHi ?? NOVELTY_HI)) reasons.push(["novelty", nov]);

  if (reasons.length === 0) return { escalate: false, reason: null, score: 0 };
  reasons.sort((a, b) => b[1] - a[1]);
  return { escalate: true, reason: reasons[0][0], score: clamp01(reasons[0][1]), all: reasons.map((r) => r[0]) };
}

/**
 * A per-world token bucket so a panicking herd can't stampede the LLM. capacity =
 * perWorldPerMin tokens, refilled continuously. tryConsume(worldId[, now]) returns
 * true and spends a token, or false when the world is out. Injectable clock for tests.
 */
export function makeEscalationBudget({ perWorldPerMin = 30, now = () => Date.now() } = {}) {
  const cap = Math.max(1, Number(perWorldPerMin) || 30);
  const refillPerMs = cap / 60000;
  const state = new Map(); // worldId -> { tokens, last }

  function _bucket(worldId, t) {
    let b = state.get(worldId);
    if (!b) { b = { tokens: cap, last: t }; state.set(worldId, b); return b; }
    const elapsed = Math.max(0, t - b.last);
    b.tokens = Math.min(cap, b.tokens + elapsed * refillPerMs);
    b.last = t;
    return b;
  }

  return {
    tryConsume(worldId = "_global", t = now()) {
      const b = _bucket(worldId, t);
      if (b.tokens >= 1) { b.tokens -= 1; return true; }
      return false;
    },
    peek(worldId = "_global", t = now()) { return _bucket(worldId, t).tokens; },
    _state: state,
  };
}

export const _internal = {
  NEED_URGENT, DRIVE_SPIKE, VALENCE_DROP, AROUSAL_HIGH, NOVELTY_HI, SHY_BIAS, BOLD_BIAS,
};
