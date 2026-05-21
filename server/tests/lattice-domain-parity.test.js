// Contract tests for the Lattice lens MLOps fine-tuning console.
//
// The Lattice lens is REST-backed (routes/lattice.js + routes/brains.js)
// rather than macro-backed, so this parity suite exercises the route
// handlers directly against an in-memory better-sqlite3 DB seeded with
// the migration-109 + migration-201 schema.
//
// Run: node --test tests/lattice-domain-parity.test.js

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import createLatticeRouter from "../routes/lattice.js";
import createBrainsRouter from "../routes/brains.js";
import { up as migrate201 } from "../migrations/201_lattice_training_ops.js";

// ── Express-router stack walker ───────────────────────────────────────
function extractHandlers(router) {
  const handlers = {};
  for (const layer of router.stack) {
    if (!layer.route) continue;
    const path = layer.route.path;
    for (const method of Object.keys(layer.route.methods)) {
      handlers[method] ??= {};
      handlers[method][path] = layer.route.stack.map((s) => s.handle);
    }
  }
  return handlers;
}

async function callRoute(handlers, method, path, { params = {}, query = {}, body = {}, user } = {}) {
  const chain = handlers[method]?.[path];
  if (!chain) throw new Error(`No route: ${method.toUpperCase()} ${path}`);
  const req = { params, query, body, user, app: { locals: {} } };
  let statusCode = 200;
  let payload;
  const res = {
    status(s) { statusCode = s; return res; },
    json(b) { payload = b; return res; },
  };
  for (const handler of chain) {
    let stop = false;
    await handler(req, res, () => { stop = true; });
    if (!stop) break; // a non-next() handler terminated the chain
  }
  return { statusCode, body: payload };
}

// ── Test DB seeding ───────────────────────────────────────────────────
function seedDb() {
  const db = new Database(":memory:");
  // minimal dtus table (migration 108 adds train_consented)
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      creator_id TEXT,
      title TEXT,
      train_consented INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE brain_active_models (
      id TEXT PRIMARY KEY, brain_id TEXT NOT NULL, model_name TEXT NOT NULL,
      base_model TEXT, corpus_size INTEGER NOT NULL DEFAULT 0, eval_score REAL,
      active INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()), retired_at INTEGER
    );
    CREATE TABLE brain_interactions (
      id TEXT PRIMARY KEY, brain_id TEXT NOT NULL, user_id TEXT,
      prompt_hash TEXT NOT NULL, prompt_json TEXT NOT NULL, response_json TEXT,
      domain TEXT, latency_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER,
      outcome TEXT NOT NULL DEFAULT 'pending', outcome_signal TEXT, outcome_at INTEGER,
      train_consented INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  migrate201(db);
  return db;
}

// auth stub: middleware that just attaches a user and calls next()
function authStub(req, _res, next) { req.user = req.user || { id: "user_a" }; next(); }
const requireAuth = () => authStub;
const requireRole = () => authStub;

let latticeH;
let brainsH;
let db;

before(() => {
  // routers are built per-test in beforeEach since they close over db
});

beforeEach(() => {
  db = seedDb();
  latticeH = extractHandlers(createLatticeRouter({ db, requireAuth }));
  brainsH = extractHandlers(createBrainsRouter({ db, requireAuth, requireRole }));
  // seed a DTU owned by user_a
  db.prepare(`INSERT INTO dtus (id, creator_id, title, train_consented) VALUES (?,?,?,0)`)
    .run("dtu_1", "user_a", "First thought");
});

const USER = { id: "user_a" };

// ── Consent + audit log ───────────────────────────────────────────────
describe("lattice consent + audit log", () => {
  it("toggles a DTU consent on and writes an audit row", async () => {
    const r = await callRoute(latticeH, "post", "/dtus/:id/consent", {
      params: { id: "dtu_1" }, body: { consented: true }, user: USER,
    });
    assert.equal(r.body.ok, true);
    const log = await callRoute(latticeH, "get", "/consent-log", { user: USER });
    assert.equal(log.body.ok, true);
    assert.equal(log.body.log.length, 1);
    assert.equal(log.body.log[0].action, "toggle");
    assert.equal(log.body.log[0].new_value, 1);
  });

  it("bulk consent-all logs a 'bulk' audit row with affected count", async () => {
    const r = await callRoute(latticeH, "post", "/dtus/consent-all", {
      body: { consented: true }, user: USER,
    });
    assert.equal(r.body.ok, true);
    const log = await callRoute(latticeH, "get", "/consent-log", { user: USER });
    assert.equal(log.body.log[0].action, "bulk");
    assert.ok(log.body.log[0].affected >= 1);
  });

  it("DELETE consent logs a revoke", async () => {
    await callRoute(latticeH, "post", "/dtus/:id/consent", {
      params: { id: "dtu_1" }, body: {}, user: USER,
    });
    const r = await callRoute(latticeH, "delete", "/dtus/:id/consent", {
      params: { id: "dtu_1" }, user: USER,
    });
    assert.equal(r.body.ok, true);
    // the DTU itself is now revoked, and the audit trail recorded both ops
    const dtu = db.prepare(`SELECT train_consented FROM dtus WHERE id='dtu_1'`).get();
    assert.equal(dtu.train_consented, 0);
    const log = await callRoute(latticeH, "get", "/consent-log", { user: USER });
    assert.equal(log.body.log.length, 2);
    assert.ok(log.body.log.some((row) => row.new_value === 0));
  });

  it("consent-log is scoped to the caller", async () => {
    await callRoute(latticeH, "post", "/dtus/consent-all", { body: { consented: true }, user: USER });
    const other = await callRoute(latticeH, "get", "/consent-log", { user: { id: "user_b" } });
    assert.equal(other.body.ok, true);
    assert.equal(other.body.log.length, 0);
  });
});

// ── Drift alerts ──────────────────────────────────────────────────────
describe("lattice drift alerts", () => {
  it("returns ok with empty alerts when no STATE present", async () => {
    const prior = globalThis._concordSTATE;
    globalThis._concordSTATE = undefined;
    const r = await callRoute(latticeH, "get", "/drift-alerts", { query: {} });
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.alerts, []);
    assert.equal(r.body.available, false);
    globalThis._concordSTATE = prior;
  });
});

// ── Training run history + eval curve ─────────────────────────────────
describe("brains run history + eval curve", () => {
  function seedRuns() {
    const ins = db.prepare(
      `INSERT INTO brain_refresh_runs
        (id, brain_id, trigger, status, corpus_size, eval_score, prev_score,
         swapped, model_name, base_model, detail_json, triggered_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    // explicit created_at so ASC/DESC ordering is deterministic
    ins.run("brr_1", "utility", "manual", "completed", 100, 0.70, null, 1, "u:v1", "qwen2.5:3b", "{}", "user_a", 1000);
    ins.run("brr_2", "utility", "scheduled", "completed", 140, 0.78, 0.70, 1, "u:v2", "qwen2.5:3b", "{}", null, 2000);
  }

  it("GET /runs returns runs with eval deltas", async () => {
    seedRuns();
    const r = await callRoute(brainsH, "get", "/runs", { query: { brain: "utility", limit: "10" } });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.runs.length, 2);
    const v2 = r.body.runs.find((x) => x.id === "brr_2");
    assert.equal(v2.delta, 0.08);
  });

  it("GET /:brainId/eval-curve shapes a loss/eval curve", async () => {
    seedRuns();
    const r = await callRoute(brainsH, "get", "/:brainId/eval-curve", {
      params: { brainId: "utility" }, query: {},
    });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.curve.length, 2);
    assert.equal(r.body.curve[0].loss, Number((1 - 0.70).toFixed(4)));
    assert.equal(r.body.bestEval, 0.78);
  });
});

// ── Model rollback ────────────────────────────────────────────────────
describe("brains model rollback", () => {
  it("rolls active flag back to a prior model version", async () => {
    const ins = db.prepare(
      `INSERT INTO brain_active_models (id, brain_id, model_name, base_model, corpus_size, eval_score, active)
       VALUES (?,?,?,?,?,?,?)`,
    );
    ins.run("m_old", "repair", "r:v1", "qwen2.5:1.5b", 50, 0.6, 0);
    ins.run("m_new", "repair", "r:v2", "qwen2.5:1.5b", 90, 0.7, 1);
    const r = await callRoute(brainsH, "post", "/:brainId/rollback", {
      params: { brainId: "repair" }, body: { modelId: "m_old" }, user: USER,
    });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.activeModel, "r:v1");
    const active = db.prepare(`SELECT id FROM brain_active_models WHERE brain_id='repair' AND active=1`).get();
    assert.equal(active.id, "m_old");
  });

  it("404s for an unknown model", async () => {
    const r = await callRoute(brainsH, "post", "/:brainId/rollback", {
      params: { brainId: "repair" }, body: { modelId: "nope" }, user: USER,
    });
    assert.equal(r.body.ok, false);
    assert.equal(r.statusCode, 404);
  });
});

// ── Refresh scheduling ────────────────────────────────────────────────
describe("brains refresh schedule", () => {
  it("GET /schedule surfaces a row for every brain", async () => {
    const r = await callRoute(brainsH, "get", "/schedule", { query: {} });
    assert.equal(r.body.ok, true);
    assert.ok(r.body.schedule.some((s) => s.brain_id === "conscious"));
  });

  it("POST /schedule sets a cadence and computes next_run_at", async () => {
    const r = await callRoute(brainsH, "post", "/schedule", {
      body: { brain: "utility", enabled: true, cadence: "daily" }, user: USER,
    });
    assert.equal(r.body.ok, true);
    assert.equal(r.body.cadence, "daily");
    assert.equal(r.body.intervalHours, 24);
    assert.ok(r.body.nextRunAt > 0);
  });

  it("POST /schedule rejects an invalid brain", async () => {
    const r = await callRoute(brainsH, "post", "/schedule", {
      body: { brain: "nonsense", enabled: true, cadence: "daily" }, user: USER,
    });
    assert.equal(r.body.ok, false);
    assert.equal(r.statusCode, 400);
  });
});

// ── Corpus sample inspector ───────────────────────────────────────────
describe("brains corpus-sample inspector", () => {
  it("returns ok with an empty sample for an empty corpus", async () => {
    const r = await callRoute(brainsH, "get", "/:brainId/corpus-sample", {
      params: { brainId: "utility" }, query: {},
    });
    assert.equal(r.body.ok, true);
    assert.equal(Array.isArray(r.body.sample), true);
  });

  it("rejects an invalid brain", async () => {
    const r = await callRoute(brainsH, "get", "/:brainId/corpus-sample", {
      params: { brainId: "bogus" }, query: {},
    });
    assert.equal(r.body.ok, false);
  });
});

// ── A/B model comparison ──────────────────────────────────────────────
describe("brains A/B model comparison", () => {
  it("starts an A/B test, lists it, and concludes a winner", async () => {
    const start = await callRoute(brainsH, "post", "/ab-tests", {
      body: { brain: "conscious", candidateModel: "c:v9", trafficPct: 15 }, user: USER,
    });
    assert.equal(start.body.ok, true);
    assert.equal(start.body.trafficPct, 15);

    const list = await callRoute(brainsH, "get", "/ab-tests", { query: {} });
    assert.equal(list.body.ok, true);
    assert.equal(list.body.tests.length, 1);

    const concl = await callRoute(brainsH, "post", "/ab-tests/:id/conclude", {
      params: { id: start.body.id }, body: { winner: "candidate" }, user: USER,
    });
    assert.equal(concl.body.ok, true);
    assert.equal(concl.body.winner, "candidate");
  });

  it("rejects a bad winner value", async () => {
    const start = await callRoute(brainsH, "post", "/ab-tests", {
      body: { brain: "conscious", candidateModel: "c:v9" }, user: USER,
    });
    const r = await callRoute(brainsH, "post", "/ab-tests/:id/conclude", {
      params: { id: start.body.id }, body: { winner: "neither" }, user: USER,
    });
    assert.equal(r.body.ok, false);
    assert.equal(r.statusCode, 400);
  });

  it("rejects a missing candidateModel", async () => {
    const r = await callRoute(brainsH, "post", "/ab-tests", {
      body: { brain: "conscious" }, user: USER,
    });
    assert.equal(r.body.ok, false);
  });
});
