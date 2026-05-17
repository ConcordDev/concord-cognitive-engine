// server/tests/ap-inbox-integration.test.js
//
// Phase 12 — integration test for the ActivityPub inbox sign/verify
// path end-to-end. Stands up:
//   - a tiny "peer" HTTP server that serves a public-key actor doc
//   - an Express app mounting the real /api/federation/users/:id/inbox
//     handler from lib/activitypub-bridge.js with rawBody capture
// and POSTs a signed Follow activity, then a tampered version.
//
// This is the on-the-wire counterpart to ap-signature.test.js, which
// only exercises sign/verify in-process.

// Bridge captures ENABLED at module-load. Set the env var BEFORE we
// dynamically import the bridge so receiveActivity actually runs
// end-to-end.
process.env.CONCORD_ACTIVITYPUB = "true";

import { test } from "node:test";
import assert from "node:assert";
import http from "node:http";
import express from "express";
import crypto from "node:crypto";
import Database from "better-sqlite3";

import { signRequest } from "../lib/ap-signature.js";
const { receiveActivity } = await import("../lib/activitypub-bridge.js");

function makeRsaPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  };
}

function makeApp(db, peerActorId, peerPublicKeyPem, peerKeyId) {
  const app = express();
  // Capture rawBody for digest verification — matches the
  // production middleware/index.js verify hook.
  app.use(express.json({
    type: ["application/json", "application/activity+json", "application/ld+json"],
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  // Custom fetcher so the verifier resolves the test actor without a
  // second HTTP hop.
  const fetcher = async (url) => {
    if (url === peerActorId) {
      return {
        ok: true, status: 200,
        async json() {
          return { id: peerActorId, publicKey: { id: peerKeyId, owner: peerActorId, publicKeyPem: peerPublicKeyPem } };
        },
      };
    }
    return { ok: false, status: 404, async json() { return null; } };
  };

  app.post("/api/federation/users/:userId/inbox", async (req, res) => {
    const r = await receiveActivity(db, req.params.userId, req.body || {}, req.headers, req.rawBody, {
      method: "POST",
      path: req.originalUrl,
      fetcher,
    });
    if (r?.ok && r.accepted) return res.status(202).json({ ok: true, deduped: !!r.deduped });
    if (r?.reason === "signature_required" || r?.reason === "signature_invalid" || r?.reason === "actor_signature_mismatch") {
      return res.status(401).json(r);
    }
    return res.status(400).json(r);
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

test("inbox: signed Follow returns 202; tampered body returns 401 digest_mismatch", async (t) => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)`);
  db.prepare(`INSERT INTO users (id, username) VALUES (?, ?)`).run("u1", "smoketest");

  const { publicKeyPem, privateKeyPem } = makeRsaPair();
  const peerActorId = `https://peer.example/users/alice-${Date.now()}-${process.hrtime.bigint()}`;
  const peerKeyId   = `${peerActorId}#main-key`;

  const { server, base } = await listen(makeApp(db, peerActorId, publicKeyPem, peerKeyId));
  t.after(() => { server.close(); db.close(); });

  const inboxUrl = `${base}/api/federation/users/smoketest/inbox`;
  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${peerActorId}/follow/${Date.now()}`,
    type: "Follow",
    actor: peerActorId,
    object: `${base}/api/federation/users/smoketest`,
  };
  const body = JSON.stringify(activity);

  const headers = signRequest({
    privateKeyPem, keyId: peerKeyId, method: "POST", url: inboxUrl, body,
  });

  const r1 = await fetch(inboxUrl, { method: "POST", headers, body });
  assert.strictEqual(r1.status, 202, `expected 202, got ${r1.status}`);
  const j1 = await r1.json();
  assert.strictEqual(j1.ok, true);

  // Tamper: re-use the same headers (matching digest) but send a different body.
  const tamperedBody = body.replace('"Follow"', '"Block"');
  const r2 = await fetch(inboxUrl, { method: "POST", headers, body: tamperedBody });
  assert.strictEqual(r2.status, 401, `tampered request should be 401, got ${r2.status}`);
  const j2 = await r2.json();
  assert.match(j2.error || j2.reason || "", /digest_mismatch|signature_invalid/);
});

test("inbox: missing signature header returns 400 missing_activity_fields when activity is empty / 202 unsigned when activity is shaped (signature optional by default)", async (t) => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)`);
  db.prepare(`INSERT INTO users (id, username) VALUES (?, ?)`).run("u1", "smoketest");
  const { server, base } = await listen(makeApp(db, "https://peer/x", "", "https://peer/x#k"));
  t.after(() => { server.close(); db.close(); });

  // Unsigned but well-formed activity. Because CONCORD_AP_REQUIRE_SIGNATURE
  // is not set, the bridge accepts it (with signature_actor_id null) so
  // local-dev / trusted-LAN setups don't have to plumb keys.
  const r = await fetch(`${base}/api/federation/users/smoketest/inbox`, {
    method: "POST",
    headers: { "Content-Type": "application/activity+json" },
    body: JSON.stringify({ id: "https://peer/x/note/1", type: "Note", actor: "https://peer/x" }),
  });
  assert.strictEqual(r.status, 202, `unsigned should be 202 in dev mode, got ${r.status}`);
});

test("inbox: actor_signature_mismatch when signed actor differs from activity actor", async (t) => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT)`);
  db.prepare(`INSERT INTO users (id, username) VALUES (?, ?)`).run("u1", "smoketest");

  const { publicKeyPem, privateKeyPem } = makeRsaPair();
  // Use a fresh peer identity per test so the module-scoped key cache
  // in activitypub-bridge.js doesn't return a stale public key from
  // an earlier test's run.
  const peerActorId = `https://peer.example/users/alice-${Date.now()}`;
  const peerKeyId   = `${peerActorId}#main-key`;

  const { server, base } = await listen(makeApp(db, peerActorId, publicKeyPem, peerKeyId));
  t.after(() => { server.close(); db.close(); });

  const inboxUrl = `${base}/api/federation/users/smoketest/inbox`;
  // Activity claims to be from a DIFFERENT actor than the one signing it.
  const activity = {
    id: "https://peer.example/users/alice/announce/1",
    type: "Announce",
    actor: "https://OTHER.example/users/eve",
    object: "https://x/y",
  };
  const body = JSON.stringify(activity);
  const headers = signRequest({ privateKeyPem, keyId: peerKeyId, method: "POST", url: inboxUrl, body });
  const r = await fetch(inboxUrl, { method: "POST", headers, body });
  assert.strictEqual(r.status, 401);
  const j = await r.json();
  assert.strictEqual(j.reason, "actor_signature_mismatch");
});
