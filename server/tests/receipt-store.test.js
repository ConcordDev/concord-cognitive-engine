// Durable receipt store + public read-by-id (migration 514).
//
// Boardy gap: live chem/beam demo receipts were signed over their outputs
// but never stored, so an id could not be read back. These tests pin the
// store, GET /api/receipts/:id, the demo routes' saved:true + receiptId, the
// chem-lens receipts (now in receipt-declarations.test.js), idempotency on the digest, and that a store failure
// never fails the solve.
import { describe, it, beforeEach, afterEach } from "node:test";
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
