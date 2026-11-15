/**
 * GB-1539 / FIX-forecast-002 — alerts and archived forecasts are owned
 * by their creator (DUTCH-DECISIONS-46 #12), owner-scoped like export.
 *
 * Before the fix the forecast domain registered NO export provider and
 * world_forecasts carried no creator, so a personal export came back
 * "Nothing to export" while the caller's alerts and archived forecasts
 * existed — and the only way to fill it would have been dumping a
 * world-keyed table into one user's file. The lib now stamps the
 * composer at persist time and serves provider rows scoped to the
 * caller: their alert subscriptions + their archived forecasts.
 * Pre-stamp (NULL-composer) rows belong to no one and enter no export.
 *
 * Hermetic: node:sqlite in-memory db (API-compatible with the
 * better-sqlite3 surface this lib uses); world-forecast.js takes db as
 * a parameter throughout.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  persistForecast,
  createAlertSub,
  forecastExportRows,
  ownArchivedForecasts,
} from "../lib/world-forecast.js";

const FC = { window_hours: 24, weather: { kind: "rain", confidence: 0.8, temperature_c: 12 }, ecology: null, factions: [], events: [], drift: null };

describe("forecast export owner scope (FIX-forecast-002)", () => {
  it("a caller's export carries their alerts and their archived forecasts — and no one else's", () => {
    const db = new DatabaseSync(":memory:");
    persistForecast(db, "world-a", FC, "u_a");
    persistForecast(db, "world-a", FC, "u_b");
    createAlertSub(db, "u_a", { worldId: "world-a", kind: "weather" });
    createAlertSub(db, "u_b", { worldId: "world-a", kind: "drift" });

    const aRows = forecastExportRows(db, "u_a");
    assert.deepEqual(aRows.map((r) => r.type).sort(), ["forecast-alert", "forecast-archive"]);
    assert.equal(aRows.find((r) => r.type === "forecast-alert")?.data.kind, "weather");

    const bRows = forecastExportRows(db, "u_b");
    assert.equal(bRows.find((r) => r.type === "forecast-alert")?.data.kind, "drift");
    const aArc = aRows.find((r) => r.type === "forecast-archive");
    const bArc = bRows.find((r) => r.type === "forecast-archive");
    assert.notEqual(aArc?.id, bArc?.id);
  });

  it("pre-stamp (NULL-composer) archive rows belong to no one and enter no export", () => {
    const db = new DatabaseSync(":memory:");
    persistForecast(db, "world-a", FC, null); // legacy compose, no stamp
    persistForecast(db, "world-a", FC, "u_a");
    const aRows = forecastExportRows(db, "u_a");
    assert.equal(aRows.filter((r) => r.type === "forecast-archive").length, 1);
    assert.equal(ownArchivedForecasts(db, "u_b").length, 0);
  });

  it("an anonymous caller exports nothing", () => {
    const db = new DatabaseSync(":memory:");
    persistForecast(db, "world-a", FC, "u_a");
    createAlertSub(db, "u_a", { worldId: "world-a", kind: "any" });
    assert.deepEqual(forecastExportRows(db, null), []);
    assert.deepEqual(forecastExportRows(db, ""), []);
  });

  it("the creator column is added in place to a pre-ruling table (migration leg)", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE world_forecasts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      forecast_json TEXT NOT NULL,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`);
    db.prepare(`INSERT INTO world_forecasts (world_id, forecast_json) VALUES (?, ?)`)
      .run("world-a", JSON.stringify(FC));
    const r = persistForecast(db, "world-a", FC, "u_a");
    assert.equal(r.ok, true);
    const cols = db.prepare(`PRAGMA table_info(world_forecasts)`).all().map((c) => c.name);
    assert.ok(cols.includes("composed_by"));
    assert.equal(ownArchivedForecasts(db, "u_a").length, 1); // only the stamped row
  });
});
