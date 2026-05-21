// Contract tests for server/domains/anon.js — the privacy-analytics
// macros plus the real X25519 + AES-256-GCM E2E pseudonymous messaging
// substrate (identity, safety numbers, group conversations, sealed
// sender, server-side ephemeral sweeping, disappearing defaults).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerAnonActions from "../domains/anon.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifact, params = {}) {
  const fn = ACTIONS.get(`anon.${name}`);
  if (!fn) throw new Error(`anon.${name} not registered`);
  return fn(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAnonActions(register); });

// Fresh substrate state between tests.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "anon_user_a" }, userId: "anon_user_a" };
const ctxB = { actor: { userId: "anon_user_b" }, userId: "anon_user_b" };
const ctxC = { actor: { userId: "anon_user_c" }, userId: "anon_user_c" };

describe("anon — privacy analytics macros", () => {
  it("anonymize achieves k-anonymity via generalization", () => {
    const artifact = {
      data: {
        records: [
          { age: 23, zip: 90210, disease: "flu" },
          { age: 24, zip: 90211, disease: "flu" },
          { age: 25, zip: 90212, disease: "cold" },
          { age: 26, zip: 90213, disease: "cold" },
          { age: 27, zip: 90214, disease: "flu" },
          { age: 28, zip: 90215, disease: "cold" },
        ],
        quasiIdentifiers: ["age", "zip"],
        sensitiveFields: ["disease"],
      },
    };
    const r = call("anonymize", ctxA, artifact, { k: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.kAchieved, true);
    assert.ok(r.result.equivalenceClasses >= 1);
  });

  it("privacyRisk computes prosecutor/journalist/marketer models", () => {
    const artifact = {
      data: {
        records: [
          { age: 23, zip: 90210 },
          { age: 24, zip: 90211 },
        ],
        quasiIdentifiers: ["age", "zip"],
      },
    };
    const r = call("privacyRisk", ctxA, artifact, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.attackModels.prosecutor.risk >= 0);
    assert.ok(["low", "moderate", "high", "critical"].includes(r.result.overallRiskLevel));
  });

  it("differentialPrivacy adds Laplace noise with epsilon budget", () => {
    const artifact = { data: { values: [10, 20, 30, 40] } };
    const r = call("differentialPrivacy", ctxA, artifact, { epsilon: 1.0 });
    assert.equal(r.ok, true);
    assert.equal(r.result.privacyParameters.epsilon, 1.0);
    assert.ok(r.result.budgetTracking.cumulative > 0);
  });
});

describe("anon — pseudonymous identity", () => {
  it("identity lazily mints an X25519 keypair, never leaks the private key", () => {
    const r = call("identity", ctxA, null, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.anonId);
    assert.ok(r.result.publicKey);
    assert.ok(r.result.fingerprint);
    assert.equal(r.result.privateKey, undefined);
  });

  it("identity is stable across calls for the same user", () => {
    const a1 = call("identity", ctxA, null, {}).result;
    const a2 = call("identity", ctxA, null, {}).result;
    assert.equal(a1.anonId, a2.anonId);
  });

  it("rotateIdentity mints a fresh unlinkable anonId", () => {
    const before = call("identity", ctxA, null, {}).result;
    const rotated = call("rotateIdentity", ctxA, null, {});
    assert.equal(rotated.ok, true);
    assert.notEqual(rotated.result.anonId, before.anonId);
    assert.ok(rotated.result.rotatedAt);
  });

  it("directory lists peers without exposing private keys", () => {
    call("identity", ctxA, null, {});
    call("identity", ctxB, null, {});
    const r = call("directory", ctxA, null, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.peers[0].privateKey, undefined);
  });
});

describe("anon — verified key exchange / safety numbers", () => {
  it("safetyNumber returns a deterministic 12-group code", () => {
    const a = call("identity", ctxA, null, {}).result;
    const b = call("identity", ctxB, null, {}).result;
    const r1 = call("safetyNumber", ctxA, null, { peerAnonId: b.anonId });
    const r2 = call("safetyNumber", ctxB, null, { peerAnonId: a.anonId });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.safetyNumber.length, 12);
    // Both sides derive the same code.
    assert.deepEqual(r1.result.safetyNumber, r2.result.safetyNumber);
  });

  it("verifyPeer marks and revokes a peer", () => {
    call("identity", ctxA, null, {});
    const b = call("identity", ctxB, null, {}).result;
    const v = call("verifyPeer", ctxA, null, { peerAnonId: b.anonId, verified: true });
    assert.equal(v.ok, true);
    assert.equal(v.result.verified, true);
    assert.equal(v.result.verifiedPeerCount, 1);
    const rev = call("verifyPeer", ctxA, null, { peerAnonId: b.anonId, verified: false });
    assert.equal(rev.result.verifiedPeerCount, 0);
  });

  it("safetyNumber rejects an unknown peer", () => {
    call("identity", ctxA, null, {});
    const r = call("safetyNumber", ctxA, null, { peerAnonId: "aid_nope" });
    assert.equal(r.ok, false);
  });
});

describe("anon — E2E encrypted direct conversations", () => {
  it("round-trips an encrypted message — plaintext never stored", () => {
    const a = call("identity", ctxA, null, {}).result;
    const b = call("identity", ctxB, null, {}).result;
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [b.anonId] });
    assert.equal(conv.ok, true);
    assert.equal(conv.result.kind, "direct");
    const cid = conv.result.conversationId;

    const sent = call("sendMessage", ctxA, null, { conversationId: cid, content: "secret hello" });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.encrypted, true);

    // Stored record carries only ciphertext envelopes.
    const conv2 = globalThis._concordSTATE.anonLens.conversations.get(cid);
    const storedMsg = conv2.messages[0];
    assert.ok(storedMsg.envelopes[a.anonId].ciphertext);
    assert.ok(!JSON.stringify(storedMsg.envelopes).includes("secret hello"));

    // Recipient decrypts.
    const read = call("readConversation", ctxB, null, { conversationId: cid });
    assert.equal(read.ok, true);
    assert.equal(read.result.messages[0].content, "secret hello");
  });

  it("rejects sendMessage from a non-member", () => {
    const b = call("identity", ctxB, null, {}).result;
    call("identity", ctxC, null, {});
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [b.anonId] });
    const r = call("sendMessage", ctxC, null, {
      conversationId: conv.result.conversationId,
      content: "intrude",
    });
    assert.equal(r.ok, false);
  });

  it("listConversations surfaces conversations for a member", () => {
    const b = call("identity", ctxB, null, {}).result;
    call("startConversation", ctxA, null, { peerAnonIds: [b.anonId] });
    const r = call("listConversations", ctxA, null, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
  });
});

describe("anon — group conversations", () => {
  it("startConversation with multiple peers creates a group every member can read", () => {
    const b = call("identity", ctxB, null, {}).result;
    const c = call("identity", ctxC, null, {}).result;
    const conv = call("startConversation", ctxA, null, {
      peerAnonIds: [b.anonId, c.anonId],
      title: "Cell 7",
    });
    assert.equal(conv.ok, true);
    assert.equal(conv.result.kind, "group");
    assert.equal(conv.result.title, "Cell 7");
    const cid = conv.result.conversationId;

    call("sendMessage", ctxA, null, { conversationId: cid, content: "group ping" });
    const readB = call("readConversation", ctxB, null, { conversationId: cid });
    const readC = call("readConversation", ctxC, null, { conversationId: cid });
    assert.equal(readB.result.messages[0].content, "group ping");
    assert.equal(readC.result.messages[0].content, "group ping");
  });
});

describe("anon — sealed sender / metadata minimization", () => {
  it("sealed-sender messages strip fromAnonId from the stored record", () => {
    const b = call("identity", ctxB, null, {}).result;
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [b.anonId] });
    const cid = conv.result.conversationId;
    const sent = call("sendMessage", ctxA, null, {
      conversationId: cid,
      content: "anonymous tip",
      sealedSender: true,
    });
    assert.equal(sent.result.sealedSender, true);
    const read = call("readConversation", ctxB, null, { conversationId: cid });
    const msg = read.result.messages[0];
    assert.equal(msg.sealedSender, true);
    assert.equal(msg.fromAnonId, null);
    // Content still decrypts despite hidden sender.
    assert.equal(msg.content, "anonymous tip");
  });
});

describe("anon — disappearing messages + ephemeral sweep", () => {
  it("setDisappearing applies a per-conversation default to new messages", () => {
    const b = call("identity", ctxB, null, {}).result;
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [b.anonId] });
    const cid = conv.result.conversationId;
    const set = call("setDisappearing", ctxA, null, { conversationId: cid, disappearDefaultSec: 300 });
    assert.equal(set.ok, true);
    assert.equal(set.result.disappearDefaultSec, 300);
    const sent = call("sendMessage", ctxA, null, { conversationId: cid, content: "fades soon" });
    assert.ok(sent.result.expiresAt > Date.now());
  });

  it("sweepEphemeral purges messages whose timer has elapsed", () => {
    const b = call("identity", ctxB, null, {}).result;
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [b.anonId] });
    const cid = conv.result.conversationId;
    call("sendMessage", ctxA, null, { conversationId: cid, content: "burn me", ephemeralSec: 1 });
    // Force the stored message into the past.
    const stored = globalThis._concordSTATE.anonLens.conversations.get(cid);
    stored.messages[0].expiresAt = Date.now() - 1000;
    const r = call("sweepEphemeral", ctxA, null, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalRemoved, 1);
    const read = call("readConversation", ctxA, null, { conversationId: cid });
    assert.equal(read.result.messageCount, 0);
  });

  it("readConversation auto-sweeps expired messages on open", () => {
    const b = call("identity", ctxB, null, {}).result;
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [b.anonId] });
    const cid = conv.result.conversationId;
    call("sendMessage", ctxA, null, { conversationId: cid, content: "gone", ephemeralSec: 1 });
    const stored = globalThis._concordSTATE.anonLens.conversations.get(cid);
    stored.messages[0].expiresAt = Date.now() - 5000;
    const read = call("readConversation", ctxB, null, { conversationId: cid });
    assert.equal(read.result.sweptExpired, 1);
    assert.equal(read.result.messageCount, 0);
  });
});
