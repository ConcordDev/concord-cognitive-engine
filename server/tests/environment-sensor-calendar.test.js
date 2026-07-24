/**
 * Wires `content/world/<id>/calendar.json` (scaffolded by
 * `world-kit-templates.js#calendarTemplate`) into the real Layer 7
 * day/night computation in `emergent/environment-sensor.js`.
 *
 * Before this test existed, `hours_per_day` / `day_phases` were generated
 * into calendar.json for 3 of 10 worlds (tunya, cyber, sere) but nothing
 * at runtime ever read them back — every world's day/night clock was
 * hardcoded to 24h with generic night/dawn/day/dusk phase names.
 *
 * Pins:
 *   1. `worldDayConfig` / `getWorldCalendar` read the real on-disk
 *      calendar.json for "cyber" (hours_per_day: 28) and produce a
 *      genuinely different (longer) day cycle length than the 24h default.
 *   2. `resolveDayPhase` matches an hour against a calendar's authored
 *      `day_phases`, including a wraparound phase (start > end).
 *   3. `runEnvironmentSensor` end-to-end: a world named "cyber" picks up
 *      the calendar (longer cycle + authored phase ids); a world with no
 *      calendar.json is completely unaffected — same 24h cycle, same
 *      generic phase names, byte-identical to the pre-wiring behavior
 *      (regression pin).
 *
 * Run: node --test server/tests/environment-sensor-calendar.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runEnvironmentSensor } from "../emergent/environment-sensor.js";
import {
  getWorldCalendar,
  resolveDayPhase,
  worldDayConfig,
  DEFAULT_HOURS_PER_DAY,
  _resetWorldCalendars,
} from "../lib/world-calendar.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE embodied_signal_log (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      location_x REAL,
      location_z REAL,
      cell_x INTEGER,
      cell_z INTEGER,
      channel TEXT NOT NULL,
      value REAL NOT NULL,
      source TEXT,
      source_id TEXT,
      observed_at INTEGER,
      recorded_at INTEGER,
      decay_at INTEGER,
      train_consented INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY,
      rule_modulators TEXT,
      time_of_day_s REAL,
      time_of_day TEXT,
      weather_state TEXT
    );
    CREATE TABLE world_visits (
      world_id TEXT,
      user_id TEXT,
      departed_at INTEGER
    );
  `);
  return db;
}

beforeEach(() => {
  _resetWorldCalendars();
});

// ───────────────────────────────────────────────────────────────────────────
// getWorldCalendar / worldDayConfig — real on-disk content
// ───────────────────────────────────────────────────────────────────────────

describe("getWorldCalendar reads real content/world/<id>/calendar.json", () => {
  it("cyber declares a 28-hour day with 5 authored phases", () => {
    const cal = getWorldCalendar("cyber");
    assert.ok(cal, "expected cyber calendar to load");
    assert.equal(cal.hoursPerDay, 28);
    assert.equal(cal.dayPhases.length, 5);
    assert.ok(cal.dayPhases.some((p) => p.id === "neon_dawn"));
    assert.ok(cal.dayPhases.some((p) => p.id === "dark_hours"));
  });

  it("tunya declares a 32-hour day", () => {
    const cal = getWorldCalendar("tunya");
    assert.ok(cal);
    assert.equal(cal.hoursPerDay, 32);
    assert.equal(cal.dayPhases.length, 8);
  });

  it("a world with no calendar.json returns null", () => {
    assert.equal(getWorldCalendar("concordia-hub"), null);
    assert.equal(getWorldCalendar("no-such-world-at-all"), null);
  });

  it("caches after first read (second call is stable)", () => {
    const first = getWorldCalendar("cyber");
    const second = getWorldCalendar("cyber");
    assert.equal(first, second, "expected the same cached object reference");
  });
});

describe("worldDayConfig — cycle length genuinely differs per world", () => {
  it("cyber's day cycle is longer than the 24h default (100800s vs 86400s)", () => {
    const cyber = worldDayConfig("cyber");
    const plain = worldDayConfig("a-world-without-any-calendar-file");

    assert.equal(plain.hoursPerDay, DEFAULT_HOURS_PER_DAY);
    assert.equal(plain.secondsPerDay, 86400);
    assert.equal(plain.phases, null);

    assert.equal(cyber.hoursPerDay, 28);
    assert.equal(cyber.secondsPerDay, 100800);
    assert.ok(cyber.secondsPerDay > plain.secondsPerDay,
      "a 28-hour world's day cycle must take longer wall-clock time than a 24h world's");
    assert.ok(Array.isArray(cyber.phases) && cyber.phases.length === 5);
  });

  it("a real elapsed 24h wraps a standard world into a new day but NOT a 28h world", () => {
    const plain = worldDayConfig("a-world-without-any-calendar-file");
    const cyber = worldDayConfig("cyber");

    // One real day (86400s) elapsed: the 24h world completes exactly one
    // full cycle (wraps to 0); the 28h world is still partway through its
    // (longer) first day.
    assert.equal(86400 % plain.secondsPerDay, 0);
    assert.notEqual(86400 % cyber.secondsPerDay, 0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// resolveDayPhase — pure phase-lookup, including wraparound
// ───────────────────────────────────────────────────────────────────────────

describe("resolveDayPhase", () => {
  const cyberPhases = getWorldCalendar("cyber")?.dayPhases;

  it("matches cyber's contiguous (non-wrapping) phases by hour", () => {
    assert.equal(resolveDayPhase(0, 28, cyberPhases)?.id, "neon_dawn");   // template hour 1
    assert.equal(resolveDayPhase(10, 28, cyberPhases)?.id, "corp_hours"); // template hour 11
    assert.equal(resolveDayPhase(27, 28, cyberPhases)?.id, "dark_hours"); // template hour 28
  });

  it("handles a wraparound phase (start_hour > end_hour)", () => {
    const wrappingPhases = [
      { id: "day_watch", start_hour: 5, end_hour: 20 },
      { id: "night_watch", start_hour: 21, end_hour: 4 }, // wraps past hour 24 → 1..4
    ];
    assert.equal(resolveDayPhase(1, 24, wrappingPhases)?.id, "night_watch");  // template hour 2
    assert.equal(resolveDayPhase(22, 24, wrappingPhases)?.id, "night_watch"); // template hour 23
    assert.equal(resolveDayPhase(10, 24, wrappingPhases)?.id, "day_watch");   // template hour 11
  });

  it("returns null for an empty/missing phase list", () => {
    assert.equal(resolveDayPhase(10, 24, null), null);
    assert.equal(resolveDayPhase(10, 24, []), null);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// runEnvironmentSensor — end-to-end wiring + regression pin
// ───────────────────────────────────────────────────────────────────────────

describe("runEnvironmentSensor wires calendar.json into the live day/night write", () => {
  it("a world named 'cyber' picks up its 28h calendar and authored phase id", () => {
    const db = setupDb();
    const SEEDED_SECONDS = 36000; // 10:00 on a standard clock
    db.prepare(`INSERT INTO worlds (id, rule_modulators, time_of_day_s) VALUES (?, ?, ?)`)
      .run("cyber", "{}", SEEDED_SECONDS);
    db.prepare(`INSERT INTO world_visits (world_id, user_id, departed_at) VALUES (?, ?, NULL)`)
      .run("cyber", "u1");

    const r = runEnvironmentSensor({ db });
    assert.equal(r.ok, true);
    assert.equal(r.worlds, 1);

    const row = db.prepare(`SELECT time_of_day, time_of_day_s FROM worlds WHERE id = ?`).get("cyber");
    // 36000s / 3600 = 10 (0-indexed hour) → template hour 11 → corp_hours (6-13).
    assert.equal(row.time_of_day, "corp_hours");
    // The persisted clock itself is untouched (already finite) — only the
    // *interpretation* changes, never the raw stored seconds.
    assert.equal(row.time_of_day_s, SEEDED_SECONDS);
  });

  it("a world with no calendar.json is byte-identical to the pre-wiring behavior", () => {
    const db = setupDb();
    const SEEDED_SECONDS = 36000; // same seed as the cyber case above
    db.prepare(`INSERT INTO worlds (id, rule_modulators, time_of_day_s) VALUES (?, ?, ?)`)
      .run("a-plain-test-world-xyz", "{}", SEEDED_SECONDS);
    db.prepare(`INSERT INTO world_visits (world_id, user_id, departed_at) VALUES (?, ?, NULL)`)
      .run("a-plain-test-world-xyz", "u1");

    const r = runEnvironmentSensor({ db });
    assert.equal(r.ok, true);

    const row = db.prepare(`SELECT time_of_day, time_of_day_s FROM worlds WHERE id = ?`).get("a-plain-test-world-xyz");
    // Original hardcoded formula: hourOfDay = 36000/3600 % 24 = 10 → "day"
    // (bracket: <5 night, <8 dawn, <18 day, else dusk).
    assert.equal(row.time_of_day, "day");
    assert.equal(row.time_of_day_s, SEEDED_SECONDS);
  });

  it("two worlds with identical seeded clocks diverge only because one has a calendar", () => {
    const db = setupDb();
    const SEEDED_SECONDS = 36000;
    for (const id of ["cyber", "a-plain-test-world-xyz"]) {
      db.prepare(`INSERT INTO worlds (id, rule_modulators, time_of_day_s) VALUES (?, ?, ?)`)
        .run(id, "{}", SEEDED_SECONDS);
      db.prepare(`INSERT INTO world_visits (world_id, user_id, departed_at) VALUES (?, ?, NULL)`)
        .run(id, "u1");
    }

    runEnvironmentSensor({ db });
    const cyberRow = db.prepare(`SELECT time_of_day FROM worlds WHERE id = ?`).get("cyber");
    const plainRow = db.prepare(`SELECT time_of_day FROM worlds WHERE id = ?`).get("a-plain-test-world-xyz");
    assert.notEqual(cyberRow.time_of_day, plainRow.time_of_day);
  });
});
