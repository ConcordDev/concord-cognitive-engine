// FIX-integrations-007 — pinning drive for the zap run → history chain.
//
// The audit recorded a workflow whose summary read '1 runs · 1 ok ·
// 0 failed' while its History panel said 'No runs recorded yet.' At
// branch state the chain is consistent in-process: zapRun and
// retryRun are the only two paths that bump a zap's counters, and
// both recordRun under the same actor key runHistory reads. This
// drive pins that invariant end to end; the audit's split is
// consistent with a restart / state-replica divergence between the
// run and the History read (the persistence walker's round-trip of
// the nested runs Map is a desk-side read), not with the domain
// handlers, which this test exercises directly.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import registerIntegrationsActions from "../domains/integrations.js";

const actions = new Map();
registerIntegrationsActions((domain, name, fn) => actions.set(`${domain}.${name}`, fn));

const ctx = { actor: { userId: "qa-user" } };
const artifact = { id: null, domain: "integrations", type: "domain_action", data: {}, meta: {} };
const call = async (name, input) => actions.get(`integrations.${name}`)(ctx, artifact, input);

beforeEach(() => {
  globalThis._concordSTATE = {};
});

test("a run bumps the zap counters AND lands in runHistory under the same actor", async () => {
  const saved = await call("zapSave", { name: "qa zap", trigger: { event: "manual" }, steps: [] });
  assert.equal(saved.ok, true);
  const zapId = saved.result.zap.id;

  const run = await call("zapRun", { zapId });
  assert.equal(run.ok, true);
  assert.equal(run.result.run.status, "success");

  const list = await call("zapList", {});
  const zap = list.result.zaps.find((z) => z.id === zapId);
  assert.equal(zap.runCount, 1);
  assert.equal(zap.successCount, 1);
  assert.equal(zap.failureCount, 0);

  const history = await call("runHistory", { zapId, limit: 50 });
  assert.equal(history.ok, true);
  assert.equal(history.result.runs.length, 1);
  assert.equal(history.result.runs[0].id, run.result.run.id);
  assert.equal(history.result.total, 1);
});
