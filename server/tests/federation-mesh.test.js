// server/tests/federation-mesh.test.js
//
// Federated brain / mesh (#38) — persistent peers, a REAL consent gate, the
// inbox drain, and an honest brain consult (no reachable peer → unavailable,
// never a fabricated reply). Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  registerPeer, listPeers, revokePeer, evaluateConsent, receiveDtu, drainInbox, consultFederatedBrain,
} from "../lib/federation-mesh.js";
import registerFedmeshMacros from "../domains/fedmesh.js";

describe("Federated brain / mesh (#38)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerFedmeshMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("persists peers across the registry", () => {
    registerPeer(db, { peerId: "peerA", url: "https://a.example", capabilities: ["dtu"] });
    registerPeer(db, { peerId: "peerB", url: "https://b.example" });
    const peers = listPeers(db);
    assert.equal(peers.length, 2);
    assert.deepEqual(peers.find((p) => p.peerId === "peerA").capabilities, ["dtu"]);
  });

  it("the consent gate accepts/rejects by intended use (real)", () => {
    const grant = { consent: { allowDerivatives: false, allowCommercial: true, requireAttribution: true } };
    // We intend a derivative, but derivatives aren't allowed → reject.
    const d = evaluateConsent(grant, { intendDerivatives: true });
    assert.equal(d.accept, false);
    assert.equal(d.reason, "derivatives_not_allowed");
    assert.equal(d.mustAttribute, true, "attribution obligation surfaced");
    // Plain (non-derivative, non-commercial) read → accept.
    assert.equal(evaluateConsent(grant, {}).accept, true);
    // Commercial intent against a non-commercial grant → reject.
    const nc = { consent: { allowCommercial: false } };
    assert.equal(evaluateConsent(nc, { intendCommercial: true }).accept, false);
  });

  it("drains the inbox against consent; a revoked peer is rejected outright", () => {
    receiveDtu(db, { fromPeer: "peerA", dtuId: "d1", envelope: { consent: { allowDerivatives: true, allowCommercial: true } } });
    receiveDtu(db, { fromPeer: "peerA", dtuId: "d2", envelope: { consent: { allowDerivatives: false } } });
    const r = drainInbox(db, { intendDerivatives: true });
    assert.equal(r.accepted, 1, "d1 ok");
    assert.equal(r.rejected, 1, "d2 rejected (derivatives not allowed)");

    revokePeer(db, "peerB");
    receiveDtu(db, { fromPeer: "peerB", dtuId: "d3", envelope: { consent: { allowDerivatives: true } } });
    const r2 = drainInbox(db, { intendDerivatives: true });
    assert.equal(r2.rejected, 1, "revoked peer's item rejected");
    const row = db.prepare("SELECT reason FROM fedmesh_inbox WHERE dtu_id = 'd3'").get();
    assert.equal(row.reason, "peer_revoked");
  });

  it("the brain consult is honest when no peer has a brain endpoint", async () => {
    const r = await consultFederatedBrain(db, "u1", { slot: "conscious", messages: [{ role: "user", content: "hi" }] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_peer_with_brain", "no fabricated reply");
  });

  it("fedmesh macros round-trip", async () => {
    const reg = await macros.get("fedmesh.register_peer")({ db }, { peerId: "peerC", url: "https://c.example" });
    assert.equal(reg.ok, true);
    const peers = await macros.get("fedmesh.peers")({ db }, {});
    assert.ok(peers.peers.some((p) => p.peerId === "peerC"));
    const consult = await macros.get("fedmesh.consult")({ db, actor: { userId: "u1" } }, { messages: [] });
    assert.equal(consult.ok, false, "honest: no reachable peer brain");
  });
});
