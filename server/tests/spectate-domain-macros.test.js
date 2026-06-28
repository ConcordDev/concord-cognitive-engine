// Macro surface for the spectate lens (server/domains/spectate.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB seeded with the migration-162 betting +
// spectator substrate, and the in-memory spectator-mode socket registry. Asserts
// ACTUAL behavior (a placed bet escrows SPARKS + persists a position row + bumps
// the pool; the spectacle list merges real watcher counts with real open
// markets), not just shape. Mirrors the register(domain, name, handler)
// collection pattern the server uses so we exercise the exact handlers without
// booting server.js.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerSpectateMacros from "../domains/spectate.js";
import { up as upBetting } from "../migrations/162_spectator_betting.js";
import { openMarket } from "../lib/betting-markets.js";
import { joinSpectator, _resetSpectators } from "../lib/spectator-mode.js";

function collectMacros() {
  const map = new Map();
  registerSpectateMacros((domain, name, handler) => { map.set(name, handler); });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  upBetting(db);
  return db;
}

function ctxFor(db, userId) {
  return { db, actor: userId ? { userId } : null };
}

// Seed a SPARKS balance for a user (placeBet debits this).
function fundSparks(db, userId, balance) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sparks_balances (
      user_id TEXT PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.prepare(`
    INSERT INTO sparks_balances (user_id, balance) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET balance = excluded.balance
  `).run(userId, balance);
}

// A minimal socket stand-in for joinSpectator (it only calls .join + reads .id).
function fakeSocket(id) {
  return { id, join() {} };
}

describe("spectate domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); _resetSpectators(); });
  afterEach(() => { _resetSpectators(); });

  it("registers the read + write surface", () => {
    for (const name of ["list", "get", "watch", "bet", "my_positions"]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("watch opens a real spectator session (persists a row + returns a token)", async () => {
    const res = await macros.get("watch")(ctxFor(db, "viewer-1"), { worldId: "cyber" });
    assert.equal(res.ok, true);
    assert.equal(typeof res.sessionToken, "string");
    assert.ok(res.sessionToken.length > 0);
    assert.equal(res.worldId, "cyber");
    assert.match(res.wsHint, /\/ws\/spectate\/cyber/);

    // Persisted to spectator_sessions, scoped to the viewer.
    const row = db.prepare(`SELECT * FROM spectator_sessions WHERE session_token = ?`).get(res.sessionToken);
    assert.ok(row, "session row persisted");
    assert.equal(row.world_id, "cyber");
    assert.equal(row.viewer_user_id, "viewer-1");
  });

  it("watch allows anonymous viewers but requires a worldId", async () => {
    const anon = await macros.get("watch")(ctxFor(db, null), { worldId: "fantasy" });
    assert.equal(anon.ok, true, "anonymous watching allowed");
    const row = db.prepare(`SELECT viewer_user_id FROM spectator_sessions WHERE session_token = ?`).get(anon.sessionToken);
    assert.equal(row.viewer_user_id, null);

    const noWorld = await macros.get("watch")(ctxFor(db, "v2"), {});
    assert.equal(noWorld.ok, false);
    assert.equal(noWorld.reason, "missing_worldId");
  });

  it("list surfaces open markets and live watcher counts merged per world", async () => {
    // A real open market on sovereign-ruins.
    const m = openMarket(db, {
      worldId: "sovereign-ruins",
      question: "Will the Ash Compact declare war this cycle?",
      resolutionKind: "faction_war",
    });
    assert.equal(m.ok, true);
    // Two live watchers on cyber (in-memory socket registry).
    joinSpectator(fakeSocket("s1"), "cyber");
    joinSpectator(fakeSocket("s2"), "cyber");

    const res = await macros.get("list")(ctxFor(db), {});
    assert.equal(res.ok, true);
    assert.equal(res.currency, "SPARKS");
    assert.ok(Array.isArray(res.spectacles));

    const ruins = res.spectacles.find((s) => s.worldId === "sovereign-ruins");
    assert.ok(ruins, "sovereign-ruins spectacle present");
    assert.equal(ruins.openMarketCount, 1);
    assert.equal(ruins.live, true);

    const cyber = res.spectacles.find((s) => s.worldId === "cyber");
    assert.ok(cyber, "cyber spectacle present");
    assert.equal(cyber.watching, 2, "real socket watcher count surfaced");
    assert.equal(cyber.live, true);

    // liveCount = the two live worlds.
    assert.ok(res.liveCount >= 2);
  });

  it("get returns a world's open markets with computed implied odds", async () => {
    const m = openMarket(db, {
      worldId: "lattice-crucible",
      question: "Will iteration #7 converge?",
      resolutionKind: "drift_event",
    });
    fundSparks(db, "alice", 1000);
    // Place a real bet so the pool is non-trivial: 30 YES.
    const bet = await macros.get("bet")(ctxFor(db, "alice"), {
      marketId: m.marketId, side: "yes", stakeSparks: 30,
    });
    assert.equal(bet.ok, true);

    const res = await macros.get("get")(ctxFor(db), { worldId: "lattice-crucible" });
    assert.equal(res.ok, true);
    assert.equal(res.worldId, "lattice-crucible");
    assert.equal(res.spectacle.openMarketCount, 1);
    const market = res.spectacle.openMarkets[0];
    assert.equal(market.poolYesSparks, 30);
    assert.equal(market.poolNoSparks, 0);
    // All-YES pool → implied YES probability is 1.0.
    assert.equal(market.impliedYes, 1);
  });

  it("bet ESCROWS sparks, persists a position, and bumps the pool", async () => {
    const m = openMarket(db, {
      worldId: "crime",
      question: "Will the heist succeed?",
      resolutionKind: "manual",
    });
    fundSparks(db, "bob", 100);

    const res = await macros.get("bet")(ctxFor(db, "bob"), {
      marketId: m.marketId, side: "no", stakeSparks: 25,
    });
    assert.equal(res.ok, true);
    assert.equal(res.stake, 25);
    assert.equal(res.side, "no");
    assert.equal(res.currency, "SPARKS");

    // Escrow: balance debited 100 → 75.
    const bal = db.prepare(`SELECT balance FROM sparks_balances WHERE user_id='bob'`).get();
    assert.equal(bal.balance, 75, "25 SPARKS escrowed");

    // Position row persisted.
    const pos = db.prepare(`SELECT * FROM market_positions WHERE user_id='bob'`).get();
    assert.ok(pos, "position row persisted");
    assert.equal(pos.side, "no");
    assert.equal(pos.stake_sparks, 25);

    // Pool bumped on the NO side.
    const mkt = db.prepare(`SELECT pool_no_sparks, pool_yes_sparks FROM prediction_markets WHERE id=?`).get(m.marketId);
    assert.equal(mkt.pool_no_sparks, 25);
    assert.equal(mkt.pool_yes_sparks, 0);

    // my_positions reflects it.
    const mine = await macros.get("my_positions")(ctxFor(db, "bob"), {});
    assert.equal(mine.ok, true);
    assert.equal(mine.positions.length, 1);
    assert.equal(mine.positions[0].stake_sparks, 25);
  });

  it("bet rejects an unfunded wager without minting (insufficient_sparks)", async () => {
    const m = openMarket(db, { worldId: "fantasy", question: "Q?", resolutionKind: "manual" });
    // No sparks funded for 'cara'.
    const res = await macros.get("bet")(ctxFor(db, "cara"), {
      marketId: m.marketId, side: "yes", stakeSparks: 50,
    });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "insufficient_sparks");
    // No position row, no pool change.
    const pos = db.prepare(`SELECT COUNT(*) AS n FROM market_positions`).get();
    assert.equal(pos.n, 0);
  });

  // ── Fail-closed numeric guard (CONSTRUCTION RULE A) ─────────────────────────
  it("bet fail-CLOSES on poisoned numeric stakes BEFORE any escrow", async () => {
    const m = openMarket(db, { worldId: "tunya", question: "Q?", resolutionKind: "manual" });
    fundSparks(db, "dave", 1000);
    for (const [field, val] of [
      ["stakeSparks", NaN],
      ["stakeSparks", Infinity],
      ["stakeSparks", 1e308],
      ["stakeSparks", -5],
    ]) {
      const res = await macros.get("bet")(ctxFor(db, "dave"), {
        marketId: m.marketId, side: "yes", [field]: val,
      });
      assert.equal(res.ok, false, `poisoned ${field}=${val} rejected`);
      assert.match(res.reason || "", /^invalid_/);
    }
    // Balance untouched — no escrow happened.
    const bal = db.prepare(`SELECT balance FROM sparks_balances WHERE user_id='dave'`).get();
    assert.equal(bal.balance, 1000);
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM market_positions`).get().n, 0);
  });

  it("list fail-CLOSES on a poisoned limit", async () => {
    const res = await macros.get("list")(ctxFor(db), { limit: Infinity });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_limit");
  });

  // ── Actor + arg gates ───────────────────────────────────────────────────────
  it("bet requires an actor (no_actor) and complete inputs (missing_inputs)", async () => {
    const m = openMarket(db, { worldId: "superhero", question: "Q?", resolutionKind: "manual" });
    const anon = await macros.get("bet")(ctxFor(db, null), { marketId: m.marketId, side: "yes", stakeSparks: 5 });
    assert.equal(anon.ok, false);
    assert.equal(anon.reason, "no_actor");

    fundSparks(db, "eve", 100);
    const incomplete = await macros.get("bet")(ctxFor(db, "eve"), {});
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.reason, "missing_inputs");
  });

  it("get requires a worldId", async () => {
    const res = await macros.get("get")(ctxFor(db), {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "missing_worldId");
  });

  it("all read macros return no_db when the DB is absent", async () => {
    for (const name of ["list", "get", "watch", "bet", "my_positions"]) {
      const res = await macros.get(name)({ actor: { userId: "x" } }, { worldId: "w", marketId: 1, side: "yes", stakeSparks: 1 });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "no_db");
    }
  });
});
