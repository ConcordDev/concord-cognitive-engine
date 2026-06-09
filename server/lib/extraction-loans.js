// server/lib/extraction-loans.js
//
// Extraction-by-rescue — the Mercy Fund bailout whose conditions transfer the
// asset. A realm in crisis (treasury below the threshold the Tessera's managed
// parity helped arrange) is offered a rescue: its treasury is topped up now, and
// a collateral asset transfers to the creditor if the loan isn't repaid by due.
// "We only ask for everything."
//
// Scoped by world_id (Sere). Kill-switch CONCORD_MERCY_FUND=0. Never throws on a
// missing table. The debt-trap is observable: the lien rows are what the Ledger
// lens surfaces, and a default is a thing the player can watch happen.

import crypto from "node:crypto";

const CRISIS_TREASURY = Number(process.env.CONCORD_MERCY_CRISIS_TREASURY ?? 150);
const RESCUE_AMOUNT = Number(process.env.CONCORD_MERCY_RESCUE_AMOUNT ?? 500);
const LOAN_TERM_S = Number(process.env.CONCORD_MERCY_TERM_S ?? 7 * 24 * 3600);

export function enabled() {
  return process.env.CONCORD_MERCY_FUND !== "0";
}
function tableOk(db) {
  try { db.prepare("SELECT 1 FROM extraction_loans LIMIT 1").get(); return true; } catch { return false; }
}

export function activeLoans(db, worldId) {
  if (!tableOk(db)) return [];
  try {
    return worldId
      ? db.prepare("SELECT * FROM extraction_loans WHERE world_id=? AND status='active'").all(worldId)
      : db.prepare("SELECT * FROM extraction_loans WHERE status='active'").all();
  } catch { return []; }
}

/**
 * Offer a rescue to a realm in crisis: credit its treasury now, take a collateral
 * lien due later. Idempotent-ish: skips if the realm already has an active loan.
 */
export function offerRescue(db, { worldId, realmId, creditorId = "the_mercy_fund", collateralBuildingId = null, nowS = Math.floor(Date.now() / 1000) }) {
  if (!enabled()) return { ok: false, reason: "disabled" };
  if (!tableOk(db) || !worldId || !realmId) return { ok: false, reason: "missing_inputs" };
  try {
    const existing = db.prepare("SELECT id FROM extraction_loans WHERE world_id=? AND debtor_id=? AND status='active'").get(worldId, realmId);
    if (existing) return { ok: false, reason: "already_in_debt", loanId: existing.id };
    const id = `loan_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO extraction_loans
        (id, world_id, debtor_kind, debtor_id, creditor_id, amount, conditions, collateral_kind, collateral_id, status, due_at)
      VALUES (?, ?, 'realm', ?, ?, ?, ?, ?, ?, 'active', ?)
    `).run(id, worldId, realmId, creditorId, RESCUE_AMOUNT,
      "We only ask for everything: default transfers the collateral.",
      collateralBuildingId ? "building" : "none", collateralBuildingId, nowS + LOAN_TERM_S);
    // The rescue arrives — treasury topped up now (the gratitude of the drowning).
    try { db.prepare("UPDATE realms SET treasury = treasury + ? WHERE id=?").run(RESCUE_AMOUNT, realmId); } catch { /* realms optional */ }
    return { ok: true, loanId: id, amount: RESCUE_AMOUNT };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

/** The realm that reads the conditions and recovers without surrendering the asset. */
export function repayLoan(db, loanId) {
  if (!tableOk(db)) return { ok: false, reason: "no_table" };
  try {
    const loan = db.prepare("SELECT * FROM extraction_loans WHERE id=? AND status='active'").get(loanId);
    if (!loan) return { ok: false, reason: "no_active_loan" };
    try { db.prepare("UPDATE realms SET treasury = treasury - ? WHERE id=?").run(loan.amount, loan.debtor_id); } catch { /* best-effort */ }
    db.prepare("UPDATE extraction_loans SET status='repaid', resolved_at=unixepoch() WHERE id=?").run(loanId);
    return { ok: true };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

/** Default: the lien closes and the collateral transfers to the creditor. */
export function defaultLoan(db, loanId) {
  if (!tableOk(db)) return { ok: false, reason: "no_table" };
  try {
    const loan = db.prepare("SELECT * FROM extraction_loans WHERE id=? AND status='active'").get(loanId);
    if (!loan) return { ok: false, reason: "no_active_loan" };
    let transferred = null;
    if (loan.collateral_kind === "building" && loan.collateral_id) {
      try {
        const r = db.prepare("UPDATE world_buildings SET owner_type='npc', owner_id=? WHERE id=?").run(loan.creditor_id, loan.collateral_id);
        if (r.changes > 0) transferred = loan.collateral_id;
      } catch { /* buildings optional */ }
    }
    db.prepare("UPDATE extraction_loans SET status='defaulted', resolved_at=unixepoch() WHERE id=?").run(loanId);
    return { ok: true, transferred, creditorId: loan.creditor_id };
  } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
}

/** Default every active loan past its due date. Returns the transfers that fired. */
export function sweepDueLoans(db, { worldId = "sere", nowS = Math.floor(Date.now() / 1000) } = {}) {
  if (!enabled() || !tableOk(db)) return { ok: true, defaulted: [] };
  const defaulted = [];
  try {
    const due = db.prepare("SELECT id FROM extraction_loans WHERE world_id=? AND status='active' AND due_at <= ?").all(worldId, nowS);
    for (const { id } of due) {
      const r = defaultLoan(db, id);
      if (r.ok) defaulted.push({ loanId: id, transferred: r.transferred, creditorId: r.creditorId });
    }
  } catch { /* isolation */ }
  return { ok: true, defaulted };
}

/**
 * Crisis detection: any Sere realm whose treasury sagged below the threshold gets
 * a rescue offer with its capital as collateral. Returns the offers made.
 */
export function offerRescuesForCrises(db, { worldId = "sere", nowS = Math.floor(Date.now() / 1000) } = {}) {
  if (!enabled() || !tableOk(db)) return { ok: true, offered: [] };
  const offered = [];
  let realms = [];
  try { realms = db.prepare("SELECT id FROM realms WHERE world_id=? AND treasury < ?").all(worldId, CRISIS_TREASURY); }
  catch { return { ok: true, offered: [] }; } // realms table absent
  const selCollateral = db.prepare("SELECT id FROM world_buildings WHERE world_id=? AND owner_type='realm' AND owner_id=? LIMIT 1");
  for (const realm of realms) {
    // collateral = a building owned by the realm's faction, if any
    let collateral = null;
    try { collateral = selCollateral.get(worldId, realm.id)?.id || null; } catch { /* ok */ }
    const r = offerRescue(db, { worldId, realmId: realm.id, collateralBuildingId: collateral, nowS });
    if (r.ok) offered.push({ realmId: realm.id, loanId: r.loanId });
  }
  return { ok: true, offered };
}

export const _testing = { CRISIS_TREASURY, RESCUE_AMOUNT, LOAN_TERM_S };
