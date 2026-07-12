// server/lib/dungeon-instance.js
//
// C3 / F5.1 — instanced dungeon/raid. A party-scoped PvE encounter that unifies
// the pieces that already existed but were never tied together: boss phases
// (hp%-thresholded, like the E0#3 boss-HUD), difficulty tiers (run-difficulty),
// per-member damage accounting, role/loot gating, and a clear lockout.
//
// Boss state lives in the DB (phase_idx + boss_hp) so the encounter survives a
// reconnect; the phase model is most-restrictive-first thresholds.

import crypto from "node:crypto";
import { resolveRunDifficulty, recordRunClear } from "./run-difficulty.js";
// Wave 4 gap-closure — reuse the shared combat damage ceiling instead of a
// dungeon-local magic number. `recordHit` used to accept `input.damage` from
// any authenticated caller with no upper bound (Math.max(0, Number(damage))
// only floors it); a malicious client could report arbitrary boss damage and
// clear any instance (and its loot-by-damage-share) in one hit. This mirrors
// the discipline `routes/worlds.js#_validateDamageCap` applies to the real
// combat route: REJECT a report over the ceiling rather than silently
// clamping it, so a bogus report does zero damage instead of a diminished-
// but-still-wrong amount.
import { resolvedDamageCap } from "./combat-limits.js";

// Authored encounters — real phased bosses with role-relevant mechanics.
export const DUNGEON_ENCOUNTERS = Object.freeze({
  hollow_warden: {
    id: "hollow_warden", name: "The Hollow Warden", baseHp: 4000,
    phases: [
      { name: "guarded",   atHpPct: 1.00, mechanic: "tank holds aggro" },
      { name: "sundered",  atHpPct: 0.66, mechanic: "adds spawn — dps split" },
      { name: "desperate", atHpPct: 0.33, mechanic: "enrage — healer triage" },
    ],
    lockoutH: 18,
  },
  tide_colossus: {
    id: "tide_colossus", name: "Tide Colossus", baseHp: 6000,
    phases: [
      { name: "rising",  atHpPct: 1.00, mechanic: "stack for the wave" },
      { name: "surge",   atHpPct: 0.50, mechanic: "spread — chain lightning" },
      { name: "undertow",atHpPct: 0.20, mechanic: "burn before the pull" },
    ],
    lockoutH: 24,
  },
});

function tableExists(db, name) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name); }
  catch { return false; }
}

/** Phase index for a given hp fraction (most-restrictive-first). */
function phaseForHp(phases, hpPct) {
  // phases are ordered descending by atHpPct; the active phase is the last one
  // whose threshold the boss has dropped to.
  let idx = 0;
  for (let i = 0; i < phases.length; i++) {
    if (hpPct <= phases[i].atHpPct) idx = i;
  }
  return idx;
}

/** Is the user locked out of this encounter+tier? */
export function isLockedOut(db, userId, encounterId, tier, now = Math.floor(Date.now() / 1000)) {
  if (!db || !tableExists(db, "dungeon_lockouts")) return false;
  try {
    const row = db.prepare(`
      SELECT locked_until FROM dungeon_lockouts WHERE user_id = ? AND encounter_id = ? AND tier = ?
    `).get(userId, encounterId, tier);
    return !!row && row.locked_until > now;
  } catch { return false; }
}

/**
 * Open an instance for a party. Validates the encounter, the leader's lockout,
 * and the difficulty tier; scales boss HP by tier + party size. Inserts the
 * instance + participants. Returns { ok, instanceId, boss } or { ok:false }.
 */
export function openInstance(db, { leaderUserId, worldId, encounterId, tier = "finder", members = [], roles = {} } = {}) {
  if (!db || !leaderUserId || !worldId || !encounterId) return { ok: false, reason: "missing_inputs" };
  if (!tableExists(db, "dungeon_instances")) return { ok: false, reason: "unavailable" };
  const enc = DUNGEON_ENCOUNTERS[encounterId];
  if (!enc) return { ok: false, reason: "unknown_encounter" };

  if (isLockedOut(db, leaderUserId, encounterId, tier)) return { ok: false, reason: "locked_out" };

  // Difficulty gate (reuses C2). The dungeon's own encounter chain.
  const diff = resolveRunDifficulty(db, leaderUserId, "dungeon", tier);
  if (!diff.ok) return { ok: false, reason: diff.reason, tier };
  const healthMul = diff.modifier?.health_mult ?? 1;

  // The roster is the leader + members (deduped). HP scales with tier + size.
  const roster = [...new Set([leaderUserId, ...members])];
  const sizeFactor = 1 + (roster.length - 1) * 0.6; // each extra member +60% HP
  const maxHp = Math.round(enc.baseHp * healthMul * sizeFactor);

  const id = `dng_${crypto.randomBytes(6).toString("hex")}`;
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO dungeon_instances
        (id, world_id, leader_user, encounter_id, tier, boss_name, boss_hp, boss_max_hp, phase_idx, phase_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(id, worldId, leaderUserId, encounterId, tier, enc.name, maxHp, maxHp, enc.phases[0].name);
    for (const uid of roster) {
      db.prepare(`
        INSERT INTO dungeon_participants (instance_id, user_id, role) VALUES (?, ?, ?)
      `).run(id, uid, roles[uid] || (uid === leaderUserId ? "tank" : "dps"));
    }
  });
  tx();
  return { ok: true, instanceId: id, boss: { name: enc.name, hp: maxHp, maxHp, phase: enc.phases[0].name }, roster };
}

/**
 * A participant lands a hit. Reduces boss HP, accumulates per-member damage,
 * advances the phase on threshold crossings, and clears the instance at 0 HP
 * (distributing loot + applying lockouts). Returns the live boss state.
 */
export function recordHit(db, instanceId, userId, damage) {
  if (!db || !instanceId || !userId) return { ok: false, reason: "missing_inputs" };
  const inst = db.prepare(`SELECT * FROM dungeon_instances WHERE id = ?`).get(instanceId);
  if (!inst) return { ok: false, reason: "no_instance" };
  if (inst.status !== "active") return { ok: false, reason: "not_active", status: inst.status };
  const part = db.prepare(`SELECT 1 FROM dungeon_participants WHERE instance_id = ? AND user_id = ?`).get(instanceId, userId);
  if (!part) return { ok: false, reason: "not_a_participant" };

  // Server-authoritative damage ceiling (Wave 4 gap-closure). No skill
  // context reaches this macro today, so this uses the no-skill hard cap
  // (COMBAT_DAMAGE_HARD_CAP, currently 500) — the same ceiling a world-combat
  // hit without an authored `max_damage` would be held to. A report above the
  // cap is rejected outright (boss HP is untouched) rather than clamped, so a
  // hostile client can't grind out max-cap hits faster than a real attacker.
  const requested = Number(damage) || 0;
  const cap = resolvedDamageCap();
  if (requested > cap) {
    return { ok: false, reason: "damage_cap_exceeded", cap, requested };
  }
  const dmg = Math.max(0, requested);
  const enc = DUNGEON_ENCOUNTERS[inst.encounter_id];
  const newHp = Math.max(0, inst.boss_hp - dmg);
  const hpPct = inst.boss_max_hp > 0 ? newHp / inst.boss_max_hp : 0;
  const phaseIdx = enc ? phaseForHp(enc.phases, hpPct) : 0;
  const phaseName = enc ? enc.phases[phaseIdx].name : null;

  db.prepare(`UPDATE dungeon_instances SET boss_hp = ?, phase_idx = ?, phase_name = ? WHERE id = ?`)
    .run(newHp, phaseIdx, phaseName, instanceId);
  db.prepare(`UPDATE dungeon_participants SET damage_dealt = damage_dealt + ? WHERE instance_id = ? AND user_id = ?`)
    .run(dmg, instanceId, userId);

  let cleared = false;
  if (newHp <= 0) { cleared = true; _clearInstance(db, inst, enc); }

  return {
    ok: true, instanceId, bossHp: newHp, bossMaxHp: inst.boss_max_hp,
    hpPct: Math.round(hpPct * 1000) / 1000, phaseIdx, phaseName,
    phaseAdvanced: phaseIdx > inst.phase_idx, cleared,
  };
}

function _clearInstance(db, inst, enc) {
  const tx = db.transaction(() => {
    db.prepare(`UPDATE dungeon_instances SET status = 'cleared', ended_at = unixepoch() WHERE id = ?`).run(inst.id);
    // Loot by damage share (everyone who contributed gets a roll; share scales).
    const parts = db.prepare(`SELECT user_id, damage_dealt FROM dungeon_participants WHERE instance_id = ?`).all(inst.id);
    const total = parts.reduce((s, p) => s + (p.damage_dealt || 0), 0) || 1;
    for (const p of parts) {
      const share = Math.round((p.damage_dealt / total) * 1000) / 1000;
      db.prepare(`UPDATE dungeon_participants SET loot_json = ? WHERE instance_id = ? AND user_id = ?`)
        .run(JSON.stringify({ share, rolls: 1 + (share >= 0.25 ? 1 : 0) }), inst.id, p.user_id);
      // Lockout + tier-clear credit for each participant.
      const until = Math.floor(Date.now() / 1000) + (enc?.lockoutH || 18) * 3600;
      db.prepare(`
        INSERT INTO dungeon_lockouts (user_id, encounter_id, tier, locked_until)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, encounter_id, tier) DO UPDATE SET locked_until = excluded.locked_until
      `).run(p.user_id, inst.encounter_id, inst.tier, until);
      try { recordRunClear(db, p.user_id, "dungeon", inst.tier); } catch { /* tier table optional */ }
    }
  });
  tx();
}

/** Mark a participant downed; if all are downed, the instance wipes. */
export function downParticipant(db, instanceId, userId) {
  if (!db || !instanceId || !userId) return { ok: false, reason: "missing_inputs" };
  db.prepare(`UPDATE dungeon_participants SET downed = 1 WHERE instance_id = ? AND user_id = ?`).run(instanceId, userId);
  const alive = db.prepare(`SELECT COUNT(*) AS n FROM dungeon_participants WHERE instance_id = ? AND downed = 0`).get(instanceId).n;
  if (alive === 0) {
    db.prepare(`UPDATE dungeon_instances SET status = 'wiped', ended_at = unixepoch() WHERE id = ? AND status = 'active'`).run(instanceId);
    return { ok: true, wiped: true };
  }
  return { ok: true, wiped: false, alive };
}

/** Full instance state (+ participants) for the HUD. */
export function getInstance(db, instanceId) {
  if (!db || !instanceId) return null;
  const inst = db.prepare(`SELECT * FROM dungeon_instances WHERE id = ?`).get(instanceId);
  if (!inst) return null;
  const participants = db.prepare(`SELECT user_id, role, damage_dealt, downed, loot_json FROM dungeon_participants WHERE instance_id = ?`).all(instanceId);
  return { ...inst, participants };
}

/**
 * Wave 4 gap-closure — the live instance a user is currently participating
 * in (if any), so a frontend HUD can reconnect to an in-progress raid
 * without needing to remember an instanceId across reloads/party members.
 * Scoped to the most recently opened active instance when a user is
 * (unusually) in more than one — `openInstance` doesn't prevent a leader
 * from opening a second instance, so this is a defensive ORDER BY, not an
 * assumed invariant.
 */
export function getActiveInstanceForUser(db, userId, worldId) {
  if (!db || !userId) return null;
  if (!tableExists(db, "dungeon_instances")) return null;
  const row = worldId
    ? db.prepare(`
        SELECT di.id FROM dungeon_instances di
        JOIN dungeon_participants dp ON dp.instance_id = di.id
        WHERE dp.user_id = ? AND di.status = 'active' AND di.world_id = ?
        ORDER BY di.started_at DESC LIMIT 1
      `).get(userId, worldId)
    : db.prepare(`
        SELECT di.id FROM dungeon_instances di
        JOIN dungeon_participants dp ON dp.instance_id = di.id
        WHERE dp.user_id = ? AND di.status = 'active'
        ORDER BY di.started_at DESC LIMIT 1
      `).get(userId);
  return row ? getInstance(db, row.id) : null;
}

/**
 * Wave 4 gap-closure — a user's currently-active dungeon lockouts (encounter
 * + tier + until timestamp), so the HUD can show "locked N hours" instead of
 * only surfacing the failure after a rejected `open` call.
 */
export function getLockoutsForUser(db, userId, now = Math.floor(Date.now() / 1000)) {
  if (!db || !userId || !tableExists(db, "dungeon_lockouts")) return [];
  try {
    return db.prepare(`
      SELECT encounter_id, tier, locked_until FROM dungeon_lockouts
      WHERE user_id = ? AND locked_until > ?
    `).all(userId, now).map((r) => ({ encounterId: r.encounter_id, tier: r.tier, lockedUntil: r.locked_until }));
  } catch { return []; }
}
