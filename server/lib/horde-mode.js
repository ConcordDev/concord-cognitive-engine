// server/lib/horde-mode.js
//
// Phase CB2 — bullet heaven horde mode.
//
// Wave count scales exponentially. Each wave end, the player picks
// one of three random upgrades. Damage cap is bypassed by design
// (the genre's signature is "numbers exploding upward").
//
// 9 authored upgrades. Auto-attack mode is the default — the combat
// route reads horde_runs.auto_attack to decide whether to tick damage
// without explicit player input.

import crypto from "node:crypto";
import logger from "../logger.js";
import { grantRunMeta } from "./run-difficulty.js";

// D6 — horde is a survival mode: it ALWAYS ends in a "loss" (death/timeout),
// so the payout is the wave/kill yield itself. The wave reached IS the risk
// gradient (deeper waves spawn faster, mig 246), so reward scales with it.
const HORDE_META_PER_WAVE = Number(process.env.CONCORD_HORDE_META_PER_WAVE) || 8;
const HORDE_META_PER_KILL = Number(process.env.CONCORD_HORDE_META_PER_KILL) || 0.25;

export const UPGRADE_CATALOG = Object.freeze([
  { id: "blade_storm",     name: "Blade Storm",     effect: "all damage +25%" },
  { id: "hot_blooded",     name: "Hot Blooded",     effect: "attack speed +20%" },
  { id: "thorned_aura",    name: "Thorned Aura",    effect: "reflect 15% damage" },
  { id: "ember_lash",      name: "Ember Lash",      effect: "fire DoT on hit" },
  { id: "iron_hide",       name: "Iron Hide",       effect: "max HP +30" },
  { id: "swift_recovery",  name: "Swift Recovery",  effect: "regen +5/s" },
  { id: "magnet_charm",    name: "Magnet Charm",    effect: "pickup radius +50%" },
  { id: "second_wind",     name: "Second Wind",     effect: "once per run, revive at 50% HP" },
  { id: "crit_oath",       name: "Crit Oath",       effect: "+10% crit chance" },
]);

const BASE_SPAWN_RATE = 1.0;       // mobs/sec at wave 0
const SPAWN_RATE_GROWTH = 1.25;    // multiplier per wave

export function spawnRateAtWave(wave) {
  return BASE_SPAWN_RATE * Math.pow(SPAWN_RATE_GROWTH, Math.max(0, wave - 1));
}

export function startHorde(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const { worldId } = opts;
  if (!worldId) return { ok: false, error: "missing_worldId" };
  try {
    const active = db.prepare(`
      SELECT id FROM horde_runs WHERE user_id = ? AND ended_at IS NULL
    `).get(userId);
    if (active) return { ok: true, runId: active.id, alreadyActive: true };

    const id = `hrd_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO horde_runs (id, user_id, world_id) VALUES (?, ?, ?)
    `).run(id, userId, worldId);
    logger.info?.("horde-mode", "run_started", { runId: id, userId });
    return { ok: true, runId: id, alreadyActive: false };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function tickWave(db, runId, opts = {}) {
  if (!db || !runId) return { ok: false, error: "missing_inputs" };
  try {
    const r = db.prepare(`SELECT wave_reached, kills, ended_at FROM horde_runs WHERE id = ?`).get(runId);
    if (!r) return { ok: false, error: "no_run" };
    if (r.ended_at) return { ok: false, error: "run_ended" };
    const killsAdd = Math.max(0, Math.floor(Number(opts.killsThisWave) || 0));
    const newWave = (r.wave_reached || 0) + 1;
    const newKills = (r.kills || 0) + killsAdd;
    const newScore = newKills * 10 + newWave * 25;
    db.prepare(`
      UPDATE horde_runs
      SET wave_reached = ?, kills = ?, score = ?
      WHERE id = ?
    `).run(newWave, newKills, newScore, runId);
    return {
      ok: true,
      wave: newWave,
      kills: newKills,
      score: newScore,
      spawnRate: spawnRateAtWave(newWave),
      upgradeChoices: _rollUpgrades(db, runId, 3),
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _rollUpgrades(db, runId, count) {
  try {
    const picked = db.prepare(`
      SELECT upgrade_id FROM horde_upgrades WHERE run_id = ?
    `).all(runId).map(r => r.upgrade_id);
    const available = UPGRADE_CATALOG.filter(u => !picked.includes(u.id));
    if (available.length === 0) return [];
    // Deterministic seed so re-roll on same wave returns the same set.
    const seed = parseInt(crypto.createHash("sha1")
      .update(runId + ":" + picked.length)
      .digest("hex").slice(0, 8), 16);
    const shuffled = [...available].sort((a, b) => {
      const ha = parseInt(crypto.createHash("sha1").update(a.id + seed).digest("hex").slice(0, 4), 16);
      const hb = parseInt(crypto.createHash("sha1").update(b.id + seed).digest("hex").slice(0, 4), 16);
      return ha - hb;
    });
    return shuffled.slice(0, count);
  } catch { return []; }
}

export function pickUpgrade(db, runId, upgradeId) {
  if (!db || !runId || !upgradeId) return { ok: false, error: "missing_inputs" };
  if (!UPGRADE_CATALOG.find(u => u.id === upgradeId)) {
    return { ok: false, error: "invalid_upgrade" };
  }
  try {
    const r = db.prepare(`SELECT ended_at FROM horde_runs WHERE id = ?`).get(runId);
    if (!r) return { ok: false, error: "no_run" };
    if (r.ended_at) return { ok: false, error: "run_ended" };

    const existing = db.prepare(`
      SELECT COUNT(*) AS n FROM horde_upgrades WHERE run_id = ?
    `).get(runId);
    const nextSlot = (existing?.n || 0);
    try {
      db.prepare(`
        INSERT INTO horde_upgrades (run_id, slot_idx, upgrade_id)
        VALUES (?, ?, ?)
      `).run(runId, nextSlot, upgradeId);
    } catch (err) {
      if (String(err?.message || "").includes("UNIQUE")) {
        return { ok: false, error: "slot_collision" };
      }
      throw err;
    }
    return { ok: true, slotIdx: nextSlot };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function endHorde(db, runId, opts = {}) {
  if (!db || !runId) return { ok: false, error: "missing_inputs" };
  const { reason = "death" } = opts;
  if (!["death", "timeout", "manual"].includes(reason)) {
    return { ok: false, error: "invalid_reason" };
  }
  try {
    const r = db.prepare(`SELECT user_id, ended_at, wave_reached, kills FROM horde_runs WHERE id = ?`).get(runId);
    if (!r) return { ok: false, error: "no_run" };
    if (r.ended_at) return { ok: false, error: "already_ended" };
    db.prepare(`
      UPDATE horde_runs SET ended_at = unixepoch(), end_reason = ?
      WHERE id = ?
    `).run(reason, runId);
    // D6 — payout on EVERY end (death included): the run is the reward. Banks
    // into the shared run-meta gem bank so a wipe still advances meta-progress.
    const earned = Math.floor((r.wave_reached || 0) * HORDE_META_PER_WAVE + (r.kills || 0) * HORDE_META_PER_KILL);
    const grant = earned > 0 ? grantRunMeta(db, r.user_id, earned) : { granted: 0 };
    logger.info?.("horde", "run_ended", { runId, reason, earned: grant.granted || 0, wave: r.wave_reached });
    return { ok: true, reason, earned: grant.granted || 0, waveReached: r.wave_reached || 0 };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getActiveHorde(db, userId) {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT id, world_id, started_at, wave_reached, kills, score, auto_attack
      FROM horde_runs WHERE user_id = ? AND ended_at IS NULL
    `).get(userId) || null;
  } catch { return null; }
}

export function isHordeAutoAttack(db, userId) {
  const r = getActiveHorde(db, userId);
  return !!(r && r.auto_attack);
}

export { BASE_SPAWN_RATE, SPAWN_RATE_GROWTH };
