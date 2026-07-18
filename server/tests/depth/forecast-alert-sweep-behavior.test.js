// server/tests/depth/forecast-alert-sweep-behavior.test.js
//
// Behavioral coverage for the forecast-alert-sweep heartbeat — the real-time
// (socket-connected-tab) delivery channel that closes docs/WAVE4_INVENTORY.md
// row 181 ("No automatic/pushed severe-event alert delivery (pull-only)").
// Honest scope, identical to the productivity-reminder-sweep precedent this
// was cloned from: this is NOT an OS-level push notification — this
// codebase has no service-worker Web Push pipeline. The sweep pushes a
// `forecast:alert-triggered` event to a user's `user:${userId}` socket room
// (the room every authenticated socket auto-joins — server.js:8535) the
// moment a fresh forecast trips one or more of their subscriptions, and
// `checkAlerts`/`markSubsFired` (unchanged, pre-existing) still stamps
// `last_fired_at` server-side even when nobody is listening live.
//
// Drives server/lib/world-forecast.js DIRECTLY against a real (:memory:)
// better-sqlite3 DB seeded with real embodied-signal / faction-strategy /
// forward-prediction rows — the same fixture shape as
// tests/forecast-domain-macros.test.js — so `checkAlerts` composes a real
// forecast, not a mocked one. NO server.js boot, NO network, NO LLM.
//
// Run: DB_PATH=/tmp/forecast-alert-sweep-<unique>.db node --test tests/depth/forecast-alert-sweep-behavior.test.js

// Isolated DB path so this file never collides with a parallel test run —
// unused directly (the fixtures below build their own :memory: DB), but set
// defensively per this repo's test-isolation convention for any code this
// module transitively touches that reads DB_PATH from the environment.
process.env.DB_PATH = process.env.DB_PATH || `/tmp/forecast-alert-sweep-${process.pid}-${Date.now()}.db`;

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { createAlertSub, listAlertSubs } from "../../lib/world-forecast.js";
import { runHeartbeatModuleNow } from "../../emergent/heartbeat-registry.js";
import { validateEvent } from "../../lib/event-shapes.js";
import { seedWorldClimate } from "../../lib/embodied/signals.js";

const WORLD = "concordia-hub";
const WORLD_2 = "tunya";

// Same merged (mig 112 + 113) embodied_signal_log schema as
// tests/forecast-domain-macros.test.js, plus the faction-strategy and
// forward-prediction tables composeForecast reads.
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

// Seed a real, severe-reading forward-prediction for `world` — this is what
// trips a `severe_event` subscription (confidence 0.9 clears any reasonable
// minConfidence floor).
function seedSevereEvent(db, world, id = "fp_severe") {
  db.prepare(`
    INSERT INTO forward_predictions
      (id, user_id, world_id, subject_kind, subject_id, anticipated, confidence, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, "seeder", world, "quest", "q1", "A storm front gates the harvest.", 0.9,
    Math.floor(Date.now() / 1000) + 7200);
}

let emitted;
function installRealtimeMock() {
  emitted = [];
  globalThis._concordREALTIME = {
    io: {
      to: (room) => ({
        emit: (name, payload) => { emitted.push({ room, name, payload }); },
      }),
    },
  };
}

async function runSweep(db, state = {}) {
  return runHeartbeatModuleNow("forecast-alert-sweep", { state, db, reason: "test" });
}

describe("forecast-alert-sweep — identifies + delivers real triggered alerts", () => {
  let db;
  beforeEach(() => {
    db = bootDb();
    seedWorldClimate(db, WORLD, { temperature: 1.5, humidity: 82, pressure: 100.2 });
    seedSevereEvent(db, WORLD);
    installRealtimeMock();
    delete process.env.CONCORD_FORECAST_ALERT_SWEEP;
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("fires and delivers to the exact user:<id> room when a subscription genuinely trips", async () => {
    const created = createAlertSub(db, "user_a", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });
    assert.equal(created.ok, true);

    const res = await runSweep(db);
    assert.equal(res.ok, true);

    assert.equal(emitted.length, 1);
    const evt = emitted[0];
    assert.equal(evt.room, "user:user_a");
    assert.equal(evt.name, "forecast:alert-triggered");
    assert.equal(evt.payload.userId, "user_a");
    assert.equal(evt.payload.worldId, WORLD);
    assert.equal(evt.payload.triggered.length, 1);
    assert.equal(evt.payload.triggered[0].subscriptionId, created.subscription.id);
    assert.equal(evt.payload.triggered[0].hits[0].type, "event");
    assert.match(evt.payload.triggered[0].hits[0].summary, /storm front/);
    assert.ok(typeof evt.payload.forecastComposedAt === "number");
    assert.ok(typeof evt.payload.ts === "number");
  });

  it("stamps last_fired_at server-side on the real subscription row", async () => {
    const created = createAlertSub(db, "user_a", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });
    await runSweep(db);
    const listed = listAlertSubs(db, "user_a", WORLD).find((s) => s.id === created.subscription.id);
    assert.ok(listed.lastFiredAt, "last_fired_at is stamped after a real trigger");
  });

  it("does not emit for a subscription whose condition never trips (confidence floor not cleared)", async () => {
    createAlertSub(db, "user_b", { kind: "severe_event", worldId: WORLD, minConfidence: 0.99 });
    const res = await runSweep(db);
    assert.equal(res.ok, true);
    assert.equal(emitted.length, 0, "0.9 confidence event never clears a 0.99 floor");
  });

  it("no longer fires once the underlying condition genuinely clears", async () => {
    const created = createAlertSub(db, "user_a", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });
    await runSweep(db);
    assert.equal(emitted.length, 1, "first sweep: condition holds, fires once");

    // The condition clears for real — the severe forward-prediction expires/
    // is removed from the DB, not merely "already seen" bookkeeping.
    db.prepare(`DELETE FROM forward_predictions WHERE id = 'fp_severe'`).run();
    emitted = [];
    await runSweep(db);
    assert.equal(emitted.length, 0, "second sweep: no live event once the trigger condition is gone");

    // The subscription itself is untouched — still there, not "used up".
    const listed = listAlertSubs(db, "user_a", WORLD).find((s) => s.id === created.subscription.id);
    assert.ok(listed, "subscription still exists after a no-trigger sweep");
  });

  it("delivers exactly ONE event per (user, world) pair even with multiple subscriptions for that pair", async () => {
    createAlertSub(db, "user_a", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });
    createAlertSub(db, "user_a", { kind: "any", worldId: WORLD, minConfidence: 0.5 });

    await runSweep(db);

    assert.equal(emitted.length, 1, "one batched emit per (user, world), not one per subscription");
    assert.equal(emitted[0].payload.triggered.length, 2, "both subscriptions' hits are carried in the one event");
  });

  it("delivers independently per user across different worlds — no cross-talk", async () => {
    seedWorldClimate(db, WORLD_2, { temperature: -3, humidity: 91, pressure: 99.8 });
    seedSevereEvent(db, WORLD_2, "fp_severe_2");
    createAlertSub(db, "user_a", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });
    createAlertSub(db, "user_c", { kind: "severe_event", worldId: WORLD_2, minConfidence: 0.5 });

    await runSweep(db);

    assert.equal(emitted.length, 2);
    const rooms = emitted.map((e) => e.room).sort();
    assert.deepEqual(rooms, ["user:user_a", "user:user_c"]);
    const forA = emitted.find((e) => e.room === "user:user_a");
    const forC = emitted.find((e) => e.room === "user:user_c");
    assert.equal(forA.payload.worldId, WORLD);
    assert.equal(forC.payload.worldId, WORLD_2);
  });
});

describe("forecast-alert-sweep — offline user (no connected socket)", () => {
  let db;
  beforeEach(() => {
    db = bootDb();
    seedWorldClimate(db, WORLD, { temperature: 1.5, humidity: 82, pressure: 100.2 });
    seedSevereEvent(db, WORLD);
    delete process.env.CONCORD_FORECAST_ALERT_SWEEP;
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("still correctly marks the subscription fired with no crash when REALTIME is unavailable", async () => {
    globalThis._concordREALTIME = null; // no socket transport wired up at all
    const created = createAlertSub(db, "user_a", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });

    await assert.doesNotReject(() => runSweep(db));

    const listed = listAlertSubs(db, "user_a", WORLD).find((s) => s.id === created.subscription.id);
    assert.ok(listed.lastFiredAt, "server-side evaluation still happens with no live delivery");
  });

  it("still correctly marks fired when REALTIME.io has no matching room/emit surface", async () => {
    globalThis._concordREALTIME = { io: null };
    const created = createAlertSub(db, "user_a", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });

    await assert.doesNotReject(() => runSweep(db));

    const listed = listAlertSubs(db, "user_a", WORLD).find((s) => s.id === created.subscription.id);
    assert.ok(listed.lastFiredAt);
  });
});

// NOTE on assertions below: `runHeartbeatModuleNow` (heartbeat-registry.js)
// deliberately does NOT forward a handler's own return value — it exists to
// prove a manual trigger ran without throwing/hanging (see its doc comment
// + the productivity-reminder-sweep precedent test, which likewise only
// ever asserts `res.ok === true`). So "never throws" here is asserted by
// the call succeeding at all (an uncaught throw fails the surrounding test
// automatically); side effects are asserted against real state (the
// `emitted` mock array / `forecast_alert_subs` rows), not the heartbeat
// runner's return value.
describe("forecast-alert-sweep — defensive against malformed / missing data", () => {
  beforeEach(() => { delete process.env.CONCORD_FORECAST_ALERT_SWEEP; installRealtimeMock(); });

  it("never throws when db is null (e.g. no_db boot state)", async () => {
    const res = await runSweep(null);
    assert.equal(res.ok, true);
  });

  it("never throws with zero subscribers at all (fresh install, no forecast_alert_subs rows)", async () => {
    const db = bootDb();
    const res = await runSweep(db);
    assert.equal(res.ok, true);
    assert.equal(emitted.length, 0);
    db.close();
  });

  it("skips a subscriber row with an empty world_id instead of throwing, and still processes a legitimate neighbor", async () => {
    const db = bootDb();
    seedWorldClimate(db, WORLD, { temperature: 1.5, humidity: 82, pressure: 100.2 });
    seedSevereEvent(db, WORLD);
    createAlertSub(db, "user_good", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });
    // Simulate a corrupted row alongside the legitimate one — the schema
    // allows an empty string (NOT NULL, not non-empty), so this is a
    // realistic corrupt-but-not-throwing shape rather than a fabricated
    // impossible one.
    db.prepare(`
      INSERT INTO forecast_alert_subs (id, user_id, world_id, kind, min_confidence)
      VALUES ('fas_corrupt', 'user_corrupt', '', 'severe_event', 0.5)
    `).run();

    const res = await runSweep(db);
    assert.equal(res.ok, true);
    assert.equal(emitted.some((e) => e.room === "user:user_good"), true, "legitimate subscriber still processed");
    assert.equal(emitted.some((e) => e.room === "user:user_corrupt"), false, "corrupt row skipped, not delivered to");
    db.close();
  });

  it("never throws when the underlying signal/faction/prediction tables are entirely missing", async () => {
    // Only forecast_alert_subs exists (auto-created by createAlertSub); none
    // of composeForecast's source tables do. composeForecast's own per-source
    // try/catch already degrades gracefully — this pins that the sweep
    // survives that path end-to-end too.
    const db = new Database(":memory:");
    createAlertSub(db, "user_a", { kind: "any", worldId: WORLD, minConfidence: 0.1 });
    const res = await runSweep(db);
    assert.equal(res.ok, true);
    db.close();
  });
});

describe("forecast-alert-sweep — kill switch", () => {
  let db;
  beforeEach(() => {
    db = bootDb();
    seedWorldClimate(db, WORLD, { temperature: 1.5, humidity: 82, pressure: 100.2 });
    seedSevereEvent(db, WORLD);
    installRealtimeMock();
  });
  afterEach(() => {
    try { db.close(); } catch { /* noop */ }
    delete process.env.CONCORD_FORECAST_ALERT_SWEEP;
  });

  it("CONCORD_FORECAST_ALERT_SWEEP=0 disables the sweep entirely", async () => {
    createAlertSub(db, "user_a", { kind: "severe_event", worldId: WORLD, minConfidence: 0.5 });
    process.env.CONCORD_FORECAST_ALERT_SWEEP = "0";

    const res = await runSweep(db);
    assert.equal(res.ok, true);
    assert.equal(emitted.length, 0, "sweep disabled — no evaluation, no delivery");
  });
});

describe("event-shapes.js — forecast:alert-triggered", () => {
  it("validates the full payload the sweep actually emits", () => {
    const r = validateEvent("forecast:alert-triggered", {
      userId: "user_a",
      worldId: WORLD,
      triggered: [{ subscriptionId: "fas_1", kind: "severe_event", hits: [{ type: "event", summary: "x" }] }],
      forecastComposedAt: Date.now(),
      ts: Date.now(), // realtime-emit reserved field — must not count as "unknown"
    });
    assert.equal(r.ok, true);
  });

  it("rejects a payload missing a required field", () => {
    const r = validateEvent("forecast:alert-triggered", { userId: "user_a", worldId: WORLD });
    assert.equal(r.ok, false);
    assert.deepEqual(r.missing, ["triggered"]);
  });

  it("rejects an unknown top-level field (typo protection)", () => {
    const r = validateEvent("forecast:alert-triggered", {
      userId: "user_a", worldId: WORLD, triggered: [], wrldId: "typo",
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.unknown, ["wrldId"]);
  });
});
