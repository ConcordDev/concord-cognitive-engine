// CB-0513 Part A — lifecycle exits second leg: the delete/clear/edit
// exits the audit found missing, exercised against the real handlers.
//
//   FIX-debug-013 — trace-delete removes a captured trace.
//   FIX-debug-014 — metric-clear clears one metric's samples in a
//     project and leaves other metrics (and other projects) intact.
//   FIX-hr-003 — employee-delete permanently removes a TERMINATED
//     employee (with their onboarding tasks / reviews / goals) and
//     refuses an active one in words.
//   FIX-society-006 — wb-delete-chart removes the owner's chart;
//     another user cannot delete it; the permalink then 404s.
//   FIX-legacy-008 — deleteCodebase cascades the codebase's debt
//     snapshots; manual (codebaseId-less) snapshots survive.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerDebugActions from "../domains/debug.js";
import registerHrActions from "../domains/hr.js";
import registerSocietyActions from "../domains/society.js";
import registerLegacyActions from "../domains/legacy.js";

const actions = new Map();
const reg = (domain, name, fn) => actions.set(`${domain}.${name}`, fn);
registerDebugActions(reg);
registerHrActions(reg);
registerSocietyActions(reg);
registerLegacyActions(reg);

const call = (name, input = {}, userId = "qa-user") =>
  actions.get(name)(
    { actor: { userId } },
    { id: null, domain: name.split(".")[0], type: "domain_action", data: input, meta: {} },
    input,
  );

beforeEach(() => {
  globalThis._concordSTATE = {};
});

const SPAN = { spanId: "s1", name: "GET /x", service: "web", startMs: 0, endMs: 5, status: "ok" };

test("debug: a captured trace can be deleted (FIX-debug-013)", async () => {
  const rec = await call("debug.trace-record", { name: "t", spans: [SPAN] });
  assert.equal(rec.ok, true);
  const id = rec.result.trace.id;
  const del = await call("debug.trace-delete", { id });
  assert.equal(del.ok, true);
  const detail = await call("debug.trace-detail", { id });
  assert.equal(detail.ok, false);
  const again = await call("debug.trace-delete", { id });
  assert.equal(again.ok, false);
  assert.match(again.error, /not found/);
});

test("debug: metric-clear clears only the named metric in the named project (FIX-debug-014)", async () => {
  await call("debug.metric-record", { metric: "cpu", value: 10 });
  await call("debug.metric-record", { metric: "cpu", value: 20 });
  await call("debug.metric-record", { metric: "mem", value: 70 });
  const cleared = await call("debug.metric-clear", { metric: "cpu" });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.result.cleared, 2);
  const cpu = await call("debug.metric-series", { metric: "cpu" });
  assert.equal(cpu.result.points.length, 0);
  const mem = await call("debug.metric-series", { metric: "mem" });
  assert.equal(mem.result.points.length, 1);
  const noMetric = await call("debug.metric-clear", {});
  assert.equal(noMetric.ok, false);
});

test("hr: permanent delete refuses an active employee, removes a terminated one with their rows (FIX-hr-003)", async () => {
  const add = await call("hr.employee-add", { name: "Pat Example", email: "pat@example.com" });
  assert.equal(add.ok, true);
  const id = add.result.employee.id;
  const taskAdd = await call("hr.onboarding-task-add", { employeeId: id, task: "Sign forms" });
  assert.equal(taskAdd.ok, true);

  const early = await call("hr.employee-delete", { id });
  assert.equal(early.ok, false);
  assert.match(early.error, /offboard/);

  await call("hr.employee-offboard", { id });
  const del = await call("hr.employee-delete", { id });
  assert.equal(del.ok, true);
  assert.equal(del.result.removed.onboardingTasks, 1);
  const detail = await call("hr.employee-detail", { id });
  assert.equal(detail.ok, false);
  const tasks = await call("hr.onboarding-list", { employeeId: id });
  assert.equal((tasks.result?.tasks || tasks.result?.onboarding || []).length, 0);
});

test("society: only the owner can delete a saved chart, and the permalink dies with it (FIX-society-006)", async () => {
  const saved = await call("society.wb-save-chart", { title: "GDP", spec: { kind: "line" } }, "owner-a");
  assert.equal(saved.ok, true);
  const id = saved.result.id;
  const stranger = await call("society.wb-delete-chart", { id }, "someone-else");
  assert.equal(stranger.ok, false);
  const stillThere = await call("society.wb-load-chart", { id }, "someone-else");
  assert.equal(stillThere.ok, true);
  const del = await call("society.wb-delete-chart", { id }, "owner-a");
  assert.equal(del.ok, true);
  const gone = await call("society.wb-load-chart", { id }, "owner-a");
  assert.equal(gone.ok, false);
  const list = await call("society.wb-list-charts", {}, "owner-a");
  assert.equal(list.result.count, 0);
});

test("legacy: deleting a codebase cascades its debt snapshots only (FIX-legacy-008)", async () => {
  const scan = await call("legacy.scanCodebase", {
    name: "old-app",
    files: [{ path: "a.js", content: "var x = 1;" }],
  });
  assert.equal(scan.ok, true);
  const cbId = scan.result.codebase.id;
  await call("legacy.recordDebtSnapshot", { codebaseId: cbId, totalDebt: 42 });
  await call("legacy.recordDebtSnapshot", { label: "manual", totalDebt: 7 });
  const del = await call("legacy.deleteCodebase", { id: cbId });
  assert.equal(del.ok, true);
  assert.equal(del.result.snapshotsRemoved, 1);
  const trend = await call("legacy.debtTrend", {});
  const snaps = trend.result?.snapshots || trend.result?.points || [];
  assert.equal(snaps.filter((s) => s.codebaseId === cbId).length, 0);
  assert.equal(snaps.length, 1); // the manual snapshot survives
});
