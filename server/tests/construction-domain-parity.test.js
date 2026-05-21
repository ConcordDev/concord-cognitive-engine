// Tier-2 contract tests for construction lens parity macros
// (RFI / submittals / daily log / punch list / change orders / drawings /
// budget / Gantt). Pins per-user scoping, workflow transitions, and the
// committed-cost forecast math.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerConstructionActions from "../domains/construction.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`construction.${name}`);
  if (!fn) throw new Error(`construction.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => {
  registerConstructionActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("construction — RFI workflow", () => {
  it("submits, answers and closes an RFI with ball-in-court tracking", () => {
    const sub = call("rfi-submit", ctxA, { subject: "Beam clash", question: "Conflict at grid C4" });
    assert.equal(sub.ok, true);
    assert.equal(sub.result.rfi.number, "RFI-001");
    assert.equal(sub.result.rfi.ballInCourt, "Architect");

    const resp = call("rfi-respond", ctxA, { id: sub.result.rfi.id, response: "Lower beam 6in" });
    assert.equal(resp.ok, true);
    assert.equal(resp.result.rfi.status, "answered");
    assert.equal(resp.result.rfi.ballInCourt, "GC");

    const closed = call("rfi-close", ctxA, { id: sub.result.rfi.id });
    assert.equal(closed.ok, true);
    assert.equal(closed.result.rfi.status, "closed");
  });

  it("rejects an RFI with no subject", () => {
    assert.equal(call("rfi-submit", ctxA, {}).ok, false);
  });

  it("scopes RFIs per user", () => {
    call("rfi-submit", ctxA, { subject: "A's RFI" });
    const listB = call("rfi-list", ctxB, {});
    assert.equal(listB.ok, true);
    assert.equal(listB.result.total, 0);
  });

  it("deletes an RFI", () => {
    const sub = call("rfi-submit", ctxA, { subject: "X" });
    const del = call("rfi-delete", ctxA, { id: sub.result.rfi.id });
    assert.equal(del.ok, true);
    assert.equal(call("rfi-list", ctxA, {}).result.total, 0);
  });
});

describe("construction — submittals log", () => {
  it("creates and runs a revise review cycle", () => {
    const c = call("submittal-create", ctxA, { title: "Steel shop drawings", specSection: "05 12 00" });
    assert.equal(c.ok, true);
    assert.equal(c.result.submittal.number, "SUB-001");

    const rev = call("submittal-review", ctxA, { id: c.result.submittal.id, action: "revise_resubmit", comments: "Add bolts" });
    assert.equal(rev.ok, true);
    assert.equal(rev.result.submittal.status, "revise");
    assert.equal(rev.result.submittal.revision, 1);
    assert.equal(rev.result.submittal.reviewCycles.length, 1);

    const ok = call("submittal-review", ctxA, { id: c.result.submittal.id, action: "approved" });
    assert.equal(ok.result.submittal.status, "closed");
  });

  it("rejects missing spec section and invalid review action", () => {
    assert.equal(call("submittal-create", ctxA, { title: "X" }).ok, false);
    const c = call("submittal-create", ctxA, { title: "Y", specSection: "09 00 00" });
    assert.equal(call("submittal-review", ctxA, { id: c.result.submittal.id, action: "bogus" }).ok, false);
  });

  it("deletes a submittal", () => {
    const c = call("submittal-create", ctxA, { title: "Z", specSection: "03 00 00" });
    assert.equal(call("submittal-delete", ctxA, { id: c.result.submittal.id }).ok, true);
  });
});

describe("construction — daily log", () => {
  it("creates a log and computes total man-hours", () => {
    const r = call("dailylog-create", ctxA, {
      date: "2026-05-20", weather: "Rain",
      manpower: [{ trade: "Framing", workers: 4, hours: 8 }, { trade: "Electrical", workers: 2, hours: 6 }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.log.totalManHours, 44);
    const list = call("dailylog-list", ctxA, {});
    assert.equal(list.result.totalManHours, 44);
  });

  it("rejects a log with no date and deletes a log", () => {
    assert.equal(call("dailylog-create", ctxA, {}).ok, false);
    const r = call("dailylog-create", ctxA, { date: "2026-05-21" });
    assert.equal(call("dailylog-delete", ctxA, { id: r.result.log.id }).ok, true);
  });
});

describe("construction — punch list", () => {
  it("adds, updates status to closed and reports completion", () => {
    const a = call("punch-add", ctxA, { description: "Touch up paint", location: "Lobby" });
    assert.equal(a.ok, true);
    const b = call("punch-add", ctxA, { description: "Fix trim" });
    assert.equal(b.ok, true);

    const upd = call("punch-update", ctxA, { id: a.result.item.id, status: "closed" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.item.status, "closed");
    assert.ok(upd.result.item.closedAt);

    const list = call("punch-list", ctxA, {});
    assert.equal(list.result.total, 2);
    assert.equal(list.result.closed, 1);
    assert.equal(list.result.completionPct, 50);
  });

  it("rejects empty description and deletes a punch item", () => {
    assert.equal(call("punch-add", ctxA, {}).ok, false);
    const a = call("punch-add", ctxA, { description: "Q" });
    assert.equal(call("punch-delete", ctxA, { id: a.result.item.id }).ok, true);
  });
});

describe("construction — change orders", () => {
  it("creates, approves and syncs the revised contract delta", () => {
    const c1 = call("changeorder-create", ctxA, { jobId: "job1", title: "Add window", amount: 5000 });
    assert.equal(c1.ok, true);
    const c2 = call("changeorder-create", ctxA, { jobId: "job1", title: "Upgrade HVAC", amount: 12000 });
    assert.equal(c2.ok, true);

    call("changeorder-decide", ctxA, { id: c1.result.changeOrder.id, decision: "approved" });
    const d2 = call("changeorder-decide", ctxA, { id: c2.result.changeOrder.id, decision: "approved" });
    assert.equal(d2.ok, true);
    assert.equal(d2.result.revisedContractDelta, 17000);

    const list = call("changeorder-list", ctxA, { jobId: "job1" });
    assert.equal(list.result.approvedValue, 17000);
    assert.equal(list.result.approvedCount, 2);
  });

  it("rejects non-numeric amount and invalid decision", () => {
    assert.equal(call("changeorder-create", ctxA, { title: "X", amount: "abc" }).ok, false);
    const c = call("changeorder-create", ctxA, { title: "Y", amount: 100 });
    assert.equal(call("changeorder-decide", ctxA, { id: c.result.changeOrder.id, decision: "maybe" }).ok, false);
    assert.equal(call("changeorder-delete", ctxA, { id: c.result.changeOrder.id }).ok, true);
  });
});

describe("construction — drawings", () => {
  it("adds, revises, marks up and compares revisions", () => {
    const d = call("drawing-add", ctxA, { sheetNumber: "A-101", title: "Floor Plan" });
    assert.equal(d.ok, true);
    assert.equal(d.result.drawing.currentRevision, "A");

    const rev = call("drawing-revise", ctxA, { id: d.result.drawing.id, notes: "Door relocated" });
    assert.equal(rev.result.drawing.currentRevision, "B");

    const mk = call("drawing-markup", ctxA, { id: d.result.drawing.id, note: "Check dimension", x: 100, y: 200 });
    assert.equal(mk.ok, true);
    assert.equal(mk.result.markup.revision, "B");

    const cmp = call("drawing-compare", ctxA, { id: d.result.drawing.id, revA: "A", revB: "B" });
    assert.equal(cmp.ok, true);
    assert.equal(cmp.result.revA.revision, "A");
    assert.equal(cmp.result.markupsOnB.length, 1);
  });

  it("rejects missing fields and deletes a drawing", () => {
    assert.equal(call("drawing-add", ctxA, { sheetNumber: "A-1" }).ok, false);
    const d = call("drawing-add", ctxA, { sheetNumber: "S-1", title: "Foundation" });
    assert.equal(call("drawing-delete", ctxA, { id: d.result.drawing.id }).ok, true);
  });
});

describe("construction — budget vs actual", () => {
  it("forecasts at completion using max(budget, actual + remaining commitment)", () => {
    call("budget-add", ctxA, { jobId: "j1", costCode: "03-300", description: "Concrete", budgetAmount: 50000, committed: 48000, actual: 30000 });
    call("budget-add", ctxA, { jobId: "j1", costCode: "06-100", description: "Framing", budgetAmount: 40000, committed: 45000, actual: 45000 });
    const list = call("budget-list", ctxA, { jobId: "j1" });
    assert.equal(list.ok, true);
    assert.equal(list.result.totalBudget, 90000);
    // line 1 forecast = max(50000, 30000 + 18000) = 50000; line 2 = max(40000, 45000+0) = 45000
    assert.equal(list.result.forecastAtCompletion, 95000);
    assert.equal(list.result.variance, -5000);
    assert.equal(list.result.status, "over-budget");
  });

  it("updates a budget line and flags over-budget", () => {
    const a = call("budget-add", ctxA, { costCode: "09-900", description: "Paint", budgetAmount: 10000 });
    const upd = call("budget-update", ctxA, { id: a.result.line.id, actual: 12000 });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.overBudget, true);
    assert.equal(call("budget-delete", ctxA, { id: a.result.line.id }).ok, true);
  });

  it("rejects missing cost code", () => {
    assert.equal(call("budget-add", ctxA, { description: "X", budgetAmount: 1 }).ok, false);
  });
});

describe("construction — Gantt schedule", () => {
  it("draws CPM result as dated schedule bars", () => {
    const artifact = {
      id: null, meta: {},
      data: {
        tasks: [
          { name: "Excavate", duration: 5, dependencies: [] },
          { name: "Foundation", duration: 10, dependencies: ["Excavate"] },
          { name: "Framing", duration: 15, dependencies: ["Foundation"] },
        ],
      },
    };
    const r = call("ganttSchedule", ctxA, artifact, { startDate: "2026-06-01" });
    assert.equal(r.ok, true);
    assert.equal(r.result.bars.length, 3);
    assert.equal(r.result.projectDuration, 30);
    assert.equal(r.result.bars[0].startDate, "2026-06-01");
    assert.ok(r.result.bars.every((b) => b.onCriticalPath));
  });

  it("returns a guidance message when no tasks supplied", () => {
    const r = call("ganttSchedule", ctxA, { id: null, data: {}, meta: {} }, {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.bars, []);
  });
});
