// Contract test for Wave 7 / Track B4 — the salience-driven brain loop (tick gate).
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideDeliberation } from "../lib/agent-brain-loop.js";
import { makeEscalationBudget } from "../lib/affect-salience.js";

test("Track B4 — salience brain-loop gate (feeling decides when to think)", async (t) => {
  await t.test("calm agent with a clear world does NOT deliberate (free tick)", () => {
    const d = decideDeliberation(
      { affect: { v: 0.2, a: 0.2 }, drives: { FEAR: 0.2 } },
      {}, [],
      { affect: { v: 0.2, a: 0.2 }, drives: { FEAR: 0.2 } },
    );
    assert.equal(d.deliberate, false);
    assert.equal(d.tier, 0);
  });

  await t.test("obstacle with a route → tier-1, no LLM", () => {
    const d = decideDeliberation({ goal: { resource: "ore" } }, { obstacle: { id: "rock", severity: 0.6 } }, [],
      {}, { hasRouteAround: true });
    assert.equal(d.deliberate, false);
    assert.equal(d.tier, 1);
  });

  await t.test("blocked + fallback goal → tier-2 abandon, no LLM", () => {
    const d = decideDeliberation({}, { blockedGoal: true }, [], {}, { hasFallbackGoal: true });
    assert.equal(d.deliberate, false);
    assert.equal(d.tier, 2);
  });

  await t.test("real dilemma (no route, no fallback) → deliberate (tier-3 LLM wake)", () => {
    const d = decideDeliberation({ needs: { hunger: 0.9 } }, {}, [], {},
      { hasRouteAround: false, hasFallbackGoal: false });
    assert.equal(d.tier, 3);
    assert.equal(d.deliberate, true);
  });

  await t.test("a raw affect spike wakes thinking even with no constraint", () => {
    const d = decideDeliberation(
      { affect: { v: -0.6, a: 0.8 }, drives: { FEAR: 0.8 } },
      {}, [],
      { affect: { v: 0.2, a: 0.2 }, drives: { FEAR: 0.2 } },
    );
    assert.equal(d.deliberate, true);
    assert.equal(d.tier, 3);
  });

  await t.test("budget exhaustion suppresses the LLM wake (no stampede)", () => {
    const clock = 0;
    const budget = makeEscalationBudget({ perWorldPerMin: 1, now: () => clock });
    const dilemma = { needs: { hunger: 0.95 }, worldId: "w" };
    const ctx = { hasRouteAround: false, hasFallbackGoal: false, budget };
    const first = decideDeliberation(dilemma, {}, [], {}, ctx);
    assert.equal(first.deliberate, true, "first dilemma gets the token");
    const second = decideDeliberation(dilemma, {}, [], {}, ctx);
    assert.equal(second.deliberate, false);
    assert.equal(second.reason, "budget_exhausted");
  });
});
