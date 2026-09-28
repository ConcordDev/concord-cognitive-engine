// tests/runtime/royalty-paid-reaction.test.js
//
// Pins the fifth reactor in lib/runtime/reactions.js: royalty.paid -> a
// notification for the ancestor creator. Before this wave, an ancestor
// earning real money from a citation chain got NO signal at all — checked
// economy/royalty-cascade.js directly before writing anything: no
// realtimeEmit, no createNotification anywhere on the distributeRoyalties
// path (only an unrelated royalty:cross-world signal on the SEPARATE
// citation-registration path). This is the audit's own "Creator system
// sees authorship" arm.
//
// Exercised against the REAL minimal-migration harness
// tests/royalty-cascade-real-db.test.js already established (migrations
// 002 + 008 only) so the reaction fires off an ACTUAL registerCitation +
// distributeRoyalties call — real ledger rows, real 30% cap math, real
// idempotency check — not a synthetic publish().
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig002 from "../../migrations/002_economy_tables.js";
import * as mig008 from "../../migrations/008_economic_system.js";
import { registerCitation, distributeRoyalties } from "../../economy/royalty-cascade.js";
import { initReactions, _resetReactions } from "../../lib/runtime/reactions.js";
import { _reset as _resetBus } from "../../lib/runtime/event-bus.js";
import { getNotifications } from "../../emergent/social-layer.js";

const PUBLIC_PARENT = { visibility: "public" };
let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig002.up(db);
  mig008.up(db);
  _resetBus();
  _resetReactions();
  delete globalThis.STATE;
});
afterEach(() => {
  try { db?.close(); } catch { /* noop */ }
  _resetReactions();
  delete globalThis.STATE;
});

describe("royalty.paid -> notification, off a REAL registerCitation + distributeRoyalties call", () => {
  it("the ancestor creator gets a real notification with the real paid amount", () => {
    globalThis.STATE = {};
    initReactions();

    registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    const r = distributeRoyalties(db, { contentId: "B", transactionAmount: 1000, sourceTxId: "tx_1", sellerId: "uB" });

    assert.equal(r.ok, true);
    assert.equal(r.payouts[0].recipientId, "uA");
    assert.equal(r.payouts[0].amount, 105, "sanity: real generational-rate math, unrelated to this reactor");

    // uA also gets a "dtu.cited" notification from the registerCitation
    // call above (a real, separate, coexisting reactor — see
    // tests/runtime/dtu-cited-reaction.test.js) — filter to the one this
    // test is actually pinning rather than asserting a raw total, which
    // would break every time a legitimate new reactor is added to this
    // same real call chain.
    const { notifications } = getNotifications(globalThis.STATE, "uA");
    const paid = notifications.filter((n) => n.type === "royalty_paid");
    assert.equal(paid.length, 1);
    assert.match(paid[0].content, /\$105\.00/);
  });

  it("each ancestor in a multi-generation cascade gets their OWN notification with their OWN amount", () => {
    globalThis.STATE = {};
    initReactions();
    // A <- B <- C: two ancestors of C at different generations/rates.
    registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    registerCitation(db, { childId: "C", parentId: "B", creatorId: "uC", parentCreatorId: "uB", parentDtu: PUBLIC_PARENT });

    const r = distributeRoyalties(db, { contentId: "C", transactionAmount: 1000, sourceTxId: "tx_2", sellerId: "uC" });
    assert.equal(r.ok, true);
    assert.ok(r.payouts.length >= 2, "sanity: a real multi-generation cascade actually paid multiple ancestors");

    for (const p of r.payouts) {
      const { notifications } = getNotifications(globalThis.STATE, p.recipientId);
      const paid = notifications.filter((n) => n.type === "royalty_paid");
      assert.equal(paid.length, 1, `${p.recipientId} should have exactly one royalty_paid notification`);
      assert.match(paid[0].content, new RegExp(`\\$${p.amount.toFixed(2).replace(".", "\\.")}`));
    }
  });

  it("an idempotent (already-distributed) retry does not double-notify", () => {
    globalThis.STATE = {};
    initReactions();
    registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    distributeRoyalties(db, { contentId: "B", transactionAmount: 1000, sourceTxId: "tx_idem", sellerId: "uB" });
    const r2 = distributeRoyalties(db, { contentId: "B", transactionAmount: 1000, sourceTxId: "tx_idem", sellerId: "uB" });

    assert.equal(r2.idempotent, true, "sanity: the real idempotency guard actually fired");
    const paid = getNotifications(globalThis.STATE, "uA").notifications.filter((n) => n.type === "royalty_paid");
    assert.equal(paid.length, 1, "still exactly one royalty_paid — no second notification for a no-op retry");
  });

  it("no STATE yet -> the real payout still succeeds; reactor honestly no-ops", () => {
    initReactions();
    registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    const r = distributeRoyalties(db, { contentId: "B", transactionAmount: 1000, sourceTxId: "tx_3", sellerId: "uB" });
    assert.equal(r.ok, true, "the real money movement must never depend on the reaction graph");
  });
});
