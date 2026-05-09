/**
 * Tier-2 contract tests for Phase 4c — Lattice-Born Quests.
 *
 * Pinned:
 *   - alertSignature: deterministic + day-bucketed + capped length
 *   - composeQuestFromAlert: all 6 drift types map cleanly; unknown
 *     types reject; same alert + day → identical composition
 *   - pickHostNpc: archetype filter + deterministic by signature
 *   - persistLatticeBornQuest: insert; idempotent on duplicate signature
 *   - spawnQuestFromAlert: end-to-end; idempotent early-out;
 *     archetype-matched host NPC; persists row
 *   - realiseLatticeBornQuest: marks completed
 *   - heartbeat: kill-switch + no_db + no_alerts + spawn_count
 *
 * Run: node --test tests/lattice-quest-composer.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  alertSignature,
  composeQuestFromAlert,
  pickHostNpc,
  persistLatticeBornQuest,
  spawnQuestFromAlert,
  realiseLatticeBornQuest,
  _internal,
} from "../lib/lattice-quest-composer.js";
import { runLatticeQuestCycle } from "../emergent/lattice-quest-cycle.js";

// ── Fake DB ─────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const tables = {
    lattice_born_quests: new Map(),
    world_npcs: new Map(),
    world_visits: new Map(),
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
    if (sql.startsWith("INSERT INTO lattice_born_quests")) {
      const [id, sig, driftType, driftSeverity, questId, worldId, targetNpc, composer] = args;
      // UNIQUE on drift_alert_signature
      for (const r of tables.lattice_born_quests.values()) {
        if (r.drift_alert_signature === sig) {
          const err = new Error("UNIQUE constraint failed: lattice_born_quests.drift_alert_signature");
          throw err;
        }
      }
      tables.lattice_born_quests.set(id, {
        id, drift_alert_signature: sig, drift_type: driftType,
        drift_severity: driftSeverity, quest_id: questId,
        world_id: worldId, target_npc_id: targetNpc, composer,
        composed_at: Math.floor(Date.now() / 1000),
        realised_at: null, realisation_outcome: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE lattice_born_quests SET realised_at")) {
      const [outcome, questId] = args;
      let n = 0;
      for (const r of tables.lattice_born_quests.values()) {
        if (r.quest_id === questId && r.realised_at == null) {
          r.realised_at = Math.floor(Date.now() / 1000);
          r.realisation_outcome = outcome;
          n++;
        }
      }
      return { changes: n };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT id, quest_id FROM lattice_born_quests WHERE drift_alert_signature")) {
      const [sig] = args;
      for (const r of tables.lattice_born_quests.values()) {
        if (r.drift_alert_signature === sig) return { id: r.id, quest_id: r.quest_id };
      }
      return null;
    }
    if (sql.startsWith("SELECT quest_id, target_npc_id FROM lattice_born_quests")) {
      const [sig] = args;
      for (const r of tables.lattice_born_quests.values()) {
        if (r.drift_alert_signature === sig) return { quest_id: r.quest_id, target_npc_id: r.target_npc_id };
      }
      return null;
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id, archetype, faction FROM world_npcs WHERE world_id")) {
      const [worldId, ...archetypes] = args;
      return Array.from(tables.world_npcs.values())
        .filter(n => n.world_id === worldId && !n.is_dead && archetypes.includes(n.archetype))
        .sort((a, b) => a.id.localeCompare(b.id));
    }
    if (sql.startsWith("SELECT DISTINCT world_id FROM world_visits")) {
      return Array.from(tables.world_visits.values())
        .filter(v => v.departed_at == null)
        .map(v => ({ world_id: v.world_id }));
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

function makeAlert(opts = {}) {
  return {
    type: opts.type || "memetic_drift",
    severity: opts.severity || "warning",
    message: opts.message || "Belief X has been repeated 12 times in 3 days with no primary source.",
    detected_at: opts.detected_at ?? Date.now(),
    evidence: opts.evidence || {},
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("alertSignature", () => {
  it("is deterministic for same inputs", () => {
    const a = makeAlert({ detected_at: 1234567890000 });
    assert.equal(alertSignature(a), alertSignature(a));
  });

  it("differs across drift types", () => {
    const a = makeAlert({ type: "memetic_drift" });
    const b = makeAlert({ type: "goodhart" });
    assert.notEqual(alertSignature(a), alertSignature(b));
  });

  it("buckets by day (same alert next day → different signature)", () => {
    const today = Date.UTC(2026, 5, 1);
    const tomorrow = today + 86400000;
    const a = makeAlert({ detected_at: today });
    const b = makeAlert({ detected_at: tomorrow });
    assert.notEqual(alertSignature(a), alertSignature(b));
  });

  it("returns null on null alert", () => {
    assert.equal(alertSignature(null), null);
  });
});

describe("composeQuestFromAlert", () => {
  for (const driftType of ["goodhart", "memetic_drift", "capability_creep", "self_reference", "echo_chamber", "metric_divergence"]) {
    it(`composes for drift type '${driftType}'`, () => {
      const alert = makeAlert({ type: driftType });
      const r = composeQuestFromAlert(alert);
      assert.equal(r.ok, true);
      assert.ok(r.title);
      assert.ok(r.summary);
      assert.equal(r.steps.length, 3);
      assert.equal(r.steps[0].type, "investigate");
      assert.equal(r.steps[1].type, "confront");
      assert.equal(r.steps[2].type, "resolve");
      assert.ok(Array.isArray(r.target_archetypes));
      assert.ok(r.location_kind);
      assert.ok(r.signature);
    });
  }

  it("rejects unknown drift type", () => {
    const r = composeQuestFromAlert({ type: "totally_unknown" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_drift_type");
  });

  it("rejects null alert", () => {
    const r = composeQuestFromAlert(null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_alert_type");
  });

  it("same alert produces identical composition (determinism)", () => {
    const alert = makeAlert({ detected_at: 1234567890000 });
    const a = composeQuestFromAlert(alert);
    const b = composeQuestFromAlert(alert);
    assert.equal(a.title, b.title);
    assert.deepEqual(a.steps.map(s => s.prompt), b.steps.map(s => s.prompt));
  });
});

describe("pickHostNpc", () => {
  it("picks an archetype-matched NPC deterministically", () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:s1", { id: "npc:s1", archetype: "scholar", world_id: "w" });
    db._tables.world_npcs.set("npc:s2", { id: "npc:s2", archetype: "scholar", world_id: "w" });
    db._tables.world_npcs.set("npc:w1", { id: "npc:w1", archetype: "warrior", world_id: "w" });

    const r1 = pickHostNpc(db, "w", "sigA", ["scholar"]);
    const r2 = pickHostNpc(db, "w", "sigA", ["scholar"]);
    assert.ok(r1);
    assert.equal(r1.archetype, "scholar");
    assert.equal(r1.id, r2.id); // determinism
  });

  it("returns null when no archetype matches", () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:w1", { id: "npc:w1", archetype: "warrior", world_id: "w" });
    const r = pickHostNpc(db, "w", "sig", ["scholar"]);
    assert.equal(r, null);
  });
});

describe("persistLatticeBornQuest", () => {
  it("inserts a row + returns inserted action", () => {
    const db = makeFakeDb();
    const r = persistLatticeBornQuest(db, {
      signature: "sig-1", driftType: "memetic_drift", driftSeverity: "warning",
      questId: "q:1", worldId: "w", targetNpcId: "npc:s1",
    });
    assert.equal(r.ok, true);
    assert.equal(r.action, "inserted");
    assert.equal(db._tables.lattice_born_quests.size, 1);
  });

  it("idempotent on duplicate signature", () => {
    const db = makeFakeDb();
    persistLatticeBornQuest(db, { signature: "sig-x", driftType: "goodhart", questId: "q:1", worldId: "w" });
    const r = persistLatticeBornQuest(db, { signature: "sig-x", driftType: "goodhart", questId: "q:2", worldId: "w" });
    assert.equal(r.ok, true);
    assert.equal(r.action, "already_exists");
    assert.equal(r.questId, "q:1"); // returns first quest_id
    assert.equal(db._tables.lattice_born_quests.size, 1);
  });

  it("rejects missing inputs", () => {
    const db = makeFakeDb();
    const r = persistLatticeBornQuest(db, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});

describe("spawnQuestFromAlert — end-to-end", () => {
  it("composes + picks host + persists", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:m1", { id: "npc:m1", archetype: "mystic", world_id: "w" });
    const alert = makeAlert({ type: "memetic_drift" });
    const r = await spawnQuestFromAlert(db, alert, "w");
    assert.equal(r.ok, true);
    assert.equal(r.action, "inserted");
    assert.equal(r.hostNpcId, "npc:m1");
    assert.ok(r.title);
    assert.equal(db._tables.lattice_born_quests.size, 1);
  });

  it("idempotent — re-spawning same alert returns existing", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:s1", { id: "npc:s1", archetype: "scholar", world_id: "w" });
    const alert = makeAlert({ type: "goodhart", detected_at: 1234567890000 });
    const r1 = await spawnQuestFromAlert(db, alert, "w");
    const r2 = await spawnQuestFromAlert(db, alert, "w");
    assert.equal(r1.questId, r2.questId);
    assert.equal(r2.action, "already_exists");
    assert.equal(db._tables.lattice_born_quests.size, 1);
  });

  it("rejects missing inputs", async () => {
    const r = await spawnQuestFromAlert(null, null, null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});

describe("realiseLatticeBornQuest", () => {
  it("marks completed", () => {
    const db = makeFakeDb();
    persistLatticeBornQuest(db, {
      signature: "sig-real", driftType: "goodhart", questId: "q:r1", worldId: "w",
    });
    const r = realiseLatticeBornQuest(db, "q:r1", "completed");
    assert.equal(r.ok, true);
    const row = Array.from(db._tables.lattice_born_quests.values())[0];
    assert.notEqual(row.realised_at, null);
    assert.equal(row.realisation_outcome, "completed");
  });

  it("missing inputs returns ok:false", () => {
    const r = realiseLatticeBornQuest(null, null);
    assert.equal(r.ok, false);
  });
});

describe("lattice-quest-cycle heartbeat", () => {
  it("returns no_db with no DB", async () => {
    const r = await runLatticeQuestCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("respects CONCORD_LATTICE_QUESTS=0", async () => {
    const prev = process.env.CONCORD_LATTICE_QUESTS;
    process.env.CONCORD_LATTICE_QUESTS = "0";
    try {
      const r = await runLatticeQuestCycle({ db: makeFakeDb() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_LATTICE_QUESTS;
      else process.env.CONCORD_LATTICE_QUESTS = prev;
    }
  });

  it("returns scanned:0 with no alerts in driftStore", async () => {
    const r = await runLatticeQuestCycle({ db: makeFakeDb(), state: { driftStore: { alerts: [] } } });
    assert.equal(r.ok, true);
    assert.equal(r.scanned, 0);
    assert.equal(r.spawned, 0);
  });

  it("spawns quests from warning+ alerts; skips info-severity", async () => {
    const db = makeFakeDb();
    db._tables.world_visits.set("v1", { user_id: "user:a", world_id: "w", departed_at: null });
    db._tables.world_npcs.set("npc:m1", { id: "npc:m1", archetype: "mystic", world_id: "w" });
    db._tables.world_npcs.set("npc:s1", { id: "npc:s1", archetype: "scholar", world_id: "w" });
    const state = {
      driftStore: {
        alerts: [
          makeAlert({ type: "memetic_drift", severity: "warning", message: "a" }),
          makeAlert({ type: "goodhart",      severity: "alert",   message: "b" }),
          makeAlert({ type: "echo_chamber",  severity: "info",    message: "c" }), // skipped
        ],
      },
    };
    const r = await runLatticeQuestCycle({ db, state });
    assert.equal(r.ok, true);
    assert.equal(r.scanned, 3);
    assert.ok(r.spawned >= 2, `expected spawned ≥ 2, got ${r.spawned}`);
    assert.ok(r.skipped >= 1);
  });
});

describe("internals", () => {
  it("QUEST_TEMPLATES has all 6 drift types", () => {
    const expected = ["goodhart", "memetic_drift", "capability_creep", "self_reference", "echo_chamber", "metric_divergence"];
    for (const k of expected) {
      assert.ok(_internal.QUEST_TEMPLATES[k], `missing ${k}`);
      assert.equal(_internal.QUEST_TEMPLATES[k].steps.length, 3);
    }
  });
});
