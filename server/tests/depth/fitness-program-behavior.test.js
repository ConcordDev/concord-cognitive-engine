// tests/depth/fitness-program-behavior.test.js
//
// Behavioral coverage for the deterministic workout-program generator (Batch H:
// fitness.workout-plan-generate was LLM-only — dead without a model — and the lens's
// "Generate program" button (generate-program) was an AI-catch-all). The default path
// now composes a real periodised plan from goal/equipment/experience/frequency with no
// model. Asserts the computed structure, not shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

test("fitness.workout-plan-generate builds a deterministic plan with the right day count", async () => {
  const r = await lensRun("fitness", "workout-plan-generate", {
    params: { goal: "hypertrophy", daysPerWeek: 4, weeks: 8, equipment: "full_gym", experience: "intermediate" },
  });
  const res = r.result ?? r;
  assert.deepStrictEqual(res.plan.composedBy, "deterministic");
  assert.equal(res.plan.template.length, 4, "4 training days for a 4-day split");
  // hypertrophy rep scheme: 4 sets, 8-12 reps
  const ex = res.plan.template[0].exercises[0];
  assert.equal(ex.sets, 4);
  assert.equal(ex.reps, "8-12");
  // intermediate → 4 exercises per day
  assert.equal(res.plan.template[0].exercises.length, 4);
  assert.ok(res.plan.progression.length > 0 && res.plan.nutrition.length > 0);
});

test("fitness.generate-program (lens button alias) yields the same deterministic plan", async () => {
  const r = await lensRun("fitness", "generate-program", {
    data: { goal: "strength", daysPerWeek: 3, equipment: "bodyweight_only", experience: "beginner" },
  });
  const res = r.result ?? r;
  assert.deepStrictEqual(res.plan.template.length, 3);
  // strength: 5 sets, 3-5 reps; beginner → 3 exercises/day
  assert.equal(res.plan.template[0].exercises[0].sets, 5);
  assert.equal(res.plan.template[0].exercises.length, 3);
  // bodyweight equipment pulls bodyweight exercises
  const names = res.plan.template.flatMap((d) => d.exercises.map((e) => e.name)).join(' ');
  assert.match(names, /Push-Up|Pull-Up|Squat|Lunge/, "uses bodyweight movements");
});
