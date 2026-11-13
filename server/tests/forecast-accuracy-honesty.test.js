// FIX-forecast-005 — the Consistency view's samples disagreed with
// themselves three ways: duplicate samples shared one timestamp (a
// double compose in the same second persisted two rows for one
// instant and both scored), raw persisted temperatures rendered with
// binary float noise (0.4800000000000002°), and same-kind pairs
// counted as 'agree' across any temperature swing (15° vs 0.5° read
// as 100% agreement). forecastAccuracy now dedupes by instant (later
// row wins), rounds temperatures at the source, and counts agreement
// only within a 5°C drift when both temperatures are known.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { forecastAccuracy } from "../lib/world-forecast.js";

const WORLD = "forecast-honesty-world";
function bootDb() {
  const db = new Database(":memory:");
  return db;
}
function insertForecast(db, composedAt, kind, temp) {
  db.prepare(`INSERT INTO world_forecasts (world_id, forecast_json, composed_at) VALUES (?, ?, ?)`)
    .run(WORLD, JSON.stringify({ window_hours: 24, weather: { kind, temperature_c: temp } }), composedAt);
}

describe("FIX-forecast-005 consistency honesty", () => {
  it("same-second duplicate rows score once, with the later row's values", async () => {
    const db = bootDb();
    const T = 1700000000;
    await forecastAccuracy(db, WORLD, 20); // creates the table
    insertForecast(db, T, "rain", 10);
    insertForecast(db, T, "storm", 3); // same instant, supersedes
    insertForecast(db, T + 25 * 3600, "storm", 4);
    const r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.summary.sample_count, 1);
    assert.equal(r.comparisons[0].predicted_kind, "storm");
    assert.equal(r.comparisons[0].predicted_temp_c, 3);
    db.close();
  });

  it("a same-kind pair with a wild temperature swing does not count as agreement", async () => {
    const db = bootDb();
    const T = 1700000000;
    await forecastAccuracy(db, WORLD, 20);
    insertForecast(db, T, "clear", 15);
    insertForecast(db, T + 25 * 3600, "clear", 0.5);
    const r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.comparisons[0].temp_abs_error_c, 14.5);
    assert.equal(r.comparisons[0].kind_hit, false);
    assert.equal(r.summary.kind_accuracy, 0);
    db.close();
  });

  it("a same-kind pair within tolerance still agrees, and temperatures carry no float noise", async () => {
    const db = bootDb();
    const T = 1700000000;
    await forecastAccuracy(db, WORLD, 20);
    insertForecast(db, T, "clear", 0.4800000000000002 + 10);
    insertForecast(db, T + 25 * 3600, "clear", 10);
    const r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.comparisons[0].predicted_temp_c, 10.48);
    assert.equal(r.comparisons[0].temp_abs_error_c, 0.48);
    assert.equal(r.comparisons[0].kind_hit, true);
    assert.equal(r.summary.kind_accuracy, 1);
    db.close();
  });
});
