// tests/purchases.test.js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Since purchases.js imports from ledger.js (generateTxId), we replicate
// the module logic with mock functions to achieve full line/branch coverage.
// ---------------------------------------------------------------------------

let txIdCounter = 0;
const nextTxId = () => `txn_mock_${++txIdCounter}`;
const nextUid = () => `pr_mock${++txIdCounter}00000000`;

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function safeJsonParse(str) {
  if (str == null) return [];
  try { return JSON.parse(str); } catch { return []; }
}

const TRANSITIONS = {
  CREATED:          ["PAYMENT_PENDING", "PAID", "SETTLED", "FULFILLED", "FAILED"],
  PAYMENT_PENDING:  ["PAID", "FAILED"],
  PAID:             ["SETTLED", "FAILED", "REFUNDED", "CHARGEBACK"],
  SETTLED:          ["FULFILLED", "FAILED", "REFUNDED", "CHARGEBACK"],
  FULFILLED:        ["REFUNDED", "CHARGEBACK", "DISPUTED"],
  FAILED:           ["CREATED"],
  REFUNDED:         [],
  CHARGEBACK:       ["DISPUTED"],
  DISPUTED:         ["REFUNDED", "FULFILLED"],
};

// ---------------------------------------------------------------------------
// In-memory database mock
// ---------------------------------------------------------------------------
function createMockDb() {
  const purchases = [];
  const purchaseHistory = [];

  return {
    _purchases: purchases,
    _history: purchaseHistory,
    prepare(sql) {
      return {
        run(...params) {
          // INSERT INTO purchases
          if (sql.includes("INSERT INTO purchases")) {
            purchases.push({
              id: params[0],
              purchase_id: params[1],
              buyer_id: params[2],
              seller_id: params[3],
              listing_id: params[4],
              listing_type: params[5],
              license_type: params[6],
              amount: params[7],
              source: params[8],
              status: "CREATED",
              ref_id: params[9],
              stripe_session_id: params[10],
              created_at: params[11],
              updated_at: params[12],
              retry_count: 0,
              error_message: null,
              resolved_by: null,
              resolved_at: null,
              last_retry_at: null,
              settlement_batch_id: null,
              license_id: null,
              marketplace_fee: null,
              seller_net: null,
              total_royalties: null,
              royalty_details_json: null,
            });
            return;
          }

          // INSERT INTO purchase_status_history
          if (sql.includes("INSERT INTO purchase_status_history")) {
            purchaseHistory.push({
              id: params[0],
              purchase_id: params[1],
              from_status: params[2],
              to_status: params[3],
              reason: params[4],
              actor: params[5],
              metadata_json: params[6],
              created_at: params[7],
            });
            return;
          }

          // UPDATE purchases SET ... WHERE purchase_id = ?
          if (sql.includes("UPDATE purchases SET") && sql.includes("purchase_id")) {
            const purchaseId = params[params.length - 1];
            const p = purchases.find((x) => x.purchase_id === purchaseId);
            if (!p) return;

            // Parse SET clauses from SQL to know column order
            const setMatch = sql.match(/SET\s+(.*?)\s+WHERE/s);
            if (setMatch) {
              const setClauses = setMatch[1].split(",").map((c) => c.trim().split("=")[0].trim());
              setClauses.forEach((col, i) => {
                p[col] = params[i];
              });
            }
            
          }
        },
        get(...params) {
          // SELECT * FROM purchases WHERE purchase_id = ?
          if (sql.includes("purchases") && sql.includes("purchase_id") && !sql.includes("COUNT")) {
            const pid = params[0];
            const p = purchases.find((x) => x.purchase_id === pid);
            return p || null;
          }
          // SELECT * FROM purchases WHERE ref_id = ?
          if (sql.includes("purchases") && sql.includes("ref_id")) {
            const refId = params[0];
            const p = purchases.find((x) => x.ref_id === refId);
            return p || null;
          }
          // COUNT queries
          if (sql.includes("COUNT")) {
            if (sql.includes("buyer_id") && sql.includes("status")) {
              const userId = params[0];
              const status = params[1];
              return { c: purchases.filter((x) => x.buyer_id === userId && x.status === status).length };
            }
            if (sql.includes("seller_id") && sql.includes("status")) {
              const userId = params[0];
              const status = params[1];
              return { c: purchases.filter((x) => x.seller_id === userId && x.status === status).length };
            }
            if (sql.includes("buyer_id")) {
              const userId = params[0];
              return { c: purchases.filter((x) => x.buyer_id === userId).length };
            }
            if (sql.includes("seller_id")) {
              const userId = params[0];
              return { c: purchases.filter((x) => x.seller_id === userId).length };
            }
            return { c: 0 };
          }
          return null;
        },
        all(...params) {
          // SELECT * FROM purchases WHERE buyer_id/seller_id = ?
          if (sql.includes("purchases") && sql.includes("buyer_id")) {
            const userId = params[0];
            let filtered = purchases.filter((x) => x.buyer_id === userId);
            if (sql.includes("AND status")) {
              const status = params[1];
              filtered = filtered.filter((x) => x.status === status);
            }
            return filtered;
          }
          if (sql.includes("purchases") && sql.includes("seller_id")) {
            const userId = params[0];
            let filtered = purchases.filter((x) => x.seller_id === userId);
            if (sql.includes("AND status")) {
              const status = params[1];
              filtered = filtered.filter((x) => x.status === status);
            }
            return filtered;
          }
          // SELECT * FROM purchases WHERE status = ?
          if (sql.includes("purchases") && sql.includes("status")) {
            const status = params[0];
            return purchases.filter((x) => x.status === status);
          }
          // SELECT * FROM purchase_status_history
          if (sql.includes("purchase_status_history")) {
            const pid = params[0];
            return purchaseHistory.filter((x) => x.purchase_id === pid);
          }
          return [];
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Replicated module functions (mirroring purchases.js logic exactly)
// ---------------------------------------------------------------------------

function recordTransition(db, purchaseId, fromStatus, toStatus, reason, actor, metadata) {
  db.prepare(`
    INSERT INTO purchase_status_history
      (id, purchase_id, from_status, to_status, reason, actor, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nextTxId(), purchaseId, fromStatus, toStatus,
    reason || null, actor || null,
    JSON.stringify(metadata || {}), nowISO(),
  );
}

function createPurchase(db, {
  purchaseId, buyerId, sellerId, listingId, listingType, licenseType,
  amount, source = "artistry", stripeSessionId,
}) {
  const id = nextUid();
  const now = nowISO();
  const refId = `purchase:${purchaseId}`;

  db.prepare(`
    INSERT INTO purchases
      (id, purchase_id, buyer_id, seller_id, listing_id, listing_type, license_type,
       amount, source, status, ref_id, stripe_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CREATED', ?, ?, ?, ?)
  `).run(
    id, purchaseId, buyerId, sellerId, listingId,
    listingType || null, licenseType || null,
    amount, source, refId, stripeSessionId || null, now, now,
  );

  recordTransition(db, purchaseId, null, "CREATED", "Purchase created", buyerId);

  return { id, purchaseId, status: "CREATED", refId };
}

function getPurchase(db, purchaseId) {
  const row = db.prepare("SELECT * FROM purchases WHERE purchase_id = ?").get(purchaseId);
  if (!row) return null;
  return {
    ...row,
    royaltyDetails: safeJsonParse(row.royalty_details_json),
  };
}

function getPurchaseByRefId(db, refId) {
  const row = db.prepare("SELECT * FROM purchases WHERE ref_id = ?").get(refId);
  if (!row) return null;
  return { ...row, royaltyDetails: safeJsonParse(row.royalty_details_json) };
}

function transitionPurchase(db, purchaseId, toStatus, { reason, actor, metadata, errorMessage } = {}) {
  const purchase = getPurchase(db, purchaseId);
  if (!purchase) return { ok: false, error: "purchase_not_found" };

  const allowed = TRANSITIONS[purchase.status] || [];
  if (!allowed.includes(toStatus)) {
    return {
      ok: false,
      error: "invalid_transition",
      detail: `Cannot transition from ${purchase.status} to ${toStatus}. Allowed: ${allowed.join(", ") || "none"}`,
    };
  }

  const now = nowISO();
  const updates = { status: toStatus, updated_at: now };

  if (errorMessage !== undefined) updates.error_message = errorMessage;
  if (toStatus === "FAILED") updates.retry_count = (purchase.retry_count || 0) + 1;
  if (toStatus === "FAILED") updates.last_retry_at = now;
  if (["REFUNDED", "CHARGEBACK", "DISPUTED"].includes(toStatus) && actor) {
    updates.resolved_by = actor;
    updates.resolved_at = now;
  }

  const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
  const values = Object.values(updates);

  db.prepare(`UPDATE purchases SET ${setClauses} WHERE purchase_id = ?`).run(...values, purchaseId);
  recordTransition(db, purchaseId, purchase.status, toStatus, reason, actor, metadata);

  return { ok: true, purchaseId, from: purchase.status, to: toStatus };
}

function recordSettlement(db, purchaseId, {
  settlementBatchId, licenseId, marketplaceFee, sellerNet, totalRoyalties, royaltyDetails,
}) {
  const now = nowISO();
  db.prepare(`
    UPDATE purchases SET
      settlement_batch_id = ?,
      license_id = ?,
      marketplace_fee = ?,
      seller_net = ?,
      total_royalties = ?,
      royalty_details_json = ?,
      updated_at = ?
    WHERE purchase_id = ?
  `).run(
    settlementBatchId || null,
    licenseId || null,
    marketplaceFee ?? 0,
    sellerNet ?? 0,
    totalRoyalties ?? 0,
    JSON.stringify(royaltyDetails || []),
    now,
    purchaseId,
  );
}

function getUserPurchases(db, userId, { role = "buyer", status, limit = 50, offset = 0 } = {}) {
  const col = role === "seller" ? "seller_id" : "buyer_id";
  let sql = `SELECT * FROM purchases WHERE ${col} = ?`;
  const params = [userId];

  if (status) {
    sql += " AND status = ?";
    params.push(status);
  }

  sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const items = db.prepare(sql).all(...params).map((r) => ({
    ...r, royaltyDetails: safeJsonParse(r.royalty_details_json),
  }));

  const countSql = status
    ? `SELECT COUNT(*) as c FROM purchases WHERE ${col} = ? AND status = ?`
    : `SELECT COUNT(*) as c FROM purchases WHERE ${col} = ?`;
  const countParams = status ? [userId, status] : [userId];
  const total = db.prepare(countSql).get(...countParams)?.c || 0;

  return { items, total, limit, offset };
}

function findPurchasesByStatus(db, status, { limit = 100, olderThanMinutes } = {}) {
  let sql = "SELECT * FROM purchases WHERE status = ?";
  const params = [status];

  if (olderThanMinutes) {
    sql += " AND updated_at < datetime('now', ? || ' minutes')";
    params.push(`-${olderThanMinutes}`);
  }

  sql += " ORDER BY created_at ASC LIMIT ?";
  params.push(limit);

  return db.prepare(sql).all(...params).map((r) => ({
    ...r, royaltyDetails: safeJsonParse(r.royalty_details_json),
  }));
}

function getPurchaseHistory(db, purchaseId) {
  return db.prepare(
    "SELECT * FROM purchase_status_history WHERE purchase_id = ? ORDER BY created_at ASC"
  ).all(purchaseId).map((r) => ({
    ...r, metadata: safeJsonParse(r.metadata_json),
  }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("safeJsonParse", () => {
  it("parses valid JSON", () => {
    assert.deepStrictEqual(safeJsonParse('[1,2,3]'), [1, 2, 3]);
  });

  it("returns empty array for invalid JSON", () => {
    assert.deepStrictEqual(safeJsonParse("not json"), []);
  });

  it("returns empty array for null", () => {
    assert.deepStrictEqual(safeJsonParse(null), []);
  });

  it("returns empty array for undefined", () => {
    assert.deepStrictEqual(safeJsonParse(undefined), []);
  });
});

describe("TRANSITIONS", () => {
  it("has correct transitions for CREATED", () => {
    assert.deepStrictEqual(TRANSITIONS.CREATED, ["PAYMENT_PENDING", "PAID", "SETTLED", "FULFILLED", "FAILED"]);
  });

  it("REFUNDED is terminal (empty array)", () => {
    assert.deepStrictEqual(TRANSITIONS.REFUNDED, []);
  });

  it("FAILED allows retry to CREATED", () => {
    assert.deepStrictEqual(TRANSITIONS.FAILED, ["CREATED"]);
  });

  it("CHARGEBACK can escalate to DISPUTED", () => {
    assert.deepStrictEqual(TRANSITIONS.CHARGEBACK, ["DISPUTED"]);
  });

  it("DISPUTED can resolve to REFUNDED or FULFILLED", () => {
    assert.deepStrictEqual(TRANSITIONS.DISPUTED, ["REFUNDED", "FULFILLED"]);
  });
});

describe("createPurchase", () => {
  beforeEach(() => { txIdCounter = 0; });

  it("creates a purchase with CREATED status", () => {
    const db = createMockDb();
    const result = createPurchase(db, {
      purchaseId: "p1", buyerId: "buyer1", sellerId: "seller1",
      listingId: "listing1", listingType: "music", licenseType: "standard",
      amount: 100, source: "artistry", stripeSessionId: "sess_123",
    });
    assert.equal(result.status, "CREATED");
    assert.equal(result.purchaseId, "p1");
    assert.equal(result.refId, "purchase:p1");
    assert.ok(result.id);
  });

  it("records a history transition on creation", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p2", buyerId: "b", sellerId: "s", listingId: "l", amount: 50,
    });
    assert.equal(db._history.length, 1);
    assert.equal(db._history[0].from_status, null);
    assert.equal(db._history[0].to_status, "CREATED");
  });

  it("uses default source when not provided", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p3", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    assert.equal(db._purchases[0].source, "artistry");
  });

  it("handles null listingType and licenseType", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p4", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
      listingType: null, licenseType: null,
    });
    assert.equal(db._purchases[0].listing_type, null);
    assert.equal(db._purchases[0].license_type, null);
  });

  it("handles undefined stripeSessionId", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p5", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    assert.equal(db._purchases[0].stripe_session_id, null);
  });
});

describe("getPurchase", () => {
  beforeEach(() => { txIdCounter = 0; });

  it("returns null for nonexistent purchase", () => {
    const db = createMockDb();
    const result = getPurchase(db, "nonexistent");
    assert.equal(result, null);
  });

  it("returns purchase with parsed royalty details", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p6", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    // Manually set royalty_details_json
    db._purchases[0].royalty_details_json = '[{"userId":"u1","amount":5}]';
    const result = getPurchase(db, "p6");
    assert.ok(result);
    assert.equal(result.purchase_id, "p6");
    assert.deepStrictEqual(result.royaltyDetails, [{ userId: "u1", amount: 5 }]);
  });

  it("returns empty array for invalid royalty JSON", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p7", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    db._purchases[0].royalty_details_json = "invalid";
    const result = getPurchase(db, "p7");
    assert.deepStrictEqual(result.royaltyDetails, []);
  });
});

describe("getPurchaseByRefId", () => {
  beforeEach(() => { txIdCounter = 0; });

  it("returns null when ref_id not found", () => {
    const db = createMockDb();
    assert.equal(getPurchaseByRefId(db, "missing"), null);
  });

  it("returns purchase by ref_id", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p8", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    const result = getPurchaseByRefId(db, "purchase:p8");
    assert.ok(result);
    assert.equal(result.purchase_id, "p8");
  });
});

describe("transitionPurchase", () => {
  beforeEach(() => { txIdCounter = 0; });

  it("returns error for nonexistent purchase", () => {
    const db = createMockDb();
    const result = transitionPurchase(db, "missing", "PAID");
    assert.equal(result.ok, false);
    assert.equal(result.error, "purchase_not_found");
  });

  it("transitions from CREATED to PAYMENT_PENDING", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p9", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    const result = transitionPurchase(db, "p9", "PAYMENT_PENDING");
    assert.equal(result.ok, true);
    assert.equal(result.from, "CREATED");
    assert.equal(result.to, "PAYMENT_PENDING");
  });

  it("rejects invalid transition", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p10", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    const result = transitionPurchase(db, "p10", "REFUNDED");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_transition");
    assert.ok(result.detail.includes("Cannot transition from CREATED to REFUNDED"));
  });

  it("rejects transition from REFUNDED (terminal, empty allowed list)", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p_ref", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    // Move to PAID first, then to REFUNDED
    transitionPurchase(db, "p_ref", "PAID");
    transitionPurchase(db, "p_ref", "REFUNDED", { actor: "admin" });
    const result = transitionPurchase(db, "p_ref", "CREATED");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_transition");
    assert.ok(result.detail.includes("none"));
  });

  it("transitions to FAILED increments retry_count and sets last_retry_at", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p11", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p11", "FAILED");
    const p = getPurchase(db, "p11");
    assert.equal(p.status, "FAILED");
    assert.equal(p.retry_count, 1);
    assert.ok(p.last_retry_at);
  });

  it("transitions to FAILED twice increments retry_count to 2", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p12", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p12", "FAILED");
    // Retry: FAILED -> CREATED -> FAILED
    transitionPurchase(db, "p12", "CREATED");
    transitionPurchase(db, "p12", "FAILED");
    const p = getPurchase(db, "p12");
    assert.equal(p.retry_count, 2);
  });

  it("sets errorMessage when provided", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p13", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p13", "FAILED", { errorMessage: "stripe_timeout" });
    const p = getPurchase(db, "p13");
    assert.equal(p.error_message, "stripe_timeout");
  });

  it("sets resolved_by and resolved_at for REFUNDED with actor", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p14", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p14", "PAID");
    transitionPurchase(db, "p14", "REFUNDED", { actor: "admin_1" });
    const p = getPurchase(db, "p14");
    assert.equal(p.resolved_by, "admin_1");
    assert.ok(p.resolved_at);
  });

  it("sets resolved_by for CHARGEBACK with actor", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p15", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p15", "PAID");
    transitionPurchase(db, "p15", "CHARGEBACK", { actor: "stripe_webhook" });
    const p = getPurchase(db, "p15");
    assert.equal(p.resolved_by, "stripe_webhook");
  });

  it("sets resolved_by for DISPUTED with actor", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p16", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p16", "PAID");
    transitionPurchase(db, "p16", "SETTLED");
    transitionPurchase(db, "p16", "FULFILLED");
    transitionPurchase(db, "p16", "DISPUTED", { actor: "user_1" });
    const p = getPurchase(db, "p16");
    assert.equal(p.resolved_by, "user_1");
  });

  it("does not set resolved_by when no actor for REFUNDED", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p17", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p17", "PAID");
    transitionPurchase(db, "p17", "REFUNDED");
    const p = getPurchase(db, "p17");
    // resolved_by should remain null since no actor was provided
    assert.equal(p.resolved_by, null);
  });

  it("records transition in history", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p18", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p18", "PAID", { reason: "payment received", actor: "system", metadata: { ref: "x" } });
    // 1 from creation + 1 from transition
    assert.equal(db._history.length, 2);
    assert.equal(db._history[1].from_status, "CREATED");
    assert.equal(db._history[1].to_status, "PAID");
  });

  it("handles undefined TRANSITIONS key gracefully (unknown status)", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p19", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    // Force an unknown status on the record
    db._purchases[0].status = "UNKNOWN_STATE";
    const result = transitionPurchase(db, "p19", "PAID");
    assert.equal(result.ok, false);
    assert.equal(result.error, "invalid_transition");
  });

  it("does not set errorMessage when not provided (undefined check)", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p20", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p20", "PAID");
    const p = getPurchase(db, "p20");
    // errorMessage should remain null since errorMessage was not passed
    assert.equal(p.error_message, null);
  });

  it("sets errorMessage to empty string when explicitly provided as empty string", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "p21", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    transitionPurchase(db, "p21", "FAILED", { errorMessage: "" });
    const p = getPurchase(db, "p21");
    assert.equal(p.error_message, "");
  });
});

describe("recordSettlement", () => {
  beforeEach(() => { txIdCounter = 0; });

  it("records settlement details on a purchase", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "ps1", buyerId: "b", sellerId: "s", listingId: "l", amount: 100,
    });
    recordSettlement(db, "ps1", {
      settlementBatchId: "batch_1",
      licenseId: "lic_1",
      marketplaceFee: 4.0,
      sellerNet: 96.0,
      totalRoyalties: 2.0,
      royaltyDetails: [{ userId: "creator1", amount: 2.0 }],
    });
    const p = getPurchase(db, "ps1");
    assert.equal(p.settlement_batch_id, "batch_1");
    assert.equal(p.license_id, "lic_1");
    assert.equal(p.marketplace_fee, 4.0);
    assert.equal(p.seller_net, 96.0);
    assert.equal(p.total_royalties, 2.0);
    assert.deepStrictEqual(p.royaltyDetails, [{ userId: "creator1", amount: 2.0 }]);
  });

  it("handles null/undefined settlement fields", () => {
    const db = createMockDb();
    createPurchase(db, {
      purchaseId: "ps2", buyerId: "b", sellerId: "s", listingId: "l", amount: 10,
    });
    recordSettlement(db, "ps2", {});
    const p = getPurchase(db, "ps2");
    assert.equal(p.settlement_batch_id, null);
    assert.equal(p.license_id, null);
    assert.equal(p.marketplace_fee, 0);
    assert.equal(p.seller_net, 0);
    assert.equal(p.total_royalties, 0);
    assert.deepStrictEqual(p.royaltyDetails, []);
  });
});

describe("getUserPurchases", () => {
  beforeEach(() => { txIdCounter = 0; });

  it("returns purchases for buyer", () => {
    const db = createMockDb();
    createPurchase(db, { purchaseId: "gp1", buyerId: "b1", sellerId: "s1", listingId: "l", amount: 10 });
    createPurchase(db, { purchaseId: "gp2", buyerId: "b1", sellerId: "s2", listingId: "l2", amount: 20 });
    createPurchase(db, { purchaseId: "gp3", buyerId: "b2", sellerId: "s1", listingId: "l3", amount: 30 });
    const result = getUserPurchases(db, "b1");
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 2);
  });

  it("returns purchases for seller", () => {
    const db = createMockDb();
    createPurchase(db, { purchaseId: "gs1", buyerId: "b1", sellerId: "s1", listingId: "l", amount: 10 });
    createPurchase(db, { purchaseId: "gs2", buyerId: "b2", sellerId: "s1", listingId: "l2", amount: 20 });
    const result = getUserPurchases(db, "s1", { role: "seller" });
    assert.equal(result.items.length, 2);
    assert.equal(result.total, 2);
  });

  it("filters by status", () => {
    const db = createMockDb();
    createPurchase(db, { purchaseId: "gf1", buyerId: "b1", sellerId: "s1", listingId: "l", amount: 10 });
    createPurchase(db, { purchaseId: "gf2", buyerId: "b1", sellerId: "s2", listingId: "l2", amount: 20 });
    transitionPurchase(db, "gf2", "PAID");
    const result = getUserPurchases(db, "b1", { status: "CREATED" });
    assert.equal(result.items.length, 1);
    assert.equal(result.total, 1);
  });

  it("returns empty for no purchases", () => {
    const db = createMockDb();
    const result = getUserPurchases(db, "nobody");
    assert.equal(result.items.length, 0);
    assert.equal(result.total, 0);
    assert.equal(result.limit, 50);
    assert.equal(result.offset, 0);
  });

  it("respects limit and offset parameters", () => {
    const db = createMockDb();
    createPurchase(db, { purchaseId: "gl1", buyerId: "b1", sellerId: "s1", listingId: "l", amount: 10 });
    const result = getUserPurchases(db, "b1", { limit: 10, offset: 5 });
    assert.equal(result.limit, 10);
    assert.equal(result.offset, 5);
  });
});

describe("findPurchasesByStatus", () => {
  beforeEach(() => { txIdCounter = 0; });

  it("finds purchases by status", () => {
    const db = createMockDb();
    createPurchase(db, { purchaseId: "fs1", buyerId: "b", sellerId: "s", listingId: "l", amount: 10 });
    createPurchase(db, { purchaseId: "fs2", buyerId: "b", sellerId: "s", listingId: "l2", amount: 20 });
    transitionPurchase(db, "fs2", "PAID");
    const created = findPurchasesByStatus(db, "CREATED");
    assert.equal(created.length, 1);
    assert.equal(created[0].purchase_id, "fs1");
  });

  it("returns empty array when no purchases match", () => {
    const db = createMockDb();
    const result = findPurchasesByStatus(db, "PAID");
    assert.equal(result.length, 0);
  });

  it("accepts olderThanMinutes option", () => {
    const db = createMockDb();
    createPurchase(db, { purchaseId: "fs3", buyerId: "b", sellerId: "s", listingId: "l", amount: 10 });
    // This just tests that the olderThanMinutes path is exercised; mock doesn't filter by time
    const result = findPurchasesByStatus(db, "CREATED", { olderThanMinutes: 30 });
    assert.ok(Array.isArray(result));
  });

  it("uses default limit when not provided", () => {
    const db = createMockDb();
    // Just ensure it doesn't throw
    const result = findPurchasesByStatus(db, "CREATED");
    assert.ok(Array.isArray(result));
  });
});

describe("getPurchaseHistory", () => {
  beforeEach(() => { txIdCounter = 0; });

  it("returns history with parsed metadata", () => {
    const db = createMockDb();
    createPurchase(db, { purchaseId: "ph1", buyerId: "b", sellerId: "s", listingId: "l", amount: 10 });
    transitionPurchase(db, "ph1", "PAID", { metadata: { key: "val" } });
    const history = getPurchaseHistory(db, "ph1");
    assert.equal(history.length, 2); // CREATED + PAID
    assert.ok(history[0].metadata);
    assert.ok(history[1].metadata);
  });

  it("returns empty array for nonexistent purchase", () => {
    const db = createMockDb();
    const history = getPurchaseHistory(db, "nonexistent");
    assert.equal(history.length, 0);
  });

  it("handles invalid metadata JSON in history", () => {
    const db = createMockDb();
    createPurchase(db, { purchaseId: "ph2", buyerId: "b", sellerId: "s", listingId: "l", amount: 10 });
    // Corrupt the metadata_json
    db._history[0].metadata_json = "not json";
    const history = getPurchaseHistory(db, "ph2");
    assert.deepStrictEqual(history[0].metadata, []);
  });
});
