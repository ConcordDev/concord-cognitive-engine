// server/lib/ecosystem/creature-needs.js
//
// Wave 6 / Layer 3 — the creature motive layer (the BotW "alive with intent"
// upgrade). Creatures are world_npcs rows, so they reuse the mig-292 needs_json
// column — but with a CREATURE-flavoured need set (hunger/thirst/energy/safety/
// reproduction) keyed by diet, not the NPC's wealth/purpose. This is the pure
// motive layer; the flock cycle (creature-behaviors.js) reads the resulting
// INTENT to bias steering (seek water in drought, graze flora, flee predators).
//
// Reuses the npc-needs decay/clamp shape; pure + total.

export const CREATURE_NEED_KINDS = Object.freeze([
  "hunger", "thirst", "energy", "safety", "reproduction",
]);

// Per-diet decay weights — a carnivore's hunger bites harder + slower; a
// photosynth barely eats but needs light (folded into energy).
const DIET_DECAY = {
  herbivore: { hunger: 0.14, thirst: 0.12, energy: 0.10, safety: 0.05, reproduction: 0.03 },
  carnivore: { hunger: 0.18, thirst: 0.10, energy: 0.12, safety: 0.03, reproduction: 0.03 },
  omnivore:  { hunger: 0.15, thirst: 0.11, energy: 0.10, safety: 0.04, reproduction: 0.03 },
  filter:    { hunger: 0.08, thirst: 0.04, energy: 0.08, safety: 0.06, reproduction: 0.03 },
  photosynth:{ hunger: 0.03, thirst: 0.06, energy: 0.14, safety: 0.04, reproduction: 0.02 },
};

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

export function freshCreatureNeeds() {
  const o = {};
  for (const k of CREATURE_NEED_KINDS) o[k] = 0;
  return o;
}

export function normalizeCreatureNeeds(needs) {
  const o = {};
  for (const k of CREATURE_NEED_KINDS) o[k] = clamp01(needs?.[k] ?? 0);
  return o;
}

/** Decay (rise) the deficits over elapsed hours, per the diet profile. Pure. */
export function decayCreatureNeeds(needs, diet, elapsedHours = 0.25) {
  const out = normalizeCreatureNeeds(needs);
  const w = DIET_DECAY[diet] || DIET_DECAY.omnivore;
  for (const k of CREATURE_NEED_KINDS) out[k] = clamp01(out[k] + (w[k] || 0.1) * Math.max(0, elapsedHours));
  return out;
}

/** Satisfy one need (e.g. drank water → thirst down). Pure. */
export function satisfyCreatureNeed(needs, kind, amount) {
  const out = normalizeCreatureNeeds(needs);
  if (CREATURE_NEED_KINDS.includes(kind)) out[kind] = clamp01(out[kind] - Math.max(0, Number(amount) || 0));
  return out;
}

/**
 * The creature's current INTENT — the highest-pressure need mapped to a verb the
 * flock cycle can steer on. Environment nudges it (heat raises thirst priority;
 * a predator nearby forces flee). Returns one of:
 *   seek_water | graze | hunt | seek_shade | rest | flee | mate | wander
 */
export function creatureIntent(needs, taxonomy = {}, env = {}, released = null) {
  const n = normalizeCreatureNeeds(needs);
  const tax = taxonomy || {};
  const e = env || {};
  const diet = tax.diet || "omnivore";
  // Layer 4: a released fixed-action-pattern (releasers.matchReleaser) overrides
  // need-ranking — an instinct fires before deliberative need arbitration. The FAP
  // name maps onto a movement intent the flock loop understands. Back-compat: when
  // `released` is absent the original need-ranking path runs unchanged.
  if (released && released.fap) {
    const FAP_TO_INTENT = {
      freeze_then_bolt: "flee", bolt: "flee", flee: "flee", take_flight: "flee",
      school_dart: "flee", retaliate: "hunt", stoop: "hunt", pursue: "hunt",
      rally: "wander",
    };
    return FAP_TO_INTENT[released.fap] || released.fap;
  }
  if (e.predatorNear) return "flee";
  const hot = Number(e.temp ?? 18) >= 30;
  // Heat amplifies thirst; pick the dominant pressure.
  const thirst = n.thirst + (hot ? 0.2 : 0);
  const entries = [
    ["seek_water", thirst],
    [diet === "carnivore" ? "hunt" : "graze", n.hunger],
    ["rest", n.energy],
    ["mate", n.reproduction],
    ["flee", n.safety],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  const [verb, pressure] = entries[0];
  if (pressure < 0.5) return hot ? "seek_shade" : "wander";
  return verb;
}

/** Whether a need pressure is high enough to override idle wandering. */
export function hasUrgentNeed(needs) {
  const n = normalizeCreatureNeeds(needs);
  return CREATURE_NEED_KINDS.some((k) => n[k] >= 0.7);
}
