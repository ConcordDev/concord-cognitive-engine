// server/lib/world-props.js
//
// Wave G1 — interactable world props.
//
// Public API:
//   composeAuthoredProps(db, worldId, propList) — seed from JSON (idempotent)
//   composeProceduralProps(db, worldId, district) — seed procedurally
//   listInWorld(db, worldId, opts?)             — list (optionally filtered)
//   listNearby(db, worldId, x, z, radius)       — radius lookup
//   getProp(db, propId)                          — single read
//   interact(db, opts)                           — gated interact + log
//
// Interaction model: every prop_kind defines:
//   - the verbs it accepts (sit, drink, light, read, knock, lean, sleep…)
//   - which animation clip to play on the player avatar
//   - what side-effect lands (signal feedback, durability decrement,
//     state transition, optional active_effect on the user)
//
// Distance gate: ≤3m from prop. Cooldown: 5s per (user, prop, kind).
// Feedback: writes a recordSignal so torches warm a thermal cell, knocks
// emit sonic_db, lighting a brazier writes air_quality, etc.

import crypto from "crypto";
import logger from "../logger.js";

// ── Prop kind catalog ─────────────────────────────────────────────────
//
// Each kind lists allowed verbs and the animation clip the player should
// play. Some verbs are state-transitioning (light a torch flips lit=true);
// others are repeatable (drink, sit, read). Signal feedback channels match
// the sensory-OS naming used by embodied/signals.js.

export const PROP_KIND_CATALOG = Object.freeze({
  chair:      { verbs: ["sit"],             clip: { sit: "sit" }, durabilityCost: 0 },
  bench:      { verbs: ["sit", "lean"],     clip: { sit: "sit", lean: "lean" } },
  table:      { verbs: ["lean"],            clip: { lean: "lean" } },
  mug:        { verbs: ["drink"],           clip: { drink: "drink" }, durabilityCost: 0.05, signal: { drink: ["sonic_os.ambient_db", 1.2, 30] } },
  torch:      { verbs: ["light"],           clip: { light: "light-torch" }, signal: { light: ["thermal_os.ambient_temp", 0.4, 600] } },
  brazier:    { verbs: ["light"],           clip: { light: "light-torch" }, signal: { light: ["thermal_os.ambient_temp", 0.8, 900] } },
  bookshelf:  { verbs: ["read"],            clip: { read: "read" } },
  bed:        { verbs: ["sleep"],           clip: { sleep: "sleep" } },
  anvil:      { verbs: ["knock"],           clip: { knock: "hammer" }, signal: { knock: ["sonic_os.ambient_db", 4.0, 60] } },
  well:       { verbs: ["drink"],           clip: { drink: "drink" } },
  signpost:   { verbs: ["read"],            clip: { read: "read" } },
  lantern:    { verbs: ["light"],           clip: { light: "light-torch" }, signal: { light: ["sight_os.illumination", 800, 1200] } },
  banner:     { verbs: ["touch"],           clip: { touch: "hand-extend" } },
});

const DEFAULT_VERB = (kind) => PROP_KIND_CATALOG[kind]?.verbs?.[0];
const INTERACT_RADIUS_M = 3;
const COOLDOWN_S = 5;

function _tryJSON(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function _propId() {
  return `prop_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Insert/update authored props from a `content/world/<world>/props.json`
 * payload. Idempotent on (world_id, district, prop_kind, x, z) — same
 * authored entry written twice produces one row.
 */
export function composeAuthoredProps(db, worldId, propList = []) {
  if (!db || !worldId || !Array.isArray(propList)) {
    return { ok: false, reason: "missing_args", inserted: 0, skipped: 0 };
  }
  let inserted = 0, skipped = 0;
  for (const p of propList) {
    if (!p || !p.kind || typeof p.x !== "number" || typeof p.z !== "number") {
      skipped++; continue;
    }
    if (!PROP_KIND_CATALOG[p.kind]) { skipped++; continue; }
    try {
      const existing = db.prepare(`
        SELECT id FROM world_props
        WHERE world_id = ? AND prop_kind = ?
          AND ABS(x - ?) < 0.5 AND ABS(z - ?) < 0.5
          AND COALESCE(district, '') = COALESCE(?, '')
      `).get(worldId, p.kind, p.x, p.z, p.district || null);
      if (existing) { skipped++; continue; }
      db.prepare(`
        INSERT INTO world_props (id, world_id, district, prop_kind, x, z, y, rotation, variant, durability, state_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        _propId(), worldId, p.district || null, p.kind,
        p.x, p.z, p.y || 0, p.rotation || 0,
        p.variant || null, 1.0,
        p.state ? JSON.stringify(p.state) : null,
      );
      inserted++;
    } catch (err) {
      logger?.warn?.("world-props", "compose_failed", { kind: p.kind, error: err?.message });
      skipped++;
    }
  }
  return { ok: true, inserted, skipped };
}

/**
 * Procedural prop generation per district. Deterministic from
 * (worldId, district, kindBudget). Used for districts that don't have
 * an authored props.json entry.
 */
export function composeProceduralProps(db, worldId, district, kindBudget = {}) {
  if (!db || !worldId || !district) return { ok: false, reason: "missing_args", inserted: 0 };
  const seedStr = `${worldId}|${district}|procedural`;
  function seededInt(salt) {
    return crypto.createHash("sha1").update(`${seedStr}|${salt}`).digest().readUInt32BE(0);
  }
  let inserted = 0;
  for (const [kind, count] of Object.entries(kindBudget)) {
    if (!PROP_KIND_CATALOG[kind]) continue;
    for (let i = 0; i < count; i++) {
      const dx = ((seededInt(`${kind}|${i}|x`) % 200) - 100);
      const dz = ((seededInt(`${kind}|${i}|z`) % 200) - 100);
      const rot = (seededInt(`${kind}|${i}|r`) % 360) * Math.PI / 180;
      try {
        db.prepare(`
          INSERT INTO world_props (id, world_id, district, prop_kind, x, z, y, rotation, variant, durability)
          VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 1.0)
        `).run(_propId(), worldId, district, kind, dx, dz, rot, null);
        inserted++;
      } catch { /* ok */ }
    }
  }
  return { ok: true, inserted };
}

export function listInWorld(db, worldId, { district = null, kind = null, limit = 500 } = {}) {
  if (!db || !worldId) return [];
  try {
    let q = `SELECT * FROM world_props WHERE world_id = ?`;
    const args = [worldId];
    if (district) { q += ` AND district = ?`; args.push(district); }
    if (kind)     { q += ` AND prop_kind = ?`; args.push(kind); }
    q += ` ORDER BY created_at ASC LIMIT ?`;
    args.push(limit);
    return db.prepare(q).all(...args).map((p) => ({
      ...p, state: _tryJSON(p.state_json),
    }));
  } catch { return []; }
}

export function listNearby(db, worldId, x, z, radius = 40) {
  if (!db || !worldId || typeof x !== "number" || typeof z !== "number") return [];
  try {
    // Pull a bounding box first, then refine by Euclidean radius.
    const rows = db.prepare(`
      SELECT * FROM world_props
      WHERE world_id = ?
        AND x BETWEEN ? AND ?
        AND z BETWEEN ? AND ?
    `).all(worldId, x - radius, x + radius, z - radius, z + radius);
    const r2 = radius * radius;
    return rows
      .filter((p) => {
        const dx = p.x - x, dz = p.z - z;
        return dx * dx + dz * dz <= r2;
      })
      .map((p) => ({ ...p, state: _tryJSON(p.state_json) }));
  } catch { return []; }
}

export function getProp(db, propId) {
  if (!db || !propId) return null;
  try {
    const p = db.prepare(`SELECT * FROM world_props WHERE id = ?`).get(propId);
    if (!p) return null;
    return { ...p, state: _tryJSON(p.state_json) };
  } catch { return null; }
}

/**
 * Player interaction with a prop. Validates distance, cooldown, verb;
 * records signal feedback; decrements durability; writes log; returns
 * the animation clip the client should play.
 *
 * opts: { propId, userId, kind, position: {x,z}, recordSignal? }
 *   - kind: optional explicit verb (default: prop's first verb)
 *   - position: player position for distance gate
 *   - recordSignal: optional injected fn (for testing); defaults to
 *     the embodied/signals.js recordSignal so tests can stub.
 */
export function interact(db, opts = {}) {
  const { propId, userId, kind: rawKind, position, recordSignal: recordSignalFn } = opts;
  if (!db || !propId || !userId) return { ok: false, reason: "missing_args" };

  const prop = getProp(db, propId);
  if (!prop) return { ok: false, reason: "prop_not_found" };

  const catalog = PROP_KIND_CATALOG[prop.prop_kind];
  if (!catalog) return { ok: false, reason: "unknown_kind" };

  const kind = rawKind || DEFAULT_VERB(prop.prop_kind);
  if (!catalog.verbs.includes(kind)) return { ok: false, reason: "verb_not_supported", kind };

  // Distance gate (if position given).
  if (position && typeof position.x === "number" && typeof position.z === "number") {
    const dx = prop.x - position.x, dz = prop.z - position.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > INTERACT_RADIUS_M * INTERACT_RADIUS_M) {
      return { ok: false, reason: "too_far", distance: Math.sqrt(d2) };
    }
  }

  // Cooldown gate.
  try {
    const last = db.prepare(`
      SELECT at FROM prop_interaction_log
      WHERE prop_id = ? AND user_id = ? AND kind = ?
      ORDER BY at DESC LIMIT 1
    `).get(propId, userId, kind);
    if (last && (Date.now() / 1000 - last.at) < COOLDOWN_S) {
      return { ok: false, reason: "cooldown", retryInS: COOLDOWN_S - Math.floor(Date.now() / 1000 - last.at) };
    }
  } catch { /* ok */ }

  // Write log.
  try {
    db.prepare(`
      INSERT INTO prop_interaction_log (prop_id, user_id, kind) VALUES (?, ?, ?)
    `).run(propId, userId, kind);
  } catch { /* ok */ }

  // Durability decrement (mugs deplete; torches don't unless using "light").
  const durabilityCost = catalog.durabilityCost ?? 0;
  if (durabilityCost > 0) {
    try {
      const newDurability = Math.max(0, prop.durability - durabilityCost);
      db.prepare(`UPDATE world_props SET durability = ? WHERE id = ?`).run(newDurability, propId);
    } catch { /* ok */ }
  }

  // Signal feedback.
  const signalSpec = catalog.signal?.[kind];
  if (signalSpec) {
    const [channel, value, ttlSeconds] = signalSpec;
    try {
      if (recordSignalFn) {
        recordSignalFn(db, {
          worldId: prop.world_id, channel, value, ttlSeconds,
          x: prop.x, z: prop.z, source: "prop_interact",
        });
      } else {
        // Lazy import to avoid cyclic deps with embodied/signals.js test harness.
        const { recordSignal } = require("./embodied/signals.js");
        recordSignal(db, {
          worldId: prop.world_id, channel, value, ttlSeconds,
          x: prop.x, z: prop.z, source: "prop_interact",
        });
      }
    } catch { /* ok — signal feedback is best-effort */ }
  }

  // State transition (e.g. torch lit=true). Stored in state_json.
  const newState = { ...(prop.state || {}) };
  if (kind === "light") newState.lit = true;
  if (kind === "sit")   newState.occupied_by = userId;
  if (kind === "knock") newState.last_knock_at = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`UPDATE world_props SET state_json = ? WHERE id = ?`)
      .run(JSON.stringify(newState), propId);
  } catch { /* ok */ }

  return {
    ok: true,
    propId, kind,
    clip: catalog.clip?.[kind] || null,
    state: newState,
    worldId: prop.world_id,
    propKind: prop.prop_kind,
  };
}

/**
 * Refill / repair pass for the heartbeat. Restores mug durability,
 * unsets `lit` after 30min on torches, clears `occupied_by` if the
 * sit interaction is older than 60s. Bounded.
 */
export function refillProps(db, { maxRows = 200 } = {}) {
  if (!db) return { ok: false, reason: "no_db", touched: 0 };
  let touched = 0;
  try {
    // Refill consumables (mugs etc.).
    const consumables = db.prepare(`
      SELECT id, prop_kind, durability FROM world_props
      WHERE durability < 1.0 LIMIT ?
    `).all(maxRows);
    for (const row of consumables) {
      try {
        const catalog = PROP_KIND_CATALOG[row.prop_kind];
        if (!catalog) continue;
        // Linear refill 5% per pass.
        const newD = Math.min(1.0, row.durability + 0.05);
        db.prepare(`UPDATE world_props SET durability = ? WHERE id = ?`).run(newD, row.id);
        touched++;
      } catch { /* ok */ }
    }
    // Clear stale state markers (occupied_by older than 60s).
    const now = Math.floor(Date.now() / 1000);
    const stateful = db.prepare(`
      SELECT id, state_json FROM world_props
      WHERE state_json IS NOT NULL AND state_json != '' LIMIT ?
    `).all(maxRows);
    for (const row of stateful) {
      try {
        const s = _tryJSON(row.state_json);
        if (!s) continue;
        let changed = false;
        if (s.occupied_by) {
          // Check the most recent sit interaction; clear if >60s.
          const last = db.prepare(`
            SELECT at FROM prop_interaction_log
            WHERE prop_id = ? AND kind = 'sit' ORDER BY at DESC LIMIT 1
          `).get(row.id);
          if (!last || (now - last.at) > 60) {
            delete s.occupied_by;
            changed = true;
          }
        }
        // Lit torches eventually go out (12 in-game min real-time → 720s).
        if (s.lit && s.lit_at && (now - s.lit_at) > 720) {
          s.lit = false; delete s.lit_at; changed = true;
        }
        if (changed) {
          db.prepare(`UPDATE world_props SET state_json = ? WHERE id = ?`)
            .run(JSON.stringify(s), row.id);
          touched++;
        }
      } catch { /* ok */ }
    }
  } catch { /* ok */ }
  return { ok: true, touched };
}
