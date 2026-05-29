/**
 * Living Society — Phase 12e prep: drift-alert severity filter regression.
 *
 * Pins the fix for a muted built system: `lattice-orchestrator.js` queried
 * `getDriftAlerts(STATE, { severity: "high" })`, but DRIFT_SEVERITY is
 * info|warning|alert|critical — "high" matched NOTHING, so HIGH/CRITICAL drift
 * findings never reached HLR and never emitted `world:drift-alert` (the
 * moodboard tint). The drift-detection engine ran every 15 min into a void.
 *
 * Fix: getDriftAlerts now accepts a severity ARRAY (back-compat: a string still
 * works); the orchestrator routes ["alert","critical"]. This test pins both the
 * array-filter contract and documents the dead "high" string.
 *
 * Run: node --test tests/drift-alert-severity-filter.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDriftAlerts, DRIFT_SEVERITY } from "../emergent/drift-monitor.js";

function stateWithAlerts() {
  // Pre-seed the in-memory drift store with one alert of each severity.
  return {
    _driftMonitor: {
      snapshots: [],
      alerts: [
        { alertId: "a1", type: "goodhart",          severity: DRIFT_SEVERITY.INFO,     message: "i", timestamp: "2026-01-01" },
        { alertId: "a2", type: "memetic_drift",     severity: DRIFT_SEVERITY.WARNING,  message: "w", timestamp: "2026-01-02" },
        { alertId: "a3", type: "self_reference",    severity: DRIFT_SEVERITY.ALERT,    message: "a", timestamp: "2026-01-03" },
        { alertId: "a4", type: "metric_divergence", severity: DRIFT_SEVERITY.CRITICAL, message: "c", timestamp: "2026-01-04" },
      ],
      metrics: { totalScans: 0, alertsByType: {}, alertsBySeverity: {}, lastScanAt: null },
      thresholds: {},
    },
  };
}

describe("Phase 12e — drift-alert severity filter", () => {
  it("an ARRAY of severities returns every matching alert (the orchestrator path)", () => {
    const r = getDriftAlerts(stateWithAlerts(), { severity: ["alert", "critical"] });
    assert.equal(r.ok, true);
    const ids = r.alerts.map((a) => a.alertId).sort();
    assert.deepEqual(ids, ["a3", "a4"], "alert + critical only");
  });

  it("a single severity STRING still works (back-compat)", () => {
    const r = getDriftAlerts(stateWithAlerts(), { severity: "critical" });
    assert.deepEqual(r.alerts.map((a) => a.alertId), ["a4"]);
  });

  it('the dead "high" filter matches NOTHING (documents the bug that was fixed)', () => {
    const r = getDriftAlerts(stateWithAlerts(), { severity: "high" });
    assert.equal(r.alerts.length, 0, '"high" is not a real DRIFT_SEVERITY value');
  });

  it("no severity filter returns all alerts", () => {
    const r = getDriftAlerts(stateWithAlerts(), {});
    assert.equal(r.alerts.length, 4);
    assert.equal(r.total, 4);
  });

  it("returns the { ok, alerts, total } shape (NOT a bare array) — the second orchestrator bug", () => {
    // The orchestrator must read `.alerts`; treating the result as an array
    // (Array.isArray(result)) was the second latent bug and is now handled.
    const r = getDriftAlerts(stateWithAlerts(), { severity: ["alert", "critical"] });
    assert.equal(Array.isArray(r), false);
    assert.ok(Array.isArray(r.alerts));
  });
});
