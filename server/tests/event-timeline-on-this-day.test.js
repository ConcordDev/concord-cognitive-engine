// server/tests/event-timeline-on-this-day.test.js
//
// Contract tests for `event_timeline.on_this_day` (WAVE4 event-timeline
// unit) — the honest, DTU-scoped "on this day" macro added to
// server/domains/event-timeline.js. Exercises it against a real in-memory
// `dtus` table (migrations 001 + 087 + 295, the three migrations that
// together produce the table shape actually written to in production —
// canonical type/creator_id/data columns from 087, plus the legacy
// content/content_type/metadata_json/status columns from 295) so the
// mixed created_at storage formats real writers use (unix-seconds INTEGER
// via `Math.floor(Date.now()/1000)`/`unixepoch()`, and the TEXT
// millisecond datetime string `economy/dtu-pipeline.js#nowISO()` writes)
// are both exercised, not just one idealized shape.
//
// Fully in-memory (`new Database(":memory:")`) — no DB_PATH/env or shared
// on-disk file is touched, so this test file is isolated from any other
// suite or concurrently-running process by construction.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerEventTimelineMacros from "../domains/event-timeline.js";
import { listRecent as libListRecent, stats as libStats } from "../lib/event-timeline.js";
import { up as upMig001 } from "../migrations/001_core_tables.js";
import { up as upMig087 } from "../migrations/087_dtus_type_creator_data.js";
import { up as upMig295 } from "../migrations/295_dtus_pipeline_reconcile.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`event_timeline.${name}`);
  if (!fn) throw new Error(`event_timeline.${name} not registered`);
  return fn(ctx, input);
}

before(() => {
  registerEventTimelineMacros(register, { listRecent: libListRecent, stats: libStats });
});

// Fixed "today" for deterministic assertions — independent of the actual
// calendar date the test suite happens to run on. July 17, 12:00 UTC.
const FIXED_NOW_MS = Date.UTC(2026, 6, 17, 12, 0, 0);

// Helpers to build a UTC unix-seconds timestamp for (year, month, day).
function unixSecFor(year, month, day, hh = 9, mm = 0, ss = 0) {
  return Math.floor(Date.UTC(year, month - 1, day, hh, mm, ss) / 1000);
}
// The exact TEXT shape `economy/dtu-pipeline.js#nowISO()` writes:
// "YYYY-MM-DD HH:MM:SS.sss" (UTC, no trailing Z, no 'T').
function isoTextFor(year, month, day, hh = 9, mm = 15, ss = 22, ms = 123) {
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hh)}:${pad(mm)}:${pad(ss)}.${pad(ms, 3)}`;
}

let db;

function insertDtu(row) {
  db.prepare(`
    INSERT INTO dtus (id, type, title, creator_id, data, tier, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.type || "knowledge", row.title || "Untitled", row.creatorId,
    row.data ? JSON.stringify(row.data) : null, row.tier || "regular", row.createdAt,
  );
}

function seed() {
  db = new Database(":memory:");
  upMig001(db);
  upMig087(db);
  upMig295(db);

  // ── user_a: the primary subject under test ──────────────────────────
  // Matches today (07-17), 3 years ago, unix-seconds INTEGER format.
  insertDtu({
    id: "dtu_a_2023", creatorId: "user_a", type: "knowledge", title: "A note from the road",
    data: { human: "Camped by the river, mapped the eastern trail." },
    createdAt: unixSecFor(2023, 7, 17),
  });
  // Matches today (07-17), 7 years ago, TEXT ISO-with-ms format
  // (the real economy/dtu-pipeline.js#nowISO() shape).
  insertDtu({
    id: "dtu_a_2019", creatorId: "user_a", type: "recipe", title: "First blueprint",
    data: { summary: "Drafted the original workshop layout." },
    createdAt: isoTextFor(2019, 7, 17),
  });
  // Wrong day (07-16) — must NOT match with dayWindow=0.
  insertDtu({
    id: "dtu_a_wrongday", creatorId: "user_a", type: "knowledge", title: "Off by one",
    createdAt: unixSecFor(2024, 7, 16),
  });
  // Same year as "today" (2026-07-17) — must be excluded: PRIOR years only.
  insertDtu({
    id: "dtu_a_thisyear", creatorId: "user_a", type: "knowledge", title: "Today, not a memory",
    createdAt: unixSecFor(2026, 7, 17),
  });
  // Shadow tier, same day, prior year — must be excluded (federation
  // signal, not something user_a composed/authored).
  insertDtu({
    id: "dtu_a_shadow", creatorId: "user_a", type: "knowledge", title: "Not really mine",
    tier: "shadow", createdAt: unixSecFor(2022, 7, 17),
  });
  // Two days before (07-15), prior year — only matches with dayWindow>=2.
  insertDtu({
    id: "dtu_a_2days", creatorId: "user_a", type: "knowledge", title: "Almost",
    createdAt: unixSecFor(2020, 7, 15),
  });
  // A system-composed-but-owned dream DTU on the matching day — should
  // count (creator_id = user_a, per embodied/dream-engine.js's real
  // insert shape).
  insertDtu({
    id: "dtu_a_dream", creatorId: "user_a", type: "dream", title: "Dream",
    data: { human: "There was blood today. One fell." },
    createdAt: unixSecFor(2021, 7, 17),
  });

  // ── user_b: different owner, same matching day — must not leak into
  //    user_a's results (scoping). ────────────────────────────────────
  insertDtu({
    id: "dtu_b_2021", creatorId: "user_b", type: "knowledge", title: "Not user_a's",
    createdAt: unixSecFor(2021, 7, 17),
  });

  return db;
}

beforeEach(() => { seed(); });

const ctxFor = (userId) => ({ db, actor: { userId } });

describe("event_timeline.on_this_day — envelope", () => {
  it("no_db when ctx lacks a db", async () => {
    const r = await call("on_this_day", { actor: { userId: "user_a" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("auth_required when the caller has no userId", async () => {
    const r = await call("on_this_day", { db }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
  });
});

describe("event_timeline.on_this_day — exact day match (dayWindow=0 default)", () => {
  it("returns exactly the caller's own DTUs matching today's month+day in prior years", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    assert.equal(r.ok, true);
    assert.equal(r.month, 7);
    assert.equal(r.day, 17);

    const ids = r.entries.map((e) => e.id).sort();
    // Expected: 2023 (unix-int), 2019 (ISO-text), 2021 (dream, owned).
    // NOT expected: wrongday (07-16), thisyear (2026, not prior), shadow
    // (excluded tier), 2days (07-15, needs dayWindow>=2), user_b's row
    // (different owner).
    assert.deepEqual(ids, ["dtu_a_2019", "dtu_a_2023", "dtu_a_dream"]);
    assert.equal(r.count, 3);
    assert.equal(r.truncated, false);
  });

  it("computes yearsAgo correctly per entry and sorts most-recent-first", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    assert.equal(r.ok, true);
    const byId = Object.fromEntries(r.entries.map((e) => [e.id, e]));
    assert.equal(byId.dtu_a_2023.yearsAgo, 3);
    assert.equal(byId.dtu_a_2019.yearsAgo, 7);
    assert.equal(byId.dtu_a_dream.yearsAgo, 5);
    // Most recent (2023, 3 years ago) must sort before oldest (2019, 7 years ago).
    assert.deepEqual(r.entries.map((e) => e.id), ["dtu_a_2023", "dtu_a_dream", "dtu_a_2019"]);
  });

  it("carries real title/kind/createdAt — no fabricated fields", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    const entry = r.entries.find((e) => e.id === "dtu_a_2023");
    assert.equal(entry.title, "A note from the road");
    assert.equal(entry.kind, "knowledge");
    assert.equal(entry.createdAt, unixSecFor(2023, 7, 17));
    assert.match(entry.preview, /Camped by the river/);
  });

  it("normalizes the TEXT ISO-with-ms created_at shape correctly (not silently dropped)", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    const entry = r.entries.find((e) => e.id === "dtu_a_2019");
    assert.ok(entry, "the TEXT-datetime-stored DTU must still be found");
    assert.equal(entry.createdAt, unixSecFor(2019, 7, 17, 9, 15, 22));
  });

  it("excludes a same-year (today's own) DTU — prior years only", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    assert.ok(!r.entries.some((e) => e.id === "dtu_a_thisyear"));
  });

  it("excludes shadow-tier rows (federation-propagated, not authored)", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    assert.ok(!r.entries.some((e) => e.id === "dtu_a_shadow"));
  });

  it("excludes a wrong-day DTU (off by one)", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    assert.ok(!r.entries.some((e) => e.id === "dtu_a_wrongday"));
  });
});

describe("event_timeline.on_this_day — dayWindow fuzz match", () => {
  it("includes a 2-day-off DTU only once dayWindow >= 2", async () => {
    const strict = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    assert.ok(!strict.entries.some((e) => e.id === "dtu_a_2days"));

    const fuzzy = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS, dayWindow: 2 });
    assert.equal(fuzzy.ok, true);
    assert.equal(fuzzy.dayWindow, 2);
    assert.ok(fuzzy.entries.some((e) => e.id === "dtu_a_2days"));
  });

  it("clamps dayWindow into [0, 7]", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS, dayWindow: 999 });
    assert.equal(r.ok, true);
    assert.equal(r.dayWindow, 7);
  });
});

describe("event_timeline.on_this_day — scoping (own DTUs only)", () => {
  it("never returns another user's DTUs, even on the same matching day", async () => {
    const r = await call("on_this_day", ctxFor("user_a"), { now: FIXED_NOW_MS });
    assert.ok(!r.entries.some((e) => e.id === "dtu_b_2021"));
  });

  it("user_b sees their own matching row, not user_a's", async () => {
    const r = await call("on_this_day", ctxFor("user_b"), { now: FIXED_NOW_MS });
    assert.equal(r.ok, true);
    assert.deepEqual(r.entries.map((e) => e.id), ["dtu_b_2021"]);
  });
});

describe("event_timeline.on_this_day — honest empty state", () => {
  it("returns ok:true with an empty array for a user with no matching history (not an error)", async () => {
    const r = await call("on_this_day", ctxFor("user_with_nothing"), { now: FIXED_NOW_MS });
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
    assert.deepEqual(r.entries, []);
  });

  it("returns ok:true with an empty array for a real user on a date with no history", async () => {
    // user_a has real DTUs, but none on Jan 1.
    const janFirst = Date.UTC(2026, 0, 1, 12, 0, 0);
    const r = await call("on_this_day", ctxFor("user_a"), { now: janFirst });
    assert.equal(r.ok, true);
    assert.equal(r.month, 1);
    assert.equal(r.day, 1);
    assert.equal(r.count, 0);
    assert.deepEqual(r.entries, []);
  });
});
