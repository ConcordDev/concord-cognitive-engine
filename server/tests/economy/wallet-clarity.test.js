/**
 * Wallet send clarity.
 *
 * Recipient resolution is validation in front of the existing transfer:
 * @username and email become an active user id; a raw id still passes
 * through. Unknown handles and unknown emails share one body, and the
 * email address is never returned.
 *
 * Test credit mints only when NODE_ENV is not production, or the users
 * row is flagged (role = 'test' or is_test_account = 1). A production
 * account with neither flag cannot mint, including by naming another
 * user or an amount in the body.
 *
 * Run: node --test server/tests/economy/wallet-clarity.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import Database from "better-sqlite3";

import { registerEconomyRoutes } from "../../economy/routes.js";
import { getBalance } from "../../economy/balances.js";
import { executePurchase } from "../../economy/transfer.js";
import { TEST_CREDIT_DAILY_GRANTS, TEST_CREDIT_GROSS } from "../../economy/wallet-clarity.js";

const HIDDEN_EMAIL = "hidden-inbox@example.com";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      is_active INTEGER NOT NULL DEFAULT 1,
      display_name TEXT,
      is_test_account INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      from_user_id TEXT,
      to_user_id TEXT,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete',
      metadata_json TEXT DEFAULT '{}',
      request_id TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ref_id TEXT
    );
    CREATE TABLE treasury (
      id TEXT PRIMARY KEY,
      total_usd REAL NOT NULL DEFAULT 0,
      total_coins REAL NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE treasury_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      amount REAL NOT NULL,
      usd_before REAL NOT NULL,
      usd_after REAL NOT NULL,
      coins_before REAL NOT NULL,
      coins_after REAL NOT NULL,
      ref_id TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO treasury (id, total_usd, total_coins, updated_at)
      VALUES ('treasury_main', 0, 0, datetime('now'));
  `);
  const insert = db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, is_active, display_name, is_test_account)
    VALUES (@id, @username, @email, 'x', @role, @isActive, @displayName, @isTest)
  `);
  const people = [
    { id: "user_ada", username: "ada", email: HIDDEN_EMAIL, role: "member", isActive: 1, displayName: "Ada Lovelace", isTest: 0 },
    { id: "user_sender", username: "sender", email: "sender@example.com", role: "member", isActive: 1, displayName: "Sender", isTest: 0 },
    { id: "user_gone", username: "gone", email: "gone@example.com", role: "member", isActive: 0, displayName: "Gone", isTest: 0 },
    { id: "user_member", username: "member", email: "member@example.com", role: "member", isActive: 1, displayName: "Member", isTest: 0 },
    { id: "user_role_test", username: "roletest", email: "roletest@example.com", role: "test", isActive: 1, displayName: "Role Test", isTest: 0 },
    { id: "user_flagged", username: "flagged", email: "flagged@example.com", role: "member", isActive: 1, displayName: "Flagged", isTest: 1 },
    { id: "user_capped", username: "capped", email: "capped@example.com", role: "member", isActive: 1, displayName: "Capped", isTest: 0 },
  ];
  for (const person of people) insert.run(person);
  return db;
}

function ledgerCount(db) {
  return db.prepare("SELECT COUNT(*) AS c FROM economy_ledger").get().c;
}

function creditedTo(db, userId) {
  return db.prepare(
    "SELECT COUNT(*) AS c FROM economy_ledger WHERE to_user_id = ?",
  ).get(userId).c;
}

async function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

async function hit(base, path, { method = "GET", user, role, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
      ...(role ? { "x-test-role": role } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

describe("wallet clarity", { concurrency: false }, () => {
  let db;
  let server;
  let base;
  const priorEnv = process.env.NODE_ENV;

  before(async () => {
    db = createDb();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const id = req.headers["x-test-user"];
      if (typeof id === "string" && id) {
        const role = req.headers["x-test-role"];
        req.user = { id, role: typeof role === "string" ? role : "member" };
      }
      next();
    });
    registerEconomyRoutes(app, db, { structuredLog() {} });
    ({ server, base } = await listen(app));
  });

  after(async () => {
    process.env.NODE_ENV = priorEnv;
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  it("@username resolves to the display name and does not return the email", async () => {
    process.env.NODE_ENV = "test";
    const { status, json } = await hit(base, "/api/economy/resolve-recipient?q=%40Ada", { user: "user_sender" });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(Object.keys(json.user).sort(), ["displayName", "id"]);
    assert.equal(json.user.id, "user_ada");
    assert.equal(json.user.displayName, "Ada Lovelace");
    assert.equal(JSON.stringify(json).includes(HIDDEN_EMAIL), false);
    assert.equal("email" in json.user, false);
  });

  it("an email resolves to the same public card, with the address omitted", async () => {
    const { status, json } = await hit(
      base,
      `/api/economy/resolve-recipient?q=${encodeURIComponent(HIDDEN_EMAIL)}`,
      { user: "user_sender" },
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.user.id, "user_ada");
    assert.equal(json.user.displayName, "Ada Lovelace");
    assert.deepEqual(Object.keys(json.user).sort(), ["displayName", "id"]);
    assert.equal(JSON.stringify(json).includes(HIDDEN_EMAIL), false);
  });

  it("unknown @username and unknown email return the same error", async () => {
    const byHandle = await hit(base, "/api/economy/resolve-recipient?q=%40nobody", { user: "user_sender" });
    const byEmail = await hit(
      base,
      "/api/economy/resolve-recipient?q=nobody%40example.com",
      { user: "user_sender" },
    );
    const unknown = { ok: false, error: "unknown_user" };
    assert.equal(byHandle.status, 200);
    assert.equal(byEmail.status, 200);
    assert.deepEqual(byHandle.json, unknown);
    assert.deepEqual(byEmail.json, unknown);
  });

  it("an inactive account is the same unknown-user error", async () => {
    const { status, json } = await hit(base, "/api/economy/resolve-recipient?q=%40gone", { user: "user_sender" });
    assert.equal(status, 200);
    assert.deepEqual(json, { ok: false, error: "unknown_user" });
  });

  it("resolve requires a signed-in caller", async () => {
    const { status, json } = await hit(base, "/api/economy/resolve-recipient?q=%40ada");
    assert.equal(status, 401);
    assert.equal(json.ok, false);
  });

  it("transfer to an unknown email does not write the ledger", async () => {
    process.env.NODE_ENV = "test";
    const before = ledgerCount(db);
    const { status, json } = await hit(base, "/api/economy/transfer", {
      method: "POST",
      user: "user_sender",
      body: { to: "nobody@example.com", amount: 10 },
    });
    assert.equal(status, 400);
    assert.deepEqual(json, { ok: false, error: "unknown_user" });
    assert.equal(ledgerCount(db), before);
  });

  it("@username on transfer credits the resolved user id", async () => {
    executePurchase(db, { userId: "user_sender", amount: 100, metadata: { source: "seed" } });
    const { status, json } = await hit(base, "/api/economy/transfer", {
      method: "POST",
      user: "user_sender",
      body: { to: "@ada", amount: 10 },
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.to, "user_ada");
    assert.equal(getBalance(db, "user_ada").balance, 9.85);
    assert.equal(creditedTo(db, "@ada"), 0);
    assert.equal(JSON.stringify(json).includes(HIDDEN_EMAIL), false);
  });

  it("a raw user id still transfers without a users-row lookup rewrite", async () => {
    const { status, json } = await hit(base, "/api/economy/transfer", {
      method: "POST",
      user: "user_sender",
      body: { to: "legacy_bob", amount: 10 },
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.to, "legacy_bob");
    assert.equal(getBalance(db, "legacy_bob").balance, 9.85);
  });

  it("production refuses test credit for a normal account, ignoring body targets", async () => {
    process.env.NODE_ENV = "production";
    const before = ledgerCount(db);
    const { status, json } = await hit(base, "/api/economy/test-credit", {
      method: "POST",
      user: "user_member",
      role: "test",
      body: { user_id: "user_flagged", amount: 1_000_000 },
    });
    assert.equal(status, 403);
    assert.deepEqual(json, { ok: false, error: "test_credit_unavailable" });
    assert.equal(ledgerCount(db), before);
    assert.equal(getBalance(db, "user_member").balance, 0);
    assert.equal(getBalance(db, "user_flagged").balance, 0);

    const probe = await hit(base, "/api/economy/test-credit", { user: "user_member", role: "test" });
    assert.equal(probe.status, 200);
    assert.deepEqual(probe.json, { ok: true, available: false, gross: null });
  });

  it("production allows test credit when the users.role is test", async () => {
    process.env.NODE_ENV = "production";
    const { status, json } = await hit(base, "/api/economy/test-credit", {
      method: "POST",
      user: "user_role_test",
      role: "member",
      body: {},
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.gross, TEST_CREDIT_GROSS);
    assert.equal(json.net, 98.54);
    assert.equal(getBalance(db, "user_role_test").balance, 98.54);
  });

  it("production allows test credit when is_test_account is set", async () => {
    process.env.NODE_ENV = "production";
    const { status, json } = await hit(base, "/api/economy/test-credit", {
      method: "POST",
      user: "user_flagged",
      body: { amount: 5000 },
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.gross, TEST_CREDIT_GROSS);
    assert.equal(getBalance(db, "user_flagged").balance, 98.54);
  });

  it("non-production allows a normal account to grant test credit to itself only", async () => {
    process.env.NODE_ENV = "test";
    const { status, json } = await hit(base, "/api/economy/test-credit", {
      method: "POST",
      user: "user_member",
      body: { user_id: "user_ada", amount: 1_000_000 },
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.net, 98.54);
    assert.equal(getBalance(db, "user_member").balance, 98.54);
    assert.equal(getBalance(db, "user_ada").balance, 9.85);
  });

  it("test credit stops after the daily grant cap", async () => {
    process.env.NODE_ENV = "test";
    for (let i = 0; i < TEST_CREDIT_DAILY_GRANTS; i++) {
      const granted = await hit(base, "/api/economy/test-credit", {
        method: "POST",
        user: "user_capped",
        body: {},
      });
      assert.equal(granted.status, 200, `grant ${i + 1} should succeed`);
    }
    const blocked = await hit(base, "/api/economy/test-credit", {
      method: "POST",
      user: "user_capped",
      body: {},
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.error, "test_credit_cap");
    assert.equal(getBalance(db, "user_capped").balance, 985.4);
  });
});
