// Receipt attestation: sign, tamper, unsigned mode, public keys, verify route.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  attestReceipt,
  canonicalJson,
  publicKeyDocument,
  resetSigningKeyCache,
  verifyAttestation,
} from "../lib/receipts/attest.js";
import { checkRateLimit, LIMITS } from "../rateLimit.js";
import createReceiptRouter from "../routes/receipts.js";
import createConkayDemoRouter from "../routes/conkay-demo.js";
import { buildAnalysisReceipt } from "../lib/conkay/beam-study.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = path.join(__dirname, "../server.js");

const ENV_KEYS = [
  "CONCORD_RECEIPT_SIGNING_KEY",
  "CONCORD_RECEIPT_SIGNING_KEY_PATH",
  "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS",
];

function freshKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const der = publicKey.export({ format: "der", type: "spki" });
  const raw = Buffer.from(der.subarray(der.length - 32));
  return { privateKey, pem, raw, pkcs8: privateKey.export({ type: "pkcs8", format: "der" }) };
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

beforeEach(() => clearKey());
afterEach(() => clearKey());

function listen(app) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        port,
        close: () => new Promise((res, rej) => server.close((err) => (err ? rej(err) : res()))),
      });
    });
    server.on("error", reject);
  });
}

async function getJson(port, pathname) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

async function postJson(port, pathname, body) {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { status: res.status, text, body: parsed };
}

describe("canonical JSON", () => {
  it("sorts object keys and keeps array order", () => {
    assert.equal(canonicalJson({ b: 1, a: { d: true, c: [2, 1] } }), '{"a":{"c":[2,1],"d":true},"b":1}');
  });
});

describe("attest and verify", () => {
  it("round-trips through JSON and verifies", () => {
    const { pem } = freshKey();
    useKey(pem);
    const signed = attestReceipt({ solver: "fea-solver@5.0.0", n: 1, note: undefined });
    assert.equal(typeof signed.issuedAt, "string");
    assert.match(signed.signature.digest, /^[0-9a-f]{64}$/);
    assert.equal(signed.signature.keyId.length, 16);
    assert.equal(typeof signed.signature.signature, "string");
    assert.equal(signed.signature.reason, null);
    const again = JSON.parse(JSON.stringify(signed));
    const verdict = verifyAttestation(again);
    assert.deepEqual(verdict, { valid: true, reason: null, keyId: signed.signature.keyId, digest: signed.signature.digest });
  });

  it("a changed field, a changed digest, or a wrong keyId fails", () => {
    const { pem } = freshKey();
    useKey(pem);
    const signed = attestReceipt({ solver: "beam", loadN: 20 });
    const field = { ...signed, loadN: 21 };
    assert.equal(verifyAttestation(field).valid, false);
    assert.equal(verifyAttestation(field).reason, "digest_mismatch");

    const digest = { ...signed, signature: { ...signed.signature, digest: "ab".repeat(32) } };
    assert.equal(verifyAttestation(digest).reason, "digest_mismatch");

    const keyId = { ...signed, signature: { ...signed.signature, keyId: "0123456789abcdef" } };
    assert.equal(verifyAttestation(keyId).reason, "unknown_key");
  });

  it("updates the digest to match a tampered field and still rejects the signature", () => {
    const { pem } = freshKey();
    useKey(pem);
    const signed = attestReceipt({ solver: "beam", loadN: 20 });
    const tampered = { ...signed, loadN: 99 };
    const { signature: block, ...body } = tampered;
    tampered.signature = { ...block, digest: crypto.createHash("sha256").update(canonicalJson(body)).digest("hex") };
    assert.equal(verifyAttestation(tampered).reason, "bad_signature");
  });

  it("is unsigned, with a reason, when no key is configured", () => {
    clearKey();
    const signed = attestReceipt({ solver: "beam", loadN: 1 });
    assert.equal(signed.signature.signature, null);
    assert.equal(signed.signature.keyId, null);
    assert.equal(signed.signature.reason, "no_signing_key");
    assert.match(signed.signature.digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(verifyAttestation(signed), { valid: false, reason: "no_signing_key" });
  });

  it("loads the key from a file path and does not sign with a broken key", () => {
    const { pem } = freshKey();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-key-"));
    const file = path.join(dir, "key.pem");
    fs.writeFileSync(file, pem, { mode: 0o600 });
    delete process.env.CONCORD_RECEIPT_SIGNING_KEY;
    process.env.CONCORD_RECEIPT_SIGNING_KEY_PATH = file;
    resetSigningKeyCache();
    const signed = attestReceipt({ ok: true });
    assert.equal(verifyAttestation(JSON.parse(JSON.stringify(signed))).valid, true);

    process.env.CONCORD_RECEIPT_SIGNING_KEY = "not-a-pem";
    delete process.env.CONCORD_RECEIPT_SIGNING_KEY_PATH;
    resetSigningKeyCache();
    const bad = attestReceipt({ ok: true });
    assert.equal(bad.signature.signature, null);
    assert.equal(bad.signature.reason, "signing_key_invalid");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("signs an analysis receipt the beam study returns", () => {
    const { pem } = freshKey();
    useKey(pem);
    const receipt = buildAnalysisReceipt({
      dims: { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 },
      material: { E: 200000, yield: 345 },
      support: "simply-supported",
      loadN: 200000,
      segments: 8,
    });
    assert.equal(receipt.solver.startsWith("fea-solver@"), true);
    assert.equal(verifyAttestation(JSON.parse(JSON.stringify(receipt))).valid, true);
  });
});

describe("public key document", () => {
  it("publishes the raw public key and never the private key", () => {
    const { pem, pkcs8, raw } = freshKey();
    useKey(pem);
    const doc = publicKeyDocument();
    const text = JSON.stringify(doc);
    assert.equal(text.includes("PRIVATE"), false);
    assert.equal(text.includes("BEGIN"), false);
    assert.equal(text.includes(pkcs8.toString("base64")), false);
    const pemBody = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    assert.equal(text.includes(pemBody), false);
    const [keyId, pub] = Object.entries(doc.keys)[0];
    assert.equal(pub, raw.toString("base64"));
    assert.equal(keyId, crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16));
    assert.deepEqual(Object.keys(doc).sort(), ["alg", "canon", "keys"]);
  });
});

describe("HTTP verify and well-known", () => {
  it("serves keys and verifies without an Authorization header, and rate-limits the route", async () => {
    const { pem, pkcs8 } = freshKey();
    useKey(pem);
    let hits = 0;
    const limit = (_req, res, next) => {
      hits += 1;
      if (hits > 1) return res.status(429).json({ error: "Rate limit exceeded", retryAfter: 1 });
      next();
    };
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    app.use(createReceiptRouter({ readLimit: (_req, _res, next) => next(), verifyLimit: limit }));
    const srv = await listen(app);
    try {
      const keys = await getJson(srv.port, "/.well-known/concord-receipt-keys.json");
      assert.equal(keys.status, 200);
      assert.equal(keys.text.includes("PRIVATE"), false);
      assert.equal(keys.text.includes(pkcs8.toString("base64")), false);
      assert.equal(keys.text.includes("BEGIN"), false);
      assert.equal(Object.keys(keys.body.keys).length, 1);

      const signed = attestReceipt({ job: "car", n: 3 });
      const ok = await postJson(srv.port, "/api/receipts/verify", { receipt: signed });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.valid, true);
      assert.equal(ok.body.reason, null);

      const bare = await postJson(srv.port, "/api/receipts/verify", signed);
      assert.equal(bare.status, 429);
      assert.equal(bare.body.error, "Rate limit exceeded");
    } finally {
      await srv.close();
    }
  });

  it("the verify bucket is a real per-caller limit, and server.js leaves the route public", () => {
    const bucket = LIMITS["write.receipt-verify"];
    const read = LIMITS["read.receipt-keys"];
    assert.equal(bucket.windowMs, 60000);
    assert.ok(bucket.max > 0 && bucket.max <= 120);
    assert.equal(read.windowMs, 60000);
    assert.ok(read.max > 0 && read.max <= 600);
    const id = `receipt-verify-${crypto.randomBytes(8).toString("hex")}`;
    for (let i = 0; i < bucket.max; i++) {
      assert.equal(checkRateLimit(id, "write.receipt-verify").allowed, true);
    }
    const blocked = checkRateLimit(id, "write.receipt-verify");
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter > 0);

    const src = fs.readFileSync(SERVER_JS, "utf8");
    assert.match(src, /req\.path === "\/api\/receipts\/verify"/);
    assert.match(src, /"\/\.well-known\/concord-receipt-keys\.json"/);
    assert.match(src, /perEndpointRateLimit\("write\.receipt-verify"\)/);
    assert.match(src, /perEndpointRateLimit\("read\.receipt-keys"\)/);
    const allow = src.match(/const WRITE_AUTH_PUBLIC_PATHS = \[([^\]]*)\]/);
    assert.ok(allow);
    assert.equal(allow[1].includes("/api/receipts"), false);
  });
});

describe("conkay demo design responses", () => {
  it("signs /designs/car and a changed field no longer verifies", async () => {
    const { pem } = freshKey();
    useKey(pem);
    const app = express();
    app.use("/api/conkay/demo", createConkayDemoRouter({ rateLimit: (_req, _res, next) => next() }));
    const srv = await listen(app);
    try {
      const res = await getJson(srv.port, "/api/conkay/demo/designs/car");
      assert.equal(res.status, 200);
      assert.equal(res.body.design.id, "car");
      assert.equal(verifyAttestation(res.body.design).valid, true);
      const again = await getJson(srv.port, "/api/conkay/demo/designs/car");
      assert.equal(again.body.design.issuedAt, res.body.design.issuedAt);
      assert.equal(again.body.design.signature.signature, res.body.design.signature.signature);
      assert.equal(verifyAttestation(again.body.design).valid, true);
      res.body.design.headline = { ...res.body.design.headline, verdict: "edited" };
      assert.equal(verifyAttestation(res.body.design).valid, false);
      assert.equal(verifyAttestation(res.body.design).reason, "digest_mismatch");
    } finally {
      await srv.close();
    }
  });
});

describe("keygen script", () => {
  it("writes a private key and prints only the public key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "receipt-gen-"));
    const file = path.join(dir, "receipt-signing-key.pem");
    const script = path.join(__dirname, "../../scripts/generate-receipt-signing-key.mjs");
    const run = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout.includes("PRIVATE"), false);
    assert.equal(run.stdout.includes("BEGIN"), false);
    assert.match(run.stdout, /keyId: [0-9a-f]{16}/);
    assert.match(run.stdout, /publicKey: [A-Za-z0-9+/]+=*/);
    const mode = fs.statSync(file).mode & 0o777;
    assert.equal(mode, 0o600);
    const again = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    assert.equal(again.status, 1);
    const pem = fs.readFileSync(file, "utf8");
    assert.match(pem, /BEGIN PRIVATE KEY/);
    delete process.env.CONCORD_RECEIPT_SIGNING_KEY;
    process.env.CONCORD_RECEIPT_SIGNING_KEY_PATH = file;
    resetSigningKeyCache();
    const signed = attestReceipt({ from: "script" });
    assert.equal(verifyAttestation(signed).valid, true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
