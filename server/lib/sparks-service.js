// server/lib/sparks-service.js
//
// The unified SPARKS mover — Concordia's in-world currency (distinct from the
// USD-pegged Concord Coin in economy/coin-service.js). Sparks live in two
// canonical stores with no idempotent transfer primitive between them:
//   players → `users.sparks`        (migration 048; served by lib/currency.js)
//   NPCs    → `world_npcs.wealth_sparks` (migration 061)
// (`sparks_balances` in betting-markets.js is a separate fragmented store and
// is NOT the canonical player balance — do not use it for civic money.)
//
// This service is a THIN layer over the canonical stores that adds the two
// missing primitives Civic Bonds (and every sparks-moving engine) needs:
//   1. a single holder-agnostic debit/credit/transfer interface (player|npc), and
//   2. idempotency on refId — a retried pledge/payout never double-moves.
// Player mutations DELEGATE to lib/currency.js (canonical users.sparks +
// sparks_ledger audit row). NPC mutations touch wealth_sparks directly.

import { awardSparks, spendSparks, getBalances } from "./currency.js";

// Idempotency gate — separate from the legacy sparks_ledger (which has no
// ref_id column and FKs users, so it can't record NPC moves). One row per
// applied refId; a replay is detected by the PK collision.
function ensureRefTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sparks_txn_refs (
      ref_id      TEXT PRIMARY KEY,
      holder_kind TEXT NOT NULL,
      holder_id   TEXT NOT NULL,
      delta       INTEGER NOT NULL,
      reason      TEXT,
      applied_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

/** Current sparks balance for a holder (player → users.sparks, npc → wealth_sparks). */
export function getSparks(db, holderKind, holderId) {
  if (!db || !holderId) return 0;
  try {
    if (holderKind === "npc") {
      const r = db.prepare(`SELECT wealth_sparks AS b FROM world_npcs WHERE id = ?`).get(String(holderId));
      return Math.max(0, Number(r?.b ?? 0));
    }
    return Math.max(0, Number(getBalances(db, String(holderId)).sparks ?? 0));
  } catch {
    return 0;
  }
}

function _applyPlayer(db, holderId, delta, reason, worldId) {
  if (delta >= 0) awardSparks(db, holderId, delta, reason, worldId);
  else spendSparks(db, holderId, -delta, reason, worldId); // throws "insufficient_sparks"
}

function _applyNpc(db, holderId, delta) {
  if (delta < 0) {
    const have = getSparks(db, "npc", holderId);
    if (have + delta < 0) throw new Error("insufficient_sparks");
  }
  db.prepare(`UPDATE world_npcs SET wealth_sparks = MAX(0, COALESCE(wealth_sparks,0) + ?) WHERE id = ?`)
    .run(delta, String(holderId));
}

// Core signed mutation. Idempotent on refId. A debit that would overdraw throws
// (rolling back the ref claim) and is reported as { ok:false }.
function _move(db, { holderKind = "player", holderId, delta, refId = null, reason = "", worldId = null }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!holderId) return { ok: false, reason: "no_holder" };
  const d = Math.trunc(Number(delta));
  if (!Number.isFinite(d) || d === 0) return { ok: false, reason: "bad_amount" };
  ensureRefTable(db);

  const tx = db.transaction(() => {
    if (refId) {
      const claimed = db.prepare(
        `INSERT OR IGNORE INTO sparks_txn_refs (ref_id, holder_kind, holder_id, delta, reason) VALUES (?, ?, ?, ?, ?)`
      ).run(String(refId), holderKind, String(holderId), d, String(reason || ""));
      if (claimed.changes === 0) {
        return { ok: true, idempotent: true, balance: getSparks(db, holderKind, holderId) };
      }
    }
    if (holderKind === "npc") _applyNpc(db, holderId, d);
    else _applyPlayer(db, holderId, d, reason, worldId);
    return { ok: true, idempotent: false, balance: getSparks(db, holderKind, holderId) };
  });

  try {
    return tx();
  } catch (err) {
    const msg = String(err?.message || err);
    return { ok: false, reason: msg.includes("insufficient") ? "insufficient_sparks" : msg };
  }
}

/** Credit sparks to a holder. Idempotent on refId. */
export function creditSparks(db, { holderKind = "player", holderId, amount, refId = null, reason = "", worldId = null }) {
  return _move(db, { holderKind, holderId, delta: Math.abs(Math.trunc(Number(amount))), refId, reason, worldId });
}

/** Debit sparks from a holder. Rejects an overdraw. Idempotent on refId. */
export function debitSparks(db, { holderKind = "player", holderId, amount, refId = null, reason = "", worldId = null }) {
  return _move(db, { holderKind, holderId, delta: -Math.abs(Math.trunc(Number(amount))), refId, reason, worldId });
}

/**
 * Move sparks between two holders in one transaction. Idempotent on refId (each
 * leg keyed `${refId}:debit` / `:credit`). If the source can't cover it, nothing
 * moves (the whole transfer rolls back).
 */
export function transferSparks(db, { fromKind = "player", fromId, toKind = "player", toId, amount, refId = null, reason = "", worldId = null }) {
  if (!db) return { ok: false, reason: "no_db" };
  const amt = Math.abs(Math.trunc(Number(amount)));
  if (!Number.isFinite(amt) || amt === 0) return { ok: false, reason: "bad_amount" };
  if (!fromId || !toId) return { ok: false, reason: "missing_holder" };
  ensureRefTable(db);

  const tx = db.transaction(() => {
    const deb = _move(db, { holderKind: fromKind, holderId: fromId, delta: -amt, refId: refId ? `${refId}:debit` : null, reason, worldId });
    if (!deb.ok) throw new Error(deb.reason || "debit_failed");
    const cred = _move(db, { holderKind: toKind, holderId: toId, delta: amt, refId: refId ? `${refId}:credit` : null, reason, worldId });
    if (!cred.ok) throw new Error(cred.reason || "credit_failed");
    return { ok: true, from: getSparks(db, fromKind, fromId), to: getSparks(db, toKind, toId), idempotent: deb.idempotent && cred.idempotent };
  });

  try {
    return tx();
  } catch (err) {
    const msg = String(err?.message || err);
    return { ok: false, reason: msg.includes("insufficient") ? "insufficient_sparks" : msg };
  }
}

export { ensureRefTable };
