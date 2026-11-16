/**
 * server/tests/connective-tissue-loan-eligibility-authz.test.js
 *
 * GET /loan-eligibility/:userId (mounted at /api/ct and
 * /api/connective-tissue) returned any member's 0% loan tier, merit
 * total, balance, and max loan to any other signed-in member. Merit
 * stays public by product decision. Loan eligibility is private to
 * its owner.
 *
 * This suite mounts the real connectiveTissueRoutes (no server.js
 * boot), same recipe as connective-tissue-funds-source-authz.test.js,
 * with the real requireAuth from lib/role-gate.js:
 *   - owner reads own eligibility → 200 with the seeded tier/balance
 *   - another account → 403 and no eligibility fields
 *   - signed-out → 401 and no eligibility fields
 *   - a user id that does not exist → the same denial as a non-owner
 *   - GET merit for another user still → 200
 *   - sovereign role is not a bypass (this module has none)
 *   - AUTH_MODE=public with no req.user still reads the path id
 *
 * Run: node --test server/tests/connective-tissue-loan-eligibility-authz.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import connectiveTissueRoutes from "../routes/connective-tissue.js";
import { createRoleGate } from "../lib/role-gate.js";

const PREFIXES = ["/api/ct", "/api/connective-tissue"];

const OWNER = "owner-acct";
const OTHER = "other-acct";
const MISSING = "no-such-user";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT,
      amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete', metadata_json TEXT DEFAULT '{}',
      request_id TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), ref_id TEXT);
    CREATE TABLE merit_credit (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, activity_type TEXT NOT NULL, points INTEGER NOT NULL,
      lens_id TEXT, metadata_json TEXT, created_at TEXT NOT NULL);
  `);
  // Owner: 150 merit → silver; net credit 40 → maxLoan 80.
  db.prepare(`
    INSERT INTO merit_credit (id, user_id, activity_type, points, lens_id, metadata_json, created_at)
    VALUES ('mc-owner', ?, 'published_dtu', 150, 'code', '{}', datetime('now'))
  `).run(OWNER);
  db.prepare(`
    INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status)
    VALUES ('led-owner', 'CREDIT', NULL, ?, 40, 0, 40, 'complete')
  `).run(OWNER);
  // Other member: 600 merit → gold; net credit 200 → maxLoan 1000.
  // These values must never appear in a denied response.
  db.prepare(`
    INSERT INTO merit_credit (id, user_id, activity_type, points, lens_id, metadata_json, created_at)
    VALUES ('mc-other', ?, 'bounty_claimed', 600, 'questmarket', '{}', datetime('now'))
  `).run(OTHER);
  db.prepare(`
    INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status)
    VALUES ('led-other', 'CREDIT', NULL, ?, 200, 0, 200, 'complete')
  `).run(OTHER);
  return db;
}

function makeApp(db, authMode) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    if (uid) req.user = { id: uid, role: req.get("x-test-role") || "member" };
    next();
  });
  const { requireAuth } = createRoleGate(() => authMode);
  for (const prefix of PREFIXES) {
    app.use(prefix, connectiveTissueRoutes({ db, requireAuth }));
  }
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function get(base, path, { userId, role } = {}) {
  const headers = {};
  if (userId) headers["x-test-user-id"] = userId;
  if (role) headers["x-test-role"] = role;
  const res = await fetch(`${base}${path}`, { headers });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const ELIGIBILITY_KEYS = [
  "userId", "meritCredit", "tier", "eligible", "maxLoanAmount", "currentBalance", "breakdown",
];

function assertNoEligibility(body) {
  assert.equal(body.ok, false);
  assert.deepEqual(Object.keys(body).sort(), ["error", "ok"]);
  const blob = JSON.stringify(body);
  for (const key of ELIGIBILITY_KEYS) {
    assert.equal(Object.hasOwn(body, key), false, `denied body must not include ${key}`);
  }
  for (const secret of ["gold", "platinum", "silver", "bronze", "bounty_claimed", "published_dtu", "600", "1000"]) {
    assert.equal(blob.includes(secret), false, `denied body leaked ${secret}`);
  }
}

describe("loan eligibility is owner-only; merit stays public", () => {
  let db, server, base, publicServer, publicBase;

  before(async () => {
    db = createDb();
    server = await listen(makeApp(db, "jwt"));
    base = `http://127.0.0.1:${server.address().port}`;
    publicServer = await listen(makeApp(db, "public"));
    publicBase = `http://127.0.0.1:${publicServer.address().port}`;
  });

  after(() => {
    server?.close();
    publicServer?.close();
    db?.close();
  });

  for (const prefix of PREFIXES) {
    it(`${prefix}: owner reads own eligibility 200 with the seeded tier and balance`, async () => {
      const { status, body } = await get(base, `${prefix}/loan-eligibility/${OWNER}`, { userId: OWNER });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.userId, OWNER);
      assert.equal(body.meritCredit, 150);
      assert.equal(body.tier, "silver");
      assert.equal(body.eligible, true);
      assert.equal(body.currentBalance, 40);
      assert.equal(body.maxLoanAmount, 80);
      assert.deepEqual(body.breakdown, [
        { activity_type: "published_dtu", subtotal: 150, count: 1 },
      ]);
    });

    it(`${prefix}: another account is denied with no eligibility data`, async () => {
      const beforeLedger = db.prepare("SELECT COUNT(*) AS c FROM economy_ledger").get().c;
      const beforeMerit = db.prepare("SELECT COUNT(*) AS c FROM merit_credit").get().c;
      const { status, body } = await get(base, `${prefix}/loan-eligibility/${OTHER}`, { userId: OWNER });
      assert.equal(status, 403);
      assert.match(body.error, /unauthorized/);
      assertNoEligibility(body);
      assert.equal(db.prepare("SELECT COUNT(*) AS c FROM economy_ledger").get().c, beforeLedger);
      assert.equal(db.prepare("SELECT COUNT(*) AS c FROM merit_credit").get().c, beforeMerit);
    });

    it(`${prefix}: signed-out is 401 with no eligibility data`, async () => {
      const { status, body } = await get(base, `${prefix}/loan-eligibility/${OTHER}`);
      assert.equal(status, 401);
      assert.equal(body.ok, false);
      assert.equal(body.error, "Unauthorized");
      for (const key of ELIGIBILITY_KEYS) {
        assert.equal(Object.hasOwn(body, key), false, `401 body must not include ${key}`);
      }
    });

    it(`${prefix}: a nonexistent user id is denied exactly like a non-owner`, async () => {
      const other = await get(base, `${prefix}/loan-eligibility/${OTHER}`, { userId: OWNER });
      const missing = await get(base, `${prefix}/loan-eligibility/${MISSING}`, { userId: OWNER });
      assert.equal(other.status, 403);
      assert.equal(missing.status, 403);
      assert.deepEqual(missing.body, other.body);
      assertNoEligibility(missing.body);
    });

    it(`${prefix}: merit for another user still returns 200`, async () => {
      const { status, body } = await get(base, `${prefix}/merit/${OTHER}`, { userId: OWNER });
      assert.equal(status, 200);
      assert.equal(body.ok, true);
      assert.equal(body.userId, OTHER);
      assert.equal(body.total, 600);
      assert.deepEqual(body.breakdown, [
        { activity_type: "bounty_claimed", subtotal: 600, count: 1 },
      ]);
    });
  }

  it("a sovereign caller has no bypass on another member's eligibility", async () => {
    const { status, body } = await get(base, `/api/ct/loan-eligibility/${OTHER}`, {
      userId: OWNER,
      role: "sovereign",
    });
    assert.equal(status, 403);
    assertNoEligibility(body);
  });

  it("AUTH_MODE=public with no req.user still reads the path id", async () => {
    const { status, body } = await get(publicBase, `/api/ct/loan-eligibility/${OWNER}`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.userId, OWNER);
    assert.equal(body.tier, "silver");
    assert.equal(body.maxLoanAmount, 80);
  });
});
