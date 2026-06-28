// Behavioral macro tests for the household lens — the PATH-3
// registerLensAction surface in server/domains/household.js the
// /lenses/household page + its child components drive:
//
//   Pure calculators (page Domain Actions + HouseholdActionPanel + ChoreRotation):
//     generateGroceryList · choreRotation · rotateChores · maintenanceCheck ·
//     maintenanceDue · weeklySummary · allowance-summary
//   STATE-backed Tody/Cozi substrate (ChoreBoard / FamilyCalendar / MealPlanner /
//     MemberNotifications / SharedShoppingLists / RecurringTemplates / ExpenseSplitter):
//     room-* · task-* · chore-board · assignee-leaderboard · vacation-toggle ·
//     household-dashboard · calendar-event-* · meal-plan-* · meal-grocery-list ·
//     notification-* · shopping-list-* · shopping-item-* · task-template-* ·
//     expense-* · expense-balances
//
// THE COMPONENT-EXACT-SHAPE CONTRACT (the dead-calculator class this gate targets):
//   The dispatch maps the run-action input to BOTH virtualArtifact.data AND the
//   3rd `params` arg (sole-key {artifact:{data}} bodies are peeled; flat bodies
//   pass through; a 2-key {artifact:{data},x} body is NOT peeled). The handlers
//   read artifact.data.X || params.X so the page's derived params AND a flat
//   panel body both reach the calculator. Before this pass:
//     • ChoreRotation sent {artifact:{data:{chores,members}},strategy,weeks}
//       (two-key, NOT peeled) → artifact.data.chores === undefined → "No chores
//       defined" DEAD SURFACE; and rendered result.rotation / a.member which the
//       handler never returns (it returns result.assignments / a.assignee).
//     • HouseholdActionPanel sent {meals:[strings]} (handler read .mealPlan) and
//       rendered result.items/.rotation/.choresDone (handler returns
//       .list/.assignments/.choresCompleted) → fully dead.
//   These tests drive the EXACT params each surface now emits and assert the
//   EXACT computed values the panels render.
//
// Dispatch shapes:
//   • Page Domain Actions: POST /api/lens/household/:id/run {action,params}
//       → runMacro("lens","run",{id,action,params}) → handler(ctx, artifact, params)
//   • Panel macros (lensRun): POST /api/lens/run {domain,action,input}
//       → rest = peel(input); handler(ctx, {data:rest}, rest)
// We invoke handlers directly with both shapes.
//
// NOT shape-only: every test feeds KNOWN inputs and asserts EXACT computed values
// (aggregation, pantry subtraction, rotation cycling, overdue-day math, settle-up
// transfers, allowance dollars) + validation-rejection + degrade-graceful +
// fail-CLOSED poison (1e999 / "Infinity" / NaN / bad dates collapse to FINITE
// output or {ok:false}, never NaN/Infinity in output and never a throw).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHouseholdActions from "../domains/household.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "household", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// Drive a PURE calculator EXACTLY like the page's persisted-artifact run route:
// a persisted artifact (single record, no board-wide arrays) + page-derived
// params as the 3rd arg. Handler reads artifact.data.X || params.X.
function callAction(name, ctx, params = {}, artifactData = { name: "Member A" }) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`household.${name} not registered`);
  const artifact = { id: "art_1", domain: "household", type: "record", data: artifactData, meta: {} };
  return fn(ctx, artifact, params);
}

// Drive a STATE / panel macro EXACTLY like lensRun(domain, name, input): the
// dispatch peels a redundant {artifact:{data}} wrapper (no-op on flat input),
// sets virtualArtifact.data = rest AND passes rest as params.
async function callMacro(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`household.${name} not registered`);
  const rest = peelRedundantArtifactWrapper(input);
  const artifact = { id: null, domain: "household", type: "domain_action", data: rest, meta: {} };
  return await fn(ctx, artifact, rest);
}

// Walk every numeric leaf to assert no NaN/Infinity escaped into output.
function assertAllFinite(node, path = "root") {
  if (typeof node === "number") {
    assert.ok(Number.isFinite(node), `non-finite at ${path}: ${node}`);
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`)); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) assertAllFinite(v, `${path}.${k}`);
  }
}

before(() => { registerHouseholdActions(registerLensAction); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const CALCULATORS = [
  "generateGroceryList", "choreRotation", "rotateChores",
  "maintenanceCheck", "maintenanceDue", "weeklySummary",
];
const STATE_MACROS = [
  "room-create", "room-list", "room-delete",
  "task-create", "task-list", "task-update", "task-delete", "task-done",
  "chore-board", "assignee-leaderboard", "vacation-toggle", "household-dashboard",
  "calendar-event-create", "calendar-event-list", "calendar-event-update",
  "calendar-event-delete", "calendar-upcoming-reminders",
  "meal-plan-set", "meal-plan-list", "meal-plan-delete", "meal-grocery-list",
  "allowance-summary",
  "notification-create", "notification-list", "notification-mark-read",
  "shopping-list-create", "shopping-list-list", "shopping-list-delete",
  "shopping-item-add", "shopping-item-toggle", "shopping-item-remove",
  "task-template-create", "task-template-list", "task-template-delete", "task-template-spawn",
  "expense-add", "expense-list", "expense-settle", "expense-delete", "expense-balances",
];

// ─────────────────────────────────────────────────────────────────────────────
describe("household — registration", () => {
  it("registers every calculator + STATE macro the lens reaches", () => {
    for (const m of CALCULATORS) assert.ok(ACTIONS.has(m), `household.${m} not registered`);
    for (const m of STATE_MACROS) assert.ok(ACTIONS.has(m), `household.${m} not registered`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("generateGroceryList — exact aggregation + pantry subtraction", () => {
  // Page derives mealPlan from mealItems; we assert the exact deduped totals.
  const mealPlan = [
    { day: "Mon", meal: "dinner", recipe: "Pasta", ingredients: [{ name: "Tomato", quantity: 3, unit: "ea" }, { name: "Pasta", quantity: 1, unit: "box" }] },
    { day: "Tue", meal: "dinner", recipe: "Salad", ingredients: [{ name: "Tomato", quantity: 2, unit: "ea" }] },
  ];

  it("aggregates duplicate ingredients across meals (Tomato 3+2=5)", () => {
    const r = callAction("generateGroceryList", ctxA, { mealPlan });
    assert.equal(r.ok, true);
    const tomato = r.result.list.find((i) => i.name === "Tomato");
    assert.equal(tomato.quantity, 5);
    assert.deepEqual(tomato.usedIn.sort(), ["Mon dinner", "Tue dinner"]);
    assert.equal(r.result.uniqueItems, 2);
    assert.equal(r.result.mealsPlanned, 2);
  });

  it("subtracts pantry quantities and drops fully-covered items", () => {
    const r = callAction("generateGroceryList", ctxA, {
      mealPlan, pantry: [{ name: "Pasta", quantity: 1, unit: "box" }, { name: "Tomato", quantity: 2, unit: "ea" }],
    });
    // Pasta fully covered (1 needed - 1 on hand = 0) → dropped.
    assert.equal(r.result.list.find((i) => i.name === "Pasta"), undefined);
    const tomato = r.result.list.find((i) => i.name === "Tomato");
    assert.equal(tomato.quantity, 3); // 5 - 2
    assert.equal(tomato.hadOnHand, 2);
  });

  it("HouseholdActionPanel shape: bare-string meals with no ingredients → empty list, ok:true", () => {
    // Panel parses 'Recipe: a, b' into ingredients; a bare recipe name yields none.
    const r = callAction("generateGroceryList", ctxA, { mealPlan: [{ recipe: "Tacos", ingredients: [] }] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.list, []);
    assert.equal(r.result.mealsPlanned, 1);
  });

  it("FAIL-CLOSED: poisoned quantities (1e999 / 'Infinity' / NaN) never leak Infinity/NaN", () => {
    const r = callAction("generateGroceryList", ctxA, {
      mealPlan: [{ recipe: "X", ingredients: [
        { name: "A", quantity: 1e999, unit: "" },
        { name: "B", quantity: "Infinity", unit: "" },
        { name: "C", quantity: NaN, unit: "" },
      ] }],
    });
    assert.equal(r.ok, true);
    assertAllFinite(r.result);
    // poisoned quantities collapse to 0 → needed <= 0 → dropped, list empty.
    assert.deepEqual(r.result.list, []);
  });

  it("degrade-graceful: no mealPlan at all → empty list, ok:true", () => {
    const r = callAction("generateGroceryList", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.uniqueItems, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("choreRotation — round-robin cycling + exact assignee shift", () => {
  it("shifts each chore to the next member (ChoreRotation flat shape)", () => {
    const r = callAction("choreRotation", ctxA, {
      chores: [{ name: "Dishes", currentAssignee: "Alex" }, { name: "Trash", currentAssignee: "Sam" }],
      members: ["Alex", "Sam", "Jordan"],
      strategy: "round-robin",
    });
    assert.equal(r.ok, true);
    const dishes = r.result.assignments.find((a) => a.chore === "Dishes");
    assert.equal(dishes.assignee, "Sam");      // Alex (idx 0) → idx 1 = Sam
    assert.equal(dishes.previousAssignee, "Alex");
    const trash = r.result.assignments.find((a) => a.chore === "Trash");
    assert.equal(trash.assignee, "Jordan");    // Sam (idx 1) → idx 2 = Jordan
    assert.equal(r.result.totalChores, 2);
    assert.equal(r.result.members, 3);
  });

  it("HouseholdActionPanel shape: bare-string chores + members → still assigns", () => {
    const r = callAction("choreRotation", ctxA, {
      chores: [{ name: "Dishes" }, { name: "Trash" }],
      members: ["Alex", "Sam"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.assignments.length, 2);
    // never-assigned chores fill toward least-loaded member, deterministically.
    assert.equal(r.result.choresPerMember.Alex, 1);
    assert.equal(r.result.choresPerMember.Sam, 1);
  });

  it("ChoreRotation peel: a 2-key {artifact:{data},strategy} body is NOT peeled (regression for the dead surface)", async () => {
    // This is what the BROKEN component sent — assert the handler returns the
    // explicit error rather than silently empty, proving the flat-shape fix matters.
    const r = await callMacro("choreRotation", ctxA, {
      artifact: { data: { chores: [{ name: "Dishes" }], members: ["Alex"] } },
      strategy: "round-robin",
    });
    assert.equal(r.ok, true);
    // double-wrapped → both chores AND members land undefined → handler returns
    // a guidance error (members check fires first), NOT a real rotation. Either
    // guidance string proves the dead surface; the FIXED flat body below works.
    assert.ok(
      r.result.error === "No chores defined." || r.result.error === "No household members defined.",
      `expected a guidance error, got ${JSON.stringify(r.result)}`,
    );
    assert.equal(r.result.assignments, undefined);
  });

  it("ChoreRotation peel: the FIXED flat body reaches the handler", async () => {
    const r = await callMacro("choreRotation", ctxA, {
      chores: [{ name: "Dishes", currentAssignee: "Alex" }], members: ["Alex", "Sam"], strategy: "round-robin",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.assignments[0].assignee, "Sam");
  });

  it("validation-rejection: no members → guidance, no throw", () => {
    const r = callAction("choreRotation", ctxA, { chores: [{ name: "Dishes" }], members: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.error, "No household members defined.");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("rotateChores — legacy round-robin (HouseholdActionPanel param fallback)", () => {
  it("cycles via params (no artifact.data) and returns assignments", () => {
    const r = callAction("rotateChores", ctxA, {
      chores: [{ name: "Mop", currentAssignee: "Sam" }], members: ["Alex", "Sam", "Jordan"],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.assignments[0].newAssignee, "Jordan"); // Sam idx1 → idx2
    assert.equal(r.result.assignments[0].previousAssignee, "Sam");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("maintenanceCheck / maintenanceDue — exact overdue-day math + fail-closed dates", () => {
  const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().split("T")[0];

  it("maintenanceCheck flags overdue with exact daysOverdue", () => {
    // last done 40 days ago, interval 30 → ~10 days overdue.
    const r = callAction("maintenanceCheck", ctxA, {
      maintenanceItems: [{ name: "HVAC filter", lastCompleted: daysAgo(40), intervalDays: 30 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.overdueCount, 1);
    const it = r.result.overdue[0];
    assert.equal(it.status, "overdue");
    assert.ok(it.daysOverdue >= 9 && it.daysOverdue <= 11, `daysOverdue ${it.daysOverdue}`);
  });

  it("maintenanceCheck: never-completed item is overdue with null daysOverdue", () => {
    const r = callAction("maintenanceCheck", ctxA, { maintenanceItems: [{ name: "Gutters" }] });
    assert.equal(r.result.overdueCount, 1);
    assert.equal(r.result.overdue[0].status, "never-completed");
    assert.equal(r.result.overdue[0].daysOverdue, null);
  });

  it("maintenanceDue: upcoming within lookahead window, exact daysUntilDue", () => {
    const r = callAction("maintenanceDue", ctxA, {
      maintenanceItems: [{ name: "Smoke detector", lastServiceDate: daysAgo(355), intervalDays: 365 }],
      lookaheadDays: 30,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.upcomingCount, 1);
    assert.ok(r.result.upcoming[0].daysUntilDue >= 9 && r.result.upcoming[0].daysUntilDue <= 11);
  });

  it("FAIL-CLOSED: garbage dates + non-finite intervalDays never produce NaN", () => {
    const r1 = callAction("maintenanceCheck", ctxA, {
      maintenanceItems: [{ name: "X", lastCompleted: "not-a-date", intervalDays: "Infinity" }],
    });
    assert.equal(r1.ok, true);
    assertAllFinite(r1.result);
    // bad date → never-completed → overdue, no NaN daysOverdue.
    assert.equal(r1.result.overdue[0].status, "never-completed");

    const r2 = callAction("maintenanceDue", ctxA, {
      maintenanceItems: [{ name: "Y", lastServiceDate: daysAgo(10), intervalDays: 1e999 }],
      lookaheadDays: NaN,
    });
    assert.equal(r2.ok, true);
    assertAllFinite(r2.result);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("weeklySummary — exact completion rate + fail-closed", () => {
  it("computes choresCompleted / completionRate from this-week completedDate", () => {
    const today = new Date().toISOString().split("T")[0];
    const r = callAction("weeklySummary", ctxA, {
      chores: [
        { name: "A", completedDate: today },
        { name: "B" },
        { name: "C", completedDate: today },
        { name: "D" },
      ],
      mealPlan: [{ recipe: "X" }, { recipe: "Y" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.choresCompleted, 2);
    assert.equal(r.result.totalChores, 4);
    assert.equal(r.result.choreCompletionRate, 50);
    assert.equal(r.result.mealsPlanned, 2);
  });

  it("degrade-graceful: empty everything → 0 rate, no divide-by-zero NaN", () => {
    const r = callAction("weeklySummary", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.choreCompletionRate, 0);
    assertAllFinite(r.result);
  });

  it("FAIL-CLOSED: poisoned completedDate / intervalDays never crash or leak NaN", () => {
    const r = callAction("weeklySummary", ctxA, {
      chores: [{ name: "A", completedDate: "garbage" }],
      maintenanceItems: [{ name: "M", lastCompleted: "bad", intervalDays: "NaN" }],
    });
    assert.equal(r.ok, true);
    assertAllFinite(r.result);
    assert.equal(r.result.choresCompleted, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ChoreBoard substrate — rooms/tasks/condition/leaderboard/vacation round-trip", () => {
  it("creates a room + task and surfaces it on the prioritised board", async () => {
    const rc = await callMacro("room-create", ctxA, { name: "Kitchen" });
    assert.equal(rc.ok, true);
    const roomId = rc.result.room.id;
    const tc = await callMacro("task-create", ctxA, { roomId, name: "Dishes", intervalDays: 1, effort: "light" });
    assert.equal(tc.ok, true);
    const board = await callMacro("chore-board", ctxA, {});
    assert.equal(board.result.board.length, 1);
    assert.equal(board.result.board[0].name, "Dishes");
    assert.equal(board.result.board[0].room, "Kitchen");
  });

  it("task-done awards effort points to the leaderboard (heavy=20)", async () => {
    const rc = await callMacro("room-create", ctxA, { name: "Garage" });
    const tc = await callMacro("task-create", ctxA, { roomId: rc.result.room.id, name: "Sweep", effort: "heavy", assignee: "Sam" });
    const done = await callMacro("task-done", ctxA, { id: tc.result.task.id });
    assert.equal(done.result.pointsAwarded, 20);
    assert.equal(done.result.by, "Sam");
    const lb = await callMacro("assignee-leaderboard", ctxA, {});
    assert.equal(lb.result.leaderboard[0].person, "Sam");
    assert.equal(lb.result.leaderboard[0].points, 20);
  });

  it("FAIL-CLOSED: poisoned intervalDays is clamped to [1,365], never NaN/Infinity", async () => {
    const rc = await callMacro("room-create", ctxA, { name: "R" });
    const tc = await callMacro("task-create", ctxA, { roomId: rc.result.room.id, name: "T", intervalDays: 1e999 });
    assert.equal(tc.result.task.intervalDays, 365);
    assertAllFinite(tc.result);
  });

  it("vacation-toggle freezes condition (dashboard cleanliness stable)", async () => {
    const rc = await callMacro("room-create", ctxA, { name: "Bath" });
    await callMacro("task-create", ctxA, { roomId: rc.result.room.id, name: "Scrub", intervalDays: 7 });
    const on = await callMacro("vacation-toggle", ctxA, { on: true });
    assert.equal(on.result.paused, true);
    const dash = await callMacro("household-dashboard", ctxA, {});
    assert.equal(dash.result.paused, true);
    assertAllFinite(dash.result);
  });

  it("per-user isolation: user B sees none of user A's rooms", async () => {
    await callMacro("room-create", ctxA, { name: "PrivateRoom" });
    const bList = await callMacro("room-list", ctxB, {});
    assert.equal(bList.result.rooms.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("FamilyCalendar substrate — event CRUD + reminder clamp", () => {
  it("create / list / update / delete round-trip", async () => {
    const c = await callMacro("calendar-event-create", ctxA, { title: "Dentist", date: "2030-01-15", time: "09:00" });
    assert.equal(c.ok, true);
    const id = c.result.event.id;
    const list = await callMacro("calendar-event-list", ctxA, {});
    assert.equal(list.result.count, 1);
    const upd = await callMacro("calendar-event-update", ctxA, { id, title: "Dentist (moved)" });
    assert.equal(upd.result.event.title, "Dentist (moved)");
    const del = await callMacro("calendar-event-delete", ctxA, { id });
    assert.equal(del.result.deleted, id);
  });

  it("validation-rejection: missing title and date", async () => {
    assert.equal((await callMacro("calendar-event-create", ctxA, { date: "2030-01-01" })).error, "event title required");
    assert.equal((await callMacro("calendar-event-create", ctxA, { title: "X" })).error, "event date required");
  });

  it("FAIL-CLOSED: poisoned reminderMinutes is clamped, never NaN", async () => {
    const c = await callMacro("calendar-event-create", ctxA, { title: "X", date: "2030-01-01", reminderMinutes: 1e999 });
    assert.equal(c.result.event.reminderMinutes, 20160);
    assertAllFinite(c.result);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("MealPlanner substrate — meal-plan-set upsert + grocery aggregation", () => {
  it("upserts a meal (same date+slot replaces) and aggregates the grocery list", async () => {
    await callMacro("meal-plan-set", ctxA, { date: "2030-02-01", slot: "dinner", recipe: "Stew", ingredients: ["beef", "carrot"] });
    await callMacro("meal-plan-set", ctxA, { date: "2030-02-02", slot: "dinner", recipe: "Stir-fry", ingredients: ["carrot", "rice"] });
    const list = await callMacro("meal-plan-list", ctxA, { from: "2030-02-01", to: "2030-02-07" });
    assert.equal(list.result.count, 2);
    const grocery = await callMacro("meal-grocery-list", ctxA, { from: "2030-02-01", to: "2030-02-07" });
    const carrot = grocery.result.list.find((g) => g.name === "carrot");
    assert.equal(carrot.count, 2); // appears in both meals
    assert.equal(grocery.result.uniqueItems, 3);
  });

  it("validation-rejection: bad slot", async () => {
    assert.equal((await callMacro("meal-plan-set", ctxA, { date: "2030-01-01", slot: "brunch", recipe: "X" })).error,
      "slot must be breakfast/lunch/dinner/snack");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("allowance-summary — exact dollars from chore log + fail-closed rate", () => {
  it("computes per-person allowance = points × rate", async () => {
    const rc = await callMacro("room-create", ctxA, { name: "R" });
    const tc = await callMacro("task-create", ctxA, { roomId: rc.result.room.id, name: "T", effort: "medium", assignee: "Kim" });
    await callMacro("task-done", ctxA, { id: tc.result.task.id }); // medium = 10 pts
    const s = await callMacro("allowance-summary", ctxA, { dollarsPerPoint: 0.10 });
    assert.equal(s.result.members[0].person, "Kim");
    assert.equal(s.result.members[0].points, 10);
    assert.equal(s.result.members[0].allowance, 1.0); // 10 × 0.10
    assert.equal(s.result.totalAllowance, 1.0);
  });

  it("FAIL-CLOSED: NaN/Infinity dollarsPerPoint clamps to a finite rate, no NaN allowance", async () => {
    const rc = await callMacro("room-create", ctxA, { name: "R" });
    const tc = await callMacro("task-create", ctxA, { roomId: rc.result.room.id, name: "T", assignee: "Lee" });
    await callMacro("task-done", ctxA, { id: tc.result.task.id });
    // Poison (NaN / Infinity) collapses to the safe default rate (0.05) via
    // finiteNum — never NaN, never Infinity in the allowance output.
    const sNaN = await callMacro("allowance-summary", ctxA, { dollarsPerPoint: NaN });
    assertAllFinite(sNaN.result);
    assert.equal(sNaN.result.dollarsPerPoint, 0.05);
    const sInf = await callMacro("allowance-summary", ctxA, { dollarsPerPoint: 1e999 });
    assert.equal(sInf.result.dollarsPerPoint, 0.05); // Infinity → fallback, not clamped-to-max
    assertAllFinite(sInf.result);
    // A genuinely-large FINITE rate is still clamped to the 10 ceiling.
    const sBig = await callMacro("allowance-summary", ctxA, { dollarsPerPoint: 999 });
    assert.equal(sBig.result.dollarsPerPoint, 10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("MemberNotifications + SharedShoppingLists substrate", () => {
  it("notification create / unread count / mark-all-read", async () => {
    await callMacro("notification-create", ctxA, { recipient: "Sam", message: "Take out trash", kind: "task" });
    await callMacro("notification-create", ctxA, { recipient: "Sam", message: "Pay rent", kind: "bill" });
    const list = await callMacro("notification-list", ctxA, {});
    assert.equal(list.result.count, 2);
    assert.equal(list.result.unread, 2);
    const marked = await callMacro("notification-mark-read", ctxA, { all: true });
    assert.equal(marked.result.markedRead, 2);
    assert.equal((await callMacro("notification-list", ctxA, {})).result.unread, 0);
  });

  it("shopping list create → item add → toggle → checkedCount tracks", async () => {
    const lc = await callMacro("shopping-list-create", ctxA, { name: "Groceries" });
    const listId = lc.result.list.id;
    const ia = await callMacro("shopping-item-add", ctxA, { listId, name: "Milk", quantity: "1gal" });
    const itemId = ia.result.item.id;
    await callMacro("shopping-item-toggle", ctxA, { listId, itemId, checked: true });
    const lists = await callMacro("shopping-list-list", ctxA, {});
    assert.equal(lists.result.lists[0].itemCount, 1);
    assert.equal(lists.result.lists[0].checkedCount, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("RecurringTemplates substrate — spawn materialises a chore", () => {
  it("template-spawn creates a real chore task on the board (room auto-created)", async () => {
    const tc = await callMacro("task-template-create", ctxA, { name: "Mop floors", frequency: "weekly", room: "Hall", effort: "medium" });
    const spawn = await callMacro("task-template-spawn", ctxA, { id: tc.result.template.id });
    assert.equal(spawn.ok, true);
    assert.equal(spawn.result.task.name, "Mop floors");
    assert.equal(spawn.result.task.intervalDays, 7); // weekly
    assert.equal(spawn.result.room.name, "Hall");
    const board = await callMacro("chore-board", ctxA, {});
    assert.ok(board.result.board.some((t) => t.name === "Mop floors"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("ExpenseSplitter substrate — split + settle-up transfers + fail-closed amount", () => {
  it("expense-add splits evenly and expense-balances computes net + minimal transfers", async () => {
    // Alex pays $30 split among Alex, Sam, Jordan → each owes $10; Alex net +$20.
    await callMacro("expense-add", ctxA, { description: "Dinner", amount: 30, paidBy: "Alex", splitAmong: ["Alex", "Sam", "Jordan"] });
    const bal = await callMacro("expense-balances", ctxA, {});
    const alex = bal.result.balances.find((b) => b.person === "Alex");
    assert.equal(alex.net, 20);
    const sam = bal.result.balances.find((b) => b.person === "Sam");
    assert.equal(sam.net, -10);
    // settle-up: Sam and Jordan each pay Alex $10.
    const toAlex = bal.result.transfers.filter((t) => t.to === "Alex");
    assert.equal(toAlex.length, 2);
    assert.equal(toAlex.reduce((s, t) => s + t.amount, 0), 20);
    assertAllFinite(bal.result);
  });

  it("validation-rejection: amount must be > 0 and splitAmong non-empty", async () => {
    assert.equal((await callMacro("expense-add", ctxA, { description: "X", amount: 0, paidBy: "A", splitAmong: ["A"] })).error,
      "amount must be a finite number > 0");
    assert.equal((await callMacro("expense-add", ctxA, { description: "X", amount: 5, paidBy: "A", splitAmong: [] })).error,
      "splitAmong must list at least one member");
  });

  it("FAIL-CLOSED: amount=1e999 / 'Infinity' is rejected, never stored as Infinity", async () => {
    const r1 = await callMacro("expense-add", ctxA, { description: "X", amount: 1e999, paidBy: "A", splitAmong: ["A"] });
    assert.equal(r1.ok, false);
    const r2 = await callMacro("expense-add", ctxA, { description: "X", amount: "Infinity", paidBy: "A", splitAmong: ["A"] });
    assert.equal(r2.ok, false);
    // ledger stays clean → balances all finite.
    const bal = await callMacro("expense-balances", ctxA, {});
    assertAllFinite(bal.result);
  });

  it("settle flips a flag and removes the expense from the balances pool", async () => {
    const a = await callMacro("expense-add", ctxA, { description: "Cab", amount: 12, paidBy: "Sam", splitAmong: ["Sam", "Alex"] });
    const id = a.result.expense.id;
    await callMacro("expense-settle", ctxA, { id, settled: true });
    const bal = await callMacro("expense-balances", ctxA, {});
    assert.equal(bal.result.unsettledExpenses, 0);
  });
});
