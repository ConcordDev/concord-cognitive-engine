// Phase U2 — achievement engine.
//
// Pins: (1) catalog loads from content/achievements/*.json,
// (2) evaluateAchievement unlocks on event match with subset condition,
// (3) unlock is idempotent on (user, achievement),
// (4) stat-threshold trigger unlocks when value ≥ threshold,
// (5) hidden achievements still unlock but stay hidden in catalog list,
// (6) rewards (CC + title) are applied on unlock.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  initAchievementCatalog,
  evaluateAchievement,
  evaluateStatThreshold,
  unlockAchievement,
  listEarned,
  listCatalog,
  _resetAchievementCatalog,
} from "../lib/achievement-engine.js";

function memDb() {
  const t = {
    catalog: new Map(),
    triggers: [],
    earned: new Map(),  // `${userId}|${achievementId}` → row
    titles: [],
    wallets: new Map(),
    ledger: [],
  };
  function _trim(s) { return String(s).replace(/\s+/g, " ").trim(); }
  function _run(sql, args) {
    const n = _trim(sql);
    if (n.startsWith("INSERT INTO achievement_catalog")) {
      const [id, title, description, category, icon, rarity, hidden, rewardIds, rewardCc, rewardTitle] = args;
      t.catalog.set(id, { id, title, description, category, icon, rarity, hidden, reward_dtu_ids: rewardIds, reward_cc: rewardCc, reward_title: rewardTitle });
      return { changes: 1 };
    }
    if (n.startsWith("DELETE FROM achievement_triggers")) {
      t.triggers = t.triggers.filter(x => x.achievement_id !== args[0]);
      return { changes: 1 };
    }
    if (n.startsWith("INSERT INTO achievement_triggers")) {
      const [achievementId, kind, condition] = args;
      t.triggers.push({ achievement_id: achievementId, kind, condition });
      return { changes: 1 };
    }
    if (n.startsWith("INSERT INTO player_achievements")) {
      const [userId, achievementId] = args;
      const k = `${userId}|${achievementId}`;
      if (t.earned.has(k)) return { changes: 0 };
      t.earned.set(k, { player_id: userId, achievement_id: achievementId, earned_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    // Gameplay rewards = SPARKS (users.sparks + sparks_ledger via awardSparks).
    if (n.startsWith("UPDATE users SET sparks = sparks + ?")) {
      const [amount, userId] = args;
      t.wallets.set(userId, (t.wallets.get(userId) || 0) + amount);
      return { changes: 1 };
    }
    if (n.startsWith("INSERT INTO sparks_ledger")) {
      t.ledger.push({ userId: args[1], amount: args[2], reason: args[3] });
      return { changes: 1 };
    }
    if (n.startsWith("INSERT INTO player_titles")) {
      // SQL binds 4 params: (id, user_id, world_id, title). world_id is the
      // account-wide sentinel; ON CONFLICT (user_id, world_id, title) is a no-op
      // on re-grant.
      const [id, userId, worldId, title] = args;
      const dup = t.titles.some(x => x.userId === userId && x.worldId === worldId && x.title === title);
      if (dup) return { changes: 0 };
      t.titles.push({ id, userId, worldId, title });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function _all(sql, args) {
    const n = _trim(sql);
    if (n.includes("FROM player_achievements pa") && n.includes("pa.player_id = ?")) {
      const userId = args[0];
      return [...t.earned.values()].filter(e => e.player_id === userId).map(e => {
        const c = t.catalog.get(e.achievement_id) || {};
        return { achievement_id: e.achievement_id, earned_at: e.earned_at, title: c.title, description: c.description, category: c.category, icon: c.icon, rarity: c.rarity, rewardSparks: c.reward_cc, rewardTitle: c.reward_title };
      });
    }
    return [];
  }
  return {
    prepare(sql) {
      return {
        run: (...args) => _run(sql, args),
        all: (...args) => _all(sql, args),
        get: () => null,
      };
    },
    _t: t,
  };
}

describe("Phase U2 — achievement engine", () => {
  let db;
  beforeEach(() => {
    _resetAchievementCatalog();
    db = memDb();
  });

  it("catalog loads from authored JSON files", () => {
    const r = initAchievementCatalog(db);
    assert.ok(r.count > 0);
    // Spot-check a known authored entry.
    const catalog = listCatalog();
    const firstBlood = catalog.find(a => a.id === "first_blood");
    assert.ok(firstBlood, "first_blood should be loaded");
    assert.equal(firstBlood.category, "combat");
  });

  it("evaluateAchievement unlocks on event match", () => {
    initAchievementCatalog(db);
    const r = evaluateAchievement(db, "u1", "combat:hit", { isPlayer: true });
    assert.ok(r.unlocked.length > 0);
    assert.ok(r.unlocked.some(u => u.id === "first_blood"));
  });

  it("evaluateAchievement respects subset-match condition", () => {
    initAchievementCatalog(db);
    // tournament_winner has condition { placement: 1 }; placement 2 should not match.
    const r2 = evaluateAchievement(db, "u1", "tournament:complete", { placement: 2 });
    assert.ok(!r2.unlocked.some(u => u.id === "tournament_winner"));
    const r1 = evaluateAchievement(db, "u1", "tournament:complete", { placement: 1 });
    assert.ok(r1.unlocked.some(u => u.id === "tournament_winner"));
  });

  it("unlock is idempotent on (user, achievement)", () => {
    initAchievementCatalog(db);
    const r1 = evaluateAchievement(db, "u1", "combat:kill", {});
    const r2 = evaluateAchievement(db, "u1", "combat:kill", {});
    assert.ok(r1.unlocked.some(u => u.id === "first_kill"));
    assert.ok(!r2.unlocked.some(u => u.id === "first_kill"));
  });

  it("stat-threshold trigger fires when value ≥ threshold", () => {
    initAchievementCatalog(db);
    const r = evaluateStatThreshold(db, "u1", "duels_won", 25);
    assert.ok(r.unlocked.some(u => u.id === "duel_champion"));
  });

  it("stat-threshold trigger doesn't fire below threshold", () => {
    initAchievementCatalog(db);
    const r = evaluateStatThreshold(db, "u1", "duels_won", 24);
    assert.equal(r.unlocked.length, 0);
  });

  it("hidden achievements unlock normally + appear in earned listing", () => {
    initAchievementCatalog(db);
    // legendary_combatant has hidden: true.
    const r = evaluateStatThreshold(db, "u1", "fights_won", 1000);
    assert.ok(r.unlocked.some(u => u.id === "legendary_combatant"));
    const earned = listEarned(db, "u1");
    assert.ok(earned.some(e => e.achievement_id === "legendary_combatant"));
  });

  it("sparks rewards credit on unlock (gameplay = sparks, never CC)", () => {
    initAchievementCatalog(db);
    evaluateAchievement(db, "u1", "combat:hit", { isPlayer: true });
    // first_blood has rewardSparks: 5
    assert.equal(db._t.wallets.get("u1"), 5);
  });

  it("title rewards insert into player_titles", () => {
    initAchievementCatalog(db);
    evaluateStatThreshold(db, "u1", "duels_won", 25);
    // duel_champion has rewardTitle: "the Duelist"
    assert.ok(db._t.titles.some(t => t.userId === "u1" && t.title === "the Duelist"));
  });

  it("worldIdPrefix condition matches by string prefix", () => {
    initAchievementCatalog(db);
    // ugc_explorer needs worldIdPrefix: "usergen-"
    const noMatch = evaluateAchievement(db, "u1", "user:traveled", { worldId: "tunya" });
    assert.ok(!noMatch.unlocked.some(u => u.id === "ugc_explorer"));
    const match = evaluateAchievement(db, "u2", "user:traveled", { worldId: "usergen-my-cool-world" });
    assert.ok(match.unlocked.some(u => u.id === "ugc_explorer"));
  });
});
