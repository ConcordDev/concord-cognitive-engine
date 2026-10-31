// server/tests/federation-peering-transport.test.js
//
// The federation peering protocol (emergent/federation-peering.js) was
// state-only: it built heartbeats and HMAC-signed sync packages that
// nothing ever sent. This suite pins the HTTP transport
// (lib/federation-peering-transport.js) end to end with an in-process
// loopback: pod A's transport calls are dispatched to pod B's protocol
// handlers exactly the way routes/federation-peering.js dispatches
// them, so two real STATEs exchange a heartbeat, a signed sync package
// and a proposal with no network involved.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  registerPeer,
  receiveSignedHeartbeat,
  buildHeartbeat,
  receiveSyncPackage,
  receiveProposal,
  getRegisteredPeer,
  getFederationPeeringMetrics,
} from "../emergent/federation-peering.js";
import {
  postJsonToPeer,
  sendHeartbeat,
  sendSync,
  sendProposal,
} from "../lib/federation-peering-transport.js";

const SECRET = "test" + "-secret-0123456789";

function makeState(dtus = []) {
  return {
    dtus: new Map(dtus.map((d) => [d.id, d])),
    shadowDtus: new Map(),
  };
}

function makePods() {
  const podA = makeState([
    { id: "dtu_1", title: "Shared note", tier: "atomic", tags: ["x"], core: {}, human: {}, createdAt: "2026-10-28T00:00:00.000Z", meta: { published: true } },
    { id: "dtu_2", title: "Private note", tier: "atomic", tags: [], core: {}, human: {}, createdAt: "2026-10-28T01:00:00.000Z", meta: {} },
  ]);
  const podB = makeState();
  registerPeer(podA, { peerId: "pod-b", endpoint: "https://pod-b.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
  registerPeer(podB, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
  return { podA, podB };
}

// Dispatches transport calls into pod B's protocol handlers, mirroring
// routes/federation-peering.js (including its status mapping).
function loopbackTo(podB) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const path = new URL(url).pathname;
    if (path.endsWith("/heartbeat")) {
      const r = receiveSignedHeartbeat(podB, body.from, body.heartbeat, body.signature);
      if (!r.ok) return { ok: false, status: 404, json: async () => r };
      const ours = buildHeartbeat(podB);
      return { ok: true, status: 200, json: async () => ({ ok: true, syncNeeded: !!r.syncNeeded, heartbeat: ours.heartbeat }) };
    }
    if (path.endsWith("/sync")) {
      const r = receiveSyncPackage(podB, body.from, body.package);
      return { ok: r.ok, status: r.ok ? 200 : 401, json: async () => r };
    }
    if (path.endsWith("/proposal")) {
      // Mirrors routes/federation-peering.js, which passes the envelope
      // signature through to the (mandatory) verification.
      const r = receiveProposal(podB, body.from, body.proposal, body.signature);
      return { ok: r.ok, status: r.ok ? 200 : 403, json: async () => r };
    }
    return { ok: false, status: 404, json: async () => ({ ok: false, error: "not_found" }) };
  };
}

describe("federation peering transport", () => {
  it("exchanges heartbeats both ways in one call", async () => {
    const { podA, podB } = makePods();
    const r = await sendHeartbeat(podA, "pod-a", "pod-b", { fetchImpl: loopbackTo(podB) });
    assert.equal(r.ok, true);
    // B registered A's heartbeat (peer active), A consumed B's reply.
    assert.equal(getRegisteredPeer(podB, "pod-a").status, "active");
    assert.equal(getFederationPeeringMetrics(podA).heartbeatsReceived, 1);
    assert.equal(getFederationPeeringMetrics(podB).heartbeatsReceived, 1);
  });

  it("delivers a signed sync package into the peer's shadow layer — published DTUs only", async () => {
    const { podA, podB } = makePods();
    const r = await sendSync(podA, "pod-a", "pod-b", { fetchImpl: loopbackTo(podB) });
    assert.equal(r.ok, true);
    assert.equal(r.received, 1);
    assert.equal(r.shadowed, 1);
    const imported = [...podB.shadowDtus.values()];
    assert.equal(imported.length, 1);
    assert.equal(imported[0].id, "fed_pod-a_dtu_1");
    assert.equal(imported[0].tier, "shadow");
  });

  it("a tampered sync package fails HMAC at the peer and surfaces as an HTTP error", async () => {
    const { podA, podB } = makePods();
    const honest = loopbackTo(podB);
    const tampering = async (url, init) => {
      const body = JSON.parse(init.body);
      if (body.package?.dtus?.length) body.package.dtus[0] = { ...body.package.dtus[0], id: "dtu_forged" };
      return honest(url, { ...init, body: JSON.stringify(body) });
    };
    const r = await sendSync(podA, "pod-a", "pod-b", { fetchImpl: tampering });
    assert.equal(r.ok, false);
    assert.equal(r.error, "peer_http_error");
    assert.equal(r.status, 401);
    assert.equal(podB.shadowDtus.size, 0);
  });

  it("delivers a proposal to a trusted peer and stores it inbound", async () => {
    const { podA, podB } = makePods();
    const r = await sendProposal(podA, "pod-a", "pod-b", { proposalId: "prop_1", title: "Shared sector" }, { fetchImpl: loopbackTo(podB) });
    assert.equal(r.ok, true);
    assert.equal(r.delivered, true);
    assert.equal(getFederationPeeringMetrics(podB).inboundProposals, 1);
  });

  it("the trust gates refuse before anything is sent", async () => {
    const { podA, podB } = makePods();
    // The protocol's gates: proposals need trust >= 0.5, sync >= 0.3.
    registerPeer(podA, { peerId: "pod-low", endpoint: "https://low.example/api/federation/v1", trust: 0.4, sharedSecret: SECRET });
    registerPeer(podA, { peerId: "pod-lower", endpoint: "https://lower.example/api/federation/v1", trust: 0.2, sharedSecret: SECRET });
    let calls = 0;
    const counting = async () => { calls++; return { ok: true, status: 200, json: async () => ({}) }; };
    const proposal = await sendProposal(podA, "pod-a", "pod-low", { proposalId: "prop_x" }, { fetchImpl: counting });
    assert.equal(proposal.ok, false);
    assert.equal(proposal.error, "insufficient_trust_for_proposals");
    const sync = await sendSync(podA, "pod-a", "pod-lower", { fetchImpl: counting });
    assert.equal(sync.ok, false);
    assert.equal(sync.error, "insufficient_trust");
    assert.equal(calls, 0);
    // And the inbound gate mirrors it.
    assert.equal(receiveProposal(podB, "pod-a", {}).error, "proposal_id_required");
    assert.equal(receiveProposal(podB, "pod-ghost", { proposalId: "p" }).error, "unknown_peer");
  });

  it("unknown peers, missing self id, and unreachable peers are honest errors", async () => {
    const { podA } = makePods();
    assert.equal((await sendHeartbeat(podA, "pod-a", "pod-ghost", { fetchImpl: loopbackTo(makeState()) })).error, "unknown_peer");
    assert.equal((await sendHeartbeat(podA, "", "pod-b", { fetchImpl: loopbackTo(makeState()) })).error, "self_peer_id_required");
    const down = async () => { throw new Error("ECONNREFUSED"); };
    assert.equal((await sendHeartbeat(podA, "pod-a", "pod-b", { fetchImpl: down })).error, "peer_unreachable");
    assert.equal(getRegisteredPeer(podA, "pod-ghost"), null);
  });

  it("postJsonToPeer refuses a non-URL endpoint via the SSRF guard, without any fetch", async () => {
    const r = await postJsonToPeer({ endpoint: "not a url" }, "/heartbeat", { from: "pod-a" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "blocked_url");
  });
});
