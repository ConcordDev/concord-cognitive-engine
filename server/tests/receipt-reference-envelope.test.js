// Reference envelope + receipt schema /4: a signature means "checked against the cited reference WITHIN its envelope".
//   - declarations carry referenceEnvelope (fuel, phi, preheat, pressure, mechanism, inputRanges); a declaration without a
//     well-formed one is incomplete_declaration and never signs
//   - the gate signs a per-receipt referenceCheck { within_reference_envelope | outside_reference_envelope, reason }; outside
//     it a PASS is demoted (the receipt still carries the numbers and says so inside the signed bytes)
//   - the verifier accepts /2, /3 and /4; tampering with referenceCheck invalidates the signature; unknown schema refused
//   - engineering.beamStudy declares the REGISTERED solver id beam.fea and adapts its solver envelope
//   - static: every declaration's solver id exists in the solver registry (a planted unknown id fails)
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { up as up514 } from "../migrations/514_receipt_store.js";
import { resetSigningKeyCache, verifyAttestation, attestReceipt } from "../lib/receipts/attest.js";
import { buildCalcReceipt, CALC_RECEIPT_SCHEMA_V4, cleanReferenceCheck } from "../lib/receipts/calc-receipt.js";
import { getSolver } from "../lib/conkay/physics/registry.js";
import { solveBeamStudy } from "../domains/engineering.js";
import {
  applyReceiptDeclaration, applyEnvelopeDeclaration, assertCanSign, registerDeclaration, unregisterDeclaration, getDeclaration,
  listDeclarations, checkReferenceEnvelope, referenceEnvelopeProblems, declarationProblems,
} from "../lib/receipts/declarations.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_KEYS = ["CONCORD_RECEIPT_SIGNING_KEY", "CONCORD_RECEIPT_SIGNING_KEY_PATH", "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS"];
let db;
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  resetSigningKeyCache();
  db = new Database(":memory:");
  up514(db);
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  resetSigningKeyCache();
  db.close();
});

const stub = (inp = {}) => ({
  ok: true,
  result: {
    fuel: "CH4", phi: 1, T0: 300, P0: 1, mechanism: "gri30.yaml", status: "COMPUTED",
    adiabaticFlameTemperatureK: 2225.4, majorProducts: [{ species: "N2", moleFraction: 0.7 }],
    solver: { id: "chem.equilibrium", version: "1.0.0", method: "Cantera HP equilibrium" }, assumptions: ["ideal gas"], ...inp,
  },
});
const sign = (inputs, raw = stub()) => applyReceiptDeclaration({ domain: "chem", action: "equilibrium", inputs, raw, db });

describe("referenceEnvelope on the declarations", () => {
  it("both seeded declarations carry a well-formed referenceEnvelope and an otherwise complete declaration", () => {
    for (const [d, a] of [["chem", "equilibrium"], ["engineering", "beamStudy"]]) {
      const decl = getDeclaration(d, a);
      assert.deepEqual(referenceEnvelopeProblems(decl.referenceEnvelope), [], `${d}.${a}`);
      assert.deepEqual(declarationProblems(decl), [], `${d}.${a}`);
    }
    const re = getDeclaration("chem", "equilibrium").referenceEnvelope;
    assert.deepEqual(Object.keys(re.inputRanges).sort(), ["P0", "T0", "fuel", "phi"]);
    assert.deepEqual(re.mechanism, { CH4: "gri30.yaml", H2: "h2o2.yaml" });
    assert.deepEqual(re.inputRanges.fuel.oneOf, ["CH4", "H2"]);
  });

  it("a declaration with a missing or malformed referenceEnvelope is incomplete and never signs", () => {
    const full = getDeclaration("chem", "equilibrium");
    const cases = {
      missing: { ...full, referenceEnvelope: undefined },
      noRanges: { ...full, referenceEnvelope: { ...full.referenceEnvelope, inputRanges: {} } },
      noDescription: { ...full, referenceEnvelope: { ...full.referenceEnvelope, description: "" } },
      badRange: { ...full, referenceEnvelope: { ...full.referenceEnvelope, inputRanges: { phi: { min: 2, max: 1 } } } },
      emptyRange: { ...full, referenceEnvelope: { ...full.referenceEnvelope, inputRanges: { phi: {} } } },
      badMechanism: { ...full, referenceEnvelope: { ...full.referenceEnvelope, mechanism: { CH4: "" } } },
    };
    for (const [name, decl] of Object.entries(cases)) {
      registerDeclaration("chem", "tmp-ref-env", decl);
      try {
        const out = applyReceiptDeclaration({ domain: "chem", action: "tmp-ref-env", inputs: { fuel: "CH4", phi: 1, T0: 300, P0: 1 }, raw: stub(), db });
        assert.equal(out.result.signed, false, name);
        assert.match(out.result.signingReason, /^incomplete_declaration:referenceEnvelope/, name);
        assert.equal(out.result.calcReceipt, undefined, name);
      } finally { unregisterDeclaration("chem", "tmp-ref-env"); }
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });
});

describe("signed referenceCheck on a /4 receipt", () => {
  it("at the reference state: signed /4, within_reference_envelope, PASS kept", () => {
    const out = sign({ fuel: "CH4", phi: 1, T0: 300, P0: 1 });
    const r = out.result.calcReceipt;
    assert.equal(out.result.signed, true);
    assert.equal(r.receiptSchema, CALC_RECEIPT_SCHEMA_V4);
    assert.deepEqual(r.referenceCheck, { status: "within_reference_envelope" });
    assert.equal(r.verdict.status, "PASS");
    const v = verifyAttestation(r);
    assert.equal(v.valid, true);
    assert.equal(v.schema, "concord-calc-receipt/4");
    assert.deepEqual(v.referenceCheck, { status: "within_reference_envelope" });
  });

  it("inside the solver envelope but off the reference state: signed, outside_reference_envelope with the reason, never PASS", () => {
    for (const [inp, why] of [[{ phi: 1.3 }, /phi/], [{ T0: 600 }, /T0/], [{ P0: 5 }, /P0/]]) {
      const input = { fuel: "CH4", phi: 1, T0: 300, P0: 1, ...inp };
      const out = sign(input, stub(input));
      const r = out.result.calcReceipt;
      assert.equal(out.result.signed, true, JSON.stringify(inp));
      assert.equal(r.referenceCheck.status, "outside_reference_envelope");
      assert.match(r.referenceCheck.reason, why);
      assert.notEqual(r.verdict.status, "PASS");
      assert.equal(verifyAttestation(r).valid, true);
    }
  });

  it("outside the reference envelope a verdict of PASS is demoted by the gate, whatever the declaration's own parts say", () => {
    const full = getDeclaration("chem", "equilibrium");
    registerDeclaration("chem", "tmp-pass", { ...full, buildParts: (i, r, d) => {
      const p = full.buildParts(i, r, d);
      return { ...p, verdict: { status: "PASS", governing: "reference comparison", text: "PASS: forced by a careless declaration." } };
    } });
    try {
      const input = { fuel: "CH4", phi: 1.3, T0: 300, P0: 1 };
      const out = applyReceiptDeclaration({ domain: "chem", action: "tmp-pass", inputs: input, raw: stub(input), db });
      assert.equal(out.result.signed, true);
      assert.equal(out.result.calcReceipt.verdict.status, "WARN");
      assert.match(out.result.calcReceipt.verdict.text, /Outside the reference envelope/);
      assert.equal(out.result.calcReceipt.referenceCheck.status, "outside_reference_envelope");
    } finally { unregisterDeclaration("chem", "tmp-pass"); }
  });

  it("a FAIL verdict inside the envelope is kept (never upgraded or softened)", () => {
    const out = sign({ fuel: "CH4", phi: 1, T0: 300, P0: 1 }, stub({ adiabaticFlameTemperatureK: 2100 }));
    assert.equal(out.result.calcReceipt.verdict.status, "FAIL");
    assert.equal(out.result.calcReceipt.referenceCheck.status, "within_reference_envelope");
  });

  it("the out-of-SOLVER-envelope sign gate is unchanged: phi 3 is still unsigned out_of_envelope", () => {
    const out = sign({ fuel: "CH4", phi: 3, T0: 300, P0: 1 }, stub({ phi: 3 }));
    assert.equal(out.result.signed, false);
    assert.match(out.result.signingReason, /^out_of_envelope/);
  });

  it("unsigned demo bodies carry referenceCheck too (and no signature)", () => {
    const input = { fuel: "CH4", phi: 3, T0: 300, P0: 1 };
    const out = applyReceiptDeclaration({ domain: "chem", action: "equilibrium", inputs: input, raw: stub(input), db, withUnsignedBody: true });
    assert.equal(out.result.signed, false);
    assert.equal(out.result.calcReceipt.signature.signature, null);
    assert.equal(out.result.calcReceipt.referenceCheck.status, "outside_reference_envelope");
  });

  it("checkReferenceEnvelope: fuel / mechanism / non-finite and missing envelope are all outside, never within", () => {
    const decl = getDeclaration("chem", "equilibrium");
    const ok = { fuel: "CH4", phi: 1, T0: 300, P0: 1 };
    assert.equal(checkReferenceEnvelope(decl, ok, { inputs: { mechanism: "gri30.yaml" } }).status, "within_reference_envelope");
    assert.equal(checkReferenceEnvelope(decl, ok, { inputs: { mechanism: "h2o2.yaml" } }).status, "outside_reference_envelope");
    assert.match(checkReferenceEnvelope(decl, ok, { inputs: { mechanism: "h2o2.yaml" } }).reason, /mechanism/);
    assert.equal(checkReferenceEnvelope(decl, { ...ok, fuel: "C3H8" }, null).status, "outside_reference_envelope");
    assert.equal(checkReferenceEnvelope(decl, { ...ok, phi: NaN }, null).status, "outside_reference_envelope");
    assert.equal(checkReferenceEnvelope(decl, { ...ok, phi: undefined }, null).status, "outside_reference_envelope");
    assert.equal(checkReferenceEnvelope({ ...decl, referenceEnvelope: undefined }, ok, null).reason, "no_reference_envelope_declared");
    assert.equal(checkReferenceEnvelope(null, ok, null).status, "outside_reference_envelope");
  });

  it("beamStudy (prebuilt receipt): signed /4 with referenceCheck within", () => {
    const input = { dims: { length: 3000, height: 300, flangeWidth: 150, flangeThickness: 12, webThickness: 8 }, loadN: 20000, support: "simply-supported", material: "steel-a992" };
    const solved = solveBeamStudy(input);
    const out = applyReceiptDeclaration({ domain: "engineering", action: "beamStudy", inputs: input, raw: { ok: true, result: solved.result }, db });
    assert.equal(out.result.signed, true);
    assert.equal(out.result.calcReceipt.receiptSchema, CALC_RECEIPT_SCHEMA_V4);
    assert.deepEqual(out.result.calcReceipt.referenceCheck, { status: "within_reference_envelope" });
    assert.equal(verifyAttestation(out.result.calcReceipt).valid, true);
  });
});

describe("verifier: v2 + v3 + v4, tampering, unknown schema", () => {
  it("accepts the committed v2 and v3 fixtures and a fresh v4", () => {
    const keys = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/receipts/keys.json"), "utf8")).keys;
    for (const f of ["receipt-v2.json", "receipt-v3.json"]) {
      const r = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/receipts", f), "utf8"));
      const v = verifyAttestation(r, keys);
      assert.equal(v.valid, true, f);
    }
    const v4 = sign({ fuel: "CH4", phi: 1, T0: 300, P0: 1 }).result.calcReceipt;
    assert.equal(verifyAttestation(v4).valid, true);
    const plain = buildCalcReceipt({ solver: "s@1", inputs: { a: 1 } });
    assert.equal(plain.receiptSchema, "concord-calc-receipt/3", "no referenceCheck -> still /3");
    assert.equal(verifyAttestation(plain).valid, true);
  });

  it("tampering with referenceCheck invalidates the signature (flip, drop, rewrite reason, add)", () => {
    const off = { fuel: "CH4", phi: 1.3, T0: 300, P0: 1 };
    const r = sign(off, stub(off)).result.calcReceipt;
    assert.equal(verifyAttestation(r).valid, true);
    const flip = JSON.parse(JSON.stringify(r)); flip.referenceCheck = { status: "within_reference_envelope" };
    assert.deepEqual([verifyAttestation(flip).valid, verifyAttestation(flip).reason], [false, "digest_mismatch"]);
    const drop = JSON.parse(JSON.stringify(r)); delete drop.referenceCheck;
    assert.equal(verifyAttestation(drop).valid, false);
    const reason = JSON.parse(JSON.stringify(r)); reason.referenceCheck.reason = "looks fine";
    assert.equal(verifyAttestation(reason).valid, false);
    const pass = JSON.parse(JSON.stringify(r)); pass.verdict = { ...pass.verdict, status: "PASS" };
    assert.equal(verifyAttestation(pass).valid, false);
    // a re-hashed edit (digest updated to match) still fails the Ed25519 signature
    const rehashed = JSON.parse(JSON.stringify(r)); rehashed.referenceCheck = { status: "within_reference_envelope" };
    const { signature, ...body } = rehashed;
    const canon = (o) => (Array.isArray(o) ? `[${o.map(canon).join(",")}]` : o && typeof o === "object" ? `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}` : JSON.stringify(o));
    rehashed.signature = { ...signature, digest: crypto.createHash("sha256").update(canon(body)).digest("hex") };
    assert.equal(verifyAttestation(rehashed).reason, "bad_signature");
  });

  it("a validly SIGNED /4 body with a malformed or missing referenceCheck is not accepted", () => {
    for (const rc of [undefined, null, { status: "verified" }, { status: "outside_reference_envelope" }, { status: "outside_reference_envelope", reason: "  " }, "within_reference_envelope", []]) {
      const body = { receiptSchema: CALC_RECEIPT_SCHEMA_V4, solver: { id: "x", version: "1" }, inputs: {}, results: {}, ...(rc === undefined ? {} : { referenceCheck: rc }) };
      const v = verifyAttestation(attestReceipt(body));
      assert.equal(v.valid, false, JSON.stringify(rc));
      assert.equal(v.reason, "malformed_reference_check", JSON.stringify(rc));
    }
  });

  it("an unknown concord-calc-receipt schema is refused even when correctly signed; other families are untouched", () => {
    const v = verifyAttestation(attestReceipt({ receiptSchema: "concord-calc-receipt/9", inputs: {} }));
    assert.deepEqual([v.valid, v.reason], [false, "unsupported_schema"]);
    assert.equal(verifyAttestation(attestReceipt({ receiptSchema: "something-else/1", inputs: {} })).valid, true);
    assert.equal(verifyAttestation(attestReceipt({ inputs: {} })).valid, true);
  });

  it("buildCalcReceipt refuses a malformed referenceCheck instead of signing it", () => {
    assert.throws(() => buildCalcReceipt({ solver: "s@1", inputs: {}, referenceCheck: { status: "nope" } }), /invalid referenceCheck/);
    assert.equal(cleanReferenceCheck({ status: "outside_reference_envelope" }), null);
    assert.deepEqual(cleanReferenceCheck({ status: "within_reference_envelope", reason: "ignored" }), { status: "within_reference_envelope" });
  });
});

describe("engineering.beamStudy solver id + fromEnvelope adapter", () => {
  const beamEnv = (over = {}) => {
    const dims = { length: 3000, height: 300, flangeWidth: 150, flangeThickness: 12, webThickness: 8 };
    const solved = solveBeamStudy({ dims, loadN: 20000, support: "simply-supported", material: "steel-a992" }).result;
    return {
      solver: { id: "beam.fea", version: "1.0.0" }, status: "PASS",
      inputs: {
        support: { value: "simply-supported" }, length: { value: 3, unit: "m" }, height: { value: 0.3, unit: "m" }, flangeWidth: { value: 0.15, unit: "m" },
        flangeThickness: { value: 0.012, unit: "m" }, webThickness: { value: 0.008, unit: "m" },
        E: { value: 200e9, unit: "Pa" }, yield: { value: 345e6, unit: "Pa" }, "pointLoad.ULS": { value: 20000, unit: "N" },
      },
      outputs: { maxStress: { value: solved.maxStressMPa * 1e6, unit: "Pa" }, maxDeflection: { value: solved.maxDeflectionMm / 1000, unit: "m" } },
      ...over,
    };
  };

  it("the declaration names the registered solver id beam.fea", () => {
    assert.equal(getDeclaration("engineering", "beamStudy").solver.id, "beam.fea");
    assert.ok(getSolver("beam.fea"));
    assert.equal(typeof getDeclaration("engineering", "beamStudy").fromEnvelope, "function");
  });

  it("applyEnvelopeDeclaration finds it by solver id and signs the adapted envelope (/4, within)", () => {
    const out = applyEnvelopeDeclaration(beamEnv(), { db });
    assert.equal(out.signed, true, JSON.stringify(out));
    assert.equal(out.calcReceipt.receiptSchema, CALC_RECEIPT_SCHEMA_V4);
    assert.equal(out.calcReceipt.referenceCheck.status, "within_reference_envelope");
    assert.equal(verifyAttestation(out.calcReceipt).valid, true);
  });

  it("the old id no longer matches anything: an envelope still labelled beam-frame-fea is unsigned missing_declaration", () => {
    const out = applyEnvelopeDeclaration(beamEnv({ solver: { id: "beam-frame-fea", version: "1" } }), { db });
    assert.deepEqual([out.signed, out.signingReason], [false, "missing_declaration"]);
  });

  it("failure paths: not adaptable -> unsigned, numbers untouched", () => {
    const cases = {
      "outputs that the lens solver does not reproduce": beamEnv({ outputs: { maxStress: { value: 1, unit: "Pa" }, maxDeflection: { value: 1, unit: "m" } } }),
      "unknown material (E/yield match no library entry)": (() => { const e = beamEnv(); e.inputs.E = { value: 123e9 }; return e; })(),
      "two point loads": (() => { const e = beamEnv(); e.inputs["pointLoad.SLS"] = { value: 5000 }; return e; })(),
      "no outputs": beamEnv({ outputs: {} }),
      "NOT_COMPUTED": beamEnv({ status: "NOT_COMPUTED" }),
      "non-finite dimension": (() => { const e = beamEnv(); e.inputs.length = { value: "abc" }; return e; })(),
    };
    for (const [name, env] of Object.entries(cases)) {
      const out = applyEnvelopeDeclaration(env, { db });
      assert.equal(out.signed, false, name);
      assert.match(out.signingReason, /^(out_of_envelope|missing_declaration|not_computed)/, name);
      assert.equal(out.calcReceipt, null, name);
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });
});

describe("static: every declaration's solver id is a registered solver", () => {
  const unknown = (decls) => decls.filter(([, d]) => !d.solver || !getSolver(d.solver.id)).map(([k]) => k);
  const all = () => listDeclarations().map((k) => [k, getDeclaration(...k.split(/\.(.+)/).slice(0, 2))]);

  it("holds for the whole REGISTRY", () => {
    assert.ok(all().length >= 2);
    assert.deepEqual(unknown(all()), []);
  });

  it("fails on a planted declaration with an unknown solver id (fixture proves the check bites)", () => {
    registerDeclaration("scratch", "ghost", { ...getDeclaration("chem", "equilibrium"), solver: { id: "beam-frame-fea", version: "1" } });
    try {
      assert.deepEqual(unknown(all()), ["scratch.ghost"]);
    } finally { unregisterDeclaration("scratch", "ghost"); }
    assert.deepEqual(unknown(all()), []);
  });
});
