// S4 — chart from history, persisted (Review 5 F5), real domain import.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "s4-test" } };
const tree = (p) => actions.get("goals.alignmentTree")(ctx, null, p);
const checkin = (p) => actions.get("goals.checkin")(ctx, null, p);
const chart = (p) => actions.get("goals.progressChart")(ctx, null, p);

beforeEach(() => { globalThis._concordSTATE = {}; });

test("series derives from check-ins; manual points persist and remove", async () => {
  await tree({ op: "upsert", title: "Obj" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.7, progress: 40, period: "2026-10-20" });
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.8, progress: 60, period: "2026-10-27" });
  let r = await chart({ op: "series", goalId: "obj_1" });
  assert.equal(r.result.points.length, 2);
  assert.equal(r.result.stats.currentProgress, 60);

  r = await chart({ op: "add-point", goalId: "obj_1", date: "2026-10-28", progress: 80 });
  assert.equal(r.result.points.length, 3);
  assert.equal(r.result.stats.currentProgress, 80);
  const manualId = r.result.points.find((p) => p.source === "manual").id;
  r = await chart({ op: "remove-point", id: manualId, goalId: "obj_1" });
  assert.equal(r.result.points.length, 2);
});

test("manual progress out of range is rejected, not clamped", async () => {
  await tree({ op: "upsert", title: "Obj" });
  const bad = await chart({ op: "add-point", goalId: "obj_1", date: "2026-10-25", progress: 150 });
  assert.equal(bad.ok, false);
  const r = await chart({ op: "series", goalId: "obj_1" });
  assert.equal(r.result.points.length, 0);
});
