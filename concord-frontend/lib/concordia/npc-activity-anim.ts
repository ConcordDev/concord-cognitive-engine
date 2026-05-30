// concord-frontend/lib/concordia/npc-activity-anim.ts
//
// Living Society WS4.5 — bridge an NPC's server-side activity to the WS1 action
// animation. When the routine cycle emits `npc:activity-batch` (an NPC moved to
// a new activity block), we map its `activity_kind` to a WS1 verb and play that
// verb's procedural clip on the NPC — so an NPC at the forge *forges*, one at
// the temple *communes*, one at the field *harvests*. Combined with the gait the
// client already drives, this is the "constant fluid movement": walk (gait) →
// act (verb clip) → idle, continuously, motivated by needs (WS4).
//
// Pure + data-driven (a map), so it's unit-testable and "adding an activity = a
// row". Passive blocks (sleep/rest/wander/patrol/train) return null — those just
// gait/idle, no action clip.

// NPC routine activity_kind → WS1 ACTION_DESCRIPTORS verb (or null = no action).
const ACTIVITY_VERB: Record<string, string | null> = {
  build: 'build',
  construct: 'build',
  commune: 'commune',
  cook: 'cook',
  craft: 'craft',
  farm: 'harvest',
  fish: 'fish',
  gather: 'gather',
  log: 'log',
  mill: 'mill',
  mine: 'mine',
  socialize: 'talk',
  trade: 'trade',
  // passive — locomotion/idle only, no action clip
  patrol: null,
  rest: null,
  sleep: null,
  train: null,
  wander: null,
};

/** Map an NPC activity_kind to a WS1 action verb (null = gait/idle only). */
export function activityToActionVerb(activityKind: string | null | undefined): string | null {
  if (!activityKind) return null;
  const k = String(activityKind).toLowerCase();
  return k in ACTIVITY_VERB ? ACTIVITY_VERB[k] : null;
}

export const ACTIVITY_VERB_MAP = ACTIVITY_VERB;
export const ANIMATED_ACTIVITIES = Object.keys(ACTIVITY_VERB).filter((k) => ACTIVITY_VERB[k] !== null);
