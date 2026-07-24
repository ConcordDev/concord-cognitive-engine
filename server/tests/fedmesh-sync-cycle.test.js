// server/tests/fedmesh-sync-cycle.test.js
//
// Wire-the-unwired (Wave E): fedmesh had two real, tested backend modules
// (server/domains/fedmesh.js + server/lib/federation-mesh.js, migration 348)
// with zero scheduled sync. This pins the new fedmesh-sync-cycle heartbeat:
//   - heartbeat-compatible signature, returns a plain object, never throws
//   - the kill-switch and no-db guard rails
//   - the real isolation property: a revoked peer's rejected inbox item
//     never blocks another peer's item from being drained in the same pass
//     (federation-mesh.js#drainInbox's row-level `revoked.has(from_peer)`
//     check, which this cycle relies on rather than reinventing)
//
// Run: node --test tests/fedmesh-sync-cycle.test.js

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { registerPeer, revokePeer, receiveDtu } from "../lib/federation-mesh.js";
import { runFedmeshSyncCycle } from "../emergent/fedmesh-sync-cycle.js";

describe("fedmesh-sync-cycle: guard rails", () => {
  let prevEnv;
  beforeEach(() => { prevEnv = process.env.CONCORD_FEDMESH_SYNC; });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.CONCORD_FEDMESH_SYNC;
    else process.env.CONCORD_FEDMESH_SYNC = prevEnv;
  });

  it("returns { ok:false, reason:'no_db' } with no db", async () => {
    const r = await runFedmeshSyncCycle({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("respects the CONCORD_FEDMESH_SYNC=0 kill-switch even with a real db", async () => {
    process.env.CONCORD_FEDMESH_SYNC = "0";
    const db = new Database(":memory:");
    await runMigrations(db);
    const r = await runFedmeshSyncCycle({ db });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "disabled");
  });

  it("never throws on any input shape", async () => {
    let threw = false;
    try {
      await runFedmeshSyncCycle({});
      await runFedmeshSyncCycle({ db: null });
      await runFedmeshSyncCycle({ db: {} }); // db-shaped object with no real methods
      await runFedmeshSyncCycle(undefined);
    } catch {
      threw = true;
    }
    assert.equal(threw, false);
  });
});

describe("fedmesh-sync-cycle: heartbeat-compatible signature", () => {
  it("accepts ({ db, state, tickCount }) and returns a plain { ok, ... } object", async () => {
    const db = new Database(":memory:");
    await runMigrations(db);
    const r = await runFedmeshSyncCycle({ db, state: {}, tickCount: 0 });
    assert.ok(typeof r === "object" && r !== null);
    assert.ok(typeof r.ok === "boolean");
    if (r.ok) {
      assert.ok(typeof r.drained === "object");
      assert.ok(typeof r.drained.accepted === "number");
      assert.ok(typeof r.drained.rejected === "number");
      assert.ok(typeof r.peers === "object");
      assert.ok(typeof r.peers.known === "number");
    } else {
      assert.ok(typeof r.reason === "string");
    }
  });
});

describe("fedmesh-sync-cycle: real drain + peer isolation", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("drains pending inbox items from multiple peers in one pass", async () => {
    registerPeer(db, { peerId: "peerGood", url: "https://good.example" });
    registerPeer(db, { peerId: "peerAlsoGood", url: "https://also-good.example" });
    receiveDtu(db, { fromPeer: "peerGood", dtuId: "g1", envelope: { consent: { allowDerivatives: true, allowCommercial: true } } });
    receiveDtu(db, { fromPeer: "peerAlsoGood", dtuId: "g2", envelope: { consent: { allowDerivatives: true, allowCommercial: true } } });

    const r = await runFedmeshSyncCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.drained.accepted, 2, "both peers' pending items accepted under the default policy");
    assert.equal(r.drained.rejected, 0);
    assert.equal(r.peers.known, 2);
    assert.equal(r.peers.active, 2);
    assert.equal(r.peers.revoked, 0);
  });

  it("a revoked peer's rejected item never blocks another peer's item from being drained in the same pass", async () => {
    registerPeer(db, { peerId: "peerFine", url: "https://fine.example" });
    registerPeer(db, { peerId: "peerBad", url: "https://bad.example" });
    revokePeer(db, "peerBad");

    receiveDtu(db, { fromPeer: "peerFine", dtuId: "f1", envelope: { consent: { allowDerivatives: true, allowCommercial: true } } });
    receiveDtu(db, { fromPeer: "peerBad", dtuId: "b1", envelope: { consent: { allowDerivatives: true, allowCommercial: true } } });

    const r = await runFedmeshSyncCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.drained.accepted, 1, "peerFine's item still gets accepted");
    assert.equal(r.drained.rejected, 1, "peerBad's item is rejected for being revoked");

    const fineRow = db.prepare("SELECT consent_status FROM fedmesh_inbox WHERE dtu_id = 'f1'").get();
    assert.equal(fineRow.consent_status, "accepted");
    const badRow = db.prepare("SELECT consent_status, reason FROM fedmesh_inbox WHERE dtu_id = 'b1'").get();
    assert.equal(badRow.consent_status, "rejected");
    assert.equal(badRow.reason, "peer_revoked");

    // Peer-registry reporting reflects the revocation without erroring.
    assert.equal(r.peers.known, 4, "cumulative peers across both tests in this suite");
    assert.equal(r.peers.revoked, 1);
  });

  it("is idempotent on a re-run with no new pending items (zero work, zero error)", async () => {
    const r = await runFedmeshSyncCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.drained.accepted, 0);
    assert.equal(r.drained.rejected, 0);
  });
});
