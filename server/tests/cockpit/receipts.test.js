import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeStepReceipt } from "../../lib/cockpit/receipts.js";
import { verifyAttestation, resetSigningKeyCache } from "../../lib/receipts/attest.js";

const args = { run: { id: "run_1" }, step: { id: "stp_1", seq: 3, idempotencyKey: null }, call: { tool: "web_search", args: { query: "q" } }, result: { ok: true, result: { results: [1] } }, checks: [{ kind: "ok", pass: true }] };

test("a signed step receipt verifies, and a changed field breaks it", () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  resetSigningKeyCache();
  try {
    const r = makeStepReceipt(args);
    assert.equal(r.kind, "cockpit.step.v1");
    assert.equal(r.stepId, "stp_1");
    assert.equal(r.seq, 3);
    assert.equal(verifyAttestation(r).valid, true);
    assert.equal(verifyAttestation({ ...r, argsHash: "0".repeat(64) }).valid, false);
  } finally {
    delete process.env.CONCORD_RECEIPT_SIGNING_KEY;
    resetSigningKeyCache();
  }
});

test("with no key the receipt is unsigned with a reason", () => {
  delete process.env.CONCORD_RECEIPT_SIGNING_KEY;
  resetSigningKeyCache();
  const r = makeStepReceipt(args);
  assert.equal(r.signature.signature, null);
  assert.ok(r.signature.reason);
});

test("the receipt never carries the raw args or result", () => {
  const r = makeStepReceipt(args);
  assert.ok(!JSON.stringify(r).includes('"query"'));
  assert.match(r.argsHash, /^[0-9a-f]{64}$/);
  assert.match(r.resultHash, /^[0-9a-f]{64}$/);
});
