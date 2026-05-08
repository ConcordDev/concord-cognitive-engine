/**
 * Tier-2 contract tests for Phase 1 — Skill Evolution.
 *
 * The lifelong content engine for player + NPC progression. Each contract
 * pinned here is load-bearing for the marathon-progression vision (Sovereign
 * at level 20,000 = 2,000 chained revisions).
 *
 * Invariants tested:
 *   1. Deterministic envelope is monotonic in revision_num.
 *   2. LLM-proposed max_damage is bounded by REVISION_LLM_CEILING × envelope.
 *   3. Coherence validator rejects element family jumps (water → fire).
 *   4. Coherence validator rejects name lineage breaks.
 *   5. tryUnlockEvolution fires exactly once per crossed 10-level boundary.
 *   6. NPC-authored recipes persist with author_kind='npc' in meta.
 *   7. autoEvolveNpcSkills never throws + applies pending unlocks.
 *   8. seedNamedCharacterLineage is deterministic given the same seed.
 *
 * Run: node --test tests/skill-evolution.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  composeDeterministicEvolution,
  validateRevisionCoherence,
  applyEvolution,
  tryUnlockEvolution,
  listPendingUnlocks,
  getEvolutionHistory,
  computeAnimationTier,
  evaluateLimbReadiness,
  _internal,
} from "../lib/skill-evolution.js";

import {
  ensureNpcAuthoredSkills,
  autoEvolveNpcSkills,
  seedNamedCharacterLineage,
  _internal as npcInternal,
} from "../lib/npc-skill-author.js";

import { runNpcSkillEvolveCycle } from "../emergent/npc-skill-evolve-cycle.js";

// ── In-memory DB harness (no better-sqlite3 dependency in test env) ─────────

function makeFakeDb() {
  // Minimal stub that captures inserts/updates/selects against the tables
  // the engine touches. Backed by JS Maps so tests can assert state.
  const tables = {
    dtus: new Map(),
    skill_revisions: new Map(),
    skill_evolution_unlocks: new Map(),
    world_npcs: new Map(),
  };

  function prepare(sql) {
    const trimmed = sql.replace(/\s+/g, " ").trim();
    return {
      run(...args) {
        return runStmt(trimmed, args);
      },
      get(...args) {
        return getStmt(trimmed, args);
      },
      all(...args) {
        return allStmt(trimmed, args);
      },
    };
  }

  function transaction(fn) {
    return (...args) => fn(...args);
  }

  function runStmt(sql, args) {
    if (sql.startsWith("INSERT OR IGNORE INTO skill_evolution_unlocks")) {
      const [id, entityKind, entityId, recipeDtuId, levelAtUnlock] = args;
      const k = `${entityKind}:${entityId}:${recipeDtuId}:${levelAtUnlock}`;
      if (tables.skill_evolution_unlocks.has(k)) return { changes: 0 };
      tables.skill_evolution_unlocks.set(k, {
        id, entity_kind: entityKind, entity_id: entityId,
        recipe_dtu_id: recipeDtuId, level_at_unlock: levelAtUnlock,
        unlocked_at: Math.floor(Date.now() / 1000),
        completed_at: null, revision_id: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO skill_revisions")) {
      const id = args[0];
      tables.skill_revisions.set(id, {
        id,
        recipe_dtu_id: args[1], revision_num: args[2], level_at_revision: args[3],
        author_kind: args[4], author_id: args[5], description: args[6], composer: args[7],
        max_damage_before: args[8], max_damage_after: args[9],
        range_m_before: args[10], range_m_after: args[11],
        costs_json: args[12], effect_delta_json: args[13],
        name_before: args[14], name_after: args[15],
        status: "applied", created_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE dtus SET meta_json = ?")) {
      const [metaJson, id] = args;
      const row = tables.dtus.get(id);
      if (row) row.meta_json = metaJson;
      return { changes: row ? 1 : 0 };
    }
    if (sql.startsWith("INSERT OR IGNORE INTO dtus")) {
      const [id, kind, title, creator_id, meta_json, skill_level] = args;
      if (tables.dtus.has(id)) return { changes: 0 };
      tables.dtus.set(id, { id, kind, title, creator_id, meta_json, skill_level, total_experience: 0 });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE skill_evolution_unlocks SET completed_at")) {
      // Two shapes: by id; or by (kind, id, recipe, ...).
      if (sql.includes("WHERE id = ?")) {
        const [revisionId, id] = args;
        for (const u of tables.skill_evolution_unlocks.values()) {
          if (u.id === id) { u.completed_at = Math.floor(Date.now() / 1000); u.revision_id = revisionId; }
        }
      } else {
        const [revisionId, entityKind, entityId, recipeId] = args;
        for (const u of tables.skill_evolution_unlocks.values()) {
          if (u.entity_kind === entityKind && u.entity_id === entityId
              && u.recipe_dtu_id === recipeId && u.completed_at == null) {
            u.completed_at = Math.floor(Date.now() / 1000); u.revision_id = revisionId; break;
          }
        }
      }
      return { changes: 1 };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM dtus WHERE id = ?")) {
      return tables.dtus.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT id FROM skill_evolution_unlocks")) {
      const [entityKind, entityId, recipeId, level] = args;
      const k = `${entityKind}:${entityId}:${recipeId}:${level}`;
      const row = tables.skill_evolution_unlocks.get(k);
      return row ? { id: row.id } : null;
    }
    if (sql.startsWith("SELECT id FROM dtus WHERE creator_id = ?")) {
      const [creatorId, like] = args;
      for (const r of tables.dtus.values()) {
        if (r.creator_id === creatorId && (r.meta_json || "").includes('"author_kind":"npc"')) return { id: r.id };
      }
      return null;
    }
    if (sql.startsWith("SELECT * FROM dtus WHERE creator_id = ?")) {
      for (const r of tables.dtus.values()) {
        if (r.creator_id === args[0] && (r.meta_json || "").includes('"author_kind":"npc"')) return r;
      }
      return null;
    }
    if (sql.startsWith("SELECT * FROM world_npcs WHERE id = ?")) {
      return tables.world_npcs.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT COUNT(*) AS n FROM skill_revisions")) {
      let n = 0;
      for (const r of tables.skill_revisions.values()) {
        if (r.recipe_dtu_id === args[0] && r.status === "applied") n++;
      }
      return { n };
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM skill_evolution_unlocks WHERE entity_kind")) {
      const [kind, id] = args;
      return Array.from(tables.skill_evolution_unlocks.values())
        .filter(u => u.entity_kind === kind && u.entity_id === id && u.completed_at == null);
    }
    if (sql.startsWith("SELECT id, recipe_dtu_id, level_at_unlock FROM skill_evolution_unlocks")) {
      const [id] = args;
      return Array.from(tables.skill_evolution_unlocks.values())
        .filter(u => u.entity_kind === "npc" && u.entity_id === id && u.completed_at == null)
        .slice(0, args[1] || 5);
    }
    if (sql.startsWith("SELECT DISTINCT entity_id FROM skill_evolution_unlocks")) {
      const seen = new Set();
      for (const u of tables.skill_evolution_unlocks.values()) {
        if (u.entity_kind === "npc" && u.completed_at == null) seen.add(u.entity_id);
      }
      return Array.from(seen).map(id => ({ entity_id: id }));
    }
    if (sql.startsWith("SELECT id, name, archetype, faction, level FROM world_npcs")) {
      return Array.from(tables.world_npcs.values()).filter(n => (n.level ?? 0) >= 5).slice(0, args[0] || 50);
    }
    if (sql.startsWith("SELECT name_after, description, revision_num FROM skill_revisions")) {
      const [recipeId] = args;
      return Array.from(tables.skill_revisions.values())
        .filter(r => r.recipe_dtu_id === recipeId && r.status === "applied")
        .sort((a, b) => a.revision_num - b.revision_num);
    }
    if (sql.startsWith("SELECT id, revision_num, level_at_revision, author_kind, author_id, description, composer, max_damage_before, max_damage_after, name_before, name_after, created_at FROM skill_revisions")) {
      const [recipeId] = args;
      return Array.from(tables.skill_revisions.values())
        .filter(r => r.recipe_dtu_id === recipeId && r.status === "applied")
        .sort((a, b) => a.revision_num - b.revision_num);
    }
    return [];
  }

  return { prepare, transaction, _tables: tables };
}

function makeRecipe(db, opts = {}) {
  const id = opts.id || "rcpt:water_gun:01";
  const meta = {
    author_kind: "player",
    skill_kind: "fighting_style",
    element: "water",
    name: opts.name || "water_gun",
    current_name: opts.name || "water_gun",
    revision_num: opts.revisionNum || 0,
    revision_history: opts.history || [],
    max_damage: opts.maxDamage || 10,
    range_m: opts.rangeM || 5,
    costs: { stamina: 4, mana: 0, cooldown_s: 6 },
    formula: "(basePower + level * 0.5) * envBoost",
  };
  db._tables.dtus.set(id, {
    id, kind: "fighting_style_recipe", title: meta.name,
    creator_id: opts.creatorId || "user:test",
    meta_json: JSON.stringify(meta),
    skill_level: opts.level || 10,
    total_experience: 0,
  });
  return id;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("composeDeterministicEvolution", () => {
  it("envelope is monotonic in revision_num", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    let recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);

    let lastDamage = 0;
    for (let i = 0; i < 5; i++) {
      const ev = composeDeterministicEvolution(recipe, (i + 1) * 10, "tier up", [], "player");
      assert.ok(ev.maxDamageAfter >= ev.maxDamageBefore, `damage regressed at ${i}`);
      assert.ok(ev.maxDamageAfter > lastDamage, `damage not monotonic at revision ${i}: ${ev.maxDamageAfter} <= ${lastDamage}`);
      const r = applyEvolution(db, "player", "user:test", ev);
      assert.equal(r.ok, true);
      lastDamage = ev.maxDamageAfter;
      recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    }
  });

  it("name lineage is preserved (Jaccard ≥ 0.25)", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db, { name: "water_gun" });
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    const ev = composeDeterministicEvolution(recipe, 10, "press tighter", [], "player");
    const overlap = _internal.nameTokenOverlap(ev.nameBefore, ev.nameAfter);
    assert.ok(overlap >= _internal.NAME_LINEAGE_MIN_OVERLAP, `name lineage broken: ${overlap}`);
  });
});

describe("validateRevisionCoherence", () => {
  it("rejects type-jump (water → fire)", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    const ev = composeDeterministicEvolution(recipe, 10, "shift", [], "player");
    ev.elementHint = "fire";
    const r = validateRevisionCoherence(recipe, ev, []);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "type_jump_unsupported");
  });

  it("accepts element-family progression (water → ice)", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    const ev = composeDeterministicEvolution(recipe, 10, "freeze", [], "player");
    ev.elementHint = "ice";
    const r = validateRevisionCoherence(recipe, ev, []);
    assert.equal(r.ok, true);
  });

  it("rejects max_damage above LLM ceiling", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    const ev = composeDeterministicEvolution(recipe, 10, "ten times stronger", [], "player");
    ev.maxDamageAfter = ev.maxDamageBefore * 10;
    const r = validateRevisionCoherence(recipe, ev, []);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "max_damage_exceeds_envelope");
  });

  it("rejects name lineage break", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    const ev = composeDeterministicEvolution(recipe, 10, "rebrand", [], "player");
    ev.nameAfter = "completely_unrelated_thing";
    const r = validateRevisionCoherence(recipe, ev, []);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "name_lineage_broken");
  });
});

describe("tryUnlockEvolution", () => {
  it("fires exactly once per crossed 10-level boundary", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    const r1 = tryUnlockEvolution(db, "player", "user:test", recipeId, 8, 12);
    assert.equal(r1.unlocked, true);
    assert.equal(r1.level, 10);
    // Same boundary again — UNIQUE conflict, not a new unlock
    const r2 = tryUnlockEvolution(db, "player", "user:test", recipeId, 11, 13);
    assert.equal(r2.unlocked, false);
  });

  it("does not fire when level doesn't cross a tier", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    const r = tryUnlockEvolution(db, "player", "user:test", recipeId, 12, 18);
    assert.equal(r.unlocked, false);
  });

  it("listPendingUnlocks returns the open unlock", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    tryUnlockEvolution(db, "player", "user:test", recipeId, 8, 12);
    const pending = listPendingUnlocks(db, "player", "user:test");
    assert.equal(pending.length, 1);
    assert.equal(pending[0].level_at_unlock, 10);
  });
});

describe("applyEvolution + getEvolutionHistory", () => {
  it("applies a revision + writes history + mutates recipe meta", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    const ev = composeDeterministicEvolution(recipe, 10, "pressurise", [], "player");
    const r = applyEvolution(db, "player", "user:test", ev);
    assert.equal(r.ok, true);
    const history = getEvolutionHistory(db, recipeId);
    assert.equal(history.length, 1);
    const updated = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    const meta = JSON.parse(updated.meta_json);
    assert.equal(meta.revision_num, 1);
    assert.equal(meta.current_name, ev.nameAfter);
    assert.equal(meta.max_damage, ev.maxDamageAfter);
  });
});

describe("NPC skill author + auto-evolve cycle", () => {
  it("ensureNpcAuthoredSkills creates a recipe at milestone level", () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:k1", { id: "npc:k1", name: "Kael Torchlight", archetype: "warrior", faction: "pinewood_coalition", level: 25 });
    const r = ensureNpcAuthoredSkills(db, db._tables.world_npcs.get("npc:k1"));
    assert.equal(r.ok, true);
    // Two milestones crossed: lvl 5 and 25 → should have created at least one recipe
    assert.ok(r.touched.length >= 1);
    const created = r.touched.find(t => t.action === "authored");
    assert.ok(created);
    const recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(created.id);
    const meta = JSON.parse(recipe.meta_json);
    assert.equal(meta.author_kind, "npc");
    assert.equal(meta.skill_kind, "fighting_style");
  });

  it("autoEvolveNpcSkills applies pending unlocks", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:k2", { id: "npc:k2", name: "Test", archetype: "scholar", faction: "void_archive", level: 25 });
    ensureNpcAuthoredSkills(db, db._tables.world_npcs.get("npc:k2"));
    const recipe = db.prepare("SELECT * FROM dtus WHERE creator_id = ? LIMIT 1").get("npc:k2");
    assert.ok(recipe);
    tryUnlockEvolution(db, "npc", "npc:k2", recipe.id, 8, 12);
    const r = await autoEvolveNpcSkills(db, "npc:k2");
    assert.equal(r.applied, 1);
    const history = getEvolutionHistory(db, recipe.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].author_kind, "npc");
  });

  it("seedNamedCharacterLineage is deterministic given seed", () => {
    const db1 = makeFakeDb();
    const db2 = makeFakeDb();
    db1._tables.world_npcs.set("npc:sov", { id: "npc:sov", name: "Sovereign", archetype: "refusal_keeper", level: 20000 });
    db2._tables.world_npcs.set("npc:sov", { id: "npc:sov", name: "Sovereign", archetype: "refusal_keeper", level: 20000 });
    const r1 = seedNamedCharacterLineage(db1, "npc:sov", 5);
    const r2 = seedNamedCharacterLineage(db2, "npc:sov", 5);
    assert.equal(r1.seeded, 5);
    assert.equal(r2.seeded, 5);
    const h1 = getEvolutionHistory(db1, r1.recipeId);
    const h2 = getEvolutionHistory(db2, r2.recipeId);
    assert.equal(h1.length, 5);
    assert.equal(h2.length, 5);
    // Names + damages must match across DBs given the same seed.
    for (let i = 0; i < h1.length; i++) {
      assert.equal(h1[i].name_after, h2[i].name_after, `revision ${i} name diverged`);
      assert.equal(h1[i].max_damage_after, h2[i].max_damage_after, `revision ${i} damage diverged`);
    }
  });
});

describe("npc-skill-evolve-cycle heartbeat", () => {
  it("returns ok and never throws with no DB", async () => {
    const r = await runNpcSkillEvolveCycle({});
    assert.equal(typeof r === "object" && r !== null, true);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("returns ok with a populated db", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:k3", { id: "npc:k3", name: "T", archetype: "guard", level: 25 });
    const r = await runNpcSkillEvolveCycle({ db });
    assert.equal(r.ok, true);
  });

  it("respects CONCORD_NPC_SKILL_EVOLVE=0", async () => {
    const prev = process.env.CONCORD_NPC_SKILL_EVOLVE;
    process.env.CONCORD_NPC_SKILL_EVOLVE = "0";
    try {
      const db = makeFakeDb();
      const r = await runNpcSkillEvolveCycle({ db });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_NPC_SKILL_EVOLVE;
      else process.env.CONCORD_NPC_SKILL_EVOLVE = prev;
    }
  });
});

describe("Biomechanics integration", () => {
  it("computeAnimationTier maps revision_num to 1..5 scale (clamped at 5)", () => {
    assert.equal(computeAnimationTier(0),    1);
    assert.equal(computeAnimationTier(4),    1);
    assert.equal(computeAnimationTier(5),    2);
    assert.equal(computeAnimationTier(15),   3);
    assert.equal(computeAnimationTier(50),   4);
    assert.equal(computeAnimationTier(150),  5);
    assert.equal(computeAnimationTier(2000), 5);    // godlike characters cap at 5 visually
  });

  it("recipe meta carries animation_tier through evolution", () => {
    const db = makeFakeDb();
    const recipeId = makeRecipe(db);
    let recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    // 6 revisions should bump tier from 1 → 2.
    for (let i = 0; i < 6; i++) {
      const ev = composeDeterministicEvolution(recipe, (i + 1) * 10, "tier up", [], "player");
      applyEvolution(db, "player", "user:test", ev);
      recipe = db.prepare("SELECT * FROM dtus WHERE id = ?").get(recipeId);
    }
    const meta = JSON.parse(recipe.meta_json);
    assert.equal(meta.animation_tier, 2, "after 6 revisions tier should be 2");
  });

  it("evaluateLimbReadiness — full readiness when no debuffs", () => {
    const r = evaluateLimbReadiness(
      { skill_kind: "fighting_style", requiredLimbs: ["right_arm"] },
      { activeDebuffs: new Set(), limbHealth: { right_arm: 100 } },
    );
    assert.equal(r.ok, true);
    assert.equal(r.dmgMul, 1.0);
    assert.equal(r.staggerMs, 0);
  });

  it("evaluateLimbReadiness — broken arm cuts damage to 30% on a fighting style", () => {
    const r = evaluateLimbReadiness(
      { skill_kind: "fighting_style", requiredLimbs: ["right_arm"] },
      { activeDebuffs: new Set(["arm_broken"]), limbHealth: { right_arm: 5 } },
    );
    assert.equal(r.ok, true);
    assert.equal(r.dmgMul, 0.30);
    assert.ok(r.staggerMs >= 500);
    assert.equal(r.cause, "arm_broken");
  });

  it("evaluateLimbReadiness — concussed gates a psionic", () => {
    const r = evaluateLimbReadiness(
      { skill_kind: "psionic", requiredLimbs: ["head"] },
      { activeDebuffs: new Set(["concussed"]), limbHealth: { head: 5 } },
    );
    assert.equal(r.ok, true);
    assert.equal(r.dmgMul, 0.40);
  });

  it("evaluateLimbReadiness — severed limb blocks the cast entirely", () => {
    const r = evaluateLimbReadiness(
      { skill_kind: "fighting_style", requiredLimbs: ["right_arm"] },
      { activeDebuffs: new Set(["arm_broken"]), limbHealth: { right_arm: 0 } },
    );
    assert.equal(r.ok, false);
    assert.equal(r.reason, "limb_unusable");
  });

  it("evaluateLimbReadiness — unrelated debuff does not affect cast", () => {
    const r = evaluateLimbReadiness(
      { skill_kind: "fighting_style", requiredLimbs: ["right_arm"] },
      { activeDebuffs: new Set(["leg_broken"]), limbHealth: { right_arm: 100, right_leg: 0 } },
    );
    assert.equal(r.ok, true);
    assert.equal(r.dmgMul, 1.0);
  });
});

describe("NPC archetype profiles", () => {
  it("warrior derives fighting_style + physical/water/fire", () => {
    const p = npcInternal.deriveProfile({ archetype: "warrior", faction: null });
    assert.equal(p.skill_kind, "fighting_style");
    assert.ok(["physical", "fire", "water"].includes(p.element));
  });

  it("faction tradition overrides archetype default element", () => {
    const p = npcInternal.deriveProfile({ archetype: "warrior", faction: "ember_keepers" });
    assert.equal(p.element, "fire");
  });
});
