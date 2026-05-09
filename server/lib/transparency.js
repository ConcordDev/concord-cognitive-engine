// lib/transparency.js
// Law Enforcement Transparency — Request Tracking & Annual Reports
//
// Concord tracks every law enforcement request and publishes annual
// transparency reports. We do not voluntarily participate in surveillance,
// provide bulk data access, or build backdoors. Period.

import { randomUUID } from "crypto";

function uid(prefix = "legal") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

const VALID_TYPES = ["subpoena", "court_order", "warrant", "national_security"];
const VALID_RESPONSES = ["pending", "complied", "challenged", "partial", "rejected"];

// ═══════════════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════════════

function ensureTable(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS legal_requests (
      id              TEXT PRIMARY KEY,
      type            TEXT NOT NULL CHECK(type IN ('subpoena','court_order','warrant','national_security')),
      jurisdiction    TEXT NOT NULL,
      date_received   TEXT NOT NULL,
      data_requested  TEXT NOT NULL DEFAULT '',
      users_affected  INTEGER NOT NULL DEFAULT 0,
      response        TEXT NOT NULL DEFAULT 'pending' CHECK(response IN ('pending','complied','challenged','partial','rejected')),
      response_date   TEXT,
      notified_user   INTEGER NOT NULL DEFAULT 0,
      gagged          INTEGER NOT NULL DEFAULT 0,
      notes           TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL
    )
  `).run();
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LOG LEGAL REQUEST
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a new legal request (subpoena, court order, warrant, NSL, etc.).
 *
 * @param {object} db  better-sqlite3 database
 * @param {object} request
 * @returns {{ ok: boolean, id?: string, error?: string }}
 */
export function logLegalRequest(db, request) {
  ensureTable(db);

  const {
    type,
    jurisdiction,
    dateReceived,
    dataRequested = "",
    usersAffected = 0,
    gagged = false,
    notes = "",
  } = request || {};

  if (!type || !VALID_TYPES.includes(type)) {
    return { ok: false, error: "invalid_type", validTypes: VALID_TYPES };
  }
  if (!jurisdiction) {
    return { ok: false, error: "missing_jurisdiction" };
  }
  if (!dateReceived) {
    return { ok: false, error: "missing_date_received" };
  }

  const id = uid("legal");
  const now = nowISO();

  db.prepare(`
    INSERT INTO legal_requests
      (id, type, jurisdiction, date_received, data_requested, users_affected, response, response_date, notified_user, gagged, notes, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, 'pending', NULL, 0, ?, ?, ?, ?)
  `).run(
    id,
    type,
    jurisdiction,
    dateReceived,
    dataRequested,
    usersAffected,
    gagged ? 1 : 0,
    notes,
    now,
    now,
  );

  return { ok: true, id };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. UPDATE LEGAL REQUEST
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Update the response status of an existing legal request.
 *
 * @param {object} db
 * @param {string} requestId
 * @param {object} updates  — { response, responseDate, notifiedUser, notes }
 * @returns {{ ok: boolean, error?: string }}
 */
export function updateLegalRequest(db, requestId, updates) {
  ensureTable(db);

  if (!requestId) return { ok: false, error: "missing_request_id" };

  const existing = db.prepare("SELECT id FROM legal_requests WHERE id = ?").get(requestId);
  if (!existing) return { ok: false, error: "not_found" };

  const { response, responseDate, notifiedUser, notes } = updates || {};

  if (response && !VALID_RESPONSES.includes(response)) {
    return { ok: false, error: "invalid_response", validResponses: VALID_RESPONSES };
  }

  const sets = [];
  const params = [];

  if (response !== undefined) {
    sets.push("response = ?");
    params.push(response);
  }
  if (responseDate !== undefined) {
    sets.push("response_date = ?");
    params.push(responseDate);
  }
  if (notifiedUser !== undefined) {
    sets.push("notified_user = ?");
    params.push(notifiedUser ? 1 : 0);
  }
  if (notes !== undefined) {
    sets.push("notes = ?");
    params.push(notes);
  }

  if (sets.length === 0) return { ok: false, error: "no_updates" };

  sets.push("updated_at = ?");
  params.push(nowISO());
  params.push(requestId);

  db.prepare(`UPDATE legal_requests SET ${sets.join(", ")} WHERE id = ?`).run(...params);

  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. GENERATE TRANSPARENCY REPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate the annual transparency report for a given year.
 * This is the public-facing data — no identifying details, just counts.
 *
 * @param {object} db
 * @param {number|string} year
 * @returns {{ ok: boolean, report?: object, error?: string }}
 */
export function generateTransparencyReport(db, year) {
  ensureTable(db);

  const yr = Number(year);
  if (!yr || yr < 2000 || yr > 2100) {
    return { ok: false, error: "invalid_year" };
  }

  const yearPrefix = `${yr}`;
  const rows = db.prepare(
    "SELECT * FROM legal_requests WHERE date_received LIKE ? || '%'"
  ).all(yearPrefix);

  const totalRequests = rows.length;

  // By type
  const byType = {};
  for (const t of VALID_TYPES) byType[t] = 0;
  for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;

  // By response
  const byResponse = {};
  for (const resp of VALID_RESPONSES) byResponse[resp] = 0;
  for (const r of rows) byResponse[r.response] = (byResponse[r.response] || 0) + 1;

  // Aggregate counts
  const usersAffected = rows.reduce((sum, r) => sum + (r.users_affected || 0), 0);
  const usersNotified = rows.filter((r) => r.notified_user === 1).length;
  const gagOrders = rows.filter((r) => r.gagged === 1).length;

  const report = {
    year: yr,
    totalRequests,
    byType,
    byResponse,
    usersAffected,
    usersNotified,
    gagOrders,
    concordCommitments: {
      noVoluntarySurveillance: true,
      noBulkDataAccess: true,
      noBackdoors: true,
      minimumDataProvided: true,
      challengedOverbroadRequests: true,
    },
    publishedAt: nowISO(),
  };

  return { ok: true, report };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. GET LEGAL REQUESTS (Admin Query)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Admin query for legal requests with optional filters and pagination.
 *
 * @param {object} db
 * @param {object} filters — { type, response, year, gagged, limit, offset }
 * @returns {{ ok: boolean, requests: object[], total: number }}
 */
export function getLegalRequests(db, filters = {}) {
  ensureTable(db);

  const { type, response, year, gagged, limit = 50, offset = 0 } = filters;

  const wheres = [];
  const params = [];

  if (type && VALID_TYPES.includes(type)) {
    wheres.push("type = ?");
    params.push(type);
  }
  if (response && VALID_RESPONSES.includes(response)) {
    wheres.push("response = ?");
    params.push(response);
  }
  if (year) {
    wheres.push("date_received LIKE ? || '%'");
    params.push(String(year));
  }
  if (gagged !== undefined && gagged !== null) {
    wheres.push("gagged = ?");
    params.push(gagged ? 1 : 0);
  }

  const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

  const total = db.prepare(
    `SELECT COUNT(*) as c FROM legal_requests ${whereClause}`
  ).get(...params)?.c || 0;

  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
  const safeOffset = Math.max(0, Number(offset) || 0);

  const requests = db.prepare(
    `SELECT * FROM legal_requests ${whereClause} ORDER BY date_received DESC LIMIT ? OFFSET ?`
  ).all(...params, safeLimit, safeOffset);

  return { ok: true, requests, total };
}
