// forecast-full-build.test.js — the forecast lens build's server pins
// (B10, build(forecast), 2026-11-03). Hermetic: drives lib/world-forecast.js
// directly against an in-memory DB, same pattern as forecast-domain-macros.
//
//   S1 — humidity normalization at compose: the lib contract is percent
//        (signals thresholds read 75/80 as percents; the macros suite seeds
//        82 and pins it preserved), but prod's embodied rows can carry the
//        channel at fraction scale and the fold averages raw — a fraction
//        value must become percent at compose, a percent value must pass
//        through untouched.
//   S4a — the hourly model is a 24h-periodic diurnal cosine: without a
//        day-over-day term, hour h+24 IS hour h. The build adds
//        composeMultiDay's deterministic per-day drift from day 1 on; the
//        first 24h must stay byte-identical to the pure curve.
//   S4b — the handler read, pinned: forecastAccuracy DERIVES ON READ from
//        the persisted archive (no stored samples, no writer). Persisted
//        rows alone — inserted with chosen timestamps — produce scored
//        comparisons, and the set grows as more rows persist.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  composeForecast,
  composeHourly,
  persistForecast,
  forecastAccuracy,
  normalizeHumidityPct,
} from "../lib/world-forecast.js";
import { seedWorldClimate } from "../lib/embodied/signals.js";

const WORLD = "forecast-build-world";

function bootDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE embodied_signal_log (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, location_x REAL, location_z REAL,
      cell_x INTEGER, cell_z INTEGER, channel TEXT NOT NULL, value REAL NOT NULL,
      raw_value REAL, observer_id TEXT, observer_type TEXT, source TEXT, source_id TEXT,
      train_consented INTEGER NOT NULL DEFAULT 1,
      observed_at INTEGER NOT NULL DEFAULT (unixepoch()), recorded_at INTEGER, decay_at INTEGER
    );
    CREATE TABLE faction_strategy_state (
      faction_id TEXT PRIMARY KEY, stance TEXT NOT NULL DEFAULT 'consolidate',
      target_id TEXT, phase INTEGER NOT NULL DEFAULT 0, next_move_at INTEGER NOT NULL DEFAULT 0,
      momentum REAL NOT NULL DEFAULT 0, last_move_id TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE forward_predictions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT, subject_kind TEXT NOT NULL,
      subject_id TEXT NOT NULL, anticipated TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
      composer TEXT NOT NULL DEFAULT 'deterministic', prediction_dtu_id TEXT,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch()), expires_at INTEGER NOT NULL,
      realised_at INTEGER, reality_outcome TEXT
    );
    CREATE TABLE IF NOT EXISTS world_forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, world_id TEXT NOT NULL,
      forecast_json TEXT NOT NULL, composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

describe("S1 — humidity normalization at compose", () => {
  it("normalizeHumidityPct maps fraction scale to percent, leaves percent untouched", () => {
    assert.equal(normalizeHumidityPct(0.95), 95);
    assert.equal(normalizeHumidityPct(0.5), 50);
    assert.equal(normalizeHumidityPct(1), 100);
    assert.equal(normalizeHumidityPct(82), 82);
    assert.equal(normalizeHumidityPct(0), 0);
    assert.equal(normalizeHumidityPct(null), null);
    assert.equal(normalizeHumidityPct(undefined), null);
  });

  it("a fraction-scale embodied baseline composes to percent humidity", async () => {
    const db = bootDb();
    seedWorldClimate(db, WORLD, { temperature: 1.5, humidity: 0.95, pressure: 100.2 });
    const r = await composeForecast(db, {}, WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.forecast.weather.humidity_pct, 95);
    db.close();
  });

  it("a percent-scale baseline passes through compose unchanged", async () => {
    const db = bootDb();
    seedWorldClimate(db, WORLD, { temperature: 1.5, humidity: 82, pressure: 100.2 });
    const r = await composeForecast(db, {}, WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.forecast.weather.humidity_pct, 82);
    db.close();
  });
});

describe("S4a — the hourly model is not day 1 tiled", () => {
  it("the first 24h is exactly the pure diurnal curve; day 2 drifts off it", async () => {
    const db = bootDb();
    seedWorldClimate(db, WORLD, { temperature: 10, humidity: 60, pressure: 101 });
    const startHour = new Date().getHours();
    const r = await composeHourly(db, {}, WORLD, 48);
    assert.equal(r.ok, true);
    assert.equal(r.breakdown.length, 48);
    // Day 1: the untainted cosine, anchored on the measured mean (10 °C).
    for (let h = 0; h < 24; h++) {
      const clock = (startHour + h) % 24;
      const factor = Math.cos(((clock - 15) / 24) * Math.PI * 2);
      const expected = Number((10 + factor * 4.5).toFixed(1));
      assert.equal(r.breakdown[h].temperature_c, expected, `hour ${h} stays the pure curve`);
      assert.equal(r.breakdown[h].clock_hour, clock);
    }
    // Day 2: same clock hours, but the per-day drift has moved the curve —
    // the day is not a copy of day 1.
    let differing = 0;
    for (let h = 0; h < 24; h++) {
      assert.equal(r.breakdown[h + 24].clock_hour, r.breakdown[h].clock_hour);
      if (r.breakdown[h + 24].temperature_c !== r.breakdown[h].temperature_c) differing += 1;
    }
    assert.ok(differing >= 12, `day 2 must differ from day 1 (got ${differing}/24 differing hours)`);
    db.close();
  });
});

describe("S4b — accuracy derives on read from the persisted archive", () => {
  function insertForecast(db, composedAt, kind, temp) {
    db.prepare(`INSERT INTO world_forecasts (world_id, forecast_json, composed_at) VALUES (?, ?, ?)`)
      .run(WORLD, JSON.stringify({ window_hours: 24, weather: { kind, temperature_c: temp, confidence: 0.6 }, ecology: null, factions: [], events: [], drift: null }), composedAt);
  }

  it("persisted rows alone score — and the set grows as more rows persist", async () => {
    const db = bootDb();
    const T = 1700000000;
    insertForecast(db, T, "rain", 10);
    insertForecast(db, T + 25 * 3600, "rain", 12);
    let r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.ok, true);
    assert.equal(r.summary.sample_count, 1);
    assert.equal(r.summary.kind_accuracy, 1);
    assert.equal(r.summary.mean_temp_error_c, 2);
    assert.equal(r.comparisons[0].realized_ts, T + 25 * 3600);
    // A third persisted row extends the derived set with no writer involved:
    // row 2 now scores against row 3 (its +24h target lands on it exactly).
    insertForecast(db, T + 49 * 3600, "clear", 20);
    r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.summary.sample_count, 2);
    db.close();
  });

  it("persistForecast's own rows are what the derivation reads", async () => {
    const db = bootDb();
    seedWorldClimate(db, WORLD, { temperature: 5, humidity: 50, pressure: 101 });
    const c = await composeForecast(db, {}, WORLD);
    assert.equal(persistForecast(db, WORLD, c.forecast).ok, true);
    const r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.ok, true);
    // One row spans no window yet — the honest empty, derived not stored.
    assert.equal(r.summary.sample_count, 0);
    db.close();
  });
});
