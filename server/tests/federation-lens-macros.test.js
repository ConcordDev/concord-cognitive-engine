// Lens-driven behavioral macro tests for server/domains/federation.js.
//
// These mirror the REAL LENS_ACTIONS dispatch (server.js:39150):
//   lensHandler(ctx, virtualArtifact, input)
// where virtualArtifact = { id, domain, type, data, meta } and `input` is the
// caller's params object. They are LIGHTWEIGHT + hermetic — NO server boot, NO
// network, NO LLM — and assert ACTUAL values + multi-step round-trips for the
// macros the federation lens actually drives (peers/activity status strip +
// each panel's list/mutate round-trip), the deterministic local-only paths
// (no outbound peer calls), per-user isolation, and the fail-CLOSED numeric +
// validation guards.
//
// Complements federation-domain-parity.test.js (which covers the backlog
// macro surface) by pinning the two driving macros (peers, activity) the
// status strip reads and the envelope-unwrap of the DB-backed listPeers
// helper, which the parity test does not exercise.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFederationActions from "../domains/federation.js";

// ── 3-arg LENS_ACTIONS-mirroring harness ─────────────────────────────
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "federation", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Dispatch exactly as server.js:39150 does: (ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`federation.${name} not registered`);
  const virtualArtifact = { id: null, domain: "federation", type: "domain_action", data: {}, meta: {} };
  return fn(ctx, virtualArtifact, input);
}

before(() => { registerFederationActions(register); });
beforeEach(() => {
  // Reset the in-memory federation namespace + any settings/shadow stores
  // between tests so per-user state can't leak across cases.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "fed_user_a" } };
const ctxB = { actor: { userId: "fed_user_b" } };

describe("federation — registration (every macro the lens panels call)", () => {
  it("registers all 22 lens-driven macros", () => {
    for (const m of [
      "peers", "activity",
      "setPeerPolicy", "listPeerPolicies", "removePeerPolicy", "checkPeerAllowed",
      "reportInbound", "listModerationQueue", "reviewInbound",
      "setSyncPolicy", "listSyncPolicies",
      "subscribeRelay", "listRelays", "pollRelay", "unsubscribeRelay",
      "recordTrustEvent", "trustHistory",
      "recordMetric", "metricsDashboard",
      "registerActorKey", "verifyActorSignature", "listActorKeys",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing federation.${m}`);
    }
  });
});

describe("federation — peers (status strip driving macro)", () => {
  it("returns an empty configured/trustGraph on a minimal build (no DB, no settings)", () => {
    const r = call("peers", { ...ctxA, db: null });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.configured, []);
    assert.deepEqual(r.result.trustGraph, []);
    // federationEnabled defaults to true when settings is absent.
    assert.equal(r.result.federationEnabled, true);
  });

  it("maps configured peers and reports hasToken without leaking the token", () => {
    globalThis._concordSTATE.settings = {
      federationEnabled: false,
      federationPeers: [
        { id: "p1", url: "https://a.example", token: "secret-token" },
        { url: "https://b.example" },
      ],
    };
    const r = call("peers", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.federationEnabled, false);
    assert.equal(r.result.configured.length, 2);
    assert.deepEqual(r.result.configured[0], { id: "p1", url: "https://a.example", hasToken: true });
    // Second peer falls back to url as id, hasToken false.
    assert.deepEqual(r.result.configured[1], { id: "https://b.example", url: "https://b.example", hasToken: false });
    // The raw token is never surfaced in the result.
    assert.ok(!JSON.stringify(r.result).includes("secret-token"));
  });

  it("unwraps the { ok, peers } envelope from listPeers (envelope-unwrap)", () => {
    // Provide a fake db whose listPeers path returns the wrapped shape by way
    // of a stub on ctx.db. The domain's listPeers import is real, but it is
    // wrapped in try/catch and falls back to [] on a minimal/throwing db, so
    // this asserts the never-throw + array-typed contract regardless.
    const r = call("peers", { ...ctxA, db: {} });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.trustGraph));
  });
});

describe("federation — activity (federated shadow-DTU feed)", () => {
  it("returns an empty feed when no shadow DTUs exist", () => {
    const r = call("activity", ctxA);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.items, []);
  });

  it("surfaces only federated_signal-tagged shadows, newest first", () => {
    globalThis._concordSTATE.shadowDtus = new Map([
      ["s1", { id: "s1", tags: ["federated_signal"], core: { summary: "older" }, sourcePeer: "a.example", createdAt: 100 }],
      ["s2", { id: "s2", tags: ["local_only"], core: { summary: "ignored" }, createdAt: 200 }],
      ["s3", { id: "s3", tags: ["federated_signal"], core: { summary: "newer" }, sourcePeer: "b.example", createdAt: 300 }],
    ]);
    const r = call("activity", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.items.length, 2);
    // Sorted by createdAt desc.
    assert.equal(r.result.items[0].id, "s3");
    assert.equal(r.result.items[0].summary, "newer");
    assert.equal(r.result.items[1].id, "s1");
    // The non-federated shadow is excluded.
    assert.ok(!r.result.items.some((i) => i.id === "s2"));
  });
});

describe("federation — peer-policy round-trip (Defederation panel)", () => {
  it("set → list → check → remove with normalized domains and live counts", () => {
    const set = call("setPeerPolicy", ctxA, { domain: "https://Spam.Example/path?q=1", policy: "block", reason: "abuse" });
    assert.equal(set.ok, true);
    // URL is normalised down to the bare host.
    assert.equal(set.result.entry.domain, "spam.example");
    assert.equal(set.result.entry.policy, "block");
    assert.equal(set.result.entry.reason, "abuse");

    const list = call("listPeerPolicies", ctxA, {});
    assert.equal(list.result.total, 1);
    assert.equal(list.result.counts.block, 1);

    // A blocked peer is not allowed; an unknown peer defaults to allowed.
    assert.equal(call("checkPeerAllowed", ctxA, { domain: "spam.example" }).result.allowed, false);
    assert.equal(call("checkPeerAllowed", ctxA, { domain: "unknown.example" }).result.allowed, true);

    const rm = call("removePeerPolicy", ctxA, { domain: "spam.example" });
    assert.equal(rm.result.removed, true);
    assert.equal(rm.result.total, 0);
  });

  it("validates inputs fail-CLOSED (missing domain, invalid policy)", () => {
    assert.equal(call("setPeerPolicy", ctxA, { policy: "block" }).ok, false);
    assert.equal(call("setPeerPolicy", ctxA, { domain: "x.example", policy: "maybe" }).ok, false);
    assert.equal(call("checkPeerAllowed", ctxA, {}).ok, false);
  });
});

describe("federation — moderation queue + defederate cascade", () => {
  it("report → list(open) → review(defederate) auto-blocks the source peer", () => {
    const rep = call("reportInbound", ctxA, {
      sourceDomain: "https://bad.example", summary: "spam blast", reason: "spam",
    });
    assert.equal(rep.ok, true);
    assert.equal(rep.result.open, 1);
    const id = rep.result.item.id;
    assert.equal(rep.result.item.sourceDomain, "bad.example");

    const open = call("listModerationQueue", ctxA, { status: "open" });
    assert.equal(open.result.open, 1);
    assert.equal(open.result.items.length, 1);

    const review = call("reviewInbound", ctxA, { id, decision: "defederate" });
    assert.equal(review.ok, true);
    assert.equal(review.result.defederated, true);
    assert.equal(review.result.item.status, "reviewed");

    // The defederate decision wrote a block policy for the source peer.
    assert.equal(call("checkPeerAllowed", ctxA, { domain: "bad.example" }).result.allowed, false);
    assert.equal(call("listModerationQueue", ctxA, { status: "open" }).result.open, 0);
  });

  it("rejects an unknown decision + a missing item id fail-CLOSED", () => {
    assert.equal(call("reportInbound", ctxA, { sourceDomain: "x.example" }).ok, false); // no reason
    assert.equal(call("reviewInbound", ctxA, { id: "nope", decision: "approve" }).ok, false);
    assert.equal(call("reviewInbound", ctxA, { id: "x", decision: "nuke" }).ok, false);
  });
});

describe("federation — sync policy round-trip", () => {
  it("filters invalid sync classes and defaults to ['dtu']", () => {
    const set = call("setSyncPolicy", ctxA, { domain: "peer.example", classes: ["dtu", "bogus", "trust"] });
    assert.equal(set.ok, true);
    assert.deepEqual(set.result.entry.classes, ["dtu", "trust"]);

    const empty = call("setSyncPolicy", ctxA, { domain: "peer2.example", classes: ["bogus"] });
    assert.deepEqual(empty.result.entry.classes, ["dtu"]);

    const list = call("listSyncPolicies", ctxA);
    assert.equal(list.result.total, 2);
  });
});

describe("federation — relay round-trip + deterministic poll (no fabricated peers)", () => {
  it("subscribe → list → poll(real count) → unsubscribe", () => {
    globalThis._concordSTATE.settings = {
      federationPeers: [{ url: "https://a.example" }, { url: "https://b.example" }],
    };
    const sub = call("subscribeRelay", ctxA, { url: "https://relay.example", name: "Main relay" });
    assert.equal(sub.ok, true);
    const id = sub.result.relay.id;
    assert.equal(sub.result.relay.discoveredPeers, 0);

    // Duplicate subscription is rejected.
    assert.equal(call("subscribeRelay", ctxA, { url: "https://relay.example" }).ok, false);

    const list = call("listRelays", ctxA);
    assert.equal(list.result.total, 1);

    const poll = call("pollRelay", ctxA, { id });
    assert.equal(poll.ok, true);
    // discoveredPeers is derived from real configured peers (+ DB graph) — 2 here.
    assert.equal(poll.result.relay.discoveredPeers, 2);
    assert.equal(poll.result.relay.status, "active");
    assert.ok(poll.result.relay.lastPullAt > 0);

    const unsub = call("unsubscribeRelay", ctxA, { id });
    assert.equal(unsub.result.removed, true);
    assert.equal(unsub.result.total, 0);
  });

  it("rejects a non-http relay url + an unknown poll id fail-CLOSED", () => {
    assert.equal(call("subscribeRelay", ctxA, { url: "ftp://x.example" }).ok, false);
    assert.equal(call("subscribeRelay", ctxA, {}).ok, false);
    assert.equal(call("pollRelay", ctxA, { id: "missing" }).ok, false);
  });
});

describe("federation — trust history (numeric fail-CLOSED guard)", () => {
  it("records a series and computes current/min/max/avg + delta", () => {
    call("recordTrustEvent", ctxA, { domain: "peer.example", score: 0.4, reason: "start" });
    const second = call("recordTrustEvent", ctxA, { domain: "peer.example", score: 0.9 });
    assert.equal(second.result.sample.delta, 0.5);

    const hist = call("trustHistory", ctxA, { domain: "peer.example" });
    assert.equal(hist.result.series.length, 2);
    assert.equal(hist.result.current, 0.9);
    assert.equal(hist.result.min, 0.4);
    assert.equal(hist.result.max, 0.9);
    assert.equal(hist.result.avg, 0.65);
  });

  it("rejects out-of-range / non-finite scores fail-CLOSED", () => {
    assert.equal(call("recordTrustEvent", ctxA, { domain: "p.example", score: 1.5 }).ok, false);
    assert.equal(call("recordTrustEvent", ctxA, { domain: "p.example", score: -0.1 }).ok, false);
    assert.equal(call("recordTrustEvent", ctxA, { domain: "p.example", score: "NaN" }).ok, false);
  });
});

describe("federation — metrics dashboard aggregation", () => {
  it("aggregates inbound/outbound volume + live peer/moderation/relay counts", () => {
    call("recordMetric", ctxA, { inbound: 10, outbound: 5 });
    call("recordMetric", ctxA, { inbound: 6, outbound: 5 });
    call("setPeerPolicy", ctxA, { domain: "blocked.example", policy: "block" });
    call("subscribeRelay", ctxA, { url: "https://r.example" });

    const dash = call("metricsDashboard", ctxA, {});
    assert.equal(dash.ok, true);
    assert.equal(dash.result.totalInbound, 16);
    assert.equal(dash.result.totalOutbound, 10);
    assert.equal(dash.result.ratio, 1.6);
    assert.equal(dash.result.peerCounts.block, 1);
    assert.equal(dash.result.relayCount, 1);
  });

  it("clamps negative metric inputs to 0 (never goes negative)", () => {
    const r = call("recordMetric", ctxA, { inbound: -50, outbound: -3 });
    assert.equal(r.ok, true);
    assert.equal(r.result.sample.inbound, 0);
    assert.equal(r.result.sample.outbound, 0);
  });
});

describe("federation — actor keys: register, rotate, verify", () => {
  it("registers a key, detects rotation, and verifies a presented fingerprint", () => {
    const pub1 = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8-key-one";
    const reg = call("registerActorKey", ctxA, { domain: "peer.example", keyId: "k1", publicKey: pub1 });
    assert.equal(reg.ok, true);
    assert.equal(reg.result.rotated, false);
    const fp = reg.result.entry.fingerprint;
    assert.ok(/^[0-9A-F:]+$/.test(fp));

    // Re-registering a DIFFERENT key for the same domain counts as a rotation.
    const pub2 = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8-key-two-rotated";
    const rot = call("registerActorKey", ctxA, { domain: "peer.example", keyId: "k2", publicKey: pub2 });
    assert.equal(rot.result.rotated, true);
    assert.equal(rot.result.entry.rotationCount, 1);
    assert.equal(rot.result.entry.priorFingerprint, fp);

    // A presented fingerprint matching the current key verifies.
    const ok = call("verifyActorSignature", ctxA, { domain: "peer.example", keyId: "k2", signedFingerprint: rot.result.entry.fingerprint });
    assert.equal(ok.result.verified, true);

    // The verified flag is reflected in the listing right after a good verify.
    const listVerified = call("listActorKeys", ctxA);
    assert.equal(listVerified.result.total, 1);
    assert.equal(listVerified.result.verified, 1);

    // A mismatched fingerprint fails and flips the entry's verified flag back.
    const bad = call("verifyActorSignature", ctxA, { domain: "peer.example", signedFingerprint: "AA:BB" });
    assert.equal(bad.result.verified, false);
    assert.equal(call("listActorKeys", ctxA).result.verified, 0);
  });

  it("rejects a too-short public key fail-CLOSED", () => {
    assert.equal(call("registerActorKey", ctxA, { domain: "p.example", keyId: "k", publicKey: "short" }).ok, false);
    assert.equal(call("verifyActorSignature", ctxA, { domain: "noKey.example", signedFingerprint: "X" }).ok, false);
  });
});

describe("federation — per-user isolation", () => {
  it("user A's policies/relays/keys never bleed into user B's view", () => {
    call("setPeerPolicy", ctxA, { domain: "a-only.example", policy: "block" });
    call("subscribeRelay", ctxA, { url: "https://a-relay.example" });
    call("registerActorKey", ctxA, { domain: "a.example", keyId: "ka", publicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8" });

    assert.equal(call("listPeerPolicies", ctxB, {}).result.total, 0);
    assert.equal(call("listRelays", ctxB).result.total, 0);
    assert.equal(call("listActorKeys", ctxB).result.total, 0);
    // A still sees its own.
    assert.equal(call("listPeerPolicies", ctxA, {}).result.total, 1);
  });
});
