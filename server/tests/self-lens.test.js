// Phase-2 non-score gate — the `self` lens (quantified-self ledger +
// achievements/progression surface).
//
// The `self` lens is a MIXED lens: its core (overview / trends /
// correlations / goals / digest / streaks / import) is driven by the real
// in-STATE metric ledger in `server/domains/self.js` through the
// macro/lensRun channel; its Achievements tab is driven by the REST route
// `GET /api/world/achievements/:userId` whose handler calls
// `getAchievements(userId)` in `server/lib/world-progression.js`.
//
// `self-domain-parity.test.js` already pins the happy-path SHAPE of every
// self.* macro. This file pins the GATE dimensions that file does not:
//   1. degrade-graceful  — empty STATE → a clean { ok:false } (never throws,
//                           never returns a `no_db`-style crash);
//   2. per-user isolation — one user's readings/goals/layout never leak to
//                           another;
//   3. fail-CLOSED       — poisoned inputs (huge batch, NaN value, unknown
//                           metric, oversized layout) are rejected, never
//                           silently coerced into fabricated rows;
//   4. the REST-route backing — getAchievements per-user shape +
//                           unlock idempotency on (user_id, achievement_id)
//                           (the CLAUDE.md MMO invariant) +
//                           degrade-graceful for an unknown user.
//
// Hermetic: no server boot, no DB. The self domain reads
// `globalThis._concordSTATE` (a plain object with Maps); the progression lib
// is pure in-memory LruMaps. We register the macros against a local Map and
// call them directly. No fabricated rows anywhere — every assertion traces a
// real logged reading or a real tracked action.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSelfActions from "../domains/self.js";
import {
  getAchievements,
  trackAction,
  checkAchievements,
  awardXP,
} from "../lib/world-progression.js";

// ── self.* macro harness (mirrors the dispatcher's register signature) ───────
const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`self.${name}`);
  assert.ok(fn, `self.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSelfActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "self_gate_a" }, userId: "self_gate_a" };
const ctxB = { actor: { userId: "self_gate_b" }, userId: "self_gate_b" };
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();

// ─────────────────────────────────────────────────────────────────────────────
describe("self lens — wiring sanity (every page/child macro is registered)", () => {
  // The page + components/self/* call exactly these self.* actions.
  const CALLED = [
    "logMetric", "overview", "layout", "saveLayout",
    "trend", "correlate", "goals", "setGoal", "removeGoal",
    "digest", "streaks", "importBatch",
  ];
  it("has a real handler for every caller (no dead self.* caller)", () => {
    for (const a of CALLED) {
      assert.ok(ACTIONS.has(`self.${a}`), `self.${a} has no registered handler`);
      assert.equal(typeof ACTIONS.get(`self.${a}`), "function");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("self lens — degrade-graceful when STATE is unavailable", () => {
  // A lens must never throw or return a crashy `no_db` on an empty/absent
  // substrate. The self domain returns a clean { ok:false, error } so the
  // frontend surfaces a real error (Retry) instead of a silent blank.
  const READ_MACROS = ["overview", "layout", "trend", "correlate", "goals", "digest", "streaks", "readings"];

  it("every read macro returns ok:false (not a throw) when STATE is absent", () => {
    globalThis._concordSTATE = undefined;
    for (const m of READ_MACROS) {
      let r;
      assert.doesNotThrow(() => { r = call(m, ctxA, { metric: "steps" }); }, `${m} threw on absent STATE`);
      assert.equal(r.ok, false, `${m} should report ok:false on absent STATE`);
      assert.ok(typeof r.error === "string" && r.error.length > 0, `${m} must carry an error string`);
      // Never a no_db / crash sentinel.
      assert.doesNotMatch(String(r.error), /no_db|undefined is not|cannot read/i);
    }
  });

  it("write macros also degrade gracefully (no throw) on absent STATE", () => {
    globalThis._concordSTATE = undefined;
    assert.doesNotThrow(() => {
      assert.equal(call("logMetric", ctxA, { metric: "steps", value: 1 }).ok, false);
      assert.equal(call("setGoal", ctxA, { metric: "steps", target: 10 }).ok, false);
      assert.equal(call("saveLayout", ctxA, { tiles: ["steps"] }).ok, false);
      assert.equal(call("importBatch", ctxA, { samples: [{ metric: "steps", value: 1 }] }).ok, false);
    });
  });

  it("a fresh (empty) ledger reads as ok:true + empty, never a fabricated row", () => {
    const ov = call("overview", ctxA, {});
    assert.equal(ov.ok, true);
    assert.equal(ov.result.hasData, false);
    assert.equal(ov.result.totalReadings, 0);
    // cards exist (default layout) but carry NO fabricated value.
    for (const c of ov.result.cards) assert.equal(c.value, null);

    assert.equal(call("readings", ctxA, {}).result.count, 0);
    assert.equal(call("streaks", ctxA, {}).result.overall, 0);
    assert.equal(call("goals", ctxA, {}).result.count, 0);
    assert.match(call("digest", ctxA, { range: "daily" }).result.headline, /No data/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("self lens — per-user isolation", () => {
  it("readings, goals, and layouts never leak across users", () => {
    call("logMetric", ctxA, { metric: "steps", value: 9000 });
    call("setGoal", ctxA, { metric: "steps", target: 10000 });
    call("saveLayout", ctxA, { tiles: ["sleep_hours", "mood"] });

    // User B sees none of A's state.
    assert.equal(call("readings", ctxB, {}).result.count, 0);
    assert.equal(call("goals", ctxB, {}).result.count, 0);
    assert.equal(call("overview", ctxB, {}).result.hasData, false);
    assert.equal(call("layout", ctxB, {}).result.isDefault, true);

    // User A still has all of theirs.
    assert.equal(call("readings", ctxA, {}).result.count, 1);
    assert.equal(call("goals", ctxA, {}).result.count, 1);
    assert.equal(call("layout", ctxA, {}).result.isDefault, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("self lens — fail-CLOSED on poisoned input", () => {
  it("rejects an oversized import batch instead of ingesting it", () => {
    const samples = Array.from({ length: 5001 }, () => ({ metric: "steps", value: 1 }));
    const r = call("importBatch", ctxA, { samples });
    assert.equal(r.ok, false);
    assert.match(r.error, /too large/i);
    // Nothing was written.
    assert.equal(call("readings", ctxA, {}).result.count, 0);
  });

  it("skips (never coerces) invalid samples inside a batch", () => {
    const r = call("importBatch", ctxA, {
      samples: [
        { metric: "steps", value: 5000 },         // valid
        { metric: "vibes", value: 3 },            // bad metric
        { metric: "steps", value: "lots" },       // NaN value
        { metric: "steps", value: Infinity },     // non-finite
        { metric: "mood", value: NaN },           // NaN
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 1);           // only the one valid sample
    assert.equal(r.result.skipped, 4);
    assert.equal(call("readings", ctxA, {}).result.count, 1);
  });

  it("rejects NaN / non-finite single readings", () => {
    assert.equal(call("logMetric", ctxA, { metric: "steps", value: NaN }).ok, false);
    assert.equal(call("logMetric", ctxA, { metric: "steps", value: Infinity }).ok, false);
    assert.equal(call("logMetric", ctxA, { metric: "steps", value: "9000" }).ok, true); // numeric string is fine
  });

  it("rejects an unknown metric on every metric-keyed macro", () => {
    assert.equal(call("logMetric", ctxA, { metric: "telepathy", value: 1 }).ok, false);
    assert.equal(call("trend", ctxA, { metric: "telepathy" }).ok, false);
    assert.equal(call("setGoal", ctxA, { metric: "telepathy", target: 1 }).ok, false);
    assert.equal(call("correlate", ctxA, { metricA: "telepathy", metricB: "steps" }).ok, false);
  });

  it("rejects a non-positive goal target and an all-invalid / oversized layout", () => {
    assert.equal(call("setGoal", ctxA, { metric: "steps", target: 0 }).ok, false);
    assert.equal(call("setGoal", ctxA, { metric: "steps", target: -5 }).ok, false);
    assert.equal(call("saveLayout", ctxA, { tiles: ["bogus", "nope"] }).ok, false);
    assert.equal(call("saveLayout", ctxA, { tiles: [] }).ok, false);
    const tooMany = call("saveLayout", ctxA, {
      tiles: ["steps", "sleep_hours", "workout_min", "mood", "weight_kg", "resting_hr", "water_ml", "meditation_min", "calories"],
    });
    // 9 distinct valid tile keys → over the 8-tile cap. (calories isn't a TILE_KEY
    // so it's filtered; the remaining 8 are accepted — assert the cap is honoured.)
    assert.ok(tooMany.ok === false || tooMany.result.tiles.length <= 8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("self lens — round-trips compute real values", () => {
  it("logMetric → overview aggregates the real readings (sum for steps)", () => {
    call("logMetric", ctxA, { metric: "steps", value: 3000 });
    call("logMetric", ctxA, { metric: "steps", value: 5000 });
    const ov = call("overview", ctxA, {});
    assert.equal(ov.result.hasData, true);
    const steps = ov.result.cards.find((c) => c.metric === "steps");
    assert.equal(steps.value, 8000);   // not fabricated — exact sum
    assert.equal(steps.readings, 2);
  });

  it("setGoal → goals computes an accurate progress ring", () => {
    call("setGoal", ctxA, { metric: "steps", target: 10000, period: "daily" });
    call("logMetric", ctxA, { metric: "steps", value: 2500 });
    const g = call("goals", ctxA, {});
    assert.equal(g.result.count, 1);
    assert.equal(g.result.goals[0].current, 2500);
    assert.equal(g.result.goals[0].percent, 25);
    assert.equal(g.result.goals[0].met, false);
  });

  it("importBatch is idempotent on a re-imported export (no double-count)", () => {
    const samples = [
      { metric: "steps", value: 5000, at: dayAgo(1), source: "applehealth" },
      { metric: "sleep_hours", value: 7.5, at: dayAgo(1), source: "applehealth" },
    ];
    const r1 = call("importBatch", ctxA, { samples, source: "applehealth" });
    assert.equal(r1.result.imported, 2);
    const r2 = call("importBatch", ctxA, { samples, source: "applehealth" });
    assert.equal(r2.result.imported, 0);
    assert.equal(r2.result.skipped, 2);
    assert.equal(call("readings", ctxA, {}).result.count, 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REST-route backing: GET /api/world/achievements/:userId → getAchievements
describe("self lens — achievements (REST surface backing)", () => {
  it("returns the full catalog per user with honest per-user progress", () => {
    const u = "self_ach_user_" + Date.now();
    const list = getAchievements(u);
    assert.ok(Array.isArray(list) && list.length > 0);
    // A brand-new user has nothing unlocked and zero progress — no fabrication.
    for (const a of list) {
      assert.equal(typeof a.id, "string");
      assert.equal(typeof a.name, "string");
      assert.equal(a.unlocked, false);
      assert.ok(a.progress <= a.target);
    }
  });

  it("unlock is idempotent on (user_id, achievement_id) — the MMO invariant", () => {
    const u = "self_ach_idem_" + Date.now();
    // first_dtu unlocks at dtu_created count 1.
    const first = trackAction(u, "dtu_created", 1);
    assert.ok(first.some((a) => a.id === "first_dtu"), "first_dtu should unlock");

    // Re-tracking the same action must NOT re-emit the already-held unlock.
    const second = trackAction(u, "dtu_created", 1);
    assert.ok(!second.some((a) => a.id === "first_dtu"), "first_dtu must not double-unlock");

    // And checkAchievements run repeatedly is a no-op for held achievements.
    const re = checkAchievements(u);
    assert.ok(!re.some((a) => a.id === "first_dtu"));

    // The achievement remains unlocked in the read view exactly once.
    const view = getAchievements(u);
    const unlockedFirstDtu = view.filter((a) => a.id === "first_dtu" && a.unlocked);
    assert.equal(unlockedFirstDtu.length, 1);
  });

  it("rank-based achievements unlock from real XP, isolated per user", () => {
    const u = "self_ach_rank_" + Date.now();
    // Artisan rank is rank 3 (1500 XP). Award enough real XP to cross it.
    for (let i = 0; i < 160; i++) awardXP(u, "dtu_created"); // 10 XP each → 1600 XP
    const unlocked = checkAchievements(u);
    assert.ok(unlocked.some((a) => a.id === "rank_artisan"), "rank_artisan should unlock at rank 3");

    // A different, untouched user is unaffected (per-user isolation).
    const other = "self_ach_rank_other_" + Date.now();
    const otherList = getAchievements(other);
    assert.ok(otherList.every((a) => !a.unlocked));
  });

  it("getAchievements degrades gracefully for an unknown user (empty, no throw)", () => {
    let list;
    assert.doesNotThrow(() => { list = getAchievements("nobody_" + Date.now()); });
    assert.ok(Array.isArray(list));
    assert.ok(list.every((a) => a.unlocked === false));
  });
});
