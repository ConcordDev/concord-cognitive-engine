// Phase U2 — achievements.* macro surface (real migrated DB).
//
// Pins the read-only macro contract the gallery lens / ⌘K / invariant engine
// reach through runMacro: list (catalog), get (one entry), mine (actor's
// earned), recent (non-hidden unlocks). Unlocks are server-side only; these
// macros never write.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  initAchievementCatalog,
  unlockAchievement,
  _resetAchievementCatalog,
} from "../lib/achievement-engine.js";
import registerAchievementMacros from "../domains/achievements.js";

/** Collect the registered macros into a callable map. */
function buildMacros() {
  const macros = new Map();
  registerAchievementMacros((domain, name, handler) => {
    macros.set(`${domain}.${name}`, handler);
  });
  return macros;
}

function seedUser(db, id) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at)
     VALUES (?, ?, ?, 'x', unixepoch())`,
  ).run(id, `u_${id}`, `${id}@example.test`);
}

describe("achievements.* macros (real migrated DB)", () => {
  let db, macros;
  beforeEach(async () => {
    _resetAchievementCatalog();
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1");
    initAchievementCatalog(db);
    macros = buildMacros();
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } _resetAchievementCatalog(); });

  const ctx = (userId) => ({ db, actor: { userId } });

  it("registers list/get/mine/recent", () => {
    for (const k of ["achievements.list", "achievements.get", "achievements.mine", "achievements.recent"]) {
      assert.ok(macros.has(k), `missing ${k}`);
    }
  });

  it("list returns the authored catalog with display fields", async () => {
    const r = await macros.get("achievements.list")(ctx(), {});
    assert.equal(r.ok, true);
    assert.ok(r.catalog.length >= 38);
    const fb = r.catalog.find((a) => a.id === "first_blood");
    assert.deepEqual(
      { id: fb.id, category: fb.category, rarity: fb.rarity, rewardSparks: fb.rewardSparks },
      { id: "first_blood", category: "combat", rarity: "bronze", rewardSparks: 5 },
    );
  });

  it("list filters by category", async () => {
    const r = await macros.get("achievements.list")(ctx(), { category: "economy" });
    assert.equal(r.ok, true);
    assert.ok(r.catalog.length > 0);
    assert.ok(r.catalog.every((a) => a.category === "economy"));
  });

  it("get returns one entry / rejects unknown + missing id", async () => {
    const ok = await macros.get("achievements.get")(ctx(), { id: "first_blood" });
    assert.equal(ok.ok, true);
    assert.equal(ok.achievement.title, "First Blood");
    const unknown = await macros.get("achievements.get")(ctx(), { id: "nope" });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "unknown_achievement");
    const missing = await macros.get("achievements.get")(ctx(), {});
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "missing_id");
  });

  it("mine returns the actor's earned achievements; empty when none", async () => {
    const empty = await macros.get("achievements.mine")(ctx("u1"), {});
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.earned, []);
    unlockAchievement(db, "u1", "first_blood");
    const r = await macros.get("achievements.mine")(ctx("u1"), {});
    assert.equal(r.earned.length, 1);
    assert.equal(r.earned[0].achievement_id, "first_blood");
  });

  it("mine requires a user", async () => {
    const r = await macros.get("achievements.mine")({ db }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("recent excludes hidden unlocks", async () => {
    unlockAchievement(db, "u1", "first_blood"); // visible
    // legendary_combatant is hidden
    unlockAchievement(db, "u1", "legendary_combatant");
    const r = await macros.get("achievements.recent")(ctx("u1"), {});
    assert.equal(r.ok, true);
    assert.ok(r.recent.some((e) => e.achievement_id === "first_blood"));
    assert.ok(!r.recent.some((e) => e.achievement_id === "legendary_combatant"));
  });

  it("macros are read-only — calling list/mine never mutates player_achievements", async () => {
    const before = db.prepare(`SELECT COUNT(*) n FROM player_achievements`).get().n;
    await macros.get("achievements.list")(ctx("u1"), {});
    await macros.get("achievements.mine")(ctx("u1"), {});
    await macros.get("achievements.recent")(ctx("u1"), {});
    const after = db.prepare(`SELECT COUNT(*) n FROM player_achievements`).get().n;
    assert.equal(after, before);
  });
});
