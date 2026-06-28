// Macro surface for the fishing minigame (server/domains/fishing.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB, and asserts the macro both delegates to
// the lib AND produces real values (a caught species from the biome pool, an
// actual inventory row), not just { ok:true }. Mirrors the
// register(domain, name, handler) collection pattern the server uses so we
// exercise the exact handlers without booting server.js.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerFishingMacros from "../domains/fishing.js";
import { getSession, listFishForWorld } from "../lib/fishing.js";

function collectMacros() {
  const map = new Map();
  registerFishingMacros((_domain, name, handler) => {
    map.set(name, handler);
  });
  return map;
}

// player_inventory at its post-migration shape (the columns lib/fishing.js's
// primary INSERT path writes). This mirrors what runMigrations produces — we
// build it inline so the test doesn't depend on the full 350-migration chain.
function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_inventory (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      world_id    TEXT NOT NULL DEFAULT 'concordia-hub',
      item_type   TEXT NOT NULL DEFAULT 'material',
      item_id     TEXT NOT NULL,
      item_name   TEXT NOT NULL DEFAULT '',
      quantity    INTEGER NOT NULL DEFAULT 1,
      schema_id   TEXT,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata    TEXT
    );
  `);
  return db;
}

function ctxFor(db, userId) {
  return { db, actor: { userId } };
}

describe("fishing domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("registers the full read + write surface", () => {
    for (const name of [
      "catalog", "species", "list", "get", "catches", "session",
      "cast", "reel", "create",
    ]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("catalog returns the world's authored fish (real content, not a stub)", async () => {
    const out = await macros.get("catalog")(ctxFor(db, "u1"), { worldId: "concordia-hub" });
    assert.equal(out.ok, true);
    assert.ok(Array.isArray(out.fish) && out.fish.length > 0, "catalog must list fish");
    // Every entry is a real descriptor with id + rarity.
    assert.ok(out.fish.every((f) => typeof f.id === "string" && typeof f.rarity === "string"));
    // It matches the lib's own listing exactly (no duplicated/fabricated data).
    assert.deepEqual(
      out.fish.map((f) => f.id).sort(),
      listFishForWorld("concordia-hub").map((f) => f.id).sort(),
    );
  });

  it("species pools differ per biome (river vs ocean draw different fish)", async () => {
    const river = await macros.get("species")(ctxFor(db, "u1"), { worldId: "concordia-hub", biome: "river" });
    const ocean = await macros.get("species")(ctxFor(db, "u1"), { worldId: "concordia-hub", biome: "ocean" });
    assert.equal(river.ok, true);
    assert.equal(ocean.ok, true);
    assert.ok(river.fish.length > 0 && ocean.fish.length > 0);
    const riverIds = new Set(river.fish.map((f) => f.id));
    const oceanIds = new Set(ocean.fish.map((f) => f.id));
    // The two biome pools are genuinely distinct content.
    assert.ok([...oceanIds].some((id) => !riverIds.has(id)), "ocean must contain a fish the river pool lacks");
    // And every returned fish actually belongs to the requested biome/subBiome.
    assert.ok(river.fish.every((f) => f.biome === "river" || f.subBiome === "river"));
    assert.ok(ocean.fish.every((f) => f.biome === "ocean" || f.subBiome === "ocean"));
  });

  it("cast → reel → catch yields a real species AND adds exactly one inventory item", async () => {
    const cast = await macros.get("cast")(ctxFor(db, "angler"), { worldId: "concordia-hub", biome: "water" });
    assert.equal(cast.ok, true);
    assert.ok(typeof cast.sessionId === "string");
    assert.ok(cast.candidateCount > 0);

    // The tension mechanic gates on bite timing: a reel before the bite is
    // rejected (no_bite_yet) — assert the mechanic actually resolves that way.
    const tooEarly = await macros.get("reel")(ctxFor(db, "angler"), { sessionId: cast.sessionId });
    assert.equal(tooEarly.ok, false);
    assert.equal(tooEarly.reason, "no_bite_yet");

    // Advance the session past the bite window (the live session object is
    // mutable via getSession), then reel with high tension accuracy.
    const s = getSession(cast.sessionId);
    s.biteAt = Date.now() - 500;
    s.resolved = false; // tooEarly flipped it; reset for the real attempt

    const reel = await macros.get("reel")(ctxFor(db, "angler"), {
      sessionId: cast.sessionId, reactionMs: 400, tensionAccuracy: 0.9, fishingSkill: 50,
    });
    assert.equal(reel.ok, true);
    // A real species from the biome pool was caught.
    assert.ok(reel.fish && typeof reel.fish.id === "string", "must catch a real fish");
    const poolIds = new Set(listFishForWorld("concordia-hub", "water").map((f) => f.id));
    assert.ok(poolIds.has(reel.fish.id), "caught fish must come from the biome's species table");
    assert.ok(reel.qualityScore >= 0 && reel.qualityScore <= 1);
    assert.ok(["perfect", "good", "fair", "poor"].includes(reel.tier));
    assert.equal(reel.mint.ok, true);

    // Inventory gained exactly the caught item (one raw_fish row, matching id).
    const rows = db.prepare(
      `SELECT * FROM player_inventory WHERE user_id = 'angler' AND item_type = 'raw_fish'`,
    ).all();
    assert.equal(rows.length, 1, "exactly one catch row");
    assert.equal(rows[0].item_id, `raw_fish:${reel.fish.id}`);
    assert.equal(rows[0].quantity, 1);

    // catches macro surfaces it.
    const log = await macros.get("catches")(ctxFor(db, "angler"), {});
    assert.equal(log.ok, true);
    assert.equal(log.catches.length, 1);
    assert.equal(log.catches[0].item_id, `raw_fish:${reel.fish.id}`);
  });

  it("create artifact verb mints a catch through the same path as reel", async () => {
    const cast = await macros.get("cast")(ctxFor(db, "angler2"), { worldId: "concordia-hub", biome: "water" });
    const s = getSession(cast.sessionId);
    s.biteAt = Date.now() - 500;
    const out = await macros.get("create")(ctxFor(db, "angler2"), {
      sessionId: cast.sessionId, tensionAccuracy: 0.8,
    });
    assert.equal(out.ok, true);
    assert.ok(out.fish && out.fish.id);
    const rows = db.prepare(
      `SELECT COUNT(*) AS n FROM player_inventory WHERE user_id = 'angler2' AND item_type = 'raw_fish'`,
    ).get();
    assert.equal(rows.n, 1);
  });

  it("reel rejects a missing/expired session cleanly (never throws)", async () => {
    const out = await macros.get("reel")(ctxFor(db, "u1"), { sessionId: "fish_does_not_exist" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "session_not_found");
  });

  it("cast without an actor returns a clean envelope, not a throw", async () => {
    const out = await macros.get("cast")({ db }, { worldId: "concordia-hub" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_user");
  });

  it("get returns a single fish descriptor or a clean miss", async () => {
    const any = listFishForWorld("concordia-hub")[0];
    const hit = await macros.get("get")(ctxFor(db, "u1"), { fishId: any.id });
    assert.equal(hit.ok, true);
    assert.equal(hit.fish.id, any.id);
    const miss = await macros.get("get")(ctxFor(db, "u1"), { fishId: "no_such_fish" });
    assert.equal(miss.ok, false);
    assert.equal(miss.reason, "no_fish");
  });
});
