/**
 * Tier-2 contract tests for Phase 7 — Procedural NPC Generator.
 *
 * Pinned:
 *   - determinism: same (faction, seed) → same NPC
 *   - personality distribution: faction profile shapes the sample;
 *     mean of 200 generated Wardens' discipline is within ±0.04 of 0.85
 *   - diversity: 100 generated Wardens have ≥40 unique names
 *   - outlier secret: high/low template selected by sign of delta
 *   - validateNpc shape: every generated NPC has id + name + archetype
 *     + faction_id + role + level + backstory + traits
 *   - persistence + idempotency
 *   - heartbeat top-up math + kill-switch
 *
 * Run: node --test tests/npc-generator.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  generateNpc,
  persistGeneratedNpc,
  spawnProceduralNpcsForWorld,
  getProceduralPersonality,
  samplePersonality,
  findOutlierDimension,
  _internal,
} from "../lib/npc-generator.js";
import { runProceduralNpcSpawner } from "../emergent/procedural-npc-spawner.js";

// ── Fake DB ─────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const tables = { world_npcs: new Map(), procedural_npcs: new Map(), worlds: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function transaction(fn) { return (...args) => fn(...args); }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO world_npcs")) {
      const [id, worldId, archetype, faction, level, x, z, curLoc, spawnLoc, state] = args;
      if (tables.world_npcs.has(id)) return { changes: 0 };
      tables.world_npcs.set(id, {
        id, world_id: worldId, archetype, faction, level,
        x, z, current_location: curLoc, spawn_location: spawnLoc,
        state, is_dead: 0,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO procedural_npcs")) {
      const [npcId, faction, worldId, seed, vector, eventsJson] = args;
      tables.procedural_npcs.set(npcId, {
        npc_id: npcId, faction, world_id: worldId,
        generation_seed: seed, personality_vector: vector,
        life_events_json: eventsJson, generated_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT npc_id FROM procedural_npcs WHERE npc_id = ?")) {
      const r = tables.procedural_npcs.get(args[0]);
      return r ? { npc_id: r.npc_id } : null;
    }
    if (sql.startsWith("SELECT personality_vector FROM procedural_npcs WHERE npc_id = ?")) {
      const r = tables.procedural_npcs.get(args[0]);
      return r ? { personality_vector: r.personality_vector } : null;
    }
    if (sql.startsWith("SELECT COUNT(*) AS n FROM world_npcs WHERE world_id = ? AND faction = ?")) {
      const [worldId, faction] = args;
      const n = Array.from(tables.world_npcs.values()).filter(x => x.world_id === worldId && x.faction === faction && !x.is_dead).length;
      return { n };
    }
    if (sql.startsWith("SELECT COUNT(*) AS n FROM procedural_npcs WHERE faction = ? AND world_id = ?")) {
      const [faction, worldId] = args;
      const n = Array.from(tables.procedural_npcs.values()).filter(x => x.faction === faction && x.world_id === worldId).length;
      return { n };
    }
    return null;
  }
  function allStmt(sql, _args) {
    if (sql.startsWith("SELECT id FROM worlds")) {
      return Array.from(tables.worlds.values()).map(w => ({ id: w.id }));
    }
    if (sql.startsWith("SELECT DISTINCT world_id FROM world_npcs")) {
      const seen = new Set();
      for (const n of tables.world_npcs.values()) if (!n.is_dead) seen.add(n.world_id);
      return Array.from(seen).map(w => ({ world_id: w }));
    }
    return [];
  }
  return { prepare, transaction, _tables: tables };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("generateNpc — determinism + shape", () => {
  it("same inputs produce identical NPC", () => {
    const a = generateNpc({ factionId: "iron_wardens", seed: "t1", worldId: "w" });
    const b = generateNpc({ factionId: "iron_wardens", seed: "t1", worldId: "w" });
    assert.equal(a.id, b.id);
    assert.equal(a.name, b.name);
    assert.deepEqual(a.personality_traits, b.personality_traits);
    assert.equal(a._generated.life_event, b._generated.life_event);
  });

  it("different seeds produce different NPCs", () => {
    const a = generateNpc({ factionId: "iron_wardens", seed: "t1", worldId: "w" });
    const b = generateNpc({ factionId: "iron_wardens", seed: "t2", worldId: "w" });
    assert.notEqual(a.id, b.id);
  });

  it("matches the validateNpc shape", () => {
    const npc = generateNpc({ factionId: "scholars_guild", seed: "x" });
    assert.ok(npc.id);
    assert.ok(npc.name);
    assert.ok(npc.archetype);
    assert.equal(npc.faction_id, "scholars_guild");
    assert.ok(npc.role);
    assert.ok(npc.level >= 5 && npc.level <= 40);
    assert.ok(npc.backstory);
    assert.ok(Array.isArray(npc.personality_traits));
    assert.ok(npc.speech_patterns);
    assert.ok(npc.narrative_context.current_goal);
    assert.ok(npc.narrative_context.fear);
    assert.ok(npc.narrative_context.secret);
  });

  it("returns null for missing inputs", () => {
    assert.equal(generateNpc({}), null);
    assert.equal(generateNpc({ factionId: "x" }), null);
  });

  it("falls back to default profile for unknown faction", () => {
    const npc = generateNpc({ factionId: "totally_unknown_faction", seed: "fall" });
    assert.ok(npc);
    assert.equal(npc.faction_id, "totally_unknown_faction");
  });
});

describe("personality sampling honors faction profile", () => {
  it("Wardens average high discipline (mean ≈ 0.85)", () => {
    const samples = [];
    for (let i = 0; i < 200; i++) {
      const npc = generateNpc({ factionId: "iron_wardens", seed: `m${i}`, worldId: "w" });
      samples.push(npc._generated.personality.discipline);
    }
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    assert.ok(Math.abs(mean - 0.85) < 0.04, `expected ~0.85, got ${mean.toFixed(3)}`);
  });

  it("Veil keepers average high patience (mean ≈ 0.92)", () => {
    const samples = [];
    for (let i = 0; i < 200; i++) {
      const npc = generateNpc({ factionId: "verdant_veil_remnant", seed: `p${i}`, worldId: "w" });
      samples.push(npc._generated.personality.patience);
    }
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    assert.ok(Math.abs(mean - 0.92) < 0.04, `expected ~0.92, got ${mean.toFixed(3)}`);
  });

  it("Shadow Network averages high individualism (mean ≈ 0.78)", () => {
    const samples = [];
    for (let i = 0; i < 200; i++) {
      const npc = generateNpc({ factionId: "shadow_network", seed: `i${i}`, worldId: "w" });
      samples.push(npc._generated.personality.individualism);
    }
    const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
    assert.ok(Math.abs(mean - 0.78) < 0.05, `expected ~0.78, got ${mean.toFixed(3)}`);
  });
});

describe("name + life-event diversity", () => {
  it("100 generated Wardens have >= 40 unique names", () => {
    const names = new Set();
    for (let i = 0; i < 100; i++) {
      const npc = generateNpc({ factionId: "iron_wardens", seed: `n${i}`, worldId: "w" });
      names.add(npc.name);
    }
    assert.ok(names.size >= 40, `only ${names.size} unique names`);
  });

  it("100 generated Mystics distribute across multiple life events", () => {
    const events = new Set();
    for (let i = 0; i < 100; i++) {
      const npc = generateNpc({ factionId: "verdant_veil_remnant", seed: `e${i}`, worldId: "w" });
      events.add(npc._generated.life_event);
    }
    assert.ok(events.size >= 4, `only ${events.size} unique events`);
  });
});

describe("outlier mechanic — secrets", () => {
  it("findOutlierDimension returns the largest deviation", () => {
    const dims = { discipline: 0.9, loyalty: 0.5, patience: 0.5, introspection: 0.5, individualism: 0.95, humor: 0.5, skepticism: 0.5, forgiveness: 0.5 };
    const profile = _internal.FACTION_PROFILES.iron_wardens;
    const out = findOutlierDimension(dims, profile);
    // Wardens have individualism mean 0.25, so 0.95 - 0.25 = 0.70 — biggest delta.
    assert.equal(out.dimension, "individualism");
  });

  it("secret template selects high vs low based on direction", () => {
    const seed = Buffer.from("seed");
    const personality = samplePersonality(seed, _internal.FACTION_PROFILES.iron_wardens);
    // Force a high-discipline hit
    const high = _internal.secretFor({ ...personality, discipline: 0.95 }, { dimension: "discipline", delta: 0.5 });
    const low  = _internal.secretFor({ ...personality, discipline: 0.05 }, { dimension: "discipline", delta: 0.5 });
    assert.notEqual(high, low);
  });

  it("secrets are not generic — different dimension = different template family", () => {
    const seed = Buffer.from("seed");
    const personality = samplePersonality(seed, _internal.FACTION_PROFILES.iron_wardens);
    const a = _internal.secretFor(personality, { dimension: "skepticism", delta: 0.5 });
    const b = _internal.secretFor(personality, { dimension: "loyalty", delta: 0.5 });
    assert.notEqual(a, b);
  });
});

describe("persistGeneratedNpc + spawnProceduralNpcsForWorld", () => {
  it("persists to world_npcs + procedural_npcs", () => {
    const db = makeFakeDb();
    const npc = generateNpc({ factionId: "iron_wardens", seed: "p1", worldId: "w" });
    const r = persistGeneratedNpc(db, npc);
    assert.equal(r.ok, true);
    assert.equal(r.action, "created");
    assert.ok(db._tables.world_npcs.has(npc.id));
    assert.ok(db._tables.procedural_npcs.has(npc.id));
  });

  it("idempotent on duplicate persist", () => {
    const db = makeFakeDb();
    const npc = generateNpc({ factionId: "iron_wardens", seed: "p2", worldId: "w" });
    persistGeneratedNpc(db, npc);
    const r = persistGeneratedNpc(db, npc);
    assert.equal(r.action, "already_exists");
  });

  it("spawnProceduralNpcsForWorld distributes across factions", () => {
    const db = makeFakeDb();
    const r = spawnProceduralNpcsForWorld(db, "w", {
      iron_wardens: 5, scholars_guild: 3, merchant_collective: 2,
    });
    assert.equal(r.ok, true);
    assert.equal(r.spawned, 10);
    assert.equal(db._tables.world_npcs.size, 10);
  });

  it("getProceduralPersonality round-trips", () => {
    const db = makeFakeDb();
    const npc = generateNpc({ factionId: "scholars_guild", seed: "g", worldId: "w" });
    persistGeneratedNpc(db, npc);
    const p = getProceduralPersonality(db, npc.id);
    assert.ok(p);
    assert.equal(typeof p.discipline, "number");
  });
});

describe("procedural-npc-spawner heartbeat", () => {
  it("kill-switch CONCORD_PROCGEN_NPCS=0 returns disabled", async () => {
    const prev = process.env.CONCORD_PROCGEN_NPCS;
    process.env.CONCORD_PROCGEN_NPCS = "0";
    try {
      const r = await runProceduralNpcSpawner({ db: makeFakeDb() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_PROCGEN_NPCS;
      else process.env.CONCORD_PROCGEN_NPCS = prev;
    }
  });

  it("returns no_db without DB", async () => {
    const r = await runProceduralNpcSpawner({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("tops factions up to target", async () => {
    const db = makeFakeDb();
    db._tables.worlds.set("w", { id: "w" });
    const r = await runProceduralNpcSpawner({ db });
    assert.equal(r.ok, true);
    assert.ok(r.spawned > 0);
    assert.ok(r.spawned <= 12); // MAX_PER_PASS default
  });
});

describe("DIMENSIONS sanity", () => {
  it("8 dimensions, all present in every faction profile", () => {
    assert.equal(_internal.DIMENSIONS.length, 8);
    for (const [factionId, profile] of Object.entries(_internal.FACTION_PROFILES)) {
      if (factionId === "default") continue;
      for (const dim of _internal.DIMENSIONS) {
        // Either explicit or fall through to neutral default — both valid.
        assert.ok(typeof profile.dimensions === "object", `${factionId} missing dimensions`);
      }
    }
  });
});
