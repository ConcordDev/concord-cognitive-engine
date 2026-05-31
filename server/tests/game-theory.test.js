// Engine N1 — game theory (competing viability). Pins best response, pure Nash
// equilibria, dominant strategy, and the 2×2 cooperation-game taxonomy
// (the core faction-war/negotiation resolution will read).
//
// Run: node --test tests/game-theory.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bestResponseRow, bestResponseCol, pureNashEquilibria, dominantStrategyRow, classifyCooperationGame,
} from "../lib/game-theory/normal-form.js";

describe("best response + Nash", () => {
  // Prisoner's dilemma (action 0 = cooperate, 1 = defect): T=5,R=3,P=1,S=0
  const A = [[3, 0], [5, 1]]; // P1
  const B = [[3, 5], [0, 1]]; // P2

  it("best response is to defect against either action", () => {
    assert.deepEqual(bestResponseRow(A, 0), [1]); // vs cooperate → defect
    assert.deepEqual(bestResponseRow(A, 1), [1]); // vs defect → defect
    assert.deepEqual(bestResponseCol(B, 0), [1]);
  });

  it("the only pure Nash is mutual defection (the tragedy)", () => {
    const eq = pureNashEquilibria(A, B);
    assert.equal(eq.length, 1);
    assert.equal(eq[0].row, 1);
    assert.equal(eq[0].col, 1);
    assert.deepEqual(eq[0].payoffs, [1, 1]);
  });

  it("defect is the strictly dominant strategy", () => {
    assert.equal(dominantStrategyRow(A), 1);
  });
});

describe("cooperation-game taxonomy", () => {
  it("classifies the prisoner's dilemma (defection Nash, cooperation not)", () => {
    const g = classifyCooperationGame({ R: 3, T: 5, S: 0, P: 1 });
    assert.equal(g.name, "prisoners_dilemma");
    assert.equal(g.cooperationIsNash, false);
    assert.equal(g.defectionIsNash, true);
  });

  it("classifies the stag hunt (both cooperate AND both defect are Nash)", () => {
    const g = classifyCooperationGame({ R: 5, T: 3, S: 0, P: 2 });
    assert.equal(g.name, "stag_hunt");
    assert.equal(g.cooperationIsNash, true);  // cooperation is a (risky) equilibrium
    assert.equal(g.defectionIsNash, true);
  });

  it("classifies harmony (cooperation dominant)", () => {
    const g = classifyCooperationGame({ R: 5, T: 3, S: 2, P: 1 });
    assert.equal(g.name, "harmony");
    assert.equal(g.cooperationIsNash, true);
  });

  it("classifies chicken (mutual defection is the worst, two asymmetric Nash)", () => {
    const g = classifyCooperationGame({ R: 3, T: 5, S: 1, P: 0 });
    assert.equal(g.name, "chicken");
    assert.equal(g.defectionIsNash, false); // both-defect is NOT an equilibrium in chicken
  });

  it("no Nash without a coordination point still returns a game", () => {
    const g = classifyCooperationGame({ R: 2, T: 2, S: 2, P: 2 });
    assert.ok(g.name);
  });
});
