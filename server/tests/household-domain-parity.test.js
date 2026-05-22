// Contract tests for the household lens — Tody / Sweepy-shape chore
// substrate in server/domains/household.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHouseholdActions from "../domains/household.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`household.${name}`);
  assert.ok(fn, `household.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHouseholdActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newRoom(ctx = ctxA) {
  return call("room-create", ctx, { name: "Kitchen" }).result.room;
}

describe("household.room CRUD", () => {
  it("creates a room scoped per user", () => {
    newRoom();
    assert.equal(call("room-list", ctxA, {}).result.count, 1);
    assert.equal(call("room-list", ctxB, {}).result.count, 0);
  });
  it("delete removes the room and its tasks", () => {
    const r = newRoom();
    call("task-create", ctxA, { roomId: r.id, name: "Mop floor" });
    call("room-delete", ctxA, { id: r.id });
    assert.equal(call("room-list", ctxA, {}).result.count, 0);
    assert.equal(call("task-list", ctxA, {}).result.count, 0);
  });
});

describe("household.task condition tracking", () => {
  it("a fresh task is clean; an overdue task needs attention", () => {
    const r = newRoom();
    const t = call("task-create", ctxA, { roomId: r.id, name: "Wipe counters", intervalDays: 7 }).result.task;
    assert.equal(call("task-list", ctxA, {}).result.tasks[0].condition.state, "clean");
    // backdate lastDoneAt 10 days
    t.lastDoneAt = new Date(Date.now() - 10 * 86400000).toISOString();
    assert.equal(call("task-list", ctxA, {}).result.tasks[0].condition.state, "needs_attention");
  });
  it("task-done resets the condition and awards effort-scaled points", () => {
    const r = newRoom();
    const t = call("task-create", ctxA, { roomId: r.id, name: "Deep clean", effort: "heavy" }).result.task;
    t.lastDoneAt = new Date(Date.now() - 30 * 86400000).toISOString();
    const done = call("task-done", ctxA, { id: t.id, by: "Sam" });
    assert.equal(done.result.pointsAwarded, 20);
    assert.equal(call("task-list", ctxA, {}).result.tasks[0].condition.state, "clean");
  });
  it("rejects a task in an unknown room", () => {
    assert.equal(call("task-create", ctxA, { roomId: "nope", name: "x" }).ok, false);
  });
});

describe("household.chore-board + leaderboard", () => {
  it("chore-board sorts the most urgent task first", () => {
    const r = newRoom();
    const fresh = call("task-create", ctxA, { roomId: r.id, name: "Fresh", intervalDays: 30 }).result.task;
    const stale = call("task-create", ctxA, { roomId: r.id, name: "Stale", intervalDays: 2 }).result.task;
    stale.lastDoneAt = new Date(Date.now() - 20 * 86400000).toISOString();
    const board = call("chore-board", ctxA, {}).result.board;
    assert.equal(board[0].name, "Stale");
    assert.ok(fresh);
  });
  it("leaderboard ranks people by points", () => {
    const r = newRoom();
    const t1 = call("task-create", ctxA, { roomId: r.id, name: "A", effort: "heavy" }).result.task;
    const t2 = call("task-create", ctxA, { roomId: r.id, name: "B", effort: "light" }).result.task;
    call("task-done", ctxA, { id: t1.id, by: "Ana" });
    call("task-done", ctxA, { id: t2.id, by: "Ben" });
    const lb = call("assignee-leaderboard", ctxA, {}).result.leaderboard;
    assert.equal(lb[0].person, "Ana");
    assert.equal(lb[0].points, 20);
  });
});

describe("household.vacation mode", () => {
  it("pausing freezes condition; resuming shifts the clock forward", () => {
    const r = newRoom();
    const t = call("task-create", ctxA, { roomId: r.id, name: "Vacuum", intervalDays: 7 }).result.task;
    t.lastDoneAt = new Date(Date.now() - 3 * 86400000).toISOString();
    const before = call("task-list", ctxA, {}).result.tasks[0].condition.ratio;
    call("vacation-toggle", ctxA, { on: true });
    const paused = call("task-list", ctxA, {}).result.tasks[0].condition.ratio;
    assert.ok(Math.abs(paused - before) < 0.05); // frozen
    call("vacation-toggle", ctxA, { on: false });
    const resumed = call("task-list", ctxA, {}).result.tasks[0].condition.ratio;
    assert.ok(Math.abs(resumed - before) < 0.05); // resumes from frozen point, not jumped
  });
  it("household-dashboard reports cleanliness + paused state", () => {
    const r = newRoom();
    call("task-create", ctxA, { roomId: r.id, name: "Tidy", intervalDays: 14 });
    const d = call("household-dashboard", ctxA, {});
    assert.equal(d.result.rooms, 1);
    assert.equal(d.result.tasks, 1);
    assert.equal(d.result.cleanlinessPct, 100);
    assert.equal(d.result.paused, false);
  });
});

describe("household — compute helpers still intact", () => {
  it("rotateChores handles input", () => {
    const r = call("rotateChores", ctxA, {});
    assert.equal(r.ok, true);
  });
});

describe("household.shared family calendar", () => {
  it("creates an event scoped per user", () => {
    call("calendar-event-create", ctxA, { title: "Dentist", date: "2026-06-01", time: "09:00" });
    assert.equal(call("calendar-event-list", ctxA, {}).result.count, 1);
    assert.equal(call("calendar-event-list", ctxB, {}).result.count, 0);
  });
  it("requires title and date", () => {
    assert.equal(call("calendar-event-create", ctxA, { date: "2026-06-01" }).ok, false);
    assert.equal(call("calendar-event-create", ctxA, { title: "X" }).ok, false);
  });
  it("update and delete an event", () => {
    const ev = call("calendar-event-create", ctxA, { title: "Soccer", date: "2026-06-02" }).result.event;
    const u = call("calendar-event-update", ctxA, { id: ev.id, title: "Soccer practice" });
    assert.equal(u.result.event.title, "Soccer practice");
    call("calendar-event-delete", ctxA, { id: ev.id });
    assert.equal(call("calendar-event-list", ctxA, {}).result.count, 0);
  });
  it("filters by date range and assignee", () => {
    call("calendar-event-create", ctxA, { title: "A", date: "2026-06-01", assignee: "Mom" });
    call("calendar-event-create", ctxA, { title: "B", date: "2026-07-01", assignee: "Dad" });
    assert.equal(call("calendar-event-list", ctxA, { from: "2026-06-15" }).result.count, 1);
    assert.equal(call("calendar-event-list", ctxA, { assignee: "Mom" }).result.count, 1);
  });
  it("calendar-upcoming-reminders surfaces events inside the reminder window", () => {
    const soon = new Date(Date.now() + 20 * 60000);
    const date = soon.toISOString().slice(0, 10);
    const time = soon.toTimeString().slice(0, 5);
    call("calendar-event-create", ctxA, { title: "Pickup", date, time, reminderMinutes: 30 });
    const r = call("calendar-upcoming-reminders", ctxA, {});
    assert.equal(r.result.count, 1);
    assert.equal(r.result.reminders[0].title, "Pickup");
  });
});

describe("household.meal planning calendar", () => {
  it("sets a meal slot and lists it", () => {
    call("meal-plan-set", ctxA, { date: "2026-06-01", slot: "dinner", recipe: "Tacos", ingredients: ["beef", "tortilla"] });
    assert.equal(call("meal-plan-list", ctxA, {}).result.count, 1);
  });
  it("re-setting the same date+slot replaces it", () => {
    call("meal-plan-set", ctxA, { date: "2026-06-01", slot: "lunch", recipe: "Salad" });
    call("meal-plan-set", ctxA, { date: "2026-06-01", slot: "lunch", recipe: "Soup" });
    const meals = call("meal-plan-list", ctxA, {}).result.meals;
    assert.equal(meals.length, 1);
    assert.equal(meals[0].recipe, "Soup");
  });
  it("rejects invalid slot", () => {
    assert.equal(call("meal-plan-set", ctxA, { date: "2026-06-01", slot: "brunch", recipe: "X" }).ok, false);
  });
  it("meal-grocery-list aggregates ingredients across meals", () => {
    call("meal-plan-set", ctxA, { date: "2026-06-01", slot: "dinner", recipe: "Tacos", ingredients: ["beef", "cheese"] });
    call("meal-plan-set", ctxA, { date: "2026-06-02", slot: "dinner", recipe: "Nachos", ingredients: ["beef", "salsa"] });
    const g = call("meal-grocery-list", ctxA, {}).result;
    assert.equal(g.uniqueItems, 3);
    const beef = g.list.find((x) => x.name === "beef");
    assert.equal(beef.count, 2);
  });
  it("meal-plan-delete removes a meal", () => {
    const m = call("meal-plan-set", ctxA, { date: "2026-06-03", slot: "breakfast", recipe: "Eggs" }).result.meal;
    call("meal-plan-delete", ctxA, { id: m.id });
    assert.equal(call("meal-plan-list", ctxA, {}).result.count, 0);
  });
});

describe("household.reward points / allowance", () => {
  it("computes allowance from the real chore log", () => {
    const r = newRoom();
    const t = call("task-create", ctxA, { roomId: r.id, name: "Dishes", effort: "heavy" }).result.task;
    call("task-done", ctxA, { id: t.id, by: "Kid" });
    const a = call("allowance-summary", ctxA, { dollarsPerPoint: 0.1 });
    assert.equal(a.result.members[0].person, "Kid");
    assert.equal(a.result.members[0].points, 20);
    assert.equal(a.result.members[0].allowance, 2);
    assert.equal(a.result.totalAllowance, 2);
  });
  it("empty log yields no members", () => {
    assert.equal(call("allowance-summary", ctxA, {}).result.members.length, 0);
  });
});

describe("household.per-member notifications", () => {
  it("creates and lists notifications scoped per user", () => {
    call("notification-create", ctxA, { recipient: "Sam", message: "Trash day" });
    assert.equal(call("notification-list", ctxA, {}).result.count, 1);
    assert.equal(call("notification-list", ctxB, {}).result.count, 0);
  });
  it("requires recipient and message", () => {
    assert.equal(call("notification-create", ctxA, { message: "X" }).ok, false);
    assert.equal(call("notification-create", ctxA, { recipient: "Sam" }).ok, false);
  });
  it("mark-read and filter by recipient/unread", () => {
    const n = call("notification-create", ctxA, { recipient: "Ann", message: "Pay bill" }).result.notification;
    call("notification-create", ctxA, { recipient: "Bob", message: "Walk dog" });
    assert.equal(call("notification-list", ctxA, { recipient: "Ann" }).result.count, 1);
    call("notification-mark-read", ctxA, { id: n.id });
    assert.equal(call("notification-list", ctxA, { unreadOnly: true }).result.count, 1);
    call("notification-mark-read", ctxA, { all: true });
    assert.equal(call("notification-list", ctxA, { unreadOnly: true }).result.count, 0);
  });
});

describe("household.shared shopping lists", () => {
  it("creates a list and adds/toggles/removes items", () => {
    const list = call("shopping-list-create", ctxA, { name: "Groceries" }).result.list;
    const item = call("shopping-item-add", ctxA, { listId: list.id, name: "Milk", addedBy: "Mom" }).result.item;
    let lists = call("shopping-list-list", ctxA, {}).result.lists;
    assert.equal(lists[0].itemCount, 1);
    call("shopping-item-toggle", ctxA, { listId: list.id, itemId: item.id, by: "Dad" });
    lists = call("shopping-list-list", ctxA, {}).result.lists;
    assert.equal(lists[0].checkedCount, 1);
    call("shopping-item-remove", ctxA, { listId: list.id, itemId: item.id });
    assert.equal(call("shopping-list-list", ctxA, {}).result.lists[0].itemCount, 0);
  });
  it("requires a list name and rejects unknown list", () => {
    assert.equal(call("shopping-list-create", ctxA, {}).ok, false);
    assert.equal(call("shopping-item-add", ctxA, { listId: "nope", name: "x" }).ok, false);
  });
  it("delete removes the list", () => {
    const list = call("shopping-list-create", ctxA, { name: "Hardware" }).result.list;
    call("shopping-list-delete", ctxA, { id: list.id });
    assert.equal(call("shopping-list-list", ctxA, {}).result.count, 0);
  });
});

describe("household.recurring task templates", () => {
  it("creates a template and lists it", () => {
    call("task-template-create", ctxA, { name: "Change HVAC filter", frequency: "quarterly" });
    assert.equal(call("task-template-list", ctxA, {}).result.count, 1);
  });
  it("requires a name", () => {
    assert.equal(call("task-template-create", ctxA, { frequency: "weekly" }).ok, false);
  });
  it("spawn materialises a real chore task with frequency-mapped interval", () => {
    const tpl = call("task-template-create", ctxA, { name: "Mow lawn", frequency: "biweekly", room: "Yard", effort: "heavy" }).result.template;
    const s = call("task-template-spawn", ctxA, { id: tpl.id });
    assert.equal(s.result.task.name, "Mow lawn");
    assert.equal(s.result.task.intervalDays, 14);
    assert.equal(call("room-list", ctxA, {}).result.rooms.some((r) => r.name === "Yard"), true);
  });
  it("delete removes the template", () => {
    const tpl = call("task-template-create", ctxA, { name: "Temp" }).result.template;
    call("task-template-delete", ctxA, { id: tpl.id });
    assert.equal(call("task-template-list", ctxA, {}).result.count, 0);
  });
});

describe("household.shared expense splitting", () => {
  it("adds an expense and splits it evenly", () => {
    const e = call("expense-add", ctxA, { description: "Groceries", amount: 90, paidBy: "Ann", splitAmong: ["Ann", "Bob", "Cy"] }).result.expense;
    assert.equal(e.sharePerPerson, 30);
    assert.equal(call("expense-list", ctxA, {}).result.total, 90);
  });
  it("rejects missing amount/paidBy/splitAmong", () => {
    assert.equal(call("expense-add", ctxA, { description: "X", paidBy: "Ann", splitAmong: ["Ann"] }).ok, false);
    assert.equal(call("expense-add", ctxA, { description: "X", amount: 10, splitAmong: ["Ann"] }).ok, false);
    assert.equal(call("expense-add", ctxA, { description: "X", amount: 10, paidBy: "Ann" }).ok, false);
  });
  it("expense-balances computes net owed and settle-up transfers", () => {
    call("expense-add", ctxA, { description: "Dinner", amount: 60, paidBy: "Ann", splitAmong: ["Ann", "Bob"] });
    const b = call("expense-balances", ctxA, {}).result;
    const ann = b.balances.find((x) => x.person === "Ann");
    const bob = b.balances.find((x) => x.person === "Bob");
    assert.equal(ann.net, 30);
    assert.equal(bob.net, -30);
    assert.equal(b.transfers[0].from, "Bob");
    assert.equal(b.transfers[0].to, "Ann");
    assert.equal(b.transfers[0].amount, 30);
  });
  it("settle removes an expense from the balance computation", () => {
    const e = call("expense-add", ctxA, { description: "Gas", amount: 40, paidBy: "Ann", splitAmong: ["Ann", "Bob"] }).result.expense;
    call("expense-settle", ctxA, { id: e.id });
    assert.equal(call("expense-balances", ctxA, {}).result.unsettledExpenses, 0);
    call("expense-delete", ctxA, { id: e.id });
    assert.equal(call("expense-list", ctxA, {}).result.count, 0);
  });
});
