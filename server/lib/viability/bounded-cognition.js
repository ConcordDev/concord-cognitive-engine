// server/lib/viability/bounded-cognition.js
//
// Wave 5 #32 — bounded cognition. A mind (NPC or the council) cannot attend to
// everything: working memory holds ~7±2 items, and that capacity NARROWS under
// load (the Yerkes-Dodson / cognitive-load effect — a stressed agent tunnels).
// Attention over the retained items is a SIMPLEX (a probability distribution
// summing to 1). This gives a principled cap + weighting for "how many things,
// and how strongly, does this agent consider?" — the bound that keeps NPC
// deliberation (rules, routines, threats) realistic instead of omniscient. Pure.

export const WORKING_MEMORY = 7;
export const WM_SPAN = 2; // 7 ± 2 → [5, 9]

/**
 * Working-memory capacity at a given cognitive load (0 calm … 1 overwhelmed).
 * Calm → 9, nominal → 7, overwhelmed → 5. Integer in [WM−SPAN, WM+SPAN].
 */
export function workingMemoryCap(load = 0) {
  const l = Math.max(0, Math.min(1, Number(load) || 0));
  const cap = Math.round((WORKING_MEMORY + WM_SPAN) - l * 2 * WM_SPAN);
  return Math.max(WORKING_MEMORY - WM_SPAN, Math.min(WORKING_MEMORY + WM_SPAN, cap));
}

/**
 * Normalise non-negative weights onto the probability simplex (sum = 1). All-zero
 * (or empty) → uniform. Negative weights are floored at 0.
 */
export function attentionSimplex(weights = []) {
  const w = weights.map((x) => Math.max(0, Number(x) || 0));
  const n = w.length;
  if (n === 0) return [];
  const total = w.reduce((a, b) => a + b, 0);
  if (total <= 0) return w.map(() => 1 / n);
  return w.map((x) => x / total);
}

/**
 * Focus: keep only the top `cap` items by weight (working-memory bound) and
 * return them with a simplex attention distribution over what's retained.
 * @returns {{ attended:any[], attention:number[], dropped:number }}
 */
export function boundedAttention(items = [], { cap = WORKING_MEMORY, weightOf = () => 1 } = {}) {
  const scored = items.map((it) => ({ it, w: Math.max(0, Number(weightOf(it)) || 0) }));
  scored.sort((a, b) => b.w - a.w);
  const keep = scored.slice(0, Math.max(0, Math.floor(cap)));
  return {
    attended: keep.map((s) => s.it),
    attention: attentionSimplex(keep.map((s) => s.w)),
    dropped: Math.max(0, scored.length - keep.length),
  };
}
