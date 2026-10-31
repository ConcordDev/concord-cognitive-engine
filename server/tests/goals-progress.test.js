// S3 — check-in wire + roll-up (Review 5 F3/F7), real domain import.
// Progress rule: latest check-in wins; a parent with no check-ins of
// its own shows the mean of its children's progress; no data -> null.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "s3-test" } };
const tree = (p) => actions.get("goals.alignmentTree")(ctx, null, p);
const checkin = (p) => actions.get("goals.checkin")(ctx, null, p);
const byId = (r) => Object.fromEntries(r.result.flat.map((o) => [o.id, o]));

beforeEach(() => { globalThis._concordSTATE = {}; });

test("check-ins move the objective and roll up by the stated rule", async () => {
  await tree({ op: "upsert", title: "Parent" });
  await tree({ op: "upsert", title: "Child", parentId: "obj_1" });
  await tree({ op: "upsert", title: "Child2", parentId: "obj_1" });

  const r = await checkin({ op: "add", goalId: "obj_2", confidence: 0.7, progress: 40 });
  assert.deepEqual(r.result.objectiveProgress, { progress: 40, progressSource: "checkin" });
  let flat = byId(await tree({ op: "list" }));
  assert.equal(flat.obj_2.progress, 40);
  assert.equal(flat.obj_1.progress, 40);
  assert.equal(flat.obj_1.progressSource, "rollup");

  await checkin({ op: "add", goalId: "obj_2", confidence: 0.7, progress: 60 });
  await checkin({ op: "add", goalId: "obj_3", confidence: 0.9, progress: 100 });
  flat = byId(await tree({ op: "list" }));
  assert.equal(flat.obj_1.progress, 80); // mean(60, 100)
});

test("no data means null progress, and cycles resolve to null", async () => {
  await tree({ op: "upsert", title: "A" });
  await tree({ op: "upsert", title: "B", parentId: "obj_1" });
  await tree({ op: "upsert", id: "obj_1", title: "A", parentId: "obj_2" });
  const flat = byId(await tree({ op: "list" }));
  assert.equal(flat.obj_1.progress, null);
  assert.equal(flat.obj_2.progress, null);
});
