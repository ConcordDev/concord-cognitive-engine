import test from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { tickRun, driveRun, resolveRefs, runProgress } from "../../lib/cockpit/engine.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";

const sleep = async () => {};
const ok = (tool, result = { done: true }) => ({ tool, ok: true, result });
const fail = (tool, error) => ({ tool, ok: false, error });

function setup(steps, { mockFixture = { steps: {} }, table = {}, surface = "chat" } = {}) {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface, goal: "test goal", modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, steps.map((s, i) => ({ id: `stp_${i + 1}`, expects: [], ...s })));
  const exec = fakeExec(table);
  const mock = createMockModel(mockFixture);
  const deps = { exec, sleep, stepCall: (a) => mock.next(a) };
  return { db, run, exec, mock, deps, drive: (extra = {}) => driveRun({ db, runId: run.id, owner: "t1", deps, ...extra }), get: () => store.getRun(db, run.id), steps: () => store.listSteps(db, run.id) };
}
const ws = (n, extra = {}) => ({ goal: `search ${n}`, tool: "web_search", args: { query: `q${n}` }, ...extra });

test("1. fully specified steps never call the model", async () => {
  const t = setup([ws(1), ws(2), ws(3)], { table: { web_search: [ok("web_search")] } });
  await t.drive();
  assert.equal(t.get().status, "done");
  assert.equal(t.mock.calls.length, 0);
  assert.equal(t.exec.calls.length, 3);
});

test("2. a step with no tool asks the model once", async () => {
  const t = setup([{ goal: "find something", tool: null, args: null }], {
    mockFixture: { steps: { "*": [{ tool: "web_search", args: { query: "q" }, why: "x" }] } },
    table: { web_search: [ok("web_search")] },
  });
  await t.drive();
  assert.equal(t.get().status, "done");
  assert.equal(t.mock.calls.length, 1);
});

test("3. a 503 once is retried and the step takes two attempts", async () => {
  const t = setup([ws(1), ws(2)], { table: { web_search: [ok("web_search"), fail("web_search", "HTTP 503"), ok("web_search")] } });
  await t.drive();
  assert.equal(t.get().status, "done");
  assert.equal(t.steps()[1].attempts, 2);
});

test("4. an optional step that cannot work is skipped and the run still finishes", async () => {
  const t = setup([ws(1), { goal: "export it", tool: "export_dtu", args: { dtuId: "d1", format: "md" }, required: false }], {
    table: { web_search: [ok("web_search")], export_dtu: [fail("export_dtu", "unsupported part: x")] },
  });
  await t.drive();
  assert.equal(t.steps()[1].status, "skipped");
  assert.equal(t.get().status, "done");
});

test("5. a required step that keeps failing asks for help, never fails the run", async () => {
  const t = setup([ws(1), { goal: "find the note", tool: null, args: null }], {
    mockFixture: { steps: { "*": [{ tool: "dtu_search", args: { query: "q" }, why: "x" }] } },
    table: { web_search: [ok("web_search")], dtu_search: [fail("dtu_search", "DTU not found")] },
  });
  await t.drive();
  assert.equal(t.get().status, "awaiting_confirm");
  assert.equal(t.get().statusReason, "needs_help");
});

test("6. a governance refusal stops the run and later steps never run", async () => {
  const t = setup([ws(1), { goal: "search the notes", tool: "dtu_search", args: { query: "q" } }, { goal: "read page", tool: "browse_url", args: { url: "http://a.test" } }], {
    table: { web_search: [ok("web_search")], dtu_search: [fail("dtu_search", "forbidden_by_governance")], browse_url: [ok("browse_url")] },
  });
  await t.drive();
  const run = t.get();
  assert.equal(run.status, "failed");
  assert.ok(run.statusReason.startsWith("hard_stop:"));
  assert.ok(!t.exec.calls.some((c) => c.tool === "browse_url"));
  assert.equal(t.steps()[2].status, "pending");
});

test("7. a $ref resolves to an earlier step's value", async () => {
  let seen = null;
  const t = setup([
    { goal: "find", tool: "dtu_search", args: { query: "q" } },
    { goal: "export", tool: "export_dtu", args: { dtuId: { $ref: "stp_1.values.dtuId" }, format: "md" }, dependsOn: ["stp_1"] },
  ], { table: { dtu_search: [{ tool: "dtu_search", ok: true, result: { dtuId: "d9" } }], export_dtu: (c) => { seen = c.params.dtuId; return ok("export_dtu"); } } });
  await t.drive();
  assert.equal(seen, "d9");
  assert.equal(t.get().status, "done");
});

test("8. two owners at once: only one advances", async () => {
  const t = setup([ws(1)], { table: { web_search: [ok("web_search")] } });
  const [a, b] = await Promise.all([
    tickRun({ db: t.db, runId: t.run.id, owner: "A", deps: t.deps }),
    tickRun({ db: t.db, runId: t.run.id, owner: "B", deps: t.deps }),
  ]);
  assert.equal([a, b].filter((r) => r.advanced).length, 1);
  assert.equal(t.exec.calls.length, 1);
});

test("9. the same failing call a third time is classed looped", async () => {
  const t = setup([{ goal: "keep trying", tool: null, args: null }], {
    mockFixture: { steps: { "*": [{ tool: "web_search", args: { query: "q" }, why: "x" }] } },
    table: { web_search: [fail("web_search", "HTTP 404")] },
  });
  await t.drive();
  assert.equal(t.steps()[0].errorClass, "looped");
  assert.equal(t.exec.calls.length, 2);
});

test("10. negative control: a run waiting for the user does not advance", async () => {
  const t = setup([ws(1)], { table: { web_search: [ok("web_search")] } });
  store.updateRun(t.db, t.run.id, { status: "awaiting_confirm" });
  const r = await tickRun({ db: t.db, runId: t.run.id, owner: "A", deps: t.deps });
  assert.equal(r.advanced, false);
  assert.equal(t.exec.calls.length, 0);
});

test("a rate limit pauses the run with a resume time", async () => {
  const t = setup([ws(1)], { table: { web_search: [fail("web_search", "rate_limited")] } });
  await t.drive();
  const run = t.get();
  assert.equal(run.status, "paused");
  assert.ok(run.resumeAt > Math.floor(Date.now() / 1000));
});

test("resolveRefs removes an unresolvable ref and runProgress counts", () => {
  const steps = [{ id: "s1", status: "done", result: { a: { b: 5 } }, resultSummary: { values: { k: "v" } } }, { id: "s2", status: "pending" }];
  assert.deepEqual(resolveRefs({ x: { $ref: "s1.result.a.b" }, y: { $ref: "s1.values.k" }, z: { $ref: "s2.values.k" }, n: 1 }, steps), { x: 5, y: "v", n: 1 });
  assert.deepEqual(runProgress(steps), { done: 1, total: 2, failed: 0, skipped: 0 });
});
