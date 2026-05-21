// Contract tests for server/domains/federation.js — fediverse-style
// instance admin macros: allowlist/blocklist, inbound moderation queue,
// per-peer sync policy, relay subscriptions, trust-score history,
// activity metrics, signed-actor key verification + rotation.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFederationActions from "../domains/federation.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`federation.${name}`);
  if (!fn) throw new Error(`federation.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFederationActions(register); });

beforeEach(() => {
  // Reset per-user federation state between tests.
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.federation;
});

const ctx = { actor: { userId: "fed_user" }, userId: "fed_user" };

describe("federation — allowlist / blocklist / defederation", () => {
  it("sets and lists a peer policy", () => {
    const set = call("setPeerPolicy", ctx, { domain: "https://bad.example/path", policy: "block", reason: "spam" });
    assert.equal(set.ok, true);
    assert.equal(set.result.entry.domain, "bad.example");
    assert.equal(set.result.entry.policy, "block");

    const list = call("listPeerPolicies", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.counts.block, 1);
  });

  it("rejects an invalid policy value", () => {
    const r = call("setPeerPolicy", ctx, { domain: "x.example", policy: "maybe" });
    assert.equal(r.ok, false);
  });

  it("checkPeerAllowed defaults to allow and honours blocks", () => {
    assert.equal(call("checkPeerAllowed", ctx, { domain: "unknown.example" }).result.allowed, true);
    call("setPeerPolicy", ctx, { domain: "blocked.example", policy: "block" });
    assert.equal(call("checkPeerAllowed", ctx, { domain: "blocked.example" }).result.allowed, false);
  });

  it("removes a peer policy", () => {
    call("setPeerPolicy", ctx, { domain: "drop.example", policy: "allow" });
    const r = call("removePeerPolicy", ctx, { domain: "drop.example" });
    assert.equal(r.ok, true);
    assert.equal(r.result.removed, true);
    assert.equal(r.result.total, 0);
  });
});

describe("federation — inbound moderation queue", () => {
  it("reports content and lists open items", () => {
    const rep = call("reportInbound", ctx, { sourceDomain: "src.example", summary: "junk", reason: "spam" });
    assert.equal(rep.ok, true);
    assert.equal(rep.result.open, 1);

    const list = call("listModerationQueue", ctx, { status: "open" });
    assert.equal(list.ok, true);
    assert.equal(list.result.open, 1);
  });

  it("rejects a report missing a reason", () => {
    const r = call("reportInbound", ctx, { sourceDomain: "src.example" });
    assert.equal(r.ok, false);
  });

  it("review with defederate auto-blocks the source peer", () => {
    const rep = call("reportInbound", ctx, { sourceDomain: "evil.example", reason: "abuse" });
    const review = call("reviewInbound", ctx, { id: rep.result.item.id, decision: "defederate" });
    assert.equal(review.ok, true);
    assert.equal(review.result.defederated, true);
    assert.equal(call("checkPeerAllowed", ctx, { domain: "evil.example" }).result.allowed, false);
  });

  it("rejects an unknown moderation id", () => {
    const r = call("reviewInbound", ctx, { id: "nope", decision: "approve" });
    assert.equal(r.ok, false);
  });
});

describe("federation — per-peer sync policy", () => {
  it("sets and lists a sync policy with filtered classes", () => {
    const set = call("setSyncPolicy", ctx, {
      domain: "peer.example", inbound: true, outbound: false, classes: ["dtu", "trust", "bogus"],
    });
    assert.equal(set.ok, true);
    assert.deepEqual(set.result.entry.classes, ["dtu", "trust"]);
    assert.equal(set.result.entry.outbound, false);

    const list = call("listSyncPolicies", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
  });

  it("rejects a sync policy with no domain", () => {
    assert.equal(call("setSyncPolicy", ctx, { classes: ["dtu"] }).ok, false);
  });
});

describe("federation — relay subscriptions", () => {
  it("subscribes, polls and unsubscribes a relay", () => {
    const sub = call("subscribeRelay", ctx, { url: "https://relay.example", name: "Big Relay" });
    assert.equal(sub.ok, true);
    const id = sub.result.relay.id;

    const list = call("listRelays", ctx, {});
    assert.equal(list.result.total, 1);

    const poll = call("pollRelay", ctx, { id });
    assert.equal(poll.ok, true);
    assert.ok(poll.result.relay.lastPullAt > 0);

    const unsub = call("unsubscribeRelay", ctx, { id });
    assert.equal(unsub.ok, true);
    assert.equal(unsub.result.total, 0);
  });

  it("rejects a duplicate relay and a non-http url", () => {
    call("subscribeRelay", ctx, { url: "https://relay.example" });
    assert.equal(call("subscribeRelay", ctx, { url: "https://relay.example" }).ok, false);
    assert.equal(call("subscribeRelay", ctx, { url: "ftp://relay.example" }).ok, false);
  });
});

describe("federation — trust-score history", () => {
  it("records trust events and returns a timeline with stats", () => {
    call("recordTrustEvent", ctx, { domain: "p.example", score: 0.5, reason: "init" });
    call("recordTrustEvent", ctx, { domain: "p.example", score: 0.8, reason: "good sync" });

    const hist = call("trustHistory", ctx, { domain: "p.example" });
    assert.equal(hist.ok, true);
    assert.equal(hist.result.series.length, 2);
    assert.equal(hist.result.current, 0.8);
    assert.equal(hist.result.max, 0.8);
  });

  it("rejects an out-of-range score", () => {
    assert.equal(call("recordTrustEvent", ctx, { domain: "p.example", score: 5 }).ok, false);
  });
});

describe("federation — activity metrics", () => {
  it("records metrics and aggregates a dashboard", () => {
    call("recordMetric", ctx, { inbound: 10, outbound: 4, label: "pass-1" });
    call("recordMetric", ctx, { inbound: 6, outbound: 6, label: "pass-2" });

    const dash = call("metricsDashboard", ctx, {});
    assert.equal(dash.ok, true);
    assert.equal(dash.result.totalInbound, 16);
    assert.equal(dash.result.totalOutbound, 10);
    assert.equal(dash.result.series.length, 2);
  });
});

describe("federation — signed-actor key verification + rotation", () => {
  it("registers an actor key and verifies a matching fingerprint", () => {
    const reg = call("registerActorKey", ctx, {
      domain: "signed.example", keyId: "signed#main", publicKey: "MIIBIjANBgkqhkiG9w0BPUBLICKEY",
    });
    assert.equal(reg.ok, true);
    assert.equal(reg.result.rotated, false);
    const fp = reg.result.entry.fingerprint;

    const verify = call("verifyActorSignature", ctx, {
      domain: "signed.example", keyId: "signed#main", signedFingerprint: fp,
    });
    assert.equal(verify.ok, true);
    assert.equal(verify.result.verified, true);
  });

  it("detects a key rotation when a different key is registered", () => {
    call("registerActorKey", ctx, { domain: "rot.example", keyId: "k1", publicKey: "FIRSTKEYMATERIAL1234" });
    const rot = call("registerActorKey", ctx, { domain: "rot.example", keyId: "k2", publicKey: "SECONDKEYMATERIAL5678" });
    assert.equal(rot.ok, true);
    assert.equal(rot.result.rotated, true);
    assert.equal(rot.result.entry.rotationCount, 1);
    assert.ok(rot.result.entry.priorFingerprint);
  });

  it("listActorKeys reports verified counts", () => {
    const reg = call("registerActorKey", ctx, { domain: "v.example", keyId: "vk", publicKey: "VERIFIABLEKEYMATERIAL" });
    call("verifyActorSignature", ctx, { domain: "v.example", signedFingerprint: reg.result.entry.fingerprint });
    const list = call("listActorKeys", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.verified, 1);
  });

  it("rejects an actor key that is too short", () => {
    assert.equal(call("registerActorKey", ctx, { domain: "x.example", keyId: "k", publicKey: "short" }).ok, false);
  });
});
