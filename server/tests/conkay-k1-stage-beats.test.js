/**
 * ConKay K1 — honest stage-beat expansion.
 *
 * Track K, phase K1 of the ConKay JARVIS arc (docs/NEXT_ARC_PLAN.md §B). Only
 * `reason.verify` emitted `macro:stage` before this; K1 extends `emitMacroStage`
 * into every macro whose REAL execution has natural internal boundaries. The
 * beats are read from the true code structure (never invented, never a timer) —
 * that is the honest-by-construction contract the whole cockpit binds to.
 *
 * Each macro pins three things, following server/tests/conkay-macro-lifecycle.test.js:
 *   1. the real phases fire, in order, via the onStage/emitMacroStage hook;
 *   2. a THROWING hook never breaks the macro (the beats are pure decoration);
 *   3. the emitted stage names validate against the `macro:stage` event shape.
 *
 * Macros with no natural internal boundary (foundry.validate) stay
 * start/complete-only — the K1 honest stop-point — and are pinned to emit NOTHING.
 *
 * Run: node --test server/tests/conkay-k1-stage-beats.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { validateEvent } from "../lib/event-shapes.js";
import { runFEA } from "../lib/simulation/fea-solver.js";
import { generateForgeApp } from "../lib/forge-template-generator.js";
import { searchDtus, semanticSearchDtus } from "../lib/cross-lens-discovery.js";
import registerArActions from "../domains/ar.js";
import registerFoundryMacros from "../domains/foundry.js";
import { up as migrate191 } from "../migrations/191_foundry_worlds.js";

// Every emitted beat name must be a legal macro:stage payload — that is the
// contract the socket adapter + HUD depend on.
function assertBeatsValidate(stages) {
  for (const s of stages) {
    const v = validateEvent("macro:stage", { runId: "r-1", stage: s });
    assert.equal(v.ok, true, `stage ${JSON.stringify(s)} must validate: ${JSON.stringify(v)}`);
  }
}

// ─── FEA solve (lib runFEA — assemble → solve → postprocess) ──────────────────
describe("K1 — engineering FEA solve emits real assemble/solve/postprocess beats", () => {
  // A solvable 3-node beam (mirrors tests/depth/engineering-behavior.test.js).
  const model = () => ({
    nodes: [{ id: "n1", x: 0, y: 0 }, { id: "n2", x: 1, y: 0 }, { id: "n3", x: 2, y: 0 }],
    members: [
      { id: "m1", nodeI: "n1", nodeJ: "n2", area: 0.001, momentI: 1e-6, elasticModulus: 200e9, allowableStress: 250e6 },
      { id: "m2", nodeI: "n2", nodeJ: "n3", area: 0.001, momentI: 1e-6, elasticModulus: 200e9, allowableStress: 250e6 },
    ],
    loads: [{ nodeId: "n2", Fy: -1000 }],
    supports: [
      { nodeId: "n1", fixedDOF: ["x", "y", "z", "rx", "rz"] },
      { nodeId: "n3", fixedDOF: ["y", "z"] },
    ],
  });

  it("fires assembling → solving → postprocess in order from the real solve", () => {
    const stages = [];
    const r = runFEA({ ...model(), onStage: (s) => stages.push(s) });
    assert.equal(r.ok, true);
    assert.deepEqual(stages, ["assembling", "solving", "postprocess"]);
    assertBeatsValidate(stages);
  });

  it("a throwing onStage never breaks the solve (decoration only)", () => {
    const r = runFEA({ ...model(), onStage: () => { throw new Error("boom"); } });
    assert.equal(r.ok, true, "solve still returns despite a throwing hook");
  });

  it("emits no beats when the model is empty (early return before assembling)", () => {
    const stages = [];
    const r = runFEA({ nodes: [], members: [], onStage: (s) => stages.push(s) });
    assert.equal(r.ok, false);
    assert.deepEqual(stages, []);
  });
});

// ─── forge.generate (lib generateForgeApp — resolve template → compose) ───────
describe("K1 — forge generate emits real template/compose beats", () => {
  it("fires resolving_template → composing in order", () => {
    const stages = [];
    const out = generateForgeApp({ templateId: "blank", onStage: (s) => stages.push(s) });
    assert.ok(out.code && out.code.length > 0, "real code is generated");
    assert.deepEqual(stages, ["resolving_template", "composing"]);
    assertBeatsValidate(stages);
  });

  it("a throwing onStage never breaks generation", () => {
    const out = generateForgeApp({ templateId: "blank", onStage: () => { throw new Error("boom"); } });
    assert.ok(out.code && out.code.length > 0);
  });
});

// ─── discovery.search (lib searchDtus + semanticSearchDtus) ───────────────────
describe("K1 — discovery search emits real searching/reranking beats", () => {
  function seedDb() {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (
      id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT,
      data TEXT, lens_id TEXT, created_at INTEGER
    )`);
    // Two rows so the semantic rerank branch (base.results.length > 1) is reached.
    db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, created_at) VALUES (?,?,?,?,?,?)`)
      .run("d1", "note", "quantum resonance notes", "u1", "{}", 2);
    db.prepare(`INSERT INTO dtus (id, type, title, creator_id, data, created_at) VALUES (?,?,?,?,?,?)`)
      .run("d2", "note", "quantum lattice memo", "u1", "{}", 1);
    return db;
  }

  it("the keyword prefilter fires a real 'searching' beat", () => {
    const db = seedDb();
    const stages = [];
    const r = searchDtus(db, "quantum", { onStage: (s) => stages.push(s) });
    assert.equal(r.ok, true);
    assert.ok(stages.includes("searching"), JSON.stringify(stages));
    assertBeatsValidate(stages);
    db.close();
  });

  it("semantic search fires searching then reranking (embeddings offline → keyword fallback, still honest)", async () => {
    const db = seedDb();
    const stages = [];
    const r = await semanticSearchDtus(db, "quantum", { onStage: (s) => stages.push(s) });
    assert.equal(r.ok, true);
    // Both real phases ran: the prefilter, then the rerank attempt. With no
    // Ollama the rerank falls back to keyword — result.semantic reports that.
    assert.deepEqual(stages, ["searching", "reranking"]);
    assert.equal(r.semantic, false, "embeddings offline → honest keyword fallback");
    assertBeatsValidate(stages);
    db.close();
  });

  it("a throwing onStage never breaks search", () => {
    const db = seedDb();
    const r = searchDtus(db, "quantum", { onStage: () => { throw new Error("boom"); } });
    assert.equal(r.ok, true);
    db.close();
  });
});

// ─── ar.render (registerLensAction handler — resolve objects → build plan) ────
describe("K1 — ar.render emits real resolving_objects/building_plan beats", () => {
  function arRenderHandler() {
    const actions = new Map();
    registerArActions((domain, name, handler) => actions.set(`${domain}.${name}`, handler));
    return actions.get("ar.render");
  }
  const artifact = () => ({ id: "a1", title: "scene", data: { objects: [{ id: "o1", model: "box.glb" }] } });

  it("fires resolving_objects → building_plan in order", () => {
    const stages = [];
    const ctx = { actor: { userId: "u1" }, emitMacroStage: (s) => stages.push(s) };
    const r = arRenderHandler()(ctx, artifact(), {});
    assert.equal(r.ok, true);
    assert.deepEqual(stages, ["resolving_objects", "building_plan"]);
    assertBeatsValidate(stages);
  });

  it("a throwing emitMacroStage never breaks the render", () => {
    const ctx = { actor: { userId: "u1" }, emitMacroStage: () => { throw new Error("boom"); } };
    const r = arRenderHandler()(ctx, artifact(), {});
    assert.equal(r.ok, true);
  });
});

// ─── foundry preview + publish (multi-step) / validate (atomic stop-point) ────
describe("K1 — foundry preview/publish emit real beats; validate stays start/complete-only", () => {
  let db, call;
  beforeEach(() => {
    db = new Database(":memory:");
    migrate191(db);
    db.exec(`CREATE TABLE worlds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, universe_type TEXT NOT NULL,
      description TEXT, physics_modulators TEXT DEFAULT '{}', rule_modulators TEXT DEFAULT '{}',
      created_by TEXT, status TEXT NOT NULL DEFAULT 'active', total_visits INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    const macros = new Map();
    registerFoundryMacros((domain, name, handler) => macros.set(`${domain}.${name}`, handler));
    call = (name, input, stages) =>
      macros.get(name)(
        { db, actor: { userId: "user-1", role: "owner" }, emitMacroStage: stages ? (s) => stages.push(s) : undefined },
        input || {},
      );
  });

  const draftWith = (systems) => call("foundry.create", { name: "K1World", worldspec: { systems } }).world.id;

  it("foundry.preview fires compiling → persisting_preview", () => {
    const id = draftWith([{ id: "combat-motor" }]);
    const stages = [];
    const r = call("foundry.preview", { id }, stages);
    assert.equal(r.ok, true);
    assert.deepEqual(stages, ["compiling", "persisting_preview"]);
    assertBeatsValidate(stages);
  });

  it("foundry.publish fires validating → compiling → persisting", () => {
    const id = draftWith([{ id: "physics-modifiers", config: { gravity: 30 } }]);
    const stages = [];
    const r = call("foundry.publish", { id }, stages);
    assert.equal(r.ok, true);
    assert.deepEqual(stages, ["validating", "compiling", "persisting"]);
    assertBeatsValidate(stages);
  });

  it("foundry.validate emits NO beats (K1 honest stop-point: atomic, no natural boundary)", () => {
    const stages = [];
    const r = call("foundry.validate", { worldspec: { systems: [{ id: "combat-motor" }] } }, stages);
    assert.equal(r.ok, true);
    assert.deepEqual(stages, [], "atomic macro must stay start/complete-only");
  });
});
