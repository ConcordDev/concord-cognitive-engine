// FIX-bridge-002 (audit sweep CB-0447) — peers and mappings gain the
// edit control the ticket found missing. The mapping half rides the
// existing mappingUpsert, which already honours a supplied mappingId;
// the peer half needs a verb: peerUpdate, mirroring peerRegister's
// validation (name required, duplicate names rejected — excluding the
// peer being edited), owner-scoped like every bridge verb.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerBridgeActions from "../domains/bridge.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "bridge", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`bridge.${name} not registered`);
  return fn(ctx, { id: null, domain: "bridge", type: "domain_action", data: input || {}, meta: {} }, input || {});
}

before(() => { registerBridgeActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

function makePeer(ctx, name, extra = {}) {
  const r = call("peerRegister", ctx, { name, kind: "world", region: "concordia-hub", endpoint: "", ...extra });
  assert.equal(r.ok, true, `register ${name}`);
  return r.result.peer;
}

describe("bridge peerUpdate (FIX-bridge-002)", () => {
  it("updates name, kind, region and endpoint in place — no second peer appears", () => {
    const p = makePeer(ctxA, "Alpha");
    const upd = call("peerUpdate", ctxA, { peerId: p.id, name: "Alpha Prime", kind: "federation-peer", region: "eu-west", endpoint: "https://alpha.example" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.peer.id, p.id);
    assert.equal(upd.result.peer.name, "Alpha Prime");
    assert.equal(upd.result.peer.kind, "federation-peer");
    assert.equal(upd.result.peer.region, "eu-west");
    assert.equal(upd.result.peer.endpoint, "https://alpha.example");
    const list = call("peerList", ctxA);
    assert.equal(list.result.peers.length, 1);
    assert.equal(list.result.peers[0].name, "Alpha Prime");
  });

  it("keeping the same name is not a duplicate", () => {
    const p = makePeer(ctxA, "Alpha");
    const upd = call("peerUpdate", ctxA, { peerId: p.id, name: "Alpha", region: "us-east" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.peer.region, "us-east");
  });

  it("taking another peer's name is rejected", () => {
    makePeer(ctxA, "Alpha");
    const b = makePeer(ctxA, "Beta");
    const upd = call("peerUpdate", ctxA, { peerId: b.id, name: "alpha" });
    assert.equal(upd.ok, false);
    assert.match(upd.error, /already exists/);
  });

  it("an unknown peerId is an honest not-found, and another user cannot edit the peer", () => {
    const p = makePeer(ctxA, "Alpha");
    assert.equal(call("peerUpdate", ctxA, { peerId: "peer_nope", name: "X" }).ok, false);
    const cross = call("peerUpdate", ctxB, { peerId: p.id, name: "Hijack" });
    assert.equal(cross.ok, false);
    assert.equal(call("peerList", ctxA).result.peers[0].name, "Alpha");
  });

  it("a blank name is rejected", () => {
    const p = makePeer(ctxA, "Alpha");
    const upd = call("peerUpdate", ctxA, { peerId: p.id, name: "   " });
    assert.equal(upd.ok, false);
    assert.match(upd.error, /name required/);
  });
});

describe("bridge mappingUpsert by id (FIX-bridge-002, mapping leg)", () => {
  it("upserting with a mappingId updates the row instead of creating a second one", () => {
    const created = call("mappingUpsert", ctxA, { source: "first_name", target: "firstName", transform: "direct", dataType: "string" });
    assert.equal(created.ok, true);
    const id = created.result.mapping.id;
    const updated = call("mappingUpsert", ctxA, { mappingId: id, source: "first_name", target: "givenName", transform: "direct", dataType: "string", required: true });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.mapping.id, id);
    const list = call("mappingList", ctxA);
    assert.equal(list.result.mappings.length, 1);
    assert.equal(list.result.mappings[0].target, "givenName");
    assert.equal(list.result.mappings[0].required, true);
  });
});
