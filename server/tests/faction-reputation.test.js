// Phase U4 — faction reputation aggregate.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  scoreToTier,
  tierToNumeric,
  computeFactionReputation,
  getFactionReputation,
  refreshFactionReputationCache,
  hasReputationTier,
} from "../lib/faction-reputation.js";

function memDb() {
  const t = {
    opinions: [],  // { npc_id, target_kind, target_id, score }
    npcs: new Map(),  // { id, faction, world_id }
    cache: new Map(),  // `${userId}|${worldId}|${factionId}` → row
  };
  function _trim(s) { return String(s).replace(/\s+/g, " ").trim(); }
  return {
    prepare(sql) {
      const n = _trim(sql);
      return {
        run: (...args) => {
          if (n.startsWith("INSERT INTO player_faction_reputation_cache")) {
            const [userId, worldId, factionId, score, tier, oc] = args;
            const k = `${userId}|${worldId}|${factionId}`;
            t.cache.set(k, { user_id: userId, world_id: worldId, faction_id: factionId, score, tier, opinion_count: oc, updated_at: Math.floor(Date.now() / 1000) });
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (n.includes("SELECT AVG(co.score) AS avgScore")) {
            const [targetId, factionId, worldArg1, worldArg2] = args;
            const worldId = worldArg1; // ? IS NULL means worldArg passed as null
            const matching = t.opinions
              .filter(o => o.target_kind === "player" && o.target_id === targetId)
              .filter(o => {
                const npc = t.npcs.get(o.npc_id);
                if (!npc || npc.faction !== factionId) return false;
                if (worldId && npc.world_id !== worldId) return false;
                return true;
              });
            if (matching.length === 0) return { avgScore: null, n: 0 };
            const sum = matching.reduce((s, o) => s + o.score, 0);
            return { avgScore: sum / matching.length, n: matching.length };
          }
          if (n.startsWith("SELECT score, tier, opinion_count AS opinionCount, updated_at AS updatedAt FROM player_faction_reputation_cache")) {
            const [userId, factionId, worldId] = args;
            const k = `${userId}|${worldId}|${factionId}`;
            const row = t.cache.get(k);
            return row ? { score: row.score, tier: row.tier, opinionCount: row.opinion_count, updatedAt: row.updated_at } : null;
          }
          return null;
        },
        all: (...args) => {
          if (n.includes("SELECT DISTINCT co.target_id AS userId")) {
            const tuples = new Map();
            for (const o of t.opinions) {
              if (o.target_kind !== "player") continue;
              const npc = t.npcs.get(o.npc_id);
              if (!npc || !npc.faction) continue;
              const k = `${o.target_id}|${npc.world_id}|${npc.faction}`;
              tuples.set(k, { userId: o.target_id, worldId: npc.world_id, factionId: npc.faction });
            }
            return [...tuples.values()];
          }
          if (n.includes("FROM player_faction_reputation_cache") && n.includes("user_id = ?")) {
            const [userId] = args;
            return [...t.cache.values()]
              .filter(r => r.user_id === userId)
              .map(r => ({ factionId: r.faction_id, worldId: r.world_id, score: r.score, tier: r.tier, opinionCount: r.opinion_count, updatedAt: r.updated_at }));
          }
          return [];
        },
      };
    },
    _seedNpc(id, factionId, worldId) {
      t.npcs.set(id, { id, faction: factionId, world_id: worldId });
    },
    _seedOpinion(npcId, targetId, score) {
      t.opinions.push({ npc_id: npcId, target_kind: "player", target_id: targetId, score });
    },
    _t: t,
  };
}

describe("Phase U4 — faction reputation", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("scoreToTier maps thresholds correctly", () => {
    assert.equal(scoreToTier(-80), "hated");
    assert.equal(scoreToTier(-30), "hostile");
    assert.equal(scoreToTier(0), "neutral");
    assert.equal(scoreToTier(25), "friendly");
    assert.equal(scoreToTier(50), "honored");
    assert.equal(scoreToTier(85), "exalted");
    assert.equal(scoreToTier(-101), "hated");  // clamped
    assert.equal(scoreToTier(101), "exalted");  // clamped
  });

  it("tierToNumeric returns ordered values", () => {
    assert.ok(tierToNumeric("exalted") > tierToNumeric("honored"));
    assert.ok(tierToNumeric("honored") > tierToNumeric("friendly"));
    assert.ok(tierToNumeric("neutral") > tierToNumeric("hostile"));
  });

  it("computeFactionReputation averages opinion scores", () => {
    db._seedNpc("n1", "order-risen", "fantasy");
    db._seedNpc("n2", "order-risen", "fantasy");
    db._seedNpc("n3", "iron-band", "fantasy");
    db._seedOpinion("n1", "u1", 80);
    db._seedOpinion("n2", "u1", 60);
    db._seedOpinion("n3", "u1", -50);  // different faction; ignored
    const rep = computeFactionReputation(db, "u1", "order-risen", "fantasy");
    assert.equal(rep.score, 70);
    assert.equal(rep.tier, "honored");
    assert.equal(rep.opinionCount, 2);
  });

  it("refresh writes to cache; getFactionReputation reads it", () => {
    db._seedNpc("n1", "order-risen", "fantasy");
    db._seedOpinion("n1", "u1", 90);
    const refreshResult = refreshFactionReputationCache(db);
    assert.equal(refreshResult.refreshed, 1);
    const rep = getFactionReputation(db, "u1", "order-risen", "fantasy");
    assert.equal(rep.tier, "exalted");
    assert.equal(rep.score, 90);
  });

  it("hasReputationTier compares hierarchically", () => {
    db._seedNpc("n1", "order-risen", "fantasy");
    db._seedOpinion("n1", "u1", 50);
    refreshFactionReputationCache(db);
    assert.equal(hasReputationTier(db, "u1", "order-risen", "fantasy", "friendly"), true);
    assert.equal(hasReputationTier(db, "u1", "order-risen", "fantasy", "honored"), true);
    assert.equal(hasReputationTier(db, "u1", "order-risen", "fantasy", "exalted"), false);
  });

  it("missing world matches all worlds", () => {
    db._seedNpc("n1", "order-risen", "fantasy");
    db._seedOpinion("n1", "u1", 60);
    // Pass worldId=null → matches NPCs in any world
    const rep = computeFactionReputation(db, "u1", "order-risen", null);
    assert.equal(rep.opinionCount, 1);
  });
});
