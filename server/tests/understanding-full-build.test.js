// Understanding full-build pins (S1): the engine vocabulary is
// registered on the lens path, raw text composes into a unit with
// claims, and the evolution verbs answer against the real tables.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerUnderstandingActions from "../domains/understanding.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) { ACTIONS.set(name, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`understanding.${name} not registered`);
  const virtualArtifact = { id: null, domain: "understanding", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}
before(() => { registerUnderstandingActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("understanding S1 — the pipeline runs", () => {
  let db; let ctx;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    ctx = { actor: { userId: "user_a" }, userId: "user_a", db };
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("registers the full engine vocabulary the panels call", () => {
    for (const n of ["parse", "compose", "engine_list", "recompose", "sweep", "subject_kinds",
      "record_evidence", "evaluate_promotion", "apply_promotion", "evolution_stats",
      "evolution_tick", "lineage", "consolidate", "consolidation_candidates"]) {
      assert.ok(ACTIONS.has(n), `missing registration: ${n}`);
    }
  });

  it("parse preview produces claims from raw text (the default mode)", async () => {
    const r = await call("parse", ctx, {
      subjectKind: "raw", composer: "rules",
      text: "Photosynthesis converts sunlight into chemical energy. Plants release oxygen as a byproduct.",
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.understanding.claims.length, 2);
  });

  it("compose & save creates a unit that Browse (engine_list) returns; stats count it", async () => {
    const r = await call("compose", ctx, {
      subjectKind: "raw", composer: "rules",
      text: "Tides are caused by the Moon. The Sun also exerts a tidal force.",
    });
    assert.equal(r.ok, true, r.error);
    assert.ok(r.result.id);
    const list = await call("engine_list", ctx, {});
    assert.equal(list.result.rows.length, 1);
    assert.equal(list.result.rows[0].id, r.result.id);
    const stats = await call("evolution_stats", ctx, {});
    assert.equal(stats.result.stats.totalUnderstandings, 1);
    assert.equal(typeof stats.result.stats.promotedCount, "number");
  });

  it("evidence + promotion evaluate against the real unit; lineage answers", async () => {
    const r = await call("compose", ctx, { subjectKind: "raw", text: "Water is wet. Ice is frozen water." });
    const id = r.result.id;
    const ev = await call("record_evidence", ctx, { id, evidence: "observed in lab", kind: "confirm" });
    assert.equal(ev.ok, true, ev.error);
    const evalR = await call("evaluate_promotion", ctx, { id });
    assert.equal(evalR.ok, true, evalR.error);
    assert.ok("decision" in evalR.result);
    const lin = await call("lineage", ctx, { id });
    assert.equal(lin.ok, true);
    assert.ok(Array.isArray(lin.result.lineage));
    const missing = await call("evaluate_promotion", ctx, { id: "und_nope" });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "not_found");
  });

  it("the llm composer flag is refused in words, not silently stamped deterministic", async () => {
    const r = await call("compose", ctx, { subjectKind: "raw", composer: "llm", text: "Anything at all." });
    assert.equal(r.ok, false);
    assert.match(r.error, /llm composer is not wired/);
  });
});
