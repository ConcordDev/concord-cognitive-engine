// server/tests/rnd.test.js
//
// Private R&D Engine (#21) + Tier-0 wire-the-unwired. Pins that the previously
// unreachable FEA solver, causal-closure analyzer, and hypothesis engine are now
// reachable via macros, and that `rnd.run` chains them into one loop that mints a
// provenance DTU. Offline: CAS/FEA/closure are pure; hypothesis is in-memory;
// grounding/LLM degrade gracefully (no corpus, no Ollama).

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerRndMacros from "../domains/rnd.js";
import { runHypothesisCycle } from "../emergent/hypothesis-cycle.js";

function macrosFor() {
  const m = new Map();
  registerRndMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
  return m;
}

const CANTILEVER = {
  nodes: [{ id: "n1", x: 0, y: 0, z: 0 }, { id: "n2", x: 1, y: 0, z: 0 }],
  members: [{ id: "m1", nodeI: "n1", nodeJ: "n2", area: 0.01, momentI: 1e-5, elasticModulus: 2e11 }],
  supports: [{ nodeId: "n1", fixedDOF: "fixed" }],
  loads: [{ nodeId: "n2", Fy: -1000 }],
};

describe("R&D engine — wired engines reachable via macros", () => {
  let db, macros, ctx;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = macrosFor();
    ctx = { db, actor: { userId: "u1" } };
  });

  it("registers the rnd macros", () => {
    for (const m of ["fea", "cas", "causal_closure", "hypothesize", "hypotheses", "run"]) {
      assert.ok(macros.has(`rnd.${m}`), `rnd.${m} registered`);
    }
  });

  it("rnd.fea solves a cantilever (the dead FEA solver is now reachable)", async () => {
    const r = await macros.get("rnd.fea")(ctx, { model: CANTILEVER });
    assert.equal(r.ok, true, `fea failed: ${r.error}`);
    assert.equal(r.displacements.length, 2);
    const n2 = r.displacements.find((d) => d.nodeId === "n2");
    assert.ok(Math.abs(n2.dy) > 0, "loaded free node deflects");
    // empty model is handled, not thrown
    assert.equal((await macros.get("rnd.fea")(ctx, { model: { nodes: [], members: [] } })).ok, false);
  });

  it("rnd.cas does symbolic algebra", async () => {
    const d = await macros.get("rnd.cas")(ctx, { op: "differentiate", expression: "x^2", variable: "x" });
    assert.equal(d.ok, true);
    assert.match(String(d.result), /2/);
    assert.match(String(d.result), /x/);
    const e = await macros.get("rnd.cas")(ctx, { op: "evaluate", expression: "x + 1", assignment: { x: 4 } });
    assert.equal(e.ok, true);
    assert.equal(Number(e.result), 5);
  });

  it("rnd.causal_closure detects a learnable relationship (residual analyzer reachable)", async () => {
    // buildDesign predicts target[t+1] from features[t], so make y[t+1] = 2*x[t]
    // (fully explained by x → finite, learnable). Pins the analyzer is reachable.
    const rows = [];
    let prevX = 0;
    for (let t = 0; t < 24; t++) {
      const x = Math.sin(t * 0.7) + t * 0.05;
      rows.push({ x, y: 2 * prevX });
      prevX = x;
    }
    const r = await macros.get("rnd.causal_closure")(ctx, { rows, featureKeys: ["x"], targetKey: "y" });
    assert.equal(r.ok, true, `closure failed: ${r.reason}`);
    assert.ok(r.prediction.r2 > 0.9, "x explains y → high R²");
    assert.equal(r.verdict, "closed", "fully explained → closed");
  });

  it("rnd.hypothesize + hypotheses wire the hypothesis engine", async () => {
    const h = await macros.get("rnd.hypothesize")(ctx, { statement: "Frost magic is stronger in cold cells", domain: "rnd" });
    assert.equal(h.ok, true, `propose failed: ${h.error}`);
    assert.ok(h.hypothesis.id);
    const list = await macros.get("rnd.hypotheses")(ctx, {});
    assert.equal(list.ok, true);
    assert.ok(list.hypotheses.some((x) => x.id === h.hypothesis.id));
  });

  it("rnd.run chains hypothesis → grounding → compute → DTU", async () => {
    const r = await macros.get("rnd.run")(ctx, { goal: "Does conscience deter power-seeking?", expression: "x + x", casOp: "simplify" });
    assert.equal(r.ok, true);
    assert.ok(r.hypothesisId, "framed a hypothesis");
    assert.match(r.synthesis, /conscience/i, "synthesis names the goal");
    assert.ok(r.steps.compute.cas?.ok, "ran the CAS step");
    assert.ok(r.dtuId, "minted a provenance DTU");
    const dtu = db.prepare("SELECT lens_id, visibility FROM dtus WHERE id = ?").get(r.dtuId);
    assert.equal(dtu.lens_id, "rnd");
    assert.equal(dtu.visibility, "public");
  });

  it("the hypothesis-cycle heartbeat runs without throwing", async () => {
    const r = await runHypothesisCycle();
    assert.equal(r.ok, true);
    assert.ok(r.checked >= 1, "checked the proposed hypotheses");
  });
});
