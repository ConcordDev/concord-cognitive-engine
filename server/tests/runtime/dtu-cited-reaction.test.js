// tests/runtime/dtu-cited-reaction.test.js
//
// Pins the sixth reactor in lib/runtime/reactions.js: dtu.cited -> notify
// the parent creator that their work was built on. Distinct from
// royalty.paid (tests/runtime/royalty-paid-reaction.test.js): a citation
// can exist for a long time — or forever — with no sale ever triggering a
// payout, and before this wave, zero notification of any kind fired for
// the citation act itself.
//
// The most important case here isn't the happy path — it's that a repeat
// registerCitation call for the SAME (child, parent) pair (the real
// INSERT OR IGNORE behavior on the UNIQUE(child_id, parent_id) constraint)
// must NOT re-notify. Getting this wrong would mean whatever calls
// registerCitation defensively/idempotently (several call sites do)
// spams the same creator on every re-check.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import * as mig002 from "../../migrations/002_economy_tables.js";
import * as mig008 from "../../migrations/008_economic_system.js";
import { registerCitation } from "../../economy/royalty-cascade.js";
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

describe("dtu.cited -> notification, off a REAL registerCitation call", () => {
  it("the parent creator gets notified on a genuinely new citation", () => {
    globalThis.STATE = {};
    initReactions();

    const r = registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    assert.equal(r.ok, true);

    const { notifications, total } = getNotifications(globalThis.STATE, "uA");
    assert.equal(total, 1);
    assert.equal(notifications[0].type, "dtu_cited");
    assert.equal(notifications[0].postId, "B");
  });

  it("a REPEAT citation of the same (child, parent) pair does NOT re-notify — the real UNIQUE(child_id, parent_id) guard", () => {
    globalThis.STATE = {};
    initReactions();

    registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    const r2 = registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });

    assert.equal(r2.ok, true, "sanity: idempotent success, not an error");
    assert.equal(getNotifications(globalThis.STATE, "uA").total, 1, "still exactly one — the real INSERT OR IGNORE no-op must not re-fire the reactor");
  });

  it("a genuinely different citation from the same child (different parent) DOES notify separately", () => {
    globalThis.STATE = {};
    initReactions();
    registerCitation(db, { childId: "C", parentId: "A", creatorId: "uC", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    registerCitation(db, { childId: "C", parentId: "B", creatorId: "uC", parentCreatorId: "uB", parentDtu: PUBLIC_PARENT });

    assert.equal(getNotifications(globalThis.STATE, "uA").total, 1);
    assert.equal(getNotifications(globalThis.STATE, "uB").total, 1);
  });

  it("a rejected citation (cycle detected) produces zero notifications", () => {
    globalThis.STATE = {};
    initReactions();
    // A -> B already registered; B -> A would be a cycle.
    registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    const r = registerCitation(db, { childId: "A", parentId: "B", creatorId: "uA", parentCreatorId: "uB", parentDtu: PUBLIC_PARENT });
    assert.equal(r.ok, false);
    assert.equal(r.error, "citation_cycle_detected");
    // uB (the rejected citation's would-be parentCreatorId) never notified.
    assert.equal(getNotifications(globalThis.STATE, "uB").total, 0);
  });

  it("no STATE yet -> the real citation still registers; reactor honestly no-ops", () => {
    initReactions();
    const r = registerCitation(db, { childId: "B", parentId: "A", creatorId: "uB", parentCreatorId: "uA", parentDtu: PUBLIC_PARENT });
    assert.equal(r.ok, true, "the real lineage row must never depend on the reaction graph");
  });
});
