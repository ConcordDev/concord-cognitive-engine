// Lattice full-build pins (S1 honest schedule gate · S3 audit priors).

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import createLatticeRouter from "../routes/lattice.js";
import createBrainsRouter from "../routes/brains.js";
import { up as migrate201 } from "../migrations/201_lattice_training_ops.js";

function extractHandlers(router) {
  const handlers = {};
  for (const layer of router.stack) {
    if (!layer.route) continue;
    for (const method of Object.keys(layer.route.methods)) {
      handlers[method] ??= {};
      handlers[method][layer.route.path] = layer.route.stack.map((s) => s.handle);
    }
  }
  return handlers;
}
async function callRoute(handlers, method, path, { params = {}, query = {}, body = {}, user } = {}) {
  const chain = handlers[method]?.[path];
  if (!chain) throw new Error(`No route: ${method.toUpperCase()} ${path}`);
  const req = { params, query, body, user, app: { locals: {} } };
  let statusCode = 200; let payload;
  const res = { status(s) { statusCode = s; return res; }, json(b) { payload = b; return res; } };
  for (const handler of chain) {
    let stop = false;
    await handler(req, res, () => { stop = true; });
    if (!stop) break;
  }
  return { statusCode, body: payload };
}
function seedDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, title TEXT, train_consented INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE brain_active_models (id TEXT PRIMARY KEY, brain_id TEXT NOT NULL, model_name TEXT NOT NULL, base_model TEXT, corpus_size INTEGER NOT NULL DEFAULT 0, eval_score REAL, active INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL DEFAULT (unixepoch()), retired_at INTEGER);
    CREATE TABLE brain_interactions (id TEXT PRIMARY KEY, brain_id TEXT NOT NULL, user_id TEXT, prompt_hash TEXT NOT NULL, prompt_json TEXT NOT NULL, response_json TEXT, domain TEXT, latency_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER, outcome TEXT NOT NULL DEFAULT 'pending', outcome_signal TEXT, outcome_at INTEGER, train_consented INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL DEFAULT (unixepoch()));
  `);
  migrate201(db);
  return db;
}
function authStub(req, _res, next) { next(); }
const requireAuth = () => authStub;
const requireRole = (...roles) => (req, res, next) => {
  if (req.user?.role === "sovereign" || roles.includes(req.user?.role)) return next();
  return res.status(403).json({ ok: false, error: "Insufficient permissions" });
};

let db, latticeH, brainsH;
const plain = { id: "user_a", role: "user" };
const admin = { id: "admin_a", role: "admin" };
beforeEach(() => {
  db = seedDb();
  latticeH = extractHandlers(createLatticeRouter({ db, requireAuth }));
  brainsH = extractHandlers(createBrainsRouter({ db, requireAuth, requireRole }));
});

describe("lattice S1 — the schedule gate speaks", () => {
  it("GET /schedule carries canEdit by role and rows for all six brains", async () => {
    const asUser = await callRoute(brainsH, "get", "/schedule", { user: plain });
    assert.equal(asUser.body.ok, true);
    assert.equal(asUser.body.canEdit, false);
    assert.equal(asUser.body.schedule.length, 6);
    const asAdmin = await callRoute(brainsH, "get", "/schedule", { user: admin });
    assert.equal(asAdmin.body.canEdit, true);
  });
  it("POST /schedule persists for an admin and refuses a plain user", async () => {
    const denied = await callRoute(brainsH, "post", "/schedule", { user: plain, body: { brain: "conscious", enabled: true, cadence: "daily" } });
    assert.equal(denied.statusCode, 403);
    const ok = await callRoute(brainsH, "post", "/schedule", { user: admin, body: { brain: "conscious", enabled: true, cadence: "daily" } });
    assert.equal(ok.body.ok, true);
    const after = await callRoute(brainsH, "get", "/schedule", { user: admin });
    const row = after.body.schedule.find((r) => r.brain_id === "conscious");
    assert.equal(row.cadence, "daily");
    assert.ok(row.next_run_at > 0);
  });
});

describe("lattice S3 — bulk audit priors are the true pre-flip counts", () => {
  it("revoke from 2-of-3 consented logs old_value 2; grant from 0 logs 0", async () => {
    const ins = db.prepare(`INSERT INTO dtus (id, creator_id, title, train_consented) VALUES (?, 'user_a', ?, ?)`);
    ins.run("d1", "One", 1); ins.run("d2", "Two", 1); ins.run("d3", "Three", 0);
    const revoke = await callRoute(latticeH, "post", "/dtus/consent-all", { user: plain, body: { consented: false } });
    assert.equal(revoke.body.ok, true);
    assert.equal(revoke.body.priorConsented, 2);
    let log = db.prepare(`SELECT old_value, new_value, action FROM lattice_consent_log ORDER BY created_at DESC, rowid DESC LIMIT 1`).get();
    assert.equal(log.action, "bulk");
    assert.equal(log.old_value, 2);
    assert.equal(log.new_value, 0);
    const grant = await callRoute(latticeH, "post", "/dtus/consent-all", { user: plain, body: { consented: true } });
    assert.equal(grant.body.priorConsented, 0);
    log = db.prepare(`SELECT old_value, new_value FROM lattice_consent_log ORDER BY created_at DESC, rowid DESC LIMIT 1`).get();
    assert.equal(log.old_value, 0);
    assert.equal(log.new_value, 1);
  });
});
