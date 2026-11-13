// Shared body for the per-lens Ask tests (CKPT-18): an Ask from <lens> must end in a reply or a plain
// { ok:false, reason } inside 10 s, on a mock model. Covers the cockpit path only; see docs/cockpit/ASK_DIAGNOSIS.md.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { memDb, fakeExec } from "./_helpers.js";
import { handleChatTurn } from "../../lib/cockpit/chat-entry.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";

export function askLensTest(lens) {
  const saved = { route: process.env.CONCORD_COCKPIT_ROUTE, runs: process.env.CONCORD_COCKPIT_RUNS };
  before(() => { process.env.CONCORD_COCKPIT_ROUTE = "1"; process.env.CONCORD_COCKPIT_RUNS = "1"; });
  after(() => {
    for (const [k, v] of [["CONCORD_COCKPIT_ROUTE", saved.route], ["CONCORD_COCKPIT_RUNS", saved.runs]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });
  test(`Ask from ${lens} ends in a reply or a plain error inside 10 s`, async () => {
    const db = memDb();
    const exec = fakeExec({ web_search: [{ tool: "web_search", ok: true, result: { title: "Answer", total: 1 } }] });
    const mock = createMockModel({ steps: {} });
    const steps = [{ key: "s1", goal: "step 1", tool: "web_search", args: { query: lens }, expects: [], dependsOn: [], required: true }];
    const t0 = Date.now();
    const r = await handleChatTurn({
      db, userId: "u1", chatSessionId: `ask-${lens}`, lensContext: lens, message: `search the web for what the ${lens} lens is for`,
      runMacro: async () => ({ ok: true }), lensActions: new Map(), deadlineMs: Date.now() + 8000,
      deps: { planRun: async () => ({ ok: true, source: "template", steps }), engineDeps: { exec, sleep: async () => {}, stepCall: (a) => mock.next(a) } },
    });
    assert.ok(Date.now() - t0 < 10000);
    assert.ok(r && (typeof r.reply === "string" && r.reply.length > 0 || r.ok === false));
  });
}
