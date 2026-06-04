// Contract test for Wave 7 / Layer 5 — the salience-interrupt constraint-ladder.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectConstraint,
  resolveConstraint,
  shouldEscalate,
  makeEscalationBudget,
} from "../lib/affect-salience.js";

test("Wave 7 — salience interrupt / constraint-ladder (Layer 5)", async (t) => {
  await t.test("detectConstraint folds the three streams + returns most severe", () => {
    assert.equal(detectConstraint({}, {}, []), null, "clear world → no constraint");
    // need stream
    const need = detectConstraint({ needs: { hunger: 0.85, energy: 0.2 } }, {}, []);
    assert.deepEqual(need, { kind: "need", ref: "hunger", severity: 0.85 });
    // obstacle stream
    const obs = detectConstraint({}, { obstacle: { id: "river", severity: 0.7 } }, []);
    assert.equal(obs.kind, "obstacle");
    // agent stream (resource collision)
    const ag = detectConstraint({ goal: { resource: "bread" } }, {}, [{ id: "npc7", claimsResource: "bread", severity: 0.55 }]);
    assert.equal(ag.kind, "agent");
    // most severe wins across streams
    const both = detectConstraint({ needs: { hunger: 0.95 } }, { obstacle: { id: "x", severity: 0.5 } }, []);
    assert.equal(both.kind, "need");
  });

  await t.test("tier 1: obstacle with a free path → route-around, no escalate", () => {
    const c = detectConstraint({}, { obstacle: { id: "log", severity: 0.6 } }, []);
    const r = resolveConstraint(c, { hasRouteAround: true });
    assert.equal(r.tier, 1);
    assert.equal(r.action, "route_around");
  });

  await t.test("tier 2: blocked but a fallback goal exists → abandon, no escalate", () => {
    const c = detectConstraint({}, { blockedGoal: true }, []);
    const r = resolveConstraint(c, { hasRouteAround: false, hasFallbackGoal: true });
    assert.equal(r.tier, 2);
    assert.equal(r.action, "abandon");
  });

  await t.test("tier 3: blocked + no route + no fallback → dilemma escalate", () => {
    const c = detectConstraint({}, { blockedGoal: true }, []);
    const r = resolveConstraint(c, { hasRouteAround: false, hasFallbackGoal: false });
    assert.equal(r.tier, 3);
    assert.equal(r.action, "escalate");
    assert.equal(r.reason, "dilemma");
  });

  await t.test("temperament bends the branch: shy abandons sooner, bold pushes through", () => {
    const c = detectConstraint({}, { obstacle: { id: "wall", severity: 0.6 } }, []);
    // shy + a fallback → abandons even though a route might exist
    const shy = resolveConstraint(c, { hasRouteAround: true, hasFallbackGoal: true, coping: { proactiveReactive: -0.6 } });
    assert.equal(shy.tier, 2, "shy/reactive freezes-and-repicks sooner");
    // bold + only a maybe-route → still pushes through at tier 1
    const bold = resolveConstraint(c, { hasRouteAround: false, maybeRouteAround: true, hasFallbackGoal: true, coping: { proactiveReactive: 0.6 } });
    assert.equal(bold.tier, 1, "bold/proactive pushes through");
  });

  await t.test("a need can't be abandoned away — hunger with no path is a real dilemma", () => {
    const c = detectConstraint({ needs: { hunger: 0.9 } }, {}, []);
    const r = resolveConstraint(c, { hasRouteAround: false, hasFallbackGoal: true, coping: { proactiveReactive: -0.8 } });
    assert.equal(r.tier, 3, "you can't repick your way out of starving");
  });

  await t.test("shouldEscalate: FEAR 0.2→0.7 → drive_spike; calm → no", () => {
    const spike = shouldEscalate(
      { affect: { v: -0.3, a: 0.6 }, drives: { FEAR: 0.7 } },
      { affect: { v: 0.1, a: 0.3 }, drives: { FEAR: 0.2 } },
    );
    assert.equal(spike.escalate, true);
    assert.ok(["drive_spike", "valence_shock", "arousal_band"].includes(spike.reason));
    const calm = shouldEscalate(
      { affect: { v: 0.2, a: 0.2 }, drives: { FEAR: 0.25 } },
      { affect: { v: 0.2, a: 0.2 }, drives: { FEAR: 0.22 } },
    );
    assert.equal(calm.escalate, false);
  });

  await t.test("shouldEscalate: a tier-3 constraint always escalates as dilemma", () => {
    const r = shouldEscalate({ constraintTier: 3 }, {});
    assert.equal(r.escalate, true);
    assert.equal(r.reason, "dilemma");
  });

  await t.test("escalation budget: token bucket prevents a herd stampede", () => {
    let clock = 0;
    const budget = makeEscalationBudget({ perWorldPerMin: 3, now: () => clock });
    assert.equal(budget.tryConsume("w"), true);
    assert.equal(budget.tryConsume("w"), true);
    assert.equal(budget.tryConsume("w"), true);
    assert.equal(budget.tryConsume("w"), false, "4th in the same minute is denied");
    // a different world has its own bucket
    assert.equal(budget.tryConsume("w2"), true);
    // refill over time
    clock += 60000;
    assert.equal(budget.tryConsume("w"), true, "bucket refilled after a minute");
  });
});
