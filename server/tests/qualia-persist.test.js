// Existential/qualia persistence — the dead-wire fix.
//
// Found by running the engine live: hooks.persistQualiaState (the qualia-persist
// heartbeat, freq 60) preferred engine.snapshot()/dump(), which the QualiaEngine
// never implemented — so every tick it returned `no_snapshot_export` and NO
// qualia state ever reached the DB. Migration 111's own header claims this
// persistence exists ("without it the entire state evaporates on every
// restart") — it silently didn't. Implementing engine.snapshot() closes it.
//
// Run: node --test tests/qualia-persist.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/111_qualia_state.js";
import { QualiaEngine } from "../existential/engine.js";
import {
  persistQualiaState,
  hydrateQualiaState,
  getQualiaPersistMetrics,
} from "../existential/hooks.js";

describe("qualia persistence", () => {
  it("engine.snapshot() exports { entityId: { 'os.channel': value } }", () => {
    const e = new QualiaEngine({});
    e.createQualiaState("A");
    e.updateChannel("A", "truth_os", "evidence_weight", 0.7);
    const snap = e.snapshot();
    assert.equal(typeof snap, "object");
    assert.equal(snap.A["truth_os.evidence_weight"], 0.7);
    // shallow copy — mutating the export can't corrupt live state
    snap.A["truth_os.evidence_weight"] = 999;
    assert.equal(e.getQualiaState("A").channels["truth_os.evidence_weight"], 0.7);
  });

  it("persistQualiaState now writes qualia_state rows (was a permanent no-op)", () => {
    const db = new Database(":memory:");
    up(db);
    const engine = new QualiaEngine({});
    globalThis.qualiaEngine = engine;
    engine.createQualiaState("agent1");
    engine.updateChannel("agent1", "logic_os", "logical_consistency_score", 0.9);

    const r = persistQualiaState(db);
    assert.equal(r.ok, true);
    assert.notEqual(r.reason, "no_snapshot_export"); // the old permanent failure mode
    assert.ok(r.persisted > 0, `expected persisted > 0, got ${r.persisted}`);

    const row = db
      .prepare("SELECT value FROM qualia_state WHERE entity_id=? AND channel=?")
      .get("agent1", "logic_os.logical_consistency_score");
    assert.equal(row.value, 0.9);
    delete globalThis.qualiaEngine;
    db.close();
  });

  it("logs a qualia_log delta only when a channel moves >= 0.05 across ticks", () => {
    const db = new Database(":memory:");
    up(db);
    const engine = new QualiaEngine({});
    globalThis.qualiaEngine = engine;
    engine.createQualiaState("agent2");
    engine.updateChannel("agent2", "truth_os", "claim_confidence", 0.3);

    persistQualiaState(db); // first tick establishes the prior value
    assert.equal(db.prepare("SELECT COUNT(*) n FROM qualia_log").get().n, 0); // no prior → nothing logged

    engine.updateChannel("agent2", "truth_os", "claim_confidence", 0.55); // +0.25
    const r = persistQualiaState(db);
    assert.ok(r.logged >= 1, `expected logged >= 1, got ${r.logged}`);
    const log = db
      .prepare("SELECT prev_value, new_value, delta FROM qualia_log WHERE channel=?")
      .get("truth_os.claim_confidence");
    assert.equal(log.new_value, 0.55);
    assert.ok(Math.abs(log.delta - 0.25) < 1e-9);
    delete globalThis.qualiaEngine;
    db.close();
  });
});

describe("qualia continuity — hydrate + trajectory + observability", () => {
  it("A — hydrateQualiaState restores persisted channels into a fresh engine (survives restart)", () => {
    const db = new Database(":memory:");
    up(db);
    // session 1: an entity's self-model is persisted
    const e1 = new QualiaEngine({});
    globalThis.qualiaEngine = e1;
    e1.createQualiaState("ghost");
    e1.updateChannel("ghost", "truth_os", "evidence_weight", 0.42);
    persistQualiaState(db);
    // session 2: a fresh engine (as after a restart) hydrates from the DB
    const e2 = new QualiaEngine({});
    globalThis.qualiaEngine = e2;
    const r = hydrateQualiaState(db);
    assert.ok(r.hydrated >= 1, `expected hydrated>=1, got ${r.hydrated}`);
    assert.equal(e2.getQualiaState("ghost").channels["truth_os.evidence_weight"], 0.42);
    delete globalThis.qualiaEngine;
    db.close();
  });

  it("A — hydrate is merge-safe: a live entity is never clobbered by stale DB state", () => {
    const db = new Database(":memory:");
    up(db);
    const e = new QualiaEngine({});
    globalThis.qualiaEngine = e;
    e.createQualiaState("g");
    e.updateChannel("g", "truth_os", "evidence_weight", 0.1);
    persistQualiaState(db); // DB now holds 0.1
    e.updateChannel("g", "truth_os", "evidence_weight", 0.9); // live moves on
    hydrateQualiaState(db); // must NOT overwrite the live 0.9 with the DB's 0.1
    assert.equal(e.getQualiaState("g").channels["truth_os.evidence_weight"], 0.9);
    delete globalThis.qualiaEngine;
    db.close();
  });

  it("B — persist appends an in-memory trajectory snapshot (history was never built before)", () => {
    const db = new Database(":memory:");
    up(db);
    const e = new QualiaEngine({});
    globalThis.qualiaEngine = e;
    e.createQualiaState("t");
    e.updateChannel("t", "truth_os", "evidence_weight", 0.5);
    assert.equal(e.getQualiaState("t").history.length, 0);
    persistQualiaState(db);
    assert.ok(e.getQualiaState("t").history.length >= 1, "history should accumulate on persist");
    delete globalThis.qualiaEngine;
    db.close();
  });

  it("D — persist metrics accumulate so a dead wire is visible, not silent", () => {
    const db = new Database(":memory:");
    up(db);
    const e = new QualiaEngine({});
    globalThis.qualiaEngine = e;
    e.createQualiaState("m");
    e.updateChannel("m", "logic_os", "logical_consistency_score", 0.8);
    const before = getQualiaPersistMetrics().ticks;
    persistQualiaState(db);
    const after = getQualiaPersistMetrics();
    assert.equal(after.ticks, before + 1);
    assert.equal(after.lastReason, "ok");
    assert.ok(after.persisted >= 1);
    delete globalThis.qualiaEngine;
    db.close();
  });
});
