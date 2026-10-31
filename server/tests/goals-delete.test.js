// S10 — the delete standard (Review 5 F11), real domain import:
// removes are soft (trash + position), restore puts the item back.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "s10-test" } };
const tree = (p) => actions.get("goals.alignmentTree")(ctx, null, p);
const reminder = (p) => actions.get("goals.reminder")(ctx, null, p);
const checkin = (p) => actions.get("goals.checkin")(ctx, null, p);

beforeEach(() => { globalThis._concordSTATE = {}; });

test("objective soft-delete restores in place and re-links children", async () => {
  await tree({ op: "upsert", title: "Parent" });
  await tree({ op: "upsert", title: "Child", parentId: "obj_1" });
  const del = await tree({ op: "remove", id: "obj_1" });
  assert.ok(del.result.trashId);
  assert.equal(del.result.flat.length, 1);
  const back = await tree({ op: "restore", trashId: del.result.trashId });
  assert.equal(back.result.flat.length, 2);
  assert.equal(back.result.flat.find((o) => o.id === "obj_2").parentId, "obj_1");
});

test("reminder and check-in restore; cross-kind restore refuses", async () => {
  const rm = await reminder({ op: "create", label: "Ping", dueAt: "2027-01-01T00:00:00.000Z" });
  let r = await reminder({ op: "remove", id: rm.result.reminder.id });
  assert.equal(r.result.reminders.length, 0);
  const trashId = r.result.trashId;
  const cross = await checkin({ op: "restore", trashId });
  assert.equal(cross.ok, false);
  r = await reminder({ op: "restore", trashId });
  assert.equal(r.result.reminders.length, 1);
});
