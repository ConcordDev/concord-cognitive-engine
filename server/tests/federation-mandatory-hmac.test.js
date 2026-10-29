// server/tests/federation-mandatory-hmac.test.js
//
// Security #38 (Handoff-4 §1.10, on PR #1761's peering transport):
// federation inbound authentication is MANDATORY. Before this fix,
// receiveSyncPackage verified the HMAC only "if peer has shared
// secret" — and registerPeer admits secretless peers — so anyone could
// claim a secretless registered peer's id in the request body's `from`
// field and inject DTUs into the shadow layer as that peer. Proposals
// had no signature at all: the trust gate read the claimed peer's
// registry entry, so a trusted peer's id was itself the credential.
// These tests pin the fail-closed behaviour for both paths.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  registerPeer,
  getRegisteredPeer,
  receiveSyncPackage,
  receiveProposal,
  signPackage,
  signProposal,
} from "../emergent/federation-peering.js";

const SECRET = "test" + "-secret-0123456789";

function makeState() {
  return { dtus: new Map(), shadowDtus: new Map() };
}

const DTU = { id: "dtu_1", title: "Shared note", tier: "atomic", tags: ["x"], core: {}, human: {} };

// registerPeer now refuses a peer without a shared secret, so a secretless
// record can only come from state saved before that rule. Simulate one to
// pin that the receive paths still fail closed for it.
function legacySecretlessPeer(s, peerId) {
  registerPeer(s, { peerId, endpoint: `https://${peerId}.example/api/federation/v1`, trust: 0.9, sharedSecret: SECRET });
  getRegisteredPeer(s, peerId).sharedSecret = null;
}

function pkgFor(peerId, dtus = [DTU]) {
  return { peerId, count: dtus.length, timestamp: "2026-10-29T00:00:00.000Z", dtus };
}

describe("federation inbound — mandatory HMAC (sync packages)", () => {
  it("a secretless registered peer cannot sync — the spoofing channel is closed", () => {
    const s = makeState();
    legacySecretlessPeer(s, "pod-a");
    const r = receiveSyncPackage(s, "pod-a", pkgFor("pod-a"));
    assert.equal(r.ok, false);
    assert.equal(r.error, "signature_required");
    assert.equal(s.shadowDtus.size, 0, "nothing was imported");
  });

  it("an unsigned package from a secreted peer is refused", () => {
    const s = makeState();
    registerPeer(s, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
    const r = receiveSyncPackage(s, "pod-a", pkgFor("pod-a"));
    assert.equal(r.ok, false);
    assert.equal(r.error, "signature_required");
    assert.equal(s.shadowDtus.size, 0);
  });

  it("a badly signed package is refused", () => {
    const s = makeState();
    registerPeer(s, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
    const pkg = pkgFor("pod-a");
    pkg.signature = signPackage("some-other-secret", pkg);
    const r = receiveSyncPackage(s, "pod-a", pkg);
    assert.equal(r.ok, false);
    assert.equal(r.error, "signature_invalid");
    assert.equal(s.shadowDtus.size, 0);
  });

  it("a correctly signed package is accepted and shadowed", () => {
    const s = makeState();
    registerPeer(s, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
    const pkg = pkgFor("pod-a");
    pkg.signature = signPackage(SECRET, pkg);
    const r = receiveSyncPackage(s, "pod-a", pkg);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(s.shadowDtus.size, 1);
  });
});

describe("federation inbound — mandatory HMAC (proposals)", () => {
  const PROP = { proposalId: "prop_1", kind: "governance", title: "Adopt the thing" };

  it("a secretless (even trusted) peer cannot propose", () => {
    const s = makeState();
    legacySecretlessPeer(s, "pod-a");
    const r = receiveProposal(s, "pod-a", PROP, signProposal("anything", "pod-a", PROP));
    assert.equal(r.ok, false);
    assert.equal(r.error, "signature_required");
  });

  it("an unsigned proposal from a secreted trusted peer is refused", () => {
    const s = makeState();
    registerPeer(s, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
    const r = receiveProposal(s, "pod-a", PROP);
    assert.equal(r.ok, false);
    assert.equal(r.error, "signature_required");
  });

  it("a badly signed proposal is refused", () => {
    const s = makeState();
    registerPeer(s, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
    const r = receiveProposal(s, "pod-a", PROP, signProposal("some-other-secret", "pod-a", PROP));
    assert.equal(r.ok, false);
    assert.equal(r.error, "signature_invalid");
  });

  it("a proposal signed by a DIFFERENT peer's claim is refused (signature binds the sender)", () => {
    const s = makeState();
    registerPeer(s, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
    registerPeer(s, { peerId: "pod-b", endpoint: "https://pod-b.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
    // pod-b signs a proposal but the envelope claims pod-a sent it.
    const sig = signProposal(SECRET, "pod-b", PROP);
    const r = receiveProposal(s, "pod-a", PROP, sig);
    assert.equal(r.ok, false);
    assert.equal(r.error, "signature_invalid");
  });

  it("a correctly signed proposal from a trusted peer is accepted", () => {
    const s = makeState();
    registerPeer(s, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.9, sharedSecret: SECRET });
    const r = receiveProposal(s, "pod-a", PROP, signProposal(SECRET, "pod-a", PROP));
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.proposalId, "prop_1");
  });

  it("the trust gate still applies ahead of signature checks for under-trusted peers", () => {
    const s = makeState();
    registerPeer(s, { peerId: "pod-a", endpoint: "https://pod-a.example/api/federation/v1", trust: 0.2, sharedSecret: SECRET });
    const r = receiveProposal(s, "pod-a", PROP, signProposal(SECRET, "pod-a", PROP));
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_trust_for_proposals");
  });
});
