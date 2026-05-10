/**
 * quota-cache contract tests.
 *
 * Pins the headline performance claim: at 1000 enqueues/second, the
 * cache must produce ≤ 1 batched DB write per flush interval (default
 * 5s in production; tests override to 100ms for speed).
 *
 * Also exercises:
 *   - a mid-buffer schema-error in one row doesn't drop the others
 *     (per-row fallback)
 *   - close() flushes the in-flight buffer (shutdown semantics)
 *   - max-buffer soft cap forces an early flush to bound memory
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { createQuotaCache, makeUsageId } from "../lib/quota-cache.js";

function makeDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE api_usage_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      api_key_hash TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      category TEXT NOT NULL,
      cost REAL NOT NULL CHECK (cost >= 0),
      balance_after REAL NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

function rowFor(seed) {
  return [
    makeUsageId(),
    `user_${seed}`,
    "key_hash_x",
    "/api/x",
    "GET",
    "read",
    0.0001,
    9.9999,
    "{}",
    new Date().toISOString(),
  ];
}

describe("quota-cache — batching writes", () => {
  let db;
  let cache;
  let observed;

  beforeEach(() => {
    db = makeDb();
    observed = [];
    cache = createQuotaCache({
      table: "api_usage_log",
      columns: [
        "id", "user_id", "api_key_hash", "endpoint", "method",
        "category", "cost", "balance_after", "metadata_json", "created_at",
      ],
      flushIntervalMs: 100,
      maxBufferRows: 10000,
      onFlush: (e) => observed.push(e),
    });
  });

  afterEach(() => {
    cache.close();
    try { db.close(); } catch { /* noop */ }
  });

  it("buffers writes — DB stays empty until flush", () => {
    for (let i = 0; i < 50; i++) cache.enqueue(db, rowFor(i));
    assert.equal(db.prepare("SELECT COUNT(*) c FROM api_usage_log").get().c, 0);
    assert.equal(cache.snapshot().bufferDepth, 50);
  });

  it("flush() lands all buffered rows in a single transaction", () => {
    for (let i = 0; i < 1000; i++) cache.enqueue(db, rowFor(i));
    const result = cache.flush();
    assert.equal(result.flushedRows, 1000);
    assert.equal(result.batches, 1, "1000 rows must flush as a single batch");
    assert.equal(db.prepare("SELECT COUNT(*) c FROM api_usage_log").get().c, 1000);
  });

  it("automatic flush fires on the timer interval", async () => {
    for (let i = 0; i < 25; i++) cache.enqueue(db, rowFor(i));
    // Wait for at least one flush cycle (100ms interval + slack)
    await new Promise(r => { setTimeout(r, 250); });
    assert.equal(db.prepare("SELECT COUNT(*) c FROM api_usage_log").get().c, 25);
    assert.ok(observed.some(e => e.kind === "ok" && e.rows === 25));
  });

  it("close() flushes the in-flight buffer (graceful shutdown)", () => {
    for (let i = 0; i < 17; i++) cache.enqueue(db, rowFor(i));
    cache.close();
    assert.equal(db.prepare("SELECT COUNT(*) c FROM api_usage_log").get().c, 17);
  });

  it("soft buffer cap forces an early flush", () => {
    const tinyCache = createQuotaCache({
      table: "api_usage_log",
      columns: ["id", "user_id", "api_key_hash", "endpoint", "method",
                "category", "cost", "balance_after", "metadata_json", "created_at"],
      flushIntervalMs: 60_000, // long interval — only the cap should trigger flush
      maxBufferRows: 5,
    });
    try {
      // 12 enqueues with cap 5 → expect at least 2 mid-stream flushes.
      for (let i = 0; i < 12; i++) tinyCache.enqueue(db, rowFor(i));
      const count = db.prepare("SELECT COUNT(*) c FROM api_usage_log").get().c;
      assert.ok(count >= 10, `expected ≥10 rows landed via cap-triggered flush, got ${count}`);
    } finally {
      tinyCache.close();
    }
  });
});

describe("quota-cache — error resilience", () => {
  let db;
  let cache;
  let observed;

  beforeEach(() => {
    db = makeDb();
    observed = [];
    cache = createQuotaCache({
      table: "api_usage_log",
      columns: [
        "id", "user_id", "api_key_hash", "endpoint", "method",
        "category", "cost", "balance_after", "metadata_json", "created_at",
      ],
      flushIntervalMs: 100,
      onFlush: (e) => observed.push(e),
    });
  });

  afterEach(() => {
    cache.close();
    try { db.close(); } catch { /* noop */ }
  });

  it("a schema-rejected row does not drop adjacent good rows (per-row fallback)", () => {
    // 5 good rows then 1 row with a duplicate primary key (will fail
    // CHECK on cost or PK), then 4 more good rows. The bulk insert
    // fails; the cache must retry one-by-one.
    const goodId = makeUsageId();
    for (let i = 0; i < 5; i++) cache.enqueue(db, rowFor(i));
    // Inject a row with cost = -1 (CHECK violation)
    cache.enqueue(db, [
      makeUsageId(), "user_bad", "k", "/", "GET", "read",
      -1, // <- violates CHECK (cost >= 0)
      0, "{}", new Date().toISOString(),
    ]);
    for (let i = 5; i < 9; i++) cache.enqueue(db, rowFor(i));

    cache.flush();

    // Expect 9 good rows; the bad row was logged via onFlush.
    const count = db.prepare("SELECT COUNT(*) c FROM api_usage_log").get().c;
    assert.equal(count, 9, `expected 9 good rows landed, got ${count}`);
    const errs = observed.filter(e => e.kind === "row_error");
    assert.equal(errs.length, 1);
  });

  it("rejects malformed enqueue arguments cleanly", () => {
    assert.throws(() => cache.enqueue(null, []), /db handle required/);
    assert.throws(() => cache.enqueue(db, null), /row must be array/);
    assert.throws(() => cache.enqueue(db, [1, 2]), /row must be array of/);
  });
});

describe("quota-cache — guardrails", () => {
  it("rejects unsafe table names", () => {
    assert.throws(() => createQuotaCache({
      table: "users; DROP TABLE users;",
      columns: ["id"],
    }), /invalid_table_name/);
  });

  it("rejects unsafe column names", () => {
    assert.throws(() => createQuotaCache({
      table: "api_usage_log",
      columns: ["id", "x; DROP TABLE x;"],
    }), /invalid_column_name/);
  });

  it("rejects empty config", () => {
    assert.throws(() => createQuotaCache({ columns: ["id"] }), /table required/);
    assert.throws(() => createQuotaCache({ table: "x", columns: [] }), /columns array required/);
  });
});
