// server/lib/sparks-flow.js
//
// Living Society — Phase 3: the sparks-flow engine. Pay moves along employment
// edges on a payday tick. A collector can divert a fraction (skim = petty
// corruption). When an employer can't pay (empty treasury / grand embezzlement),
// the unpaid flow becomes a GRIEVANCE the worker holds against the employer —
// the measurable fuel the movement engine (Phase 5) recruits on.
//
// "corruption = flow-diversion, grievance = unpaid flow" — both fall out of
// this one function. No new minting: every spark moves along an existing edge.

import crypto from "node:crypto";
import { awardSparks } from "./currency.js";
import { recordAuthorityGrievance } from "./npc-asymmetry.js";

const DEFAULT_RATE = 10;

// ── Balance helpers (employer debit / worker credit) ─────────────────────────

function realmTreasury(db, realmId) {
  try { return db.prepare(`SELECT treasury FROM realms WHERE id = ?`).get(realmId)?.treasury ?? null; }
  catch { return null; }
}
function debitRealm(db, realmId, amount) {
  try {
    const r = db.prepare(`UPDATE realms SET treasury = treasury - ?, updated_at = unixepoch() WHERE id = ? AND treasury >= ?`).run(amount, realmId, amount);
    return r.changes > 0;
  } catch { return false; }
}
function npcWealth(db, npcId) {
  try { return db.prepare(`SELECT wealth_sparks FROM world_npcs WHERE id = ?`).get(npcId)?.wealth_sparks ?? 0; }
  catch { return 0; }
}
function creditNpc(db, npcId, amount) {
  try { db.prepare(`UPDATE world_npcs SET wealth_sparks = COALESCE(wealth_sparks,0) + ? WHERE id = ?`).run(amount, npcId); return true; }
  catch { return false; }
}
function debitNpc(db, npcId, amount) {
  try {
    const r = db.prepare(`UPDATE world_npcs SET wealth_sparks = wealth_sparks - ? WHERE id = ? AND COALESCE(wealth_sparks,0) >= ?`).run(amount, npcId, amount);
    return r.changes > 0;
  } catch { return false; }
}

function payWorker(db, edge, net, worldId) {
  if (edge.worker_kind === "player") {
    try { awardSparks(db, edge.worker_id, net, `wage:${edge.id}`, worldId); return true; }
    catch { return false; }
  }
  return creditNpc(db, edge.worker_id, net);
}

function payCollector(db, edge, skim) {
  if (skim <= 0 || !edge.collector_id) return;
  if (edge.collector_kind === "player") {
    try { awardSparks(db, edge.collector_id, skim, `skim:${edge.id}`, edge.world_id); } catch { /* noop */ }
  } else if (edge.collector_kind === "npc") {
    creditNpc(db, edge.collector_id, skim);
  } else if (edge.collector_kind === "realm") {
    try { db.prepare(`UPDATE realms SET treasury = treasury + ? WHERE id = ?`).run(skim, edge.collector_id); } catch { /* noop */ }
  }
}

/** Try to debit the employer for `amount`. Returns true if paid. */
function debitEmployer(db, edge, amount) {
  switch (edge.employer_kind) {
    case "world":   return true;                 // world funds (system) — infinite
    case "realm":   return debitRealm(db, edge.employer_id, amount);
    case "faction": return true;                 // faction funds via member dues (abstracted)
    case "npc":     return debitNpc(db, edge.employer_id, amount);
    default:        return false;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function createEmploymentEdge(db, opts = {}) {
  if (!db || !opts.worldId || !opts.employerId || !opts.workerId) return { ok: false, reason: "missing_inputs" };
  const id = opts.id || `emp_${crypto.randomUUID()}`;
  try {
    db.prepare(`
      INSERT INTO employment_edges
        (id, world_id, employer_kind, employer_id, worker_kind, worker_id, role,
         pay_form, rate_sparks, payday_freq_s, skim_pct, collector_kind, collector_id, last_paid_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, opts.worldId, opts.employerKind || "realm", opts.employerId,
      opts.workerKind || "npc", opts.workerId, opts.role || null,
      opts.payForm || "day_wage", Number(opts.rateSparks) || DEFAULT_RATE,
      Number(opts.paydayFreqS) || 86400, Math.max(0, Math.min(0.9, Number(opts.skimPct) || 0)),
      opts.collectorKind || null, opts.collectorId || null, opts.lastPaidAt ?? null,
    );
    return { ok: true, id };
  } catch (e) { return { ok: false, reason: "insert_failed", error: e?.message }; }
}

/**
 * Run payday for a world. For every due edge: divert skim → collector, pay the
 * net to the worker. If the employer can't pay, deepen a grievance the worker
 * holds against the employer and bump the unpaid streak (a repeated stiffing
 * escalates the grievance — beat 1 of the broke-villain chain).
 *
 * @returns { ok, paid, skimmed, unpaid, total }
 */
export function runPayday(db, worldId, now = Math.floor(Date.now() / 1000)) {
  if (!db || !worldId) return { ok: false, reason: "missing_inputs" };
  let edges = [];
  try {
    edges = db.prepare(`
      SELECT * FROM employment_edges
      WHERE world_id = ? AND active = 1
        AND (last_paid_at IS NULL OR last_paid_at + payday_freq_s <= ?)
    `).all(worldId, now);
  } catch { return { ok: true, paid: 0, skimmed: 0, unpaid: 0, total: 0 }; } // table absent

  let paid = 0, skimmed = 0, unpaid = 0;
  for (const edge of edges) {
    const amount = Number(edge.rate_sparks) || 0;
    if (amount <= 0) { _stamp(db, edge.id, now); continue; }
    const ok = debitEmployer(db, edge, amount);
    if (!ok) {
      // Unpaid flow → grievance against the employer. Worker must be an NPC to
      // hold a grudge (players express grievance through gameplay, not the
      // grudge table); a stiffed player just doesn't get paid.
      unpaid++;
      _bumpUnpaid(db, edge.id);
      if (edge.worker_kind === "npc") {
        const streak = (Number(edge.unpaid_streak) || 0) + 1;
        recordAuthorityGrievance(db, edge.worker_id, {
          targetKind: edge.employer_kind === "realm" || edge.employer_kind === "faction" ? "faction" : "npc",
          targetId: edge.employer_id,
          eventKind: streak >= 2 ? "repeated_unpaid_wages" : "unpaid_wages",
          narrative: `payday came and went — ${edge.employer_id} did not pay.`,
        });
      }
      continue;
    }
    const skim = Math.floor(amount * (Number(edge.skim_pct) || 0));
    const net = amount - skim;
    payCollector(db, edge, skim);
    payWorker(db, edge, net, worldId);
    paid++; skimmed += skim;
    _stamp(db, edge.id, now);
  }
  return { ok: true, paid, skimmed, unpaid, total: edges.length };
}

function _stamp(db, edgeId, now) {
  try { db.prepare(`UPDATE employment_edges SET last_paid_at = ?, unpaid_streak = 0 WHERE id = ?`).run(now, edgeId); } catch { /* noop */ }
}
function _bumpUnpaid(db, edgeId) {
  try { db.prepare(`UPDATE employment_edges SET unpaid_streak = unpaid_streak + 1 WHERE id = ?`).run(edgeId); } catch { /* noop */ }
}

export { realmTreasury, npcWealth };
