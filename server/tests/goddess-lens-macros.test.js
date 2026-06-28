// Behavioral macro tests for server/domains/goddess.js — the interactive
// surface the /lenses/goddess "Concordia Speaks" lens drives.
//
// REGISTRATION (verified, dual): `goddess` resolves through PATH 3 —
// `server/domains/index.js` imports this module into `domainModules`, then
// `server.js:41401 domainModules.forEach(mod => mod(registerLensAction))`.
// The `/api/lens/run` dispatcher PREFERS LENS_ACTIONS over MACROS, so the lens
// UI hits THESE handlers (detail/archive/react/reactions/subscribe/
// unsubscribe/subscriptions/correlate). The two inline `register("goddess",…)`
// blocks in server.js (recent/compose_now) are the MACROS/runMacro+MCP path the
// macro-assassin enumerates; the page's `recent` fetch falls through to them.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention. Our harness
// therefore calls `fn(ctx, virtualArtifact, input)`, NOT (ctx,input), so a
// regression that confuses param positions surfaces here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values + round-trips: archive search/filter/tone-distribution against real
// rows, commune (react) per-user replace + aggregate tallies, prev/next
// permalink navigation by compose_at, tone subscription notification
// fire-exactly-once, world-event correlation closest-at-or-before. Per-user
// isolation holds; numeric/string inputs are fail-CLOSED (bad dispatchId/tone
// rejected, never a throw); empty STATE degrades graceful (ok:true, not no_db).
//
// Hermetic: a fresh in-memory better-sqlite3 DB per test, NO server boot, NO
// network, NO LLM. The tone-selection logic (composeDispatch/pickTone in
// goddess-broadcaster.js) is the deterministic compose path the recorded rows
// exercise — driven directly, no brain.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerGoddessActions from "../domains/goddess.js";
import { composeDispatch, recordDispatch } from "../lib/goddess-broadcaster.js";

// ── live dispatch mirror ────────────────────────────────────────────────────
const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "goddess", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror server.js:39150 — handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`goddess.${name} not registered`);
  const virtualArtifact = { id: null, domain: "goddess", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

// ── hermetic schema ─────────────────────────────────────────────────────────
function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE goddess_dispatches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      tone TEXT NOT NULL,
      ecosystem_score REAL,
      refusal_strength REAL,
      drift_kind TEXT,
      body TEXT NOT NULL,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE world_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT,
      title TEXT,
      event_type TEXT,
      starts_at INTEGER
    );
  `);
  return db;
}

// Insert a dispatch with an explicit compose time (overrides the default) so
// prev/next + correlation windows are deterministic.
function seedDispatch(db, { worldId = "concordia-hub", ecosystemScore = 0, refusalStrength = 0, driftKind = null, composedAt }) {
  const d = composeDispatch({ ecosystemScore, refusalStrength, driftKind });
  const info = db.prepare(`
    INSERT INTO goddess_dispatches
      (world_id, tone, ecosystem_score, refusal_strength, drift_kind, body, composed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(worldId, d.tone, ecosystemScore, refusalStrength, driftKind, d.body, composedAt);
  return { id: Number(info.lastInsertRowid), tone: d.tone, body: d.body, composedAt };
}

const ctxA = (db) => ({ db, actor: { userId: "user_a" } });
const ctxB = (db) => ({ db, actor: { userId: "user_b" } });

before(() => { registerGoddessActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

// ── registration ────────────────────────────────────────────────────────────
describe("goddess — registration (every lens-driven LENS_ACTION present)", () => {
  it("registers the 8 macros the lens page + children call via lensRun", () => {
    for (const m of [
      "detail", "archive", "react", "reactions",
      "subscribe", "unsubscribe", "subscriptions", "correlate",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing goddess.${m}`);
    }
  });
});

// ── tone selection (the deterministic compose the rows carry) ───────────────
describe("goddess — tone selection by ecosystem_score (deterministic compose)", () => {
  it("maps ecosystem score bands onto the five canonical tones", () => {
    assert.equal(composeDispatch({ ecosystemScore: 0.9 }).tone, "exalted");
    assert.equal(composeDispatch({ ecosystemScore: 0.5 }).tone, "warm");
    assert.equal(composeDispatch({ ecosystemScore: 0.0 }).tone, "neutral");
    assert.equal(composeDispatch({ ecosystemScore: -0.2 }).tone, "cold");
    assert.equal(composeDispatch({ ecosystemScore: -0.8 }).tone, "mourning");
  });

  it("compound refusal (strength>=6) is voiced in chorus; a milder field is a rising path", () => {
    assert.match(composeDispatch({ ecosystemScore: 0, refusalStrength: 6 }).body, /chorus/);
    assert.match(composeDispatch({ ecosystemScore: 0, refusalStrength: 3 }).body, /closing/);
  });

  it("drift kind surfaces as a grounded phrase, never an invented event", () => {
    assert.match(composeDispatch({ ecosystemScore: 0, driftKind: "goodhart" }).body, /metric devours the meaning/);
  });
});

// ── archive: real search / filter / distribution ────────────────────────────
describe("goddess — archive (real rows, filterable, with tone distribution)", () => {
  it("returns rows newest-first with a full-history tone distribution", () => {
    const db = freshDb();
    seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 }); // exalted
    seedDispatch(db, { ecosystemScore: 0.5, composedAt: 2000 }); // warm
    const newest = seedDispatch(db, { ecosystemScore: -0.8, composedAt: 3000 }); // mourning

    const r = call("archive", ctxA(db), { worldId: "concordia-hub", limit: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.dispatches[0].id, newest.id, "newest dispatch first");
    // Tone distribution counts the whole history, one per tone band.
    assert.deepEqual(
      r.result.toneCounts,
      { exalted: 1, warm: 1, mourning: 1 },
    );
  });

  it("filters by tone and by free-text query against the body", () => {
    const db = freshDb();
    const exalted = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    seedDispatch(db, { ecosystemScore: -0.8, composedAt: 2000 }); // mourning

    const byTone = call("archive", ctxA(db), { tone: "exalted" });
    assert.equal(byTone.result.count, 1);
    assert.equal(byTone.result.dispatches[0].id, exalted.id);

    // "brightness" is in the exalted prefix only.
    const byQuery = call("archive", ctxA(db), { query: "brightness" });
    assert.equal(byQuery.result.count, 1);
    assert.equal(byQuery.result.dispatches[0].id, exalted.id);
  });

  it("filters by a [fromTs,toTs] compose window", () => {
    const db = freshDb();
    seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    const mid = seedDispatch(db, { ecosystemScore: 0.5, composedAt: 5000 });
    seedDispatch(db, { ecosystemScore: 0, composedAt: 9000 });

    const r = call("archive", ctxA(db), { fromTs: 4000, toTs: 6000 });
    assert.equal(r.result.count, 1);
    assert.equal(r.result.dispatches[0].id, mid.id);
  });

  it("fail-CLOSED on an unknown tone; degrades graceful with no rows", () => {
    const db = freshDb();
    const bad = call("archive", ctxA(db), { tone: "ecstatic" });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "unknown tone");

    const empty = call("archive", ctxA(db), { worldId: "ghost-world" });
    assert.equal(empty.ok, true, "empty world is ok:true, never no_db");
    assert.equal(empty.result.count, 0);
    assert.deepEqual(empty.result.dispatches, []);
  });
});

// ── detail: permalink prev/next navigation ──────────────────────────────────
describe("goddess — detail (permalink prev/next by compose time)", () => {
  it("resolves a dispatch with its earlier/later neighbours in the same world", () => {
    const db = freshDb();
    const a = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    const b = seedDispatch(db, { ecosystemScore: 0.5, composedAt: 2000 });
    const c = seedDispatch(db, { ecosystemScore: 0, composedAt: 3000 });

    const r = call("detail", ctxA(db), { dispatchId: b.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.dispatch.id, b.id);
    assert.equal(r.result.prev.id, a.id, "prev is the earlier dispatch");
    assert.equal(r.result.next.id, c.id, "next is the later dispatch");
    assert.equal(r.result.reactionCount, 0);
  });

  it("ends of the timeline have null prev/next; bad ids fail-closed", () => {
    const db = freshDb();
    const only = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    const r = call("detail", ctxA(db), { dispatchId: only.id });
    assert.equal(r.result.prev, null);
    assert.equal(r.result.next, null);

    assert.equal(call("detail", ctxA(db), { dispatchId: 0 }).error, "dispatchId required");
    assert.equal(call("detail", ctxA(db), { dispatchId: "x" }).error, "dispatchId required");
    assert.equal(call("detail", ctxA(db), { dispatchId: 9999 }).error, "dispatch not found");
  });
});

// ── react + reactions: commune mechanic ─────────────────────────────────────
describe("goddess — react/reactions (commune, per-user replace, aggregate)", () => {
  it("records a commune and tallies it; a second react REPLACES the caller's own", () => {
    const db = freshDb();
    const d = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });

    const first = call("react", ctxA(db), { dispatchId: d.id, kind: "blessed", note: "I hear you" });
    assert.equal(first.ok, true);
    assert.equal(first.result.reactionCount, 1);

    const replaced = call("react", ctxA(db), { dispatchId: d.id, kind: "vowed" });
    assert.equal(replaced.result.reactionCount, 1, "same user replaces, not appends");

    const agg = call("reactions", ctxA(db), { dispatchId: d.id });
    assert.equal(agg.result.total, 1);
    assert.deepEqual(agg.result.byKind, { vowed: 1 });
    assert.equal(agg.result.mine.kind, "vowed");
  });

  it("aggregates distinct users by kind and surfaces own-vs-others notes", () => {
    const db = freshDb();
    const d = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    call("react", ctxA(db), { dispatchId: d.id, kind: "heard", note: "mine" });
    call("react", ctxB(db), { dispatchId: d.id, kind: "grieved", note: "theirs" });

    const asA = call("reactions", ctxA(db), { dispatchId: d.id });
    assert.equal(asA.result.total, 2);
    assert.deepEqual(asA.result.byKind, { heard: 1, grieved: 1 });
    const mineNote = asA.result.notes.find((n) => n.note === "mine");
    const theirsNote = asA.result.notes.find((n) => n.note === "theirs");
    assert.equal(mineNote.mine, true);
    assert.equal(theirsNote.mine, false);
    assert.equal(asA.result.mine.kind, "heard");
  });

  it("fail-CLOSED on an invalid commune kind / missing id / unknown dispatch", () => {
    const db = freshDb();
    const d = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    assert.equal(call("react", ctxA(db), { dispatchId: d.id, kind: "smitten" }).error, "invalid commune kind");
    assert.equal(call("react", ctxA(db), { kind: "heard" }).error, "dispatchId required");
    assert.equal(call("react", ctxA(db), { dispatchId: 9999, kind: "heard" }).error, "dispatch not found");
  });

  it("note is clamped to 280 chars; reactions never throws on empty state", () => {
    const db = freshDb();
    const d = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    const long = "x".repeat(400);
    const r = call("react", ctxA(db), { dispatchId: d.id, kind: "heard", note: long });
    assert.equal(r.result.note.length, 280);

    // reactions for a never-communed dispatch is a clean empty aggregate.
    const empty = call("reactions", ctxA(db), { dispatchId: 4242 });
    assert.equal(empty.ok, true);
    assert.equal(empty.result.total, 0);
    assert.deepEqual(empty.result.byKind, {});
    assert.equal(empty.result.mine, null);
  });
});

// ── subscribe / subscriptions: fire-once notification ───────────────────────
describe("goddess — subscribe/subscriptions (tone alerts, fire exactly once)", () => {
  it("subscribing is idempotent per (tone, world); a matching dispatch notifies once", () => {
    const db = freshDb();
    // No matching dispatches yet.
    const sub = call("subscribe", ctxA(db), { tone: "mourning", worldId: "concordia-hub" });
    assert.equal(sub.ok, true);
    const again = call("subscribe", ctxA(db), { tone: "mourning", worldId: "concordia-hub" });
    assert.equal(again.result.count, 1, "re-subscribe is idempotent");

    const first = call("subscriptions", ctxA(db), {});
    assert.equal(first.result.unseenCount, 0, "nothing matched yet");

    // The goddess now mourns → one matching dispatch.
    seedDispatch(db, { ecosystemScore: -0.8, composedAt: 1000 }); // mourning
    const seen = call("subscriptions", ctxA(db), {});
    assert.equal(seen.result.unseenCount, 1);
    assert.equal(seen.result.notifications[0].tone, "mourning");

    // Polling again does NOT re-fire the same dispatch.
    const again2 = call("subscriptions", ctxA(db), {});
    assert.equal(again2.result.unseenCount, 0, "notification fires exactly once");
  });

  it("only the subscribed tone matches; other tones are ignored", () => {
    const db = freshDb();
    call("subscribe", ctxA(db), { tone: "exalted" });
    seedDispatch(db, { ecosystemScore: 0.5, composedAt: 1000 }); // warm — no match
    const r = call("subscriptions", ctxA(db), {});
    assert.equal(r.result.unseenCount, 0);

    seedDispatch(db, { ecosystemScore: 0.9, composedAt: 2000 }); // exalted — matches
    assert.equal(call("subscriptions", ctxA(db), {}).result.unseenCount, 1);
  });

  it("unsubscribe removes the tone alert; bad inputs fail-closed", () => {
    const db = freshDb();
    const sub = call("subscribe", ctxA(db), { tone: "warm" });
    const id = sub.result.subscription.id;
    assert.equal(call("unsubscribe", ctxA(db), { subscriptionId: id }).ok, true);
    assert.equal(call("subscriptions", ctxA(db), {}).result.count, 0);

    assert.equal(call("subscribe", ctxA(db), { tone: "radiant" }).error, "unknown tone");
    assert.equal(call("unsubscribe", ctxA(db), {}).error, "subscriptionId required");
    assert.equal(call("unsubscribe", ctxA(db), { subscriptionId: "ghost" }).error, "subscription not found");
  });
});

// ── correlate: closest world event at/before compose time ───────────────────
describe("goddess — correlate (triggering world event, closest at-or-before)", () => {
  it("picks the event at or before the compose time, with nearby context", () => {
    const db = freshDb();
    const d = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 5000 });
    // before, very-before, and after.
    db.prepare(`INSERT INTO world_events (world_id, title, event_type, starts_at) VALUES (?,?,?,?)`)
      .run("concordia-hub", "Quake", "disaster", 4900);   // 100s before → candidate
    db.prepare(`INSERT INTO world_events (world_id, title, event_type, starts_at) VALUES (?,?,?,?)`)
      .run("concordia-hub", "Old festival", "festival", 1000); // way before
    db.prepare(`INSERT INTO world_events (world_id, title, event_type, starts_at) VALUES (?,?,?,?)`)
      .run("concordia-hub", "After-rite", "ritual", 5200);  // after

    const r = call("correlate", ctxA(db), { dispatchId: d.id, windowSeconds: 7200 });
    assert.equal(r.ok, true);
    assert.equal(r.result.candidate.title, "Quake", "closest at-or-before wins");
    assert.equal(r.result.candidate.offsetSeconds, -100);
    assert.ok(r.result.nearby.length >= 2);
  });

  it("degrades graceful when no event is near or the table is empty", () => {
    const db = freshDb();
    const d = seedDispatch(db, { ecosystemScore: 0, composedAt: 5000 });
    const r = call("correlate", ctxA(db), { dispatchId: d.id, windowSeconds: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.candidate, null);
    assert.deepEqual(r.result.nearby, []);
  });

  it("fail-CLOSED on a bad/unknown dispatch id", () => {
    const db = freshDb();
    assert.equal(call("correlate", ctxA(db), {}).error, "dispatchId required");
    assert.equal(call("correlate", ctxA(db), { dispatchId: 9999 }).error, "dispatch not found");
  });
});

// ── per-user isolation ──────────────────────────────────────────────────────
describe("goddess — per-user isolation", () => {
  it("one user's commune + subscriptions never leak to another", () => {
    const db = freshDb();
    const d = seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    call("react", ctxA(db), { dispatchId: d.id, kind: "blessed" });
    call("subscribe", ctxA(db), { tone: "warm" });

    // user_b sees the aggregate count but NOT user_a's own reaction.
    const asB = call("reactions", ctxB(db), { dispatchId: d.id });
    assert.equal(asB.result.total, 1);
    assert.equal(asB.result.mine, null, "user_b has no own reaction");
    // user_b has no subscriptions.
    assert.equal(call("subscriptions", ctxB(db), {}).result.count, 0);
  });
});

// ── degrade-graceful: no db ─────────────────────────────────────────────────
describe("goddess — degrade-graceful (no db handle)", () => {
  it("db-backed reads return a clean no_db, never throw", () => {
    const noDb = { actor: { userId: "user_a" } };
    for (const m of ["detail", "archive", "react", "correlate"]) {
      const r = call(m, noDb, { dispatchId: 1 });
      assert.equal(r.ok, false);
      assert.equal(r.error, "no_db");
    }
  });

  it("state-only macros work without a db; subscriptions degrades to no notifications", () => {
    const noDb = { actor: { userId: "user_a" } };
    // reactions is pure-state — ok with no db.
    const rx = call("reactions", noDb, { dispatchId: 1 });
    assert.equal(rx.ok, true);
    // subscribe is pure-state — ok with no db.
    assert.equal(call("subscribe", noDb, { tone: "warm" }).ok, true);
    // subscriptions with no db returns the subs but no notifications.
    const subs = call("subscriptions", noDb, {});
    assert.equal(subs.ok, true);
    assert.equal(subs.result.count, 1);
    assert.deepEqual(subs.result.notifications, []);
  });
});

// ── fail-CLOSED numeric/string fuzz ─────────────────────────────────────────
describe("goddess — fail-CLOSED on poisoned numeric/string inputs", () => {
  it("absurd dispatchId / windowSeconds / limit never throw and never fabricate", () => {
    const db = freshDb();
    seedDispatch(db, { ecosystemScore: 0.9, composedAt: 1000 });
    for (const poison of [Infinity, -Infinity, NaN, 1e308, -1, "9".repeat(40)]) {
      const detail = call("detail", ctxA(db), { dispatchId: poison });
      assert.equal(detail.ok, false, `detail fails-closed on ${String(poison)}`);

      // archive clamps limit into [1,200] and never throws.
      const arch = call("archive", ctxA(db), { limit: poison });
      assert.equal(arch.ok, true, `archive ok on poison limit ${String(poison)}`);
      assert.ok(arch.result.count <= 200);

      // correlate clamps the window and never throws on a real dispatch.
      const corr = call("correlate", ctxA(db), { dispatchId: 1, windowSeconds: poison });
      assert.equal(corr.ok, true, `correlate ok on poison window ${String(poison)}`);
    }
  });
});
