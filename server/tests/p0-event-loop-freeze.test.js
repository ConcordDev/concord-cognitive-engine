// P0 event-loop freeze (2026-10-29): creature-flock-cycle's whole-world
// signal read and idle-behavior's substrate sample were synchronous
// multi-second stalls on the live box (lag profiler). These tests pin that
// the replacements return the same answer and give the event loop turns.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { monitorEventLoopDelay } from "node:perf_hooks";
import Database from "better-sqlite3";
import { up as up083 } from "../migrations/083_creature_crossbreeding.js";
import { signalsForWorld, signalsForWorldCooperative } from "../lib/embodied/signals.js";
import { runCreatureFlockCycle, _resetFlockCursorForTest } from "../emergent/creature-flock-cycle.js";
import { sampleSubstrate } from "../emergent/idle-behavior.js";

async function migrate(db, files) {
  for (const f of files) {
    const m = await import(`../migrations/${f}`);
    await (m.up || m.default?.up || m.default)(db);
  }
}

const CHANNELS = [
  "thermal_os.ambient_temp", "chemical_os.humidity", "chemical_os.air_quality",
  "sonic_os.ambient_db", "sight_os.illumination",
];

// Many rows share an observed_at second, so pages split ties often.
function seedSignals(db, worldId, n, now) {
  const ins = db.prepare(`INSERT INTO embodied_signal_log
    (id, world_id, channel, value, source, recorded_at, observed_at, decay_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const ts = now - (i % 900);
      const src = i % 4 === 0 ? "npc" : (i % 4 === 1 ? null : "sensor");
      const decay = i % 11 === 0 ? now - 5 : now + 3600; // some expired rows
      ins.run(`${worldId}_s${i}`, worldId, CHANNELS[i % CHANNELS.length], (i % 97) / 3, src, ts, ts, decay);
    }
  })();
}

function assertSameBundle(a, b) {
  assert.equal(a.hasData, b.hasData);
  assert.equal(a.weatherKind, b.weatherKind);
  assert.equal(a.biome, b.biome);
  for (const k of Object.keys(a)) {
    if (typeof a[k] !== "number") continue;
    const tol = 1e-9 * Math.max(1, Math.abs(a[k]));
    assert.ok(Math.abs(a[k] - b[k]) <= tol, `${k}: ${a[k]} vs ${b[k]}`);
  }
}

describe("signalsForWorldCooperative", () => {
  it("folds exactly the rows signalsForWorld folds, across split-tie pages", async () => {
    const db = new Database(":memory:");
    await migrate(db, ["112_embodied_signals.js", "113_embodied_signal_log_unification.js", "148_signal_propagation_indexes.js"]);
    const now = Math.floor(Date.now() / 1000);
    seedSignals(db, "w1", 20_000, now);
    seedSignals(db, "w2", 500, now); // other worlds never leak in
    // Both folds weight by age against "now"; pin the clock so they agree.
    const realNow = Date.now;
    Date.now = () => now * 1000;
    try {
    const sync = signalsForWorld(db, "w1");
    for (const pageSize of [1, 7, 64, 1000, 50_000]) {
      if (pageSize === 1) {
        // pageSize 1 on 20k rows is slow but still exact; check a small world.
        assertSameBundle(await signalsForWorldCooperative(db, "w2", { pageSize, now }), signalsForWorld(db, "w2"));
        continue;
      }
      assertSameBundle(await signalsForWorldCooperative(db, "w1", { pageSize, now }), sync);
    }
    const empty = await signalsForWorldCooperative(db, "nope", { now });
    assertSameBundle(empty, signalsForWorld(db, "nope"));
    assert.equal(empty.hasData, false);
    } finally { Date.now = realNow; }
  });

  it("yields between pages: the loop keeps running and no stretch is long", async () => {
    const db = new Database(":memory:");
    await migrate(db, ["112_embodied_signals.js", "113_embodied_signal_log_unification.js", "148_signal_propagation_indexes.js"]);
    const now = Math.floor(Date.now() / 1000);
    seedSignals(db, "big", 120_000, now);

    // Baseline: the old single read gives the loop no turns at all.
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 0);
    const t0 = performance.now();
    signalsForWorld(db, "big");
    const syncMs = performance.now() - t0;
    assert.equal(ticks, 0, "synchronous read lets no timer run");

    let yields = 0;
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    ticks = 0;
    await signalsForWorldCooperative(db, "big", {
      pageSize: 2000,
      yieldFn: () => new Promise((r) => { yields++; setTimeout(r, 0); }),
    });
    h.disable();
    clearInterval(timer);
    assert.ok(yields >= 120_000 / 2000, `yielded ${yields} times`);
    assert.ok(ticks >= yields / 2, `timers ran ${ticks} times during the read`);
    // Each stretch is one page: well under the whole read, and well under 1 s.
    const maxStretchMs = h.max / 1e6;
    assert.ok(maxStretchMs < 250, `longest stretch ${maxStretchMs.toFixed(1)} ms (whole sync read ${syncMs.toFixed(1)} ms)`);
  });
});

describe("creature-flock-cycle reads world signals cooperatively", () => {
  it("yields inside a single world's pass and still moves the flock", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE world_npcs (id TEXT PRIMARY KEY, world_id TEXT NOT NULL, archetype TEXT, species_id TEXT, x REAL, y REAL DEFAULT 0, z REAL, level INTEGER DEFAULT 1, is_dead INTEGER DEFAULT 0);
      CREATE TABLE world_visits (id TEXT PRIMARY KEY, user_id TEXT, world_id TEXT, arrived_at INTEGER, departed_at INTEGER);
      CREATE TABLE player_world_state (user_id TEXT, world_id TEXT, x REAL, z REAL);
    `);
    up083(db);
    await migrate(db, ["112_embodied_signals.js", "113_embodied_signal_log_unification.js", "148_signal_propagation_indexes.js"]);
    const ins = db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, z) VALUES (?, ?, ?, ?, ?, ?)`);
    for (let i = 0; i < 40; i++) ins.run(`c${i}`, "solo", "creature:dust_jackal", "dust_jackal", i, i % 5);
    seedSignals(db, "solo", 30_000, Math.floor(Date.now() / 1000));
    _resetFlockCursorForTest();

    let immediates = 0;
    let stop = false;
    const counter = () => { immediates++; if (!stop) setImmediate(counter); };
    setImmediate(counter);
    const r = await runCreatureFlockCycle({ db, state: {}, budgetMs: 60_000 });
    stop = true;
    assert.equal(r.ok, true);
    assert.equal(r.worldsProcessed, 1);
    assert.equal(r.worldsTouched, 1);
    assert.ok(r.totalMoved > 0, "flock still moves");
    // One world: the old code gave the loop zero turns before the pass ended.
    assert.ok(immediates >= 10, `loop ran ${immediates} immediates during a one-world pass`);
  });
});

describe("idle-behavior sampleSubstrate", () => {
  function mkDtus(n) {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT)`);
    const ins = db.prepare(`INSERT INTO dtus (id, title, content) VALUES (?, ?, ?)`);
    db.transaction(() => { for (let i = 0; i < n; i++) ins.run(`d${i}`, `t${i}`, "x".repeat(200)); })();
    return db;
  }

  it("returns distinct real rows without an ORDER BY RANDOM() full scan", () => {
    const db = mkDtus(5000);
    const sqls = [];
    const prep = db.prepare.bind(db);
    db.prepare = (sql) => { sqls.push(sql); return prep(sql); };
    const rows = sampleSubstrate(null, db, 5);
    assert.equal(rows.length, 5);
    assert.equal(new Set(rows.map((r) => r.id)).size, 5);
    for (const r of rows) {
      assert.match(r.id, /^d\d+$/);
      assert.equal(r.title, `t${r.id.slice(1)}`);
      assert.equal(r.content.length, 200);
    }
    assert.ok(sqls.every((s) => !/RANDOM\(\)/i.test(s)), "no ORDER BY RANDOM()");
  });

  it("handles empty, tiny and gappy tables", () => {
    assert.deepEqual(sampleSubstrate(null, mkDtus(0), 5), []);
    assert.equal(sampleSubstrate(null, mkDtus(2), 5).length, 2);
    const db = mkDtus(100);
    db.exec(`DELETE FROM dtus WHERE rowid % 10 != 0`);
    const rows = sampleSubstrate(null, db, 5);
    assert.ok(rows.length >= 1 && rows.length <= 5);
    assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
    assert.deepEqual(sampleSubstrate(null, null, 5), []);
  });
});
