// concord-frontend/lib/concordia/knockback-feel.ts
//
// Track 1 — PvP↔NPC knockback parity. The NPC path resolves knockback from the
// server's poise-severity table (server/lib/combat/impact-feel.js SEVERITY_FEEL);
// the legacy PvP path in GameJuice used a separate hardcoded heuristic (heavy 4 /
// crit 5 / kill 6), so an identical strike knocked back differently by target type.
// This is the client mirror of that table + a trigger→severity map, so both paths
// agree per severity. KEEP IN SYNC with impact-feel.js SEVERITY_FEEL.knockback.

export type PoiseSeverity = 'none' | 'flinch' | 'rocked' | 'knockdown';

/** Mirror of impact-feel.js SEVERITY_FEEL.knockback (metres/sec base). */
export const KNOCKBACK_BY_SEVERITY: Readonly<Record<PoiseSeverity, number>> = Object.freeze({
  none: 0,
  flinch: 0,
  rocked: 4.5,
  knockdown: 7.5,
});

/** Map a legacy juice trigger (+ heavy flag) to the equivalent poise severity. */
export function severityForTrigger(trigger: string, isHeavy = false): PoiseSeverity {
  if (trigger === 'combat-kill') return 'knockdown';
  if (trigger === 'combat-crit' || isHeavy) return 'rocked';
  if (trigger === 'combat-hit') return 'flinch';
  return 'none';
}

/** The knockback magnitude a trigger should produce — identical to the NPC path. */
export function knockbackForTrigger(trigger: string, isHeavy = false): number {
  return KNOCKBACK_BY_SEVERITY[severityForTrigger(trigger, isHeavy)];
}
