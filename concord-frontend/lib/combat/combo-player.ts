// concord-frontend/lib/combat/combo-player.ts
//
// Pure, testable combo-step scheduler. A `combat_combos.steps_json` array
// (persisted by server/lib/combat/flow-engine.js — each step is
// `{ action, action_meta, timing_ms }`) is turned into a flat, time-stamped
// PLAN the world-lens combo-trigger handler walks: at each step's cumulative
// `atMs` offset it plays the step's animation and, when the step is offensive
// and a target is engaged, fires ONE `combat:attack` carrying the true
// per-step action + stepIndex.
//
// Honest by construction: every timer offset is derived from the step's real
// persisted `timing_ms` (no fabricated progress), and DEFENSIVE steps
// (parry/block/dodge) animate ONLY — they never fire a `combat:attack`, so a
// combo can't dishonestly deal damage on a defensive beat.

export interface ComboStepInput {
  action?: string;
  action_meta?: Record<string, unknown>;
  timing_ms?: number;
}

export interface ComboStepPlanItem {
  /** canonical combo action token — passed to the server as `actionOverride`
   *  so the flow-recorder records the true per-step action. */
  action: string;
  /** the `concordia:combat-anim` animation token for this step. */
  animation: string;
  /** cumulative offset (ms) from the combo start at which this step fires. */
  atMs: number;
  /** the step's index in the original steps_json array. */
  stepIndex: number;
  /** true → an actual strike (fires combat:attack); false → animate-only. */
  offensive: boolean;
  /** true → the heavy flag the server reads off combat:attack. */
  heavy: boolean;
}

export interface BuildComboStepPlanOpts {
  /** minimum spacing (ms) between consecutive steps. Floors the persisted
   *  timing so steps stay above the server's 250ms attack-cooldown class +
   *  120ms global floor. Default 300. */
  minSpacingMs?: number;
  /** fallback per-step duration when a step omits `timing_ms`. Default 350
   *  (matches flow-engine's baseline). */
  defaultTimingMs?: number;
}

// Steps that represent an actual offensive beat → fire a combat:attack. The
// defensive beats (parry/block/dodge) animate only.
const OFFENSIVE_ACTIONS = new Set([
  'attack-light', 'attack-heavy', 'kick', 'grapple',
  'spell', 'ranged', 'throw', 'combo-step',
]);

// combat action token → concordia:combat-anim animation token. Tiered tokens
// (attack-light/heavy, kick, grapple, spell, ranged, throw) pass through to the
// biomechanics clip path; the two aliases below route the non-clip tokens onto
// a real clip so no combo beat is silent.
const ANIMATION_TOKEN: Record<string, string> = {
  'combo-step': 'attack-light',
  'dodge': 'dodge-back',
};

export function isOffensiveComboAction(action: string): boolean {
  return OFFENSIVE_ACTIONS.has(action);
}

export function animationTokenForComboAction(action: string): string {
  return ANIMATION_TOKEN[action] ?? action;
}

/**
 * Build the ordered, time-stamped playback plan for a combo's steps.
 * Pure — no THREE, no DOM, no timers — so the sequencing logic is unit-tested
 * in isolation and the handler just walks the plan with setTimeout.
 */
export function buildComboStepPlan(
  steps: ComboStepInput[] | undefined | null,
  opts: BuildComboStepPlanOpts = {},
): ComboStepPlanItem[] {
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const minSpacing = Math.max(0, Number(opts.minSpacingMs ?? 300));
  const defaultTiming = Math.max(1, Number(opts.defaultTimingMs ?? 350));

  const plan: ComboStepPlanItem[] = [];
  let atMs = 0;
  steps.forEach((step, i) => {
    const action = String(step?.action ?? 'attack-light');
    plan.push({
      action,
      animation: animationTokenForComboAction(action),
      atMs,
      stepIndex: i,
      offensive: isOffensiveComboAction(action),
      heavy: action === 'attack-heavy',
    });
    const rawTiming = Number(step?.timing_ms);
    const interval = Math.max(minSpacing, Number.isFinite(rawTiming) && rawTiming > 0 ? rawTiming : defaultTiming);
    atMs += interval;
  });
  return plan;
}
