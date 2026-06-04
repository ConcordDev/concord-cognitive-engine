// Contract test for Wave 7 / Track B7 + D1 — agents as each other's constraints +
// the cost-story proof (LLM calls track dilemmas, not population).
import { test } from "node:test";
import assert from "node:assert/strict";
import { collideAgents } from "../lib/agent-brain-loop.js";

test("Track B7 + D1 — emergence collision + cost-at-population", async (t) => {
  await t.test("A consuming the last shared resource registers as a constraint for B", () => {
    // A and B both want 'bread'; A has an alternate source, B does not + no fallback.
    const { results } = collideAgents([
      { id: "A", goal: { resource: "bread" }, hasRouteAround: true },           // alternate source
      { id: "B", goal: { resource: "bread" }, hasRouteAround: false, hasFallbackGoal: false },
    ]);
    const a = results.find((r) => r.id === "A");
    const b = results.find((r) => r.id === "B");
    assert.equal(a.tier, 1, "A routes around (alternate source) — no LLM");
    assert.equal(a.deliberate, false);
    assert.equal(b.tier, 3, "B has no alternative — a real dilemma");
    assert.equal(b.deliberate, true);
  });

  await t.test("most collisions resolve deterministically — the power law by construction", () => {
    // 100 agents competing for resources, but almost all have an alternate or a fallback.
    const agents = [];
    for (let i = 0; i < 100; i++) {
      const noWayOut = i < 4; // only 4 are in a genuine no-alternative bind
      agents.push({
        id: `npc${i}`,
        goal: { resource: i % 2 === 0 ? "water" : "wood" },
        hasRouteAround: !noWayOut,
        hasFallbackGoal: !noWayOut,
      });
    }
    const { escalations, total, deterministicRatio } = collideAgents(agents);
    assert.equal(total, 100);
    assert.ok(escalations <= 6, `only the genuine dilemmas escalate (${escalations})`);
    assert.ok(deterministicRatio >= 0.94, `~95%+ resolve for free (${deterministicRatio.toFixed(2)})`);
  });

  await t.test("scaling population does NOT scale LLM calls (the IP claim)", () => {
    function fixedDilemmaPopulation(n) {
      const agents = [];
      for (let i = 0; i < n; i++) {
        const noWayOut = i < 3; // a FIXED number of dilemmas regardless of n
        agents.push({ id: `a${i}`, goal: { resource: "ore" }, hasRouteAround: !noWayOut, hasFallbackGoal: !noWayOut });
      }
      return collideAgents(agents).escalations;
    }
    const small = fixedDilemmaPopulation(10);
    const large = fixedDilemmaPopulation(1000);
    assert.equal(small, large, "LLM wakes track dilemmas, not agent count — a thousand cost like ten");
  });

  await t.test("totality on empty / garbage", () => {
    assert.deepEqual(collideAgents([]).deterministicRatio, 1);
    assert.deepEqual(collideAgents(null).total, 0);
  });
});
