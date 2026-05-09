/**
 * Tier-2 contract tests for Phase 2 — NPC Asymmetry.
 *
 * Three structured fields auto-prepended to every LLM dialogue prompt:
 *   - persistent grudge
 *   - current preoccupation
 *   - asymmetric desire (per-player)
 *
 * Pinned: deterministic seed, faction-phase preoccupation refresh, grudge
 * record/cancel from impact events, desire offering by archetype, and the
 * compose pipeline that the narrative-bridge consumes.
 *
 * Run: node --test tests/npc-asymmetry.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  seedNPCAsymmetry,
  refreshFactionPreoccupations,
  recordPlayerImpactEvent,
  findOfferedDesire,
  composeAsymmetryContext,
  _internal,
} from "../lib/npc-asymmetry.js";

// ── Fake DB ────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const tables = {
    npc_grudges: new Map(),
    npc_preoccupations: new Map(),
    npc_desires: new Map(),
    world_npcs: new Map(),
  };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return {
      run: (...a) => runStmt(s, a),
      get: (...a) => getStmt(s, a),
      all: (...a) => allStmt(s, a),
    };
  }
  function transaction(fn) { return (...args) => fn(...args); }

  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO npc_grudges")) {
      const [id, npcId, targetKind, targetId, narrative, severity] = args;
      tables.npc_grudges.set(id, {
        id, npc_id: npcId, target_kind: targetKind, target_id: targetId,
        narrative, severity, event_at: Math.floor(Date.now() / 1000),
        resolved_at: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_preoccupations")) {
      const [id, npcId, kind, sourceId, narrative] = args;
      tables.npc_preoccupations.set(id, {
        id, npc_id: npcId, kind, source_id: sourceId, narrative,
        established_at: Math.floor(Date.now() / 1000), fades_at: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_desires")) {
      const [id, npcId, targetArchetype, narrative, predicateJson, rewardKind] = args;
      tables.npc_desires.set(id, {
        id, npc_id: npcId, target_archetype: targetArchetype, narrative,
        completion_predicate_json: predicateJson, reward_kind: rewardKind,
        status: "open", offered_to_user_id: null, offered_at: null,
        completed_at: null, created_at: Math.floor(Date.now() / 1000),
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE npc_preoccupations SET fades_at")) {
      const [factionId] = args;
      const matching = Array.from(tables.world_npcs.values()).filter(n => n.faction === factionId).map(n => n.id);
      let n = 0;
      for (const p of tables.npc_preoccupations.values()) {
        if (p.kind === "faction_phase" && p.fades_at == null && matching.includes(p.npc_id)) {
          p.fades_at = Math.floor(Date.now() / 1000);
          n++;
        }
      }
      return { changes: n };
    }
    if (sql.startsWith("UPDATE npc_grudges SET resolved_at")) {
      const [delta, npcId, userId] = args;
      let n = 0;
      for (const g of tables.npc_grudges.values()) {
        if (g.npc_id === npcId && g.target_kind === "player" && g.target_id === userId && g.resolved_at == null) {
          g.resolved_at = Math.floor(Date.now() / 1000);
          g.severity = Math.max(1, (g.severity || 0) + delta);
          n++;
        }
      }
      return { changes: n };
    }
    if (sql.startsWith("UPDATE npc_desires SET status = 'offered'")) {
      const [userId, id] = args;
      const d = tables.npc_desires.get(id);
      if (d) {
        d.status = "offered";
        d.offered_to_user_id = userId;
        d.offered_at = Math.floor(Date.now() / 1000);
      }
      return { changes: d ? 1 : 0 };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT (SELECT COUNT(*) FROM npc_grudges")) {
      const [npcId] = args;
      const g = Array.from(tables.npc_grudges.values()).filter(r => r.npc_id === npcId).length;
      const p = Array.from(tables.npc_preoccupations.values()).filter(r => r.npc_id === npcId).length;
      const d = Array.from(tables.npc_desires.values()).filter(r => r.npc_id === npcId).length;
      return { g, p, d };
    }
    if (sql.startsWith("SELECT narrative, severity, target_kind, target_id FROM npc_grudges")) {
      const [npcId] = args;
      const arr = Array.from(tables.npc_grudges.values())
        .filter(g => g.npc_id === npcId && g.resolved_at == null)
        .sort((a, b) => (b.severity - a.severity) || (b.event_at - a.event_at));
      return arr[0] || null;
    }
    if (sql.startsWith("SELECT narrative, kind, established_at FROM npc_preoccupations")) {
      const [npcId] = args;
      const arr = Array.from(tables.npc_preoccupations.values())
        .filter(p => p.npc_id === npcId && p.fades_at == null)
        .sort((a, b) => b.established_at - a.established_at);
      return arr[0] || null;
    }
    if (sql.startsWith("SELECT id, narrative, target_archetype, reward_kind FROM npc_desires WHERE npc_id = ? AND status = 'offered'")) {
      const [npcId, userId] = args;
      const arr = Array.from(tables.npc_desires.values())
        .filter(d => d.npc_id === npcId && d.status === "offered" && d.offered_to_user_id === userId);
      return arr[0] || null;
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id FROM world_npcs WHERE faction = ?")) {
      const [factionId] = args;
      return Array.from(tables.world_npcs.values()).filter(n => n.faction === factionId && !n.is_dead).map(n => ({ id: n.id }));
    }
    if (sql.startsWith("SELECT id, narrative, target_archetype, reward_kind FROM npc_desires WHERE npc_id = ? AND status = 'open'")) {
      const [npcId, archetypeKey] = args;
      const arr = Array.from(tables.npc_desires.values()).filter(d => d.npc_id === npcId && d.status === "open");
      arr.sort((a, b) => {
        const am = a.target_archetype === archetypeKey ? 0 : 1;
        const bm = b.target_archetype === archetypeKey ? 0 : 1;
        if (am !== bm) return am - bm;
        return a.created_at - b.created_at;
      });
      return arr;
    }
    return [];
  }

  return { prepare, transaction, _tables: tables };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("seedNPCAsymmetry — deterministic + idempotent", () => {
  it("inserts one grudge + one preoccupation + one desire on first call", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:k1", { id: "npc:k1", archetype: "warrior", faction: "pinewood" });
    const r = await seedNPCAsymmetry(db, db._tables.world_npcs.get("npc:k1"));
    assert.equal(r.ok, true);
    assert.equal(db._tables.npc_grudges.size, 1);
    assert.equal(db._tables.npc_preoccupations.size, 1);
    assert.equal(db._tables.npc_desires.size, 1);
  });

  it("is idempotent — second call adds nothing", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:k2", { id: "npc:k2", archetype: "scholar" });
    await seedNPCAsymmetry(db, db._tables.world_npcs.get("npc:k2"));
    const sizeBefore = db._tables.npc_grudges.size;
    await seedNPCAsymmetry(db, db._tables.world_npcs.get("npc:k2"));
    assert.equal(db._tables.npc_grudges.size, sizeBefore);
  });

  it("same npc_id produces deterministic narrative tokens (within seed)", async () => {
    const db1 = makeFakeDb();
    const db2 = makeFakeDb();
    db1._tables.world_npcs.set("npc:detsame", { id: "npc:detsame", archetype: "trader" });
    db2._tables.world_npcs.set("npc:detsame", { id: "npc:detsame", archetype: "trader" });
    await seedNPCAsymmetry(db1, db1._tables.world_npcs.get("npc:detsame"));
    await seedNPCAsymmetry(db2, db2._tables.world_npcs.get("npc:detsame"));
    const g1 = Array.from(db1._tables.npc_grudges.values())[0];
    const g2 = Array.from(db2._tables.npc_grudges.values())[0];
    // Determinism: same NPC id → same target_id token (via sha1 seed).
    assert.equal(g1.target_id, g2.target_id);
  });
});

describe("refreshFactionPreoccupations", () => {
  it("fades existing faction_phase rows + inserts new ones for all NPCs in faction", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:a", { id: "npc:a", faction: "pinewood" });
    db._tables.world_npcs.set("npc:b", { id: "npc:b", faction: "pinewood" });
    db._tables.world_npcs.set("npc:c", { id: "npc:c", faction: "ember" });

    // Seed everyone with a stale faction_phase preoccupation.
    _internal.insertPreoccupation(db, "npc:a", { kind: "faction_phase", source_id: "pinewood", narrative: "old" });
    _internal.insertPreoccupation(db, "npc:b", { kind: "faction_phase", source_id: "pinewood", narrative: "old" });

    const r = await refreshFactionPreoccupations(db, "pinewood", "war");
    assert.equal(r.ok, true);
    assert.equal(r.refreshed, 2);

    // Both pinewood NPCs got a fresh row, both old rows are faded.
    const fresh = Array.from(db._tables.npc_preoccupations.values())
      .filter(p => p.kind === "faction_phase" && p.fades_at == null);
    assert.equal(fresh.length, 2);
    assert.ok(fresh[0].narrative.includes("war"));
  });

  it("ember NPC is untouched when pinewood is refreshed", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:c", { id: "npc:c", faction: "ember" });
    _internal.insertPreoccupation(db, "npc:c", { kind: "faction_phase", source_id: "ember", narrative: "untouched" });
    await refreshFactionPreoccupations(db, "pinewood", "war");
    const ember = Array.from(db._tables.npc_preoccupations.values()).find(p => p.npc_id === "npc:c");
    assert.equal(ember.fades_at, null);
  });
});

describe("recordPlayerImpactEvent", () => {
  it("killed_by_player produces a severity-8 grudge", () => {
    const db = makeFakeDb();
    const r = recordPlayerImpactEvent(db, "npc:k", "user:x", "killed_by_player");
    assert.equal(r.ok, true);
    assert.equal(r.action, "added");
    assert.equal(r.severity, 8);
    const g = Array.from(db._tables.npc_grudges.values())[0];
    assert.equal(g.target_id, "user:x");
    assert.equal(g.severity, 8);
  });

  it("saved_by_player softens existing grudges", () => {
    const db = makeFakeDb();
    recordPlayerImpactEvent(db, "npc:k", "user:x", "killed_by_player");
    const r = recordPlayerImpactEvent(db, "npc:k", "user:x", "saved_by_player");
    assert.equal(r.ok, true);
    assert.equal(r.action, "softened");
    const g = Array.from(db._tables.npc_grudges.values())[0];
    assert.notEqual(g.resolved_at, null);
  });

  it("unknown event kind is a noop", () => {
    const db = makeFakeDb();
    const r = recordPlayerImpactEvent(db, "npc:k", "user:x", "totally_unknown");
    assert.equal(r.action, "noop");
  });
});

describe("findOfferedDesire — archetype matching", () => {
  it("matches concord_alignment_high when player has concord_alignment ≥ 0.7", () => {
    const db = makeFakeDb();
    _internal.insertDesire(db, "npc:k", {
      target_archetype: "concord_alignment_high",
      narrative: "vouch for my brother",
      reward_kind: "opinion_shift",
    });
    const r = findOfferedDesire(db, "npc:k", "user:x", { concord_alignment: 0.8 });
    assert.ok(r);
    assert.equal(r.target_archetype, "concord_alignment_high");
    // Should now be marked offered.
    const d = Array.from(db._tables.npc_desires.values())[0];
    assert.equal(d.status, "offered");
    assert.equal(d.offered_to_user_id, "user:x");
  });

  it("falls back to default desire when no specific match", () => {
    const db = makeFakeDb();
    _internal.insertDesire(db, "npc:k", { target_archetype: "default", narrative: "bring a token", reward_kind: "opinion_shift" });
    const r = findOfferedDesire(db, "npc:k", "user:y", { concord_alignment: 0 });
    assert.ok(r);
    assert.equal(r.target_archetype, "default");
  });

  it("returns the same offered desire on repeated calls (no double-offer)", () => {
    const db = makeFakeDb();
    _internal.insertDesire(db, "npc:k", { target_archetype: "default", narrative: "bring a token", reward_kind: "opinion_shift" });
    const r1 = findOfferedDesire(db, "npc:k", "user:x", {});
    const r2 = findOfferedDesire(db, "npc:k", "user:x", {});
    assert.equal(r1.id, r2.id);
  });

  it("derivePlayerArchetype returns expected keys", () => {
    assert.equal(_internal.derivePlayerArchetype({ concord_alignment: 0.8 }), "concord_alignment_high");
    assert.equal(_internal.derivePlayerArchetype({ concordia_alignment: 0.8 }), "concordia_alignment_high");
    assert.equal(_internal.derivePlayerArchetype({ refusal_debt: 0.7 }), "refusal_debt_high");
    assert.equal(_internal.derivePlayerArchetype({ ecosystem_score: 0.2 }), "ecosystem_low");
    assert.equal(_internal.derivePlayerArchetype({}), "default");
    assert.equal(_internal.derivePlayerArchetype(null), "default");
  });
});

describe("composeAsymmetryContext — full pipeline", () => {
  it("returns all three fields when seeded", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:k", { id: "npc:k", archetype: "warrior", faction: "pinewood" });
    await seedNPCAsymmetry(db, db._tables.world_npcs.get("npc:k"));
    const ctx = composeAsymmetryContext(db, "npc:k", "user:x", { concord_alignment: 0.8 });
    assert.equal(typeof ctx.persistent_grudge, "string");
    assert.equal(typeof ctx.current_preoccupation, "string");
    // Desire MAY be null if no archetype match — depends on seeded desire.
    assert.ok("desire_for_this_player" in ctx);
  });

  it("returns nulls when NPC has nothing seeded", () => {
    const db = makeFakeDb();
    const ctx = composeAsymmetryContext(db, "npc:nonexistent", "user:x", null);
    assert.equal(ctx.persistent_grudge, null);
    assert.equal(ctx.current_preoccupation, null);
    assert.equal(ctx.desire_for_this_player, null);
  });

  it("never throws on null db", () => {
    const ctx = composeAsymmetryContext(null, "npc:any", "user:x", null);
    assert.equal(ctx.persistent_grudge, null);
    assert.equal(ctx.current_preoccupation, null);
    assert.equal(ctx.desire_for_this_player, null);
  });
});
