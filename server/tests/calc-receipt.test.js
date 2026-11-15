// GB-1534: the signing-grade calc receipt (schema concord-calc-receipt/2).
// The v2 receipt signs its inputs AND outputs: any edit under results,
// verdict, handCheck, inputs, or designBasis must fail verification with
// digest_mismatch. A v1 receipt (the pre-GB-1534 beam shape) still
// verifies, but the verdict says plainly that its outputs are NOT signed.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  attestReceipt,
  resetSigningKeyCache,
  verifyAttestation,
  V1_RECEIPT_NOTE,
} from "../lib/receipts/attest.js";
import { CALC_RECEIPT_SCHEMA } from "../lib/receipts/calc-receipt.js";
import {
  buildAnalysisReceipt,
  hashBeamStudyInputs,
} from "../lib/conkay/beam-study.js";
import { solveBeamStudy } from "../domains/engineering.js";

const ENV_KEYS = [
  "CONCORD_RECEIPT_SIGNING_KEY",
  "CONCORD_RECEIPT_SIGNING_KEY_PATH",
  "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS",
];

function freshKeyPem() {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  return privateKey.export({ type: "pkcs8", format: "pem" });
}

function useKey(pem) {
  delete process.env.CONCORD_RECEIPT_SIGNING_KEY_PATH;
  process.env.CONCORD_RECEIPT_SIGNING_KEY = pem;
  resetSigningKeyCache();
}

function clearKey() {
  for (const k of ENV_KEYS) delete process.env[k];
  resetSigningKeyCache();
}

beforeEach(() => useKey(freshKeyPem()));
afterEach(() => clearKey());

const DEMO_INPUT = {
  dims: { length: 1200, height: 200, flangeWidth: 100, flangeThickness: 10, webThickness: 6 },
  loadN: 200000,
  support: "simply-supported",
  material: "steel-a992",
};

function demoReceipt() {
  const solved = solveBeamStudy(DEMO_INPUT);
  assert.equal(solved.ok, true);
  return solved.result.calcReceipt;
}

/** Every leaf path under the given object, as arrays of keys. */
function leafPaths(value, prefix = []) {
  if (value && typeof value === "object") {
    if (Array.isArray(value)) {
      return value.flatMap((item, i) => leafPaths(item, [...prefix, i]));
    }
    return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...prefix, k]));
  }
  return [prefix];
}

function mutateAt(root, path) {
  const copy = JSON.parse(JSON.stringify(root));
  let node = copy;
  for (const key of path.slice(0, -1)) node = node[key];
  const last = path[path.length - 1];
  const value = node[last];
  if (typeof value === "number") node[last] = value + 1;
  else if (typeof value === "boolean") node[last] = !value;
  else if (typeof value === "string") node[last] = `${value}x`;
  else node[last] = "tampered";
  return copy;
}

describe("calc receipt v2 (GB-1534)", () => {
  it("carries the full signed body: schema, inputs beside their hash, design basis, results, verdict", () => {
    const receipt = demoReceipt();
    assert.equal(receipt.receiptSchema, CALC_RECEIPT_SCHEMA);
    assert.equal(receipt.receiptSchema, "concord-calc-receipt/2");
    assert.deepEqual(receipt.solver, { id: "fea-solver", version: "5.0.0" });
    // The full canonical inputs are signed, not just their hash — and the
    // hash still recomputes from exactly those inputs.
    assert.equal(receipt.inputHash, hashBeamStudyInputs(receipt.inputs));
    assert.equal(receipt.inputs.dims.length, 1200);
    assert.equal(receipt.inputs.loadN, 200000);
    assert.equal(receipt.inputs.material.E, 200000);
    assert.equal(receipt.inputs.material.yield, 345);
    // Design basis stated, never implied: no design code was used.
    assert.equal(receipt.designBasis.code, "none — yield check only");
    assert.equal(receipt.designBasis.loadFactors, "unfactored");
    assert.equal(receipt.designBasis.requiredSF, 1);
    assert.ok(receipt.designBasis.checksNotPerformed.includes("Shear"));
    assert.ok(receipt.designBasis.checksNotPerformed.includes("Self-weight"));
    // Results are rounded before signing: stress to 0.1 MPa, SF to 0.01.
    assert.equal(receipt.results.maxStressMPa.unit, "MPa");
    const stress = receipt.results.maxStressMPa.value;
    assert.equal(Math.round(stress * 10) / 10, stress);
    const sf = receipt.results.safetyFactor.value;
    assert.equal(Math.round(sf * 100) / 100, sf);
    // The verdict names the basis honestly: a yield check at SF 1.0 is not
    // a design-code check, and the PASS is never bare.
    assert.equal(receipt.verdict.status, "PASS");
    assert.equal(receipt.verdict.requiredSF, 1);
    assert.equal(receipt.verdict.text, "PASS vs yield at SF 1.0 — not a design-code check");
    // Hand check rides signed, with its formula and the agreement errors.
    assert.equal(typeof receipt.handCheck.formula, "string");
    assert.equal(receipt.handCheck.agrees, true);
    assert.equal(receipt.issuer.service, "concord-os.org");
    assert.equal(receipt.issuer.keyId, receipt.signature.keyId);
  });

  it("verifies as a v2 receipt with outputs signed", () => {
    const verdict = verifyAttestation(JSON.parse(JSON.stringify(demoReceipt())));
    assert.equal(verdict.valid, true);
    assert.equal(verdict.schema, "concord-calc-receipt/2");
    assert.equal(verdict.outputsSigned, true);
    assert.equal(verdict.note, undefined);
  });

  it("any edit under results, verdict, handCheck, inputs, or designBasis fails with digest_mismatch", () => {
    const receipt = demoReceipt();
    let mutations = 0;
    for (const section of ["results", "verdict", "handCheck", "inputs", "designBasis"]) {
      for (const path of leafPaths(receipt[section], [section])) {
        const tampered = mutateAt(receipt, path);
        const verdict = verifyAttestation(tampered);
        assert.equal(verdict.valid, false, `edit at ${path.join(".")} must fail verification`);
        assert.equal(verdict.reason, "digest_mismatch", `edit at ${path.join(".")}`);
        mutations += 1;
      }
    }
    assert.ok(mutations > 30, `expected a wide mutation sweep, ran ${mutations}`);
  });

  it("signs caller-supplied job references, trimmed and capped, and they tamper-fail too", () => {
    const solved = solveBeamStudy({
      ...DEMO_INPUT,
      projectRef: "  Bridge 12 — north span  ",
      jobRef: "J-441",
      preparedFor: "City reviewer",
    });
    const receipt = solved.result.calcReceipt;
    assert.deepEqual(receipt.job, {
      projectRef: "Bridge 12 — north span",
      jobRef: "J-441",
      preparedFor: "City reviewer",
    });
    const tampered = JSON.parse(JSON.stringify(receipt));
    tampered.job.preparedFor = "Someone else";
    assert.equal(verifyAttestation(tampered).valid, false);
    const long = solveBeamStudy({ ...DEMO_INPUT, projectRef: "x".repeat(250) });
    assert.equal(long.result.calcReceipt.job.projectRef.length, 200);
  });

  it("a v1 receipt verifies as before but reports schema v1 and outputs unsigned", () => {
    const solved = solveBeamStudy(DEMO_INPUT);
    assert.equal(solved.ok, true);
    const v1 = buildAnalysisReceipt(
      {
        dims: solved.study.dims, support: solved.study.support, loadN: solved.study.loadN,
        material: { E: solved.study.material.E, yield: solved.study.material.yield },
      },
      solved.summary,
    );
    const verdict = verifyAttestation(JSON.parse(JSON.stringify(v1)));
    assert.equal(verdict.valid, true);
    assert.equal(verdict.schema, "v1");
    assert.equal(verdict.outputsSigned, false);
    assert.equal(verdict.note, "v1 receipt — outputs are NOT covered by the signature");
    assert.equal(V1_RECEIPT_NOTE, verdict.note);
  });

  it("a plain ad-hoc attestation is also reported as v1", () => {
    const signed = attestReceipt({ solver: "beam", loadN: 20 });
    const verdict = verifyAttestation(signed);
    assert.equal(verdict.valid, true);
    assert.equal(verdict.schema, "v1");
    assert.equal(verdict.outputsSigned, false);
  });
});
