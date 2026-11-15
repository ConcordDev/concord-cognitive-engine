// chem.molecular-weight through the real lens.run dispatch: the result carries
// a stored receiptId that reads back from the live DB and verifies.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { lensRun, load } from "./_harness.js";

describe("chem lens receipt via lens.run", () => {
  before(async () => {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
    const { resetSigningKeyCache } = await import("../../lib/receipts/attest.js");
    resetSigningKeyCache();
    await load();
  });

  it("molecular-weight returns receiptId that reads back and verifies", async () => {
    const r = await lensRun("chem", "molecular-weight", { params: { formula: "H2O" } });
    assert.equal(r.ok, true, JSON.stringify(r));
    const out = r.result;
    assert.equal(out.result.molecularWeight, 18.015);
    assert.equal(out.saved, true, JSON.stringify(out.saveError));
    const { getStoredReceipt } = await import("../../lib/receipts/store.js");
    const { verifyAttestation } = await import("../../lib/receipts/attest.js");
    const { STATE } = await load();
    const back = getStoredReceipt(STATE.db, out.receiptId);
    assert.ok(back);
    const v = verifyAttestation(back);
    assert.equal(v.valid, true);
    assert.equal(v.outputsSigned, true);
  });

  it("signed envelope carries signed:true and the reference + envelope in the body", async () => {
    const r = await lensRun("chem", "molecular-weight", { params: { formula: "C6H12O6" } });
    const out = r.result;
    assert.equal(out.signed, true);
    assert.match(out.receipt.reference.source, /IUPAC/);
    assert.ok(out.receipt.designBasis.validityEnvelope);
  });

  it("out-of-envelope input via lens.run: numbers, unsigned, reason, no receiptId", async () => {
    const r = await lensRun("chem", "molecular-weight", { params: { formula: "NaTcO4" } });
    const out = r.result;
    assert.equal(out.ok, true);
    assert.equal(typeof out.result.molecularWeight, "number");
    assert.equal(out.signed, false);
    assert.match(out.reason, /no_standard_atomic_weight/);
    assert.equal(out.receiptId, undefined);
  });

  it("calc-ph (no verified reference) is unsigned via lens.run", async () => {
    const r = await lensRun("chem", "calc-ph", { params: { concentration: 0.01, kind: "acid" } });
    assert.equal(r.result.signed, false);
    assert.equal(r.result.reason, "missing_reference");
  });
});
