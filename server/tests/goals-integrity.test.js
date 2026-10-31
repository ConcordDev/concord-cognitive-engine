// S11 — input integrity (Review 5 F12), real domain import.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "s11-test" } };
const checkin = (p) => actions.get("goals.checkin")(ctx, null, p);

beforeEach(() => { globalThis._concordSTATE = {}; });

test("progress 150 is refused with a stated error; nothing stored", async () => {
  const r = await checkin({ op: "add", goalId: "obj_1", confidence: 0.7, progress: 150 });
  assert.equal(r.ok, false);
  assert.match(r.error, /between 0 and 100/);
  const list = await checkin({ op: "list" });
  assert.equal(list.result.checkins.length, 0);
});

test("valid progress stores exactly as entered", async () => {
  await checkin({ op: "add", goalId: "obj_1", confidence: 0.7, progress: 42.5 });
  const list = await checkin({ op: "list" });
  assert.equal(list.result.checkins[0].progress, 42.5);
});
