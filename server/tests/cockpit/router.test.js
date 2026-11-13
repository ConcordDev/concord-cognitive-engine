import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { memDb } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { decide, runStatusText } from "../../lib/cockpit/router.js";

const saved = { route: process.env.CONCORD_COCKPIT_ROUTE, runs: process.env.CONCORD_COCKPIT_RUNS };
before(() => { process.env.CONCORD_COCKPIT_ROUTE = "1"; process.env.CONCORD_COCKPIT_RUNS = "1"; });
after(() => {
  for (const [k, v] of [["CONCORD_COCKPIT_ROUTE", saved.route], ["CONCORD_COCKPIT_RUNS", saved.runs]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const SEARCH = "search the web for heat pump prices";
const plan = (n) => ({ ok: true, source: "template", steps: Array.from({ length: n }, (_, i) => ({ key: `s${i + 1}`, goal: `step ${i + 1}`, tool: null, args: null, expects: [], dependsOn: [], required: true })) });
function ctxFor(db, over = {}) {
  const calls = { n: 0 };
  return { calls, ctx: { db, userId: "u1", chatSessionId: "A", profile: "local-2b", lensActions: new Map(), deps: { planRun: async () => { calls.n++; return plan(1); } }, ...over } };
}
function waitingRun(db, thread, reason) {
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "g", chatSessionId: thread, modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, [{ id: `stp_${thread}`, goal: "save it", tool: "create_dtu", args: { title: "A" }, expects: [], status: "awaiting_confirm" }]);
  store.updateRun(db, run.id, { status: "awaiting_confirm", statusReason: reason });
  return run;
}

test("flag ROUTE off: answer and the planner is never called", async () => {
  process.env.CONCORD_COCKPIT_ROUTE = "0";
  try {
    const { ctx, calls } = ctxFor(memDb());
    assert.equal((await decide(SEARCH, ctx)).kind, "answer");
    assert.equal(calls.n, 0);
  } finally { process.env.CONCORD_COCKPIT_ROUTE = "1"; }
});

test("waiting confirm: yes approves, cancel rejects", async () => {
  const db = memDb(); waitingRun(db, "A", "confirm");
  const { ctx } = ctxFor(db);
  const y = await decide("yes", ctx);
  assert.equal(y.kind, "resume"); assert.equal(y.decision, "approve");
  const n = await decide("cancel", ctx);
  assert.equal(n.kind, "resume"); assert.equal(n.decision, "reject");
});

test("waiting question: the message is the answer", async () => {
  const db = memDb(); waitingRun(db, "A", "question");
  const { ctx } = ctxFor(db);
  const r = await decide("use 12 feet", ctx);
  assert.equal(r.kind, "resume"); assert.equal(r.decision, "answer"); assert.equal(r.answer, "use 12 feet");
});

test("waiting confirm + an unrelated question does not resume and leaves the run waiting", async () => {
  const db = memDb(); const run = waitingRun(db, "A", "confirm");
  const { ctx } = ctxFor(db);
  const r = await decide("what is a beam?", ctx);
  assert.notEqual(r.kind, "resume");
  assert.equal(store.getRun(db, run.id).status, "awaiting_confirm");
});

test("no waiting run: yes is an ordinary turn", async () => {
  const { ctx } = ctxFor(memDb());
  assert.equal((await decide("yes", ctx)).kind, "answer");
});

test("negative control: a waiting run in thread A does not capture yes in thread B", async () => {
  const db = memDb(); waitingRun(db, "A", "confirm");
  const { ctx } = ctxFor(db, { chatSessionId: "B" });
  assert.equal((await decide("yes", ctx)).kind, "answer");
});

test("what happened reports the failed step without tool ids", async () => {
  const db = memDb();
  const { run } = store.createRun(db, { userId: "u1", surface: "chat", goal: "g", chatSessionId: "A", modelProfile: "local-2b" });
  store.insertSteps(db, run.id, 1, [
    { id: "stp_1", goal: "Search the web", tool: "web_search", args: { query: "q" }, expects: [], status: "done" },
    { id: "stp_2", goal: "Read the page", tool: "browse_url", args: { url: "http://x" }, expects: [], status: "failed" },
  ]);
  store.updateStep(db, "stp_2", { status: "failed", errorText: "The page would not load" });
  store.updateRun(db, run.id, { status: "failed" });
  const { ctx } = ctxFor(db);
  const r = await decide("what happened", ctx);
  assert.equal(r.kind, "answer");
  assert.ok(r.statusText.includes("Read a web page"));
  assert.ok(r.statusText.includes("1 of 2 steps finished."));
  assert.ok(!r.statusText.includes("web_search"));
  assert.ok(!r.statusText.includes("browse_url"));
});

test("a plain greeting is an answer", async () => {
  const { ctx, calls } = ctxFor(memDb());
  assert.equal((await decide("hello there", ctx)).kind, "answer");
  assert.equal(calls.n, 0);
});

test("one-step plan is single; five steps is a run; a failed plan is an answer", async () => {
  const db = memDb();
  assert.equal((await decide(SEARCH, ctxFor(db).ctx)).kind, "single");
  assert.equal((await decide(SEARCH, ctxFor(db, { deps: { planRun: async () => plan(5) } }).ctx)).kind, "run");
  assert.equal((await decide(SEARCH, ctxFor(db, { deps: { planRun: async () => ({ ok: false }) } }).ctx)).kind, "answer");
});

test("runStatusText caps its lines", () => {
  const steps = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, status: "failed", goal: `g${i}`, tool: null, errorText: "bad" }));
  const lines = runStatusText({}, steps).split("\n");
  assert.equal(lines.length, 1 + 12 + 1);
  assert.equal(lines.at(-1), "and 8 more.");
});
