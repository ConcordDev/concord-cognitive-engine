// The three inbound federation routes (routes/federation-peering.js: POST /heartbeat, /sync, /proposal) carry
// no user session on purpose: pod-to-pod calls authenticate with the protocol's own registered-peer +
// shared-secret HMAC, verified inside receiveSignedHeartbeat / receiveSyncPackage / receiveProposal. The route
// files mark them `// AUTH: peer-hmac` for the route-auth coverage gate; this test is what keeps that marker
// honest, over real HTTP: an unknown sender, an unsigned request and a badly signed request are all refused and
// change nothing, while a correctly signed one is accepted (so the refusals are not vacuous).

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import createFederationPeeringRouter from "../routes/federation-peering.js";
import { getEmergentState } from "../emergent/store.js";
import {
  registerPeer, getRegisteredPeer, buildHeartbeat, signHeartbeat, signPackage, signProposal,
} from "../emergent/federation-peering.js";

const SECRET = "test" + "-secret-0123456789";
const OTHER = "other" + "-secret-9876543210";
const DTU = { id: "dtu_1", title: "Shared note", tier: "atomic", tags: ["x"], core: {}, human: {} };

let server, base, STATE;

const post = async (path, body) => {
  const r = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
// The receiver refuses packages outside a ±10 min window, so the control carries a fresh timestamp (fixed once so
// signing and sending agree).
const SIGNED_AT = new Date().toISOString();
const pkg = (peerId) => ({ peerId, count: 1, timestamp: SIGNED_AT, dtus: [DTU] });
const proposal = { proposalId: "prop_1", title: "Hello" };
const heartbeat = () => buildHeartbeat(STATE).heartbeat;
const inboundProposals = () => getEmergentState(STATE)._federation?.inboundProposals?.size ?? 0;
const imported = () => STATE.shadowDtus.size + inboundProposals();

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/federation/v1", createFederationPeeringRouter());
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}/api/federation/v1`;
});
after(() => new Promise((r) => server.close(r)));
beforeEach(() => {
  STATE = { dtus: new Map(), shadowDtus: new Map() };
  globalThis._concordSTATE = STATE;
  registerPeer(STATE, { peerId: "pod-b", endpoint: "https://pod-b.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
});

describe("POST /heartbeat", () => {
  it("unknown sender: 404, nothing recorded", async () => {
    const r = await post("/heartbeat", { from: "stranger", heartbeat: heartbeat(), signature: signHeartbeat(SECRET, "stranger", heartbeat()) });
    assert.equal(r.status, 404);
    assert.equal(r.body.error, "unknown_peer");
  });
  it("registered peer with no signature: 401", async () => {
    const r = await post("/heartbeat", { from: "pod-b", heartbeat: heartbeat() });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_required");
  });
  it("registered peer, signature under the WRONG secret: 401", async () => {
    const r = await post("/heartbeat", { from: "pod-b", heartbeat: heartbeat(), signature: signHeartbeat(OTHER, "pod-b", heartbeat()) });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_invalid");
  });
  it("a signature made for another sender id does not transfer: 401", async () => {
    const r = await post("/heartbeat", { from: "pod-b", heartbeat: heartbeat(), signature: signHeartbeat(SECRET, "pod-c", heartbeat()) });
    assert.equal(r.status, 401);
  });
  it("a peer with no secret on record can never authenticate (fail-closed): 401", async () => {
    getRegisteredPeer(STATE, "pod-b").sharedSecret = null;
    const r = await post("/heartbeat", { from: "pod-b", heartbeat: heartbeat(), signature: signHeartbeat(SECRET, "pod-b", heartbeat()) });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_required");
  });
  it("control: a correctly signed heartbeat is accepted and answers with ours", async () => {
    const r = await post("/heartbeat", { from: "pod-b", heartbeat: heartbeat(), signature: signHeartbeat(SECRET, "pod-b", heartbeat()) });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.heartbeat);
  });
  it("an empty body is refused without a crash", async () => {
    const r = await post("/heartbeat", {});
    assert.ok([400, 401, 404].includes(r.status), String(r.status));
  });
});

describe("POST /sync", () => {
  it("unknown sender: 404, nothing imported", async () => {
    const r = await post("/sync", { from: "stranger", package: { ...pkg("stranger"), signature: signPackage(SECRET, pkg("stranger")) } });
    assert.equal(r.status, 404);
    assert.equal(imported(), 0);
  });
  it("registered peer, unsigned package: 401, nothing imported", async () => {
    const r = await post("/sync", { from: "pod-b", package: pkg("pod-b") });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_required");
    assert.equal(imported(), 0);
  });
  it("registered peer, package signed under the WRONG secret: 401, nothing imported", async () => {
    const r = await post("/sync", { from: "pod-b", package: { ...pkg("pod-b"), signature: signPackage(OTHER, pkg("pod-b")) } });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_invalid");
    assert.equal(imported(), 0);
  });
  it("a signed package whose DTU ids were swapped after signing is refused", async () => {
    const signed = { ...pkg("pod-b"), signature: signPackage(SECRET, pkg("pod-b")) };
    signed.dtus = [{ ...DTU, id: "dtu_injected" }];
    const r = await post("/sync", { from: "pod-b", package: signed });
    assert.equal(r.status, 401);
    assert.equal(imported(), 0);
  });
  it("a peer with no secret on record cannot sync (the spoofing channel is closed)", async () => {
    getRegisteredPeer(STATE, "pod-b").sharedSecret = null;
    const r = await post("/sync", { from: "pod-b", package: { ...pkg("pod-b"), signature: signPackage(SECRET, pkg("pod-b")) } });
    assert.equal(r.status, 401);
    assert.equal(imported(), 0);
  });
  it("control: a correctly signed package is accepted and shadowed", async () => {
    const r = await post("/sync", { from: "pod-b", package: { ...pkg("pod-b"), signature: signPackage(SECRET, pkg("pod-b")) } });
    assert.equal(r.status, 200);
    assert.equal(r.body.received, 1);
    assert.equal(STATE.shadowDtus.size, 1);
  });
});

describe("POST /proposal", () => {
  it("unknown sender: 404", async () => {
    const r = await post("/proposal", { from: "stranger", proposal, signature: signProposal(SECRET, "stranger", proposal) });
    assert.equal(r.status, 404);
  });
  it("registered peer, no signature: 401, not stored", async () => {
    const r = await post("/proposal", { from: "pod-b", proposal });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_required");
    assert.equal(imported(), 0);
  });
  it("registered peer, signature under the WRONG secret: 401, not stored", async () => {
    const r = await post("/proposal", { from: "pod-b", proposal, signature: signProposal(OTHER, "pod-b", proposal) });
    assert.equal(r.status, 401);
    assert.equal(r.body.error, "signature_invalid");
    assert.equal(imported(), 0);
  });
  it("a signed proposal whose body was altered after signing is refused", async () => {
    const sig = signProposal(SECRET, "pod-b", proposal);
    const r = await post("/proposal", { from: "pod-b", proposal: { ...proposal, title: "Tampered" }, signature: sig });
    assert.equal(r.status, 401);
    assert.equal(imported(), 0);
  });
  it("an untrusted peer is refused even with a valid signature (403)", async () => {
    getRegisteredPeer(STATE, "pod-b").trust = 0.1;
    const r = await post("/proposal", { from: "pod-b", proposal, signature: signProposal(SECRET, "pod-b", proposal) });
    assert.equal(r.status, 403);
  });
  it("control: a correctly signed proposal is accepted and stored", async () => {
    const r = await post("/proposal", { from: "pod-b", proposal, signature: signProposal(SECRET, "pod-b", proposal) });
    assert.equal(r.status, 200);
    assert.equal(r.body.proposalId, "prop_1");
    assert.equal(inboundProposals(), 1, "the accepted proposal is the one thing stored (so the 'not stored' checks above are real)");
  });
});
