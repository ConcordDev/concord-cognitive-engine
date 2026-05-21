// Contract tests for server/domains/mesh.js — the Meshtastic / Briar
// feature-parity layer over the 7-transport routing substrate.
// Exercises every registered mesh.* domain macro and asserts ok.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerMeshActions from "../domains/mesh.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`mesh.${name}`);
  if (!fn) throw new Error(`mesh.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMeshActions(register); });

// Each test user is isolated so persistent state doesn't bleed.
let seq = 0;
function freshCtx() {
  const uid = `mesh_user_${++seq}`;
  return { actor: { userId: uid }, userId: uid };
}

describe("mesh topology + node management", () => {
  it("meshMap returns a graph with the self node", () => {
    const r = call("meshMap", freshCtx());
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.nodes));
    assert.equal(r.result.nodes[0].id, "self");
    assert.ok(r.result.onlineCount >= 1);
  });

  it("addNode registers a named peer and listNodes shows presence", () => {
    const ctx = freshCtx();
    const add = call("addNode", ctx, { name: "Repeater-Hill", transports: ["lora"] });
    assert.equal(add.ok, true);
    assert.equal(add.result.node.name, "Repeater-Hill");
    const list = call("listNodes", ctx);
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.online, 1);
    assert.equal(list.result.nodes[0].online, true);
  });

  it("addNode rejects an empty name", () => {
    const r = call("addNode", freshCtx(), { name: "  " });
    assert.equal(r.ok, false);
  });

  it("pingNode refreshes presence and estimates RTT", () => {
    const ctx = freshCtx();
    const nodeId = call("addNode", ctx, { name: "P", transports: ["lora"], hops: 3 }).result.node.id;
    const r = call("pingNode", ctx, { nodeId });
    assert.equal(r.ok, true);
    assert.equal(r.result.online, true);
    assert.ok(r.result.rttMs > 0);
  });

  it("pingNode fails for an unknown node", () => {
    assert.equal(call("pingNode", freshCtx(), { nodeId: "nope" }).ok, false);
  });

  it("removeNode forgets a peer", () => {
    const ctx = freshCtx();
    const nodeId = call("addNode", ctx, { name: "Gone" }).result.node.id;
    assert.equal(call("removeNode", ctx, { nodeId }).result.removed, true);
    assert.equal(call("listNodes", ctx).result.total, 0);
  });
});

describe("mesh direct / group messaging", () => {
  it("sendMessage to an online node delivers; conversation + markRead work", () => {
    const ctx = freshCtx();
    const nodeId = call("addNode", ctx, { name: "Bob" }).result.node.id;
    const sent = call("sendMessage", ctx, { to: nodeId, body: "hello over mesh" });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.message.state, "delivered");
    const thread = call("conversation", ctx, { with: nodeId });
    assert.equal(thread.ok, true);
    assert.equal(thread.result.messages.length, 1);
    assert.equal(call("markRead", ctx, { with: nodeId }).ok, true);
  });

  it("sendMessage rejects an empty body", () => {
    assert.equal(call("sendMessage", freshCtx(), { to: "broadcast", body: "" }).ok, false);
  });

  it("broadcast messages are delivered without a node", () => {
    const r = call("sendMessage", freshCtx(), { to: "broadcast", body: "all stations" });
    assert.equal(r.ok, true);
    assert.equal(r.result.message.kind, "broadcast");
    assert.equal(r.result.message.state, "delivered");
  });
});

describe("mesh signal + coverage metrics", () => {
  it("signalMetrics returns one row per transport", () => {
    const r = call("signalMetrics", freshCtx());
    assert.equal(r.ok, true);
    assert.equal(r.result.metrics.length, 7);
    assert.ok(r.result.metrics.every((m) => typeof m.transport === "string"));
  });

  it("signalMetrics derives RSSI from observed node quality", () => {
    const ctx = freshCtx();
    call("addNode", ctx, { name: "N", transports: ["lora"], quality: 0.9 });
    const lora = call("signalMetrics", ctx).result.metrics.find((m) => m.transport === "lora");
    assert.ok(lora.rssiDbm != null);
    assert.equal(lora.peers, 1);
  });

  it("coverage scales reach with hop count", () => {
    const r = call("coverage", freshCtx(), { hops: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.hops, 5);
    const lora = r.result.estimates.find((e) => e.transport === "lora");
    assert.ok(lora.multiHopMeters > lora.perHopMeters);
  });
});

describe("mesh store-and-forward queue", () => {
  it("a message to an offline node is queued, retryable, and droppable", () => {
    const ctx = freshCtx();
    // Add a node, then age its lastSeen by mutating through addNode is not enough;
    // instead send to a never-seen id so the destination is unreachable.
    const sent = call("sendMessage", ctx, { to: "node_offline_xyz", body: "queue me" });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.queued, true);
    const q = call("queueList", ctx);
    assert.equal(q.ok, true);
    assert.equal(q.result.total, 1);
    const frameId = q.result.frames[0].id;
    const prio = call("queuePrioritize", ctx, { frameId, priority: "threat" });
    assert.equal(prio.result.priority, "threat");
    const retry = call("queueRetry", ctx, { frameId });
    assert.equal(retry.ok, true);
    assert.equal(retry.result.delivered, false);
    assert.equal(call("queueDrop", ctx, { frameId }).result.dropped, true);
    assert.equal(call("queueList", ctx).result.total, 0);
  });

  it("queuePrioritize rejects an invalid priority class", () => {
    assert.equal(call("queuePrioritize", freshCtx(), { frameId: "x", priority: "bogus" }).ok, false);
  });
});

describe("mesh group channels + encryption", () => {
  it("createChannel with a strong PSK reports aes-256 and never leaks the key", () => {
    const ctx = freshCtx();
    const r = call("createChannel", ctx, { name: "relay-ops", psk: "a".repeat(40) });
    assert.equal(r.ok, true);
    assert.equal(r.result.channel.encrypted, true);
    assert.equal(r.result.channel.keyStrength, "aes-256");
    assert.equal(r.result.channel.psk, "********");
  });

  it("createChannel rejects an empty name", () => {
    assert.equal(call("createChannel", freshCtx(), { name: "" }).ok, false);
  });

  it("listChannels masks the PSK and counts encrypted channels", () => {
    const ctx = freshCtx();
    call("createChannel", ctx, { name: "open" });
    call("createChannel", ctx, { name: "secure", psk: "x".repeat(20) });
    const list = call("listChannels", ctx);
    assert.equal(list.result.total, 2);
    assert.equal(list.result.encrypted, 1);
    assert.ok(list.result.channels.every((c) => c.psk == null || c.psk === "********"));
  });

  it("setChannelKey rotates and clears a channel key", () => {
    const ctx = freshCtx();
    const id = call("createChannel", ctx, { name: "c" }).result.channel.id;
    const enc = call("setChannelKey", ctx, { channelId: id, psk: "y".repeat(32) });
    assert.equal(enc.result.encrypted, true);
    assert.equal(enc.result.keyStrength, "aes-256");
    const cleared = call("setChannelKey", ctx, { channelId: id, psk: "" });
    assert.equal(cleared.result.encrypted, false);
  });

  it("deleteChannel removes a channel", () => {
    const ctx = freshCtx();
    const id = call("createChannel", ctx, { name: "tmp" }).result.channel.id;
    assert.equal(call("deleteChannel", ctx, { channelId: id }).result.removed, true);
    assert.equal(call("listChannels", ctx).result.total, 0);
  });
});

describe("mesh overview roll-up", () => {
  it("overview aggregates nodes, messages, channels, queue depth", () => {
    const ctx = freshCtx();
    call("addNode", ctx, { name: "A" });
    call("createChannel", ctx, { name: "ch", psk: "z".repeat(32) });
    call("sendMessage", ctx, { to: "broadcast", body: "hi" });
    const r = call("overview", ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.nodes, 1);
    assert.equal(r.result.channels, 1);
    assert.equal(r.result.encryptedChannels, 1);
    assert.ok(r.result.messages >= 1);
    assert.equal(r.result.transports, 7);
  });
});
