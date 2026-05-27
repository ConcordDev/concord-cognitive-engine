// server/lib/crime-engine.js
//
// Phase II Wave 23 — player-side crime depth.
//
//   recordCrime — log a crime when a player perpetrates one
//   resolveCrime — flip the unresolved row to paid/jailed/escaped/pardoned
//   issueBounty / claimBounty / cancelBounty — bounty board
//   stakeGangTerritory / advanceControl / tickRackets — gang loops
//   planHeist / executeHeist — heist outcome math against difficulty,
//     crew skill aggregate, target hardness; success rolls a payout
//   listWanted — surface unresolved crimes for the law-enforcement HUD

import crypto from "node:crypto";

const HEIST_SUCCESS_BASE = 0.40;
const HEIST_SUCCESS_PER_CREW_SKILL = 0.10;
const HEIST_WITNESS_BASE_CHANCE = 0.20;

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

/* ───────── Crime records ───────────────────────────────────────────── */

export function recordCrime(db, opts) {
  if (!opts?.perpetratorUserId || !opts?.victimKind || !opts?.victimId || !opts?.crimeKind) {
    return { ok: false, reason: "missing_inputs" };
  }
  const id = uid("crime");
  const severity = Math.max(0, Math.min(1, Number(opts.severity) || 0.5));
  const witnessed = opts.witnessed ? 1 : 0;
  const bountyCents = witnessed ? Math.floor(severity * 1000 + 100) : 0;
  db.prepare(`
    INSERT INTO player_crimes
      (id, perpetrator_user_id, victim_kind, victim_id, crime_kind, world_id, severity, witnessed, bounty_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.perpetratorUserId, opts.victimKind, opts.victimId, opts.crimeKind,
    opts.worldId || null, severity, witnessed, bountyCents,
  );
  return { ok: true, crimeId: id, witnessed: !!witnessed, bountyCents };
}

export function resolveCrime(db, crimeId, resolution) {
  if (!["paid", "jailed", "escaped", "pardoned"].includes(resolution)) {
    return { ok: false, reason: "invalid_resolution" };
  }
  const r = db.prepare(`
    UPDATE player_crimes SET resolved_at = unixepoch(), resolution = ? WHERE id = ? AND resolved_at IS NULL
  `).run(resolution, crimeId);
  return { ok: r.changes > 0 };
}

export function listWanted(db, opts = {}) {
  const sql = opts.worldId
    ? `SELECT * FROM player_crimes WHERE resolved_at IS NULL AND world_id = ? ORDER BY committed_at DESC LIMIT 100`
    : `SELECT * FROM player_crimes WHERE resolved_at IS NULL ORDER BY committed_at DESC LIMIT 100`;
  return opts.worldId
    ? db.prepare(sql).all(opts.worldId)
    : db.prepare(sql).all();
}

/* ───────── Bounties ────────────────────────────────────────────────── */

export function issueBounty(db, opts) {
  if (!opts?.targetKind || !opts?.targetId || !opts?.issuedByKind || !opts?.issuedById || !opts?.amountCents) {
    return { ok: false, reason: "missing_inputs" };
  }
  const id = uid("bounty");
  db.prepare(`
    INSERT INTO bounties (id, target_kind, target_id, issued_by_kind, issued_by_id, amount_cents, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.targetKind, opts.targetId,
    opts.issuedByKind, opts.issuedById,
    Math.max(1, Math.floor(opts.amountCents)),
    String(opts.reason || "wanted").slice(0, 200),
  );
  return { ok: true, bountyId: id };
}

export function claimBounty(db, bountyId, claimantUserId) {
  const b = db.prepare("SELECT * FROM bounties WHERE id = ?").get(bountyId);
  if (!b) return { ok: false, reason: "bounty_not_found" };
  if (b.claimed_at) return { ok: false, reason: "already_claimed" };
  if (b.cancelled_at) return { ok: false, reason: "cancelled" };
  if (b.target_kind === "player" && b.target_id === claimantUserId) return { ok: false, reason: "cannot_claim_self" };
  db.prepare(`
    UPDATE bounties SET claimed_at = unixepoch(), claimed_by_user_id = ? WHERE id = ?
  `).run(claimantUserId, bountyId);
  return { ok: true, amountCents: b.amount_cents };
}

export function cancelBounty(db, bountyId, issuerId) {
  const b = db.prepare("SELECT * FROM bounties WHERE id = ?").get(bountyId);
  if (!b) return { ok: false, reason: "bounty_not_found" };
  if (b.issued_by_id !== issuerId) return { ok: false, reason: "not_issuer" };
  if (b.claimed_at || b.cancelled_at) return { ok: false, reason: "already_closed" };
  db.prepare("UPDATE bounties SET cancelled_at = unixepoch() WHERE id = ?").run(bountyId);
  return { ok: true };
}

export function listBountiesOnTarget(db, targetKind, targetId) {
  return db.prepare(`
    SELECT * FROM bounties WHERE target_kind = ? AND target_id = ? AND claimed_at IS NULL AND cancelled_at IS NULL
    ORDER BY amount_cents DESC LIMIT 50
  `).all(targetKind, targetId);
}

/* ───────── Gang territories + rackets ──────────────────────────────── */

export function stakeGangTerritory(db, opts) {
  const id = uid("gang");
  db.prepare(`
    INSERT INTO gang_territories (id, world_id, faction_id, center_x, center_z, radius_m, control_pct, racket_income_cents)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(opts.worldId || ""),
    String(opts.factionId || ""),
    Number(opts.centerX) || 0,
    Number(opts.centerZ) || 0,
    Math.max(1, Math.min(2000, Number(opts.radiusM) || 100)),
    Math.max(0, Math.min(100, Number(opts.controlPct) || 50)),
    Math.max(0, Math.floor(Number(opts.racketIncomeCents) || 0)),
  );
  return { ok: true, territoryId: id };
}

export function advanceTerritoryControl(db, territoryId, delta) {
  const t = db.prepare("SELECT * FROM gang_territories WHERE id = ?").get(territoryId);
  if (!t) return { ok: false, reason: "territory_not_found" };
  const next = Math.max(0, Math.min(100, t.control_pct + Number(delta)));
  db.prepare("UPDATE gang_territories SET control_pct = ? WHERE id = ?").run(next, territoryId);
  return { ok: true, controlPct: next };
}

export function listTerritoriesInWorld(db, worldId) {
  return db.prepare(`
    SELECT * FROM gang_territories WHERE world_id = ? ORDER BY control_pct DESC LIMIT 100
  `).all(worldId);
}

/* ───────── Heists ──────────────────────────────────────────────────── */

export function planHeist(db, opts) {
  if (!opts?.plannerUserId || !opts?.targetKind || !opts?.targetId) {
    return { ok: false, reason: "missing_inputs" };
  }
  const id = uid("heist");
  const difficulty = Math.max(0, Math.min(1, Number(opts.difficulty) || 0.5));
  const reward = Math.max(0, Math.floor(Number(opts.rewardCents) || (1000 + difficulty * 4000)));
  db.prepare(`
    INSERT INTO heist_plans
      (id, planner_user_id, target_kind, target_id, difficulty, reward_cents, crew_json, planned_for)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.plannerUserId, opts.targetKind, opts.targetId, difficulty, reward,
    JSON.stringify(opts.crew || []),
    opts.plannedFor ? Math.floor(Number(opts.plannedFor)) : null,
  );
  return { ok: true, heistId: id, rewardCents: reward };
}

/**
 * Execute a planned heist. Outcome roll:
 *   successChance = base + (crew average skill / 100) × per-skill factor - difficulty
 *
 * Crew skill is a caller-supplied number (0..100); the engine doesn't
 * dig into individual skill rows here (caller's job to sum). Witness
 * count rolls a separate die; high witnesses spawn bounties via
 * recordCrime + issueBounty.
 */
export function executeHeist(db, opts) {
  const heistId = String(opts?.heistId || "");
  const h = db.prepare("SELECT * FROM heist_plans WHERE id = ?").get(heistId);
  if (!h) return { ok: false, reason: "heist_not_found" };
  if (h.executed_at) return { ok: false, reason: "already_executed" };

  const crewSkill = Math.max(0, Math.min(100, Number(opts?.crewSkill) || 30));
  const roll = Number.isFinite(opts?.rollOverride) ? Number(opts.rollOverride) : Math.random();
  const successChance = Math.max(0.05, Math.min(0.95,
    HEIST_SUCCESS_BASE + (crewSkill / 100) * HEIST_SUCCESS_PER_CREW_SKILL - h.difficulty * 0.4
  ));
  const success = roll < successChance ? 1 : 0;
  const witnessRoll = Number.isFinite(opts?.witnessRollOverride) ? Number(opts.witnessRollOverride) : Math.random();
  const witnesses = witnessRoll < HEIST_WITNESS_BASE_CHANCE + h.difficulty * 0.3
    ? Math.max(1, Math.floor(witnessRoll * 5) + 1) : 0;

  db.prepare(`
    UPDATE heist_plans SET executed_at = unixepoch(), success = ?, witnesses_count = ? WHERE id = ?
  `).run(success, witnesses, heistId);

  // Record a heist crime if witnessed
  let crimeId = null;
  let bountyId = null;
  if (witnesses > 0) {
    const c = recordCrime(db, {
      perpetratorUserId: h.planner_user_id,
      victimKind: h.target_kind,
      victimId: h.target_id,
      crimeKind: "heist",
      severity: 0.6 + h.difficulty * 0.3,
      witnessed: true,
    });
    crimeId = c.crimeId;
    // Auto-bounty when severity * reward is significant
    const bountyAmount = Math.floor(h.reward_cents * 0.10 + witnesses * 50);
    if (bountyAmount > 0) {
      const b = issueBounty(db, {
        targetKind: "player",
        targetId: h.planner_user_id,
        issuedByKind: "realm",
        issuedById: h.target_id,
        amountCents: bountyAmount,
        reason: `heist:${heistId}`,
      });
      bountyId = b.bountyId;
    }
  }

  return {
    ok: true,
    success: !!success,
    rewardCents: success ? h.reward_cents : 0,
    witnesses,
    crimeId,
    bountyId,
    successChance,
  };
}

export function listMyHeists(db, plannerUserId) {
  return db.prepare(`
    SELECT * FROM heist_plans WHERE planner_user_id = ? ORDER BY created_at DESC LIMIT 50
  `).all(plannerUserId);
}

export const CRIME_CONSTANTS = Object.freeze({
  HEIST_SUCCESS_BASE,
  HEIST_SUCCESS_PER_CREW_SKILL,
  HEIST_WITNESS_BASE_CHANCE,
});
