// Durable receipt store + public read-by-id (migration 514).
//
// Boardy gap: live chem/beam demo receipts were signed over their outputs
// but never stored, so an id could not be read back. These tests pin the
// store, GET /api/receipts/:id, the demo routes' saved:true + receiptId, the
// chem-lens receipts, idempotency on the digest, and that a store failure
// never fails the solve.
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import http from "node:http";
import Database from "better-sqlite3";
import { up as up514 } from "../migrations/514_receipt_store.js";
import { resetSigningKeyCache, verifyAttestation } from "../lib/receipts/attest.js";
import { buildCalcReceipt } from "../lib/receipts/calc-receipt.js";
import { issueStoredReceipt, storeReceipt, getStoredReceipt, classifyReceiptKey } from "../lib/receipts/store.js";
import createReceiptRouter from "../routes/receipts.js";
import createConkayDemoRouter from "../routes/conkay-demo.js";
import registerChemActions, { withChemReceipt } from "../domains/chem.js";

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

async function withApp(fn, demoStore) {
  const app = express();
  app.use(express.json());
  app.use("/api/conkay/demo", createConkayDemoRouter({ rateLimit: pass, db, store: demoStore }));
  app.use(createReceiptRouter({ readLimit: pass, verifyLimit: pass, db }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { return await fn(base); } finally { await new Promise((r) => server.close(r)); }
}
const getJson = async (url) => { const r = await fetch(url); return { status: r.status, body: await r.json() }; };
const verify = async (base, receipt) => (await fetch(`${base}/api/receipts/verify`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ receipt }),
})).json();

function sampleReceipt() {
  return buildCalcReceipt({
    solver: { id: "test.solver", version: "1" },
    inputs: { x: 2 },
    results: { y: { value: 4, unit: "m" } },
    verdict: { status: "PASS", text: "ok" },
  });
}

describe("receipt store", () => {
  it("round-trips: id and digest both read back the exact signed receipt, and verify passes", async () => {
    const issued = issueStoredReceipt(sampleReceipt(), { db });
    assert.equal(issued.saved, true);
    assert.match(issued.receiptId, /^rcpt_/);
    assert.equal(issued.receipt.receiptId, issued.receiptId, "the id is inside the signed body");
    await withApp(async (base) => {
      const byId = await getJson(`${base}/api/receipts/${issued.receiptId}`);
      assert.equal(byId.status, 200);
      assert.deepEqual(byId.body, JSON.parse(JSON.stringify(issued.receipt)));
      const byDigest = await getJson(`${base}/api/receipts/${issued.receipt.signature.digest}`);
      assert.equal(byDigest.status, 200);
      assert.deepEqual(byDigest.body, byId.body);
      const v = await verify(base, byId.body);
      assert.equal(v.valid, true);
      assert.equal(v.outputsSigned, true);
    });
  });

  it("a tampered stored copy fails verify", async () => {
    const issued = issueStoredReceipt(sampleReceipt(), { db });
    await withApp(async (base) => {
      const { body } = await getJson(`${base}/api/receipts/${issued.receiptId}`);
      body.results.y.value = 5;
      const v = await verify(base, body);
      assert.equal(v.valid, false);
      assert.ok(["digest_mismatch", "bad_signature"].includes(v.reason), v.reason);
      const swapped = JSON.parse(JSON.stringify(body));
      swapped.results.y.value = 4;
      swapped.verdict.status = "FAIL";
      assert.equal((await verify(base, swapped)).valid, false);
    });
  });

  it("unknown id is 404 and malformed ids are 400", async () => {
    await withApp(async (base) => {
      assert.equal((await getJson(`${base}/api/receipts/rcpt_00000000-0000-0000-0000-000000000000`)).status, 404);
      assert.equal((await getJson(`${base}/api/receipts/${"a".repeat(64)}`)).status, 404);
      for (const bad of ["x", "rcpt_%2e%2e%2f%2e%2e", "..%2f..%2fetc", "rcpt_bad id", "a".repeat(200), "rcpt_';drop"]) {
        assert.equal((await getJson(`${base}/api/receipts/${bad}`)).status, 400, bad);
      }
    });
    assert.equal(classifyReceiptKey(""), null);
  });

  it("storing the same signed receipt twice is idempotent on the digest", () => {
    const issued = issueStoredReceipt(sampleReceipt(), { db });
    const again = storeReceipt(db, issued.receipt);
    assert.equal(again.ok, true);
    assert.equal(again.created, false);
    assert.equal(again.receiptId, issued.receiptId);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 1);
  });

  it("an older receipt without a receiptId still verifies and is fetched by digest", async () => {
    const legacy = sampleReceipt();
    assert.equal(legacy.receiptId, undefined);
    const out = storeReceipt(db, legacy);
    assert.equal(out.ok, true);
    assert.equal(out.receiptId, null);
    assert.equal(verifyAttestation(legacy).valid, true);
    assert.deepEqual(getStoredReceipt(db, legacy.signature.digest), JSON.parse(JSON.stringify(legacy)));
  });

  it("refuses to store an unsigned or invalid receipt", () => {
    const unsigned = JSON.parse(JSON.stringify(sampleReceipt()));
    unsigned.signature.signature = null;
    assert.equal(storeReceipt(db, unsigned).ok, false);
    const forged = JSON.parse(JSON.stringify(sampleReceipt()));
    forged.results.y.value = 99;
    assert.match(storeReceipt(db, forged).reason, /^invalid_receipt:/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });

  it("beam demo returns saved:true + receiptId + url, and the id reads back and verifies", async () => {
    const q = "length=4000&height=300&flangeWidth=150&flangeThickness=12&webThickness=8&loadN=20000&support=simply-supported&material=steel-a992";
    await withApp(async (base) => {
      const r = await getJson(`${base}/api/conkay/demo/beam?${q}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.saved, true);
      assert.equal(r.body.receiptUrl, `/api/receipts/${r.body.receiptId}`);
      assert.equal(r.body.result.calcReceipt.receiptId, r.body.receiptId);
      const back = await getJson(`${base}${r.body.receiptUrl}`);
      assert.equal(back.status, 200);
      assert.deepEqual(back.body, r.body.result.calcReceipt);
      const v = await verify(base, back.body);
      assert.equal(v.valid, true);
      assert.equal(v.outputsSigned, true);
    });
  });

  it("a store failure does not fail the solve: result + signed receipt, saved:false + reason", async () => {
    const q = "length=4000&height=300&flangeWidth=150&flangeThickness=12&webThickness=8&loadN=20000&support=simply-supported&material=steel-a992";
    await withApp(async (base) => {
      const r = await getJson(`${base}/api/conkay/demo/beam?${q}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.ok, true);
      assert.equal(r.body.saved, false);
      assert.match(r.body.saveError, /disk on fire/);
      assert.equal(r.body.receiptId, undefined);
      assert.equal(typeof r.body.result.maxStressMPa, "number");
      assert.equal(verifyAttestation(r.body.result.calcReceipt).valid, true);
    }, () => { throw new Error("disk on fire"); });
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, 0);
  });
});

describe("chem lens receipts", () => {
  const ACTIONS = new Map();
  before(() => registerChemActions((d, n, fn) => ACTIONS.set(n, fn)));
  const run = (name, ctx, input) => ACTIONS.get(name)(ctx, { data: input }, input);
  const ctx = () => ({ actor: { userId: "u1" }, userId: "u1", db });

  it("molecular-weight issues a stored v2 receipt that reads back and verifies", async () => {
    const out = run("molecular-weight", ctx(), { formula: "H2O" });
    assert.equal(out.ok, true);
    assert.equal(out.result.molecularWeight, 18.015);
    assert.equal(out.saved, true);
    assert.match(out.receiptId, /^rcpt_/);
    assert.equal(out.receipt.receiptSchema, "concord-calc-receipt/2");
    assert.equal(out.receipt.results.molecularWeight, 18.015);
    await withApp(async (base) => {
      const back = await getJson(`${base}/api/receipts/${out.receiptId}`);
      assert.equal(back.status, 200);
      assert.deepEqual(back.body, JSON.parse(JSON.stringify(out.receipt)));
      const v = await verify(base, back.body);
      assert.equal(v.valid, true);
      assert.equal(v.outputsSigned, true);
    });
  });

  it("molecular-weight signs reference + envelope INSIDE the signed body", () => {
    const out = run("molecular-weight", ctx(), { formula: "H2O" });
    assert.equal(out.signed, true);
    assert.match(out.receipt.reference.source, /IUPAC/);
    assert.equal(out.receipt.reference.value, 18.015);
    assert.ok(out.receipt.reference.tolerance > 0);
    assert.ok(out.receipt.designBasis.validityEnvelope.ranges.totalAtoms);
    assert.ok(out.receipt.assumptions.length >= 1);
    assert.equal(verifyAttestation(out.receipt).valid, true);
    // tampering with the reference breaks the signature
    const t = JSON.parse(JSON.stringify(out.receipt));
    t.reference.value = 19;
    assert.equal(verifyAttestation(t).valid, false);
  });

  it("refuses to sign without a reference + envelope: numbers kept, unsigned, nothing stored", () => {
    const before = db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n;
    for (const [name, input] of [
      ["calc-ph", { concentration: 0.01, kind: "acid" }],
      ["calc-molarity", { moles: 2, liters: 4 }],
      ["calc-gas-law", { P: 1, V: 22.4, T: 273.15 }],
      ["calc-dilution", { m1: 2, v1: 1, m2: 1 }],
    ]) {
      const out = run(name, ctx(), input);
      assert.equal(out.ok, true, name);
      assert.ok(out.result, name);
      assert.equal(out.signed, false, name);
      assert.equal(out.saved, false, name);
      assert.equal(out.reason, "missing_reference", name);
      assert.equal(out.receiptId, undefined, name);
      assert.equal(out.receipt.signature.signature, null, name);
      assert.equal(verifyAttestation(out.receipt).valid, false, name);
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM receipt_store").get().n, before);
  });

  it("withChemReceipt: reference without envelope / envelope without reference / mismatch are unsigned", () => {
    const handler = () => ({ ok: true, result: { x: 1 } });
    const envelope = { ranges: { x: "0..2" }, assumptions: ["a"], check: () => null };
    const reference = () => ({ case: "c", source: "s", value: 1, tolerance: 0.1, reported: 1 });
    const go = (spec) => withChemReceipt("t", handler, { spec })(ctx(), { data: {} }, {});
    assert.equal(go({ reference }).reason, "missing_envelope");
    assert.equal(go({ envelope }).reason, "missing_reference");
    assert.equal(go({ envelope: { ...envelope, assumptions: [] }, reference }).reason, "missing_envelope");
    assert.equal(go({ envelope, reference: () => ({ case: "c", source: "s", value: 1, tolerance: 0, reported: 1 }) }).reason, "malformed_reference");
    assert.match(go({ envelope, reference: () => ({ case: "c", source: "s", value: 1, tolerance: 0.1, reported: 2 }) }).reason, /^reference_mismatch/);
    assert.match(go({ envelope: { ...envelope, check: () => "x_too_big" }, reference }).reason, /^outside_envelope:x_too_big/);
    const ok = go({ envelope, reference });
    assert.equal(ok.signed, true);
    assert.equal(ok.saved, true);
  });

  it("out-of-envelope molecular-weight still computes, unsigned, with a reason and no stored id", () => {
    for (const formula of ["Tc2O7", "UF6Po", "H2O.5H2O", "(H2O", "h2o"]) {
      const out = run("molecular-weight", ctx(), { formula });
      if (!out.ok) continue; // parser rejected: no number, nothing to sign
      assert.equal(out.signed, false, formula);
      assert.match(out.reason, /^outside_envelope:/, formula);
      assert.equal(out.receiptId, undefined, formula);
      assert.equal(out.receipt.signature.signature, null, formula);
    }
    const tc = run("molecular-weight", ctx(), { formula: "NaTcO4" });
    assert.equal(tc.ok, true);
    assert.equal(typeof tc.result.molecularWeight, "number");
    assert.equal(tc.signed, false);
    assert.match(tc.reason, /no_standard_atomic_weight:Tc/);
    assert.equal(getStoredReceipt(db, tc.receipt.receiptId || "rcpt_00000000"), null);
  });

  it("other pure compute actions: legacy expectations replaced by unsigned (kept for failure/error shape)", () => {
    for (const [name, input] of [
      ["calc-ph", { concentration: 0.01, kind: "acid" }],
      ["calc-molarity", { moles: 2, liters: 4 }],
      ["calc-gas-law", { P: 1, V: 22.4, T: 273.15 }],
      ["calc-dilution", { m1: 2, v1: 1, m2: 1 }],
    ]) {
      const out = run(name, ctx(), input);
      assert.equal(out.ok, true, name);
      assert.equal(out.saved, false, name);
    }
    const bad = run("molecular-weight", ctx(), { formula: "" });
    assert.equal(bad.ok, false);
    assert.equal(bad.receipt, undefined);
  });

  it("a store failure still returns the numbers and the signed receipt, saved:false", () => {
    const broken = { actor: { userId: "u1" }, userId: "u1", db: { prepare() { throw new Error("db locked"); } } };
    const out = run("molecular-weight", broken, { formula: "H2O" });
    assert.equal(out.ok, true);
    assert.equal(out.result.molecularWeight, 18.015);
    assert.equal(out.saved, false);
    assert.match(out.saveError, /db locked/);
    assert.equal(verifyAttestation(out.receipt).valid, true);
  });
});
