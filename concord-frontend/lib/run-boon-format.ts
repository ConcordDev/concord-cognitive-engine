// concord-frontend/lib/run-boon-format.ts
//
// Wave 4 gap-closure — shared formatter for the structured {stat, value}
// boon effects server/lib/run-draft.js's DRAFT_POOL and server/lib/
// roguelite.js's META_UNLOCK_CATALOG both use. Both HordeWaveHUD and
// RogueliteRunHUD render boons/unlocks with this so the displayed text is
// always DERIVED from the real number the server sent — never a hardcoded
// string (that's exactly the gap this unit closed: the old horde upgrade
// picker showed a fixed cosmetic string with no relationship to what, if
// anything, actually happened server-side).

export interface BoonEffect {
  stat: string;
  value: number;
}

const PCT = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
const FLAT = (v: number) => `${v >= 0 ? '+' : ''}${v}`;

const STAT_LABEL: Record<string, (v: number) => string> = {
  damageMult: (v) => `damage ${PCT(v)}`,
  attackSpeedMult: (v) => `attack speed ${PCT(v)}`,
  fireDotPerHit: (v) => `${FLAT(v)} fire DoT per hit`,
  critChance: (v) => `crit chance ${PCT(v)}`,
  critDamageMult: (v) => `crit damage ${PCT(v)}`,
  maxHpFlat: (v) => `max HP ${FLAT(v)}`,
  reflectPct: (v) => `reflect ${Math.round(v * 100)}% damage`,
  regenPerSec: (v) => `regen ${FLAT(v)}/s`,
  lifestealPct: (v) => `lifesteal ${Math.round(v * 100)}%`,
  pickupRadiusMult: (v) => `pickup radius ${PCT(v)}`,
  moveSpeedMult: (v) => `move speed ${PCT(v)}`,
  // roguelite meta-unlock stats (server/lib/roguelite.js#META_UNLOCK_CATALOG)
  startingHpBonus: (v) => `starting HP ${FLAT(v)}`,
  extraDraftPicks: (v) => `${FLAT(v)} boon pick${v === 1 ? '' : 's'} per descent`,
  metaCurrencyMult: (v) => `soul payout ${PCT(v)}`,
  revives: (v) => `${v} revive${v === 1 ? '' : 's'}`,
};

/** Human text for one {stat,value} effect — always derived, never fabricated. */
export function describeBoonEffect(effect: BoonEffect | null | undefined): string {
  if (!effect || typeof effect.stat !== 'string') return '';
  const fmt = STAT_LABEL[effect.stat];
  if (fmt) return fmt(effect.value);
  // Unknown stat (forward-compat with a future DRAFT_POOL entry the HUD
  // hasn't been updated for) — still show the real number, not nothing.
  return `${effect.stat} ${FLAT(effect.value)}`;
}

/** Human text for a full accumulated modifier bundle, e.g. from getRunModifiers. */
export function describeModifierBundle(modifiers: Record<string, number> | null | undefined): string[] {
  if (!modifiers) return [];
  return Object.entries(modifiers)
    .filter(([, v]) => Number(v) !== 0)
    .map(([stat, value]) => describeBoonEffect({ stat, value }));
}
