// server/lib/horde-mode.js
//
// Phase CB2 — bullet heaven horde mode.
//
// Wave count scales exponentially. Each wave end, the player picks
// one of three random upgrades. Damage cap is bypassed by design
// (the genre's signature is "numbers exploding upward").
//
// Auto-attack mode is the default — `isHordeAutoAttack` exposes
// horde_runs.auto_attack for a future combat-route auto-tick; today the
// player still drives their own attacks (socket combat:attack / the
// skill-cast REST route), and this run's picked boons modify THAT
// damage — see server/lib/run-modifiers.js.
//
// Wave 4 gap-closure: the wave-upgrade offering used to be 9 purely
// COSMETIC strings (UPGRADE_CATALOG, kept below for historical reference —
// nothing reads it anymore) with no mechanical effect. It now delegates to
// the shared structured draft engine (run-draft.js) so a picked boon has a
// real {stat, value} effect that server/lib/run-modifiers.js folds into the
// player's combat math for the rest of the run.

import crypto from "node:crypto";
import logger from "../logger.js";
import { grantRunMeta } from "./run-difficulty.js";
import { rollDraft, recordPick, getRunModifiers, nearSynergyHints } from "./run-draft.js";

// D6 — horde is a survival mode: it ALWAYS ends in a "loss" (death/timeout),
// so the payout is the wave/kill yield itself. The wave reached IS the risk
// gradient (deeper waves spawn faster, mig 246), so reward scales with it.
const HORDE_META_PER_WAVE = Number(process.env.CONCORD_HORDE_META_PER_WAVE) || 8;
const HORDE_META_PER_KILL = Number(process.env.CONCORD_HORDE_META_PER_KILL) || 0.25;

// DEPRECATED — superseded by run-draft.js's DRAFT_POOL (Wave 4). Kept only so
// the id vocabulary + historical flavor text stay grep-able; _rollUpgrades /
// pickUpgrade no longer read this. "second_wind" (revive) has no DRAFT_POOL
// equivalent — horde has no revive mechanic today (only roguelite's
// purchased `second_chance` meta-unlock does; see roguelite.js).
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
      // Wave 4 — structured draft offering (real {stat,value} effects) instead
      // of the old cosmetic-string UPGRADE_CATALOG roll. Still deterministic
      // per (runId, picks-so-far) via run-draft.js#rollDraft.
      upgradeChoices: rollDraft(db, "horde", runId, 3),
      synergyHints: nearSynergyHints(db, "horde", runId),
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Wave 4 — records a wave-upgrade pick through the shared structured draft
 * engine (run-draft.js) so the boon's {stat,value} effect is real and reads
 * back through server/lib/run-modifiers.js#getActiveRunModifiers, which the
 * combat routes apply to this player's damage for the rest of the run.
 *
 * The historical `horde_upgrades` table + UPGRADE_CATALOG cosmetic strings
 * are no longer written to — `run_draft_picks` (run_kind='horde') is now the
 * single source of truth for a horde run's picks, shared with roguelite's
 * draft moment via the same engine.
 */
export function pickUpgrade(db, runId, upgradeId) {
  if (!db || !runId || !upgradeId) return { ok: false, error: "missing_inputs" };
  try {
    const r = db.prepare(`SELECT user_id, ended_at FROM horde_runs WHERE id = ?`).get(runId);
    if (!r) return { ok: false, error: "no_run" };
    if (r.ended_at) return { ok: false, error: "run_ended" };

    const rec = recordPick(db, { runKind: "horde", runId, userId: r.user_id, pickId: upgradeId });
    if (!rec.ok) {
      // Preserve the historical error vocabulary callers/tests expect.
      const error = rec.reason === "unknown_boon" ? "invalid_upgrade"
        : rec.reason === "already_picked" ? "slot_collision"
        : (rec.reason || "pick_failed");
      return { ok: false, error };
    }
    const bundle = getRunModifiers(db, "horde", runId);
    return {
      ok: true,
      pickId: rec.pickId,
      boon: rec.boon,
      modifiers: bundle.modifiers,
      synergies: bundle.synergies,
    };
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
    const run = db.prepare(`
      SELECT id, world_id, started_at, wave_reached, kills, score, auto_attack
      FROM horde_runs WHERE user_id = ? AND ended_at IS NULL
    `).get(userId) || null;
    if (!run) return null;
    // Wave 4 — surface the live accumulated modifier bundle alongside the run
    // so the HUD can show real "damage +X%" numbers without a second request.
    try {
      const bundle = getRunModifiers(db, "horde", run.id);
      run.modifiers = bundle.modifiers;
      run.synergies = bundle.synergies;
    } catch { run.modifiers = {}; run.synergies = []; }
    return run;
  } catch { return null; }
}

export function isHordeAutoAttack(db, userId) {
  const r = getActiveHorde(db, userId);
  return !!(r && r.auto_attack);
}

export { BASE_SPAWN_RATE, SPAWN_RATE_GROWTH };
