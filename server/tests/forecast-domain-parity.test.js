// server/tests/forecast-domain-parity.test.js
//
// Contract tests for the forecast lens feature-parity backlog. The forecast.*
// macros are registered inline in server.js and delegate to
// server/lib/world-forecast.js. These tests exercise the library functions
// each macro wraps, against a real in-memory schema, asserting the { ok }
// envelope and the no-fake-data invariant.
//
// Backlog coverage:
//   forecast.multiDay        -> composeMultiDay
//   forecast.hourly          -> composeHourly
//   forecast.regional        -> composeRegional
//   forecast.accuracy        -> forecastAccuracy
//   forecast.archive         -> forecastArchive
//   forecast.subscribeAlert  -> createAlertSub
//   forecast.listAlerts      -> listAlertSubs
//   forecast.unsubscribeAlert-> deleteAlertSub
//   forecast.checkAlerts     -> checkAlerts (+ evaluateAlerts)

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  composeMultiDay,
  composeHourly,
  composeRegional,
  forecastAccuracy,
  forecastArchive,
  persistForecast,
  evaluateAlerts,
  createAlertSub,
  listAlertSubs,
  deleteAlertSub,
  checkAlerts,
  FORECAST_REGIONS,
} from "../lib/world-forecast.js";

let db;
const WORLD = "concordia-hub";
// A minimal STATE — composeForecast reads STATE.worlds.get(worldId).
const STATE = { worlds: new Map([[WORLD, { ecosystem_score: 0.6, ecosystem_trend: "rising" }]]) };

function seed() {
  db = new Database(":memory:");
  // embodied_signal_log — what signalsForWorld reads. Mirrors migration 112/113.
  db.exec(`
    CREATE TABLE embodied_signal_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      cell_x INTEGER NOT NULL,
      cell_z INTEGER NOT NULL,
      channel TEXT NOT NULL,
      value REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'sensor',
      recorded_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER
    )
  `);
  // faction_strategy_state — mirrors migration 117.
  db.exec(`
    CREATE TABLE faction_strategy_state (
      faction_id TEXT PRIMARY KEY,
      stance TEXT NOT NULL,
      target_id TEXT,
      phase TEXT,
      next_move_at INTEGER,
      momentum REAL NOT NULL DEFAULT 0,
      last_move_id TEXT
    )
  `);
  // forward_predictions — mirrors migration 116.
  db.exec(`
    CREATE TABLE forward_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject_kind TEXT NOT NULL,
      subject_id TEXT,
      anticipated TEXT,
      confidence REAL,
      composer TEXT,
      composed_at INTEGER DEFAULT (unixepoch()),
      expires_at INTEGER,
      realised_at INTEGER,
      reality_outcome TEXT
    )
  `);
}

before(() => { seed(); });
beforeEach(() => { seed(); });

const ctxA = { userId: "user_a", actor: { userId: "user_a" } };
const ctxB = { userId: "user_b", actor: { userId: "user_b" } };

// ── multiDay ────────────────────────────────────────────────────────────────
describe("forecast.multiDay", () => {
  it("returns N daily windows with range-decaying confidence", async () => {
    const r = await composeMultiDay(db, STATE, WORLD, 7);
    assert.equal(r.ok, true);
    assert.equal(r.days, 7);
    assert.equal(r.outlook.length, 7);
    // Confidence must be monotonically non-increasing with range.
    for (let i = 1; i < r.outlook.length; i++) {
      assert.ok(
        r.outlook[i].weather.confidence <= r.outlook[i - 1].weather.confidence,
        "confidence must not increase with range",
      );
    }
    // Each day carries a real day index + future date.
    assert.equal(r.outlook[0].day_index, 0);
    assert.ok(r.outlook[6].date_ts > r.outlook[0].date_ts);
  });

  it("clamps the day count into [2,14]", async () => {
    assert.equal((await composeMultiDay(db, STATE, WORLD, 1)).days, 2);
    assert.equal((await composeMultiDay(db, STATE, WORLD, 99)).days, 14);
  });
});

// ── hourly ──────────────────────────────────────────────────────────────────
describe("forecast.hourly", () => {
  it("returns an hour-by-hour breakdown with clock hours", async () => {
    const r = await composeHourly(db, STATE, WORLD, 24);
    assert.equal(r.ok, true);
    assert.equal(r.hours, 24);
    assert.equal(r.breakdown.length, 24);
    for (const h of r.breakdown) {
      assert.ok(h.clock_hour >= 0 && h.clock_hour <= 23);
      assert.ok(h.confidence > 0 && h.confidence <= 1);
    }
  });

  it("clamps the hour count into [6,48]", async () => {
    assert.equal((await composeHourly(db, STATE, WORLD, 2)).hours, 6);
    assert.equal((await composeHourly(db, STATE, WORLD, 200)).hours, 48);
  });
});

// ── regional ────────────────────────────────────────────────────────────────
describe("forecast.regional", () => {
  it("returns one entry per cognitive-geography district", async () => {
    const r = await composeRegional(db, STATE, WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.regions.length, FORECAST_REGIONS.length);
    for (const reg of r.regions) {
      assert.ok(reg.id && reg.name);
      assert.ok(typeof reg.anchor.x === "number" && typeof reg.anchor.z === "number");
    }
  });

  it("reports no data honestly when a district has no signals", async () => {
    const r = await composeRegional(db, STATE, WORLD);
    // With an empty embodied_signal_log no district has measured data.
    assert.ok(r.regions.every((reg) => reg.hasData === false && reg.weather === null));
  });
});

// ── accuracy ────────────────────────────────────────────────────────────────
describe("forecast.accuracy", () => {
  it("returns an empty sample set when there is no history", async () => {
    const r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.ok, true);
    assert.equal(r.summary.sample_count, 0);
    assert.equal(r.summary.kind_accuracy, null);
  });

  it("scores a past forecast against a realized persisted forecast", async () => {
    const now = Math.floor(Date.now() / 1000);
    const predicted = { window_hours: 24, weather: { kind: "storm", temperature_c: 10 } };
    const realized = { window_hours: 24, weather: { kind: "clear", temperature_c: 13 } };
    // Persist a predicted forecast 25h in the past and a realized one 1h in the past.
    persistForecast(db, WORLD, predicted);
    db.prepare(`UPDATE world_forecasts SET composed_at = ? WHERE id = (SELECT MAX(id) FROM world_forecasts)`).run(now - 25 * 3600);
    persistForecast(db, WORLD, realized);
    db.prepare(`UPDATE world_forecasts SET composed_at = ? WHERE id = (SELECT MAX(id) FROM world_forecasts)`).run(now - 3600);
    const r = await forecastAccuracy(db, WORLD, 20);
    assert.equal(r.ok, true);
    assert.equal(r.summary.sample_count, 1);
    assert.equal(r.comparisons[0].kind_hit, false);
    assert.equal(r.comparisons[0].temp_abs_error_c, 3);
  });
});

// ── archive ─────────────────────────────────────────────────────────────────
describe("forecast.archive", () => {
  it("returns an empty archive before any forecast is persisted", () => {
    const r = forecastArchive(db, WORLD, 50);
    assert.equal(r.ok, true);
    assert.equal(r.count, 0);
    assert.deepEqual(r.entries, []);
  });

  it("lists persisted forecasts with ascending trend points", () => {
    persistForecast(db, WORLD, { weather: { kind: "clear", temperature_c: 12 }, ecology: { ecosystem_score: 0.6 }, events: [] });
    persistForecast(db, WORLD, { weather: { kind: "rain", temperature_c: 9 }, ecology: { ecosystem_score: 0.55 }, events: [] });
    const r = forecastArchive(db, WORLD, 50);
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    // entries newest-first, trend oldest-first.
    assert.ok(r.trend[0].composed_at <= r.trend[1].composed_at);
  });
});

// ── alert subscriptions ─────────────────────────────────────────────────────
describe("forecast.subscribeAlert + listAlerts + unsubscribeAlert", () => {
  it("creates, lists, and removes a per-user subscription", () => {
    const created = createAlertSub(db, "user_a", { worldId: WORLD, kind: "severe_event", minConfidence: 0.8 });
    assert.equal(created.ok, true);
    assert.ok(created.subscription.id);
    const listed = listAlertSubs(db, "user_a", WORLD);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].kind, "severe_event");
    // Scoped per user — user_b sees nothing.
    assert.equal(listAlertSubs(db, "user_b", WORLD).length, 0);
    const removed = deleteAlertSub(db, "user_a", created.subscription.id);
    assert.equal(removed.ok, true);
    assert.equal(listAlertSubs(db, "user_a", WORLD).length, 0);
  });

  it("rejects an unknown alert kind", () => {
    assert.equal(createAlertSub(db, "user_a", { kind: "nonsense" }).ok, false);
  });

  it("a user cannot delete another user's subscription", () => {
    const c = createAlertSub(db, "user_a", { worldId: WORLD, kind: "drift" });
    const r = deleteAlertSub(db, "user_b", c.subscription.id);
    assert.equal(r.ok, false);
    assert.equal(listAlertSubs(db, "user_a", WORLD).length, 1);
  });
});

describe("forecast.checkAlerts", () => {
  it("returns no triggers for a user with no subscriptions", async () => {
    const r = await checkAlerts(db, STATE, "user_a", WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.subscriptionCount, 0);
    assert.deepEqual(r.triggered, []);
  });

  it("trips a severe-event subscription when a high-confidence prediction exists", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(`
      INSERT INTO forward_predictions (subject_kind, subject_id, anticipated, confidence, expires_at)
      VALUES ('quest', 'q1', 'A faction will march on the Commons.', 0.9, ?)
    `).run(future);
    createAlertSub(db, "user_a", { worldId: WORLD, kind: "severe_event", minConfidence: 0.7 });
    const r = await checkAlerts(db, STATE, "user_a", WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.subscriptionCount, 1);
    assert.equal(r.triggered.length, 1);
    assert.ok(r.triggered[0].hits.length >= 1);
    // The subscription is stamped as fired.
    assert.ok(listAlertSubs(db, "user_a", WORLD)[0].lastFiredAt);
  });

  it("does not trip a subscription whose confidence floor is above the prediction", async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(`
      INSERT INTO forward_predictions (subject_kind, anticipated, confidence, expires_at)
      VALUES ('npc', 'Low-confidence rumor.', 0.4, ?)
    `).run(future);
    createAlertSub(db, ctxB.userId, { worldId: WORLD, kind: "severe_event", minConfidence: 0.85 });
    const r = await checkAlerts(db, STATE, ctxB.userId, WORLD);
    assert.equal(r.ok, true);
    assert.equal(r.triggered.length, 0);
  });
});

describe("forecast evaluateAlerts (pure)", () => {
  it("matches a weather subscription only when the kind is in the watch list", () => {
    const fc = { weather: { kind: "storm", confidence: 0.8 }, events: [], drift: null };
    const hitting = evaluateAlerts(fc, [{ id: "s1", kind: "weather", minConfidence: 0.6, weatherKinds: ["storm"] }]);
    assert.equal(hitting.length, 1);
    const missing = evaluateAlerts(fc, [{ id: "s2", kind: "weather", minConfidence: 0.6, weatherKinds: ["snow"] }]);
    assert.equal(missing.length, 0);
  });
});
