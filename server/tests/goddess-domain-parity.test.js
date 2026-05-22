// server/tests/goddess-domain-parity.test.js
//
// Contract tests for server/domains/goddess.js — the interactive surface
// over Concordia's ambient dispatch feed (detail / archive / react /
// reactions / subscribe / unsubscribe / subscriptions / correlate).
// Exercises each macro against a real in-memory goddess_dispatches +
// world_events schema and asserts the { ok } envelope + per-user scoping.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerGoddessActions from "../domains/goddess.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`goddess.${name}`);
  if (!fn) throw new Error(`goddess.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGoddessActions(register); });

let db;

function seed() {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};

  db = new Database(":memory:");
  // goddess_dispatches — mirrors migration 162.
  db.prepare(`
    CREATE TABLE goddess_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      tone TEXT NOT NULL,
      ecosystem_score REAL,
      refusal_strength REAL,
      drift_kind TEXT,
      body TEXT NOT NULL,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();
  // world_events — minimal shape with a title + time column.
  db.prepare(`
    CREATE TABLE world_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      title TEXT,
      event_type TEXT,
      starts_at INTEGER
    )
  `).run();

  const ins = db.prepare(`
    INSERT INTO goddess_dispatches (world_id, tone, ecosystem_score, refusal_strength, drift_kind, body, composed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const base = 1_700_000_000;
  ins.run("concordia-hub", "warm", 0.5, 1, null, "you hold the line.", base);
  ins.run("concordia-hub", "mourning", -0.6, 2, "goodhart", "names lose their edges.", base + 3600);
  ins.run("concordia-hub", "exalted", 0.8, 0, null, "the worlds align in brightness.", base + 7200);
  ins.run("other-world", "cold", -0.2, 4, null, "remember the cost.", base + 100);

  db.prepare(`
    INSERT INTO world_events (world_id, title, event_type, starts_at)
    VALUES (?, ?, ?, ?)
  `).run("concordia-hub", "The Mourning Vigil", "ritual", base + 3000);
}

beforeEach(() => { seed(); });

const ctxA = { actor: { userId: "user_a" }, userId: "user_a", db: null };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b", db: null };
function withDb(ctx) { return { ...ctx, db }; }

describe("goddess — detail", () => {
  it("resolves a dispatch by id with prev/next navigation", () => {
    const r = call("detail", withDb(ctxA), { dispatchId: 2 });
    assert.equal(r.ok, true);
    assert.equal(r.result.dispatch.id, 2);
    assert.equal(r.result.dispatch.tone, "mourning");
    assert.equal(r.result.prev.id, 1);
    assert.equal(r.result.next.id, 3);
  });

  it("rejects missing or unknown dispatch id", () => {
    assert.equal(call("detail", withDb(ctxA), {}).ok, false);
    assert.equal(call("detail", withDb(ctxA), { dispatchId: 9999 }).ok, false);
  });
});

describe("goddess — archive", () => {
  it("full-text searches dispatch bodies for a world", () => {
    const r = call("archive", withDb(ctxA), { worldId: "concordia-hub", query: "brightness" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.dispatches[0].tone, "exalted");
  });

  it("filters by tone and returns tone distribution counts", () => {
    const r = call("archive", withDb(ctxA), { worldId: "concordia-hub", tone: "warm" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.toneCounts.warm, 1);
    assert.equal(r.result.toneCounts.exalted, 1);
  });

  it("filters by time window", () => {
    const r = call("archive", withDb(ctxA), {
      worldId: "concordia-hub", fromTs: 1_700_003_000, toTs: 1_700_005_000,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.dispatches[0].id, 2);
  });

  it("rejects an unknown tone filter", () => {
    assert.equal(call("archive", withDb(ctxA), { tone: "smug" }).ok, false);
  });
});

describe("goddess — react / reactions", () => {
  it("records a commune reaction and tallies it per-kind", () => {
    const r = call("react", withDb(ctxA), { dispatchId: 1, kind: "blessed", note: "I felt it." });
    assert.equal(r.ok, true);
    assert.equal(r.result.reactionCount, 1);
    const agg = call("reactions", withDb(ctxA), { dispatchId: 1 });
    assert.equal(agg.ok, true);
    assert.equal(agg.result.byKind.blessed, 1);
    assert.equal(agg.result.mine.kind, "blessed");
  });

  it("scopes reactions per user and replaces a user's own", () => {
    call("react", withDb(ctxA), { dispatchId: 1, kind: "heard" });
    call("react", withDb(ctxB), { dispatchId: 1, kind: "grieved" });
    call("react", withDb(ctxA), { dispatchId: 1, kind: "vowed" }); // replace A's
    const agg = call("reactions", withDb(ctxA), { dispatchId: 1 });
    assert.equal(agg.result.total, 2);
    assert.equal(agg.result.mine.kind, "vowed");
    assert.equal(agg.result.byKind.heard, undefined);
  });

  it("rejects invalid commune kinds and unknown dispatches", () => {
    assert.equal(call("react", withDb(ctxA), { dispatchId: 1, kind: "yelled" }).ok, false);
    assert.equal(call("react", withDb(ctxA), { dispatchId: 9999, kind: "heard" }).ok, false);
  });
});

describe("goddess — subscribe / unsubscribe / subscriptions", () => {
  it("subscribes to a tone idempotently", () => {
    const r1 = call("subscribe", withDb(ctxA), { tone: "mourning" });
    assert.equal(r1.ok, true);
    const r2 = call("subscribe", withDb(ctxA), { tone: "mourning" });
    assert.equal(r2.result.count, 1);
  });

  it("rejects an unknown tone", () => {
    assert.equal(call("subscribe", withDb(ctxA), { tone: "smug" }).ok, false);
  });

  it("surfaces matching dispatches as notifications once", () => {
    call("subscribe", withDb(ctxA), { tone: "mourning", worldId: "concordia-hub" });
    const first = call("subscriptions", withDb(ctxA), {});
    assert.equal(first.ok, true);
    assert.equal(first.result.unseenCount, 1);
    assert.equal(first.result.notifications[0].id, 2);
    // Second poll: already seen, no repeat notification.
    const second = call("subscriptions", withDb(ctxA), {});
    assert.equal(second.result.unseenCount, 0);
  });

  it("unsubscribe removes a subscription", () => {
    const sub = call("subscribe", withDb(ctxA), { tone: "warm" });
    const r = call("unsubscribe", withDb(ctxA), { subscriptionId: sub.result.subscription.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });
});

describe("goddess — correlate", () => {
  it("links a dispatch to the nearest preceding world event", () => {
    const r = call("correlate", withDb(ctxA), { dispatchId: 2, windowSeconds: 3600 });
    assert.equal(r.ok, true);
    assert.ok(r.result.candidate);
    assert.equal(r.result.candidate.title, "The Mourning Vigil");
    assert.ok(r.result.candidate.offsetSeconds <= 0);
  });

  it("returns no candidate when nothing falls in the window", () => {
    const r = call("correlate", withDb(ctxA), { dispatchId: 3, windowSeconds: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.candidate, null);
  });

  it("rejects an unknown dispatch id", () => {
    assert.equal(call("correlate", withDb(ctxA), { dispatchId: 9999 }).ok, false);
  });
});
