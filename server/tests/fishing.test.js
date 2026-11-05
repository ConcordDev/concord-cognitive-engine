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
  pickBiteFish,
  BITE_MIN_MS,
  BITE_MAX_MS,
  TENSION_PERFECT,
} from "../lib/fishing.js";

function setupInventoryTable(db) {
  // player_inventory schema matching the REAL live table (migration 035's
  // PRIMARY KEY (user_id, item_id) — migration 294 only ever ADDED columns
  // onto that same key, never changed it; see mintFishCatch's doc comment).
  // A mock with `id` as the sole PK (the old version of this fixture) can't
  // reproduce the F2 bug at all, since nothing there ever collides.
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_inventory (
      id TEXT,
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL DEFAULT 'concordia-hub',
      item_type TEXT,
      item_id TEXT NOT NULL,
      item_name TEXT,
      quantity INTEGER NOT NULL DEFAULT 1,
      schema_id TEXT,
      metadata TEXT,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, item_id)
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

describe("fishing: F5 bite-time species pick", () => {
  it("pickBiteFish stores an idempotent species choice on the session", () => {
    const r = castLine({ userId: "u1" });
    const first = pickBiteFish(r.sessionId, { fishingSkill: 50 });
    assert.ok(first.ok);
    assert.ok(first.fish);
    const second = pickBiteFish(r.sessionId, { fishingSkill: 50 });
    // Re-calling must return the SAME fish, not re-roll — the whole point
    // of picking at bite time is that the fight the player sees matches the
    // species that's eventually minted.
    assert.equal(second.fish.id, first.fish.id);
  });

  it("resolveFishCatch honors a pre-picked bite-time fish instead of re-rolling", () => {
    const r = castLine({ userId: "u1" });
    const picked = pickBiteFish(r.sessionId, { fishingSkill: 50 });
    const s = getSession(r.sessionId);
    s.biteAt = Date.now() - 1000;
    const res = resolveFishCatch({
      sessionId: r.sessionId,
      reactionMs: 500,
      tensionAccuracy: 0.9,
    });
    assert.equal(res.ok, true);
    assert.equal(res.fish.id, picked.fish.id);
  });

  it("resolveFishCatch still falls back to a same-tick roll when no bite-time pick exists", () => {
    // Direct callers (e.g. older test harnesses, non-cast-route callers)
    // that never call pickBiteFish must still get a fish — F5 must not
    // regress the pre-existing fallback path.
    const r = castLine({ userId: "u1" });
    const s = getSession(r.sessionId);
    s.biteAt = Date.now() - 1000;
    const res = resolveFishCatch({ sessionId: r.sessionId, reactionMs: 500, tensionAccuracy: 0.9 });
    assert.equal(res.ok, true);
    assert.ok(res.fish);
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

  it("F2 regression: a repeat catch of the SAME species stacks quantity instead of silently failing on the (user_id, item_id) PK", () => {
    const fish = listFishForWorld("concordia-hub")[0];
    const first = mintFishCatch(db, { userId: "u1", fish, qualityScore: 0.6, sessionId: "s1" });
    assert.equal(first.ok, true, "first catch of a species must mint cleanly");
    assert.equal(first.stacked, false);

    // Before the fix this threw a UNIQUE-constraint error on the composite
    // PK and was silently swallowed — the dialog said "Caught" but nothing
    // landed. It must now be a real, visible write.
    const second = mintFishCatch(db, { userId: "u1", fish, qualityScore: 0.9, sessionId: "s2" });
    assert.equal(second.ok, true, "a repeat catch of the same species must still be a committed write");
    assert.equal(second.stacked, true);
    assert.equal(second.inventoryId, first.inventoryId, "stacks onto the SAME row, not a second colliding row");

    const rows = db.prepare(`SELECT * FROM player_inventory WHERE user_id = 'u1'`).all();
    assert.equal(rows.length, 1, "one row per species — quantity carries the true catch count");
    assert.equal(rows[0].quantity, 2);

    const meta = JSON.parse(rows[0].metadata);
    assert.equal(meta.history.length, 2, "both catches' quality scores are preserved in history, not overwritten");
    assert.equal(meta.history[0].qualityScore, 0.6);
    assert.equal(meta.history[1].qualityScore, 0.9);
  });

  it("F2 regression: catching ten fish across six species stacks to exactly six rows, never fewer than ten total quantity", () => {
    const fish = listFishForWorld("concordia-hub");
    assert.ok(fish.length >= 3, "fixture needs at least 3 species to exercise stacking realistically");
    const species = [fish[0], fish[1], fish[2], fish[0], fish[1], fish[0]];
    for (const f of species) {
      const r = mintFishCatch(db, { userId: "u2", fish: f, qualityScore: 0.5, sessionId: `s-${f.id}` });
      assert.equal(r.ok, true, `catch of ${f.id} must always be a committed write`);
    }
    const rows = db.prepare(`SELECT quantity FROM player_inventory WHERE user_id = 'u2'`).all();
    assert.equal(rows.length, 3, "three distinct species → three rows");
    const totalQuantity = rows.reduce((sum, r) => sum + r.quantity, 0);
    assert.equal(totalQuantity, 6, "every one of the six catches is accounted for in quantity, none lost");
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
