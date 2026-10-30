// Fix-it #58 (review HOLD on #1816): mandatory inbound HMAC is only as
// strong as peer registration. Before this fix any signed-in member could
// run emergent federation.registerPeer with a peerId, endpoint, trust and
// shared secret of their choosing (and overwrite an existing peer), then
// sign their own packages/proposals; the send* macros were member-reachable
// outbound POSTs; and /v1/heartbeat answered with our lattice summary to
// anyone who named a registered peerId.
//
// Pinned here:
//   - registerPeer requires a shared secret and refuses to overwrite a peer;
//   - /v1/heartbeat requires an HMAC under the peer's secret (real HTTP);
//   - the federation registration/receive/send macros are admin-only for
//     human callers, internal callers still pass, metrics stays public.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerServerCleanExit } from "./lib/server-clean-exit.js";
import {
  registerPeer,
  getRegisteredPeer,
  buildHeartbeat,
  signHeartbeat,
  MIN_SHARED_SECRET_LEN,
} from "../emergent/federation-peering.js";
import createFederationPeeringRouter from "../routes/federation-peering.js";

const SECRET = "test" + "-secret-0123456789";
const EP = "https://pod-a.example/api/federation/v1";

describe("registerPeer", () => {
  it("refuses a peer with no shared secret or a short one", () => {
    const s = { dtus: new Map() };
    assert.equal(registerPeer(s, { peerId: "pod-a", endpoint: EP, trust: 1 }).error, "shared_secret_required");
    assert.equal(registerPeer(s, { peerId: "pod-a", endpoint: EP, trust: 1, sharedSecret: "x".repeat(MIN_SHARED_SECRET_LEN - 1) }).error, "shared_secret_required");
    assert.equal(registerPeer(s, { peerId: "pod-a", endpoint: EP, trust: 1, sharedSecret: 12345678901234567 }).error, "shared_secret_required");
    assert.equal(getRegisteredPeer(s, "pod-a"), null);
  });

  it("refuses to overwrite an existing peer's endpoint, trust or secret", () => {
    const s = { dtus: new Map() };
    assert.equal(registerPeer(s, { peerId: "pod-a", endpoint: EP, trust: 0.2, sharedSecret: SECRET }).ok, true);
    const again = registerPeer(s, { peerId: "pod-a", endpoint: "https://attacker.example/x", trust: 1, sharedSecret: "attacker-chosen-secret-123" });
    assert.equal(again.ok, false);
    assert.equal(again.error, "peer_exists");
    const peer = getRegisteredPeer(s, "pod-a");
    assert.equal(peer.endpoint, EP);
    assert.equal(peer.trust, 0.2);
    assert.equal(peer.sharedSecret, SECRET);
  });
});

describe("POST /api/federation/v1/heartbeat requires the peer's HMAC", () => {
  let base, server, prevState;
  const STATE = { dtus: new Map([["dtu_1", { id: "dtu_1", title: "t", createdAt: "2026-10-28T00:00:00.000Z" }]]) };

  before(async () => {
    registerPeer(STATE, { peerId: "pod-a", endpoint: EP, trust: 0.9, sharedSecret: SECRET });
    prevState = globalThis._concordSTATE;
    globalThis._concordSTATE = STATE;
    const app = express();
    app.use(express.json());
    app.use("/api/federation/v1", createFederationPeeringRouter());
    await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
    base = `http://127.0.0.1:${server.address().port}/api/federation/v1`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    globalThis._concordSTATE = prevState;
  });

  const post = async (body) => {
    const r = await fetch(`${base}/heartbeat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const hb = { dtuCount: 3, shadowCount: 0, latestDtuTimestamp: null, recentDtuIds: [] };

  it("an unsigned heartbeat naming a registered peer gets no lattice data", async () => {
    const r = await post({ from: "pod-a", heartbeat: hb });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_required");
    assert.equal(r.body.heartbeat, undefined, "no lattice summary to an unsigned caller");
  });

  it("a heartbeat signed with the wrong secret is refused", async () => {
    const r = await post({ from: "pod-a", heartbeat: hb, signature: signHeartbeat("someone-elses-secret-000", "pod-a", hb) });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_invalid");
    assert.equal(r.body.heartbeat, undefined);
  });

  it("a signature for a different sender id does not transfer", async () => {
    const r = await post({ from: "pod-a", heartbeat: hb, signature: signHeartbeat(SECRET, "pod-b", hb) });
    assert.equal(r.status, 401);
  });

  it("a correctly signed heartbeat gets our heartbeat back", async () => {
    const r = await post({ from: "pod-a", heartbeat: hb, signature: signHeartbeat(SECRET, "pod-a", hb) });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    const { timestamp: _t1, ...got } = r.body.heartbeat;
    const { timestamp: _t2, ...want } = buildHeartbeat(STATE).heartbeat;
    assert.deepEqual(got, want);
    assert.equal(got.dtuCount, 1);
    assert.equal(getRegisteredPeer(STATE, "pod-a").status, "active");
  });

  it("an unknown peer is a 404", async () => {
    const r = await post({ from: "pod-zzz", heartbeat: hb, signature: signHeartbeat(SECRET, "pod-zzz", hb) });
    assert.equal(r.status, 404);
  });
});

describe("federation macros are admin-only for humans (booted server ACL)", () => {
  let __TEST__, _serverMod;
  registerServerCleanExit(() => _serverMod?.__TEST__);

  before(async () => {
    _serverMod = await import("../server.js");
    __TEST__ = _serverMod.__TEST__;
  });

  const ADMIN_ONLY = [
    "registerPeer", "heartbeat", "buildSync", "receiveSync", "receiveProposal",
    "sendHeartbeat", "sendSync", "sendProposal",
  ];
  const member = { actor: { userId: "u-fed-member", role: "member", scopes: ["read", "write"] }, reqMeta: { path: "/api/lens/run", method: "POST" } };
  const admin = { actor: { userId: "u-fed-admin", role: "admin", scopes: ["read", "write"] }, reqMeta: { path: "/api/lens/run", method: "POST" } };
  const deny = (ctx, name) => globalThis.humanMacroAclDenial({ ctx, domain: "emergent", name });

  it("a signed-in member is 403-denied on every registration/receive/send macro", () => {
    assert.equal(typeof globalThis.humanMacroAclDenial, "function");
    for (const n of ADMIN_ONLY) {
      const d = deny(member, `federation.${n}`);
      assert.equal(d?.status, 403, `federation.${n} must be denied for a member`);
      assert.equal(d.code, "admin_only");
    }
  });

  it("an admin and an internal caller are allowed", () => {
    for (const n of ADMIN_ONLY) {
      assert.equal(deny(admin, `federation.${n}`), null, `admin on federation.${n}`);
      assert.equal(deny(__TEST__.makeInternalCtx("fed-acl"), `federation.${n}`), null, `internal on federation.${n}`);
    }
  });

  it("federation.metrics and other emergent macros stay member-usable", () => {
    assert.equal(deny(member, "federation.metrics"), null);
    assert.equal(deny(member, "lens.checkAccess"), null);
  });

  it("the live runMacro refuses a member's registerPeer and registers nothing", async () => {
    const r = await __TEST__.runMacro("emergent", "federation.registerPeer", { peerId: "pod-evil", endpoint: "https://evil.example/v1", trust: 1, sharedSecret: "member-chosen-secret-xyz" }, member).catch((e) => ({ ok: false, thrown: String(e?.message || e) }));
    assert.equal(r?.ok, false, JSON.stringify(r));
    assert.equal(getRegisteredPeer(__TEST__.STATE, "pod-evil"), null);
  });
});
