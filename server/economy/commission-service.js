// economy/commission-service.js
// Commission system with escrow — lets creators offer custom work and
// clients request it, with funds held safely in escrow until delivery
// is approved. Disputes route to manual admin review.
//
// Status flow:
//   REQUESTED → ACCEPTED / DECLINED / COUNTERED
//   COUNTERED → CLIENT_ACCEPTED / CLIENT_DECLINED
//   ACCEPTED | CLIENT_ACCEPTED → IN_PROGRESS (after escrow hold)
//   IN_PROGRESS → DELIVERED
//   DELIVERED → APPROVED / DISPUTED
//   DISPUTED → RESOLVED_BUYER / RESOLVED_SELLER
//   APPROVED | RESOLVED_SELLER → COMPLETED (escrow released to creator)
//   RESOLVED_BUYER → COMPLETED (escrow refunded to client)

import { randomUUID } from "crypto";
import { executeTransfer } from "./transfer.js";
import { calculateFee } from "./fees.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ESCROW_ACCOUNT = "__ESCROW__";

function uid(prefix = "com") {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/** Valid status transitions for commission requests. */
const TRANSITIONS = {
  REQUESTED:       ["ACCEPTED", "DECLINED", "COUNTERED"],
  COUNTERED:       ["CLIENT_ACCEPTED", "CLIENT_DECLINED"],
  ACCEPTED:        ["IN_PROGRESS"],
  CLIENT_ACCEPTED: ["IN_PROGRESS"],
  IN_PROGRESS:     ["DELIVERED"],
  DELIVERED:       ["APPROVED", "DISPUTED"],
  DISPUTED:        ["RESOLVED_BUYER", "RESOLVED_SELLER"],
  // Terminal states — no further transitions
  DECLINED:        [],
  CLIENT_DECLINED: [],
  APPROVED:        [],
  RESOLVED_BUYER:  [],
  RESOLVED_SELLER: [],
  COMPLETED:       [],
};

/**
 * Assert that a status transition is legal.
 * Throws if invalid so callers can rely on it inside transactions.
 */
function assertTransition(from, to) {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(
      `invalid_transition: ${from} → ${to}. Allowed: ${(allowed || []).join(", ") || "none"}`
    );
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Create the commission tables if they don't already exist.
 * Safe to call on every startup.
 */
export function ensureCommissionTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commission_types (
      id            TEXT PRIMARY KEY,
      creator_id    TEXT NOT NULL,
      name          TEXT NOT NULL,
      description   TEXT,
      min_price     REAL NOT NULL,
      max_price     REAL NOT NULL,
      turnaround    TEXT,
      category      TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commission_requests (
      id                  TEXT PRIMARY KEY,
      client_id           TEXT NOT NULL,
      creator_id          TEXT NOT NULL,
      commission_type_id  TEXT,
      brief               TEXT NOT NULL,
      agreed_price        REAL NOT NULL,
      status              TEXT NOT NULL DEFAULT 'REQUESTED',
      escrow_tx_id        TEXT,
      delivered_dtu_id    TEXT,
      license_tier        TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commission_messages (
      id          TEXT PRIMARY KEY,
      request_id  TEXT NOT NULL,
      sender_id   TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// Commission Types (creator offerings)
// ---------------------------------------------------------------------------

/**
 * Create a new commission type that a creator offers.
 * @param {object} db - better-sqlite3 instance
 * @param {object} params
 * @returns {{ ok: boolean, commissionType?: object, error?: string }}
 */
export function createCommissionType(db, { creatorId, name, description, minPrice, maxPrice, turnaround, category }) {
  if (!creatorId || !name) return { ok: false, error: "missing_required_fields" };
  if (typeof minPrice !== "number" || typeof maxPrice !== "number") {
    return { ok: false, error: "price_must_be_number" };
  }
  if (minPrice < 0 || maxPrice < 0) return { ok: false, error: "price_must_be_positive" };
  if (minPrice > maxPrice) return { ok: false, error: "min_price_exceeds_max" };

  const id = uid("ctype");
  const now = nowISO();

  db.prepare(`
    INSERT INTO commission_types
      (id, creator_id, name, description, min_price, max_price, turnaround, category, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(id, creatorId, name, description || null, minPrice, maxPrice, turnaround || null, category || null, now);

  return {
    ok: true,
    commissionType: { id, creatorId, name, description, minPrice, maxPrice, turnaround, category, active: 1, createdAt: now },
  };
}

/**
 * Update an existing commission type. Only the owning creator may update.
 */
export function updateCommissionType(db, { id, creatorId, ...fields }) {
  if (!id || !creatorId) return { ok: false, error: "missing_required_fields" };

  const existing = db.prepare("SELECT * FROM commission_types WHERE id = ? AND creator_id = ?").get(id, creatorId);
  if (!existing) return { ok: false, error: "commission_type_not_found" };

  const allowed = ["name", "description", "minPrice", "maxPrice", "turnaround", "category"];
  const colMap = {
    name: "name", description: "description", minPrice: "min_price",
    maxPrice: "max_price", turnaround: "turnaround", category: "category",
  };

  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${colMap[key]} = ?`);
      params.push(fields[key]);
    }
  }

  if (sets.length === 0) return { ok: false, error: "no_fields_to_update" };

  params.push(id, creatorId);
  db.prepare(`UPDATE commission_types SET ${sets.join(", ")} WHERE id = ? AND creator_id = ?`).run(...params);

  return { ok: true };
}

/**
 * Soft-delete a commission type (sets active = 0).
 */
export function deleteCommissionType(db, { id, creatorId }) {
  if (!id || !creatorId) return { ok: false, error: "missing_required_fields" };

  const result = db.prepare("UPDATE commission_types SET active = 0 WHERE id = ? AND creator_id = ?").run(id, creatorId);
  if (result.changes === 0) return { ok: false, error: "commission_type_not_found" };

  return { ok: true };
}

/**
 * List all active commission types for a creator.
 */
export function getCreatorCommissions(db, creatorId) {
  return db.prepare(
    "SELECT * FROM commission_types WHERE creator_id = ? AND active = 1 ORDER BY created_at DESC"
  ).all(creatorId);
}

// ---------------------------------------------------------------------------
// Commission Requests
// ---------------------------------------------------------------------------

/**
 * Client requests a commission from a creator.
 * The proposed price must fall within the commission type's price range.
 */
export function requestCommission(db, { clientId, creatorId, commissionTypeId, brief, proposedPrice, licenseTier }) {
  if (!clientId || !creatorId || !brief) return { ok: false, error: "missing_required_fields" };
  if (clientId === creatorId) return { ok: false, error: "cannot_commission_self" };
  if (typeof proposedPrice !== "number" || proposedPrice <= 0) {
    return { ok: false, error: "invalid_price" };
  }

  // If a commission type is specified, validate the price falls in range
  if (commissionTypeId) {
    const ctype = db.prepare("SELECT * FROM commission_types WHERE id = ? AND active = 1").get(commissionTypeId);
    if (!ctype) return { ok: false, error: "commission_type_not_found" };
    if (ctype.creator_id !== creatorId) return { ok: false, error: "commission_type_creator_mismatch" };
    if (proposedPrice < ctype.min_price || proposedPrice > ctype.max_price) {
      return { ok: false, error: "price_out_of_range", min: ctype.min_price, max: ctype.max_price };
    }
  }

  const id = uid("creq");
  const now = nowISO();

  db.prepare(`
    INSERT INTO commission_requests
      (id, client_id, creator_id, commission_type_id, brief, agreed_price, status, license_tier, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', ?, ?, ?)
  `).run(id, clientId, creatorId, commissionTypeId || null, brief, proposedPrice, licenseTier || null, now, now);

  return {
    ok: true,
    request: { id, clientId, creatorId, commissionTypeId, brief, agreedPrice: proposedPrice, status: "REQUESTED", licenseTier, createdAt: now },
  };
}

/**
 * Creator responds to a commission request: ACCEPT, DECLINE, or COUNTER.
 *
 * - ACCEPT: status → ACCEPTED, then caller should invoke holdEscrow.
 * - DECLINE: status → DECLINED (terminal).
 * - COUNTER: status → COUNTERED with a new price; client must respond.
 */
export function respondToCommission(db, { requestId, creatorId, action, counterPrice, counterMessage }) {
  if (!requestId || !creatorId || !action) return { ok: false, error: "missing_required_fields" };

  const req = db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(requestId);
  if (!req) return { ok: false, error: "request_not_found" };
  if (req.creator_id !== creatorId) return { ok: false, error: "not_authorized" };

  const now = nowISO();
  const upperAction = action.toUpperCase();

  if (upperAction === "ACCEPT") {
    assertTransition(req.status, "ACCEPTED");
    db.prepare("UPDATE commission_requests SET status = 'ACCEPTED', updated_at = ? WHERE id = ?").run(now, requestId);
    return { ok: true, status: "ACCEPTED" };
  }

  if (upperAction === "DECLINE") {
    assertTransition(req.status, "DECLINED");
    db.prepare("UPDATE commission_requests SET status = 'DECLINED', updated_at = ? WHERE id = ?").run(now, requestId);
    return { ok: true, status: "DECLINED" };
  }

  if (upperAction === "COUNTER") {
    if (typeof counterPrice !== "number" || counterPrice <= 0) {
      return { ok: false, error: "invalid_counter_price" };
    }
    assertTransition(req.status, "COUNTERED");
    db.prepare(
      "UPDATE commission_requests SET status = 'COUNTERED', agreed_price = ?, updated_at = ? WHERE id = ?"
    ).run(counterPrice, now, requestId);

    // Optionally record the counter message in the conversation thread
    if (counterMessage) {
      addCommissionMessage(db, { requestId, senderId: creatorId, content: counterMessage });
    }

    return { ok: true, status: "COUNTERED", counterPrice };
  }

  return { ok: false, error: "invalid_action", detail: "Must be ACCEPT, DECLINE, or COUNTER" };
}

/**
 * Client responds to a creator's counter-offer.
 * action = "ACCEPT" → CLIENT_ACCEPTED, then caller should invoke holdEscrow.
 * action = "DECLINE" → CLIENT_DECLINED (terminal).
 */
export function clientRespondToCounter(db, { requestId, clientId, action }) {
  if (!requestId || !clientId || !action) return { ok: false, error: "missing_required_fields" };

  const req = db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(requestId);
  if (!req) return { ok: false, error: "request_not_found" };
  if (req.client_id !== clientId) return { ok: false, error: "not_authorized" };

  const now = nowISO();
  const upperAction = action.toUpperCase();

  if (upperAction === "ACCEPT") {
    assertTransition(req.status, "CLIENT_ACCEPTED");
    db.prepare("UPDATE commission_requests SET status = 'CLIENT_ACCEPTED', updated_at = ? WHERE id = ?").run(now, requestId);
    return { ok: true, status: "CLIENT_ACCEPTED", agreedPrice: req.agreed_price };
  }

  if (upperAction === "DECLINE") {
    assertTransition(req.status, "CLIENT_DECLINED");
    db.prepare("UPDATE commission_requests SET status = 'CLIENT_DECLINED', updated_at = ? WHERE id = ?").run(now, requestId);
    return { ok: true, status: "CLIENT_DECLINED" };
  }

  return { ok: false, error: "invalid_action", detail: "Must be ACCEPT or DECLINE" };
}

// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------

/**
 * Hold the agreed amount in escrow.
 * Transfers CC from the client to the __ESCROW__ account using the standard
 * transfer system. The escrow hold uses type "ESCROW_HOLD" which carries no
 * fee — fees are collected on release.
 *
 * Should be called after ACCEPTED or CLIENT_ACCEPTED, and transitions the
 * request to IN_PROGRESS.
 */
export function holdEscrow(db, { requestId, clientId, amount }) {
  if (!requestId || !clientId) return { ok: false, error: "missing_required_fields" };
  if (typeof amount !== "number" || amount <= 0) return { ok: false, error: "invalid_amount" };

  const req = db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(requestId);
  if (!req) return { ok: false, error: "request_not_found" };
  if (req.client_id !== clientId) return { ok: false, error: "not_authorized" };
  if (req.status !== "ACCEPTED" && req.status !== "CLIENT_ACCEPTED") {
    return { ok: false, error: "invalid_status", detail: `Cannot hold escrow in status ${req.status}` };
  }

  const refId = `escrow_hold:${requestId}`;

  // Transfer from client to escrow account — no fee on the hold itself
  const result = executeTransfer(db, {
    from: clientId,
    to: ESCROW_ACCOUNT,
    amount,
    type: "ESCROW_HOLD",
    metadata: { commissionRequestId: requestId },
    refId,
  });

  if (!result.ok) return result;

  // Transition to IN_PROGRESS and record the escrow transaction reference
  const now = nowISO();
  db.prepare(
    "UPDATE commission_requests SET status = 'IN_PROGRESS', escrow_tx_id = ?, updated_at = ? WHERE id = ?"
  ).run(result.batchId || refId, now, requestId);

  return { ok: true, status: "IN_PROGRESS", escrowTxId: result.batchId || refId };
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Creator delivers the commissioned work as a DTU.
 * Transitions: IN_PROGRESS → DELIVERED.
 */
export function deliverCommission(db, { requestId, creatorId, dtuId }) {
  if (!requestId || !creatorId || !dtuId) return { ok: false, error: "missing_required_fields" };

  const req = db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(requestId);
  if (!req) return { ok: false, error: "request_not_found" };
  if (req.creator_id !== creatorId) return { ok: false, error: "not_authorized" };

  assertTransition(req.status, "DELIVERED");

  const now = nowISO();
  db.prepare(
    "UPDATE commission_requests SET status = 'DELIVERED', delivered_dtu_id = ?, updated_at = ? WHERE id = ?"
  ).run(dtuId, now, requestId);

  return { ok: true, status: "DELIVERED", dtuId };
}

// ---------------------------------------------------------------------------
// Approval & Release
// ---------------------------------------------------------------------------

/**
 * Client approves the delivered work.
 * Releases escrow to the creator minus the 5.46% platform fee.
 * Transitions: DELIVERED → APPROVED.
 */
export function approveDelivery(db, { requestId, clientId }) {
  if (!requestId || !clientId) return { ok: false, error: "missing_required_fields" };

  const req = db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(requestId);
  if (!req) return { ok: false, error: "request_not_found" };
  if (req.client_id !== clientId) return { ok: false, error: "not_authorized" };

  assertTransition(req.status, "APPROVED");

  const refId = `escrow_release:${requestId}`;

  // Release escrow to creator — marketplace fee is deducted here
  const result = executeTransfer(db, {
    from: ESCROW_ACCOUNT,
    to: req.creator_id,
    amount: req.agreed_price,
    type: "MARKETPLACE_PURCHASE",
    metadata: { commissionRequestId: requestId, escrowRelease: true },
    refId,
  });

  if (!result.ok) return result;

  const now = nowISO();
  db.prepare(
    "UPDATE commission_requests SET status = 'APPROVED', updated_at = ? WHERE id = ?"
  ).run(now, requestId);

  const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", req.agreed_price);

  return { ok: true, status: "APPROVED", released: net, fee, gross: req.agreed_price };
}

// ---------------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------------

/**
 * Client disputes the delivered work. Escrow remains held until admin resolves.
 * Transitions: DELIVERED → DISPUTED.
 */
export function disputeDelivery(db, { requestId, clientId, reason }) {
  if (!requestId || !clientId) return { ok: false, error: "missing_required_fields" };

  const req = db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(requestId);
  if (!req) return { ok: false, error: "request_not_found" };
  if (req.client_id !== clientId) return { ok: false, error: "not_authorized" };

  assertTransition(req.status, "DISPUTED");

  const now = nowISO();
  db.prepare(
    "UPDATE commission_requests SET status = 'DISPUTED', updated_at = ? WHERE id = ?"
  ).run(now, requestId);

  // Record the dispute reason as a message for the review queue
  if (reason) {
    addCommissionMessage(db, {
      requestId,
      senderId: clientId,
      content: `[DISPUTE] ${reason}`,
    });
  }

  return { ok: true, status: "DISPUTED" };
}

/**
 * Admin resolves a dispute.
 *
 * resolution = "BUYER"  → refund escrow to client  (RESOLVED_BUYER)
 * resolution = "SELLER" → release escrow to creator (RESOLVED_SELLER)
 */
export function resolveDispute(db, { requestId, resolution, resolvedBy }) {
  if (!requestId || !resolution || !resolvedBy) {
    return { ok: false, error: "missing_required_fields" };
  }

  const req = db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(requestId);
  if (!req) return { ok: false, error: "request_not_found" };

  const upperRes = resolution.toUpperCase();

  if (upperRes === "BUYER") {
    assertTransition(req.status, "RESOLVED_BUYER");

    // Refund: transfer escrow back to client (no fee on refunds)
    const refId = `escrow_refund:${requestId}`;
    const result = executeTransfer(db, {
      from: ESCROW_ACCOUNT,
      to: req.client_id,
      amount: req.agreed_price,
      type: "ESCROW_REFUND",
      metadata: { commissionRequestId: requestId, resolvedBy, resolution: "BUYER" },
      refId,
    });
    if (!result.ok) return result;

    const now = nowISO();
    db.prepare(
      "UPDATE commission_requests SET status = 'RESOLVED_BUYER', updated_at = ? WHERE id = ?"
    ).run(now, requestId);

    return { ok: true, status: "RESOLVED_BUYER", refunded: req.agreed_price };
  }

  if (upperRes === "SELLER") {
    assertTransition(req.status, "RESOLVED_SELLER");

    // Release to creator with marketplace fee
    const refId = `escrow_release:${requestId}`;
    const result = executeTransfer(db, {
      from: ESCROW_ACCOUNT,
      to: req.creator_id,
      amount: req.agreed_price,
      type: "MARKETPLACE_PURCHASE",
      metadata: { commissionRequestId: requestId, resolvedBy, resolution: "SELLER", escrowRelease: true },
      refId,
    });
    if (!result.ok) return result;

    const now = nowISO();
    db.prepare(
      "UPDATE commission_requests SET status = 'RESOLVED_SELLER', updated_at = ? WHERE id = ?"
    ).run(now, requestId);

    const { fee, net } = calculateFee("MARKETPLACE_PURCHASE", req.agreed_price);
    return { ok: true, status: "RESOLVED_SELLER", released: net, fee };
  }

  return { ok: false, error: "invalid_resolution", detail: "Must be BUYER or SELLER" };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get a single commission request by ID, with computed fields.
 */
export function getCommissionRequest(db, requestId) {
  const row = db.prepare("SELECT * FROM commission_requests WHERE id = ?").get(requestId);
  if (!row) return null;
  return formatRequest(row);
}

/**
 * List a user's commissions filtered by role.
 * role = "client"  → commissions the user requested
 * role = "creator" → commissions the user was hired for
 */
export function getUserCommissions(db, userId, role = "client") {
  const column = role === "creator" ? "creator_id" : "client_id";
  const rows = db.prepare(
    `SELECT * FROM commission_requests WHERE ${column} = ? ORDER BY updated_at DESC`
  ).all(userId);
  return rows.map(formatRequest);
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

/**
 * Add a message to a commission request's conversation thread.
 * Only the client and creator of the request may send messages.
 */
export function addCommissionMessage(db, { requestId, senderId, content }) {
  if (!requestId || !senderId || !content) {
    return { ok: false, error: "missing_required_fields" };
  }

  // Verify sender is a participant (skip for system messages prefixed with [)
  if (!content.startsWith("[")) {
    const req = db.prepare("SELECT client_id, creator_id FROM commission_requests WHERE id = ?").get(requestId);
    if (!req) return { ok: false, error: "request_not_found" };
    if (req.client_id !== senderId && req.creator_id !== senderId) {
      return { ok: false, error: "not_authorized" };
    }
  }

  const id = uid("cmsg");
  const now = nowISO();

  db.prepare(
    "INSERT INTO commission_messages (id, request_id, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, requestId, senderId, content, now);

  return { ok: true, message: { id, requestId, senderId, content, createdAt: now } };
}

/**
 * Get all messages for a commission request, oldest first.
 */
export function getCommissionMessages(db, requestId) {
  return db.prepare(
    "SELECT * FROM commission_messages WHERE request_id = ? ORDER BY created_at ASC"
  ).all(requestId);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalize a DB row into a friendlier shape. */
function formatRequest(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    creatorId: row.creator_id,
    commissionTypeId: row.commission_type_id,
    brief: row.brief,
    agreedPrice: row.agreed_price,
    status: row.status,
    escrowTxId: row.escrow_tx_id,
    deliveredDtuId: row.delivered_dtu_id,
    licenseTier: row.license_tier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
