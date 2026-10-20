// INC-70 — a reel belongs to the caster, catches are the caller's inventory,
// and client skill/tension/reaction cannot force a perfect catch.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerFishingMacros from "../domains/fishing.js";
import { getSession } from "../lib/fishing.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "fishing");
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`fishing.${name} not registered`);
  return fn(ctx, input);
}
before(() => registerFishingMacros(register));

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL DEFAULT 'concordia-hub',
      item_type TEXT NOT NULL DEFAULT 'material',
      item_id TEXT NOT NULL,
      item_name TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      schema_id TEXT,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      native_world_type TEXT NOT NULL DEFAULT 'hub',
      level INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

const A = { actor: { userId: "user_a" }, userId: "user_a" };
const B = { actor: { userId: "user_b" }, userId: "user_b" };

describe("INC-70 fishing session and catch authz", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    A.db = db;
    B.db = db;
  });

  it("B cannot reel A's cast; A still can", async () => {
    const cast = await call("cast", A, { worldId: "concordia-hub", biome: "water" });
    assert.equal(cast.ok, true);
    const session = getSession(cast.sessionId);
    session.biteAt = Date.now() - 200;

    const stolen = await call("reel", B, {
      sessionId: cast.sessionId,
      fishingSkill: 150,
      tensionAccuracy: 1,
      reactionMs: 1,
    });
    assert.equal(stolen.ok, false);
    assert.equal(stolen.reason, "session_not_found");
    assert.equal(getSession(cast.sessionId).resolved, false);
    const thiefRows = db.prepare(
      `SELECT COUNT(*) AS n FROM player_inventory WHERE user_id = 'user_b'`
    ).get();
    assert.equal(thiefRows.n, 0);

    const kept = await call("reel", A, { sessionId: cast.sessionId });
    assert.equal(kept.ok, true);
    assert.ok(kept.fish && kept.fish.id);
    const ownerRows = db.prepare(
      `SELECT COUNT(*) AS n FROM player_inventory WHERE user_id = 'user_a' AND item_type = 'raw_fish'`
    ).get();
    assert.equal(ownerRows.n, 1);
  });

  it("A's catches {userId:B} returns only A's rows", async () => {
    db.prepare(
      `INSERT INTO player_inventory (id, user_id, world_id, item_type, item_id, item_name)
       VALUES ('inv_a', 'user_a', 'concordia-hub', 'raw_fish', 'raw_fish:trout', 'Trout'),
              ('inv_b', 'user_b', 'concordia-hub', 'raw_fish', 'raw_fish:secret', 'Secret')`
    ).run();
    const log = await call("catches", A, { userId: "user_b" });
    assert.equal(log.ok, true);
    assert.equal(log.catches.length, 1);
    assert.equal(log.catches[0].item_id, "raw_fish:trout");
    assert.equal(JSON.stringify(log).includes("user_b"), false);
    assert.equal(JSON.stringify(log).includes("secret"), false);
  });

  it("client fishingSkill/tension/reaction cannot force a perfect catch", async () => {
    const cast = await call("cast", A, { worldId: "concordia-hub", biome: "water" });
    const session = getSession(cast.sessionId);
    session.biteAt = Date.now() - 50;
    const reel = await call("reel", A, {
      sessionId: cast.sessionId,
      fishingSkill: 150,
      tensionAccuracy: 1,
      reactionMs: 1,
    });
    assert.equal(reel.ok, true);
    assert.notEqual(reel.tier, "perfect");
    assert.ok(reel.qualityScore < 0.85);
  });
});
