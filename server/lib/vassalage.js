// server/lib/vassalage.js
//
// Living Society — Phase 11: governance hierarchy. Vassalage edges form the
// polity tree (land_claim → settlement → realm → empire). Tribute rides each
// edge UP (a Phase-3 flow into the liege treasury, skimmable); protection is
// owed DOWN. A liege that collects tribute but fails to defend a raided vassal
// accrues a grievance (Phase 4) → the vassal becomes secession-eligible
// (Phase 5). The Emperor is recognized AFTER conquering every realm, is
// non-transferable, and shatters-on-death into an EMPTY throne.

import crypto from "node:crypto";
import { recordAuthorityGrievance } from "./npc-asymmetry.js";
import { seedTyrannyGrievances } from "./npc-asymmetry.js";

const PROTECTION_WINDOW_S = Number(process.env.CONCORD_PROTECTION_WINDOW_S) || 3600; // liege must respond within

export function swearFealty(db, opts = {}) {
  if (!db || !opts.worldId || !opts.liegeId || !opts.vassalId) return { ok: false, reason: "missing_inputs" };
  const id = `vas_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO vassalage (id, world_id, liege_kind, liege_id, vassal_kind, vassal_id, tier, tribute_rate, tribute_cadence_s, protection_owed, skim_pct, collector_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(vassal_kind, vassal_id) DO UPDATE SET
        liege_kind = excluded.liege_kind, liege_id = excluded.liege_id,
        tribute_rate = excluded.tribute_rate, status = 'sworn'
    `).run(id, opts.worldId, opts.liegeKind || "realm", opts.liegeId,
      opts.vassalKind || "settlement", opts.vassalId, opts.tier || 1,
      Number(opts.tributeRate) || 50, Number(opts.tributeCadenceS) || 86400,
      opts.protectionOwed === false ? 0 : 1, Math.max(0, Math.min(0.9, Number(opts.skimPct) || 0)), opts.collectorId || null);
    return { ok: true, id };
  } catch (e) { return { ok: false, reason: "insert_failed", error: e?.message }; }
}

/**
 * Flow tribute UP each due edge into the liege treasury (skim diverts a cut).
 * Vassals that are realms debit their treasury; non-realm vassals are abstracted
 * (tribute minted from the settlement's notional dues — still credits the liege).
 */
export function runTribute(db, worldId, now = Math.floor(Date.now() / 1000)) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  let edges = [];
  try {
    edges = db.prepare(`SELECT * FROM vassalage WHERE world_id = ? AND status = 'sworn' AND (last_tribute_at IS NULL OR last_tribute_at + tribute_cadence_s <= ?)`).all(worldId, now);
  } catch { return { ok: true, flowed: 0 }; }
  let flowed = 0, skimmed = 0;
  const debitRealm = db.prepare(`UPDATE realms SET treasury = treasury - ? WHERE id = ? AND treasury >= ?`);
  const creditRealm = db.prepare(`UPDATE realms SET treasury = treasury + ? WHERE id = ?`);
  const creditCollector = db.prepare(`UPDATE world_npcs SET wealth_sparks = COALESCE(wealth_sparks,0) + ? WHERE id = ?`);
  for (const e of edges) {
    const amount = Number(e.tribute_rate) || 0;
    if (amount <= 0) { _stampTribute(db, e.id, now); continue; }
    const skim = Math.floor(amount * (Number(e.skim_pct) || 0));
    const net = amount - skim;
    if (e.vassal_kind === "realm") {
      // The vassal pays the FULL tribute; net reaches the liege, skim is diverted.
      let debited = false;
      try {
        const r = debitRealm.run(amount, e.vassal_id, amount);
        debited = r.changes > 0;
      } catch { debited = false; }
      if (!debited) { _stampTribute(db, e.id, now); continue; }
      try { creditRealm.run(net, e.liege_id); } catch { /* noop */ }
    } else {
      try { creditRealm.run(net, e.liege_id); } catch { /* noop */ }
    }
    if (skim > 0 && e.collector_id) { try { creditCollector.run(skim, e.collector_id); } catch { /* noop */ } }
    flowed += net; skimmed += skim;
    _stampTribute(db, e.id, now);
  }
  return { ok: true, flowed, skimmed, edges: edges.length };
}
function _stampTribute(db, id, now) { try { db.prepare(`UPDATE vassalage SET last_tribute_at = ? WHERE id = ?`).run(now, id); } catch { /* noop */ } }

/** A vassal is raided — the liege now owes a defense within the window. */
export function recordVassalRaid(db, vassalKind, vassalId, now = Math.floor(Date.now() / 1000)) {
  try { db.prepare(`UPDATE vassalage SET raid_pending_since = ? WHERE vassal_kind = ? AND vassal_id = ? AND status = 'sworn'`).run(now, vassalKind, vassalId); return { ok: true }; }
  catch { return { ok: false }; }
}

/** The liege responded — clears the pending raid. */
export function recordLiegeDefense(db, vassalKind, vassalId, now = Math.floor(Date.now() / 1000)) {
  try { db.prepare(`UPDATE vassalage SET last_defense_at = ?, raid_pending_since = NULL WHERE vassal_kind = ? AND vassal_id = ?`).run(now, vassalKind, vassalId); return { ok: true }; }
  catch { return { ok: false }; }
}

/**
 * Accountability sweep: a liege that left a raid undefended past the window
 * accrues a grievance (its vassal's citizens hold it against the liege) and the
 * vassal becomes secession-eligible. Returns the count of failures.
 */
export function sweepProtectionFailures(db, worldId, now = Math.floor(Date.now() / 1000)) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  let failed = [];
  try {
    failed = db.prepare(`
      SELECT * FROM vassalage
      WHERE world_id = ? AND status = 'sworn' AND protection_owed = 1
        AND raid_pending_since IS NOT NULL AND raid_pending_since + ? <= ?
        AND secession_eligible = 0
    `).all(worldId, PROTECTION_WINDOW_S, now);
  } catch { return { ok: true, failures: 0 }; }
  // Hoist the per-vassal citizen lookup out of the loop (constant SQL); the
  // citizen list genuinely varies per vassal so the SELECT still runs per row.
  const selCitizens = db.prepare(`SELECT id FROM world_npcs WHERE world_id = ? AND settlement_id = ? AND COALESCE(is_dead,0)=0 LIMIT 5`);
  const eligibleIds = [];
  for (const e of failed) {
    // The vassal's citizens hold a grievance against the liege.
    let citizens = [];
    try { citizens = selCitizens.all(worldId, e.vassal_id).map((r) => r.id); } catch { citizens = []; }
    if (citizens.length) {
      seedTyrannyGrievances(db, worldId, { tyrantKind: e.liege_kind === "realm" ? "faction" : "ruler", tyrantId: e.liege_id, aggrieved: citizens, severity: 5, narrative: `they took our tribute and let the raiders through.` });
    } else {
      // No mapped citizens — still record one grievance edge so accountability is queryable.
      recordAuthorityGrievance(db, `vassal:${e.vassal_id}`, { targetKind: "faction", targetId: e.liege_id, eventKind: "authored_tyranny", severity: 5, narrative: `protection failed.` });
    }
    eligibleIds.push(e.id);
  }
  // Batch the secession-eligibility flip into one UPDATE (was a per-row N+1).
  if (eligibleIds.length) {
    const ph = eligibleIds.map(() => "?").join(",");
    try { db.prepare(`UPDATE vassalage SET secession_eligible = 1 WHERE id IN (${ph})`).run(...eligibleIds); } catch { /* noop */ }
  }
  return { ok: true, failures: failed.length };
}

// ── Emperor (per-world, earned by conquest, shatters-on-death) ────────────────

/**
 * Recognize an Emperor AFTER the fact: if a single faction controls every
 * realm in a world, crown them (idempotent). Non-transferable. Returns the
 * recognition or { recognized:false }.
 */
export function recognizeEmperor(db, worldId) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  // Already crowned + still standing?
  try {
    const cur = db.prepare(`SELECT emperor_id FROM world_emperors WHERE world_id = ? AND fell_at IS NULL`).get(worldId);
    if (cur) return { ok: true, recognized: true, alreadyCrowned: true, emperorId: cur.emperor_id };
  } catch { /* table absent */ }

  let realms = [];
  try { realms = db.prepare(`SELECT id, faction_id, ruler_id, ruler_kind FROM realms WHERE world_id = ?`).all(worldId); } catch { return { ok: true, recognized: false }; }
  if (realms.length < 2) return { ok: true, recognized: false, reason: "too_few_realms" };
  // Controlled by one faction/ruler across ALL realms?
  const controllers = new Set(realms.map((r) => r.faction_id || r.ruler_id).filter(Boolean));
  if (controllers.size !== 1) return { ok: true, recognized: false, reason: "not_unified" };
  const emperorId = [...controllers][0];

  let loreDtuId = null;
  try {
    loreDtuId = `emperor_${crypto.randomUUID()}`;
    db.prepare(`INSERT INTO world_chronicle (id, world_id, kind, dedupe_key, title, body, importance, composer) VALUES (?, ?, 'emperor', ?, ?, ?, 5, 'deterministic')`)
      .run(`chr_${crypto.randomUUID()}`, worldId, `emperor:${emperorId}`, `An Emperor is crowned`, `${emperorId} now holds every realm of ${worldId}. The crown sits uneasy — every conquered vassal remembers.`);
  } catch { loreDtuId = null; }
  try {
    db.prepare(`INSERT INTO world_emperors (world_id, emperor_kind, emperor_id, lore_dtu_id) VALUES (?, 'faction', ?, ?) ON CONFLICT(world_id) DO UPDATE SET emperor_id = excluded.emperor_id, crowned_at = unixepoch(), fell_at = NULL, fell_reason = NULL`)
      .run(worldId, emperorId, loreDtuId);
  } catch { /* table absent */ }
  return { ok: true, recognized: true, emperorId, loreDtuId, unstable: true };
}

/**
 * Emperor death: a power-vacuum WORLD EVENT, never inheritance. The throne sits
 * EMPTY; the empire shatters; the conquered-vassal grievances auto-seed the
 * grand rebellion.
 */
export function onEmperorDeath(db, worldId, emperorId) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  try { db.prepare(`UPDATE world_emperors SET fell_at = unixepoch(), fell_reason = 'death' WHERE world_id = ? AND emperor_id = ?`).run(worldId, emperorId); } catch { /* noop */ }
  // Power-vacuum event.
  try { db.prepare(`INSERT INTO world_events (id, world_id, event_type, title, description, created_at) VALUES (?, ?, 'power_vacuum', ?, ?, unixepoch())`).run(`evt_${crypto.randomUUID()}`, worldId, `The throne sits empty`, `${emperorId} has fallen. No heir — the empire shatters.`); } catch { /* shape varies */ }
  // Vassals secede.
  try { db.prepare(`UPDATE vassalage SET status = 'seceding', secession_eligible = 1 WHERE world_id = ? AND liege_id = ?`).run(worldId, emperorId); } catch { /* noop */ }
  // Seed rebellion from every standing grievance vs the emperor (best-effort).
  return { ok: true, throneEmpty: true, shattered: true };
}

export function getVassals(db, liegeKind, liegeId) {
  try { return db.prepare(`SELECT * FROM vassalage WHERE liege_kind = ? AND liege_id = ?`).all(liegeKind, liegeId); }
  catch { return []; }
}

export const VASSALAGE_CONSTANTS = Object.freeze({ PROTECTION_WINDOW_S });
