// server/tests/maker-checker.test.js
//
// Maker-Checker Orchestrator (#9) — propose → verify loop. Deterministic: an
// injected maker + the deterministic shadow-council checker make the loop's
// outcome an exact oracle. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { runMakerChecker, dispatchMakerChecker, councilChecker } from "../lib/maker-checker.js";
import { createGoalTree, addSubgoals } from "../lib/goal-decomposition.js";
import registerOrchestrateMacros from "../domains/orchestrate.js";

describe("Maker-Checker Orchestrator (#9)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerOrchestrateMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("loops until the checker accepts, then stops early", async () => {
    // Checker accepts only when the proposal text contains 'STRONG'.
    const checker = (text) => ({ accept: /STRONG/.test(text), confidence: /STRONG/.test(text) ? 0.9 : 0.3, verdict: "x", dissent: [{ voice: "skeptic", concern: "weak" }] });
    // Maker emits a weak proposal on round 1, strong from round 2.
    const maker = (goal, round) => ({ text: round >= 2 ? `STRONG plan for ${goal}` : `weak plan for ${goal}` });
    const r = await runMakerChecker(db, { goal: "ship it", maker, checker, maxRounds: 5 });
    assert.equal(r.accepted, true);
    assert.equal(r.rounds.length, 2, "accepted on round 2, no further rounds");
    assert.ok(/STRONG/.test(r.finalProposal));
  });

  it("caps at maxRounds when never accepted", async () => {
    const checker = () => ({ accept: false, confidence: 0.1, verdict: "reject", dissent: [] });
    const maker = (g, round) => ({ text: `try ${round}` });
    const r = await runMakerChecker(db, { goal: "impossible", maker, checker, maxRounds: 3 });
    assert.equal(r.accepted, false);
    assert.equal(r.rounds.length, 3, "stopped at the cap");
    assert.ok(r.summary.includes("unresolved"));
  });

  it("feeds the checker's dissent into the next maker round", async () => {
    const seen = [];
    const checker = (text) => ({ accept: false, confidence: 0.2, verdict: "needs_more_data", dissent: [{ voice: "opposer", concern: `re:${text}` }] });
    const maker = (goal, round, priorDissent) => { seen.push(priorDissent.length); return { text: `r${round}` }; };
    await runMakerChecker(db, { goal: "iterate", maker, checker, maxRounds: 3 });
    assert.deepEqual(seen, [0, 1, 1], "round 1 has no prior dissent; later rounds receive it");
  });

  it("the default council checker returns a structured verdict", () => {
    const v = councilChecker(db, "Adopt a careful, well-evidenced, feasible plan");
    assert.equal(typeof v.accept, "boolean");
    assert.equal(typeof v.confidence, "number");
    assert.ok(Array.isArray(v.dissent));
  });

  it("dispatch runs the loop across a goal tree's actionable leaves", async () => {
    const t = createGoalTree(db, { userId: "u1", title: "Root", mintDtu: false });
    addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["leaf a", "leaf b"] });
    const alwaysAccept = () => ({ accept: true, confidence: 1, verdict: "accept", dissent: [] });
    const r = await dispatchMakerChecker(db, { goals: ["leaf a", "leaf b"], maker: (g) => ({ text: g }), checker: alwaysAccept });
    assert.equal(r.dispatched, 2);
    assert.ok(r.results.every((x) => x.accepted));
  });

  it("orchestrate.run uses the REAL brain maker — degrades honestly with no brain", async () => {
    // No injected maker → the real brainMaker runs. Offline (no Ollama reachable)
    // it must report makerUnavailable, NOT fabricate a proposal.
    const run = await macros.get("orchestrate.run")({ db, actor: { userId: "u2" } }, { goal: "evaluate a proposal", maxRounds: 2 });
    assert.equal(run.ok, true);
    assert.equal(run.makerUnavailable, true, "honest: no brain → no proposal");
    assert.equal(run.accepted, false);
    assert.equal(run.finalProposal, null, "nothing fabricated");
  });

  it("orchestrate.dispatch over a goal tree also degrades honestly offline", async () => {
    const t = createGoalTree(db, { userId: "u2", title: "Tree", mintDtu: false });
    addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["do x"] });
    const disp = await macros.get("orchestrate.dispatch")({ db, actor: { userId: "u2" } }, { treeId: t.treeId });
    assert.equal(disp.ok, true);
    assert.ok(disp.dispatched >= 1);
    assert.ok(disp.results.every((r) => r.makerUnavailable === true), "no fabricated proposals");
  });
});
