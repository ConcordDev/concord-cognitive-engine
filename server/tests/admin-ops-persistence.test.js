// server/tests/admin-ops-persistence.test.js
//
// DB-backed persistence tests for server/domains/admin.js's ops-console
// backlog (migration 364 — admin_alert_rules / admin_feature_flags /
// admin_incidents). The sibling admin-domain-parity.test.js and
// tests/depth/admin-behavior.test.js files drive the domain against the
// process-global globalThis._concordSTATE.adminLens in-memory fallback
// (admin-domain-parity never passes ctx.db; the depth harness happens to
// pass a real ctx.db, but doesn't independently verify the raw SQL rows).
// This file pins the DURABLE path directly: it hands each macro a real
// migrated better-sqlite3 DB via ctx.db and proves:
//   - real persistence — the row lands in admin_alert_rules/
//     admin_feature_flags/admin_incidents themselves (checked via a raw
//     db.prepare(...).get(id) query, NOT just the macro's own reader)
//   - restart-equivalence — a SECOND, independent better-sqlite3 handle
//     opened against the same file sees the same rows (not a process-
//     global Map)
//   - alertEvaluate still produces correct firing/ok state when the rule
//     it reads comes from the DB-backed store (series stays in-memory by
//     design — see migration 364's header comment — so recordMetric still
//     writes to the in-memory ring buffer; only the rule itself is
//     DB-backed)

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerAdminActions from "../domains/admin.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
// Mirror the real LENS_ACTIONS 3-arg dispatch: handler(ctx, artifact, params).
function call(db, userId, name, params = {}) {
  const fn = ACTIONS.get(`admin.${name}`);
  if (!fn) throw new Error(`admin.${name} not registered`);
  const ctx = { db, actor: { userId, role: "admin" }, userId };
  return fn(ctx, { id: null, data: {}, meta: {} }, params || {});
}

let db;
let dbFile;
beforeEach(async () => {
  ACTIONS.clear();
  registerAdminActions(register);
  // A FILE-backed DB so a second independent handle can prove restart durability.
  dbFile = path.join(os.tmpdir(), `admin-ops-db-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  db = new Database(dbFile);
  await runMigrations(db);
  // Keep the in-memory fallback empty so we can be sure the DB path is exercised.
  globalThis._concordSTATE = {};
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("admin ops-console — DB persistence (durable, restart-equivalent)", () => {
  it("persists an alert rule into admin_alert_rules, not a process Map", () => {
    const up = call(db, "admin_a", "alertRuleUpsert", {
      rule: { name: "high-latency", metric: "lat", comparator: ">", threshold: 500, severity: "critical" },
    });
    assert.equal(up.ok, true, up.error);
    const id = up.result.rule.id;

    // The load-bearing proof: query the RAW SQL table directly, not through
    // the macro's own reader.
    const row = db.prepare("SELECT * FROM admin_alert_rules WHERE id = ?").get(id);
    assert.ok(row, "rule row must exist on disk in admin_alert_rules");
    assert.equal(row.name, "high-latency");
    assert.equal(row.metric, "lat");
    assert.equal(row.comparator, ">");
    assert.equal(row.threshold, 500);
    assert.equal(row.severity, "critical");
    assert.equal(row.enabled, 1);

    // The process-global in-memory fallback must stay untouched — adminLens
    // is lazily created by adminState() on first call, but its alertRules
    // Map must have zero entries since the DB path, not the Map fallback,
    // is what actually holds this rule.
    assert.equal(globalThis._concordSTATE.adminLens.alertRules.size, 0);
  });

  it("survives a brand-new independent DB handle to the same file (restart-equivalence)", () => {
    const up = call(db, "admin_a", "alertRuleUpsert", {
      rule: { name: "restart-rule", metric: "cpu", comparator: ">=", threshold: 90 },
    });
    const id = up.result.rule.id;

    const db2 = new Database(dbFile, { readonly: true });
    try {
      const row = db2.prepare("SELECT * FROM admin_alert_rules WHERE id = ?").get(id);
      assert.ok(row, "row must be visible from a second, independent handle");
      assert.equal(row.name, "restart-rule");
      assert.equal(row.threshold, 90);
    } finally { db2.close(); }
  });

  it("alertRuleUpsert updates an existing rule in place (same id, ON CONFLICT path) and alertRuleDelete removes it from disk", () => {
    const up = call(db, "admin_a", "alertRuleUpsert", {
      rule: { name: "mem-rule", metric: "mem", comparator: ">", threshold: 80 },
    });
    const id = up.result.rule.id;

    const upd = call(db, "admin_a", "alertRuleUpsert", {
      rule: { id, name: "mem-rule", metric: "mem", comparator: ">", threshold: 95, severity: "critical" },
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.totalRules, 1, "update must not create a second row");
    const row = db.prepare("SELECT * FROM admin_alert_rules WHERE id = ?").get(id);
    assert.equal(row.threshold, 95);
    assert.equal(row.severity, "critical");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM admin_alert_rules").get().n, 1);

    const del = call(db, "admin_a", "alertRuleDelete", { ruleId: id });
    assert.equal(del.ok, true);
    assert.equal(db.prepare("SELECT id FROM admin_alert_rules WHERE id = ?").get(id), undefined, "row must be gone after delete");
  });

  it("alertEvaluate reads the rule from the DB-backed store and still evaluates firing state correctly", () => {
    // recordMetric writes to the in-memory series ring buffer by design
    // (out of migration 364's scope) — the rule itself is DB-backed.
    call(db, "admin_a", "recordMetric", { metric: "req_latency_ms", value: 900 });

    const up = call(db, "admin_a", "alertRuleUpsert", {
      rule: { name: "latency-alert", metric: "req_latency_ms", comparator: ">", threshold: 500, aggregation: "avg" },
    });
    assert.equal(up.ok, true);
    const ruleId = up.result.rule.id;

    // Confirm the rule is genuinely on disk before evaluating.
    assert.ok(db.prepare("SELECT id FROM admin_alert_rules WHERE id = ?").get(ruleId));

    const ev = call(db, "admin_a", "alertEvaluate", {});
    assert.equal(ev.ok, true);
    assert.equal(ev.result.rules.length, 1);
    assert.equal(ev.result.rules[0].id, ruleId);
    assert.equal(ev.result.rules[0].state, "firing");
    assert.equal(ev.result.rules[0].observed, 900);
    assert.equal(ev.result.summary.firing, 1);

    // Drop the metric below threshold and confirm the DB-backed rule now reads "ok".
    call(db, "admin_a", "recordMetric", { metric: "req_latency_ms", value: 100 });
    const ev2 = call(db, "admin_a", "alertEvaluate", {});
    assert.equal(ev2.result.rules[0].state, "ok");
  });

  it("persists a feature flag into admin_feature_flags and toggles it through the DB path", () => {
    const set = call(db, "admin_a", "featureFlagSet", {
      flag: { key: "new-checkout", enabled: false, description: "durable flag", rolloutPct: 25 },
    });
    assert.equal(set.ok, true);
    const id = set.result.flag.id;

    const row = db.prepare("SELECT * FROM admin_feature_flags WHERE id = ?").get(id);
    assert.ok(row, "flag row must exist on disk in admin_feature_flags");
    assert.equal(row.key, "new-checkout");
    assert.equal(row.enabled, 0);
    assert.equal(row.rollout_pct, 25);

    const toggled = call(db, "admin_a", "featureFlagSet", { toggle: id });
    assert.equal(toggled.ok, true);
    assert.equal(toggled.result.flag.enabled, true);
    const rowAfterToggle = db.prepare("SELECT enabled FROM admin_feature_flags WHERE id = ?").get(id);
    assert.equal(rowAfterToggle.enabled, 1, "toggle must be reflected on disk, not just in the returned object");

    const list = call(db, "admin_a", "featureFlagList", {});
    assert.equal(list.ok, true);
    assert.ok(list.result.flags.some((f) => f.id === id && f.enabled === true));

    // Second independent handle sees the toggled state (restart-equivalence).
    const db2 = new Database(dbFile, { readonly: true });
    try {
      const r = db2.prepare("SELECT enabled FROM admin_feature_flags WHERE id = ?").get(id);
      assert.equal(r.enabled, 1);
    } finally { db2.close(); }
  });

  it("persists an incident + its full timeline into admin_incidents through open/acknowledge/resolve, visible from a second handle", () => {
    const open = call(db, "oncall_a", "incidentOpen", { title: "API 500s spiking", severity: "sev1", service: "api" });
    assert.equal(open.ok, true);
    const id = open.result.incident.id;

    const row = db.prepare("SELECT * FROM admin_incidents WHERE id = ?").get(id);
    assert.ok(row, "incident row must exist on disk in admin_incidents");
    assert.equal(row.title, "API 500s spiking");
    assert.equal(row.severity, "sev1");
    assert.equal(row.status, "open");
    assert.equal(JSON.parse(row.timeline_json).length, 1);
    assert.equal(JSON.parse(row.timeline_json)[0].kind, "opened");

    const ack = call(db, "oncall_a", "incidentUpdate", { incidentId: id, action: "acknowledge", note: "on it" });
    assert.equal(ack.ok, true);
    const rowAfterAck = db.prepare("SELECT status, acknowledged_by, timeline_json FROM admin_incidents WHERE id = ?").get(id);
    assert.equal(rowAfterAck.status, "acknowledged");
    assert.equal(rowAfterAck.acknowledged_by, "oncall_a");
    assert.equal(JSON.parse(rowAfterAck.timeline_json).length, 2);

    const res = call(db, "oncall_a", "incidentUpdate", { incidentId: id, action: "resolve" });
    assert.equal(res.ok, true);
    assert.equal(typeof res.result.incident.durationMs, "number");
    const rowAfterResolve = db.prepare("SELECT status, resolved_at, duration_ms, timeline_json FROM admin_incidents WHERE id = ?").get(id);
    assert.equal(rowAfterResolve.status, "resolved");
    assert.ok(rowAfterResolve.resolved_at);
    assert.equal(typeof rowAfterResolve.duration_ms, "number");
    assert.equal(JSON.parse(rowAfterResolve.timeline_json).length, 3);

    const list = call(db, "oncall_a", "incidentList", { status: "resolved" });
    assert.equal(list.ok, true);
    assert.ok(list.result.incidents.some((i) => i.id === id));
    assert.equal(list.result.summary.resolved, 1);

    // Restart-equivalence: a second independent handle sees the same row + full timeline.
    const db2 = new Database(dbFile, { readonly: true });
    try {
      const r = db2.prepare("SELECT status, timeline_json FROM admin_incidents WHERE id = ?").get(id);
      assert.equal(r.status, "resolved");
      const timeline = JSON.parse(r.timeline_json);
      assert.deepEqual(timeline.map((t) => t.kind), ["opened", "acknowledged", "resolved"]);
    } finally { db2.close(); }

    // Resolving an already-resolved incident is still rejected reading from the DB-backed store.
    const again = call(db, "oncall_a", "incidentUpdate", { incidentId: id, action: "resolve" });
    assert.equal(again.ok, false);
    assert.match(again.error, /already resolved/);
  });
});
