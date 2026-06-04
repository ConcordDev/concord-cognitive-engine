// server/lib/agent-awareness-index.js
//
// Wave 7 / Track B8 — the AWARENESS METER: a Φ/PCI-style proxy computed over the
// agent's OWN module-activity, turned on our own creation ("if it exists, measure it").
//
//   *** THIS IS A METRIC, NOT A CLAIM. ***
//
// It measures the ACCESS-consciousness correlate (Block's A): integration ×
// differentiation of the agent's active subsystems — the same intuition PCI formalises
// (a reaction that is both integrated AND differentiated is incompressible → high).
// It does NOT measure phenomenal experience (P) — nobody can, from outside. Every
// surface that shows this number must frame it as a correlate, never "it's conscious."
//
// Computed as a READ-ONLY reducer over signals that already exist (the B4 salience
// wake, the A4 affect vector, the cross-module memory/drift/forward-sim activity, the
// B6 awareness-loop trace) — it builds NO new substrate.
//
//   computeAwarenessIndex(activations, opts) -> { index, integration, differentiation,
//                                                 activeModules, total, enabled }
//
// Predicted behaviour (the honest payoff): RISES as modules boot and integrate, DIPS
// during dream/sleep (low perturbation, autonomous replay → the empirical NREM-PCI
// drop), SPIKES under a tier-3 salience wake (many modules integrate at once).

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// The agent's subsystems. Activation 0..1 = how engaged each is THIS tick.
export const AWARENESS_MODULES = Object.freeze([
  "affect",      // A4 core-affect vector live
  "drives",      // A3 Panksepp drive dynamics
  "goal",        // B4 goal pursuit / arbitration
  "memory",      // A6 felt-per trace / recall
  "forwardSim",  // Layer 10 anticipation
  "drift",       // self-contradiction monitor
  "salience",    // A5 interrupt / global workspace wake
  "selfModel",   // B1 self-model read/update
  "behavior",    // expressed action in the world
]);

const ACTIVE_FLOOR = 0.15; // below this a module is "off" this tick
const DIFF_SCALE = 2;      // std of values in [0,1] maxes ~0.5 → ×2 spans [0,1]

function stddev(vals) {
  if (vals.length < 2) return 0;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const v = vals.reduce((a, b) => a + (b - m) * (b - m), 0) / vals.length;
  return Math.sqrt(v);
}

function isEnabled() {
  return process.env.CONCORD_AWARENESS_INDEX !== "0";
}

/**
 * Reduce a map of module activations into a single 0..1 awareness index.
 *
 *   integration     = breadth of co-activation (fraction of modules lit and working
 *                     together). A sleeping agent (few modules) integrates little.
 *   differentiation = heterogeneity of the ACTIVE modules (are the lit parts doing
 *                     DIFFERENT things?). A seizure — all modules maxed and uniform —
 *                     scores ~0 here, exactly as PCI drops in a generalised seizure.
 *   index           = integration × differentiation. High requires BOTH: many
 *                     subsystems engaged AND doing varied work.
 *
 * Total + read-only. Disabled env → { index:0, enabled:false } (no-op). Never throws.
 *
 * @param {object} activations  { affect, drives, goal, memory, ... } each 0..1
 * @param {object} [opts]       { modules? } override module set
 */
export function computeAwarenessIndex(activations, opts = {}) {
  if (!isEnabled()) {
    return { index: 0, integration: 0, differentiation: 0, activeModules: 0, total: 0, enabled: false };
  }
  const mods = Array.isArray(opts.modules) && opts.modules.length ? opts.modules : AWARENESS_MODULES;
  const a = activations || {};
  const values = mods.map((m) => clamp01(a[m]));
  const total = mods.length;

  const activeValues = values.filter((v) => v >= ACTIVE_FLOOR);
  const integration = total > 0 ? activeValues.length / total : 0;
  // differentiation needs at least two lit modules to mean anything.
  const differentiation = activeValues.length >= 2 ? clamp01(DIFF_SCALE * stddev(activeValues)) : 0;
  const index = clamp01(integration * differentiation);

  return { index, integration, differentiation, activeModules: activeValues.length, total, enabled: true };
}

/**
 * Convenience: derive a coarse activation map from an agent tick context. Best-effort
 * — anything absent reads as 0 (off). Lets the caller feed live signals (the B4 wake,
 * the A4 affect arousal, whether memory/forward-sim/drift ran this tick) without
 * having to assemble the map by hand.
 */
export function activationsFromTick(tick = {}) {
  const t = tick || {};
  const arousal = clamp01(t.affect?.a);
  return {
    affect: t.affect ? Math.max(0.2, arousal) : 0,
    drives: t.drives ? 0.4 : 0,
    goal: t.goalActive ? 0.6 : 0,
    memory: clamp01(t.memoryActivity),
    forwardSim: t.predicted ? 0.5 : 0,
    drift: clamp01(t.driftActivity),
    salience: clamp01(t.salience),
    selfModel: t.selfModelUpdated ? 0.6 : 0,
    behavior: clamp01(t.behaviorActivity),
  };
}

export const _internal = { ACTIVE_FLOOR, DIFF_SCALE, stddev };
