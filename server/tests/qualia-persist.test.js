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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  persistQualiaStateAsync,
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

// ── Chunked / prepared-once persist (heartbeat-window finding: a ~2 s main-thread block at the live size) ──
describe("qualia persist: prepared once, one transaction per chunk, yields between chunks", () => {
  const hereDir = path.dirname(fileURLToPath(import.meta.url));
  const mkEngine = (n, c, shift = 0) => {
    const snap = {};
    for (let i = 0; i < n; i++) { const ch = {}; for (let k = 0; k < c; k++) ch[`os${k % 3}.ch${k}`] = ((i * 7 + k * 13 + shift) % 100) / 100; snap[`e${i}`] = ch; }
    const snapshotted = [];
    return { snap, snapshotted, engine: { snapshot: () => snap, snapshotQualia: (id) => snapshotted.push(id) } };
  };
  const fresh = () => { const db = new Database(":memory:"); up(db); return db; };
  const rows = (db) => db.prepare("SELECT entity_id, channel, value FROM qualia_state ORDER BY entity_id, channel").all();

  it("async persist writes exactly what the sync persist writes (rows, counts, deltas, per-entity snapshots)", async () => {
    const a = fresh(); const b = fresh();
    const m1 = mkEngine(300, 6); globalThis.qualiaEngine = m1.engine;
    const s1 = persistQualiaState(a);
    const m2 = mkEngine(300, 6); globalThis.qualiaEngine = m2.engine;
    const s2 = await persistQualiaStateAsync(b, { chunk: 50 });
    assert.deepEqual(s2, s1);
    assert.deepEqual(rows(b), rows(a));
    assert.equal(m2.snapshotted.length, 300);
    // second pass with moved values: deltas >= 0.05 are logged, identically
    const n1 = mkEngine(300, 6, 9); globalThis.qualiaEngine = n1.engine; const t1 = persistQualiaState(a);
    const n2 = mkEngine(300, 6, 9); globalThis.qualiaEngine = n2.engine; const t2 = await persistQualiaStateAsync(b, { chunk: 50 });
    assert.deepEqual(t2, t1);
    assert.equal(b.prepare("SELECT COUNT(*) n FROM qualia_log").get().n, a.prepare("SELECT COUNT(*) n FROM qualia_log").get().n);
    delete globalThis.qualiaEngine; a.close(); b.close();
  });

  it("prepares its statements once per db, not twice per channel", async () => {
    const real = fresh(); let prepares = 0;
    const db = new Proxy(real, { get(t, k) { if (k === "prepare") return (...a) => { prepares++; return t.prepare(...a); }; const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } });
    globalThis.qualiaEngine = mkEngine(500, 4).engine;
    await persistQualiaStateAsync(db, { chunk: 100 });
    await persistQualiaStateAsync(db, { chunk: 100 });
    assert.ok(prepares <= 3, `statements prepared once (got ${prepares}; the old loop prepared 2 per channel = 4000+)`);
    assert.equal(rows(real).length, 2000);
    delete globalThis.qualiaEngine; real.close();
  });

  it("yields to the event loop between chunks (control: one huge chunk does not)", async () => {
    const db = fresh(); globalThis.qualiaEngine = mkEngine(1200, 5).engine;
    let running = true; let interleaved = 0;
    const spin = () => { interleaved++; if (running) setImmediate(spin); };
    setImmediate(spin);
    await persistQualiaStateAsync(db, { chunk: 100 });
    running = false;
    assert.ok(interleaved >= 8, `other work ran between chunks (${interleaved})`);
    const db2 = fresh(); running = true; interleaved = 0; setImmediate(spin);
    await persistQualiaStateAsync(db2, { chunk: 1_000_000 });
    running = false;
    assert.ok(interleaved <= 2, `no yielding with a single chunk (${interleaved})`);
    delete globalThis.qualiaEngine; db.close(); db2.close();
  });

  it("every delta >= 0.05 is logged: the log id cannot collide within a millisecond", async () => {
    const db = fresh();
    globalThis.qualiaEngine = mkEngine(1500, 12, 0).engine; await persistQualiaStateAsync(db);
    globalThis.qualiaEngine = mkEngine(1500, 12, 50).engine; const r = await persistQualiaStateAsync(db);
    assert.equal(r.logged, 18000);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM qualia_log").get().n, 18000);
    delete globalThis.qualiaEngine; db.close();
  });

  it("no retained heap across 3 consecutive runs (needs --expose-gc; skipped otherwise)", async (t) => {
    if (typeof global.gc !== "function") return t.skip("run with node --expose-gc");
    const db = fresh(); globalThis.qualiaEngine = mkEngine(1500, 12).engine;
    await persistQualiaStateAsync(db); global.gc();
    const base = process.memoryUsage().heapUsed;
    for (let i = 0; i < 3; i++) { globalThis.qualiaEngine = mkEngine(1500, 12, i * 17).engine; await persistQualiaStateAsync(db); }
    delete globalThis.qualiaEngine; global.gc();
    const growthMb = (process.memoryUsage().heapUsed - base) / 1048576;
    assert.ok(growthMb < 8, `heap grew ${growthMb.toFixed(1)} MB across 3 runs`);
    db.close();
  });

  it("server.js: the heartbeat uses the async persist, and the idle branch honours heartbeatEnabled", () => {
    const src = fs.readFileSync(path.join(hereDir, "..", "server.js"), "utf8");
    assert.match(src, /const res = await persistQualiaStateAsync\(ctxDb\);/);
    const idle = src.slice(src.indexOf('let registry = "skipped_low_memory";'), src.indexOf('return { ok: true, skipped: "idle_no_users", registry };'));
    assert.match(idle, /if \(STATE\.settings\?\.heartbeatEnabled === false\) \{\s*registry = "heartbeat_disabled";\s*\} else if \(shouldPauseBackgroundOrchestration\(\) === false\)/);
  });
});

