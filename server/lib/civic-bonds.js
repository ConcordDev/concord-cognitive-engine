// server/lib/civic-bonds.js
//
// Civic Capital — the persistent, sparks-denominated micro-bond engine.
//
// The legacy server/emergent/microbond-governance.js is in-memory + already
// routed; this is its durable sibling (migration 305 tables), behind
// CONCORD_CIVIC_BONDS. It adds the two things the legacy engine lacks:
//   1. the 110% PRE-FUNDING GATE (the policy's load-bearing safeguard), checked
//      through the shared viability/feasibility spine (pay-once), and
//   2. real sparks escrow/payout via lib/sparks-service.js with idempotent refIds.
//
// All money is SPARKS. Lifecycle:
//   create → openForVoting → vote/quorum → pledge(escrow) → fund(>=110% gate)
//          → completeMilestone* → complete(pay capped returns + spillover) | fail(refund)
//
// Constants mirror the legacy engine (single conceptual source); the return cap
// is the constitutional dial (governance.js civic.return_rate_max).

import crypto from "crypto";
import { debitSparks, creditSparks } from "./sparks-service.js";
import { makeConstraintSet, isFeasible } from "./viability/index.js";

export const MAX_SINGLE_ENTITY_RATIO = 0.05;     // 5% cap per entity per bond
export const DEFAULT_SPILLOVER_RATE = 0.05;
export const DEFAULT_APPROVAL_THRESHOLD = 0.6;
export const DEFAULT_QUORUM = 1000;
export const DEFAULT_FUNDING_GATE = 1.10;        // 110% pre-funding gate
export const RETURN_RATE_MAX = 0.005;            // capped return (restricted pool only)
export const ADMIN_RESERVE_RATE = 0.15;          // admin reserve ceiling fraction

export function civicBondsEnabled() {
  return process.env.CONCORD_CIVIC_BONDS === "1";
}

const uid = (p) => `${p}_${crypto.randomUUID().slice(0, 12)}`;
const now = () => Math.floor(Date.now() / 1000);

// ── Create ──────────────────────────────────────────────────────────────────

export function createBond(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const worldId = String(opts.worldId || "").trim();
  const title = String(opts.title || "").trim();
  const target = Math.max(1, Math.trunc(Number(opts.targetAmount) || 0));
  if (!worldId || !title || target < 1) return { ok: false, reason: "missing_inputs" };

  const id = uid("cbond");
  const returnRate = Math.min(RETURN_RATE_MAX, Math.max(0, Number(opts.returnRate ?? RETURN_RATE_MAX)));
  const denomination = Math.max(1, Math.trunc(Number(opts.denomination) || 100));
  const labor = opts.laborSource === "in_house" ? "in_house" : "contract";
  db.prepare(`
    INSERT INTO civic_bonds (id, world_id, realm_id, faction_id, org_id, proposer_id, title, description,
      category, scope, labor_source, target_amount, denomination, return_rate, spillover_rate,
      funding_gate_pct, quorum, approval_threshold)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, worldId, opts.realmId ?? null, opts.factionId ?? null, opts.orgId ?? null, opts.proposerId ?? null,
    title.slice(0, 500), String(opts.description || "").slice(0, 5000), String(opts.category || "general"),
    opts.scope || "city", labor, target, denomination, returnRate, DEFAULT_SPILLOVER_RATE,
    DEFAULT_FUNDING_GATE, Math.max(1, Math.trunc(Number(opts.quorum) || DEFAULT_QUORUM)),
    Math.min(1, Math.max(0, Number(opts.approvalThreshold ?? DEFAULT_APPROVAL_THRESHOLD))),
  );

  const milestones = Array.isArray(opts.milestones) ? opts.milestones : [];
  milestones.forEach((m, i) => {
    db.prepare(`INSERT INTO civic_bond_milestones (id, bond_id, idx, description, release_pct) VALUES (?,?,?,?,?)`)
      .run(uid("cms"), id, i, String(m?.description || ""), Math.min(1, Math.max(0, Number(m?.releasePct) || 0)));
  });
  return { ok: true, bondId: id, bond: getBond(db, id).bond };
}

// ── Read ────────────────────────────────────────────────────────────────────

export function getBond(db, id) {
  const bond = db.prepare(`SELECT * FROM civic_bonds WHERE id = ?`).get(String(id));
  if (!bond) return { ok: false, reason: "bond_not_found" };
  const pledges = db.prepare(`SELECT * FROM civic_bond_pledges WHERE bond_id = ?`).all(id);
  const milestones = db.prepare(`SELECT * FROM civic_bond_milestones WHERE bond_id = ? ORDER BY idx`).all(id);
  return { ok: true, bond, pledges, milestones };
}

export function listBonds(db, { worldId, realmId, status } = {}) {
  const where = [];
  const args = [];
  if (worldId) { where.push("world_id = ?"); args.push(String(worldId)); }
  if (realmId) { where.push("realm_id = ?"); args.push(String(realmId)); }
  if (status) { where.push("status = ?"); args.push(String(status)); }
  const sql = `SELECT * FROM civic_bonds ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 200`;
  return db.prepare(sql).all(...args);
}

// ── Voting ──────────────────────────────────────────────────────────────────

export function openBondForVoting(db, id, actorId) {
  const r = db.prepare(`UPDATE civic_bonds SET status='voting', voting_status='open' WHERE id=? AND status='proposed'`).run(String(id));
  if (r.changes === 0) return { ok: false, reason: "not_proposed" };
  return { ok: true };
}

export function voteBond(db, id, voterId, vote) {
  const v = ["for", "against", "abstain"].includes(vote) ? vote : null;
  if (!v) return { ok: false, reason: "bad_vote" };
  const bond = db.prepare(`SELECT status FROM civic_bonds WHERE id=?`).get(String(id));
  if (!bond) return { ok: false, reason: "bond_not_found" };
  if (bond.status !== "voting") return { ok: false, reason: "not_voting" };
  // idempotent: PK collision = already voted (no change of vote in v1).
  const ins = db.prepare(`INSERT OR IGNORE INTO civic_bond_votes (bond_id, voter_id, vote) VALUES (?,?,?)`).run(String(id), String(voterId), v);
  if (ins.changes === 0) return { ok: true, idempotent: true };
  _recountVotes(db, id);
  return { ok: true };
}

function _recountVotes(db, id) {
  const row = db.prepare(`
    SELECT SUM(vote='for') AS f, SUM(vote='against') AS a FROM civic_bond_votes WHERE bond_id=?
  `).get(String(id));
  db.prepare(`UPDATE civic_bonds SET votes_for=?, votes_against=? WHERE id=?`).run(Number(row?.f || 0), Number(row?.a || 0), String(id));
}

export function checkQuorum(db, id) {
  const b = db.prepare(`SELECT votes_for, votes_against, quorum, approval_threshold FROM civic_bonds WHERE id=?`).get(String(id));
  if (!b) return { ok: false, reason: "bond_not_found" };
  const total = b.votes_for + b.votes_against;
  const quorumMet = total >= b.quorum;
  const approvalRatio = total > 0 ? b.votes_for / total : 0;
  const approved = quorumMet && approvalRatio >= b.approval_threshold;
  return { ok: true, quorumMet, approved, total, approvalRatio: Math.round(approvalRatio * 1000) / 1000 };
}

// ── Pledging (5% cap + sparks escrow) ────────────────────────────────────────

export function pledgeToBond(db, id, { entityKind = "player", entityId, amount }) {
  const bond = db.prepare(`SELECT * FROM civic_bonds WHERE id=?`).get(String(id));
  if (!bond) return { ok: false, reason: "bond_not_found" };
  if (!["voting", "funding"].includes(bond.status)) return { ok: false, reason: "not_open_for_pledges" };
  const amt = Math.trunc(Number(amount));
  if (!Number.isFinite(amt) || amt <= 0) return { ok: false, reason: "bad_amount" };
  if (amt < bond.denomination || amt % bond.denomination !== 0) return { ok: false, reason: "bad_denomination", denomination: bond.denomination };

  const prior = db.prepare(`SELECT amount FROM civic_bond_pledges WHERE bond_id=? AND entity_kind=? AND entity_id=?`)
    .get(String(id), entityKind, String(entityId));
  const newTotal = (prior?.amount || 0) + amt;
  const cap = Math.floor(bond.target_amount * MAX_SINGLE_ENTITY_RATIO);
  if (newTotal > cap) return { ok: false, reason: "exceeds_single_entity_cap", cap, requested: newTotal };

  const tx = db.transaction(() => {
    // Escrow the sparks (debit the pledger). Idempotency keyed per pledge increment.
    const refId = `civic_pledge:${id}:${entityKind}:${entityId}:${newTotal}`;
    const deb = debitSparks(db, { holderKind: entityKind, holderId: entityId, amount: amt, refId, reason: `civic_pledge:${id}` });
    if (!deb.ok) throw new Error(deb.reason || "escrow_failed");
    db.prepare(`
      INSERT INTO civic_bond_pledges (id, bond_id, entity_kind, entity_id, amount, status)
      VALUES (?,?,?,?,?, 'escrowed')
      ON CONFLICT(bond_id, entity_kind, entity_id) DO UPDATE SET amount = amount + ?, status='escrowed'
    `).run(uid("cpl"), String(id), entityKind, String(entityId), amt, amt);
    db.prepare(`UPDATE civic_bonds SET current_pledged = current_pledged + ?, status='funding' WHERE id=?`).run(amt, String(id));
    return { ok: true, total: newTotal };
  });
  try { return tx(); } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

export function unpledge(db, id, { entityKind = "player", entityId }) {
  const bond = db.prepare(`SELECT status FROM civic_bonds WHERE id=?`).get(String(id));
  if (!bond) return { ok: false, reason: "bond_not_found" };
  if (!["voting", "funding"].includes(bond.status)) return { ok: false, reason: "not_refundable" };
  const p = db.prepare(`SELECT * FROM civic_bond_pledges WHERE bond_id=? AND entity_kind=? AND entity_id=? AND status='escrowed'`)
    .get(String(id), entityKind, String(entityId));
  if (!p) return { ok: false, reason: "no_pledge" };
  const tx = db.transaction(() => {
    creditSparks(db, { holderKind: entityKind, holderId: entityId, amount: p.amount, refId: `civic_unpledge:${id}:${entityKind}:${entityId}`, reason: `civic_unpledge:${id}` });
    db.prepare(`UPDATE civic_bond_pledges SET status='refunded', amount=0 WHERE id=?`).run(p.id);
    db.prepare(`UPDATE civic_bonds SET current_pledged = MAX(0, current_pledged - ?) WHERE id=?`).run(p.amount, String(id));
    return { ok: true, refunded: p.amount };
  });
  try { return tx(); } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

// ── Funding — the 110% gate (via the viability spine) ────────────────────────

export function fundBond(db, id, actorId) {
  const bond = db.prepare(`SELECT * FROM civic_bonds WHERE id=?`).get(String(id));
  if (!bond) return { ok: false, reason: "bond_not_found" };
  if (!["voting", "funding"].includes(bond.status)) return { ok: false, reason: "not_fundable" };

  const q = checkQuorum(db, id);
  if (!q.approved) return { ok: false, reason: "quorum_or_approval_not_met", details: q };

  // THE 110% pre-funding gate — expressed as a feasibility constraint so it uses
  // the same isFeasible() the downstream engines do. pledged must clear target×gate.
  const floor = bond.target_amount * bond.funding_gate_pct;
  const gateSet = makeConstraintSet([{ axis: "pledged", lo: floor, hi: null, scale: bond.target_amount }]);
  const feas = isFeasible({ pledged: bond.current_pledged }, gateSet);
  if (!feas.feasible) return { ok: false, reason: "funding_gate_not_met", need: Math.ceil(floor), have: bond.current_pledged };

  const tx = db.transaction(() => {
    // Funding order step 1 — escrow each pledge's capped return reserve.
    const pledges = db.prepare(`SELECT * FROM civic_bond_pledges WHERE bond_id=? AND status='escrowed'`).all(String(id));
    for (const p of pledges) {
      const reserve = Math.floor(p.amount * bond.return_rate);
      db.prepare(`UPDATE civic_bond_pledges SET return_reserved=? WHERE id=?`).run(reserve, p.id);
    }
    db.prepare(`UPDATE civic_bonds SET status='active', voting_status='funded', funded_at=? WHERE id=?`).run(now(), String(id));
    return { ok: true };
  });
  try { tx(); } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
  // NOTE: opening the pre-funded construction decree + crediting realm treasury
  // is the connective-chain slice (Wave 0 item 5); fundBond leaves the bond 'active'.
  return { ok: true, status: "active" };
}

export function completeMilestone(db, id, idx) {
  const r = db.prepare(`UPDATE civic_bond_milestones SET status='complete', completed_at=? WHERE bond_id=? AND idx=? AND status='pending'`)
    .run(now(), String(id), Math.trunc(Number(idx)));
  return r.changes ? { ok: true } : { ok: false, reason: "milestone_not_pending" };
}

// ── Closeout ─────────────────────────────────────────────────────────────────

export function completeBond(db, id) {
  const bond = db.prepare(`SELECT * FROM civic_bonds WHERE id=?`).get(String(id));
  if (!bond) return { ok: false, reason: "bond_not_found" };
  if (bond.status !== "active") return { ok: false, reason: "not_active" };

  const tx = db.transaction(() => {
    const pledges = db.prepare(`SELECT * FROM civic_bond_pledges WHERE bond_id=? AND status='escrowed'`).all(String(id));
    let returnsTotal = 0;
    for (const p of pledges) {
      if (p.return_reserved > 0) {
        creditSparks(db, { holderKind: p.entity_kind, holderId: p.entity_id, amount: p.return_reserved,
          refId: `civic_return:${id}:${p.entity_kind}:${p.entity_id}`, reason: `civic_return:${id}` });
        returnsTotal += p.return_reserved;
      }
      db.prepare(`UPDATE civic_bond_pledges SET status='delivered' WHERE id=?`).run(p.id);
    }
    // Capital (target) is consumed by the build; the leftover above target+returns
    // is restricted spillover that seeds the next project.
    const residue = Math.max(0, bond.current_pledged - bond.target_amount - returnsTotal);
    if (residue > 0) {
      db.prepare(`
        INSERT INTO civic_spillover_funds (scope, world_id, amount) VALUES (?,?,?)
        ON CONFLICT(scope, world_id) DO UPDATE SET amount = amount + ?, updated_at = unixepoch()
      `).run(bond.scope, bond.world_id, residue, residue);
    }
    db.prepare(`UPDATE civic_bonds SET status='completed', completed_at=? WHERE id=?`).run(now(), String(id));
    return { ok: true, returnsPaid: returnsTotal, spillover: residue };
  });
  try { return tx(); } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

export function failBond(db, id, reason = "failed") {
  const bond = db.prepare(`SELECT * FROM civic_bonds WHERE id=?`).get(String(id));
  if (!bond) return { ok: false, reason: "bond_not_found" };
  if (["completed", "failed", "cancelled"].includes(bond.status)) return { ok: false, reason: "terminal" };

  const tx = db.transaction(() => {
    const pledges = db.prepare(`SELECT * FROM civic_bond_pledges WHERE bond_id=? AND status='escrowed'`).all(String(id));
    let refunded = 0;
    for (const p of pledges) {
      if (p.amount > 0) {
        creditSparks(db, { holderKind: p.entity_kind, holderId: p.entity_id, amount: p.amount,
          refId: `civic_refund:${id}:${p.entity_kind}:${p.entity_id}`, reason: `civic_refund:${id}` });
        refunded += p.amount;
      }
      db.prepare(`UPDATE civic_bond_pledges SET status='refunded' WHERE id=?`).run(p.id);
    }
    db.prepare(`UPDATE civic_bonds SET status='failed' WHERE id=?`).run(String(id));
    return { ok: true, refunded };
  });
  try { return tx(); } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

export function getSpillover(db, scope, worldId) {
  const r = db.prepare(`SELECT amount FROM civic_spillover_funds WHERE scope=? AND world_id=?`).get(String(scope), String(worldId));
  return Number(r?.amount || 0);
}
