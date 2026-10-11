// Wallet send clarity: recipient validation and a non-production test credit.
//
// Money movement stays on executePurchase / executeTransfer. This module only
// decides who a @username or email refers to, and whether a test-credit grant
// is allowed. It does not change fees, ledger shape, or withdrawal rules.
//
// Email existence: a match returns the same public card the social user
// search already returns (id + display name, never the email). A miss is
// always `unknown_user`, for a handle and for an email, including inactive
// accounts. Nothing in the payload says which kind of lookup failed.

import { randomUUID } from "crypto";
import { executePurchase } from "./transfer.js";
import { mintCoins } from "./coin-service.js";
import { economyAudit } from "./audit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENT_LEN = 254;

/** Gross CC per test grant. The token-purchase fee still applies. */
export const TEST_CREDIT_GROSS = 100;
/** How many grants one account may receive per rolling 24h. */
export const TEST_CREDIT_DAILY_GRANTS = 10;

/**
 * @param {string} raw
 * @returns {{ kind: 'empty' | 'invalid' | 'username' | 'email' | 'token', value?: string }}
 */
export function parseRecipient(raw) {
  if (typeof raw !== "string") return { kind: "empty" };
  const text = raw.trim();
  if (!text || text.length > MAX_RECIPIENT_LEN) return { kind: "empty" };
  if (text.startsWith("@")) {
    const username = text.slice(1).trim();
    if (!username || /\s/.test(username) || username.includes("@")) return { kind: "invalid" };
    return { kind: "username", value: username };
  }
  if (EMAIL_RE.test(text)) return { kind: "email", value: text };
  return { kind: "token", value: text };
}

function userColumns(db) {
  try {
    const rows = db.prepare("PRAGMA table_info(users)").all();
    return new Set(rows.map((c) => c.name));
  } catch {
    return new Set();
  }
}

function selectList(cols) {
  const fields = ["id", "username"];
  if (cols.has("display_name")) fields.push("display_name");
  return fields.join(", ");
}

function toPublic(row) {
  const named = row.display_name != null ? String(row.display_name).trim() : "";
  return { id: row.id, displayName: named || row.username };
}

function oneActive(db, cols, whereSql, param) {
  const rows = db.prepare(
    `SELECT ${selectList(cols)} FROM users WHERE is_active = 1 AND (${whereSql}) LIMIT 2`,
  ).all(param);
  return rows.length === 1 ? rows[0] : null;
}

function findUsername(db, cols, username) {
  const exact = oneActive(db, cols, "username = ?", username);
  if (exact) return exact;
  return oneActive(db, cols, "lower(username) = lower(?)", username);
}

function findEmail(db, cols, email) {
  return oneActive(db, cols, "lower(email) = lower(?)", email);
}

function findId(db, cols, id) {
  return oneActive(db, cols, "id = ?", id);
}

/**
 * Resolve a recipient for the confirm screen.
 * @username, an email, a bare username, or an active user id.
 * Unknown handles and unknown emails share one error.
 *
 * @returns {{ ok: true, user: { id: string, displayName: string } } | { ok: false, error: 'unknown_user' }}
 */
export function resolveTransferRecipient(db, raw) {
  const parsed = parseRecipient(raw);
  if (parsed.kind === "empty" || parsed.kind === "invalid" || !parsed.value) {
    return { ok: false, error: "unknown_user" };
  }
  const cols = userColumns(db);
  let row = null;
  if (parsed.kind === "email") row = findEmail(db, cols, parsed.value);
  else if (parsed.kind === "username") row = findUsername(db, cols, parsed.value);
  else {
    row = findUsername(db, cols, parsed.value) || findId(db, cols, parsed.value);
  }
  if (!row) return { ok: false, error: "unknown_user" };
  return { ok: true, user: toPublic(row) };
}

/**
 * Validation in front of executeTransfer.
 * @username and email must resolve to an active user id.
 * Any other token is the existing raw user-id path, unchanged.
 *
 * @returns {{ ok: true, id: string } | { ok: false, error: string }}
 */
export function coerceTransferRecipient(db, raw) {
  const parsed = parseRecipient(raw);
  if (parsed.kind === "empty") return { ok: false, error: "missing_recipient" };
  if (parsed.kind === "invalid") return { ok: false, error: "unknown_user" };
  if (parsed.kind === "token") return { ok: true, id: parsed.value };
  const resolved = resolveTransferRecipient(db, raw);
  if (!resolved.ok) return resolved;
  return { ok: true, id: resolved.user.id };
}

/**
 * Test credit is allowed when the process is not production, or when the
 * account row itself is flagged (role `test`, or is_test_account = 1 when
 * that column exists). A production account with neither flag is refused.
 * The caller's JWT role is not consulted — the users row is the flag.
 */
export function testCreditDecision({ nodeEnv, role, isTestAccount }) {
  if (nodeEnv !== "production") return { ok: true };
  if (role === "test" || isTestAccount === true) return { ok: true };
  return { ok: false, error: "test_credit_unavailable" };
}

export function loadAccountTestFlag(db, userId) {
  const cols = userColumns(db);
  if (!userId || !cols.has("id")) return { found: false, role: null, isTestAccount: false };
  const fields = ["role"];
  if (cols.has("is_test_account")) fields.push("is_test_account");
  let row = null;
  try {
    row = db.prepare(`SELECT ${fields.join(", ")} FROM users WHERE id = ?`).get(userId);
  } catch {
    return { found: false, role: null, isTestAccount: false };
  }
  if (!row) return { found: false, role: null, isTestAccount: false };
  const flaggedCol = cols.has("is_test_account") && Number(row.is_test_account) === 1;
  return { found: true, role: row.role || null, isTestAccount: flaggedCol };
}

function testCreditGrantCount(db, userId) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM economy_ledger
    WHERE to_user_id = ?
      AND type = 'TOKEN_PURCHASE'
      AND json_extract(metadata_json, '$.source') = 'test_credit'
      AND created_at >= ?
  `).get(userId, cutoff);
  return Number(row?.c || 0);
}

/**
 * Credit the caller only. Amount is fixed. Body-supplied user ids and
 * amounts are ignored by the route. Uses the token-purchase ledger path
 * (closed-loop CC, not withdrawable earnings) plus the same treasury mint
 * the admin purchase uses.
 */
export function grantTestCredit(db, { userId, nodeEnv, requestId, ip }) {
  if (!userId) return { ok: false, status: 401, error: "unauthorized" };
  const flag = loadAccountTestFlag(db, userId);
  const decision = testCreditDecision({
    nodeEnv,
    role: flag.role,
    isTestAccount: flag.isTestAccount,
  });
  if (!decision.ok) {
    return { ok: false, status: 403, error: "test_credit_unavailable" };
  }
  if (testCreditGrantCount(db, userId) >= TEST_CREDIT_DAILY_GRANTS) {
    return { ok: false, status: 429, error: "test_credit_cap" };
  }

  const result = executePurchase(db, {
    userId,
    amount: TEST_CREDIT_GROSS,
    metadata: { source: "test_credit" },
    refId: `test_credit:${userId}:${Date.now()}:${randomUUID()}`,
    requestId,
    ip,
  });
  if (!result.ok) return { ok: false, status: 400, error: result.error || "test_credit_failed" };

  const mintResult = mintCoins(db, {
    amount: TEST_CREDIT_GROSS,
    userId,
    refId: `test_credit_mint:${result.batchId}`,
    requestId,
    ip,
  });

  return {
    ok: true,
    status: 200,
    gross: TEST_CREDIT_GROSS,
    net: result.net,
    batchId: result.batchId,
    treasuryMinted: mintResult.ok === true,
  };
}

export function testCreditAvailability(db, { userId, nodeEnv }) {
  if (!userId) return { ok: false, status: 401, error: "unauthorized", available: false };
  const flag = loadAccountTestFlag(db, userId);
  const decision = testCreditDecision({
    nodeEnv,
    role: flag.role,
    isTestAccount: flag.isTestAccount,
  });
  return {
    ok: true,
    status: 200,
    available: decision.ok === true,
    gross: decision.ok ? TEST_CREDIT_GROSS : null,
  };
}

/**
 * @param {import('express').Express} app
 * @param {import('better-sqlite3').Database} db
 * @param {{ log?: Function }} [opts]
 */
export function attachWalletClarityRoutes(app, db, opts = {}) {
  const log = opts.log || ((level, event, data) => {
    console[level === "error" ? "error" : "log"](`[economy] ${event}`, data);
  });

  app.get("/api/economy/resolve-recipient", (req, res) => {
    try {
      if (!req.user?.id) return res.status(401).json({ ok: false, error: "unauthorized" });
      const q = typeof req.query?.q === "string" ? req.query.q : "";
      const resolved = resolveTransferRecipient(db, q);
      if (!resolved.ok) return res.json({ ok: false, error: "unknown_user" });
      return res.json({
        ok: true,
        user: { id: resolved.user.id, displayName: resolved.user.displayName },
      });
    } catch (err) {
      log("error", "resolve_recipient_failed", { error: err.message });
      return res.status(500).json({ ok: false, error: "resolve_failed" });
    }
  });

  app.get("/api/economy/test-credit", (req, res) => {
    try {
      const result = testCreditAvailability(db, {
        userId: req.user?.id,
        nodeEnv: process.env.NODE_ENV,
      });
      if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
      return res.json({ ok: true, available: result.available, gross: result.gross });
    } catch (err) {
      log("error", "test_credit_status_failed", { error: err.message });
      return res.status(500).json({ ok: false, error: "test_credit_failed" });
    }
  });

  app.post("/api/economy/test-credit", (req, res) => {
    try {
      const result = grantTestCredit(db, {
        userId: req.user?.id,
        nodeEnv: process.env.NODE_ENV,
        requestId: req.headers["x-request-id"] || null,
        ip: req.ip,
      });
      if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
      economyAudit(db, {
        action: "test_credit",
        userId: req.user.id,
        amount: result.gross,
        txId: result.batchId,
        requestId: req.headers["x-request-id"] || null,
        ip: req.ip,
        details: { net: result.net, source: "test_credit" },
      });
      return res.json({
        ok: true,
        gross: result.gross,
        net: result.net,
        batchId: result.batchId,
      });
    } catch (err) {
      log("error", "test_credit_failed", { error: err.message });
      return res.status(500).json({ ok: false, error: "test_credit_failed" });
    }
  });
}
