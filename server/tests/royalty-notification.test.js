// server/tests/royalty-notification.test.js
//
// Verifies that distributeRoyalties() surfaces the credit to the
// recipient as (1) a STATE.notifications row of type='royalty' and
// (2) a 'royalty:credited' realtime socket emit. Before this commit
// the ledger absorbed the credit silently and creators only noticed
// by refreshing their wallet.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

let db;
let emits;

before(async () => {
  db = new Database(":memory:");
  // Minimal schema mirrors that the royalty cascade reads/writes.
  db.exec(`
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN (
        'TOKEN_PURCHASE','TRANSFER','MARKETPLACE_PURCHASE','ROYALTY_PAYOUT',
        'WITHDRAWAL','FEE','REVERSAL'
      )),
      from_user_id TEXT,
      to_user_id TEXT,
      amount REAL NOT NULL,
      fee REAL NOT NULL DEFAULT 0,
      net REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'complete',
      ref_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      request_id TEXT,
      ip TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE royalty_lineage (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL,
      parent_id TEXT NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
      creator_id TEXT NOT NULL,
      parent_creator TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(child_id, parent_id)
    );
    CREATE TABLE royalty_payouts (
      id TEXT PRIMARY KEY,
      transaction_id TEXT NOT NULL,
      content_id TEXT NOT NULL,
      recipient_id TEXT NOT NULL,
      amount REAL NOT NULL,
      generation INTEGER NOT NULL,
      royalty_rate REAL NOT NULL,
      source_tx_id TEXT NOT NULL,
      ledger_entry_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE earned_storage_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      grant_key TEXT UNIQUE,
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Stub the global state + realtime io so the notification + emit paths
  // have somewhere to land. Using globalThis matches what royalty-cascade
  // reads in the new hook.
  emits = [];
  globalThis._concordSTATE = { notifications: new Map() };
  globalThis._concordREALTIME = {
    io: {
      to(room) {
        return {
          emit(event, payload) { emits.push({ room, event, payload }); },
        };
      },
    },
  };

  // Register a lineage row so distributeRoyalties has an ancestor to credit.
  db.prepare(`
    INSERT INTO royalty_lineage (id, child_id, parent_id, creator_id, parent_creator, generation)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("lin_test_1", "dtu_child", "dtu_seed", "buyer_user", "seed_author_user", 1);
});

after(() => {
  db?.close();
  delete globalThis._concordSTATE;
  delete globalThis._concordREALTIME;
});

describe("distributeRoyalties surfaces credit as notification + socket emit", () => {
  it("creates a STATE.notifications row of type='royalty' for the recipient", async () => {
    const { distributeRoyalties } = await import("../economy/royalty-cascade.js");
    emits.length = 0;
    globalThis._concordSTATE.notifications.clear();

    const r = distributeRoyalties(db, {
      contentId: "dtu_child",
      transactionAmount: 100,
      sourceTxId: "tx_test_1",
      buyerId: "buyer_user",
      sellerId: "seller_user",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.totalRoyalties > 0, "expected non-zero royalty");

    const notifs = Array.from(globalThis._concordSTATE.notifications.values());
    const royaltyNotifs = notifs.filter(n => n.type === "royalty");
    assert.ok(royaltyNotifs.length > 0, "expected royalty notification row");
    const n = royaltyNotifs[0];
    assert.equal(n.userId, "seed_author_user");
    assert.ok(n.message.includes("CC"), "message mentions CC");
    assert.equal(n.read, false);
    assert.equal(n.targetId, "dtu_child");
    assert.equal(typeof n.amount, "number");
    assert.ok(n.amount > 0);
  });

  it("emits a 'royalty:credited' socket event to the user room", async () => {
    const { distributeRoyalties } = await import("../economy/royalty-cascade.js");
    emits.length = 0;
    globalThis._concordSTATE.notifications.clear();

    distributeRoyalties(db, {
      contentId: "dtu_child",
      transactionAmount: 200,
      sourceTxId: "tx_test_2",
      buyerId: "buyer_user",
      sellerId: "seller_user",
    });
    const royaltyEmits = emits.filter(e => e.event === "royalty:credited");
    assert.ok(royaltyEmits.length > 0, "expected royalty:credited socket emit");
    const emit = royaltyEmits[0];
    assert.equal(emit.room, "user:seed_author_user");
    assert.equal(emit.payload.recipientId, "seed_author_user");
    assert.ok(emit.payload.amount > 0);
    assert.equal(typeof emit.payload.count, "number");
    assert.equal(emit.payload.contentId, "dtu_child");
  });

  it("notification path is best-effort — failures don't break the ledger", async () => {
    const { distributeRoyalties } = await import("../economy/royalty-cascade.js");
    // Sabotage the realtime stub so any emit throws.
    globalThis._concordREALTIME = {
      io: { to() { throw new Error("simulated io failure"); } },
    };
    emits.length = 0;
    const r = distributeRoyalties(db, {
      contentId: "dtu_child",
      transactionAmount: 50,
      sourceTxId: "tx_test_3",
      buyerId: "buyer_user",
      sellerId: "seller_user",
    });
    assert.equal(r.ok, true, "ledger still ok despite emit failure");
    assert.ok(r.totalRoyalties > 0);
    // Restore for any later tests
    globalThis._concordREALTIME = {
      io: { to(room) { return { emit(event, payload) { emits.push({ room, event, payload }); } }; } },
    };
  });
});
