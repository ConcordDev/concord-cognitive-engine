// tools-esign-trail.test.js
// FIX-tools-007 (GB-1521 slice B6) — two honesty defects in the e-sign
// tool: (1) the audit trail had no ROUTED event between creation and
// delivery; esign-send now records the routing once per send.
// (2) esign-verify reported an unsigned envelope the same way as a
// tampered one (allValid false, painted red "Verification failed" by
// the panel); the result now names its state: pending / failed /
// verified.
//
// Run: node --test server/domains/tools-esign-trail.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerToolsActions from "./tools.js";

const actions = new Map();
registerToolsActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const ctx = { actor: { userId: "test" }, userId: "test" };

beforeEach(() => { globalThis._concordSTATE = {}; });

async function makeEnvelope() {
  const create = actions.get("tools:esign-create");
  const r = create(ctx, null, {
    title: "NDA",
    document: "The parties agree to keep things confidential.",
    parties: [
      { name: "Sender Sam", isSender: true },
      { name: "Recipient Rae", email: "rae@example.com" },
    ],
  });
  assert.equal(r.ok, true);
  return r.result.envelope;
}

describe("tools-007 — e-sign trail + verify state", () => {
  it("verify on an unsigned envelope reports pending, not failed", async () => {
    const env = await makeEnvelope();
    const v = actions.get("tools:esign-verify")(ctx, null, { envelopeId: env.id });
    assert.equal(v.ok, true);
    assert.equal(v.result.state, "pending");
    assert.equal(v.result.allValid, false);
    assert.equal(v.result.documentIntact, true);
  });

  it("send records a routed audit event", async () => {
    const env = await makeEnvelope();
    const send = actions.get("tools:esign-send");
    const r = await send(ctx, null, { envelopeId: env.id });
    assert.equal(r.ok, true);
    const events = r.result.envelope.audit.map((a) => a.event);
    assert.ok(events.includes("routed"), `expected a routed event, got ${events.join(",")}`);
    assert.ok(events.indexOf("routed") > events.indexOf("created"));
  });

  it("applied signatures verify; outstanding parties read as not signed, not invalid", async () => {
    const env = await makeEnvelope();
    const sender = env.parties.find((p) => p.isSender);
    const recipient = env.parties.find((p) => !p.isSender);
    const sign = actions.get("tools:esign-sign");
    const r = sign(ctx, null, { envelopeId: env.id, partyId: sender.id });
    assert.equal(r.ok, true);
    const v = actions.get("tools:esign-verify")(ctx, null, { envelopeId: env.id });
    // esign-verify's contract: every APPLIED signature is checked. The
    // sender's verifies; the recipient's absence is a pending state on
    // their check, not a failure of the envelope.
    assert.equal(v.result.state, "verified");
    assert.equal(v.result.checks.find((c) => c.partyId === sender.id).verified, true);
    assert.equal(v.result.checks.find((c) => c.partyId === recipient.id).reason, "not signed");
  });
});
