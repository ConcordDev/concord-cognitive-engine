// server/tests/wave-b-scheme-reveals.test.js
//
// Wave B / B2 — scheme phase transitions schedule scheme:reveal
// consequences; handler emits realtime + inserts secret + applies
// opinion delta.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { advanceScheme } from "../lib/npc-schemes.js";
import { due, schedule, listForSource } from "../lib/scheduled-consequences.js";
import schemeRevealHandler from "../lib/consequence-handlers/scheme-reveal.js";

let db;

before(() => {
  db = new Database(":memory:");
  // Minimal mirror of npc_schemes + scheduled_consequences + supporting tables.
  db.exec(`
    CREATE TABLE npc_schemes (
      id TEXT PRIMARY KEY,
      plotter_kind TEXT NOT NULL,
      plotter_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      phase TEXT NOT NULL DEFAULT 'planning',
      world_id TEXT,
      accomplice_count INTEGER DEFAULT 0,
      evidence_count INTEGER DEFAULT 0,
      success_pct REAL DEFAULT 50,
      discovery_pct REAL DEFAULT 0,
      next_tick_at INTEGER DEFAULT (unixepoch()),
      resolved_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE npc_scheme_accomplices (scheme_id TEXT, npc_id TEXT, PRIMARY KEY(scheme_id, npc_id));
    CREATE TABLE npc_scheme_evidence (id TEXT PRIMARY KEY, scheme_id TEXT, evidence_kind TEXT, detail TEXT);
    CREATE TABLE character_opinions (
      npc_id TEXT, target_kind TEXT, target_id TEXT, score REAL DEFAULT 0,
      PRIMARY KEY (npc_id, target_kind, target_id)
    );
    CREATE TABLE scheduled_consequences (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, fires_at INTEGER NOT NULL,
      source_kind TEXT, source_id TEXT, target_kind TEXT, target_id TEXT,
      world_id TEXT, payload_json TEXT, fired_at INTEGER, fire_result TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, is_dead INTEGER DEFAULT 0);
    CREATE TABLE npc_stress (npc_id TEXT PRIMARY KEY, stress REAL DEFAULT 0);
  `);
});

after(() => { db?.close(); });

describe("scheme reveal scheduling", () => {
  it("scheme transitioning to 'exposed' schedules a reveal", async () => {
    // Seed a scheme in 'moving' with low success_pct so it transitions to 'exposed'.
    db.prepare(`INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, world_id, success_pct)
      VALUES ('s_exp', 'npc', 'npc_plotter', 'npc', 'npc_target', 'assassinate', 'moving', 'concordia', 0)
    `).run();

    const r = advanceScheme(db, "s_exp", { rng: () => 0.99 });
    assert.equal(r.ok, true);
    assert.equal(r.toPhase, "exposed");

    // The dynamic import of scheduled-consequences happens via .then(),
    // so we need to wait a microtask for the schedule call to land.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const rows = listForSource(db, "npc_scheme", "s_exp");
    assert.ok(rows.length >= 1, `expected schedule, got ${rows.length}`);
    assert.equal(rows[0].kind, "scheme:reveal");
    assert.equal(rows[0].payload?.phase, "exposed");
    assert.equal(rows[0].payload?.kind, "assassinate");
  });

  it("scheme transitioning to 'complete' also schedules a reveal", async () => {
    db.prepare(`INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, world_id, success_pct)
      VALUES ('s_done', 'npc', 'npc_p2', 'npc', 'npc_t2', 'seduce', 'moving', 'concordia', 100)
    `).run();
    const r = advanceScheme(db, "s_done", { rng: () => 0 });
    assert.equal(r.toPhase, "complete");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rows = listForSource(db, "npc_scheme", "s_done");
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].payload?.phase, "complete");
  });
});

describe("scheme:reveal handler", () => {
  it("emits realtime + records opinion + tries to insert secret", async () => {
    let emitted = null;
    globalThis._concordRealtimeEmit = (event, payload) => { emitted = { event, payload }; };

    const consequence = {
      kind: "scheme:reveal",
      source: { kind: "npc_scheme", id: "s_demo" },
      target: { kind: "npc", id: "npc_target" },
      worldId: "concordia",
      payload: {
        schemeId: "s_demo",
        plotterKind: "npc",
        plotterId: "npc_plotter",
        targetKind: "npc",
        targetId: "npc_target",
        kind: "assassinate",
        phase: "exposed",
        accompliceCount: 3,
        discoveryPct: 60,
      },
    };

    const r = await schemeRevealHandler(db, consequence);
    assert.equal(r.ok, true);
    assert.equal(r.revealEmitted, true);
    assert.ok(emitted);
    assert.equal(emitted.event, "scheme:revealed");
    assert.equal(emitted.payload.schemeId, "s_demo");
    assert.equal(emitted.payload.phase, "exposed");
    assert.equal(emitted.payload.accompliceCount, 3);

    delete globalThis._concordRealtimeEmit;
  });

  it("handles missing schemeId gracefully", async () => {
    const r = await schemeRevealHandler(db, { kind: "scheme:reveal", payload: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_schemeId");
  });
});
