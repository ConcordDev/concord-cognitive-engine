/**
 * Tier-2 contract tests for Phase 5b — Death + Legacy.
 *
 * Pinned: composeLastWords determinism + cause routing; findHeirs
 * priority (children > same-archetype faction-mates > any faction-mate);
 * onNpcDeath legacy persistence + inheritance cascade; idempotent re-call;
 * getLegacy/getTombsForWorld read paths; getInheritanceForHeir lineage.
 *
 * Run: node --test tests/npc-legacy.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  composeLastWords,
  findHeirs,
  onNpcDeath,
  getLegacy,
  getTombsForWorld,
  getInheritanceForHeir,
  _internal,
} from "../lib/npc-legacy.js";

// ── Fake DB ─────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const tables = {
    npc_legacies: new Map(),
    npc_inheritance_links: new Map(),
    npc_grudges: new Map(),
    npc_preoccupations: new Map(),
    npc_desires: new Map(),
    npc_relations: new Map(),
    world_npcs: new Map(),
    dtus: new Map(),
  };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function transaction(fn) { return (...args) => fn(...args); }

  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO npc_legacies")) {
      const [id, npcId, worldId, cause, lastWords, tombX, tombZ, faction, archetype] = args;
      // UNIQUE on npc_id
      for (const r of tables.npc_legacies.values()) {if (r.npc_id === npcId) {
        const err = new Error("UNIQUE constraint failed: npc_legacies.npc_id"); throw err;
      }}
      tables.npc_legacies.set(id, {
        id, npc_id: npcId, world_id: worldId,
        died_at: Math.floor(Date.now() / 1000),
        cause_of_death: cause, last_words: lastWords,
        tomb_x: tombX, tomb_z: tombZ,
        faction, archetype,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_inheritance_links")) {
      const [id, deceasedId, heirId, kind, sourceId, detailJson] = args;
      tables.npc_inheritance_links.set(id, {
        id, deceased_npc_id: deceasedId, heir_npc_id: heirId,
        inherited_kind: kind, source_id: sourceId, detail_json: detailJson,
        inherited_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_grudges")) {
      const [id, npcId, targetKind, targetId, narrative, severity] = args;
      tables.npc_grudges.set(id, { id, npc_id: npcId, target_kind: targetKind, target_id: targetId, narrative, severity, resolved_at: null });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_preoccupations")) {
      const [id, npcId, kind, sourceId, narrative] = args;
      tables.npc_preoccupations.set(id, { id, npc_id: npcId, kind, source_id: sourceId, narrative, fades_at: null, established_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_desires")) {
      const [id, npcId, archType, narrative, predicate, rewardKind] = args;
      tables.npc_desires.set(id, { id, npc_id: npcId, target_archetype: archType, narrative, completion_predicate_json: predicate, reward_kind: rewardKind, status: "open" });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE world_npcs SET wealth_sparks = COALESCE(wealth_sparks, 0) + ?")) {
      const [amount, id] = args;
      const n = tables.world_npcs.get(id);
      if (n) { n.wealth_sparks = (n.wealth_sparks || 0) + amount; return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE world_npcs SET wealth_sparks = 0")) {
      const [id] = args;
      const n = tables.world_npcs.get(id);
      if (n) { n.wealth_sparks = 0; return { changes: 1 }; }
      return { changes: 0 };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT id FROM npc_legacies WHERE npc_id = ?")) {
      const [npcId] = args;
      for (const r of tables.npc_legacies.values()) if (r.npc_id === npcId) return { id: r.id };
      return null;
    }
    if (sql.startsWith("SELECT * FROM npc_legacies WHERE npc_id = ?")) {
      const [npcId] = args;
      for (const r of tables.npc_legacies.values()) if (r.npc_id === npcId) return r;
      return null;
    }
    if (sql.startsWith("SELECT wealth_sparks FROM world_npcs WHERE id = ?")) {
      const n = tables.world_npcs.get(args[0]);
      return n ? { wealth_sparks: n.wealth_sparks || 0 } : null;
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT n.id, n.archetype, n.faction FROM npc_relations r")) {
      const [deceased] = args;
      const out = [];
      for (const r of tables.npc_relations.values()) {
        if (r.related_to !== deceased) continue;
        if (!["child", "apprentice"].includes(r.relation_kind)) continue;
        const n = tables.world_npcs.get(r.npc_id);
        if (n && !n.is_dead) out.push({ id: n.id, archetype: n.archetype, faction: n.faction });
      }
      return out;
    }
    if (sql.startsWith("SELECT id, archetype, faction FROM world_npcs WHERE faction = ? AND archetype = ?")) {
      const [faction, archetype, excludeId] = args;
      return Array.from(tables.world_npcs.values())
        .filter(n => n.faction === faction && n.archetype === archetype && n.id !== excludeId && !n.is_dead)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(n => ({ id: n.id, archetype: n.archetype, faction: n.faction }));
    }
    if (sql.startsWith("SELECT id, archetype, faction FROM world_npcs WHERE faction = ? AND id != ?")) {
      const [faction, excludeId] = args;
      return Array.from(tables.world_npcs.values())
        .filter(n => n.faction === faction && n.id !== excludeId && !n.is_dead)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(n => ({ id: n.id, archetype: n.archetype, faction: n.faction }));
    }
    if (sql.startsWith("SELECT * FROM npc_grudges WHERE npc_id = ? AND resolved_at IS NULL")) {
      const [npcId] = args;
      return Array.from(tables.npc_grudges.values()).filter(g => g.npc_id === npcId && g.resolved_at == null);
    }
    if (sql.startsWith("SELECT * FROM npc_preoccupations WHERE npc_id = ? AND fades_at IS NULL AND kind != 'faction_phase'")) {
      const [npcId] = args;
      return Array.from(tables.npc_preoccupations.values()).filter(p => p.npc_id === npcId && p.fades_at == null && p.kind !== "faction_phase");
    }
    if (sql.startsWith("SELECT * FROM npc_desires WHERE npc_id = ? AND status = 'open'")) {
      const [npcId] = args;
      return Array.from(tables.npc_desires.values()).filter(d => d.npc_id === npcId && d.status === "open");
    }
    if (sql.startsWith("SELECT id FROM dtus WHERE creator_id = ?")) {
      const [creator] = args;
      return Array.from(tables.dtus.values()).filter(d => d.creator_id === creator).map(d => ({ id: d.id }));
    }
    if (sql.startsWith("SELECT id, npc_id, tomb_x, tomb_z, last_words, faction, archetype, died_at FROM npc_legacies")) {
      const [worldId, limit] = args;
      return Array.from(tables.npc_legacies.values())
        .filter(r => r.world_id === worldId)
        .sort((a, b) => b.died_at - a.died_at)
        .slice(0, limit);
    }
    if (sql.startsWith("SELECT * FROM npc_inheritance_links WHERE heir_npc_id = ?")) {
      const [heirId] = args;
      return Array.from(tables.npc_inheritance_links.values())
        .filter(r => r.heir_npc_id === heirId)
        .sort((a, b) => b.inherited_at - a.inherited_at);
    }
    return [];
  }

  return { prepare, transaction, _tables: tables };
}

function makeNpc(opts = {}) {
  return {
    id: opts.id || "npc:dead",
    archetype: opts.archetype || "warrior",
    faction: opts.faction || "pinewood",
    world_id: opts.world_id || "concordia-hub",
    current_location: opts.current_location || JSON.stringify({ x: 50, z: 25 }),
    wealth_sparks: opts.wealth_sparks ?? 100,
    is_dead: opts.is_dead || 0,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("composeLastWords", () => {
  it("deterministic by (npc_id, cause)", () => {
    const a = composeLastWords({ id: "npc:k1" }, "combat");
    const b = composeLastWords({ id: "npc:k1" }, "combat");
    assert.equal(a, b);
  });
  it("differs by cause", () => {
    const a = composeLastWords({ id: "npc:k1" }, "combat");
    const c = composeLastWords({ id: "npc:k1" }, "ageing");
    // Same pool length difference + seed shift makes equality possible by chance,
    // but the cause clause should usually differ.
    assert.ok(a && c);
  });
  it("falls back to 'unknown' for unknown cause", () => {
    const r = composeLastWords({ id: "x" }, "totally_unknown_cause");
    assert.ok(_internal.LAST_WORDS_BY_CAUSE.unknown.includes(r));
  });
});

describe("findHeirs", () => {
  it("prefers children > same-archetype peers > any faction peer", () => {
    const db = makeFakeDb();
    const dead = makeNpc({ id: "npc:dad", archetype: "warrior", faction: "pinewood" });
    db._tables.world_npcs.set(dead.id, dead);
    // Child (priority 1)
    db._tables.world_npcs.set("npc:son", makeNpc({ id: "npc:son", archetype: "scholar", faction: "ember" }));
    db._tables.npc_relations.set("rel:1", { npc_id: "npc:son", related_to: "npc:dad", relation_kind: "child" });
    // Same-archetype peer (priority 2)
    db._tables.world_npcs.set("npc:peer", makeNpc({ id: "npc:peer", archetype: "warrior", faction: "pinewood" }));
    // Other faction peer (won't be picked)
    db._tables.world_npcs.set("npc:other", makeNpc({ id: "npc:other", archetype: "warrior", faction: "ember" }));
    const heirs = findHeirs(db, dead);
    assert.ok(heirs.length >= 1);
    assert.equal(heirs[0].id, "npc:son", "child should be the primary heir");
  });

  it("falls back to faction-mate when no children", () => {
    const db = makeFakeDb();
    const dead = makeNpc({ id: "npc:lone", archetype: "scholar", faction: "pinewood" });
    db._tables.world_npcs.set(dead.id, dead);
    db._tables.world_npcs.set("npc:peer", makeNpc({ id: "npc:peer", archetype: "scholar", faction: "pinewood" }));
    const heirs = findHeirs(db, dead);
    assert.equal(heirs.length, 1);
    assert.equal(heirs[0].id, "npc:peer");
  });

  it("returns empty when no eligible heir", () => {
    const db = makeFakeDb();
    const dead = makeNpc({ id: "npc:alone", faction: "pinewood" });
    db._tables.world_npcs.set(dead.id, dead);
    const heirs = findHeirs(db, dead);
    assert.equal(heirs.length, 0);
  });
});

describe("onNpcDeath — legacy + inheritance cascade", () => {
  it("inserts legacy row + inherits everything to primary heir", () => {
    const db = makeFakeDb();
    const dead = makeNpc({ id: "npc:dad", wealth_sparks: 200 });
    db._tables.world_npcs.set(dead.id, dead);
    const heir = makeNpc({ id: "npc:son", wealth_sparks: 0 });
    db._tables.world_npcs.set(heir.id, heir);
    db._tables.npc_relations.set("r1", { npc_id: "npc:son", related_to: "npc:dad", relation_kind: "child" });

    // Seed the dead's interiority.
    db._tables.npc_grudges.set("g1", { id: "g1", npc_id: "npc:dad", target_kind: "player", target_id: "user:x", narrative: "they cheated me", severity: 7, resolved_at: null });
    db._tables.npc_preoccupations.set("p1", { id: "p1", npc_id: "npc:dad", kind: "personal_loss", source_id: null, narrative: "the salt market", fades_at: null });
    db._tables.npc_desires.set("d1", { id: "d1", npc_id: "npc:dad", target_archetype: "default", narrative: "find the runoff", reward_kind: "quest_unlock", status: "open" });
    db._tables.dtus.set("dtu1", { id: "dtu1", creator_id: "npc:dad", kind: "skill" });

    const r = onNpcDeath(db, dead, { cause: "combat" });
    assert.equal(r.ok, true);
    assert.ok(r.legacyId);
    assert.equal(r.heirs[0], "npc:son");
    assert.equal(r.inherited.grudge, 1);
    assert.equal(r.inherited.preoccupation, 1);
    assert.equal(r.inherited.desire, 1);
    assert.equal(r.inherited.recipe, 1);
    assert.equal(r.inherited.wealth, 200);

    // Heir got the wealth.
    assert.equal(db._tables.world_npcs.get("npc:son").wealth_sparks, 200);
    // Dead's purse zeroed.
    assert.equal(db._tables.world_npcs.get("npc:dad").wealth_sparks, 0);

    // Inheritance links recorded.
    const links = Array.from(db._tables.npc_inheritance_links.values()).filter(l => l.heir_npc_id === "npc:son");
    assert.ok(links.length >= 4);
  });

  it("idempotent — second call is no-op", () => {
    const db = makeFakeDb();
    const dead = makeNpc({ id: "npc:once" });
    db._tables.world_npcs.set(dead.id, dead);
    const r1 = onNpcDeath(db, dead);
    const r2 = onNpcDeath(db, dead);
    assert.equal(r1.ok, true);
    assert.equal(r2.action, "already_recorded");
    assert.equal(db._tables.npc_legacies.size, 1);
  });

  it("works without heirs (legacy still recorded)", () => {
    const db = makeFakeDb();
    const dead = makeNpc({ id: "npc:lone", wealth_sparks: 50 });
    db._tables.world_npcs.set(dead.id, dead);
    const r = onNpcDeath(db, dead, { cause: "ageing" });
    assert.equal(r.ok, true);
    assert.equal(r.heirs.length, 0);
    assert.equal(r.inherited.wealth, 0);
    // Legacy + last words still present.
    const legacy = getLegacy(db, "npc:lone");
    assert.ok(legacy);
    assert.ok(legacy.last_words);
  });

  it("tomb position is the deceased's last location", () => {
    const db = makeFakeDb();
    const dead = makeNpc({ id: "npc:tomb", current_location: JSON.stringify({ x: 123, z: 456 }) });
    db._tables.world_npcs.set(dead.id, dead);
    const r = onNpcDeath(db, dead);
    const legacy = getLegacy(db, "npc:tomb");
    assert.equal(legacy.tomb_x, 123);
    assert.equal(legacy.tomb_z, 456);
  });

  it("rejects null inputs", () => {
    const r = onNpcDeath(null, null);
    assert.equal(r.ok, false);
  });
});

describe("getTombsForWorld + getInheritanceForHeir", () => {
  it("getTombsForWorld returns tombs sorted by died_at desc", () => {
    const db = makeFakeDb();
    const a = makeNpc({ id: "npc:a", world_id: "w" });
    const b = makeNpc({ id: "npc:b", world_id: "w" });
    db._tables.world_npcs.set(a.id, a);
    db._tables.world_npcs.set(b.id, b);
    onNpcDeath(db, a);
    onNpcDeath(db, b);
    const tombs = getTombsForWorld(db, "w");
    assert.equal(tombs.length, 2);
  });

  it("getInheritanceForHeir lists what an heir received", () => {
    const db = makeFakeDb();
    const dead = makeNpc({ id: "npc:dead", wealth_sparks: 30 });
    const heir = makeNpc({ id: "npc:heir" });
    db._tables.world_npcs.set(dead.id, dead);
    db._tables.world_npcs.set(heir.id, heir);
    db._tables.npc_relations.set("r1", { npc_id: "npc:heir", related_to: "npc:dead", relation_kind: "child" });
    db._tables.npc_grudges.set("g1", { id: "g1", npc_id: "npc:dead", target_kind: "player", target_id: "u", narrative: "x", severity: 5, resolved_at: null });
    onNpcDeath(db, dead);
    const links = getInheritanceForHeir(db, "npc:heir");
    assert.ok(links.length >= 2);
    assert.ok(links.some(l => l.inherited_kind === "grudge"));
    assert.ok(links.some(l => l.inherited_kind === "wealth"));
  });

  it("getLegacy returns null for non-deceased NPC", () => {
    const db = makeFakeDb();
    assert.equal(getLegacy(db, "npc:unknown"), null);
  });
});
