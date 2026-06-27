// Behavioral macro tests for server/domains/cognitive-replay.js — the
// Spotify-Wrapped / RescueTime-style scrubber the /lenses/cognitive-replay
// lens drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// handlers registered via `registerLensAction(domain, action, handler)` are
// invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG convention.
// Our harness therefore calls `fn(ctx, virtualArtifact, input)`, NOT
// (ctx, input), so a regression that confuses the param positions surfaces.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values + round-trips over a real in-memory STATE.sessions corpus (the same
// source chat.timeline reads):
//   • aggregate math: totalTokens, avgTokensPerTurn, topBrain, busiestDay
//   • filter facets + brain/tool/role slicing
//   • wrapped archetype + peakHour derivation
//   • heatmap calendar + hour-of-week grid
//   • event detail round-trip + jump-to deep link
//   • compare window deltas
//   • snapshot create → list → get (shareable, cross-user) → delete round-trip
//   • per-user isolation (one user's corpus + snapshots never leak)
//   • degrade-graceful: empty STATE → ok:true, never no_db
//   • fail-CLOSED guards: poisoned 1e308 / Infinity / NaN sinceDays/windowDays
//     are clamped to the documented bounds — never a poisoned write or a
//     non-finite number in the result.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerCognitiveReplayActions from "../domains/cognitive-replay.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn /* , meta */) {
  assert.equal(domain, "cognitive-replay", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`cognitive-replay.${name} not registered`);
  const virtualArtifact = {
    id: null, domain: "cognitive-replay", type: "domain_action",
    data: input || {}, meta: {},
  };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerCognitiveReplayActions(registerLensAction); });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };
const noActor = { actor: {} };

const HOUR = 3600000;
const DAY = 86400000;

// ── deterministic corpus builder ───────────────────────────────────────────
// Builds a STATE.sessions Map exactly like the live chat substrate, so the
// macros read real values (not mocks). Timestamps are anchored to `now` so the
// since-windows behave deterministically inside a test run.
function seedCorpus() {
  const now = Date.now();
  const sessions = new Map();

  // user_a — session s1: two turns "today", one user + one assistant turn.
  // Assistant turn used conscious+utility brains, 1 tool call, 2 DTU citations,
  // 100 tokens. User turn 20 tokens, no brains.
  sessions.set("s1", {
    userId: "user_a",
    messages: [
      { role: "user", ts: now - 2 * HOUR, content: "hello world",
        meta: { tokenCount: 20 } },
      { role: "assistant", ts: now - HOUR, content: "a thoughtful reply about glyphs",
        meta: { tokenCount: 100, brainsUsed: ["conscious", "utility"],
          toolCalls: [{ name: "web_search" }], dtusCited: ["dtu_1", "dtu_2"] } },
    ],
  });

  // user_a — session s2: one assistant turn 3 days ago, conscious only,
  // 200 tokens, 1 citation, 2 tool calls (one named 'math', one bare object).
  sessions.set("s2", {
    userId: "user_a",
    messages: [
      { role: "assistant", ts: now - 3 * DAY, content: "older reply",
        meta: { tokenCount: 200, brainsUsed: ["conscious"],
          toolCalls: [{ name: "math" }, {}], dtusCited: ["dtu_3"] } },
    ],
  });

  // user_b — separate corpus (isolation guard): one turn, subconscious brain.
  sessions.set("s3", {
    userId: "user_b",
    messages: [
      { role: "assistant", ts: now - HOUR, content: "user b reply",
        meta: { tokenCount: 50, brainsUsed: ["subconscious"] } },
    ],
  });

  globalThis._concordSTATE = { sessions };
  return { now };
}

// ── 1. stats ────────────────────────────────────────────────────────────────
describe("cognitive-replay.stats — aggregate math over the live corpus", () => {
  beforeEach(() => { seedCorpus(); });

  it("computes turns / tokens / avg / top brain over a 7-day window", () => {
    const r = call("stats", ctxA, { sinceDays: 7 });
    assert.equal(r.ok, true);
    const s = r.result;
    // All three user_a turns fall inside 7 days.
    assert.equal(s.turns, 3);
    assert.equal(s.sessions, 2);
    assert.equal(s.totalTokens, 320);             // 20 + 100 + 200
    assert.equal(s.avgTokensPerTurn, 107);         // round(320 / 3)
    // conscious appears on s1.assistant + s2.assistant = 2; utility = 1.
    assert.equal(s.topBrain.brain, "conscious");
    assert.equal(s.topBrain.turns, 2);
    assert.equal(s.totalCitations, 3);             // 2 + 0 + 1
    assert.equal(s.totalToolCalls, 3);             // 1 + 2
    assert.ok(Number.isFinite(s.totalTokens));
  });

  it("a 1-day window excludes the 3-day-old session", () => {
    const r = call("stats", ctxA, { sinceDays: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.turns, 2, "only the two 'today' turns");
    assert.equal(r.result.totalTokens, 120);       // 20 + 100
    assert.equal(r.result.sessions, 1);
  });

  it("rejects a call with no actor", () => {
    const r = call("stats", noActor, { sinceDays: 7 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_actor");
  });

  it("degrades graceful on empty STATE — ok:true, zeroed, never no_db", () => {
    globalThis._concordSTATE = {};
    const r = call("stats", ctxA, { sinceDays: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.turns, 0);
    assert.equal(r.result.totalTokens, 0);
    assert.equal(r.result.avgTokensPerTurn, 0);
    assert.equal(r.result.topBrain, null);
  });

  it("fail-CLOSED: poisoned sinceDays (1e308/Infinity/NaN/-1) clamps to [1,365], never a non-finite result", () => {
    for (const poison of [1e308, Infinity, -Infinity, NaN, -1, "9".repeat(40)]) {
      const r = call("stats", ctxA, { sinceDays: poison });
      assert.equal(r.ok, true, `ok for poison=${String(poison)}`);
      assert.ok(r.result.sinceDays >= 1 && r.result.sinceDays <= 365,
        `sinceDays clamped for poison=${String(poison)}, got ${r.result.sinceDays}`);
      assert.ok(Number.isFinite(r.result.totalTokens));
      assert.ok(Number.isFinite(r.result.turns));
    }
  });
});

// ── 2. filter ─────────────────────────────────────────────────────────────
describe("cognitive-replay.filter — facets + brain/tool/role slicing", () => {
  beforeEach(() => { seedCorpus(); });

  it("returns the full corpus + facet vocabulary with no filter", () => {
    const r = call("filter", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 3);
    assert.equal(r.result.totalMatching, 3);
    // facets are sorted, deduped brain/tool vocab from the user's own corpus.
    // The bare `{}` toolCall in s2 resolves to the default name "tool".
    assert.deepEqual(r.result.facets.brains, ["conscious", "utility"]);
    assert.deepEqual(r.result.facets.tools, ["math", "tool", "web_search"]);
    assert.deepEqual(r.result.facets.roles, ["user", "assistant", "system"]);
  });

  it("filters by brain", () => {
    const r = call("filter", ctxA, { brain: "utility" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1, "only the s1 assistant turn used utility");
    assert.ok(r.result.events.every((e) => e.brainsUsed.includes("utility")));
  });

  it("filters by role", () => {
    const r = call("filter", ctxA, { role: "user" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.events[0].role, "user");
  });

  it("filters by tool name resolved from the toolCalls object", () => {
    const r = call("filter", ctxA, { tool: "web_search" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.events[0].sessionId, "s1");
  });

  it("an unmatched filter returns 0 events but still ok:true with facets", () => {
    const r = call("filter", ctxA, { brain: "vision" });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.ok(Array.isArray(r.result.facets.brains));
  });

  it("fail-CLOSED: poisoned limit clamps to [1,1000]", () => {
    const r = call("filter", ctxA, { limit: 1e308 });
    assert.equal(r.ok, true);
    assert.ok(r.result.count <= 1000);
    assert.ok(Number.isFinite(r.result.totalMatching));
  });
});

// ── 3. wrapped ──────────────────────────────────────────────────────────────
describe("cognitive-replay.wrapped — archetype + peak hour + cards", () => {
  beforeEach(() => { seedCorpus(); });

  it("derives the archetype from the dominant brain and emits 8 cards", () => {
    const r = call("wrapped", ctxA, { sinceDays: 7 });
    assert.equal(r.ok, true);
    // conscious dominates → "The Deep Thinker".
    assert.equal(r.result.archetype, "The Deep Thinker");
    assert.equal(r.result.cards.length, 8);
    const byId = Object.fromEntries(r.result.cards.map((c) => [c.id, c]));
    assert.equal(byId.turns.value, 3);
    assert.equal(byId.tokens.value, 320);
    assert.equal(byId.brain.value, "conscious");
    assert.ok(Number.isInteger(r.result.peakHour) && r.result.peakHour >= 0 && r.result.peakHour <= 23);
  });

  it("empty corpus → The Generalist, zeroed cards, ok:true", () => {
    globalThis._concordSTATE = {};
    const r = call("wrapped", ctxA, { sinceDays: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.archetype, "The Generalist");
    assert.equal(r.result.cards.find((c) => c.id === "turns").value, 0);
  });
});

// ── 4. heatmap ──────────────────────────────────────────────────────────────
describe("cognitive-replay.heatmap — calendar + hour-of-week grid", () => {
  beforeEach(() => { seedCorpus(); });

  it("returns a 7x24 hour grid and a per-day calendar with active-day count", () => {
    const r = call("heatmap", ctxA, { sinceDays: 28 });
    assert.equal(r.ok, true);
    assert.equal(r.result.hourGrid.length, 7);
    assert.ok(r.result.hourGrid.every((row) => row.length === 24));
    // We seeded activity on two distinct days (today + 3 days ago).
    assert.equal(r.result.totalActiveDays, 2);
    assert.ok(r.result.maxCell >= 1);
    assert.ok(r.result.days.length >= 28);
  });

  it("fail-CLOSED: heatmap sinceDays floors at 7 and clamps poison to [7,365]", () => {
    for (const poison of [1, 1e308, Infinity, NaN]) {
      const r = call("heatmap", ctxA, { sinceDays: poison });
      assert.equal(r.ok, true, `ok for poison=${String(poison)}`);
      assert.ok(r.result.sinceDays >= 7 && r.result.sinceDays <= 365);
      assert.ok(Number.isFinite(r.result.maxCell));
    }
  });
});

// ── 5. event ────────────────────────────────────────────────────────────────
describe("cognitive-replay.event — single-event detail + jump-to link", () => {
  beforeEach(() => { seedCorpus(); });

  it("resolves a real eventId and returns the jump-to deep link", () => {
    // s1 assistant turn is index 1.
    const r = call("event", ctxA, { eventId: "s1:1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.event.role, "assistant");
    assert.equal(r.result.event.tokenCount, 100);
    assert.deepEqual(r.result.event.brainsUsed, ["conscious", "utility"]);
    assert.equal(r.result.jumpTo.lens, "chat");
    assert.equal(r.result.jumpTo.sessionId, "s1");
    assert.equal(r.result.jumpTo.turnIndex, 1);
    assert.match(r.result.jumpTo.url, /^\/lenses\/chat\?session=s1&turn=1$/);
  });

  it("rejects a missing / malformed eventId, never a throw", () => {
    assert.equal(call("event", ctxA, {}).error, "missing_eventId");
    assert.equal(call("event", ctxA, { eventId: "noColon" }).error, "bad_eventId");
    assert.equal(call("event", ctxA, { eventId: "s1:999" }).error, "event_not_found");
  });

  it("does not leak another user's event (per-user isolation on read)", () => {
    // s3 belongs to user_b — user_a must not resolve it.
    const r = call("event", ctxA, { eventId: "s3:0" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "event_not_found");
  });
});

// ── 6. compare ──────────────────────────────────────────────────────────────
describe("cognitive-replay.compare — adjacent window deltas", () => {
  beforeEach(() => { seedCorpus(); });

  it("computes per-metric deltas between the two windows", () => {
    const r = call("compare", ctxA, { windowDays: 2 });
    assert.equal(r.ok, true);
    // windowA (last 2d) contains the two 'today' turns; windowB (prior 2d) the
    // 3-day-old turn does NOT fall in [now-4d, now-2d) — it's exactly 3d old, so
    // it's in windowB.
    assert.ok(Number.isFinite(r.result.deltas.turns.a));
    assert.ok(Number.isFinite(r.result.deltas.turns.b));
    assert.ok(Number.isFinite(r.result.deltas.tokens.pct));
    assert.equal(r.result.deltas.turns.a, 2);     // two today turns
    assert.equal(r.result.deltas.turns.b, 1);     // the 3-day-old turn
  });

  it("fail-CLOSED: poisoned windowDays clamps to [1,180]", () => {
    for (const poison of [1e308, Infinity, NaN, -5]) {
      const r = call("compare", ctxA, { windowDays: poison });
      assert.equal(r.ok, true, `ok for poison=${String(poison)}`);
      assert.ok(Number.isFinite(r.result.deltas.turns.change));
      assert.ok(Number.isFinite(r.result.deltas.tokens.pct));
    }
  });
});

// ── 7. snapshot lifecycle ───────────────────────────────────────────────────
describe("cognitive-replay.snapshot-* — create → list → get → delete round-trip", () => {
  beforeEach(() => { seedCorpus(); });

  it("create freezes the aggregate; list shows it; get resolves it; delete removes it", () => {
    const c = call("snapshot-create", ctxA, { sinceDays: 7, title: "My week" });
    assert.equal(c.ok, true);
    const shareId = c.result.shareId;
    assert.match(shareId, /^[0-9a-f]{16}$/);
    assert.equal(c.result.snapshot.title, "My week");
    // Frozen stats match the live aggregate at capture time.
    assert.equal(c.result.snapshot.stats.turns, 3);
    assert.equal(c.result.snapshot.stats.totalTokens, 320);
    assert.match(c.result.shareUrl, /\?snapshot=[0-9a-f]{16}$/);

    const l = call("snapshot-list", ctxA, {});
    assert.equal(l.ok, true);
    assert.equal(l.result.count, 1);
    assert.equal(l.result.snapshots[0].shareId, shareId);

    const g = call("snapshot-get", ctxA, { shareId });
    assert.equal(g.ok, true);
    assert.equal(g.result.snapshot.title, "My week");

    const d = call("snapshot-delete", ctxA, { shareId });
    assert.equal(d.ok, true);
    assert.equal(d.result.remaining, 0);
    assert.equal(call("snapshot-list", ctxA, {}).result.count, 0);
    // get after delete → not found.
    assert.equal(call("snapshot-get", ctxA, { shareId }).error, "snapshot_not_found");
  });

  it("snapshot-get is shareable cross-user; delete is owner-scoped", () => {
    const c = call("snapshot-create", ctxA, { sinceDays: 7 });
    const shareId = c.result.shareId;
    // user_b can OPEN user_a's shared snapshot (recipient who isn't owner).
    const g = call("snapshot-get", ctxB, { shareId });
    assert.equal(g.ok, true);
    assert.equal(g.result.snapshot.ownerId, "user_a");
    // ...but user_b cannot DELETE it (not in their list).
    const d = call("snapshot-delete", ctxB, { shareId });
    assert.equal(d.ok, false);
    assert.equal(d.error, "snapshot_not_found");
    // user_a still has it.
    assert.equal(call("snapshot-list", ctxA, {}).result.count, 1);
  });

  it("refuses to snapshot an empty corpus (no_activity_to_snapshot)", () => {
    globalThis._concordSTATE = { sessions: new Map() };
    const r = call("snapshot-create", ctxA, { sinceDays: 7 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "no_activity_to_snapshot");
  });

  it("snapshot-create / list isolate per user", () => {
    call("snapshot-create", ctxA, { sinceDays: 7 });
    assert.equal(call("snapshot-list", ctxA, {}).result.count, 1);
    assert.equal(call("snapshot-list", ctxB, {}).result.count, 0);
  });

  it("snapshot-get/delete reject a missing shareId", () => {
    assert.equal(call("snapshot-get", ctxA, {}).error, "missing_shareId");
    assert.equal(call("snapshot-delete", ctxA, {}).error, "missing_shareId");
  });

  it("fail-CLOSED: a poisoned sinceDays on snapshot-create clamps, never a poisoned write", () => {
    const r = call("snapshot-create", ctxA, { sinceDays: 1e308 });
    assert.equal(r.ok, true);
    assert.ok(r.result.snapshot.sinceDays >= 1 && r.result.snapshot.sinceDays <= 365);
    assert.ok(Number.isFinite(r.result.snapshot.stats.totalTokens));
  });
});

// ── per-user isolation (cross-macro) ────────────────────────────────────────
describe("cognitive-replay — per-user corpus isolation", () => {
  beforeEach(() => { seedCorpus(); });

  it("user_b only sees their own single-turn corpus across stats/filter/wrapped", () => {
    const s = call("stats", ctxB, { sinceDays: 7 });
    assert.equal(s.result.turns, 1);
    assert.equal(s.result.totalTokens, 50);
    assert.equal(s.result.topBrain.brain, "subconscious");

    const f = call("filter", ctxB, {});
    assert.equal(f.result.count, 1);
    assert.deepEqual(f.result.facets.brains, ["subconscious"]);

    const w = call("wrapped", ctxB, { sinceDays: 7 });
    assert.equal(w.result.archetype, "The Dreamer");
  });
});

// ── registration coverage ───────────────────────────────────────────────────
describe("cognitive-replay — registration (every lens-driven macro present)", () => {
  it("registers all 10 macros the page + children call via lensRun", () => {
    for (const m of [
      "stats", "filter", "wrapped", "heatmap", "event", "compare",
      "snapshot-create", "snapshot-list", "snapshot-get", "snapshot-delete",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing cognitive-replay.${m}`);
    }
  });
});
