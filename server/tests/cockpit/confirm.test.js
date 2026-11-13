import test from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { driveRun } from "../../lib/cockpit/engine.js";
import { needsConfirm, buildConfirmCard, applyDecision, confirmPolicy, argsHashOf } from "../../lib/cockpit/confirm.js";
import { effectiveSpec } from "../../lib/cockpit/tool-spec.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";

const mock = createMockModel({ steps: {} });
function setup(steps, table, lensActions = new Map()) {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "g", modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, steps.map((s, i) => ({ id: `stp_${i + 1}`, expects: [], ...s })));
  const events = [];
  const exec = fakeExec(table);
  const deps = { exec, lensActions, sleep: async () => {}, stepCall: (a) => mock.next(a), emit: (e) => events.push(e) };
  return {
    db, run, exec, events, deps,
    drive: () => driveRun({ db, runId: run.id, owner: "t", deps }),
    run_: () => store.getRun(db, run.id),
    step: (n) => store.listSteps(db, run.id)[n - 1],
    decide: (n, over = {}) => applyDecision(db, { run, step: store.listSteps(db, run.id)[n - 1], userId: "u1", decision: "approve", lensActions, ...over }),
  };
}
const dtu = (title = "A") => ({ goal: `save ${title}`, tool: "create_dtu", args: { title } });
const saved = { tool: "create_dtu", ok: true, result: { dtuId: "d1" } };

test("policies", () => {
  assert.equal(confirmPolicy("read"), "none");
  assert.equal(confirmPolicy("compute"), "none");
  assert.equal(confirmPolicy("write"), "once");
  assert.equal(confirmPolicy("high"), "always");
});

test("a read step never pauses", async () => {
  const t = setup([{ goal: "s", tool: "web_search", args: { query: "q" } }], { web_search: [{ tool: "web_search", ok: true, result: { results: [1] } }] });
  await t.drive();
  assert.equal(t.run_().status, "done");
});

test("a write pauses, and after approval runs once", async () => {
  const t = setup([dtu()], { create_dtu: [saved] });
  await t.drive();
  assert.equal(t.run_().status, "awaiting_confirm");
  assert.equal(t.run_().statusReason, "confirm");
  assert.equal(t.exec.calls.length, 0);
  assert.equal(t.events.at(-1).type, "cockpit:confirm");
  assert.equal(t.decide(1).ok, true);
  await t.drive();
  assert.equal(t.run_().status, "done");
  assert.equal(t.exec.calls.length, 1);
  assert.equal(t.run_().usage.humanInterventions, 1);
});

test("a second write pauses again unless dontAskAgain", async () => {
  const a = setup([dtu("A"), dtu("B")], { create_dtu: [saved] });
  await a.drive(); a.decide(1); await a.drive();
  assert.equal(a.run_().status, "awaiting_confirm");
  assert.equal(a.step(2).status, "awaiting_confirm");

  const b = setup([dtu("A"), dtu("B")], { create_dtu: [saved] });
  await b.drive(); b.decide(1, { dontAskAgain: true }); await b.drive();
  assert.equal(b.run_().status, "done");
  assert.equal(b.exec.calls.length, 2);
});

test("a high-risk step pauses every time, even with dontAskAgain", async () => {
  const lensActions = new Map([["billing.pay-invoice", () => {}]]);
  const pay = (n) => ({ goal: `pay ${n}`, tool: "lens:billing.pay-invoice", args: { invoice: n } });
  const t = setup([pay("1"), pay("2")], { "lens:billing.pay-invoice": [{ tool: "run_lens_action", ok: true, result: { paymentId: "p1" } }] }, lensActions);
  await t.drive();
  assert.equal(t.run_().status, "awaiting_confirm");
  t.decide(1, { dontAskAgain: true });
  await t.drive();
  assert.equal(t.run_().status, "awaiting_confirm");
  assert.equal(t.step(2).status, "awaiting_confirm");
  assert.equal(t.exec.calls.length, 1);
});

test("approve with edited args runs the edited values", async () => {
  const t = setup([dtu("A")], { create_dtu: (c) => ({ tool: "create_dtu", ok: true, result: { dtuId: "d9", title: c.params.title } }) });
  await t.drive();
  assert.equal(t.decide(1, { editedArgs: { title: "Edited" } }).ok, true);
  await t.drive();
  assert.equal(t.exec.calls[0].params.title, "Edited");
});

test("approve with invalid edited args is refused", async () => {
  const t = setup([dtu("A")], { create_dtu: [saved] });
  await t.drive();
  const r = t.decide(1, { editedArgs: {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "invalid_edit");
  assert.equal(t.run_().status, "awaiting_confirm");
});

test("reject on an optional step skips it and the run continues", async () => {
  const t = setup([{ ...dtu("A"), required: false }, { goal: "s", tool: "web_search", args: { query: "q" } }], {
    create_dtu: [saved], web_search: [{ tool: "web_search", ok: true, result: { results: [1] } }],
  });
  await t.drive();
  assert.equal(t.decide(1, { decision: "reject" }).ok, true);
  await t.drive();
  assert.equal(t.step(1).status, "skipped");
  assert.equal(t.run_().status, "done");
});

test("reject on a required step fails the run", async () => {
  const t = setup([dtu("A")], { create_dtu: [saved] });
  await t.drive();
  t.decide(1, { decision: "reject" });
  assert.equal(t.run_().status, "failed");
  assert.equal(t.run_().statusReason, "rejected_by_user");
});

test("another user cannot decide", async () => {
  const t = setup([dtu("A")], { create_dtu: [saved] });
  await t.drive();
  const r = applyDecision(t.db, { run: t.run, step: t.step(1), userId: "someone-else", decision: "approve" });
  assert.deepEqual(r, { ok: false, reason: "not_waiting" });
});

test("an approval for args A does not approve args B on a high-risk step", () => {
  const spec = { risk: "high" };
  const step = { id: "stp_1" };
  const approvals = [{ scope: "step", stepId: "stp_1", tool: "t", argsHash: argsHashOf({ a: 1 }) }];
  assert.equal(needsConfirm({ step, call: { tool: "t", args: { a: 1 } }, spec, approvals }).needed, false);
  assert.equal(needsConfirm({ step, call: { tool: "t", args: { a: 2 } }, spec, approvals }).needed, true);
});

test("the card has no tool id and no token field", () => {
  const spec = effectiveSpec({ tool: "create_dtu", args: {} });
  const card = buildConfirmCard({ step: { id: "stp_1", goal: "Save the note" }, call: { tool: "create_dtu", args: { title: "A", due_date: "x", apiToken: "secret" } }, spec });
  const text = JSON.stringify(card);
  assert.ok(!text.includes("create_dtu"));
  assert.ok(!/token|secret/i.test(text));
  assert.ok(card.args.some((a) => a.name === "Due date"));
});

test("an answer is stored for the next attempt and stripped from the call", async () => {
  const m = createMockModel({ steps: { "*": [{ tool: "ask_user", args: { question: "Which one?" }, why: "x" }] } });
  const t = setup([{ goal: "pick one", tool: null, args: null }], { web_search: [{ tool: "web_search", ok: true, result: { results: [1] } }] });
  t.deps.stepCall = (a) => m.next(a);
  await t.drive();
  assert.equal(t.run_().statusReason, "question");
  const r = applyDecision(t.db, { run: t.run, step: t.step(1), userId: "u1", decision: "answer", answer: "the blue one" });
  assert.equal(r.ok, true);
  assert.equal(t.step(1).args.__userAnswer, "the blue one");
  assert.equal(t.step(1).attempts, 0);
});
