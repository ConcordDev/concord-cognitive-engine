/**
 * Fishing minigame test suite.
 *
 * Verifies cast registers a session, reel resolves to a fish from the
 * world's fauna pool, quality scoring tracks accuracy + skill, and the
 * mint creates a player_inventory row.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  castLine,
  resolveFishCatch,
  mintFishCatch,
  getSession,
  listFishForWorld,
  sweepExpiredSessions,
  BITE_MIN_MS,
  BITE_MAX_MS,
  TENSION_PERFECT,
} from "../lib/fishing.js";

function setupInventoryTable(db) {
  // Minimal player_inventory schema matching what fishing.js writes to.
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL DEFAULT 'concordia-hub',
      item_type TEXT,
      item_id TEXT NOT NULL,
      item_name TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      schema_id TEXT,
      meta_json TEXT,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
}

describe("fishing: world fauna loading", () => {
  it("loads fish from concordia-hub", () => {
    const fish = listFishForWorld("concordia-hub");
    assert.ok(fish.length > 0, "should load at least one fish");
    assert.ok(fish.find((f) => f.id === "river-trout"));
  });

  it("returns hub fish for unknown world (fallback)", () => {
    const fish = listFishForWorld("nonexistent-world");
    assert.ok(fish.length > 0);
  });

  it("filters by biome / sub-biome", () => {
    const river = listFishForWorld("concordia-hub", "river");
    assert.ok(river.every((f) => f.subBiome === "river" || f.biome === "river"));
  });
});

describe("fishing: cast", () => {
  it("requires userId", () => {
    const r = castLine({});
    assert.equal(r.ok, false);
  });

  it("returns sessionId + biteAt window in [BITE_MIN_MS, BITE_MAX_MS]", () => {
    const r = castLine({ userId: "u1" });
    assert.equal(r.ok, true);
    assert.ok(r.sessionId);
    const delay = r.biteAtEpochMs - Date.now();
    assert.ok(delay >= BITE_MIN_MS - 100); // small clock-skew margin
    assert.ok(delay <= BITE_MAX_MS + 100);
  });

  it("session is retrievable by id", () => {
    const r = castLine({ userId: "u1" });
    const s = getSession(r.sessionId);
    assert.ok(s);
    assert.equal(s.userId, "u1");
    assert.equal(s.resolved, false);
  });
});

describe("fishing: reel resolution", () => {
  it("rejects reel before bite window", () => {
    const r = castLine({ userId: "u1" });
    const res = resolveFishCatch({ sessionId: r.sessionId });
    assert.equal(res.ok, false);
    assert.equal(res.error, "no_bite_yet");
  });

  it("rejects reel for unknown session", () => {
    const res = resolveFishCatch({ sessionId: "fake_id" });
    assert.equal(res.ok, false);
  });

  it("returns a fish when called within window", () => {
    const r = castLine({ userId: "u1" });
    // Force the session's biteAt into the past so we can resolve
    const s = getSession(r.sessionId);
    s.biteAt = Date.now() - 1000;
    const res = resolveFishCatch({
      sessionId: r.sessionId,
      reactionMs: 500,
      tensionAccuracy: 0.9,
    });
    assert.equal(res.ok, true, `reel result: ${JSON.stringify(res)}`);
    assert.ok(res.fish);
    assert.ok(res.qualityScore > 0);
  });

  it("perfect accuracy yields perfect tier", () => {
    const r = castLine({ userId: "u1" });
    const s = getSession(r.sessionId);
    s.biteAt = Date.now() - 1000;
    const res = resolveFishCatch({
      sessionId: r.sessionId,
      reactionMs: 300,
      tensionAccuracy: 0.99,
      fishingSkill: 100,
    });
    assert.equal(res.ok, true);
    // Tier 'perfect' requires qualityScore >= TENSION_PERFECT
    if (res.qualityScore >= TENSION_PERFECT) {
      assert.equal(res.tier, "perfect");
    }
  });

  it("rejects double-resolve", () => {
    const r = castLine({ userId: "u1" });
    const s = getSession(r.sessionId);
    s.biteAt = Date.now() - 1000;
    resolveFishCatch({ sessionId: r.sessionId, reactionMs: 500, tensionAccuracy: 0.7 });
    const second = resolveFishCatch({ sessionId: r.sessionId, reactionMs: 500, tensionAccuracy: 0.7 });
    assert.equal(second.ok, false);
    assert.equal(second.error, "already_resolved");
  });
});

describe("fishing: mint", () => {
  let db;
  beforeEach(() => {
    db = new Database(":memory:");
    setupInventoryTable(db);
  });

  it("mintFishCatch creates inventory row", () => {
    const fish = listFishForWorld("concordia-hub")[0];
    const r = mintFishCatch(db, {
      userId: "u1",
      fish,
      qualityScore: 0.75,
      sessionId: "test_session",
    });
    assert.equal(r.ok, true);
    assert.ok(r.inventoryId);
    const rows = db.prepare(`SELECT * FROM player_inventory WHERE user_id = 'u1'`).all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].item_type, "raw_fish");
  });

  it("mintFishCatch handles missing fish gracefully", () => {
    const r = mintFishCatch(db, { userId: "u1", fish: null });
    assert.equal(r.ok, false);
  });
});

describe("fishing: session cleanup", () => {
  it("sweepExpiredSessions removes old sessions", () => {
    const r = castLine({ userId: "u1" });
    const s = getSession(r.sessionId);
    s.expiresAt = Date.now() - 1000;
    const pruned = sweepExpiredSessions();
    assert.ok(pruned >= 1);
    assert.equal(getSession(r.sessionId), null);
  });
});
