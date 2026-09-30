// server/lib/npc-needs.js
//
// Living Society WS4.1 — the per-NPC NEEDS model (the motive layer).
//
// Needs are stored as DEFICITS in [0,1]: 0 = fully satisfied, 1 = desperate.
// Each need DECAYS upward over time at its own rate (hunger climbs fast, purpose
// slow). Performing the matching activity SATISFIES it (lowers the deficit).
// This is the input the utility scorer (npc-utility.js) reads to decide where an
// NPC goes — turning the fixed-schedule automaton into a motivated agent.
//
// Pure + deterministic (no DB, no clock) so the math is contract-testable; the
// DB read/write helpers are thin wrappers (needs live in world_npcs.needs_json).

export const NEED_KINDS = Object.freeze([
  "hunger", "thirst", "energy", "sleep", "wealth", "social", "safety",
  "purpose", "comfort", "status", "belonging", "entertainment", "romance",
  "curiosity", "power", "freedom",
]);

// Deficit gained per HOUR of game/real time, per need. Tuned so hunger/energy
// cycle a few times a day and purpose/wealth drift slowly. Env-overridable.
//
// `comfort` is deliberately 0 by default: unlike the other needs it does NOT
// drift passively on the clock — it is driven ONLY by the real ambient-temperature
// signal (see applyThermalComfort below). So an NPC that is never near a thermal
// extreme accrues no comfort deficit at all, and the new need is a no-op for the
// common case (honest-by-construction: no invented pressure without a real reading).
export const DECAY_PER_HOUR = Object.freeze({
  hunger: Number(process.env.CONCORD_NEED_HUNGER_DECAY) || 0.16,
  thirst: Number(process.env.CONCORD_NEED_THIRST_DECAY) || 0.14,
  energy: Number(process.env.CONCORD_NEED_ENERGY_DECAY) || 0.10,
  sleep: Number(process.env.CONCORD_NEED_SLEEP_DECAY) || 0.09,
  wealth: Number(process.env.CONCORD_NEED_WEALTH_DECAY) || 0.05,
  social: Number(process.env.CONCORD_NEED_SOCIAL_DECAY) || 0.08,
  safety: Number(process.env.CONCORD_NEED_SAFETY_DECAY) || 0.03,
  purpose: Number(process.env.CONCORD_NEED_PURPOSE_DECAY) || 0.04,
  comfort: Number(process.env.CONCORD_NEED_COMFORT_DECAY) || 0,
  status: Number(process.env.CONCORD_NEED_STATUS_DECAY) || 0.03,
  belonging: Number(process.env.CONCORD_NEED_BELONGING_DECAY) || 0.04,
  entertainment: Number(process.env.CONCORD_NEED_ENTERTAINMENT_DECAY) || 0.06,
  romance: Number(process.env.CONCORD_NEED_ROMANCE_DECAY) || 0.03,
  curiosity: Number(process.env.CONCORD_NEED_CURIOSITY_DECAY) || 0.05,
  power: Number(process.env.CONCORD_NEED_POWER_DECAY) || 0.02,
  freedom: Number(process.env.CONCORD_NEED_FREEDOM_DECAY) || 0.02,
});

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

/** A fresh needs vector — mild baseline deficits so even a new NPC has wants. */
export function freshNeeds() {
  return {
    hunger: 0.2, thirst: 0.15, energy: 0.2, sleep: 0.15, wealth: 0.3, social: 0.2,
    safety: 0.1, purpose: 0.2, comfort: 0, status: 0.1, belonging: 0.15,
    entertainment: 0.15, romance: 0.08, curiosity: 0.12, power: 0.08, freedom: 0.1,
  };
}

/** Normalise any partial/garbage needs object to a complete clamped vector. */
export function normalizeNeeds(needs) {
  const out = {};
  const base = freshNeeds();
  for (const k of NEED_KINDS) out[k] = clamp01(Number(needs?.[k] ?? base[k]) || 0);
  return out;
}

/**
 * Decay (raise) every need's deficit by its rate × elapsed hours. Pure: returns
 * a NEW vector. `mods` optionally scales per-need decay (e.g. a stressed NPC's
 * safety climbs faster).
 */
export function decayNeeds(needs, elapsedHours, mods = {}) {
  const cur = normalizeNeeds(needs);
  const dt = Math.max(0, Number(elapsedHours) || 0);
  const out = {};
  for (const k of NEED_KINDS) {
    const rate = DECAY_PER_HOUR[k] * (Number(mods[k]) || 1);
    out[k] = clamp01(cur[k] + rate * dt);
  }
  return out;
}

/** Satisfy a need: lower its deficit by `amount` (pure, returns new vector). */
export function satisfy(needs, kind, amount) {
  const out = normalizeNeeds(needs);
  if (NEED_KINDS.includes(kind)) out[kind] = clamp01(out[kind] - Math.max(0, Number(amount) || 0));
  return out;
}

/** Apply a POI's advertisement (a {need:amount} map) as satisfaction. */
export function satisfyFromAdvertisement(needs, advert = {}) {
  let out = normalizeNeeds(needs);
  for (const [k, amt] of Object.entries(advert)) out = satisfy(out, k, amt);
  return out;
}

export function deficit(needs, kind) { return normalizeNeeds(needs)[kind] ?? 0; }

/** The most-pressing need (highest deficit) + its value. */
export function topNeed(needs) {
  const cur = normalizeNeeds(needs);
  let best = NEED_KINDS[0];
  for (const k of NEED_KINDS) if (cur[k] > cur[best]) best = k;
  return { kind: best, deficit: cur[best] };
}

// ── Thermal comfort: the ONE need coupled to the real environment ────────────
//
// Ported from the wildlife affect pipeline (lib/ecosystem/): a per-world/per-cell
// signal bundle (embodied/signals.js#signalsForWorld) is filtered through a
// perception weight vector (umwelt.js#perceiveSignals) before it drives behavior.
// The creature path weights the bundle per-species (umweltForSpecies); the
// HUMANOID NPC gets the full balanced band (umwelt.js#HUMANOID_BASELINE). Here
// the downstream consumer is the NEEDS model rather than creature drives: the
// perceived ambient temperature accrues/relieves the `comfort` deficit, which the
// utility scorer then weighs against shelter POIs (npc-utility + npc-pois).
//
// These match umwelt.js NORM.temperature (neutral 18°C, span 25) so the humanoid
// comfort band is consistent with the perceptual scale wildlife already uses.
const COMFORT_NEUTRAL_C   = Number(process.env.CONCORD_COMFORT_NEUTRAL_C)   || 18; // most comfortable ambient
const COMFORT_TOLERANCE_C = Number(process.env.CONCORD_COMFORT_TOLERANCE_C) || 8;  // ±band that reads as comfortable
const COMFORT_SPAN_C      = Number(process.env.CONCORD_COMFORT_SPAN_C)      || 25; // °C beyond the band that saturates discomfort
// How fast the comfort deficit climbs toward the discomfort intensity / relaxes
// back to 0, per hour of advance. Env-overridable.
export const COMFORT_ACCRUE_PER_HOUR = Number(process.env.CONCORD_NEED_COMFORT_ACCRUE) || 1.2;
export const COMFORT_RELIEF_PER_HOUR = Number(process.env.CONCORD_NEED_COMFORT_RELIEF) || 0.8;

/**
 * Map a PERCEIVED ambient reading (umwelt.perceiveSignals output — passes the raw
 * `temperature` alias through) to a thermal-discomfort intensity in [0,1].
 * 0 inside the comfortable band; climbs linearly to 1 as the temperature departs
 * neutral. Pure + total: garbage / no-data / in-band → 0 (never invents pressure).
 */
export function thermalDiscomfort(perceived) {
  if (!perceived || perceived.hasData === false) return 0;
  const t = Number(perceived.temperature);
  if (!Number.isFinite(t)) return 0;
  const dev = Math.abs(t - COMFORT_NEUTRAL_C);
  if (dev <= COMFORT_TOLERANCE_C) return 0; // inside the comfortable band → no discomfort
  return clamp01((dev - COMFORT_TOLERANCE_C) / COMFORT_SPAN_C);
}

/**
 * Advance the `comfort` need from a real ambient reading. Pure (no DB/clock),
 * returns a NEW clamped needs vector; only `comfort` changes, every other need
 * passes through untouched (so this is a strict no-op for the rest of the model).
 *
 *   - No real reading (opts.hasData === false / perceived.hasData === false):
 *     returns needs unchanged — comfort neither accrues nor relaxes without data.
 *   - An extreme, un-sheltered cell: comfort climbs toward the discomfort intensity
 *     at COMFORT_ACCRUE_PER_HOUR, capped at that intensity.
 *   - A comfortable cell, OR actively sheltering (opts.sheltered — indoors): comfort
 *     relaxes toward 0 at COMFORT_RELIEF_PER_HOUR.
 */
export function applyThermalComfort(needs, perceived, elapsedHours, opts = {}) {
  const cur = normalizeNeeds(needs);
  if (opts.hasData === false || perceived?.hasData === false) return cur;
  const dt = Math.max(0, Number(elapsedHours) || 0);
  const discomfort = thermalDiscomfort(perceived);
  const sheltered = !!opts.sheltered;
  let comfort = cur.comfort;
  if (discomfort > 0 && !sheltered) {
    if (comfort < discomfort) comfort = Math.min(discomfort, comfort + COMFORT_ACCRUE_PER_HOUR * dt);
  } else {
    comfort = Math.max(0, comfort - COMFORT_RELIEF_PER_HOUR * dt);
  }
  return { ...cur, comfort: clamp01(comfort) };
}

// ── DB wrappers (needs live in world_npcs.needs_json — one column, mig WS4) ───

export function getNeeds(db, npcId) {
  try {
    const row = db.prepare(`SELECT needs_json FROM world_npcs WHERE id = ?`).get(npcId);
    return row?.needs_json ? normalizeNeeds(JSON.parse(row.needs_json)) : freshNeeds();
  } catch { return freshNeeds(); }
}

export function setNeeds(db, npcId, needs) {
  try {
    db.prepare(`UPDATE world_npcs SET needs_json = ? WHERE id = ?`).run(JSON.stringify(normalizeNeeds(needs)), npcId);
    return true;
  } catch { return false; }
}

export const NEEDS_CONSTANTS = Object.freeze({
  NEED_KINDS, DECAY_PER_HOUR,
  COMFORT_NEUTRAL_C, COMFORT_TOLERANCE_C, COMFORT_SPAN_C,
  COMFORT_ACCRUE_PER_HOUR, COMFORT_RELIEF_PER_HOUR,
});
