// Self-contained receipts (/3 `verification` block), public receipt access past the
// bot/UA filter, and the offline verifier (scripts/verify-receipt.mjs).
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import { attestReceipt, resetSigningKeyCache, verifyAttestation } from "../lib/receipts/attest.js";
import { buildCalcReceipt, CALC_RECEIPT_SCHEMA, receiptBaseUrl } from "../lib/receipts/calc-receipt.js";
import { issueStoredReceipt } from "../lib/receipts/store.js";
import createReceiptRouter from "../routes/receipts.js";
import createConkayDemoRouter from "../routes/conkay-demo.js";
import { verifyReceiptOffline } from "../../scripts/verify-receipt.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(__dirname, "fixtures/receipts");
const SCRIPT = path.join(__dirname, "../../scripts/verify-receipt.mjs");
const SERVER_JS = path.join(__dirname, "../server.js");
const readFix = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

const ENV = ["CONCORD_RECEIPT_SIGNING_KEY", "CONCORD_RECEIPT_SIGNING_KEY_PATH", "CONCORD_RECEIPT_EXTRA_PUBLIC_KEYS", "PUBLIC_BASE_URL"];
function useFreshKey() {
  const { privateKey } = crypto.generateKeyPairSync("ed25519");
  delete process.env.CONCORD_RECEIPT_SIGNING_KEY_PATH;
  process.env.CONCORD_RECEIPT_SIGNING_KEY = privateKey.export({ type: "pkcs8", format: "pem" });
  resetSigningKeyCache();
}
beforeEach(() => { process.env.PUBLIC_BASE_URL = "https://receipts.example.test"; useFreshKey(); });
afterEach(() => { for (const k of ENV) delete process.env[k]; resetSigningKeyCache(); });

const PARTS = {
  solver: "fea-solver@5.0.0", inputs: { loadN: 200000 },
  results: { maxStressMPa: { value: 286.4, unit: "MPa" } }, verdict: { status: "PASS" },
};

function listen(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, "127.0.0.1", () => resolve({ port: srv.address().port, close: () => new Promise((r) => srv.close(r)) }));
  });
}
function request(port, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, method, path: p, headers: { ...headers, ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let t = ""; res.on("data", (c) => (t += c));
      res.on("end", () => { let j = null; try { j = JSON.parse(t); } catch { /* not json */ } resolve({ status: res.statusCode, body: j, text: t }); });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

describe("v3 receipt carries a signed verification block", () => {
  it("has absolute verify/public-key URLs, alg, canon, keyId, howTo and the /3 schema", () => {
    const r = buildCalcReceipt(PARTS);
    assert.equal(r.receiptSchema, CALC_RECEIPT_SCHEMA);
    assert.equal(r.receiptSchema, "concord-calc-receipt/3");
    const v = r.verification;
    assert.equal(v.verifyUrl, "https://receipts.example.test/api/receipts/verify");
    assert.equal(v.publicKeysUrl, "https://receipts.example.test/.well-known/concord-receipt-keys.json");
    assert.equal(v.alg, "Ed25519");
    assert.equal(v.canon, "sorted-json-v1");
    assert.equal(v.keyId, r.signature.keyId);
    assert.match(v.howTo, /sorted-json-v1/);
    assert.match(v.howTo, /Ed25519/);
    assert.equal(v.fetchUrl, undefined, "no id yet, so no fetchUrl is claimed");
    assert.equal(verifyAttestation(clone(r)).valid, true);
  });

  it("every verification field is covered by the signature (tamper -> digest_mismatch)", () => {
    const r = buildCalcReceipt(PARTS);
    for (const field of ["verifyUrl", "publicKeysUrl", "alg", "canon", "keyId", "howTo"]) {
      const t = clone(r);
      t.verification[field] = field === "verifyUrl" ? "https://evil.example/api/receipts/verify" : "tampered";
      const v = verifyAttestation(t);
      assert.equal(v.valid, false, field);
      assert.equal(v.reason, "digest_mismatch", field);
    }
    const stripped = clone(r);
    delete stripped.verification;
    assert.equal(verifyAttestation(stripped).reason, "digest_mismatch");
  });

  it("a stored receipt names its own fetchUrl by receiptId inside the signed bytes", () => {
    const issued = issueStoredReceipt(buildCalcReceipt(PARTS), { store: () => ({ ok: true }) });
    const r = clone(issued.receipt);
    assert.match(r.receiptId, /^rcpt_/);
    assert.equal(r.verification.fetchUrl, `https://receipts.example.test/api/receipts/${r.receiptId}`);
    assert.equal(r.verification.verifyUrl, "https://receipts.example.test/api/receipts/verify");
    assert.equal(verifyAttestation(r).valid, true);
    r.verification.fetchUrl = "https://evil.example/x";
    assert.equal(verifyAttestation(r).reason, "digest_mismatch");
  });

  it("an existing /2 receipt (no verification block) still verifies unchanged", () => {
    const keys = readFix("keys.json");
    const v2 = readFix("receipt-v2.json");
    assert.equal(v2.receiptSchema, "concord-calc-receipt/2");
    assert.equal(v2.verification, undefined);
    const v = verifyAttestation(v2, keys.keys);
    assert.equal(v.valid, true);
    assert.equal(v.schema, "concord-calc-receipt/2");
    assert.equal(v.outputsSigned, true);
    const t = clone(v2); t.results.maxStressMPa.value = 1;
    assert.equal(verifyAttestation(t, keys.keys).reason, "digest_mismatch");
  });
});

describe("base URL comes from config, never the Host header", () => {
  it("PUBLIC_BASE_URL is used (trailing slash stripped); unset or junk falls back to the production default", () => {
    process.env.PUBLIC_BASE_URL = "https://a.example.test///";
    assert.equal(receiptBaseUrl(), "https://a.example.test");
    delete process.env.PUBLIC_BASE_URL;
    assert.equal(receiptBaseUrl(), "https://concord-os.org");
    process.env.PUBLIC_BASE_URL = "javascript:alert(1)";
    assert.equal(receiptBaseUrl(), "https://concord-os.org");
  });

  it("a spoofed Host / X-Forwarded-Host on the request does not change the signed URLs", async () => {
    const app = express();
    app.use("/api/conkay/demo", createConkayDemoRouter({ rateLimit: (_q, _s, n) => n(), store: () => ({ ok: true }) }));
    const srv = await listen(app);
    try {
      const res = await request(srv.port, "GET", "/api/conkay/demo/beam?length=4000&height=300&flangeWidth=150&flangeThickness=12&webThickness=8&loadN=20000&support=simply-supported&material=steel-a992", { headers: { Host: "evil.example", "X-Forwarded-Host": "evil.example" } });
      assert.equal(res.status, 200);
      const r = res.body.result.calcReceipt;
      assert.equal(r.receiptSchema, "concord-calc-receipt/3");
      assert.equal(r.verification.verifyUrl, "https://receipts.example.test/api/receipts/verify");
      assert.ok(r.verification.fetchUrl.startsWith("https://receipts.example.test/api/receipts/rcpt_"));
      assert.equal(res.text.includes("evil.example"), false);
      assert.equal(verifyAttestation(r).valid, true);
    } finally { await srv.close(); }
  });
});

describe("public receipt access", () => {
  const CURL = { "User-Agent": "curl/8.7.1" };
  const PYREQ = { "User-Agent": "python-requests/2.31.0" };

  it("the real bot guard (server.js source) lets receipt routes through for curl/python-requests but still blocks other routes", () => {
    const src = fs.readFileSync(SERVER_JS, "utf8");
    const grab = (re, what) => { const m = src.match(re); assert.ok(m, `server.js missing ${what}`); return m[0]; };
    const code = [
      grab(/const _BOT_UA_RE = .*;/, "_BOT_UA_RE"),
      grab(/const _RECEIPT_PUBLIC_RE = .*;/, "_RECEIPT_PUBLIC_RE"),
      grab(/function botGuardMiddleware\(req, res, next\) \{[\s\S]*?\n\}\n/, "botGuardMiddleware"),
      "botGuardMiddleware;",
    ].join("\n");
    const guard = vm.runInNewContext(code, {
      _HEALTH_PROBE_RE: /^\/health/, _AP_PUBLIC_RE: /^\/never$/, INGEST_WEBHOOK_RE: /^\/never$/, DEBUG_INGEST_RE: /^\/never$/,
    });
    const run = (method, p, ua, user) => {
      let status = 200, nexted = false;
      guard({ method, path: p, user, headers: ua === undefined ? {} : { "user-agent": ua } },
        { status(s) { status = s; return { json() {} }; } }, () => { nexted = true; });
      return nexted ? 200 : status;
    };
    const id = "rcpt_0b0f5d86-3f7d-4b8c-9b0e-111111111111";
    for (const ua of ["curl/8.7.1", "python-requests/2.31.0", "Wget/1.21", ""]) {
      assert.equal(run("GET", `/api/receipts/${id}`, ua), 200, `fetch ${ua}`);
      assert.equal(run("GET", "/api/receipts/keys", ua), 200, `keys ${ua}`);
      assert.equal(run("POST", "/api/receipts/verify", ua), 200, `verify ${ua}`);
    }
    // Negative controls: only the exact receipt shapes are exempt.
    assert.equal(run("GET", "/api/dtus", "curl/8.7.1"), 403);
    assert.equal(run("GET", "/api/receipts/sheet", "curl/8.7.1"), 403);
    assert.equal(run("POST", "/api/receipts/sheet", "curl/8.7.1"), 403);
    assert.equal(run("POST", `/api/receipts/${id}`, "curl/8.7.1"), 403);
    assert.equal(run("GET", "/api/receipts/keys/extra", "curl/8.7.1"), 403);
    assert.equal(run("GET", "/api/receipts/../auth/me", "python-requests/2.31.0"), 403);
  });

  it("auth gate in server.js lets anonymous GET /api/receipts/keys through (it was 401 AUTH_REQUIRED)", () => {
    const src = fs.readFileSync(SERVER_JS, "utf8");
    const m = src.match(/req\.method === "GET" && (\/\^\\\/api\\\/receipts[^\n]*?\/)\.test\(req\.path\)\) return next\(\);/);
    assert.ok(m, "receipts GET bypass present");
    const lit = m[1];
    const lastSlash = lit.lastIndexOf("/");
    const re = new RegExp(lit.slice(1, lastSlash), lit.slice(lastSlash + 1));
    assert.ok(re.test("/api/receipts/keys"));
    assert.ok(re.test("/api/receipts/rcpt_0b0f5d86-3f7d-4b8c-9b0e-111111111111"));
    assert.equal(re.test("/api/receipts/keys/x"), false);
    assert.equal(re.test("/api/receipts/sheet"), false);
  });

  it("anonymous GET fetch, GET keys and POST verify work with curl/python UAs; /keys equals the .well-known doc; /keys is not read as a receipt id", async () => {
    const stored = issueStoredReceipt(buildCalcReceipt(PARTS), { store: () => ({ ok: true }) });
    const db = { prepare: () => ({ get: () => ({ receipt_json: JSON.stringify(stored.receipt) }) }) };
    const app = express();
    app.use(express.json());
    app.use(createReceiptRouter({ db }));
    const srv = await listen(app);
    try {
      for (const h of [CURL, PYREQ]) {
        const f = await request(srv.port, "GET", `/api/receipts/${stored.receiptId}`, { headers: h });
        assert.equal(f.status, 200);
        assert.equal(f.body.receiptId, stored.receiptId);
        const k = await request(srv.port, "GET", "/api/receipts/keys", { headers: h });
        assert.equal(k.status, 200);
        const wk = await request(srv.port, "GET", "/.well-known/concord-receipt-keys.json", { headers: h });
        assert.deepEqual(k.body, wk.body);
        assert.ok(k.body.keys[stored.receipt.signature.keyId]);
        const v = await request(srv.port, "POST", "/api/receipts/verify", { headers: h, body: f.body });
        assert.equal(v.status, 200);
        assert.equal(v.body.valid, true);
      }
      const tampered = clone(stored.receipt); tampered.verification.verifyUrl = "https://evil.example/v";
      const bad = await request(srv.port, "POST", "/api/receipts/verify", { headers: CURL, body: tampered });
      assert.equal(bad.body.valid, false);
      assert.equal(bad.body.reason, "digest_mismatch");
    } finally { await srv.close(); }
  });

  it("rate limiting still applies to fetch, keys and verify", async () => {
    const mk = (n) => { let hits = 0; return (_q, res, next) => (++hits > n ? res.status(429).json({ error: "Rate limit exceeded" }) : next()); };
    const app = express();
    app.use(express.json());
    app.use(createReceiptRouter({ readLimit: mk(1), verifyLimit: mk(1), db: { prepare: () => ({ get: () => undefined }) } }));
    const srv = await listen(app);
    try {
      assert.equal((await request(srv.port, "GET", "/api/receipts/keys", { headers: CURL })).status, 200);
      assert.equal((await request(srv.port, "GET", "/api/receipts/keys", { headers: CURL })).status, 429);
      assert.equal((await request(srv.port, "POST", "/api/receipts/verify", { headers: CURL, body: { a: 1 } })).status, 200);
      assert.equal((await request(srv.port, "POST", "/api/receipts/verify", { headers: CURL, body: { a: 1 } })).status, 429);
    } finally { await srv.close(); }
  });
});

describe("offline verifier (scripts/verify-receipt.mjs)", () => {
  const keysPath = path.join(FIX, "keys.json");
  const run = (receiptPath, keys = keysPath) => spawnSync(process.execPath, [SCRIPT, receiptPath, keys], { encoding: "utf8" });
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-receipt-")); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, obj) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(obj)); return p; };

  it("VALID, exit 0 for the /2 and /3 fixtures", () => {
    for (const f of ["receipt-v2.json", "receipt-v3.json"]) {
      const r = run(path.join(FIX, f));
      assert.equal(r.status, 0, r.stderr + r.stdout);
      assert.match(r.stdout, /^VALID/);
    }
  });

  it("the /3 fixture's own verification block describes the same procedure the script runs", () => {
    const v3 = readFix("receipt-v3.json");
    assert.equal(v3.verification.keyId, v3.signature.keyId);
    assert.ok(Object.hasOwn(readFix("keys.json").keys, v3.verification.keyId));
  });

  it("INVALID digest_mismatch, exit 1 when a signed field or the verifyUrl is edited", () => {
    const t = readFix("receipt-v3.json"); t.results.maxStressMPa.value = 1;
    const r = run(write("t.json", t));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^INVALID digest_mismatch/);
    const u = readFix("receipt-v3.json"); u.verification.verifyUrl = "https://evil.example/v";
    assert.match(run(write("u.json", u)).stdout, /^INVALID digest_mismatch/);
  });

  it("INVALID bad_signature when the digest was recomputed but the signature is not the issuer's", () => {
    const f = readFix("receipt-v3.json");
    f.results.maxStressMPa.value = 1;
    const { signature: sig, ...body } = f;
    const canon = (v) => (v === null || typeof v !== "object" ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canon).join(",")}]` : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(",")}}`);
    const c = canon(body);
    const { privateKey } = crypto.generateKeyPairSync("ed25519");
    const forged = { ...body, signature: { ...sig, digest: crypto.createHash("sha256").update(c).digest("hex"), signature: crypto.sign(null, Buffer.from(c), privateKey).toString("base64") } };
    const r = run(write("forged.json", forged));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^INVALID bad_signature/);
  });

  it("INVALID unknown_key, exit 1 for a keyId not in the keys document", () => {
    const r = run(path.join(FIX, "receipt-v3.json"), write("other-keys.json", { alg: "Ed25519", canon: "sorted-json-v1", keys: { deadbeefdeadbeef: Buffer.alloc(32, 1).toString("base64") } }));
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^INVALID unknown_key/);
  });

  it("INVALID for unsigned / missing signature; exit 2 on usage and unreadable input", () => {
    const { signature: _s, ...nosig } = readFix("receipt-v3.json");
    assert.match(run(write("nosig.json", nosig)).stdout, /^INVALID missing_signature/);
    assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status, 2);
    assert.equal(run(path.join(dir, "nope.json")).status, 2);
    assert.equal(verifyReceiptOffline([], {}).reason, "malformed");
  });

  it("agrees with the server verifier on a freshly issued receipt", async () => {
    const r = issueStoredReceipt(buildCalcReceipt(PARTS), { store: () => ({ ok: true }) }).receipt;
    const { publicKeyDocument } = await import("../lib/receipts/attest.js");
    assert.equal(verifyReceiptOffline(r, publicKeyDocument()).valid, true);
    assert.equal(verifyAttestation(r).valid, true);
  });
});
