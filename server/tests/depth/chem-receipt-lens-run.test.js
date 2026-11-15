// chem lens through the real lens.run dispatch (macro harness). Signing is NOT
// decided inside chem handlers any more — the declarations hook on
// POST /api/lens/run does it (tests/receipt-declarations.test.js). Here: the
// handlers return their numbers and never carry a signature of their own.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { lensRun, load } from "./_harness.js";

describe("chem lens via lens.run (no per-action signing)", () => {
  before(async () => {
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
    const { resetSigningKeyCache } = await import("../../lib/receipts/attest.js");
    resetSigningKeyCache();
    await load();
  });

  it("molecular-weight returns its number and no receipt of its own", async () => {
    const r = await lensRun("chem", "molecular-weight", { params: { formula: "H2O" } });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.molecularWeight, 18.015);
    assert.equal(r.result.receiptId, undefined);
    assert.equal(r.result.signed, undefined);
  });

  it("calc-ph returns its number unsigned-by-omission", async () => {
    const r = await lensRun("chem", "calc-ph", { params: { concentration: 0.01, kind: "acid" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.receiptId, undefined);
  });

  it("equilibrium rejects an unknown fuel and absurd inputs", async () => {
    const a = await lensRun("chem", "equilibrium", { params: { fuel: "Xe" } });
    assert.equal(a.result?.ok ?? a.ok, false);
    const b = await lensRun("chem", "equilibrium", { params: { fuel: "CH4", phi: 1e6 } });
    assert.equal(b.result?.ok ?? b.ok, false);
  });
});
