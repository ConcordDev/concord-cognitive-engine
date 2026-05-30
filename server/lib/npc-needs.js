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

export const NEED_KINDS = Object.freeze(["hunger", "energy", "wealth", "social", "safety", "purpose"]);

// Deficit gained per HOUR of game/real time, per need. Tuned so hunger/energy
// cycle a few times a day and purpose/wealth drift slowly. Env-overridable.
export const DECAY_PER_HOUR = Object.freeze({
  hunger: Number(process.env.CONCORD_NEED_HUNGER_DECAY) || 0.16,
  energy: Number(process.env.CONCORD_NEED_ENERGY_DECAY) || 0.10,
  wealth: Number(process.env.CONCORD_NEED_WEALTH_DECAY) || 0.05,
  social: Number(process.env.CONCORD_NEED_SOCIAL_DECAY) || 0.08,
  safety: Number(process.env.CONCORD_NEED_SAFETY_DECAY) || 0.03,
  purpose: Number(process.env.CONCORD_NEED_PURPOSE_DECAY) || 0.04,
});

function clamp01(n) { return Math.max(0, Math.min(1, n)); }

/** A fresh needs vector — mild baseline deficits so even a new NPC has wants. */
export function freshNeeds() {
  return { hunger: 0.2, energy: 0.2, wealth: 0.3, social: 0.2, safety: 0.1, purpose: 0.2 };
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

export const NEEDS_CONSTANTS = Object.freeze({ NEED_KINDS, DECAY_PER_HOUR });
