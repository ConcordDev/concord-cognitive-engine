/**
 * server/tests/connective-tissue-funds-source-authz.test.js
 *
 * Security audit 2026-07-30 — real money theft, found by re-checking for the
 * same req.body-as-identity pattern already fixed on /api/ingest/submit and
 * the DTU tier-mutation routes.
 *
 * Every money-moving route in routes/connective-tissue.js read the
 * FUNDS-SOURCE identity straight off the request body, with requireAuth()
 * only checking that *some* session was valid — never that it belonged to
 * the id footing the bill. executeTransfer() (economy/transfer.js) has no
 * caller-identity check of its own by design, so this was the only place
 * the check could happen, and it wasn't:
 *
 *  - POST /tip: tipperId (payer) unchecked → drain any victim's wallet by
 *    tipping yourself with tipperId: <victim>, creatorId: <attacker>.
 *  - POST /bounties: posterId (payer, escrowed) unchecked → escrow a
 *    victim's funds into a bounty only the attacker can later claim.
 *  - POST /bounties/:id/claim: claimerId (payee) unchecked, and the only
 *    other check (posterId matching the bounty record) is public
 *    information off GET /bounties — the worst of the four, since it needs
 *    no setup at all: copy any open bounty's id + real posterId and claim
 *    its full reward with an arbitrary claimerId + solutionDtuId. No
 *    solution verification exists at all.
 *  - POST /dtu/purchase: buyerId (payer) unchecked → force a victim to
 *    "buy" a DTU that pays the victim's coins into the attacker's account.
 *
 * Fix: a shared requireSelf(bodyField) middleware rejects with 403 whenever
 * the body's claimed identity doesn't match req.user.id. It intentionally
 * no-ops when req.user is absent (AUTH_MODE=public / local-first
 * single-user mode, where requireAuth() itself already lets the request
 * through with no req.user — there's only one real user in that
 * deployment, so any claimed id is legitimate).
 *
 * This test boots a real in-memory SQLite db (same tables the
 * migration/economy layer actually uses) and mounts the real
 * connectiveTissueRoutes, proving both that a mismatched identity is
 * rejected with NO money movement, and that the legitimate matching-self
 * case still works end-to-end (no functional regression).
 *
 * Run: node --test server/tests/connective-tissue-funds-source-authz.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import connectiveTissueRoutes from "../routes/connective-tissue.js";
import { getBalance } from "../economy/balances.js";
import { executePurchase } from "../economy/transfer.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, from_user_id TEXT, to_user_id TEXT,
      amount REAL NOT NULL, fee REAL NOT NULL DEFAULT 0, net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete', metadata_json TEXT DEFAULT '{}',
      request_id TEXT, ip TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), ref_id TEXT);
    CREATE TABLE treasury (
      id TEXT PRIMARY KEY, total_usd REAL NOT NULL DEFAULT 0, total_coins REAL NOT NULL DEFAULT 0,
      updated_at TEXT);
    CREATE TABLE treasury_events (
      id TEXT PRIMARY KEY, event_type TEXT, amount REAL, usd_before REAL, usd_after REAL,
      coins_before REAL, coins_after REAL, ref_id TEXT, metadata_json TEXT, created_at TEXT);
    INSERT INTO treasury (id, total_usd, total_coins, updated_at) VALUES ('treasury_main', 0, 0, datetime('now'));
    CREATE TABLE tips (
      id TEXT PRIMARY KEY, tipper_id TEXT NOT NULL, creator_id TEXT NOT NULL,
      content_id TEXT NOT NULL, content_type TEXT DEFAULT 'unknown', lens_id TEXT DEFAULT 'unknown',
      amount REAL NOT NULL, ledger_ref_id TEXT, created_at TEXT NOT NULL);
    CREATE TABLE bounties (
      id TEXT PRIMARY KEY, poster_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT DEFAULT '',
      lens_id TEXT DEFAULT 'questmarket', amount REAL NOT NULL, tags_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'OPEN', escrow_ref_id TEXT, claimed_by TEXT, solution_dtu_id TEXT,
      expires_at TEXT, claimed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE merit_credit (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, activity_type TEXT NOT NULL, points INTEGER NOT NULL,
      lens_id TEXT, metadata_json TEXT, created_at TEXT NOT NULL);
    CREATE TABLE dtu_ownership (
      id TEXT PRIMARY KEY, dtu_id TEXT NOT NULL, owner_id TEXT NOT NULL, acquired_via TEXT DEFAULT 'CREATED',
      purchase_amount REAL, ledger_ref_id TEXT, created_at TEXT NOT NULL, UNIQUE(dtu_id, owner_id));
  `);
  return db;
}

function makeApp(db) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user-id");
    if (uid) req.user = { id: uid };
    next();
  });
  const requireAuth = () => (req, res, next) => {
    if (!req.user) return res.status(401).json({ ok: false, error: "Unauthorized" });
    next();
  };
  app.use("/api/connective-tissue", connectiveTissueRoutes({ db, requireAuth }));
  return app;
}

async function post(app, path, body, callerId) {
  const server = app.listen(0);
  const port = server.address().port;
  try {
    const headers = { "content-type": "application/json" };
    if (callerId) headers["x-test-user-id"] = callerId;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe("POST /api/connective-tissue/tip — funds source must be the caller", () => {
  let db, app;
  beforeEach(() => {
    db = createDb();
    executePurchase(db, { userId: "victim", amount: 1000 });
    executePurchase(db, { userId: "attacker", amount: 1000 });
    app = makeApp(db);
  });

  it("rejects tipperId != caller with 403, and moves NO money", async () => {
    const before = getBalance(db, "victim").balance;
    const { status, body } = await post(
      app,
      "/api/connective-tissue/tip",
      { tipperId: "victim", creatorId: "attacker", contentId: "c1", contentType: "dtu", lensId: "l1", amount: 500 },
      "attacker"
    );
    assert.equal(status, 403);
    assert.match(body.error, /unauthorized/);
    assert.equal(getBalance(db, "victim").balance, before, "victim's wallet must be untouched");
  });

  it("allows a caller tipping with their OWN tipperId — no functional regression", async () => {
    const { status, body } = await post(
      app,
      "/api/connective-tissue/tip",
      { tipperId: "attacker", creatorId: "victim", contentId: "c1", contentType: "dtu", lensId: "l1", amount: 100 },
      "attacker"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

describe("POST /api/connective-tissue/bounties — poster (escrow payer) must be the caller", () => {
  let db, app;
  beforeEach(() => {
    db = createDb();
    executePurchase(db, { userId: "victim", amount: 1000 });
    executePurchase(db, { userId: "attacker", amount: 1000 });
    app = makeApp(db);
  });

  it("rejects posterId != caller with 403, and escrows NO money", async () => {
    const before = getBalance(db, "victim").balance;
    const { status, body } = await post(
      app,
      "/api/connective-tissue/bounties",
      { posterId: "victim", title: "do a thing", lensId: "questmarket", amount: 500 },
      "attacker"
    );
    assert.equal(status, 403);
    assert.match(body.error, /unauthorized/);
    assert.equal(getBalance(db, "victim").balance, before, "victim's wallet must be untouched");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM bounties").get().c, 0, "no bounty must be created");
  });

  it("allows a caller posting with their OWN posterId", async () => {
    const { status, body } = await post(
      app,
      "/api/connective-tissue/bounties",
      { posterId: "attacker", title: "do a thing", lensId: "questmarket", amount: 100 },
      "attacker"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

describe("POST /api/connective-tissue/bounties/:id/claim — claimer (payee) must be the caller", () => {
  let db, app, bountyId;
  beforeEach(async () => {
    db = createDb();
    executePurchase(db, { userId: "poster", amount: 1000 });
    executePurchase(db, { userId: "attacker", amount: 1000 });
    app = makeApp(db);
    const { body } = await post(
      app,
      "/api/connective-tissue/bounties",
      { posterId: "poster", title: "do a thing", lensId: "questmarket", amount: 300 },
      "poster"
    );
    bountyId = body.bounty.id;
  });

  it("rejects claiming a bounty AS the real innocent bystander, no payout occurs", async () => {
    // This is the worst of the four: the attacker knows the real bountyId and
    // posterId (both public via GET /bounties) and needs nothing else to try
    // to steal the reward — except it now must claim as ITSELF, not as an
    // arbitrary claimerId.
    const bystanderBefore = getBalance(db, "bystander").balance;
    const { status, body } = await post(
      app,
      `/api/connective-tissue/bounties/${bountyId}/claim`,
      { claimerId: "bystander", posterId: "poster", solutionDtuId: "d1" },
      "attacker"
    );
    assert.equal(status, 403);
    assert.match(body.error, /unauthorized/);
    assert.equal(getBalance(db, "bystander").balance, bystanderBefore);
    assert.equal(db.prepare("SELECT status FROM bounties WHERE id = ?").get(bountyId).status, "OPEN");
  });

  it("a self-matching claimerId succeeds and pays the FULL bounty amount", async () => {
    // This used to only be checkable as "not rejected by the auth gate" —
    // postBounty escrowed via a fee-charging TRANSFER, so a real claim
    // always failed downstream with insufficient_balance regardless of
    // identity. That bug is now fixed separately (migration 399: BOUNTY_
    // ESCROW/BOUNTY_CLAIM are fee-exempt ledger types, see
    // economy/lens-economy-wiring.js + tests/economy/ledger-conservation.
    // test.js), so this now asserts the real, full end-to-end success this
    // authorization fix was always supposed to allow through.
    const before = getBalance(db, "attacker").balance;
    const { status, body } = await post(
      app,
      `/api/connective-tissue/bounties/${bountyId}/claim`,
      { claimerId: "attacker", posterId: "poster", solutionDtuId: "d1" },
      "attacker"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true, `claim must succeed: ${body.error}`);
    assert.equal(Math.round((getBalance(db, "attacker").balance - before) * 100) / 100, 300, "claimer must receive the FULL posted 300, not a fee-shrunk fraction");
  });
});

describe("POST /api/connective-tissue/dtu/purchase — buyer (payer) must be the caller", () => {
  let db, app;
  beforeEach(() => {
    db = createDb();
    executePurchase(db, { userId: "victim", amount: 1000 });
    executePurchase(db, { userId: "attacker", amount: 1000 });
    app = makeApp(db);
  });

  it("rejects buyerId != caller with 403, and moves NO money", async () => {
    const before = getBalance(db, "victim").balance;
    const { status, body } = await post(
      app,
      "/api/connective-tissue/dtu/purchase",
      { buyerId: "victim", dtuId: "d1", sellerId: "attacker", amount: 500, lensId: "l1" },
      "attacker"
    );
    assert.equal(status, 403);
    assert.match(body.error, /unauthorized/);
    assert.equal(getBalance(db, "victim").balance, before, "victim's wallet must be untouched");
  });

  it("allows a caller buying with their OWN buyerId", async () => {
    const { status, body } = await post(
      app,
      "/api/connective-tissue/dtu/purchase",
      { buyerId: "attacker", dtuId: "d1", sellerId: "victim", amount: 100, lensId: "l1" },
      "attacker"
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});
