// REC-INT-01: no signature without a declaration, on every path.
// MCP run_lens_action + conkay_solve and the conkay-demo calc routes all go
// through lib/receipts/declarations.js. Each refusal still returns the numbers.
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import Database from "better-sqlite3";
import { up as up514 } from "../migrations/514_receipt_store.js";
import { resetSigningKeyCache, verifyAttestation } from "../lib/receipts/attest.js";
import { solveBeamStudy } from "../domains/engineering.js";
import { applyEnvelopeDeclaration } from "../lib/receipts/declarations.js";
import { HERMES_USER_ID, HERMES_BRIDGE_DEFAULT_SCOPES } from "../lib/mcp-hermes-identity.js";
import { runLensActionMcp, conkaySolveMcp } from "../lib/mcp-execution-bridge.js";
import createConkayDemoRouter from "../routes/conkay-demo.js";

const ENV_KEYS = ["CONCORD_RECEIPT_SIGNING_KEY", "CONCORD_RECEIPT_SIGNING_KEY_PATH", "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS"];
const HERMES = { id: HERMES_USER_ID, userId: HERMES_USER_ID, role: "sovereign", scopes: [...HERMES_BRIDGE_DEFAULT_SCOPES] };
const BEAM = { dims: { length: 3000, height: 300, flangeWidth: 150, flangeThickness: 12, webThickness: 8 }, loadN: 20000, support: "simply-supported" };
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

describe("MCP run_lens_action goes through the declaration gate", () => {
  before(() => {
    const lens = new Map();
    lens.set("engineering.beamStudy", async (_c, _a, input) => solveBeamStudy(input));
    lens.set("physics.power", async (_c, _a, input) => ({ ok: true, result: { watts: Number(input.v) * Number(input.i) } }));
    globalThis.__concordLensActions = lens;
    globalThis.__concordRunMacro = async (d, n) => { throw new Error(`macro not found: ${d}.${n}`); };
    globalThis._concordMACROS = new Map([["engineering", new Map([["beamStudy", {}]])], ["physics", new Map([["power", {}]])]]);
  });
  after(() => {
    delete globalThis.__concordLensActions; delete globalThis.__concordRunMacro; delete globalThis._concordMACROS;
  });
  const call = (domain, action, params) => runLensActionMcp(db, { domain, action, params }, null, { actor: HERMES });

  it("declared action in envelope -> signed, stored, and verifies", async () => {
    const r = await call("engineering", "beamStudy", BEAM);
    assert.equal(r.ok, true, r.error || r.reason);
    assert.equal(r.signed, true);
    assert.equal(r.signingReason, undefined);
    assert.equal(r.result.result.signed, true);
    assert.equal(verifyAttestation(r.result.result.calcReceipt).valid, true);
    assert.match(r.result.result.receiptId, /^rcpt_/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 1);
  });

  it("undeclared action -> unsigned missing_declaration, numbers still returned, nothing stored", async () => {
    const r = await call("physics", "power", { v: 12, i: 3 });
    assert.equal(r.ok, true);
    assert.equal(r.signed, false);
    assert.equal(r.signingReason, "missing_declaration");
    assert.equal(r.result.result.watts, 36);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });

  it("declared action with out-of-envelope inputs -> unsigned out_of_envelope, numbers returned, receipt signature stripped", async () => {
    const r = await call("engineering", "beamStudy", { ...BEAM, loadN: 5e9 });
    assert.equal(r.ok, true, r.error || r.reason);
    assert.equal(r.signed, false);
    assert.match(r.signingReason, /^out_of_envelope:loadN/);
    assert.equal(typeof r.result.result.maxStressMPa, "number");
    assert.equal(r.result.result.calcReceipt.signature.signature, null);
    assert.equal(verifyAttestation(r.result.result.calcReceipt).valid, false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });
});

describe("MCP conkay_solve envelopes go through the declaration gate", () => {
  const IR = {
    design: { id: "b", name: "b" }, materials: { "astm-a325": { costPerKgUsd: "4 USD/kg", source: "t" } },
    nodes: [
      { id: "A1", kind: "Assembly", name: "B" },
      { id: "P1", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
      { id: "P2", kind: "Plate", material: "steel-a36", geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
      { id: "B1", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "40 mm" } },
      { id: "B2", kind: "Bolt", material: "astm-a325", geometry: { shape: "bolt", diameter: "20 mm", length: "40 mm" } },
      { id: "J1", kind: "Joint", name: "S", props: { shearPlanes: 1 } },
    ],
    edges: [...["P1", "P2", "B1", "B2", "J1"].map((to) => ({ type: "CONTAINS", from: "A1", to })), ...["P1", "P2", "B1", "B2"].map((to) => ({ type: "CONTAINS", from: "J1", to }))],
    loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "40 kN" }] }], requirements: [],
  };

  it("a solver with no declaration (joint.bolt-shear) -> numbers returned, unsigned missing_declaration, no receipt", async () => {
    const r = await conkaySolveMcp(db, { solver_id: "joint.bolt-shear", ir: IR, target: "J1" }, null, { actor: HERMES });
    assert.equal(r.ok, true, r.error || r.reason);
    assert.ok(r.results.length >= 1);
    for (const x of r.results) {
      assert.equal(x.signed, false);
      assert.equal(x.signingReason, "missing_declaration");
      assert.equal(x.calcReceipt, null);
      assert.equal(x.receipt, null);
      assert.ok(x.outputs && Object.keys(x.outputs).length > 0);
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });

  const chemEnv = (over = {}, inputOver = {}) => ({
    runId: "r1", status: "WARN", target: "CMB", solver: { id: "chem.equilibrium", version: "1.0.0", method: "Cantera HP" },
    inputs: {
      mechanism: { value: "gri30.yaml" }, fuel: { value: "CH4" }, oxidizer: { value: "O2:1, N2:3.76" },
      equivalenceRatio: { value: 1 }, initialTemperature: { value: 300, unit: "K" }, initialPressure: { value: 101325, unit: "Pa" }, ...inputOver,
    },
    outputs: { adiabaticFlameTemperature: { value: 2225.4, unit: "K" }, majorProducts: { value: [{ species: "N2", moleFraction: 0.7 }] } },
    assumptions: ["ideal gas"], ...over,
  });

  it("a declared solver in envelope (chem.equilibrium) -> signed, stored, verifies", () => {
    const g = applyEnvelopeDeclaration(chemEnv(), { db });
    assert.equal(g.signed, true, g.signingReason);
    assert.equal(g.saved, true);
    assert.equal(verifyAttestation(g.calcReceipt).valid, true);
    assert.equal(g.calcReceipt.reference.value, 2226);
  });

  it("declared solver, out-of-envelope inputs -> unsigned out_of_envelope", () => {
    const g = applyEnvelopeDeclaration(chemEnv({}, { equivalenceRatio: { value: 7 } }), { db });
    assert.equal(g.signed, false);
    assert.match(g.signingReason, /^out_of_envelope:phi/);
    assert.equal(g.calcReceipt, null);
  });

  it("declared solver, a case the declaration cannot adapt (other oxidizer) -> unsigned", () => {
    const g = applyEnvelopeDeclaration(chemEnv({}, { oxidizer: { value: "O2:1" } }), { db });
    assert.equal(g.signed, false);
    assert.match(g.signingReason, /^out_of_envelope:envelope_not_adaptable/);
  });

  it("declared solver that did not compute -> unsigned not_computed", () => {
    const g = applyEnvelopeDeclaration(chemEnv({ status: "NOT_COMPUTED", outputs: {}, reason: "no kernel" }), { db });
    assert.equal(g.signed, false);
    assert.match(g.signingReason, /^not_computed:/);
  });

  it("garbage / missing envelopes never sign and never throw", () => {
    for (const bad of [null, undefined, {}, { solver: "x" }, { solver: { id: "nope" } }]) {
      const g = applyEnvelopeDeclaration(bad, { db });
      assert.equal(g.signed, false);
    }
  });
});

describe("conkay-demo routes go through the declaration gate", () => {
  async function withApp(fn) {
    const app = express();
    app.use("/api/conkay/demo", createConkayDemoRouter({ db }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    try { return await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((r) => server.close(r)); }
  }
  const Q = "length=4000&height=300&flangeWidth=150&flangeThickness=12&webThickness=8&support=simply-supported&material=steel-a992";
  const get = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.json().catch(() => null), text: null }; };

  it("GET /beam in envelope -> signed, stored, verifies", async () => {
    await withApp(async (base) => {
      const r = await get(`${base}/api/conkay/demo/beam?${Q}&loadN=20000`);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.saved, true);
      assert.equal(r.body.result.signed, true);
      assert.equal(verifyAttestation(r.body.result.calcReceipt).valid, true);
    });
  });

  it("GET /beam out of envelope -> numbers returned, unsigned out_of_envelope, nothing stored", async () => {
    await withApp(async (base) => {
      const r = await get(`${base}/api/conkay/demo/beam?${Q}&loadN=5000000000`);
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.saved, false);
      assert.equal(r.body.result.signed, false);
      assert.match(r.body.result.signingReason, /^out_of_envelope:loadN/);
      assert.equal(typeof r.body.result.maxStressMPa, "number");
      assert.equal(r.body.result.calcReceipt.signature.signature, null);
      assert.equal(verifyAttestation(r.body.result.calcReceipt).valid, false);
    });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });

  it("GET /beam/sheet never stores, and carries no live signature when refused", async () => {
    await withApp(async (base) => {
      const ok = await fetch(`${base}/api/conkay/demo/beam/sheet?${Q}&loadN=20000`);
      assert.equal(ok.status, 200);
      assert.match(await ok.text(), /Signature check: <strong>VALID/);
      const bad = await fetch(`${base}/api/conkay/demo/beam/sheet?${Q}&loadN=5000000000`);
      assert.equal(bad.status, 200);
      const badHtml = await bad.text();
      assert.match(badHtml, /Signature check: <strong>INVALID/);
      assert.doesNotMatch(badHtml, /Signature check: <strong>VALID/);
    });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });
});
