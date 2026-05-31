// concord-frontend/lib/concordia/move-budget.ts
//
// MS-P2 — the move-builder's modifier budget, modelled on City of Heroes'
// Enhancement Diversification: stacking the SAME aspect gives full value for the
// first few points then steep diminishing returns, so the optimal build SPREADS
// across aspects instead of dumping everything into damage. This is what keeps a
// created move from being trivially one-shot — the budget shapes it.

/** ED schedule (CoH "Schedule A"): per-point multiplier as you stack one aspect.
 *  Points 1-3 ~full, then a sharp cliff. */
const ED_SCHEDULE = [1.0, 1.0, 0.9, 0.7, 0.15, 0.15, 0.05];

export type MoveAspect = "power" | "speed" | "area" | "efficiency" | "control";
export const MOVE_ASPECTS: MoveAspect[] = ["power", "speed", "area", "efficiency", "control"];

/** Default total modifier points a move may allocate (tier can raise it). */
export const DEFAULT_BUDGET = 6;

/** Effective value of stacking `points` into one aspect, after ED. */
export function effectiveAspect(points: number): number {
  let eff = 0;
  const n = Math.max(0, Math.floor(points));
  for (let i = 0; i < n; i++) eff += ED_SCHEDULE[Math.min(i, ED_SCHEDULE.length - 1)];
  return eff;
}

export interface BudgetResult {
  ok: boolean;
  spent: number;
  budget: number;
  overspent: boolean;
  effective: Record<string, number>;  // per-aspect ED-adjusted value
  /** A move is "balanced" when no single aspect holds > 60% of total effective value. */
  balanced: boolean;
  dominantAspect: string | null;
}

/**
 * Resolve an allocation against the budget. PURE.
 * @param allocation { power?:n, speed?:n, ... } points per aspect
 * @param budget total points allowed (default DEFAULT_BUDGET)
 */
export function resolveBudget(allocation: Partial<Record<MoveAspect, number>>, budget = DEFAULT_BUDGET): BudgetResult {
  const spent = MOVE_ASPECTS.reduce((a, k) => a + Math.max(0, Math.floor(allocation[k] || 0)), 0);
  const effective: Record<string, number> = {};
  let totalEff = 0;
  let dominant: string | null = null;
  let dominantVal = 0;
  for (const k of MOVE_ASPECTS) {
    const e = effectiveAspect(allocation[k] || 0);
    effective[k] = Number(e.toFixed(3));
    totalEff += e;
    if (e > dominantVal) { dominantVal = e; dominant = k; }
  }
  const overspent = spent > budget;
  const balanced = totalEff === 0 ? true : dominantVal / totalEff <= 0.6;
  return { ok: !overspent, spent, budget, overspent, effective, balanced, dominantAspect: dominant };
}

/** Budget grows modestly with the move's tier (a mastered move earns more points). */
export function budgetForTier(tier: number): number {
  return DEFAULT_BUDGET + Math.max(0, Math.min(4, Math.floor(Number(tier) || 1) - 1));
}
