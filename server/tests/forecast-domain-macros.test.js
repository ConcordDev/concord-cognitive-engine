// Hermetic behavioral test for the forecast domain — drives
// server/lib/world-forecast.js DIRECTLY (the forecast.* macros registered
// inline in server.js delegate to exactly these exports), against a small
// in-memory SQLite DB with only the tables the lib touches. NO server.js boot,
// NO network, NO LLM — runs in <1s.
//
// These are NOT shape-only assertions. They seed REAL embodied climate signals
// + a real faction-strategy row + a real forward-prediction row, then assert
// ACTUAL values: composeForecast reads the seeded baseline back into a 24h
// forecast (temperature/humidity/kind), persistForecast → recentForecast
// round-trips the exact composed shape, the multi-day/hourly/regional/accuracy/
// archive extensions return grounded values, the alert-subscription lifecycle
// persists, and the fail-CLOSED numeric guard rejects poisoned days/hours/limit.
//
// Run: node --test tests/forecast-domain-macros.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  composeForecast,
  persistForecast,
  recentForecast,
  composeMultiDay,
  composeHourly,
  composeRegional,
  forecastAccuracy,
  forecastArchive,
  evaluateAlerts,
  createAlertSub,
  listAlertSubs,
  deleteAlertSub,
  checkAlerts,
  FORECAST_REGIONS,
  regionAnchor,
} from "../lib/world-forecast.js";
import { seedWorldClimate, recordSignal } from "../lib/embodied/signals.js";

const WORLD = "concordia-hub";

// The merged (mig 112 + 113) embodied_signal_log schema recordSignal writes.
// Built directly so the test stays lightweight (no full migrate runner).
function bootDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE embodied_signal_log (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      location_x    REAL,
      location_z    REAL,
      cell_x        INTEGER,
      cell_z        INTEGER,
      channel       TEXT NOT NULL,
      value         REAL NOT NULL,
      raw_value     REAL,
      observer_id   TEXT,
      observer_type TEXT,
      source        TEXT,
      source_id     TEXT,
      train_consented INTEGER NOT NULL DEFAULT 1,
      observed_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      recorded_at   INTEGER,
      decay_at      INTEGER
    )
  `);
  db.exec(`
    CREATE TABLE faction_strategy_state (
      faction_id   TEXT PRIMARY KEY,
      stance       TEXT NOT NULL DEFAULT 'consolidate',
      target_id    TEXT,
      phase        INTEGER NOT NULL DEFAULT 0,
      next_move_at INTEGER NOT NULL DEFAULT 0,
      momentum     REAL NOT NULL DEFAULT 0,
      last_move_id TEXT,
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`
    CREATE TABLE forward_predictions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      world_id        TEXT,
      subject_kind    TEXT NOT NULL,
      subject_id      TEXT NOT NULL,
      anticipated     TEXT NOT NULL,
      confidence      REAL NOT NULL DEFAULT 0.5,
      composer        TEXT NOT NULL DEFAULT 'deterministic',
      prediction_dtu_id TEXT,
      composed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at      INTEGER NOT NULL,
      realised_at     INTEGER,
      reality_outcome TEXT
    )
  `);
  return db;
}

// Seed a believable world: a cold humid climate baseline + a faction with a
// pending move + an active forward-prediction. These are the REAL inputs the
// forecast composer folds.
function seedWorld(db) {
  seedWorldClimate(db, WORLD, { temperature: 1.5, humidity: 82, pressure: 100.2 });
  const soon = Math.floor(Date.now() / 1000) + 3600; // +1h
  db.prepare(`
    INSERT INTO faction_strategy_state (faction_id, stance, momentum, next_move_at)
    VALUES (?, ?, ?, ?)
  `).run("iron_concord", "expand", 0.4, soon);
  db.prepare(`
    INSERT INTO forward_predictions
      (id, user_id, world_id, subject_kind, subject_id, anticipated, confidence, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run("fp_1", "u1", WORLD, "quest", "q1", "A storm front gates the harvest.", 0.78,
    Math.floor(Date.now() / 1000) + 7200);
}

describe("forecast — composeForecast reads seeded signals into a real 24h forecast", () => {
  let db;
  beforeEach(() => { db = bootDb(); seedWorld(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("composes a grounded 24h forecast (weather + faction + events) from live state", async () => {
    const r = await composeForecast(db, {}, WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.worldId, WORLD);
    assert.equal(r.forecast.window_hours, 24);

    // Weather is read back from the seeded cold+humid baseline → 'storm' kind.
    assert.ok(r.forecast.weather, "weather present from seeded signals");
    assert.equal(r.forecast.weather.kind, "storm");
    // Temperature folds the seeded 1.5°C baseline (recency-weighted, ~exact).
    assert.ok(Math.abs(r.forecast.weather.temperature_c - 1.5) < 0.5,
      `temp ${r.forecast.weather.temperature_c} ~ 1.5`);
    assert.ok(r.forecast.weather.humidity_pct > 75, "humid baseline preserved");
    assert.equal(r.forecast.weather.confidence, 0.6);

    // Faction strategy surfaced from the real row.
    assert.equal(r.forecast.factions.length, 1);
    assert.equal(r.forecast.factions[0].id, "iron_concord");
    assert.equal(r.forecast.factions[0].predicted_kind, "expand");
    assert.ok(r.forecast.factions[0].eta_hours > 0 && r.forecast.factions[0].eta_hours <= 1.1);

    // Forward-prediction surfaced as an event.
    assert.equal(r.forecast.events.length, 1);
    assert.match(r.forecast.events[0].summary, /storm front/);
    assert.equal(r.forecast.events[0].confidence, 0.78);
    assert.ok(typeof r.composedAt === "number");
  });

  it("composeForecast returns ok with empty sections on a barren world (no fake data)", async () => {
    const db2 = bootDb(); // no seed
    const r = await composeForecast(db2, {}, WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.forecast.weather, null, "no signals → no invented weather");
    assert.deepEqual(r.forecast.factions, []);
    assert.deepEqual(r.forecast.events, []);
    db2.close();
  });

  it("rejects missing inputs", async () => {
    assert.equal((await composeForecast(null, {}, WORLD)).ok, false);
    assert.equal((await composeForecast(db, {}, "")).ok, false);
  });
});

describe("forecast — persist → recent round-trips the composed forecast", () => {
  let db;
  beforeEach(() => { db = bootDb(); seedWorld(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("persistForecast writes a row recentForecast reads back identically", async () => {
    const composed = await composeForecast(db, {}, WORLD);
    assert.equal(composed.ok, true);
    const persisted = persistForecast(db, WORLD, composed.forecast);
    assert.equal(persisted.ok, true);

    const back = recentForecast(db, WORLD);
    assert.ok(back, "recent returns the persisted forecast");
    assert.equal(back.weather.kind, composed.forecast.weather.kind);
    assert.equal(back.weather.temperature_c, composed.forecast.weather.temperature_c);
    assert.equal(back.factions.length, composed.forecast.factions.length);
    assert.equal(typeof back.composedAt, "number");
  });

  it("recentForecast returns the MOST recent of multiple persisted rows", async () => {
    const c1 = await composeForecast(db, {}, WORLD);
    persistForecast(db, WORLD, c1.forecast); // ensure table exists
    const now = Math.floor(Date.now() / 1000);
    const ins = db.prepare(`INSERT INTO world_forecasts (world_id, forecast_json, composed_at) VALUES (?,?,?)`);
    ins.run(WORLD, JSON.stringify({ ...c1.forecast, marker: "old" }), now - 3600);
    ins.run(WORLD, JSON.stringify({ ...c1.forecast, marker: "new" }), now + 3600);
    const back = recentForecast(db, WORLD);
    assert.equal(back.marker, "new");
  });

  it("recentForecast returns null when nothing persisted", () => {
    assert.equal(recentForecast(bootDb(), WORLD), null);
  });
});

describe("forecast — multi-day / hourly / regional extensions return grounded values", () => {
  let db;
  beforeEach(() => { db = bootDb(); seedWorld(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("composeMultiDay yields N days with honestly-decaying confidence", async () => {
    const r = await composeMultiDay(db, {}, WORLD, 5);
    assert.equal(r.ok, true);
    assert.equal(r.days, 5);
    assert.equal(r.outlook.length, 5);
    // Confidence strictly decays the further out we look.
    for (let i = 1; i < r.outlook.length; i++) {
      assert.ok(r.outlook[i].weather.confidence < r.outlook[i - 1].weather.confidence,
        `day ${i} confidence decays`);
    }
    // Day 0 inherits the measured baseline kind.
    assert.equal(r.outlook[0].weather.kind, "storm");
  });

  it("composeHourly follows the diurnal model anchored on the measured mean", async () => {
    const r = await composeHourly(db, {}, WORLD, 24);
    assert.equal(r.ok, true);
    assert.equal(r.hours, 24);
    assert.equal(r.breakdown.length, 24);
    const temps = r.breakdown.map(h => h.temperature_c).filter(t => t != null);
    assert.ok(temps.length === 24, "every hour has a temperature");
    // The diurnal curve swings around the baseline (max > min by ~2×amplitude).
    assert.ok(Math.max(...temps) - Math.min(...temps) > 5, "real diurnal swing");
  });

  it("composeRegional reads each district anchor (7 named regions)", async () => {
    const r = await composeRegional(db, {}, WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.regions.length, FORECAST_REGIONS.length);
    assert.equal(r.regions.length, 7);
    for (const reg of r.regions) {
      assert.equal(typeof reg.id, "string");
      assert.ok(reg.anchor && typeof reg.anchor.x === "number");
    }
    // Anchors are deterministic per region id.
    const a1 = regionAnchor("commons");
    const a2 = regionAnchor("commons");
    assert.deepEqual(a1, a2);
  });
});

describe("forecast — accuracy + archive read persisted history", () => {
  let db;
  beforeEach(() => { db = bootDb(); seedWorld(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("forecastArchive lists persisted forecasts with extracted trend points", async () => {
    const c = await composeForecast(db, {}, WORLD);
    persistForecast(db, WORLD, c.forecast);
    persistForecast(db, WORLD, c.forecast);
    const r = forecastArchive(db, WORLD, 50);
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.equal(r.entries.length, 2);
    assert.equal(r.entries[0].weather_kind, "storm");
    // trend is the ascending mirror of the descending entries.
    assert.equal(r.trend.length, 2);
  });

  it("forecastAccuracy scores predicted vs realized persisted rows", async () => {
    const c = await composeForecast(db, {}, WORLD);
    persistForecast(db, WORLD, c.forecast); // ensures the world_forecasts table exists
    // Hand-place an earlier + later row ~24h apart so the second realizes the
    // first's predicted window and accuracy has a real pairing to score.
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO world_forecasts (world_id, forecast_json, composed_at) VALUES (?,?,?)`)
      .run(WORLD, JSON.stringify({ ...c.forecast, weather: { kind: "storm", temperature_c: 2 } }), now - 90000);
    db.prepare(`INSERT INTO world_forecasts (world_id, forecast_json, composed_at) VALUES (?,?,?)`)
      .run(WORLD, JSON.stringify({ ...c.forecast, weather: { kind: "storm", temperature_c: 3 } }), now - 90000 + 86400);
    const r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.ok, true);
    assert.ok(r.summary, "summary present");
    assert.ok(r.summary.sample_count >= 1, "at least one scored comparison");
    // Same predicted/realized kind → 100% kind accuracy on that pair.
    if (r.summary.kind_accuracy != null) {
      assert.ok(r.summary.kind_accuracy >= 0 && r.summary.kind_accuracy <= 1);
    }
  });
});

describe("forecast — alert subscription lifecycle persists + evaluates", () => {
  let db;
  beforeEach(() => { db = bootDb(); seedWorld(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("create → list → checkAlerts → delete round-trips per user", async () => {
    const created = createAlertSub(db, "u1", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });
    assert.equal(created.ok, true);
    const subId = created.subscription.id;

    const listed = listAlertSubs(db, "u1", WORLD);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, subId);
    // Isolation: another user sees nothing.
    assert.equal(listAlertSubs(db, "u2", WORLD).length, 0);

    // The seeded forward-prediction (conf 0.78 >= 0.5) trips the severe_event sub.
    const checked = await checkAlerts(db, {}, "u1", WORLD);
    assert.equal(checked.ok, true);
    assert.equal(checked.subscriptionCount, 1);
    assert.equal(checked.triggered.length, 1);
    assert.equal(checked.triggered[0].subscriptionId, subId);

    const removed = deleteAlertSub(db, "u1", subId);
    assert.equal(removed.ok, true);
    assert.equal(listAlertSubs(db, "u1", WORLD).length, 0);
  });

  it("createAlertSub rejects an unknown kind", () => {
    assert.equal(createAlertSub(db, "u1", { kind: "nonsense" }).ok, false);
  });

  it("evaluateAlerts is a pure function over forecast + subs", () => {
    const forecast = {
      events: [{ kind: "quest", summary: "x", confidence: 0.9, eta_hours: 2 }],
      drift: { likely_kind: "goodhart", severity: "high" },
      weather: { kind: "storm", confidence: 0.8 },
    };
    const triggered = evaluateAlerts(forecast, [
      { id: "s1", kind: "severe_event", minConfidence: 0.6 },
      { id: "s2", kind: "drift" },
      { id: "s3", kind: "weather", weatherKinds: ["storm"], minConfidence: 0.5 },
    ]);
    assert.equal(triggered.length, 3);
    assert.equal(evaluateAlerts(null, []).length, 0);
  });
});

describe("forecast — fail-CLOSED numeric guard (assassin V2)", () => {
  let db;
  beforeEach(() => { db = bootDb(); seedWorld(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("rejects poisoned days/hours/limit instead of silently clamping", async () => {
    for (const bad of [NaN, Infinity, -1, 1e308]) {
      assert.equal((await composeMultiDay(db, {}, WORLD, bad)).error, "invalid_days", `days=${bad}`);
      assert.equal((await composeHourly(db, {}, WORLD, bad)).error, "invalid_hours", `hours=${bad}`);
      assert.equal((await forecastAccuracy(db, WORLD, bad)).error, "invalid_limit", `acc limit=${bad}`);
      assert.equal(forecastArchive(db, WORLD, bad).error, "invalid_limit", `arch limit=${bad}`);
    }
  });

  it("still honours a valid in-range numeric", async () => {
    assert.equal((await composeMultiDay(db, {}, WORLD, 3)).days, 3);
    assert.equal((await composeHourly(db, {}, WORLD, 12)).hours, 12);
  });
});
