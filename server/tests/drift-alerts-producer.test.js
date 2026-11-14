// Drift-alerts producer — hermetic end-to-end pins.
//
// The gap (migration 316's own words): drift_alerts was created as "a
// persistent store for lattice drift alerts... today the alerts live only
// in-memory in drift-monitor" — and nothing ever inserted. This suite drives
// the REAL chain: emergent state change -> runDriftScan (real detectors)
// -> persistDriftAlerts -> the row served through the ghost-tracker lens's
// OWN read macros (residues with a worldId passed, as the FE always passes
// one; detail). No fabricated rows anywhere: the only alert in play is the
// one the echo-chamber detector mints from the crafted state.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { getEmergentState } from "../emergent/store.js";
import {
  runDriftScan,
  persistDriftAlerts,
  driftAlertSignature,
} from "../emergent/drift-monitor.js";
import registerGhostHuntMacros from "../domains/ghost-hunt.js";

// Migration 316's drift_alerts DDL, verbatim.
const DDL = `
  CREATE TABLE IF NOT EXISTS drift_alerts (
    id           TEXT PRIMARY KEY,
    type         TEXT,
    drift_type   TEXT,
    severity     TEXT,
    message      TEXT,
    signature    TEXT,
    context_json TEXT,
    detected_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    resolved_at  INTEGER
  );
`;

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  return db;
}

// Emergent state whose adversarial ratio is zero — the echo-chamber
// detector's firing condition (active emergents, none adversarial).
function driftingState() {
  const STATE = { dtus: new Map() };
  const es = getEmergentState(STATE);
  es.emergents.set("em-1", { id: "em-1", role: "builder", active: true });
  es.emergents.set("em-2", { id: "em-2", role: "researcher", active: true });
  es.emergents.set("em-3", { id: "em-3", role: "builder", active: true });
  return STATE;
}

function ghostMacros() {
  const macros = {};
  registerGhostHuntMacros((domain, name, fn) => { macros[name] = fn; });
  return macros;
}

test("state change -> real scan -> producer -> row in drift_alerts, mapped for the readers", () => {
  const db = makeDb();
  const scan = runDriftScan(driftingState());
  assert.equal(scan.ok, true);
  const echo = scan.alerts.find((a) => a.type === "echo_chamber");
  assert.ok(echo, "the echo-chamber detector fires on zero adversarial ratio");

  const res = persistDriftAlerts(db, scan.alerts);
  assert.equal(res.ok, true);
  assert.ok(res.inserted >= 1, "at least the echo-chamber alert persists");

  const row = db.prepare(`SELECT * FROM drift_alerts WHERE id = ?`).get(echo.alertId);
  assert.ok(row, "row is in the table under the alert's own id");
  assert.equal(row.type, "echo_chamber");
  assert.equal(row.drift_type, "echo_chamber");
  assert.equal(row.severity, "medium", "monitor 'warning' maps to the readers' 'medium'");
  assert.equal(row.signature, driftAlertSignature(echo), "signature is the stable drift identity");
  assert.ok(Number.isInteger(row.detected_at) && row.detected_at > 0, "detected_at is epoch seconds");
  const ctx = JSON.parse(row.context_json);
  assert.equal(ctx.source, "drift-monitor");
  assert.equal(ctx.severity, "warning", "the monitor's original severity rides in context");
  assert.equal(ctx.worldId, undefined, "platform drift carries no invented world");
});

test("the row is served through the lens's own read path, worldId passed as the FE passes it", async () => {
  const db = makeDb();
  const scan = runDriftScan(driftingState());
  persistDriftAlerts(db, scan.alerts);
  const echo = scan.alerts.find((a) => a.type === "echo_chamber");

  const macros = ghostMacros();
  const ctx = { db, actor: { userId: "hunter-1" }, userId: "hunter-1" };
  const list = await macros.residues(ctx, { worldId: "concordia-hub" });
  assert.equal(list.ok, true);
  const served = list.residues.find((r) => r.id === echo.alertId);
  assert.ok(served, "the platform-global row reads in the player's world");
  assert.equal(served.drift_type, "echo_chamber");
  assert.equal(served.stage, "track");
  assert.ok(Number.isFinite(served.coords.x) && Number.isFinite(served.coords.z), "map coords derive from the signature");

  const detail = await macros.detail(ctx, { residueId: echo.alertId });
  assert.equal(detail.ok, true);
  assert.equal(detail.residue.worldId, null, "detail honestly reports no single world");
  assert.equal(detail.residue.context.source, "drift-monitor");
});

test("dedupe: a re-firing scan inside the window does not flood the table", () => {
  const db = makeDb();
  const STATE = driftingState();
  const first = runDriftScan(STATE);
  const r1 = persistDriftAlerts(db, first.alerts);
  assert.ok(r1.inserted >= 1);
  const second = runDriftScan(STATE);
  const r2 = persistDriftAlerts(db, second.alerts);
  assert.equal(r2.ok, true);
  assert.equal(r2.inserted, 0, "same drift, drifting readings — same signature, suppressed");
  const count = db.prepare(`SELECT COUNT(*) AS n FROM drift_alerts`).get().n;
  assert.equal(count, r1.inserted, "the table holds one row per real drift");
});

test("signature stability: numeric readings may drift, identity may not", () => {
  const a = { type: "echo_chamber", data: { adversarialRatio: 0.0, activeEmergents: 3 } };
  const b = { type: "echo_chamber", data: { adversarialRatio: 0.05, activeEmergents: 7 } };
  assert.equal(driftAlertSignature(a), driftAlertSignature(b));
  const c = { type: "self_reference", data: { sourceDtuId: "dtu-1", depth: 3 } };
  const d = { type: "self_reference", data: { sourceDtuId: "dtu-2", depth: 3 } };
  assert.notEqual(driftAlertSignature(c), driftAlertSignature(d), "string identity separates distinct drifts");
});

test("no drift -> no rows; a missing substrate is named, never thrown", () => {
  const db = makeDb();
  const calm = runDriftScan({ dtus: new Map() });
  const res = persistDriftAlerts(db, calm.alerts);
  assert.equal(res.ok, true);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM drift_alerts`).get().n, 0);

  const bare = new DatabaseSync(":memory:");
  const scan = runDriftScan(driftingState());
  const failed = persistDriftAlerts(bare, scan.alerts);
  assert.equal(failed.ok, false);
  assert.equal(failed.reason, "substrate_unavailable");
});
