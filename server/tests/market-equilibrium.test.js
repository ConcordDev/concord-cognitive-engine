// server/tests/market-equilibrium.test.js
//
// Validates market-equilibrium.js against a seeded synthetic economy_ledger
// (schema pattern follows server/tests/economy/ledger-conservation.test.js)
// with a deliberately planted cartel vs. a clean competitive market, plus a
// read-only proof. detectCollusionRings/Tarjan-SCC structural detection is
// exact; the Nash/replicator signals are a documented heuristic layered on
// top (see market-equilibrium.js's header) — the tests below hold the
// STRUCTURAL classification (cartel vs. not) to a hard bar, since that part
// is exact.
//
// Run without --test-force-exit (it silently truncates runs).
//   node --test server/tests/market-equilibrium.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { analyzeMarketEquilibrium } from "../lib/game-theory/market-equilibrium.js";

function createDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE economy_ledger (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      from_user_id  TEXT,
      to_user_id    TEXT,
      amount        REAL NOT NULL,
      fee           REAL NOT NULL DEFAULT 0,
      net           REAL NOT NULL,
      status        TEXT NOT NULL DEFAULT 'complete',
      metadata_json TEXT DEFAULT '{}',
      request_id    TEXT,
      ip            TEXT,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      ref_id        TEXT
    );
  `);
  return db;
}

let seedCounter = 0;
function insertTrade(db, { from, to, amount, net, type = "TRANSFER", offsetMs = 0 }) {
  seedCounter += 1;
  const ts = new Date(Date.now() - 3600_000 + offsetMs).toISOString();
  db.prepare(`
    INSERT INTO economy_ledger (id, type, from_user_id, to_user_id, amount, fee, net, status, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?, 'complete', ?)
  `).run(`ledger_seed_${seedCounter}`, type, from, to, amount, net, ts);
}

describe("analyzeMarketEquilibrium — planted cartel is surfaced", () => {
  let db;
  beforeEach(() => { db = createDb(); seedCounter = 0; });

  it("flags a deliberate reciprocal trading ring (A→B→C→A) with high internal net value", () => {
    // The ring: 3 accounts trading in a closed cycle, well above the
    // minEdgeTrades threshold on every edge, at high net value.
    const ringEdges = [["ring_a", "ring_b"], ["ring_b", "ring_c"], ["ring_c", "ring_a"]];
    for (const [from, to] of ringEdges) {
      for (let i = 0; i < 5; i++) {
        insertTrade(db, { from, to, amount: 200, net: 190, offsetMs: i * 1000 });
      }
    }
    // Baseline competitive noise: distinct one-off pairs, low value, never
    // reused, never reciprocated — should not itself look like a ring.
    for (let i = 0; i < 12; i++) {
      insertTrade(db, { from: `trader_${i}`, to: `trader_${i}_counterparty`, amount: 40, net: 38, offsetMs: 500000 + i * 1000 });
    }

    const result = analyzeMarketEquilibrium(db);
    assert.equal(result.ok, true);
    assert.equal(result.classification, "cartel_consistent", JSON.stringify(result, null, 2));
    assert.ok(result.rings.length >= 1, "expected the SCC ring to be detected");
    const ring = result.rings.find((r) => r.accounts.includes("ring_a"));
    assert.ok(ring, "ring_a should be in a detected ring");
    assert.deepEqual(ring.accounts.slice().sort(), ["ring_a", "ring_b", "ring_c"]);
    assert.ok(result.ringVolumeFraction > 0.05, `ringVolumeFraction=${result.ringVolumeFraction}`);
    assert.ok(result.signals.structuralSignal, "structural signal should be true");
  });
});

describe("analyzeMarketEquilibrium — clean competitive market is NOT flagged", () => {
  let db;
  beforeEach(() => { db = createDb(); seedCounter = 0; });

  it("does not classify a market with no cycles or reciprocal trading as a cartel", () => {
    // 20 distinct agents, each trading forward once to the next (a→b, c→d,
    // e→f, ...) — no cycles, no reciprocity, no repeated edges.
    for (let i = 0; i < 20; i++) {
      insertTrade(db, {
        from: `agent_${i}`,
        to: `agent_${i}_partner`,
        amount: 50 + (i % 5) * 10,
        net: 47,
        offsetMs: i * 1000,
      });
    }

    const result = analyzeMarketEquilibrium(db);
    assert.equal(result.ok, true);
    assert.equal(result.classification, "competitive_equilibrium_consistent", JSON.stringify(result, null, 2));
    assert.equal(result.rings.length, 0);
    assert.equal(result.reciprocalPairs.length, 0);
    assert.equal(result.signals.structuralSignal, false);
  });

  it("reports insufficient_data on an empty ledger rather than guessing", () => {
    const result = analyzeMarketEquilibrium(db);
    assert.equal(result.ok, true);
    assert.equal(result.classification, "insufficient_data");
    assert.equal(result.tradeCount, 0);
  });
});

describe("analyzeMarketEquilibrium — read-only proof", () => {
  let db;
  beforeEach(() => { db = createDb(); seedCounter = 0; });

  it("never mutates the ledger — row count and every stored value are byte-identical before/after", () => {
    const ringEdges = [["ring_a", "ring_b"], ["ring_b", "ring_c"], ["ring_c", "ring_a"]];
    for (const [from, to] of ringEdges) {
      for (let i = 0; i < 4; i++) insertTrade(db, { from, to, amount: 150, net: 140, offsetMs: i * 1000 });
    }
    for (let i = 0; i < 8; i++) {
      insertTrade(db, { from: `trader_${i}`, to: `trader_${i}_counterparty`, amount: 30, net: 28, offsetMs: 200000 + i * 1000 });
    }

    const before = db.prepare("SELECT * FROM economy_ledger ORDER BY id").all();
    const beforeCount = db.prepare("SELECT COUNT(*) AS n FROM economy_ledger").get().n;

    const result = analyzeMarketEquilibrium(db);
    assert.equal(result.ok, true);

    const after = db.prepare("SELECT * FROM economy_ledger ORDER BY id").all();
    const afterCount = db.prepare("SELECT COUNT(*) AS n FROM economy_ledger").get().n;

    assert.equal(afterCount, beforeCount);
    assert.deepEqual(after, before, "ledger rows must be byte-identical after analysis");
  });
});
