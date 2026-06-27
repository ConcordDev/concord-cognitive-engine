// Behavioral macro tests for server/domains/mesh.js — the off-grid mesh
// usability layer (topology / messaging / signal / store-and-forward queue /
// encrypted channels) on top of the 7-transport routing substrate.
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// through the SHIM the default export installs (canonical register → the legacy
// (ctx, artifact, params) handler bodies), against the REAL in-memory
// globalThis._concordSTATE store the domain uses for persistence. These are NOT
// shape-only assertions: every test asserts ACTUAL values + multi-step
// round-trips (add node → list/ping/map; send offline → queue → bring node
// online → retry → delivered; create channel → set PSK → list masks key),
// per-user isolation, the fail-CLOSED numeric guards the macro-assassin's V2
// vector probes, and the disjoint-name contract vs the inline server.js mesh.*
// macros (no duplicate registration).
//
// LIGHTWEIGHT + hermetic: a local register harness, NO server boot, NO network,
// NO DB (mesh persists in STATE, not SQLite). Runs in well under 10s.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMeshActions from "../domains/mesh.js";

// The shim the domain installs adapts register(ctx, input) onto its legacy
// (ctx, artifact, params) handlers — so calling fn(ctx, input) here is exactly
// what runMacro / POST /api/lens/run would do.
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "mesh", `unexpected domain: ${domain}`);
  assert.equal(ACTIONS.has(name), false, `duplicate registration: mesh.${name}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`mesh.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerMeshActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

const MESH_MACROS = [
  "meshMap", "addNode", "listNodes", "pingNode", "removeNode",
  "sendMessage", "conversation", "markRead",
  "signalMetrics", "coverage",
  "queueList", "queueRetry", "queuePrioritize", "queueDrop",
  "createChannel", "listChannels", "setChannelKey", "deleteChannel",
  "overview",
];

// The inline server.js mesh.* macros (read the shared routing substrate). The
// domain macros MUST be disjoint from these — no name overlaps, no clobber.
const INLINE_SERVER_MACROS = [
  "status", "topology", "channels", "send", "pending",
  "stats", "relay", "peers", "transfer", "sync",
];

describe("mesh — registration + no collision with inline server.js macros", () => {
  it("registers every macro the lens calls, through the canonical register shim", () => {
    for (const m of MESH_MACROS) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing mesh.${m}`);
    }
  });

  it("uses names disjoint from the inline server.js mesh.* macros", () => {
    for (const m of INLINE_SERVER_MACROS) {
      assert.equal(ACTIONS.has(m), false, `domain re-defines inline mesh.${m} (duplicate)`);
    }
  });
});

describe("mesh — topology round-trip (addNode → listNodes → meshMap → ping → remove)", () => {
  it("adds a node, lists it online, maps it, pings it, then forgets it", () => {
    const added = call("addNode", ctxA, { name: "Field radio", transports: ["lora"], hops: 3, quality: 0.7 });
    assert.equal(added.ok, true);
    const node = added.result.node;
    assert.equal(node.name, "Field radio");
    assert.deepEqual(node.transports, ["lora"]);
    assert.equal(node.hops, 3);
    assert.equal(node.quality, 0.7);
    assert.ok(node.id, "node gets an id");

    // listNodes — just-added node reads as online (lastSeen within 5min)
    const listed = call("listNodes", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.total, 1);
    assert.equal(listed.result.online, 1);
    assert.equal(listed.result.nodes[0].id, node.id);
    assert.equal(listed.result.nodes[0].online, true);

    // meshMap — self node + the peer, one edge to "self"
    const map = call("meshMap", ctxA, {});
    assert.equal(map.ok, true);
    assert.equal(map.result.nodeCount, 2); // self + peer
    assert.equal(map.result.edgeCount, 1);
    assert.equal(map.result.edges[0].target, "self");
    assert.equal(map.result.onlineCount, 2);

    // pingNode — refreshes presence + derives a deterministic rtt > 0
    const ping = call("pingNode", ctxA, { nodeId: node.id });
    assert.equal(ping.ok, true);
    assert.equal(ping.result.online, true);
    assert.equal(ping.result.hops, 3);
    assert.ok(ping.result.rttMs > 0, "rtt is a positive derived estimate");

    // removeNode
    const removed = call("removeNode", ctxA, { nodeId: node.id });
    assert.equal(removed.ok, true);
    assert.equal(removed.result.removed, true);
    assert.equal(call("listNodes", ctxA, {}).result.total, 0);
  });

  it("renames an existing node in place when the same id is re-added", () => {
    const a = call("addNode", ctxA, { name: "Old name" });
    const id = a.result.node.id;
    const b = call("addNode", ctxA, { name: "New name", id });
    assert.equal(b.result.node.id, id, "same id reused");
    assert.equal(b.result.node.name, "New name");
    assert.equal(call("listNodes", ctxA, {}).result.total, 1, "no duplicate row");
  });

  it("rejects a node with no name", () => {
    assert.equal(call("addNode", ctxA, {}).error, "node name required");
    assert.equal(call("pingNode", ctxA, { nodeId: "nope" }).error, "node not found");
  });
});

describe("mesh — store-and-forward (offline send → queue → online retry → delivered)", () => {
  it("queues a message to an offline node, then delivers on retry once online", () => {
    // A node that has NEVER been seen → offline; sendMessage must queue.
    const offline = call("addNode", ctxA, { name: "Far node" });
    const nodeId = offline.result.node.id;
    // Force the node stale (offline) by backdating lastSeen.
    const s = globalThis._concordSTATE;
    const stored = s.meshNodes.get("user_a").get(nodeId);
    stored.lastSeen = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const sent = call("sendMessage", ctxA, { to: nodeId, body: "rendezvous at dawn" });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.queued, true);
    assert.equal(sent.result.message.state, "queued");
    const messageId = sent.result.message.id;

    // queueList shows exactly one pending frame with a real byte size
    const q = call("queueList", ctxA, {});
    assert.equal(q.result.total, 1);
    assert.equal(q.result.pending, 1);
    assert.ok(q.result.totalBytes > 0);
    const frameId = q.result.frames[0].id;

    // prioritize the frame to "threat" (highest)
    const pri = call("queuePrioritize", ctxA, { frameId, priority: "threat" });
    assert.equal(pri.ok, true);
    assert.equal(pri.result.priority, "threat");
    assert.equal(call("queuePrioritize", ctxA, { frameId, priority: "bogus" }).error, "invalid priority");

    // node still offline → retry leaves it queued
    let retry = call("queueRetry", ctxA, { frameId });
    assert.equal(retry.result.delivered, false);
    assert.equal(retry.result.attempts, 1);

    // bring the node online → retry delivers + dequeues + flips the message
    stored.lastSeen = new Date().toISOString();
    retry = call("queueRetry", ctxA, { frameId });
    assert.equal(retry.result.delivered, true);
    assert.equal(retry.result.attempts, 2);
    assert.equal(call("queueList", ctxA, {}).result.total, 0, "frame dequeued");

    const conv = call("conversation", ctxA, { with: nodeId });
    const msg = conv.result.messages.find((m) => m.id === messageId);
    assert.equal(msg.state, "delivered", "message promoted to delivered on retry");
  });

  it("delivers immediately to an online node (no queue) and reads a conversation", () => {
    const online = call("addNode", ctxA, { name: "Near node" });
    const nodeId = online.result.node.id;
    const sent = call("sendMessage", ctxA, { to: nodeId, body: "hi" });
    assert.equal(sent.result.queued, false);
    assert.equal(sent.result.message.state, "delivered");
    assert.equal(call("queueList", ctxA, {}).result.total, 0);

    const conv = call("conversation", ctxA, { with: nodeId });
    assert.equal(conv.result.total, 1);
    assert.equal(conv.result.messages[0].body, "hi");
  });

  it("drops a queued frame and marks the message failed", () => {
    const offline = call("addNode", ctxA, { name: "Gone" });
    const nodeId = offline.result.node.id;
    globalThis._concordSTATE.meshNodes.get("user_a").get(nodeId).lastSeen =
      new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const sent = call("sendMessage", ctxA, { to: nodeId, body: "x" });
    const frameId = call("queueList", ctxA, {}).result.frames[0].id;
    const dropped = call("queueDrop", ctxA, { frameId });
    assert.equal(dropped.result.dropped, true);
    assert.equal(call("queueList", ctxA, {}).result.total, 0);
    const conv = call("conversation", ctxA, {});
    assert.equal(conv.result.messages.find((m) => m.id === sent.result.message.id).state, "failed");
    assert.equal(call("queueRetry", ctxA, { frameId: "nope" }).error, "frame not found");
  });

  it("requires a non-empty message body", () => {
    assert.equal(call("sendMessage", ctxA, { to: "x" }).error, "message body required");
  });
});

describe("mesh — channels + PSK encryption (create → list masks key → rotate → delete)", () => {
  it("creates an encrypted channel, never returns the PSK in clear, and grades key strength", () => {
    const created = call("createChannel", ctxA, { name: "Ops", psk: "a".repeat(32) });
    assert.equal(created.ok, true);
    assert.equal(created.result.channel.name, "Ops");
    assert.equal(created.result.channel.encrypted, true);
    assert.equal(created.result.channel.keyStrength, "aes-256");
    assert.equal(created.result.channel.psk, "********", "PSK masked on create");
    const channelId = created.result.channel.id;

    const listed = call("listChannels", ctxA, {});
    assert.equal(listed.result.total, 1);
    assert.equal(listed.result.encrypted, 1);
    assert.equal(listed.result.channels[0].psk, "********", "PSK never returned in clear");

    // rotate to a weaker key
    const rot = call("setChannelKey", ctxA, { channelId, psk: "short" });
    assert.equal(rot.ok, true);
    assert.equal(rot.result.keyStrength, "weak");

    // clear the key → unencrypted
    const cleared = call("setChannelKey", ctxA, { channelId, psk: "" });
    assert.equal(cleared.result.encrypted, false);
    assert.equal(cleared.result.keyStrength, "none");

    const del = call("deleteChannel", ctxA, { channelId });
    assert.equal(del.result.removed, true);
    assert.equal(call("listChannels", ctxA, {}).result.total, 0);
  });

  it("rejects a channel with no name + unknown channel on key set", () => {
    assert.equal(call("createChannel", ctxA, {}).error, "channel name required");
    assert.equal(call("setChannelKey", ctxA, { channelId: "nope" }).error, "channel not found");
  });
});

describe("mesh — signal/coverage derive from the REAL TRANSPORT_SPECS", () => {
  it("computes per-transport metrics + an RSSI estimate from observed node quality", () => {
    call("addNode", ctxA, { name: "L", transports: ["lora"], quality: 0.5, hops: 2 });
    const metrics = call("signalMetrics", ctxA, {});
    assert.equal(metrics.ok, true);
    assert.ok(metrics.result.metrics.length >= 1);
    const lora = metrics.result.metrics.find((m) => m.transport === "lora");
    assert.ok(lora, "lora transport present");
    assert.equal(lora.peers, 1);
    assert.equal(lora.quality, 0.5);
    assert.equal(lora.maxHopCount, 2);
    assert.equal(typeof lora.rssiDbm, "number");
    assert.ok(lora.rssiDbm < 0, "RSSI is a negative dBm value");
  });

  it("estimates multi-hop coverage scaled by hop count", () => {
    const cov = call("coverage", ctxA, { hops: 4 });
    assert.equal(cov.ok, true);
    assert.equal(cov.result.hops, 4);
    const lora = cov.result.estimates.find((e) => e.transport === "lora");
    assert.ok(lora, "lora coverage present");
    // 8000 m/hop * 4 hops = 32000 m for a non-infrastructure transport
    assert.equal(lora.multiHopMeters, 32000);
    const internet = cov.result.estimates.find((e) => e.transport === "internet");
    assert.equal(internet.unbounded, true, "internet is unbounded");
  });
});

describe("mesh — overview roll-up reflects real counts", () => {
  it("aggregates nodes / messages / channels / queue depth", () => {
    call("addNode", ctxA, { name: "N1" });
    const n2 = call("addNode", ctxA, { name: "N2" });
    call("createChannel", ctxA, { name: "C1", psk: "x".repeat(16) });
    call("sendMessage", ctxA, { to: n2.result.node.id, body: "online msg" });

    const ov = call("overview", ctxA, {});
    assert.equal(ov.ok, true);
    assert.equal(ov.result.nodes, 2);
    assert.equal(ov.result.onlineNodes, 2);
    assert.equal(ov.result.channels, 1);
    assert.equal(ov.result.encryptedChannels, 1);
    assert.equal(ov.result.messages, 1);
    assert.ok(ov.result.transports >= 1);
  });
});

describe("mesh — per-user isolation", () => {
  it("never leaks one user's nodes / messages / channels to another", () => {
    call("addNode", ctxA, { name: "A-node" });
    call("createChannel", ctxA, { name: "A-channel" });
    assert.equal(call("listNodes", ctxA, {}).result.total, 1);
    assert.equal(call("listNodes", ctxB, {}).result.total, 0);
    assert.equal(call("listChannels", ctxB, {}).result.total, 0);
    assert.equal(call("overview", ctxB, {}).result.nodes, 0);
  });
});

describe("mesh — fail-CLOSED numeric guards (assassin V2)", () => {
  it("rejects poisoned hops/quality on addNode instead of clamping to ok:true", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r1 = call("addNode", ctxA, { name: "N", hops: bad });
      assert.equal(r1.ok, false, `hops=${bad} should fail-closed`);
      assert.equal(r1.error, "invalid_hops");
      const r2 = call("addNode", ctxA, { name: "N", quality: bad });
      assert.equal(r2.ok, false, `quality=${bad} should fail-closed`);
      assert.equal(r2.error, "invalid_quality");
    }
    // nothing was written by the rejected calls
    assert.equal(call("listNodes", ctxA, {}).result.total, 0);
  });

  it("rejects poisoned hops on coverage and limit on conversation", () => {
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      assert.equal(call("coverage", ctxA, { hops: bad }).error, "invalid_hops");
      assert.equal(call("conversation", ctxA, { limit: bad }).error, "invalid_limit");
    }
  });

  it("still honours valid numeric inputs", () => {
    const ok = call("addNode", ctxA, { name: "N", hops: 5, quality: 0.9 });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.node.hops, 5);
    assert.equal(ok.result.node.quality, 0.9);
    assert.equal(call("coverage", ctxA, { hops: 2 }).result.hops, 2);
  });
});
