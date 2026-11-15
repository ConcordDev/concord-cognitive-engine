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
});
