import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../../lib/chat-agent.js";

function runHighRisk() {
  let ran = false;
  const lensActions = new Map([["billing.pay-invoice", async () => { ran = true; return { ok: true, paymentId: "p1" }; }]]);
  const ctx = { db: null, actor: { userId: "u1", id: "u1" }, reqMeta: {}, log: () => {} };
  const call = { tool: "run_lens_action", params: { domain: "billing", action: "pay-invoice", approval: true, params: {} } };
  return executeToolCall(ctx, async () => ({ ok: false }), lensActions, call).then((result) => ({ result, ran: () => ran }));
}

test("a model's own approval:true does not run a high-risk action", async () => {
  delete process.env.CONCORD_COCKPIT_STRIP_APPROVAL;
  const { result, ran } = await runHighRisk();
  assert.equal(ran(), false);
  assert.equal(result.ok, false);
});

test("negative control: with the flag off the old behaviour returns", async () => {
  process.env.CONCORD_COCKPIT_STRIP_APPROVAL = "0";
  try {
    const { result, ran } = await runHighRisk();
    // The old path forwarded the model's claim. Whatever the bridge then decides,
    // the outcome must differ from the stripped case: approval reached the bridge.
    assert.ok(ran() === true || result.reason !== "approval_required");
  } finally { delete process.env.CONCORD_COCKPIT_STRIP_APPROVAL; }
});
