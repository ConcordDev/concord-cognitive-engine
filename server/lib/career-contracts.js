// server/lib/career-contracts.js
//
// WAVE JOBS — contract negotiation, persisted + wallet-wired. The dormant
// world-jobs/trades contract concept becomes a real offer→counter→accept state
// machine over career_contracts (mig 312). On signing, the employer pays the
// worker a signing bonus in SPARKS via sparks-service (idempotent refId) — the
// "no wallet wire" fix. Reputation gates the tier you can be hired at and scales
// the wage (FM/EVE model). Players↔NPCs both directions. Behind
// CONCORD_LIVING_CAREER at the callers; pure DB + sparks, never throws on a
// missing table.

import crypto from "node:crypto";
import { transferSparks } from "./sparks-service.js";
import { tierInfo, isTrack } from "./professions.js";

const VALID_CLAUSES = new Set(["release", "match_highest", "hazard_pay"]);
const party = (kind, id) => `${kind}:${id}`;

/** Reputation (0..100) → the highest profession tier you can be CONTRACTED at. */
export function reputationGateTier(reputation) {
  const r = Math.max(0, Math.min(100, Number(reputation) || 0));
  if (r < 20) return 3;
  if (r < 50) return 6;
  if (r < 80) return 8;
  return 10;
}

/** Reputation scales the wage 0.8×–1.2× (a known name commands more). */
export function reputationWageMultiplier(reputation) {
  const r = Math.max(0, Math.min(100, Number(reputation) || 0));
  return 0.8 + (r / 100) * 0.4;
}

/**
 * Derive a worker's reputation (0..100) from REAL DB history this careers
 * system itself already writes — never fabricated, never trusted from an
 * arbitrary caller-supplied number. Two grounded signals:
 *   - signed contracts (`career_contracts` rows where this holder is the
 *     WORKER and the contract reached 'active'/'completed') — a real
 *     counterparty committed to them. Weighted heaviest (20 pts each).
 *   - worked shifts (`sparks_txn_refs`, the idempotency ledger
 *     `lib/sparks-service.js` writes for every `creditSparks` call — the
 *     `careers.work` macro credits with refId `career:<workerId>:<trackId>:
 *     <ts>` and reason 'career_play_shift') — self-directed practice.
 *     Weighted lighter (4 pts each).
 * `trackId`, if given, scopes both signals to that one track; omitted, it's
 * the worker's reputation across every track. Saturates at 100 (5 signed
 * contracts, or 25 shifts, or a mix, maxes it out) so an established worker
 * tops the scale without grinding hundreds of shifts. Never throws — a
 * minimal build without these tables returns 0 (an honest "no track record
 * yet"), which gates a fresh worker to reputationGateTier(0) = tier 3.
 */
export function deriveWorkerReputation(db, workerKind, workerId, trackId = null) {
  if (!db || !workerId) return 0;

  let contractCount = 0;
  try {
    const sql = trackId
      ? `SELECT COUNT(*) AS n FROM career_contracts WHERE worker_kind = ? AND worker_id = ? AND track_id = ? AND status IN ('active','completed')`
      : `SELECT COUNT(*) AS n FROM career_contracts WHERE worker_kind = ? AND worker_id = ? AND status IN ('active','completed')`;
    const params = trackId ? [workerKind, workerId, trackId] : [workerKind, workerId];
    contractCount = db.prepare(sql).get(...params)?.n || 0;
  } catch { /* career_contracts absent in a minimal build */ }

  let shiftCount = 0;
  try {
    const pattern = trackId ? `career:${workerId}:${trackId}:%` : `career:${workerId}:%`;
    shiftCount = db.prepare(`
      SELECT COUNT(*) AS n FROM sparks_txn_refs
      WHERE holder_kind = ? AND holder_id = ? AND reason = 'career_play_shift' AND ref_id LIKE ?
    `).get(workerKind, workerId, pattern)?.n || 0;
  } catch { /* sparks_txn_refs not created yet — no shift has ever been worked */ }

  return Math.max(0, Math.min(100, contractCount * 20 + shiftCount * 4));
}

function sanitizeClauses(clauses) {
  return [...new Set((clauses || []).filter((c) => VALID_CLAUSES.has(c)))];
}

/**
 * Make a contract OFFER. Either party may originate it; the OTHER party accepts
 * or counters. Tier is gated by the worker's reputation.
 * @returns {{ ok:boolean, contractId?:string, reason?:string }}
 */
export function offerContract(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const {
    worldId = null, employerKind, employerId, workerKind, workerId,
    trackId, tier = 1, role = null, baseWage = 0, payModel = "per_shift",
    durationDays = 30, signingBonus = 0, bonuses = [], clauses = [],
    offeredByKind, offeredById, workerReputation = null,
  } = opts;
  if (!employerKind || !employerId || !workerKind || !workerId) return { ok: false, reason: "missing_parties" };
  if (!isTrack(trackId)) return { ok: false, reason: "unknown_track" };
  if (workerReputation != null && tier > reputationGateTier(workerReputation)) return { ok: false, reason: "reputation_too_low" };

  const id = `ctr_${crypto.randomUUID().slice(0, 16)}`;
  const lastOfferBy = party(offeredByKind || employerKind, offeredById || employerId);
  try {
    db.prepare(`
      INSERT INTO career_contracts
        (id, world_id, employer_kind, employer_id, worker_kind, worker_id, track_id, tier, role,
         base_wage_sparks, pay_model, duration_days, signing_bonus_sparks, bonuses_json, clauses_json, status, last_offer_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'offered', ?)
    `).run(id, worldId, employerKind, employerId, workerKind, workerId, trackId, Math.max(1, tier | 0), role,
      Math.max(0, baseWage | 0), payModel, Math.max(1, durationDays | 0), Math.max(0, signingBonus | 0),
      JSON.stringify(bonuses || []), JSON.stringify(sanitizeClauses(clauses)), lastOfferBy);
    logEvent(db, id, "offer", offeredByKind || employerKind, offeredById || employerId, { baseWage, tier, signingBonus });
    return { ok: true, contractId: id };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

/** COUNTER an open offer (changes terms, flips the standing offer to the counterer). */
export function counterContract(db, contractId, byKind, byId, terms = {}) {
  const c = get(db, contractId);
  if (!c) return { ok: false, reason: "not_found" };
  if (!["offered", "countered"].includes(c.status)) return { ok: false, reason: "not_negotiable" };
  if (party(byKind, byId) === c.last_offer_by) return { ok: false, reason: "already_your_offer" };
  const next = {
    base_wage_sparks: terms.baseWage != null ? Math.max(0, terms.baseWage | 0) : c.base_wage_sparks,
    signing_bonus_sparks: terms.signingBonus != null ? Math.max(0, terms.signingBonus | 0) : c.signing_bonus_sparks,
    duration_days: terms.durationDays != null ? Math.max(1, terms.durationDays | 0) : c.duration_days,
    clauses_json: terms.clauses != null ? JSON.stringify(sanitizeClauses(terms.clauses)) : c.clauses_json,
  };
  try {
    db.prepare(`UPDATE career_contracts SET base_wage_sparks=?, signing_bonus_sparks=?, duration_days=?, clauses_json=?, status='countered', last_offer_by=?, updated_at=unixepoch() WHERE id=?`)
      .run(next.base_wage_sparks, next.signing_bonus_sparks, next.duration_days, next.clauses_json, party(byKind, byId), contractId);
    logEvent(db, contractId, "counter", byKind, byId, terms);
    return { ok: true, contractId };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

/**
 * ACCEPT the standing offer — only the party who did NOT make it may accept.
 * Activates the contract and pays the signing bonus employer→worker in sparks
 * (idempotent on the contract id). The wallet wire.
 */
export function acceptContract(db, contractId, byKind, byId) {
  const c = get(db, contractId);
  if (!c) return { ok: false, reason: "not_found" };
  if (!["offered", "countered"].includes(c.status)) return { ok: false, reason: "not_negotiable" };
  if (party(byKind, byId) === c.last_offer_by) return { ok: false, reason: "cannot_accept_own_offer" };
  // accepter must be a party to the contract
  const isParty = party(byKind, byId) === party(c.employer_kind, c.employer_id) || party(byKind, byId) === party(c.worker_kind, c.worker_id);
  if (!isParty) return { ok: false, reason: "not_a_party" };

  let bonusPaid = 0;
  if (c.signing_bonus_sparks > 0) {
    const t = transferSparks(db, {
      fromKind: c.employer_kind, fromId: c.employer_id,
      toKind: c.worker_kind, toId: c.worker_id,
      amount: c.signing_bonus_sparks, refId: `contract:${contractId}:signing`,
      reason: "contract_signing_bonus", worldId: c.world_id,
    });
    if (!t || t.ok === false) return { ok: false, reason: t?.reason || "signing_bonus_failed" };
    bonusPaid = c.signing_bonus_sparks;
  }
  db.prepare(`UPDATE career_contracts SET status='active', updated_at=unixepoch() WHERE id=?`).run(contractId);
  logEvent(db, contractId, "accept", byKind, byId, { bonusPaid });
  return { ok: true, contractId, bonusPaid, status: "active" };
}

export function rejectContract(db, contractId, byKind, byId) {
  const c = get(db, contractId);
  if (!c) return { ok: false, reason: "not_found" };
  if (!["offered", "countered"].includes(c.status)) return { ok: false, reason: "not_negotiable" };
  db.prepare(`UPDATE career_contracts SET status='rejected', updated_at=unixepoch() WHERE id=?`).run(contractId);
  logEvent(db, contractId, "reject", byKind, byId, {});
  return { ok: true, contractId, status: "rejected" };
}

export function get(db, contractId) {
  try { return db.prepare(`SELECT * FROM career_contracts WHERE id=?`).get(contractId) || null; } catch { return null; }
}
export function listContractsFor(db, kind, id, status = null) {
  try {
    const rows = status
      ? db.prepare(`SELECT * FROM career_contracts WHERE ((worker_kind=? AND worker_id=?) OR (employer_kind=? AND employer_id=?)) AND status=? ORDER BY updated_at DESC`).all(kind, id, kind, id, status)
      : db.prepare(`SELECT * FROM career_contracts WHERE (worker_kind=? AND worker_id=?) OR (employer_kind=? AND employer_id=?) ORDER BY updated_at DESC`).all(kind, id, kind, id);
    return rows;
  } catch { return []; }
}

function logEvent(db, contractId, kind, byKind, byId, terms) {
  try { db.prepare(`INSERT INTO career_contract_events (contract_id, kind, by_kind, by_id, terms_json) VALUES (?,?,?,?,?)`).run(contractId, kind, byKind || null, byId || null, JSON.stringify(terms || {})); } catch { /* events optional */ }
}
