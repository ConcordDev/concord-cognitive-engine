// server/lib/mount-care.js
//
// Concordia Procedural Mount System Phase B4 — care + loyalty.
//
// Mounts need feeding, grooming, and rest. Neglect drives loyalty
// down; loyalty < 30 → mount refuses to be ridden.
//
// CLAUDE.md invariant: care decay computed LAZILY from `last_seen_at`;
// heartbeat MAY trigger decay but MUST NOT be sole source. The 24h
// decay cap applies regardless of server downtime — a mount left
// untouched for 7 days behaves identically to one left for 24h.

const STATE_DEFAULTS = {
  hunger: 0,        // 0..100, climbs with neglect
  thirst: 0,        // 0..100
  stamina: 100,     // 0..100, drained by riding
  loyalty: 50,      // 0..100, decays slowly without interaction
  gait_skill: 0,    // XP — earned by riding
};

const HOUR_S = 3600;
const DAY_S  = 86400;

// Tunable rates. Per-hour values; capped at 24h regardless of elapsed
// time so post-downtime catch-up doesn't kill mounts.
const HUNGER_RATE_PER_HOUR  = 1.5;   // +1.5 hunger / hour without feeding
const THIRST_RATE_PER_HOUR  = 2.0;
const LOYALTY_DECAY_PER_DAY = 4.0;   // -4 loyalty / day without interaction
const STAMINA_RECOVERY_PER_HOUR = 8.0;
const FEED_HUNGER_DELTA = -40;
const FEED_LOYALTY_DELTA = +5;
const GROOM_LOYALTY_DELTA = +6;
const REST_STAMINA_DELTA = +35;

// Loyalty ride gate.
export const LOYALTY_RIDE_THRESHOLD = 30;

export function loyaltyForRiding(loyalty) {
  return Number(loyalty) >= LOYALTY_RIDE_THRESHOLD;
}

function _readCompanion(db, companionId) {
  if (!db || !companionId) return null;
  try {
    return db.prepare(`
      SELECT id, owner_id, world_id, mount_eligible, mount_state, last_action_at,
             last_ridden_at, loyalty, caught_at
      FROM player_companions WHERE id = ?
    `).get(companionId) || null;
  } catch {
    return null;
  }
}

function _parseState(json) {
  if (!json) return { ...STATE_DEFAULTS };
  try {
    const parsed = JSON.parse(json);
    return { ...STATE_DEFAULTS, ...(parsed || {}) };
  } catch {
    return { ...STATE_DEFAULTS };
  }
}

function _writeState(db, companionId, state) {
  db.prepare(`UPDATE player_companions SET mount_state = ?, last_action_at = unixepoch() WHERE id = ?`)
    .run(JSON.stringify(state), companionId);
}

function _logEvent(db, companionId, eventType, deltas, meta = {}) {
  try {
    db.prepare(`
      INSERT INTO mount_care_events
        (companion_id, event_type, delta_loyalty, delta_stamina, delta_hunger, meta_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      companionId, eventType,
      Number(deltas.loyalty || 0),
      Number(deltas.stamina || 0),
      Number(deltas.hunger || 0),
      JSON.stringify(meta || {}),
    );
  } catch { /* best-effort; care logging never blocks the action */ }
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Apply care decay for a single mount, given an elapsed-seconds budget.
 * Caps the elapsed window at 24h so post-downtime catch-up is bounded.
 *
 * @returns {{ ok: boolean, applied?: boolean, deltas?: object, reason?: string }}
 */
export function decayCare(db, companionId, { nowS = Math.floor(Date.now() / 1000) } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const comp = _readCompanion(db, companionId);
  if (!comp) return { ok: false, reason: "not_found" };
  // Companions caught before the mount-care heartbeat shipped have
  // last_action_at = NULL. Treat the row's caught_at as the floor so
  // they pick up neglect decay on the next cycle instead of being
  // permanently stuck at "just acted" — otherwise mount-care-cycle
  // sorts them to the front of every batch and never advances past.
  const last = Number(comp.last_action_at) || Number(comp.caught_at) || nowS;
  const elapsedS = Math.max(0, Math.min(DAY_S, nowS - last));
  if (elapsedS < 60) return { ok: true, applied: false }; // sub-minute → skip

  const state = _parseState(comp.mount_state);
  const hours = elapsedS / HOUR_S;

  const dHunger  = +HUNGER_RATE_PER_HOUR * hours;
  const dThirst  = +THIRST_RATE_PER_HOUR * hours;
  const dStamina = +STAMINA_RECOVERY_PER_HOUR * hours;
  const dLoyalty = -LOYALTY_DECAY_PER_DAY * (elapsedS / DAY_S);

  state.hunger  = clamp(state.hunger  + dHunger,  0, 100);
  state.thirst  = clamp(state.thirst  + dThirst,  0, 100);
  state.stamina = clamp(state.stamina + dStamina, 0, 100);
  const newLoyalty = clamp(Number(comp.loyalty) + dLoyalty, 0, 100);

  // Persist mount_state + companion.loyalty.
  db.prepare(`UPDATE player_companions SET mount_state = ?, loyalty = ?, last_action_at = unixepoch() WHERE id = ?`)
    .run(JSON.stringify(state), newLoyalty, companionId);
  _logEvent(db, companionId, "neglect_decay", { loyalty: dLoyalty, stamina: dStamina, hunger: dHunger }, { elapsedS });

  return { ok: true, applied: true, elapsedS, state, loyalty: newLoyalty };
}

/**
 * Owner feeds the mount. Drops hunger, lifts loyalty. Idempotent
 * within a 5-minute window (anti-spam).
 */
export function feedMount(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const { companionId, ownerId, foodItemId } = args || {};
  if (!companionId) return { ok: false, reason: "missing_companion_id" };
  const comp = _readCompanion(db, companionId);
  if (!comp) return { ok: false, reason: "not_found" };
  if (ownerId && comp.owner_id !== ownerId) return { ok: false, reason: "not_owner" };

  // Anti-spam: feeding more than once per 5 min has no effect.
  const recent = db.prepare(`
    SELECT ts FROM mount_care_events
    WHERE companion_id = ? AND event_type = 'feed'
    ORDER BY ts DESC LIMIT 1
  `).get(companionId);
  const nowS = Math.floor(Date.now() / 1000);
  if (recent && nowS - recent.ts < 300) {
    return { ok: false, reason: "too_soon", retryAfterS: 300 - (nowS - recent.ts) };
  }

  const state = _parseState(comp.mount_state);
  state.hunger = clamp(state.hunger + FEED_HUNGER_DELTA, 0, 100);
  const newLoyalty = clamp(Number(comp.loyalty) + FEED_LOYALTY_DELTA, 0, 100);
  db.prepare(`UPDATE player_companions SET mount_state = ?, loyalty = ?, last_action_at = unixepoch() WHERE id = ?`)
    .run(JSON.stringify(state), newLoyalty, companionId);
  _logEvent(db, companionId, "feed", { hunger: FEED_HUNGER_DELTA, loyalty: FEED_LOYALTY_DELTA }, { foodItemId: foodItemId || null });
  return { ok: true, state, loyalty: newLoyalty };
}

export function groomMount(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const { companionId, ownerId } = args || {};
  if (!companionId) return { ok: false, reason: "missing_companion_id" };
  const comp = _readCompanion(db, companionId);
  if (!comp) return { ok: false, reason: "not_found" };
  if (ownerId && comp.owner_id !== ownerId) return { ok: false, reason: "not_owner" };
  const newLoyalty = clamp(Number(comp.loyalty) + GROOM_LOYALTY_DELTA, 0, 100);
  db.prepare(`UPDATE player_companions SET loyalty = ?, last_action_at = unixepoch() WHERE id = ?`)
    .run(newLoyalty, companionId);
  _logEvent(db, companionId, "groom", { loyalty: GROOM_LOYALTY_DELTA });
  return { ok: true, loyalty: newLoyalty };
}

export function restMount(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const { companionId, ownerId } = args || {};
  if (!companionId) return { ok: false, reason: "missing_companion_id" };
  const comp = _readCompanion(db, companionId);
  if (!comp) return { ok: false, reason: "not_found" };
  if (ownerId && comp.owner_id !== ownerId) return { ok: false, reason: "not_owner" };
  const state = _parseState(comp.mount_state);
  state.stamina = clamp(state.stamina + REST_STAMINA_DELTA, 0, 100);
  _writeState(db, companionId, state);
  _logEvent(db, companionId, "rest", { stamina: REST_STAMINA_DELTA });
  return { ok: true, state };
}

/**
 * HUD bootstrap — read the full care state.
 */
export function getCareState(db, companionId) {
  if (!db || !companionId) return null;
  const comp = _readCompanion(db, companionId);
  if (!comp) return null;
  const state = _parseState(comp.mount_state);
  return {
    companionId,
    state,
    loyalty: Number(comp.loyalty) || 0,
    rideable: loyaltyForRiding(comp.loyalty),
    last_action_at: comp.last_action_at,
    last_ridden_at: comp.last_ridden_at,
  };
}

export const _internals = {
  STATE_DEFAULTS, HUNGER_RATE_PER_HOUR, LOYALTY_DECAY_PER_DAY,
  FEED_HUNGER_DELTA, FEED_LOYALTY_DELTA, GROOM_LOYALTY_DELTA,
  LOYALTY_RIDE_THRESHOLD,
};
