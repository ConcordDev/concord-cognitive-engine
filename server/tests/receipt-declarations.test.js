// Declarations registry + the single signing hook on POST /api/lens/run
// (lib/receipts/declarations.js). The merge gate:
//   chem.equilibrium { fuel:"CH4", phi:1, T0:300, P0:1 } -> receiptId that
//   GET /api/receipts/:id reads back and POST /api/receipts/verify accepts
//   ({ valid:true, outputsSigned:true }), citing Turns 3e 2226 K +/- 25 K.
// The hook is exercised exactly as server.js calls it, around the real chem
// lens handler (real Cantera when installed, else a stubbed computed outcome
// so the receipt gate is still proven).
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import http from "node:http";
import Database from "better-sqlite3";
import { up as up514 } from "../migrations/514_receipt_store.js";
import { resetSigningKeyCache, verifyAttestation } from "../lib/receipts/attest.js";
import { canteraPythonPath } from "../lib/conkay/chem/cantera.js";
import { getStoredReceipt } from "../lib/receipts/store.js";
import createReceiptRouter from "../routes/receipts.js";
import registerChemActions from "../domains/chem.js";
import { solveBeamStudy } from "../domains/engineering.js";
import {
  applyReceiptDeclaration, assertCanSign, registerDeclaration, unregisterDeclaration, getDeclaration,
} from "../lib/receipts/declarations.js";

const HAVE_KERNEL = (() => { try { return fs.existsSync(canteraPythonPath()); } catch { return false; } })();
const ENV_KEYS = ["CONCORD_RECEIPT_SIGNING_KEY", "CONCORD_RECEIPT_SIGNING_KEY_PATH", "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS"];
const pass = (_q, _s, n) => n();
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

const ACTIONS = new Map();
before(() => registerChemActions((d, n, fn) => ACTIONS.set(n, fn)));
const ctx = () => ({ actor: { userId: "u1" }, userId: "u1", db });
const stored = () => db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n;

/** What server.js does: dispatch the lens handler, then run the hook on its raw return. */
async function lensRunChem(action, input) {
  const raw = await ACTIONS.get(action)(ctx(), { data: input }, input);
  return applyReceiptDeclaration({ domain: "chem", action, inputs: input, raw, db });
}

async function withReceipts(fn) {
  const app = express();
  app.use(express.json());
  app.use(createReceiptRouter({ readLimit: pass, verifyLimit: pass, db }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}
const readBack = async (base, id) => (await fetch(`${base}/api/receipts/${id}`)).json();
const verify = async (base, receipt) => (await fetch(`${base}/api/receipts/verify`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt }),
})).json();

/** A computed chem.equilibrium handler return, as the Cantera path produces it (used when no kernel is installed). */
const stubComputed = (over = {}) => ({
  ok: true,
  result: {
    fuel: "CH4", phi: 1, T0: 300, P0: 1, mechanism: "gri30.yaml", status: "COMPUTED",
    adiabaticFlameTemperatureK: 2225.4, majorProducts: [{ species: "N2", moleFraction: 0.7 }, { species: "H2O", moleFraction: 0.18 }],
    solver: { id: "chem.equilibrium", version: "1.0.0", method: "Cantera HP equilibrium" }, assumptions: ["ideal gas"],
    ...over,
  },
});

describe("merge gate: chem lens equilibrium -> stored, verifiable, Turns-cited v2 receipt", () => {
  it("stubbed computed outcome: receiptId reads back, verify valid + outputsSigned, Turns 2226 +/- 25", async () => {
    const input = { fuel: "CH4", phi: 1, T0: 300, P0: 1 };
    const out = applyReceiptDeclaration({ domain: "chem", action: "equilibrium", inputs: input, raw: stubComputed(), db });
    assert.equal(out.result.signed, true);
    assert.equal(out.result.saved, true);
    assert.match(out.result.receiptId, /^rcpt_/);
    assert.equal(out.result.receiptUrl, `/api/receipts/${out.result.receiptId}`);
    const r = out.result.calcReceipt;
    assert.equal(r.receiptSchema, "concord-calc-receipt/3");
    assert.equal(r.reference.value, 2226);
    assert.equal(r.reference.tolerance, 25);
    assert.match(r.reference.case, /Turns/);
    assert.equal(r.verdict.status, "PASS");
    assert.equal(r.results.adiabaticFlameTemperature.value, 2225.4);
    await withReceipts(async (base) => {
      const back = await readBack(base, out.result.receiptId);
      assert.deepEqual(back, JSON.parse(JSON.stringify(r)));
      const v = await verify(base, back);
      assert.equal(v.valid, true);
      assert.equal(v.outputsSigned, true);
    });
  });

  it("real kernel through the chem lens handler (when Cantera is installed)", { skip: !HAVE_KERNEL, timeout: 240000 }, async () => {
    const out = await lensRunChem("equilibrium", { fuel: "CH4", phi: 1, T0: 300, P0: 1 });
    assert.equal(out.ok, true);
    assert.equal(out.result.signed, true, JSON.stringify(out.result.signingReason));
    assert.equal(out.result.saved, true);
    assert.equal(out.result.verdict, "PASS");
    assert.ok(Math.abs(out.result.adiabaticFlameTemperatureK - 2226) <= 25);
    await withReceipts(async (base) => {
      const back = await readBack(base, out.result.receiptId);
      assert.equal(back.reference.value, 2226);
      const v = await verify(base, back);
      assert.equal(v.valid, true);
      assert.equal(v.outputsSigned, true);
    });
  });

  it("no kernel: honest NOT_COMPUTED, unsigned, nothing stored, no invented temperature", { skip: HAVE_KERNEL }, async () => {
    const out = await lensRunChem("equilibrium", { fuel: "CH4", phi: 1, T0: 300, P0: 1 });
    assert.equal(out.ok, true);
    assert.equal(out.result.status, "NOT_COMPUTED");
    assert.equal(out.result.adiabaticFlameTemperatureK, undefined);
    assert.equal(out.result.signed, false);
    assert.match(out.result.signingReason, /^not_computed:/);
    assert.equal(out.result.receiptId, undefined);
    assert.equal(stored(), 0);
  });

  it("off the reference state: signed with a WARN verdict, never a fake PASS", () => {
    const out = applyReceiptDeclaration({
      domain: "chem", action: "equilibrium", inputs: { fuel: "CH4", phi: 0.8, T0: 400, P0: 2 },
      raw: stubComputed({ phi: 0.8, T0: 400, P0: 2, adiabaticFlameTemperatureK: 2000 }), db,
    });
    assert.equal(out.result.signed, true);
    assert.equal(out.result.calcReceipt.verdict.status, "WARN");
  });

  it("a store failure still returns the numbers + signed receipt with saved:false", () => {
    const out = applyReceiptDeclaration({
      domain: "chem", action: "equilibrium", inputs: {}, raw: stubComputed(), db,
      store: () => { throw new Error("disk on fire"); },
    });
    assert.equal(out.ok, true);
    assert.equal(out.result.adiabaticFlameTemperatureK, 2225.4);
    assert.equal(out.result.signed, true);
    assert.equal(out.result.saved, false);
    assert.match(out.result.saveError, /disk on fire/);
    assert.equal(verifyAttestation(out.result.calcReceipt).valid, true);
  });
});

describe("refuse-to-sign reasons", () => {
  it("out of envelope (phi / T0 / P0): numbers returned, unsigned, bound named, no stored row", async () => {
    for (const [input, bound] of [
      [{ fuel: "CH4", phi: 3, T0: 300, P0: 1 }, /phi 3 above 2/],
      [{ fuel: "CH4", phi: 1, T0: 1500, P0: 1 }, /T0 1500 above 1000/],
      [{ fuel: "CH4", phi: 1, T0: 300, P0: 20 }, /P0 20 above 10/],
    ]) {
      const raw = stubComputed({ ...input, adiabaticFlameTemperatureK: 2500 });
      const out = applyReceiptDeclaration({ domain: "chem", action: "equilibrium", inputs: input, raw, db });
      assert.equal(out.result.signed, false);
      assert.match(out.result.signingReason, /^out_of_envelope:/);
      assert.match(out.result.signingReason, bound);
      assert.equal(out.result.adiabaticFlameTemperatureK, 2500);
      assert.equal(out.result.receiptId, undefined);
    }
    assert.equal(stored(), 0);
    // and through the real handler: a solved-or-not-computed answer is unsigned with the same reason
    const live = await lensRunChem("equilibrium", { fuel: "CH4", phi: 3, T0: 300, P0: 1 });
    assert.equal(live.ok, true);
    assert.equal(live.result.signed, false);
    assert.match(live.result.signingReason, /^out_of_envelope:phi/);
    assert.equal(stored(), 0);
  });

  it("insane inputs are rejected by the handler, not solved", async () => {
    const out = await lensRunChem("equilibrium", { fuel: "CH4", phi: 1e6 });
    assert.equal(out.ok, false);
    const bad = await lensRunChem("equilibrium", { fuel: "Xe" });
    assert.equal(bad.ok, false);
  });

  it("no declaration / LLM-backed names are never signed", () => {
    assert.equal(assertCanSign("chem", "calc-ph", {}).reason, "missing_declaration");
    for (const a of ["analyze", "generate", "suggest"]) {
      const d = assertCanSign("chem", a, {});
      assert.equal(d.sign, false, a);
      assert.equal(d.reason, "llm_backed_action", a);
      // even if someone registers a declaration under that name
      registerDeclaration("chem", a, { ...getDeclaration("chem", "equilibrium") });
      assert.equal(assertCanSign("chem", a, {}).sign, false, a);
      unregisterDeclaration("chem", a);
    }
    const raw = { ok: true, result: { pH: 2 } };
    const out = applyReceiptDeclaration({ domain: "chem", action: "calc-ph", inputs: {}, raw, db });
    assert.equal(out.result.signed, false);
    assert.equal(out.result.signingReason, "missing_declaration");
    assert.equal(out.result.receiptId, undefined);
    assert.equal(stored(), 0);
    // other domains' results pass through untouched
    const other = { ok: true, result: { a: 1 } };
    assert.equal(applyReceiptDeclaration({ domain: "welding", action: "x", inputs: {}, raw: other, db }), other);
  });

  it("molecular-weight (no external cited case) is not certifiable: unsigned, missing_declaration", async () => {
    const out = await lensRunChem("molecular-weight", { formula: "H2O" });
    assert.equal(out.ok, true);
    assert.equal(out.result.molecularWeight, 18.015);
    assert.equal(out.result.signed, false);
    assert.equal(out.result.signingReason, "missing_declaration");
    assert.equal(stored(), 0);
  });

  it("incomplete declaration: unsigned incomplete_declaration, never a signature", () => {
    const full = getDeclaration("chem", "equilibrium");
    const cases = {
      noReference: { ...full, reference: undefined, referenceFor: undefined },
      zeroTolerance: { ...full, referenceFor: undefined, reference: { ...full.reference, tolerance: 0 } },
      noRanges: { ...full, envelope: { ...full.envelope, inputRanges: {} } },
      noAssumptions: { ...full, envelope: { ...full.envelope, assumptions: [] } },
      noEnvelope: { ...full, envelope: undefined },
    };
    for (const [name, decl] of Object.entries(cases)) {
      registerDeclaration("chem", "tmp-incomplete", decl);
      try {
        const out = applyReceiptDeclaration({ domain: "chem", action: "tmp-incomplete", inputs: {}, raw: stubComputed(), db });
        assert.equal(out.result.signed, false, name);
        assert.match(out.result.signingReason, /^incomplete_declaration/, name);
        assert.equal(out.result.receiptId, undefined, name);
        assert.equal(out.result.calcReceipt, undefined, name);
      } finally { unregisterDeclaration("chem", "tmp-incomplete"); }
    }
    registerDeclaration("chem", "tmp-uncert", { ...full, certifiable: false });
    assert.equal(assertCanSign("chem", "tmp-uncert", {}).reason, "missing_declaration");
    unregisterDeclaration("chem", "tmp-uncert");
    assert.equal(stored(), 0);
  });
});

describe("engineering.beamStudy persists through the same path", () => {
  const input = { dims: { length: 3000, height: 300, flangeWidth: 150, flangeThickness: 12, webThickness: 8 }, loadN: 20000, support: "simply-supported" };

  it("receiptId reads back and verifies; reference is honestly the closed-form hand check", async () => {
    const solved = solveBeamStudy(input);
    assert.equal(solved.ok, true);
    const out = applyReceiptDeclaration({ domain: "engineering", action: "beamStudy", inputs: input, raw: { ok: true, result: solved.result }, db });
    assert.equal(out.result.signed, true, out.result.signingReason);
    assert.equal(out.result.saved, true);
    assert.match(out.result.receiptId, /^rcpt_/);
    assert.equal(out.result.calcReceipt.receiptId, out.result.receiptId);
    const decl = getDeclaration("engineering", "beamStudy");
    assert.match(decl.reference.case, /hand calculation/);
    assert.doesNotMatch(decl.reference.case, /Turns|handbook|ASME/i);
    await withReceipts(async (base) => {
      const back = await readBack(base, out.result.receiptId);
      const v = await verify(base, back);
      assert.equal(v.valid, true);
      assert.equal(v.outputsSigned, true);
    });
    assert.ok(getStoredReceipt(db, out.result.receiptId));
  });

  it("out-of-envelope load: unsigned, the pre-built signature is stripped, nothing stored", () => {
    const solved = solveBeamStudy(input);
    const bad = { ...input, loadN: 5e10 };
    const out = applyReceiptDeclaration({ domain: "engineering", action: "beamStudy", inputs: bad, raw: { ok: true, result: solved.result }, db });
    assert.equal(out.result.signed, false);
    assert.match(out.result.signingReason, /^out_of_envelope:loadN/);
    assert.equal(out.result.calcReceipt.signature.signature, null);
    assert.equal(stored(), 0);
  });

  it("FEA disagreeing with the hand check is not signed", () => {
    const solved = solveBeamStudy(input);
    const r = JSON.parse(JSON.stringify(solved.result));
    r.calcReceipt.handCheck.agrees = false;
    const out = applyReceiptDeclaration({ domain: "engineering", action: "beamStudy", inputs: input, raw: { ok: true, result: r }, db });
    assert.equal(out.result.signed, false);
    assert.match(out.result.signingReason, /^reference_mismatch/);
    assert.equal(stored(), 0);
  });
});

describe("server.js wiring", () => {
  it("both /api/lens/run registry branches run the hook before shaping", () => {
    const src = fs.readFileSync(new URL("../server.js", import.meta.url), "utf8");
    assert.match(src, /_shapeLensRunHttp\(_applyReceiptDeclaration\(\{ domain, action, inputs: rest, raw: lensRaw, db \}\)\)/);
    assert.match(src, /_shapeLensRunHttp\(_applyReceiptDeclaration\(\{ domain, action, inputs: rest, raw: macroRaw, db \}\)\)/);
  });
});
