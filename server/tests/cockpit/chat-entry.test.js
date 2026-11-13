import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import * as store from "../../lib/cockpit/run-store.js";
import { handleChatTurn } from "../../lib/cockpit/chat-entry.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";

const saved = { route: process.env.CONCORD_COCKPIT_ROUTE, runs: process.env.CONCORD_COCKPIT_RUNS };
before(() => { process.env.CONCORD_COCKPIT_ROUTE = "1"; process.env.CONCORD_COCKPIT_RUNS = "1"; });
after(() => {
  for (const [k, v] of [["CONCORD_COCKPIT_ROUTE", saved.route], ["CONCORD_COCKPIT_RUNS", saved.runs]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const SEARCH = "search the web for heat pump prices";
const stepOf = (i, tool, args) => ({ key: `s${i}`, goal: `step ${i}`, tool, args, expects: [], dependsOn: [], required: true });
function turn(over = {}) {
  const db = over.db || memDb();
  const exec = fakeExec(over.table || { web_search: [{ tool: "web_search", ok: true, result: { title: "Heat pumps", total: 3 } }], create_dtu: [{ tool: "create_dtu", ok: true, result: { dtuId: "d1", title: "A" } }] });
  const mock = createMockModel({ steps: {} });
  const events = [];
  const planSteps = over.steps || [stepOf(1, "web_search", { query: "a" }), stepOf(2, "web_search", { query: "b" }), stepOf(3, "web_search", { query: "c" })];
  return {
    db, exec, events,
    args: {
      db, userId: "u1", chatSessionId: "T", message: over.message || SEARCH, runMacro: async () => ({ ok: true }), lensActions: new Map(),
      chatProgress: (e) => events.push(e), deadlineMs: over.deadlineMs ?? Date.now() + 20000,
      deps: { planRun: async () => ({ ok: true, source: "template", steps: planSteps }), engineDeps: { exec, sleep: async () => {}, stepCall: (a) => mock.next(a) } },
    },
  };
}

test("a 3-step plan finishes and says so", async () => {
  const t = turn();
  const r = await handleChatTurn(t.args);
  assert.ok(r.reply.startsWith("Finished 3 steps."), r.reply);
  assert.equal(r.meta.cockpit.status, "done");
  assert.ok(t.events.some((e) => e.type === "cockpit:step"));
});

test("a write asks first, and yes finishes it", async () => {
  const t = turn({ steps: [stepOf(1, "create_dtu", { title: "A" })], message: "save a note called A and search the web" });
  const first = await handleChatTurn(t.args);
  assert.ok(first.reply.startsWith("I need your OK"), first.reply);
  const second = await handleChatTurn({ ...t.args, message: "yes" });
  assert.equal(second.meta.cockpit.status, "done");
  assert.equal(t.exec.calls.length, 1);
});

test("with two active runs the third is refused and no run row is created", async () => {
  const t = turn();
  for (let i = 0; i < 2; i++) store.createRun(t.db, { userId: "u1", surface: "chat", goal: "g", modelProfile: "local-2b" });
  const r = await handleChatTurn(t.args);
  assert.ok(r.reply.startsWith("You already have 2 tasks running."));
  assert.equal(t.db.prepare("SELECT COUNT(*) c FROM cockpit_runs").get().c, 2);
});

test("a deadline already passed leaves the run working, not failed", async () => {
  const t = turn({ deadlineMs: Date.now() - 1000 });
  const r = await handleChatTurn(t.args);
  assert.ok(r.reply.startsWith("Working on it: 0 of 3 steps finished."), r.reply);
  assert.notEqual(store.getRun(t.db, r.meta.cockpit.runId).status, "failed");
});

test("a turn the cockpit does not own returns null", async () => {
  const t = turn({ message: "hello there" });
  assert.equal(await handleChatTurn(t.args), null);
});
