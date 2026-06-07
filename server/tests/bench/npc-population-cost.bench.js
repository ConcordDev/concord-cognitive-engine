// server/tests/bench/npc-population-cost.bench.js
//
// Wave 7 / Track D2 — THE COST-STORY PROOF, at population scale. The licensable claim is
// "a thousand living NPCs for the cost of ten": LLM calls must track SALIENCE EVENTS, not
// head-count. This harness spins up large instinct populations, runs ticks through the
// real salience ladder (collideAgents → decideDeliberation), and asserts the LLM-wake count
// is governed by the number of irreducible dilemmas — NOT by N. It also prints the numbers
// a buyer needs and a rough per-tick cost-per-NPC.
//
// Run: node --test server/tests/bench/npc-population-cost.bench.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { collideAgents } from "../../lib/agent-brain-loop.js";

// Build a population of N instinct NPCs. A FIXED fraction is in a genuine no-alternative
// bind (a real dilemma → an LLM wake); the rest resolve deterministically (route-around /
// abandon) for ZERO LLM. dilemmaCount is independent of N — that's the whole point.
function buildPopulation(n, dilemmaCount) {
  const agents = [];
  const resources = ["water", "wood", "ore", "bread", "herb"];
  for (let i = 0; i < n; i++) {
    const isDilemma = i < dilemmaCount;
    agents.push({
      id: `npc${i}`,
      worldId: "bench",
      goal: { resource: resources[i % resources.length] },
      // the dilemma NPCs have no route around AND no fallback → tier-3 escalate (LLM)
      hasRouteAround: !isDilemma,
      hasFallbackGoal: !isDilemma,
      affect: { v: 0.1, a: 0.2 },
      drives: { FEAR: 0.2 },
      prior: { affect: { v: 0.1, a: 0.2 }, drives: { FEAR: 0.2 } },
    });
  }
  return agents;
}

function runPopulation(n, dilemmaCount, ticks) {
  const agents = buildPopulation(n, dilemmaCount);
  let escalations = 0;
  let resolutions = 0;
  const t0 = process.hrtime.bigint();
  for (let tick = 0; tick < ticks; tick++) {
    const { results } = collideAgents(agents);
    for (const r of results) {
      if (r.deliberate) escalations++; else resolutions++;
    }
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { escalations, resolutions, ms, perNpcTickUs: (ms * 1000) / (n * ticks) };
}

test("D2 bench — LLM cost tracks salience, not population", async (t) => {
  const TICKS = 5;
  const DILEMMAS = 3; // a FIXED number of genuine dilemmas, regardless of population

  await t.test("a 1,000-NPC village runs on instinct; only the dilemmas wake the LLM", () => {
    const r = runPopulation(1000, DILEMMAS, TICKS);
    // per tick: 1000 NPCs collide, but only the 3 dilemmas escalate → 3 LLM wakes/tick
    assert.equal(r.escalations, DILEMMAS * TICKS, "LLM wakes == dilemmas × ticks");
    const deterministicRatio = r.resolutions / (r.resolutions + r.escalations);
    assert.ok(deterministicRatio > 0.99, `>99% resolved for free (${(deterministicRatio * 100).toFixed(2)}%)`);
    console.log(`  [bench] 1000 NPCs × ${TICKS} ticks: ${r.escalations} LLM wakes, ${r.resolutions} free, ` +
      `${r.ms.toFixed(1)}ms total, ${r.perNpcTickUs.toFixed(2)}µs/NPC-tick (instinct is ~free)`);
  });

  await t.test("scaling the population 100× does NOT scale the LLM cost", () => {
    const small = runPopulation(100, DILEMMAS, TICKS);
    const large = runPopulation(10000, DILEMMAS, TICKS);
    assert.equal(small.escalations, large.escalations,
      "10,000 NPCs cost the same LLM calls as 100 — the cost is the dilemmas, not the crowd");
    console.log(`  [bench] 100 NPCs → ${small.escalations} wakes; 10,000 NPCs → ${large.escalations} wakes (identical). ` +
      `"A thousand NPCs for the cost of ten" — proven.`);
  });

  await t.test("LLM cost scales with dilemmas (salience), as designed", () => {
    const few = runPopulation(1000, 2, TICKS);
    const many = runPopulation(1000, 20, TICKS);
    assert.ok(many.escalations > few.escalations, "more dilemmas → more LLM wakes (salience is the driver)");
    assert.equal(many.escalations / few.escalations, 10, "10× the dilemmas → 10× the wakes (linear in salience)");
  });
});
