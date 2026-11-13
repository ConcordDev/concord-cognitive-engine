// Thread choice is made on the client (resolveAskThread, commit 545ed1873). The server's part is to
// keep the thread it was handed: each Ask run carries that chatSessionId, its lens, and surface "ask".
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

async function askFrom(db, lens, session) {
  const exec = fakeExec({ web_search: [{ tool: "web_search", ok: true, result: { title: "Heat pumps", total: 3 } }] });
  const mock = createMockModel({ steps: {} });
  const steps = [{ key: "s1", goal: "step 1", tool: "web_search", args: { query: "a" }, expects: [], dependsOn: [], required: true }];
  const r = await handleChatTurn({
    db, userId: "u1", chatSessionId: session, lensContext: lens, message: "search the web for heat pump prices",
    runMacro: async () => ({ ok: true }), lensActions: new Map(), deadlineMs: Date.now() + 20000,
    deps: { planRun: async () => ({ ok: true, source: "template", steps }), engineDeps: { exec, sleep: async () => {}, stepCall: (a) => mock.next(a) } },
  });
  return store.getRun(db, r.meta.cockpit.runId);
}

test("Asks from different lenses land on different threads, the same lens on one", async () => {
  const db = memDb();
  const a1 = await askFrom(db, "analytics", "thread-analytics");
  const f1 = await askFrom(db, "forecast", "thread-forecast");
  const a2 = await askFrom(db, "analytics", "thread-analytics");
  assert.notEqual(a1.chatSessionId, f1.chatSessionId);
  assert.equal(a1.chatSessionId, a2.chatSessionId);
  assert.deepEqual([a1.surface, f1.surface], ["ask", "ask"]);
  assert.equal(a1.lensContext, "analytics");
  assert.equal(f1.lensContext, "forecast");
});

test("a plain chat turn keeps surface chat", async () => {
  const db = memDb();
  const run = await askFrom(db, null, "T");
  assert.equal(run.surface, "chat");
  assert.equal(run.lensContext, null);
});
