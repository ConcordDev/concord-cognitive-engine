// tests/depth/household-behavior.test.js — REAL behavioral tests for the
// household domain (registerLensAction family → lens.run → r.result.<field>).
// Covers the pure-calc handlers (grocery aggregation, maintenance scheduling,
// chore rotation) plus the STATE-backed Tody/Cozi CRUD substrate (rooms/tasks,
// shopping lists, meal plans, expense splitting math). Skips the two network
// Open Food Facts lookups.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("household — pure calc contracts", () => {
  it("generateGroceryList: aggregates duplicate ingredients and subtracts pantry", async () => {
    const r = await lensRun("household", "generateGroceryList", {
      data: {
        mealPlan: [
          { day: "Mon", meal: "dinner", ingredients: [{ name: "Flour", quantity: 2, unit: "cup", category: "baking" }] },
          { day: "Tue", meal: "lunch", ingredients: [{ name: "Flour", quantity: 1, unit: "cup", category: "baking" }] },
        ],
        pantry: [{ name: "Flour", quantity: 0.5, unit: "cup" }],
      },
    });
    assert.equal(r.ok, true);
    const flour = r.result.list.find((x) => x.name === "Flour");
    assert.equal(flour.quantity, 2.5);              // 2 + 1 − 0.5 pantry
    assert.equal(flour.hadOnHand, 0.5);
    assert.equal(r.result.mealsPlanned, 2);
    assert.ok(flour.usedIn.includes("Mon dinner") && flour.usedIn.includes("Tue lunch"), "tracks usedIn meals");
  });

  it("generateGroceryList: fully-stocked pantry drops the item from the list", async () => {
    const r = await lensRun("household", "generateGroceryList", {
      data: {
        mealPlan: [{ day: "Mon", meal: "dinner", ingredients: [{ name: "Salt", quantity: 1, unit: "tsp" }] }],
        pantry: [{ name: "Salt", quantity: 5, unit: "tsp" }],
      },
    });
    assert.equal(r.result.uniqueItems, 0);
    assert.equal(r.result.list.length, 0);          // needed = 1 − 5 = −4 ≤ 0
  });

  it("maintenanceCheck: classifies an item past its interval as overdue with day count", async () => {
    const r = await lensRun("household", "maintenanceCheck", {
      data: { maintenanceItems: [{ name: "Replace filter", lastCompleted: "2000-01-01", intervalDays: 30, priority: "high" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.overdueCount, 1);
    const od = r.result.overdue.find((x) => x.name === "Replace filter");
    assert.equal(od.status, "overdue");
    assert.ok(od.daysOverdue > 1000, "stale item is thousands of days overdue");
  });

  it("maintenanceCheck: an item never completed is flagged never-completed", async () => {
    const r = await lensRun("household", "maintenanceCheck", {
      data: { maintenanceItems: [{ name: "Service furnace", intervalDays: 365 }] },
    });
    const od = r.result.overdue.find((x) => x.name === "Service furnace");
    assert.equal(od.status, "never-completed");
    assert.equal(od.daysOverdue, null);
  });

  it("maintenanceDue: rejects nothing but reports current vs overdue split by lastServiceDate", async () => {
    const r = await lensRun("household", "maintenanceDue", {
      data: {
        maintenanceItems: [
          { name: "HVAC", lastServiceDate: "2000-01-01", intervalDays: 180, category: "hvac" },
          { name: "Roof", lastServiceDate: "2099-01-01", intervalDays: 365, category: "exterior" },
        ],
      },
      params: { lookaheadDays: 30 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.overdueCount, 1);          // HVAC long past due
    assert.ok(r.result.overdue.some((x) => x.name === "HVAC"), "HVAC overdue");
    assert.equal(r.result.currentCount, 1);          // Roof far in future
  });

  it("choreRotation: round-robin shifts each chore to the next member", async () => {
    const r = await lensRun("household", "choreRotation", {
      data: {
        chores: [{ name: "Dishes", currentAssignee: "Alice" }, { name: "Trash", currentAssignee: "Bob" }],
        members: ["Alice", "Bob", "Carol"],
      },
      params: { strategy: "round-robin" },
    });
    assert.equal(r.ok, true);
    const dishes = r.result.assignments.find((a) => a.chore === "Dishes");
    assert.equal(dishes.assignee, "Bob");            // Alice → next is Bob
    const trash = r.result.assignments.find((a) => a.chore === "Trash");
    assert.equal(trash.assignee, "Carol");           // Bob → next is Carol
    assert.equal(r.result.totalChores, 2);
  });

  it("choreRotation: empty members yields an error result (validation)", async () => {
    const r = await lensRun("household", "choreRotation", {
      data: { chores: [{ name: "Dishes" }], members: [] },
    });
    assert.match(String(r.result.error), /no household members/i);
  });
});

describe("household — STATE-backed CRUD round-trips + math", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("household-crud"); });

  it("room-create → task-create → task-list: task reads back under its room", async () => {
    const room = await lensRun("household", "room-create", { params: { name: "Kitchen" } }, ctx);
    assert.equal(room.ok, true);
    const roomId = room.result.room.id;
    const task = await lensRun("household", "task-create", { params: { roomId, name: "Mop floor", intervalDays: 7, effort: "medium" } }, ctx);
    assert.equal(task.result.task.name, "Mop floor");
    const taskId = task.result.task.id;
    const list = await lensRun("household", "task-list", { params: { roomId } }, ctx);
    assert.ok(list.result.tasks.some((t) => t.id === taskId), "created task is listed");
    const seen = list.result.tasks.find((t) => t.id === taskId);
    assert.equal(seen.condition.state, "clean");     // freshly created → clean
  });

  it("task-create: rejects an unknown roomId (validation)", async () => {
    const r = await lensRun("household", "task-create", { params: { roomId: "rm_nope", name: "X" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /room not found/i);
  });

  it("task-done: awards effort-based points and logs the chore", async () => {
    const room = await lensRun("household", "room-create", { params: { name: "Garage" } }, ctx);
    const task = await lensRun("household", "task-create", { params: { roomId: room.result.room.id, name: "Sweep", effort: "heavy" } }, ctx);
    const done = await lensRun("household", "task-done", { params: { id: task.result.task.id, by: "Dana" } }, ctx);
    assert.equal(done.result.pointsAwarded, 20);     // heavy = 20 pts
    assert.equal(done.result.by, "Dana");
    const board = await lensRun("household", "assignee-leaderboard", { params: {} }, ctx);
    assert.ok(board.result.leaderboard.some((p) => p.person === "Dana" && p.points >= 20), "Dana on leaderboard");
  });

  it("shopping-list-create → shopping-item-add → toggle: item checks off", async () => {
    const list = await lensRun("household", "shopping-list-create", { params: { name: "Weekly" } }, ctx);
    const listId = list.result.list.id;
    const add = await lensRun("household", "shopping-item-add", { params: { listId, name: "Milk", quantity: "2 gal" } }, ctx);
    const itemId = add.result.item.id;
    assert.equal(add.result.item.checked, false);
    const tog = await lensRun("household", "shopping-item-toggle", { params: { listId, itemId, checked: true, by: "Eve" } }, ctx);
    assert.equal(tog.result.item.checked, true);
    const lists = await lensRun("household", "shopping-list-list", { params: {} }, ctx);
    const seen = lists.result.lists.find((l) => l.id === listId);
    assert.equal(seen.checkedCount, 1);              // one item checked
  });

  it("expense-add: splits the amount evenly and computes per-person share", async () => {
    const r = await lensRun("household", "expense-add", {
      params: { description: "Groceries", amount: 90, paidBy: "Alice", splitAmong: ["Alice", "Bob", "Carol"] },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.expense.amount, 90);
    assert.equal(r.result.expense.sharePerPerson, 30);   // 90 / 3
  });

  it("expense-add: rejects non-positive amount (validation)", async () => {
    const r = await lensRun("household", "expense-add", {
      params: { description: "Free", amount: 0, paidBy: "Alice", splitAmong: ["Alice", "Bob"] },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /amount must be > 0/i);
  });

  it("expense-balances: nets a 90/3 split into a single settle-up transfer", async () => {
    // Fresh ctx so only this expense drives the balance math.
    const c2 = await depthCtx("household-balances");
    await lensRun("household", "expense-add", {
      params: { description: "Dinner", amount: 90, paidBy: "Alice", splitAmong: ["Alice", "Bob", "Carol"] },
    }, c2);
    const r = await lensRun("household", "expense-balances", { params: {} }, c2);
    assert.equal(r.result.unsettledExpenses, 1);
    const alice = r.result.balances.find((b) => b.person === "Alice");
    assert.equal(alice.net, 60);                     // paid 90, owes own 30 → +60
    // Each of Bob/Carol owes 30 → two transfers to Alice totalling 60.
    const total = r.result.transfers.reduce((s, t) => s + t.amount, 0);
    assert.equal(Math.round(total * 100) / 100, 60);
    assert.ok(r.result.transfers.every((t) => t.to === "Alice"), "all transfers flow to the payer");
  });

  it("meal-plan-set → meal-grocery-list: ingredients aggregate across planned meals", async () => {
    const c3 = await depthCtx("household-meals");
    await lensRun("household", "meal-plan-set", { params: { date: "2026-06-01", slot: "dinner", recipe: "Pasta", ingredients: ["Tomato", "Basil"] } }, c3);
    await lensRun("household", "meal-plan-set", { params: { date: "2026-06-02", slot: "lunch", recipe: "Salad", ingredients: ["Tomato", "Lettuce"] } }, c3);
    const groc = await lensRun("household", "meal-grocery-list", { params: {} }, c3);
    assert.equal(groc.result.mealsCovered, 2);
    const tomato = groc.result.list.find((x) => x.name === "Tomato");
    assert.equal(tomato.count, 2);                   // appears in both meals
    assert.equal(groc.result.uniqueItems, 3);        // Tomato, Basil, Lettuce
  });

  it("meal-plan-set: rejects an invalid slot (validation)", async () => {
    const r = await lensRun("household", "meal-plan-set", { params: { date: "2026-06-01", slot: "brunch", recipe: "X" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /breakfast\/lunch\/dinner\/snack/i);
  });

  it("allowance-summary: converts logged chore points into a dollar allowance", async () => {
    const c4 = await depthCtx("household-allowance");
    const room = await lensRun("household", "room-create", { params: { name: "Bath" } }, c4);
    const task = await lensRun("household", "task-create", { params: { roomId: room.result.room.id, name: "Scrub", effort: "medium" } }, c4);
    await lensRun("household", "task-done", { params: { id: task.result.task.id, by: "Finn" } }, c4); // 10 pts
    const r = await lensRun("household", "allowance-summary", { params: { dollarsPerPoint: 0.10 } }, c4);
    const finn = r.result.members.find((m) => m.person === "Finn");
    assert.equal(finn.points, 10);
    assert.equal(finn.allowance, 1.0);               // 10 pts × $0.10
    assert.equal(r.result.totalAllowance, 1.0);
  });
});
