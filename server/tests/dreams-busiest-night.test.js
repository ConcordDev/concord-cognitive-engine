// server/tests/dreams-busiest-night.test.js
//
// Contract tests for `dreams.busiest-night` (server/domains/dreams.js) — the
// honest "activity intensity" ranking of a player's nights. The macro sums
// the REAL `dreams.fragment_count` (the actual number of combat/pain/gather/
// visit/dtu-creation events the dream engine gathered for that offline
// window — see server/lib/embodied/dream-engine.js#gatherFragments) per
// calendar day, and ranks nights by that sum. It must never invent a score,
// never use Math.random, and must label the metric "activity_intensity" —
// not "featured" or "most significant" (editorial claims the data can't
// support). Isolates its own :memory: DB per test (DB_PATH not touched —
// this domain takes `ctx.db` directly, same pattern as
// dreams-domain-parity.test.js).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerDreamsMacros from "../domains/dreams.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`dreams.${name}`);
  if (!fn) throw new Error(`dreams.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerDreamsMacros(register); });

let db;

function makeSchema() {
  db = new Database(":memory:");
  db.prepare(`
    CREATE TABLE dreams (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT,
      dream_dtu_id  TEXT,
      fragment_count INTEGER NOT NULL DEFAULT 0,
      signature     TEXT NOT NULL,
      composer      TEXT NOT NULL DEFAULT 'deterministic',
      composed_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `).run();
  db.prepare(`
    CREATE TABLE dtus (
      id          TEXT PRIMARY KEY,
      creator_id  TEXT,
      kind        TEXT,
      type        TEXT,
      title       TEXT,
      scope       TEXT DEFAULT 'personal',
      data        TEXT,
      meta_json   TEXT,
      created_at  INTEGER
    )
  `).run();
}

// Insert a dream row at an EXACT unix timestamp (not "ago" — the ranking is
// keyed by calendar day, so tests need precise control over which day a row
// lands on, independent of when the test itself runs).
function insertDreamAt(id, userId, unixTs, fragmentCount) {
  db.prepare(`
    INSERT INTO dreams (id, user_id, world_id, dream_dtu_id, fragment_count, signature, composer, composed_at)
    VALUES (?, ?, 'concordia-hub', NULL, ?, ?, 'deterministic', ?)
  `).run(id, userId, fragmentCount, `sig_${id}`, unixTs);
}

// Fixed UTC midnight anchors, three consecutive days, well clear of any
// timezone edge — avoids the test being sensitive to the machine's TZ since
// the macro buckets via `new Date(ts*1000).toISOString().slice(0,10)` (UTC).
const DAY1 = Date.UTC(2026, 5, 1, 12, 0, 0) / 1000;  // 2026-06-01 12:00 UTC
const DAY2 = Date.UTC(2026, 5, 2, 12, 0, 0) / 1000;  // 2026-06-02 12:00 UTC
const DAY3 = Date.UTC(2026, 5, 3, 12, 0, 0) / 1000;  // 2026-06-03 12:00 UTC
const DAY3_LATE = Date.UTC(2026, 5, 3, 18, 0, 0) / 1000; // still 2026-06-03

beforeEach(() => { makeSchema(); });

const ctxA = () => ({ db, actor: { userId: "user_a" } });

describe("dreams.busiest-night — guard clauses", () => {
  it("no_db without a db", async () => {
    const r = await call("busiest-night", { actor: { userId: "x" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });
  it("no_actor without an actor", async () => {
    const r = await call("busiest-night", { db }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_actor");
  });
});

describe("dreams.busiest-night — honest empty states", () => {
  it("empty + no_dream_history when the player has zero dreams", async () => {
    const r = await call("busiest-night", ctxA(), {});
    assert.equal(r.ok, true);
    assert.equal(r.metric, "activity_intensity");
    assert.equal(r.empty, true);
    assert.equal(r.reason, "no_dream_history");
    assert.deepEqual(r.nights, []);
    assert.equal(r.totalNights, 0);
  });

  it("empty + not_enough_history when only one distinct night exists (a ranking of 1 isn't a ranking)", async () => {
    insertDreamAt("drm_1", "user_a", DAY1, 5);
    insertDreamAt("drm_2", "user_a", DAY1 + 3600, 7); // same calendar day as drm_1
    const r = await call("busiest-night", ctxA(), {});
    assert.equal(r.ok, true);
    assert.equal(r.empty, true);
    assert.equal(r.reason, "not_enough_history");
    assert.deepEqual(r.nights, []);
    // totalNights reflects the real single-night count even though the
    // ranking itself is withheld — this is what makes the empty state honest
    // rather than silently swallowing data.
    assert.equal(r.totalNights, 1);
  });
});

describe("dreams.busiest-night — ranking correctness (hand-computed)", () => {
  // Hand-computed expected order:
  //   DAY1: drm_1(4) + drm_1b(2)      = 6
  //   DAY2: drm_2(9)                  = 9   <- busiest
  //   DAY3: drm_3(3) + drm_3b(3)      = 6   <- ties DAY1 at 6, but DAY3 > DAY1
  // Expected rank order: DAY2 (9), DAY3 (6, tie-break wins vs DAY1 since it's
  // the more recent day), DAY1 (6).
  beforeEach(() => {
    insertDreamAt("drm_1", "user_a", DAY1, 4);
    insertDreamAt("drm_1b", "user_a", DAY1 + 1800, 2);
    insertDreamAt("drm_2", "user_a", DAY2, 9);
    insertDreamAt("drm_3", "user_a", DAY3, 3);
    insertDreamAt("drm_3b", "user_a", DAY3_LATE, 3);
  });

  it("ranks nights by summed real fragment_count, highest first", async () => {
    const r = await call("busiest-night", ctxA(), {});
    assert.equal(r.ok, true);
    assert.equal(r.empty, false);
    assert.equal(r.metric, "activity_intensity");
    assert.equal(r.totalNights, 3);
    assert.equal(r.nights.length, 3);

    const order = r.nights.map((n) => n.day);
    assert.deepEqual(order, ["2026-06-02", "2026-06-03", "2026-06-01"]);

    const byDay = Object.fromEntries(r.nights.map((n) => [n.day, n]));
    assert.equal(byDay["2026-06-02"].activityIntensity, 9);
    assert.equal(byDay["2026-06-02"].dreamCount, 1);
    assert.equal(byDay["2026-06-03"].activityIntensity, 6);
    assert.equal(byDay["2026-06-03"].dreamCount, 2);
    assert.equal(byDay["2026-06-01"].activityIntensity, 6);
    assert.equal(byDay["2026-06-01"].dreamCount, 2);
  });

  it("deterministic tie-break: equal-intensity nights order by calendar day, most recent first", async () => {
    const r = await call("busiest-night", ctxA(), {});
    const tiedDays = r.nights.filter((n) => n.activityIntensity === 6).map((n) => n.day);
    assert.deepEqual(tiedDays, ["2026-06-03", "2026-06-01"]);
  });

  it("is deterministic across repeated calls (no Math.random, no ordering drift)", async () => {
    const r1 = await call("busiest-night", ctxA(), {});
    const r2 = await call("busiest-night", ctxA(), {});
    assert.deepEqual(r1.nights, r2.nights);
  });

  it("respects the limit parameter", async () => {
    const r = await call("busiest-night", ctxA(), { limit: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.nights.length, 1);
    assert.equal(r.nights[0].day, "2026-06-02");
    // totalNights still reports the true count of distinct nights, not the
    // truncated page — the "how many nights exist" fact isn't hidden by limit.
    assert.equal(r.totalNights, 3);
  });

  it("scopes strictly to the calling user (no cross-user leakage)", async () => {
    insertDreamAt("drm_other_1", "user_b", DAY1, 999);
    insertDreamAt("drm_other_2", "user_b", DAY2, 999);
    const r = await call("busiest-night", ctxA(), {});
    assert.equal(r.ok, true);
    // user_b's huge fragment counts must not appear in user_a's ranking.
    for (const n of r.nights) assert.ok(n.activityIntensity <= 9);
  });
});
