// server/lib/economy-flows.js
//
// The data behind the Ledger lens — "the analytical overlay you toggle to see the
// flows the Curtain hides." Read-only aggregations. The headline is
// anomalousFlows(): the managed-parity funding (faction_funding) + the
// extraction liens (extraction_loans) that the Curtain keeps off the public
// record. Surfacing them IS the satire's payoff — discovery, not preaching.
//
// All reads are table-guarded (degrade to empty on a minimal build) and scoped by
// world_id where the substrate supports it.

function safeAll(db, sql, ...args) {
  try { return db.prepare(sql).all(...args); } catch { return []; }
}

/**
 * The flows the Curtain hides, for one world. Two streams:
 *  - managed_parity: who funds both sides of which war (the Tessera).
 *  - extraction_liens: active rescue loans + what collateral they hold hostage.
 */
export function anomalousFlows(db, worldId = "sere") {
  if (!db) return { ok: false, reason: "no_db" };
  const funding = safeAll(db,
    `SELECT funder_id, war_faction_a, war_faction_b, created_at
     FROM faction_funding WHERE world_id = ? AND active = 1`, worldId
  ).map((f) => ({
    kind: "managed_parity",
    funder: f.funder_id,
    fundsBothSidesOf: [f.war_faction_a, f.war_faction_b],
    detail: `${f.funder_id} funds both ${f.war_faction_a} and ${f.war_faction_b} — the war is kept lit because resolution ends the revenue.`,
  }));

  const liens = safeAll(db,
    `SELECT id, creditor_id, debtor_kind, debtor_id, amount, collateral_kind, collateral_id, status, due_at
     FROM extraction_loans WHERE world_id = ? AND status = 'active'`, worldId
  ).map((l) => ({
    kind: "extraction_lien",
    creditor: l.creditor_id,
    debtor: { kind: l.debtor_kind, id: l.debtor_id },
    amount: l.amount,
    collateral: l.collateral_kind === "building" ? { kind: "building", id: l.collateral_id } : null,
    dueAt: l.due_at,
    detail: `${l.creditor_id} holds a lien over ${l.debtor_id}${l.collateral_id ? ` (collateral: ${l.collateral_id})` : ""} — rescue as acquisition.`,
  }));

  return { ok: true, worldId, managedParity: funding, extractionLiens: liens, total: funding.length + liens.length };
}

/**
 * A faction/realm's economic exposure: treasury + the funding it receives + the
 * liens against it. The "follow the money up the chain" view for the dossier.
 */
export function factionEconomyState(db, worldId, factionId) {
  if (!db || !factionId) return { ok: false, reason: "missing_inputs" };
  const realm = safeAll(db, `SELECT id, treasury FROM realms WHERE world_id = ? AND faction_id = ?`, worldId, factionId)[0]
    || safeAll(db, `SELECT id, treasury FROM realms WHERE id = ?`, factionId)[0] || null;
  const fundedBy = safeAll(db,
    `SELECT funder_id FROM faction_funding WHERE world_id = ? AND active = 1 AND (war_faction_a = ? OR war_faction_b = ?)`,
    worldId, factionId, factionId
  ).map((r) => r.funder_id);
  const liensAgainst = safeAll(db,
    `SELECT creditor_id, amount, collateral_id FROM extraction_loans WHERE world_id = ? AND debtor_id = ? AND status = 'active'`,
    worldId, factionId
  );
  return { ok: true, factionId, treasury: realm?.treasury ?? null, fundedBy, liensAgainst };
}

/** Generic recent-flow rollup from the economy ledger (best-effort; the world has no per-row world_id). */
export function flowSummary(db, { limit = 50 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const byType = safeAll(db,
    `SELECT type, COUNT(*) AS n, ROUND(SUM(COALESCE(net, amount, 0)), 2) AS total
     FROM economy_ledger GROUP BY type ORDER BY total DESC LIMIT ?`, limit
  );
  return { ok: true, byType };
}
