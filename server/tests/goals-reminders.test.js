// S8 — reminders fire (Review 5 F9), real domain import. The bell
// entry goes through the real shared createNotification substrate.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "s8-test" } };
const reminder = (p) => actions.get("goals.reminder")(ctx, null, p);
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString(); };

beforeEach(() => { globalThis._concordSTATE = {}; });

test("a due reminder fires once on observation; stats stay exclusive", async () => {
  await reminder({ op: "create", label: "Review the plan", goalId: "obj_1", dueAt: daysFromNow(-1) });
  await reminder({ op: "create", label: "Future", dueAt: daysFromNow(2) });
  let r = await reminder({ op: "list" });
  const past = r.result.reminders.find((x) => x.label === "Review the plan");
  assert.equal(past.firedCount, 1);
  assert.ok(past.firedAt);
  assert.equal(r.result.stats.overdue, 1);
  assert.equal(r.result.stats.pending, 1);
  r = await reminder({ op: "list" });
  assert.equal(r.result.reminders.find((x) => x.label === "Review the plan").firedCount, 1);
});

test("completion is not firing; recurring reminders advance", async () => {
  const c = await reminder({ op: "create", label: "Daily", cadence: "daily", dueAt: daysFromNow(-3) });
  const id = c.result.reminder.id;
  let r = await reminder({ op: "list" });
  assert.equal(r.result.reminders[0].firedCount, 1);
  assert.ok(new Date(r.result.reminders[0].dueAt).getTime() > Date.now());
  r = await reminder({ op: "complete", id });
  assert.equal(r.result.reminders[0].firedCount, 1);
});
