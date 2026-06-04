// Contract test for Wave 7 / B4 — autonomous goal formation.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migAgent } from "../migrations/325_agent_identity.js";
import { createAgentSelf } from "../lib/agent-self.js";
import { proposeGoal, formGoalForAgent } from "../lib/agent-goals.js";

test("Track B4 — autonomous goal formation", async (t) => {
  await t.test("the dominant drive shapes the goal it forms", () => {
    const care = proposeGoal({ drive_profile: { CARE: 0.9, SEEKING: 0.2 }, core_values: ["care_for_others"] });
    assert.equal(care.drive, "CARE");
    assert.match(care.goal, /look after|tend/i);
    const seek = proposeGoal({ drive_profile: { SEEKING: 0.9, CARE: 0.2 }, core_values: ["curiosity"] });
    assert.equal(seek.drive, "SEEKING");
    assert.match(seek.goal, /learn|explore/i);
  });

  await t.test("felt-peaks bias which drive leads (A6 closes into goal formation)", () => {
    // base drives lean SEEKING, but a life lately full of FEAR peaks reaches for safety
    const base = { drive_profile: { SEEKING: 0.55, FEAR: 0.5 }, core_values: ["courage"] };
    const calm = proposeGoal(base);
    const haunted = proposeGoal({ ...base, recentPeaks: [
      { drive: "FEAR", intensity: 0.9 }, { drive: "FEAR", intensity: 0.9 },
    ] });
    assert.equal(calm.drive, "SEEKING");
    assert.equal(haunted.drive, "FEAR", "a frightened recent history reaches for safety");
  });

  await t.test("the goal is anchored to a core value (autotelic orienting vector)", () => {
    const g = proposeGoal({ drive_profile: { SEEKING: 0.8 }, core_values: ["honesty", "non_coercion"] }, { seed: "x" });
    assert.ok(["honesty", "non_coercion"].includes(g.anchoredValue));
    assert.equal(g.autotelic, true);
    assert.equal(g.orienting, true);
    assert.match(g.goal, /honesty|coerc/i, "the value is woven into the goal");
  });

  await t.test("deterministic within a day (no mid-day whiplash)", () => {
    const self = { agent_id: "a1", drive_profile: { PLAY: 0.8 }, core_values: ["playfulness"] };
    const now = Date.UTC(2026, 5, 4, 12);
    assert.equal(proposeGoal(self, { now }).goal, proposeGoal(self, { now: now + 3600000 }).goal);
  });

  await t.test("formGoalForAgent reads the live self + forms a goal", () => {
    const db = new Database(":memory:");
    migAgent(db);
    const r = createAgentSelf(db, { worldId: "w", coreValues: ["curiosity"], driveProfile: { SEEKING: 0.9, CARE: 0.2, RAGE: 0.1, FEAR: 0.2, PANIC: 0.1, PLAY: 0.3, LUST: 0.1 } });
    const g = formGoalForAgent(db, r.agentId);
    assert.equal(g.ok, true);
    assert.equal(g.drive, "SEEKING");
    assert.ok(g.goal.length > 10);
    assert.equal(formGoalForAgent(db, "nonexistent").ok, false);
  });

  await t.test("totality on garbage", () => {
    assert.doesNotThrow(() => proposeGoal(null));
    assert.ok(proposeGoal({}).goal);
  });
});
