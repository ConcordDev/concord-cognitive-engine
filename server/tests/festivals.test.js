// Phase BB1 — festival engine tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  calendarFor,
  loadFestivalsFromContent,
  listFestivals,
  runFestivalTriggerPass,
  listActiveFestivals,
} from "../lib/festivals.js";
import { runFestivalTriggerCycle, _resetSeedFlag } from "../emergent/festival-trigger-cycle.js";
import { up as upFestivals } from "../migrations/235_festivals.js";

function freshDb() { const db = new Database(":memory:"); upFestivals(db); return db; }

describe("Phase BB1 — calendar math", () => {
  it("calendarFor returns season_idx + day_in_season + year_idx", () => {
    // day 0 of year 1.
    const c0 = calendarFor(0);
    assert.equal(c0.season_idx, 0);
    assert.equal(c0.day_in_season, 0);
    assert.equal(c0.year_idx, 1);

    // day 35 (5th season × 7 days) = deep_winter day 0.
    const c35 = calendarFor(35 * 86400000);
    assert.equal(c35.season_idx, 5);
    assert.equal(c35.day_in_season, 0);

    // day 41 = deep_winter day 6.
    const c41 = calendarFor(41 * 86400000);
    assert.equal(c41.season_idx, 5);
    assert.equal(c41.day_in_season, 6);

    // day 42 = year 2, season 0 day 0.
    const c42 = calendarFor(42 * 86400000);
    assert.equal(c42.season_idx, 0);
    assert.equal(c42.day_in_season, 0);
    assert.equal(c42.year_idx, 2);
  });
});

describe("Phase BB1 — festival content load", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("loadFestivalsFromContent reads 4 authored festivals", () => {
    const r = loadFestivalsFromContent(db);
    assert.equal(r.ok, true);
    assert.ok(r.loaded >= 4, `expected >=4 festivals, got ${r.loaded}`);
    const all = listFestivals(db);
    const ids = all.map(f => f.id).sort();
    assert.ok(ids.includes("wintersday"));
    assert.ok(ids.includes("harvest_moon"));
    assert.ok(ids.includes("lunar_dance"));
    assert.ok(ids.includes("founders_day"));
  });

  it("re-loading is idempotent on PK", () => {
    loadFestivalsFromContent(db);
    const r2 = loadFestivalsFromContent(db);
    assert.equal(r2.ok, true);
    const count = db.prepare(`SELECT COUNT(*) as n FROM festivals`).get().n;
    assert.equal(count, listFestivals(db).length);
  });
});

describe("Phase BB1 — trigger pass", () => {
  let db;
  beforeEach(() => { db = freshDb(); loadFestivalsFromContent(db); });

  it("opens wintersday when current day is deep_winter day 0", () => {
    // day 35 = deep_winter day 0.
    const now = 35 * 86400000;
    const r = runFestivalTriggerPass(db, "tunya", { now });
    assert.equal(r.ok, true);
    const opened = r.opened.map(o => o.festivalId);
    assert.ok(opened.includes("wintersday"));
  });

  it("does not open wintersday when current day is in a different season", () => {
    // day 0 = spring day 0.
    const r = runFestivalTriggerPass(db, "tunya", { now: 0 });
    const opened = r.opened.map(o => o.festivalId);
    assert.ok(!opened.includes("wintersday"));
  });

  it("dedupes within the same (festival, world, year)", () => {
    const now = 35 * 86400000;
    const a = runFestivalTriggerPass(db, "tunya", { now });
    const b = runFestivalTriggerPass(db, "tunya", { now });
    assert.ok(a.opened.length > 0);
    assert.equal(b.opened.length, 0, "second pass on same day doesn't re-open");
  });

  it("multi-world isolation (same festival opens separately per world)", () => {
    const now = 35 * 86400000;
    const a = runFestivalTriggerPass(db, "tunya", { now });
    const b = runFestivalTriggerPass(db, "cyber", { now });
    assert.ok(a.opened.length > 0);
    assert.ok(b.opened.length > 0);
  });

  it("listActiveFestivals returns festivals whose ends_at is in the future", () => {
    const now = 35 * 86400000;
    runFestivalTriggerPass(db, "tunya", { now });
    const active = listActiveFestivals(db, "tunya", now);
    assert.ok(active.length > 0);
    const wd = active.find(f => f.festival_id === "wintersday");
    assert.ok(wd);
    assert.ok(wd.ends_at > Math.floor(now / 1000));
  });
});

describe("Phase BB1 — heartbeat handler", () => {
  let db;
  beforeEach(() => { db = freshDb(); _resetSeedFlag(); });

  it("seeds on first tick and emits festival:started via io", () => {
    const emits = [];
    const fakeIo = { emit: (name, payload) => emits.push({ name, payload }) };
    // Force the calendar into deep_winter by patching Date.now via a setter.
    const origNow = Date.now;
    Date.now = () => 35 * 86400000;
    try {
      const r = runFestivalTriggerCycle({ db, worldId: "tunya", io: fakeIo });
      assert.equal(r.ok, true);
      assert.ok(r.openedCount >= 1);
      assert.ok(emits.some(e => e.name === "festival:started" && e.payload.festivalId === "wintersday"));
    } finally {
      Date.now = origNow;
    }
  });

  it("env disable short-circuits", () => {
    process.env.CONCORD_FESTIVALS_ENABLED = "0";
    const r = runFestivalTriggerCycle({ db, worldId: "tunya" });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, "disabled_by_env");
    delete process.env.CONCORD_FESTIVALS_ENABLED;
  });

  it("returns no_db_or_world on missing inputs", () => {
    assert.equal(runFestivalTriggerCycle({}).ok, false);
  });
});
