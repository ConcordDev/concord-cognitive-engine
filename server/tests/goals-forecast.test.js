// S5 — forecast honesty (Review 5 F4), real domain import.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "s5-test" } };
const tree = (p) => actions.get("goals.alignmentTree")(ctx, null, p);
const checkin = (p) => actions.get("goals.checkin")(ctx, null, p);
const chart = (p) => actions.get("goals.progressChart")(ctx, null, p);
const forecast = (p, a = {}) => actions.get("goals.progressForecast")(ctx, { data: a }, p);

beforeEach(() => { globalThis._concordSTATE = {}; });

test("latest point is current; same-day series refuses honestly", async () => {
  await tree({ op: "upsert", title: "Child" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.7, progress: 40, period: "2026-10-28" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.7, progress: 60, period: "2026-10-28" });
  const r = await forecast({ goalId: "obj_1", target: 100 });
  assert.equal(r.result.currentState.progress, 60);
  assert.equal(r.result.regression, null);
  assert.match(r.result.forecast.reason, /single day/);
  assert.equal(r.result.velocity.trend, "improving");
});

test("spread series matches hand computation and the chart's pace", async () => {
  await tree({ op: "upsert", title: "Obj" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.8, progress: 20, period: "2026-10-01" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.8, progress: 40, period: "2026-10-11" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.8, progress: 60, period: "2026-10-21" });
  const r = await forecast({ goalId: "obj_1", target: 100 });
  assert.equal(r.result.forecast.estimatedCompletionDate, "2026-11-10");
  assert.equal(r.result.forecast.daysRemainingBest, 20);
  const c = await chart({ op: "series", goalId: "obj_1", target: 100 });
  assert.equal(r.result.pace, c.result.stats.pace);
});
