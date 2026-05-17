// server/tests/ap-signature.test.js
//
// Phase 12 — pin the sign/verify round-trip and the rejection rules
// for the ActivityPub HTTP-signature implementation in lib/ap-signature.js.

import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import {
  parseSignatureHeader,
  buildSigningString,
  digestForBody,
  signRequest,
  verifySignature,
  makeInMemoryKeyCache,
} from "../lib/ap-signature.js";

function makeRsaPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

function fakeFetcher(actorMap) {
  return async (url) => {
    const actor = actorMap.get(url);
    if (!actor) return { ok: false, status: 404, async json() { return null; } };
    return { ok: true, status: 200, async json() { return actor; } };
  };
}

test("parseSignatureHeader extracts keyId, algorithm, headers, signature", () => {
  const out = parseSignatureHeader(
    'keyId="https://peer.example/users/alice#main-key",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="ABCDEFG=="'
  );
  assert.strictEqual(out.keyId, "https://peer.example/users/alice#main-key");
  assert.strictEqual(out.algorithm, "rsa-sha256");
  assert.strictEqual(out.headers, "(request-target) host date digest");
  assert.strictEqual(out.signature, "ABCDEFG==");
});

test("parseSignatureHeader returns null for malformed input", () => {
  assert.strictEqual(parseSignatureHeader(""), null);
  assert.strictEqual(parseSignatureHeader(null), null);
  // Missing required fields.
  assert.strictEqual(parseSignatureHeader('algorithm="rsa-sha256"'), null);
});

test("buildSigningString assembles canonical header lines", () => {
  const s = buildSigningString({
    headers: { Host: "concord-os.org", Date: "Sat, 10 May 2026 01:23:45 GMT", Digest: "SHA-256=AAA" },
    method: "POST",
    path: "/users/bob/inbox",
    headerNames: ["(request-target)", "host", "date", "digest"],
  });
  assert.strictEqual(
    s,
    "(request-target): post /users/bob/inbox\nhost: concord-os.org\ndate: Sat, 10 May 2026 01:23:45 GMT\ndigest: SHA-256=AAA"
  );
});

test("digestForBody is base64(sha256(body)) with SHA-256= prefix", () => {
  const d = digestForBody("hello");
  const expected = `SHA-256=${crypto.createHash("sha256").update("hello").digest("base64")}`;
  assert.strictEqual(d, expected);
});

test("sign + verify round trip succeeds", async () => {
  const { publicKeyPem, privateKeyPem } = makeRsaPair();
  const keyId = "https://peer.example/users/alice#main-key";
  const actorId = "https://peer.example/users/alice";
  const fetcher = fakeFetcher(new Map([[actorId, { id: actorId, publicKey: { id: keyId, owner: actorId, publicKeyPem } }]]));

  const body = JSON.stringify({ type: "Create", id: "https://peer.example/notes/1" });
  const headers = signRequest({
    privateKeyPem,
    keyId,
    method: "POST",
    url: "https://concord-os.org/users/bob/inbox",
    body,
  });

  const v = await verifySignature({
    headers,
    method: "POST",
    path: "/users/bob/inbox",
    body,
    fetcher,
  });
  assert.strictEqual(v.ok, true, v.error);
  assert.strictEqual(v.actorId, actorId);
});

test("verify rejects body tampering (digest_mismatch)", async () => {
  const { publicKeyPem, privateKeyPem } = makeRsaPair();
  const keyId = "https://peer.example/users/alice#main-key";
  const actorId = "https://peer.example/users/alice";
  const fetcher = fakeFetcher(new Map([[actorId, { id: actorId, publicKey: { id: keyId, owner: actorId, publicKeyPem } }]]));

  const body = JSON.stringify({ type: "Create", id: "https://peer.example/notes/1" });
  const headers = signRequest({
    privateKeyPem, keyId, method: "POST",
    url: "https://concord-os.org/users/bob/inbox", body,
  });

  // Attacker swaps body — digest header still references the OLD content.
  const tampered = JSON.stringify({ type: "Create", id: "https://peer.example/notes/2-evil" });
  const v = await verifySignature({ headers, method: "POST", path: "/users/bob/inbox", body: tampered, fetcher });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.error, "digest_mismatch");
});

test("verify rejects bad signature bytes (signature_invalid)", async () => {
  const { publicKeyPem, privateKeyPem } = makeRsaPair();
  const keyId = "https://peer.example/users/alice#main-key";
  const actorId = "https://peer.example/users/alice";
  const fetcher = fakeFetcher(new Map([[actorId, { id: actorId, publicKey: { id: keyId, owner: actorId, publicKeyPem } }]]));

  const body = "{}";
  const headers = signRequest({ privateKeyPem, keyId, method: "POST", url: "https://concord-os.org/users/bob/inbox", body });
  // Corrupt the signature.
  headers.Signature = headers.Signature.replace(/signature="[^"]+"/, 'signature="AAAA"');
  const v = await verifySignature({ headers, method: "POST", path: "/users/bob/inbox", body, fetcher });
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /signature_invalid|verify_threw/);
});

test("verify rejects when actor key cannot be resolved", async () => {
  const { privateKeyPem } = makeRsaPair();
  const keyId = "https://peer.example/users/ghost#main-key";
  const fetcher = fakeFetcher(new Map()); // no actor

  const body = "{}";
  const headers = signRequest({ privateKeyPem, keyId, method: "POST", url: "https://concord-os.org/users/bob/inbox", body });
  const v = await verifySignature({ headers, method: "POST", path: "/users/bob/inbox", body, fetcher });
  assert.strictEqual(v.ok, false);
  assert.match(v.error, /^key_resolve_failed/);
});

test("verify rejects stale dates (date_skew_exceeded)", async () => {
  const { publicKeyPem, privateKeyPem } = makeRsaPair();
  const keyId = "https://peer.example/users/alice#main-key";
  const actorId = "https://peer.example/users/alice";
  const fetcher = fakeFetcher(new Map([[actorId, { id: actorId, publicKey: { id: keyId, owner: actorId, publicKeyPem } }]]));

  const oldDate = new Date(Date.now() - 30 * 60 * 1000).toUTCString();
  const body = "{}";
  const headers = signRequest({
    privateKeyPem, keyId, method: "POST",
    url: "https://concord-os.org/users/bob/inbox", body,
    extraHeaders: { Date: oldDate },
  });
  const v = await verifySignature({ headers, method: "POST", path: "/users/bob/inbox", body, fetcher });
  assert.strictEqual(v.ok, false);
  assert.strictEqual(v.error, "date_skew_exceeded");
});

test("makeInMemoryKeyCache get/set roundtrip + TTL behaviour", async () => {
  const cache = makeInMemoryKeyCache({ ttlMs: 50 });
  assert.strictEqual(await cache.get("k"), null);
  await cache.set("k", "PEM", "https://actor");
  assert.strictEqual(await cache.get("k"), "PEM");
  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(await cache.get("k"), null);
});

test("key cache short-circuits the fetcher on second verify", async () => {
  const { publicKeyPem, privateKeyPem } = makeRsaPair();
  const keyId = "https://peer.example/users/alice#main-key";
  const actorId = "https://peer.example/users/alice";
  let calls = 0;
  const fetcher = async (url) => {
    calls += 1;
    if (url === actorId) return { ok: true, status: 200, async json() { return { id: actorId, publicKey: { publicKeyPem } }; } };
    return { ok: false, status: 404, async json() { return null; } };
  };
  const cache = makeInMemoryKeyCache();

  const body = "{}";
  for (let i = 0; i < 3; i++) {
    const headers = signRequest({ privateKeyPem, keyId, method: "POST", url: "https://concord-os.org/users/bob/inbox", body });
    const v = await verifySignature({
      headers, method: "POST", path: "/users/bob/inbox", body, fetcher,
      cacheGet: cache.get, cacheSet: cache.set,
    });
    assert.strictEqual(v.ok, true);
  }
  assert.strictEqual(calls, 1, "actor fetched exactly once; subsequent verifies use cache");
});
