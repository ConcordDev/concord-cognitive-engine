/**
 * Tier-2 contract test — treasury mint/burn preserve the caller's audit trail.
 *
 * Seeded by a real defect found 2026-07-25 by the new
 * `unused-destructured-param` detector: `mintCoins(db, { amount, userId,
 * refId, requestId, ip })` and `burnCoins(...)` both DESTRUCTURED
 * `requestId` and `ip` and then referenced neither anywhere in the file.
 *
 * That was not a vestigial signature. All three real callers pass them:
 *   - server/economy/stripe.js  — the Stripe webhook mint
 *   - server/economy/routes.js  — the admin mint
 *   - server/economy/stripe.js  — the fiat withdrawal burn
 *
 * So the three most audit-sensitive paths on the money system each handed
 * over a request correlation id and an originating IP that went straight on
 * the floor, leaving `treasury_events` rows un-correlatable with the request
 * that caused them — exactly the link an incident investigation needs.
 *
 * `treasury_events` (migration 008) has no request_id/ip columns, so the
 * fields ride in `metadata_json`, the column that exists to carry per-event
 * context. This test pins BOTH directions:
 *   - present  → persisted and readable
 *   - absent   → payload stays byte-identical to the historical
 *                `{"userId":"…"}` shape (no null-key noise)
 *
 * Run: node --test tests/economy/coin-service-audit-trail.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { mintCoins, burnCoins } from "../../economy/coin-service.js";

let db;

/**
 * Minimal real schema for the two tables coin-service actually writes —
 * copied from migrations 008 so the test exercises the true column shape
 * (including the event_type CHECK constraint) rather than a loose stand-in.
 */
function migrate(database) {
  database.exec(`
    CREATE TABLE treasury (
      id            TEXT PRIMARY KEY,
      total_usd     REAL NOT NULL DEFAULT 0,
      total_coins   REAL NOT NULL DEFAULT 0,
      updated_at    TEXT
    );
    CREATE TABLE treasury_events (
      id            TEXT PRIMARY KEY,
      event_type    TEXT NOT NULL CHECK(event_type IN ('MINT','BURN','RECONCILE','DRIFT_ALERT')),
      amount        REAL NOT NULL,
      usd_before    REAL NOT NULL,
      usd_after     REAL NOT NULL,
      coins_before  REAL NOT NULL,
      coins_after   REAL NOT NULL,
      ref_id        TEXT,
      metadata_json TEXT DEFAULT '{}',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  database.prepare(
    "INSERT INTO treasury (id, total_usd, total_coins, updated_at) VALUES ('treasury_main', 0, 0, datetime('now'))",
  ).run();
}

function lastEvent(type) {
  return db.prepare(
    "SELECT * FROM treasury_events WHERE event_type = ? ORDER BY rowid DESC LIMIT 1",
  ).get(type);
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

describe("mintCoins — audit trail", () => {
  it("persists caller-supplied requestId + ip into treasury_events.metadata_json", () => {
    const r = mintCoins(db, {
      amount: 250,
      userId: "user_audit_1",
      refId: "stripe_mint:evt_abc123",
      requestId: "req_9f2c",
      ip: "203.0.113.7",
    });
    assert.equal(r.ok, true);

    const ev = lastEvent("MINT");
    assert.ok(ev, "a MINT treasury event should exist");
    const meta = JSON.parse(ev.metadata_json);

    // The regression this test exists for: both were silently dropped.
    assert.equal(meta.requestId, "req_9f2c");
    assert.equal(meta.ip, "203.0.113.7");
    // The pre-existing field must survive the change.
    assert.equal(meta.userId, "user_audit_1");
    // ref_id remains the idempotency key, unchanged by this fix.
    assert.equal(ev.ref_id, "stripe_mint:evt_abc123");
  });

  it("omits the keys entirely when the caller has no request context (no null noise)", () => {
    const r = mintCoins(db, { amount: 100, userId: "user_audit_2" });
    assert.equal(r.ok, true);

    const meta = JSON.parse(lastEvent("MINT").metadata_json);
    assert.deepEqual(meta, { userId: "user_audit_2" });
    // Byte-identical to the historical payload — internal/reward mints that
    // never had request context don't start emitting `"requestId":null`.
    assert.equal(lastEvent("MINT").metadata_json, '{"userId":"user_audit_2"}');
  });

  it("records only the field that was actually supplied", () => {
    mintCoins(db, { amount: 10, userId: "u3", requestId: "req_only" });
    const meta = JSON.parse(lastEvent("MINT").metadata_json);
    assert.equal(meta.requestId, "req_only");
    assert.ok(!("ip" in meta), "ip must be absent, not null, when unsupplied");
  });

  it("does not alter the treasury math", () => {
    mintCoins(db, { amount: 250, userId: "u4", requestId: "r", ip: "i" });
    const t = db.prepare("SELECT * FROM treasury WHERE id = 'treasury_main'").get();
    assert.equal(t.total_usd, 250);
    assert.equal(t.total_coins, 250);
  });
});

describe("burnCoins — audit trail", () => {
  beforeEach(() => {
    // Fund the treasury so the burn is permitted by the invariant check.
    mintCoins(db, { amount: 500, userId: "funder", refId: "seed_mint" });
  });

  it("persists caller-supplied requestId + ip into treasury_events.metadata_json", () => {
    const r = burnCoins(db, {
      amount: 120,
      userId: "user_burn_1",
      refId: "withdrawal_burn:wd_77",
      requestId: "req_burn_1",
      ip: "198.51.100.4",
    });
    assert.equal(r.ok, true);

    const meta = JSON.parse(lastEvent("BURN").metadata_json);
    assert.equal(meta.requestId, "req_burn_1");
    assert.equal(meta.ip, "198.51.100.4");
    assert.equal(meta.userId, "user_burn_1");
  });

  it("omits the keys entirely when unsupplied", () => {
    burnCoins(db, { amount: 25, userId: "user_burn_2" });
    assert.equal(lastEvent("BURN").metadata_json, '{"userId":"user_burn_2"}');
  });

  it("still refuses a burn that would break the treasury invariant, audit fields or not", () => {
    const r = burnCoins(db, {
      amount: 999999,
      userId: "user_burn_3",
      requestId: "req_x",
      ip: "203.0.113.9",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "treasury_insufficient");
    // A refused burn writes no event — the audit change must not have
    // introduced a write on the failure path.
    assert.equal(lastEvent("BURN"), undefined);
  });
});
