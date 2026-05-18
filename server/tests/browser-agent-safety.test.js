// server/tests/browser-agent-safety.test.js
//
// Tier-2 contract tests for the Sprint A safety + budget + audit
// surface. Hermetic — uses an in-memory SQLite + the four migration-
// 220 tables.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerBrowserAgentMacros from "../domains/browser-agent.js";
import { isDestructive, requiresApproval, approvalReason } from "../lib/browser-agent/safety.js";
import {
  getBudget, upsertBudget, canSpend, canStartAnother,
  dailySpentCents, monthlySpentCents, concurrentActive, costForAction,
} from "../lib/browser-agent/budget.js";
import {
  createTask, getTask, listTasksForUser, transitionTask,
  recordAction, listActions, listPendingApprovals, decideApproval,
} from "../lib/browser-agent/audit.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/220_browser_agent.js");
  m.up(db);
  registerBrowserAgentMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId = "u_b") { return { db, actor: { userId } }; }

// ─── Safety helpers ─────────────────────────────────────────────

describe("safety: isDestructive", () => {
  it("flags checkout URL navigation", () => {
    assert.equal(isDestructive({ kind: "navigate", url: "https://shop.com/checkout/" }), true);
  });

  it("flags click on 'Buy now' element", () => {
    assert.equal(isDestructive({ kind: "click", element_text: "Buy now" }), true);
  });

  it("flags type containing 'delete account'", () => {
    assert.equal(isDestructive({ kind: "type", value: "Please delete account" }), true);
  });

  it("respects pre-flagged destructive: true", () => {
    assert.equal(isDestructive({ kind: "click", destructive: true }), true);
  });

  it("does NOT flag a benign click", () => {
    assert.equal(isDestructive({ kind: "click", element_text: "More info" }), false);
  });

  it("does NOT flag plain navigation", () => {
    assert.equal(isDestructive({ kind: "navigate", url: "https://wikipedia.org/wiki/Concord" }), false);
  });
});

describe("safety: requiresApproval respects approval_mode", () => {
  it("'off' never gates", () => {
    assert.equal(requiresApproval({ approval_mode: "off" }, { kind: "navigate", url: "https://shop.com/checkout" }), false);
  });
  it("'every_step' always gates", () => {
    assert.equal(requiresApproval({ approval_mode: "every_step" }, { kind: "scroll" }), true);
  });
  it("'destructive_only' gates destructive actions only", () => {
    assert.equal(requiresApproval({ approval_mode: "destructive_only" }, { kind: "click", element_text: "Pay" }), true);
    assert.equal(requiresApproval({ approval_mode: "destructive_only" }, { kind: "click", element_text: "Next" }), false);
  });
});

describe("safety: approvalReason", () => {
  it("classifies checkout as external_purchase", () => {
    const r = approvalReason({ kind: "navigate", url: "https://shop.com/checkout/" });
    assert.equal(r, "external_purchase");
  });
  it("classifies captcha as captcha_detected", () => {
    const r = approvalReason({ kind: "click", element_text: "Solve reCAPTCHA" });
    assert.equal(r, "captcha_detected");
  });
});

// ─── Budget ─────────────────────────────────────────────────────

describe("budget: getBudget + upsert + spend caps", () => {
  it("returns defaults for an unknown user", () => {
    const b = getBudget(db, "u_unknown");
    assert.equal(b.daily_cents_cap, 500);
    assert.equal(b.concurrent_task_max, 3);
  });

  it("upsertBudget patches + getBudget round-trips", () => {
    upsertBudget(db, "u_bgt", { daily_cents_cap: 200, concurrent_task_max: 5 });
    const b = getBudget(db, "u_bgt");
    assert.equal(b.daily_cents_cap, 200);
    assert.equal(b.concurrent_task_max, 5);
  });

  it("canSpend blocks when per-task cap exceeded", () => {
    const t = { user_id: "u_cap", total_cost_cents: 99, max_cost_cents: 100 };
    const r = canSpend(db, t, 5);
    assert.equal(r.ok, false); assert.equal(r.reason, "task_budget_exceeded");
  });

  it("canSpend allows when within cap", () => {
    const t = { user_id: "u_cap2", total_cost_cents: 10, max_cost_cents: 100 };
    const r = canSpend(db, t, 5);
    assert.equal(r.ok, true);
  });

  it("canStartAnother enforces concurrent_task_max", () => {
    upsertBudget(db, "u_conc", { concurrent_task_max: 1 });
    createTask(db, { userId: "u_conc", title: "T1", goal: "g" });
    const r = canStartAnother(db, "u_conc");
    assert.equal(r.ok, false); assert.equal(r.reason, "concurrent_limit");
  });

  it("costForAction sums action + token cents", () => {
    const c = costForAction({ kind: "click", tokens: 5000 });
    assert.ok(c.cents >= 1);
  });
});

// ─── Audit / task state machine ─────────────────────────────────

describe("audit: createTask + transition + listTasksForUser", () => {
  it("createTask returns id and seeds task in pending state", () => {
    const r = createTask(db, { userId: "u_t1", title: "Scrape", goal: "scrape Hacker News" });
    assert.equal(r.ok, true);
    const t = getTask(db, r.id);
    assert.equal(t.status, "pending");
    assert.equal(t.user_id, "u_t1");
    assert.equal(t.total_steps, 0);
  });

  it("createTask is blocked when concurrent cap hit", () => {
    upsertBudget(db, "u_blk", { concurrent_task_max: 0 });
    const r = createTask(db, { userId: "u_blk", title: "X", goal: "y" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "concurrent_limit");
  });

  it("transitionTask updates status", () => {
    const r = createTask(db, { userId: "u_trans", title: "T", goal: "g" });
    transitionTask(db, r.id, "running", { started_at: 12345 });
    const t = getTask(db, r.id);
    assert.equal(t.status, "running");
    assert.equal(t.started_at, 12345);
  });

  it("listTasksForUser scopes by user + supports status filter", () => {
    createTask(db, { userId: "u_list", title: "A", goal: "g" });
    createTask(db, { userId: "u_list", title: "B", goal: "g" });
    createTask(db, { userId: "u_list_other", title: "C", goal: "g" });
    assert.equal(listTasksForUser(db, "u_list").length, 2);
    assert.equal(listTasksForUser(db, "u_list", { status: "pending" }).length, 2);
  });
});

describe("audit: recordAction increments counters + flags approval", () => {
  it("benign action records + increments total_steps and total_cost_cents", () => {
    const t = createTask(db, { userId: "u_a1", title: "T", goal: "g" });
    const r1 = recordAction(db, t.id, { kind: "navigate", url: "https://wikipedia.org" });
    assert.equal(r1.ok, true);
    assert.equal(r1.stepIndex, 0);
    const t2 = getTask(db, t.id);
    assert.equal(t2.total_steps, 1);
    assert.ok(t2.total_cost_cents >= 1);
  });

  it("destructive action under destructive_only mode opens an approval", () => {
    const t = createTask(db, { userId: "u_a2", title: "T", goal: "g", approvalMode: "destructive_only" });
    const r = recordAction(db, t.id, { kind: "navigate", url: "https://shop.com/checkout/" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "approval_required");
    assert.equal(getTask(db, t.id).status, "awaiting_approval");
  });

  it("approval_mode='off' bypasses gate even for destructive actions", () => {
    const t = createTask(db, { userId: "u_off", title: "T", goal: "g", approvalMode: "off" });
    const r = recordAction(db, t.id, { kind: "navigate", url: "https://shop.com/checkout/" });
    assert.equal(r.ok, true);
  });

  it("step cap aborts the task", () => {
    const t = createTask(db, { userId: "u_cap", title: "T", goal: "g", maxSteps: 2 });
    recordAction(db, t.id, { kind: "scroll" });
    recordAction(db, t.id, { kind: "scroll" });
    const r3 = recordAction(db, t.id, { kind: "scroll" });
    assert.equal(r3.ok, false);
    assert.equal(r3.reason, "step_cap_reached");
    assert.equal(getTask(db, t.id).status, "completed");
  });

  it("budget cap aborts with budget_exceeded status", () => {
    const t = createTask(db, { userId: "u_bx", title: "T", goal: "g", maxCostCents: 1 });
    recordAction(db, t.id, { kind: "scroll" });
    const r = recordAction(db, t.id, { kind: "scroll" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "task_budget_exceeded");
    assert.equal(getTask(db, t.id).status, "budget_exceeded");
  });
});

describe("audit: approvals queue", () => {
  it("decideApproval=approved transitions task back to running", () => {
    const t = createTask(db, { userId: "u_dec", title: "T", goal: "g" });
    recordAction(db, t.id, { kind: "navigate", url: "https://shop.com/checkout/" });
    const pending = listPendingApprovals(db, "u_dec");
    assert.equal(pending.length, 1);
    const r = decideApproval(db, pending[0].id, { userId: "u_dec", decision: "approved" });
    assert.equal(r.ok, true);
    assert.equal(getTask(db, t.id).status, "running");
  });

  it("decideApproval=rejected cancels the task", () => {
    const t = createTask(db, { userId: "u_rej", title: "T", goal: "g" });
    recordAction(db, t.id, { kind: "navigate", url: "https://shop.com/checkout/" });
    const pending = listPendingApprovals(db, "u_rej");
    decideApproval(db, pending[0].id, { userId: "u_rej", decision: "rejected", note: "no thanks" });
    assert.equal(getTask(db, t.id).status, "cancelled");
  });

  it("decideApproval forbidden when other user tries", () => {
    const t = createTask(db, { userId: "u_owner", title: "T", goal: "g" });
    recordAction(db, t.id, { kind: "navigate", url: "https://shop.com/checkout/" });
    const pending = listPendingApprovals(db, "u_owner");
    const r = decideApproval(db, pending[0].id, { userId: "u_thief", decision: "approved" });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});

// ─── Macro envelope shapes ──────────────────────────────────────

describe("browser-agent macros", () => {
  it("task_create + task_get round-trip via macros", async () => {
    const r = await MACROS.get("task_create")(ctx("u_m1"), { title: "M", goal: "g" });
    assert.equal(r.ok, true);
    const g = await MACROS.get("task_get")(ctx("u_m1"), { id: r.id });
    assert.equal(g.task.goal, "g");
  });

  it("task_get forbidden across users", async () => {
    const r = await MACROS.get("task_create")(ctx("u_m2"), { title: "M", goal: "g" });
    const g = await MACROS.get("task_get")(ctx("u_other"), { id: r.id });
    assert.equal(g.ok, false); assert.equal(g.reason, "forbidden");
  });

  it("budget_get returns current spend + concurrent count", async () => {
    const r = await MACROS.get("budget_get")(ctx("u_bg"));
    assert.equal(r.ok, true);
    assert.ok(typeof r.dailySpentCents === "number");
    assert.ok(typeof r.monthlySpentCents === "number");
    assert.ok(typeof r.concurrentActive === "number");
  });

  it("action_check_destructive returns boolean", async () => {
    const r = await MACROS.get("action_check_destructive")(ctx(), { action: { kind: "click", element_text: "Pay" } });
    assert.equal(r.destructive, true);
  });

  it("task_cancel transitions to cancelled", async () => {
    const c = await MACROS.get("task_create")(ctx("u_can"), { title: "C", goal: "g" });
    await MACROS.get("task_cancel")(ctx("u_can"), { id: c.id, note: "abort" });
    const g = await MACROS.get("task_get")(ctx("u_can"), { id: c.id });
    assert.equal(g.task.status, "cancelled");
  });

  it("budget_update + budget_get round-trip", async () => {
    await MACROS.get("budget_update")(ctx("u_bu"), { dailyCentsCap: 1000, concurrentTaskMax: 5 });
    const r = await MACROS.get("budget_get")(ctx("u_bu"));
    assert.equal(r.budget.daily_cents_cap, 1000);
    assert.equal(r.budget.concurrent_task_max, 5);
  });
});
