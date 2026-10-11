// Client-held Anonymous messaging (CONCORD_ANON_CLIENT_E2E=1).
// The private key stays with the caller. sendMessage must reject plaintext,
// and readConversation must not return it. Existing server-held identities
// are not replaced when the flag is later turned on.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import registerAnonActions from "../domains/anon.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifact, params = {}) {
  const fn = ACTIONS.get(`anon.${name}`);
  if (!fn) throw new Error(`anon.${name} not registered`);
  return fn(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

before(() => { registerAnonActions(register); });

const prevFlag = process.env.CONCORD_ANON_CLIENT_E2E;
beforeEach(() => {
  globalThis._concordSTATE = {};
  delete process.env.CONCORD_ANON_CLIENT_E2E;
});
afterEach(() => {
  if (prevFlag === undefined) delete process.env.CONCORD_ANON_CLIENT_E2E;
  else process.env.CONCORD_ANON_CLIENT_E2E = prevFlag;
});

const ctxA = { actor: { userId: "e2e_user_a" }, userId: "e2e_user_a" };
const ctxB = { actor: { userId: "e2e_user_b" }, userId: "e2e_user_b" };

function x25519() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
  return {
    publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
  };
}

function sealEnvelope(myPrivB64, peerPubB64, plaintext) {
  const myPriv = crypto.createPrivateKey({
    key: Buffer.from(myPrivB64, "base64"), format: "der", type: "pkcs8",
  });
  const peerPub = crypto.createPublicKey({
    key: Buffer.from(peerPubB64, "base64"), format: "der", type: "spki",
  });
  const shared = crypto.diffieHellman({ privateKey: myPriv, publicKey: peerPub });
  const aesKey = crypto.createHash("sha256").update(shared).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function openEnvelope(myPrivB64, peerPubB64, env) {
  const myPriv = crypto.createPrivateKey({
    key: Buffer.from(myPrivB64, "base64"), format: "der", type: "pkcs8",
  });
  const peerPub = crypto.createPublicKey({
    key: Buffer.from(peerPubB64, "base64"), format: "der", type: "spki",
  });
  const shared = crypto.diffieHellman({ privateKey: myPriv, publicKey: peerPub });
  const aesKey = crypto.createHash("sha256").update(shared).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, Buffer.from(env.iv, "base64"));
  decipher.setAuthTag(Buffer.from(env.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(env.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

describe("anon — client-held keys", () => {
  it("ignores a client public key when the flag is off and still stores a private key", () => {
    const client = x25519();
    const r = call("identity", ctxA, null, { publicKey: client.publicKey });
    assert.equal(r.ok, true);
    assert.equal(r.result.keyCustody, "server");
    assert.notEqual(r.result.publicKey, client.publicKey);
    assert.equal(r.result.privateKey, undefined);
    const stored = globalThis._concordSTATE.anonLens.identities.get("e2e_user_a");
    assert.equal(typeof stored.privateKey, "string");
    assert.ok(stored.privateKey.length > 0);
  });

  it("stores only the public key when the flag is on", () => {
    process.env.CONCORD_ANON_CLIENT_E2E = "1";
    const client = x25519();
    const r = call("identity", ctxA, null, { publicKey: client.publicKey });
    assert.equal(r.ok, true);
    assert.equal(r.result.keyCustody, "client");
    assert.equal(r.result.privateKey, undefined);
    const stored = globalThis._concordSTATE.anonLens.identities.get("e2e_user_a");
    assert.equal(stored.privateKey, null);
    assert.equal(stored.keyCustody, "client");
    assert.equal(stored.publicKey, r.result.publicKey);
  });

  it("does not replace an existing server-held identity, so an old conversation still opens", () => {
    const first = call("identity", ctxA, null, {}).result;
    const peer = call("identity", ctxB, null, {}).result;
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [peer.anonId] });
    const cid = conv.result.conversationId;
    call("sendMessage", ctxA, null, { conversationId: cid, content: "still here" });

    process.env.CONCORD_ANON_CLIENT_E2E = "1";
    const client = x25519();
    const again = call("identity", ctxA, null, { publicKey: client.publicKey });
    assert.equal(again.result.anonId, first.anonId);
    assert.equal(again.result.keyCustody, "server");
    assert.notEqual(again.result.publicKey, client.publicKey);
    const stored = globalThis._concordSTATE.anonLens.identities.get("e2e_user_a");
    assert.equal(typeof stored.privateKey, "string");

    const read = call("readConversation", ctxB, null, { conversationId: cid });
    assert.equal(read.result.messages[0].content, "still here");
    const sent = call("sendMessage", ctxA, null, { conversationId: cid, content: "still writable" });
    assert.equal(sent.ok, true);
    const read2 = call("readConversation", ctxB, null, { conversationId: cid });
    assert.equal(read2.result.messages[1].content, "still writable");
  });

  it("rejects plaintext for a client-held sender and never stores it", () => {
    process.env.CONCORD_ANON_CLIENT_E2E = "1";
    const a = x25519();
    const b = x25519();
    const idA = call("identity", ctxA, null, { publicKey: a.publicKey }).result;
    const idB = call("identity", ctxB, null, { publicKey: b.publicKey }).result;
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [idB.anonId] });
    const cid = conv.result.conversationId;
    const secret = "plaintext must not land";
    const rejected = call("sendMessage", ctxA, null, { conversationId: cid, content: secret });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error, "plaintext_not_accepted");
    assert.equal(JSON.stringify(rejected).includes(secret), false);
    assert.equal(globalThis._concordSTATE.anonLens.conversations.get(cid).messages.length, 0);
    assert.equal(idA.keyCustody, "client");
  });

  it("accepts ciphertext only, and read does not return plaintext", () => {
    process.env.CONCORD_ANON_CLIENT_E2E = "1";
    const a = x25519();
    const b = x25519();
    const idA = call("identity", ctxA, null, { publicKey: a.publicKey }).result;
    const idB = call("identity", ctxB, null, { publicKey: b.publicKey }).result;
    const conv = call("startConversation", ctxA, null, { peerAnonIds: [idB.anonId] });
    const cid = conv.result.conversationId;
    const secret = "device-held secret";
    const envelopes = {
      [idA.anonId]: sealEnvelope(a.privateKey, idA.publicKey, secret),
      [idB.anonId]: sealEnvelope(a.privateKey, idB.publicKey, secret),
    };
    const sent = call("sendMessage", ctxA, null, {
      conversationId: cid,
      envelopes,
      sealedSender: false,
    });
    assert.equal(sent.ok, true);

    const storedMsg = globalThis._concordSTATE.anonLens.conversations.get(cid).messages[0];
    assert.equal(JSON.stringify(storedMsg).includes(secret), false);
    assert.equal(storedMsg.content, undefined);
    assert.equal(globalThis._concordSTATE.anonLens.identities.get("e2e_user_a").privateKey, null);
    assert.equal(globalThis._concordSTATE.anonLens.identities.get("e2e_user_b").privateKey, null);

    const read = call("readConversation", ctxB, null, { conversationId: cid });
    const msg = read.result.messages[0];
    assert.equal(msg.content, null);
    assert.equal(msg.clientDecrypt, true);
    assert.equal(JSON.stringify(read.result).includes(secret), false);
    assert.equal(openEnvelope(b.privateKey, msg.senderPublicKey, msg.envelope), secret);

    const directory = call("directory", ctxA, null, {});
    assert.equal(directory.result.peers[0].privateKey, undefined);
    assert.equal(directory.result.peers[0].keyCustody, "client");
  });
});
