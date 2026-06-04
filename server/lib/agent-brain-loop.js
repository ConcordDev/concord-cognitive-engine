// server/lib/agent-brain-loop.js
//
// Wave 7 / Track B4 + B7 + D1 — the brain loop and the emergence wire, both built on
// the A5 salience ladder (affect-salience.js). This is where "feeling decides when to
// think" becomes the agent's actual tick gate, and where agents become each other's
// constraints (the drama emerges from the structure, no drama-author).
//
//   B4  decideDeliberation(self, world, others, prior, opts)  -> { deliberate, tier, reason, ... }
//       The marathon tick gate: cheap instinct/routine by default; an expensive LLM
//       deliberation fires ONLY when the ladder bottoms out at a tier-3 dilemma OR a
//       raw affect spike wakes the workspace — AND a token is available (no stampede).
//
//   B7  collideAgents(agents, opts)  -> { results, escalations, total, deterministicRatio }
//       Surfaces each agent's current intent/plan as an affordance the others' detector
//       collides against (the last bread, a blocked road). Most collisions resolve
//       tier-1/2 deterministically and fizzle; the rare irreducible one escalates.
//       deterministicRatio IS the D1 cost-story proof: LLM calls track DILEMMAS, not
//       population — a thousand NPCs cost like ten.
//
// Pure (the only state is the optional escalation budget passed in opts). Reuses A5;
// adds no new substrate. CONCORD_AFFECT_SALIENCE kill-switch is enforced by the caller.

import { detectConstraint, resolveConstraint, shouldEscalate } from "./affect-salience.js";

/**
 * B4 — decide whether THIS agent should run an expensive deliberation this tick.
 *
 * @param {object} self   { worldId?, needs?, drives?, affect?, goal?:{resource}, coping? }
 * @param {object} world  { obstacle?, blockedGoal? }
 * @param {Array}  others [{ id, claimsResource?, collides?, severity? }]
 * @param {object} prior  previous { affect, drives } (for spike detection)
 * @param {object} opts   { hasRouteAround?, hasFallbackGoal?, maybeRouteAround?,
 *                          novelty?, budget? (makeEscalationBudget) }
 * @returns {{ deliberate:boolean, tier:number, reason:string, action?:string, constraint?:object }}
 */
export function decideDeliberation(self = {}, world = {}, others = [], prior = {}, opts = {}) {
  const o = opts || {};
  const worldId = self.worldId || "_global";
  const affectNow = { affect: self.affect, drives: self.drives };

  const constraint = detectConstraint(self, world, others);

  // No constraint: the agent's world is clear. Even so, a raw affect/drive spike
  // (a sudden fear, a valence shock) can wake the workspace — feeling decides.
  if (!constraint) {
    const esc = shouldEscalate(affectNow, prior, o);
    if (!esc.escalate) return { deliberate: false, tier: 0, reason: "calm" };
    return _gate({ tier: 3, reason: esc.reason, constraint: null, action: "reflect" }, worldId, o);
  }

  // Walk the ladder. Tier 1 (route-around) and tier 2 (abandon) are deterministic —
  // ZERO LLM. Only tier 3 (genuine dilemma) is a candidate for deliberation.
  const res = resolveConstraint(constraint, {
    hasRouteAround: o.hasRouteAround,
    hasFallbackGoal: o.hasFallbackGoal,
    maybeRouteAround: o.maybeRouteAround,
    coping: self.coping,
  });
  if (res.tier < 3) {
    return { deliberate: false, tier: res.tier, action: res.action, reason: res.reason, constraint };
  }

  // Tier 3 — a real dilemma. Confirm via the escalation arithmetic + spend a token.
  const esc = shouldEscalate({ ...affectNow, constraintTier: 3 }, prior, o);
  return _gate({ tier: 3, reason: esc.reason || "dilemma", constraint, action: "escalate" }, worldId, o);
}

// Apply the budget token bucket — a panicking herd can't stampede the LLM.
function _gate(decision, worldId, opts) {
  const budget = opts.budget;
  if (budget && typeof budget.tryConsume === "function") {
    if (!budget.tryConsume(worldId)) {
      return { ...decision, deliberate: false, reason: "budget_exhausted" };
    }
  }
  return { ...decision, deliberate: true };
}

/**
 * B7 — run a population of agents against each other for one tick. Each agent's goal
 * resource becomes an affordance the others collide against (scarcity → the last
 * bread). Returns per-agent ladder resolution + the deterministic ratio.
 *
 * @param {Array} agents [{ id, worldId?, needs?, drives?, affect?, goal?:{resource},
 *                          hasRouteAround?, hasFallbackGoal?, maybeRouteAround?, coping?, prior? }]
 * @param {object} opts  { budget?, ...escalation thresholds }
 */
export function collideAgents(agents, opts = {}) {
  const list = Array.isArray(agents) ? agents.filter((a) => a && a.id) : [];
  const results = [];
  let escalations = 0;

  for (const self of list) {
    // The "others" view: every OTHER agent's claimed resource is a potential collision.
    const others = list
      .filter((a) => a.id !== self.id && a.goal && a.goal.resource)
      .map((a) => ({ id: a.id, claimsResource: a.goal.resource, severity: a.severity ?? 0.5 }));

    const decision = decideDeliberation(self, self.world || {}, others, self.prior || {}, {
      ...opts,
      hasRouteAround: self.hasRouteAround,
      hasFallbackGoal: self.hasFallbackGoal,
      maybeRouteAround: self.maybeRouteAround,
    });
    if (decision.deliberate) escalations++;
    results.push({ id: self.id, tier: decision.tier, action: decision.action, deliberate: decision.deliberate, reason: decision.reason });
  }

  const total = results.length;
  const deterministicRatio = total === 0 ? 1 : (total - escalations) / total;
  return { results, escalations, total, deterministicRatio };
}
