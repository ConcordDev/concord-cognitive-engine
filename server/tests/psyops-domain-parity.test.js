// Contract tests for server/domains/psyops.js — the anomaly-detection
// operator console. Exercises every macro the lens UI wires and asserts
// the { ok } envelope, genuine z-score math, and the per-user workflow.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerPsyopsActions from "../domains/psyops.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`psyops.${name}`);
  if (!fn) throw new Error(`psyops.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerPsyopsActions(register); });

beforeEach(() => {
  // Fresh STATE per test so per-user Maps don't bleed across cases.
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// A tight baseline cohort + one extreme outlier. With ~24 tight samples a
// single outlier can reach ~4.9σ — enough to clear every default rule
// threshold (skill 2.5 / economy 3.0 / content 2.5 / network 3.0).
function cohortWithOutlier(outlierEntity, outlierValue, n = 24) {
  const samples = [];
  for (let i = 0; i < n; i++) {
    samples.push({ entityId: `base_${i}`, value: 100 + (i % 5) - 2 });
  }
  samples.push({ entityId: outlierEntity, value: outlierValue });
  return samples;
}

describe("psyops — detection rules", () => {
  it("rules_list seeds the four default signal rules", () => {
    const r = call("rules_list", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.rules.length, 4);
    const signals = r.result.rules.map((x) => x.signal).sort();
    assert.deepEqual(signals, ["content", "economy", "network", "skill_divergence"]);
  });

  it("rules_update changes sigma / critical / enabled and validates bounds", () => {
    assert.equal(call("rules_update", ctxA, { signal: "economy", sigma: 3.7 }).ok, true);
    const updated = call("rules_list", ctxA).result.rules.find((x) => x.signal === "economy");
    assert.equal(updated.sigma, 3.7);
    assert.equal(call("rules_update", ctxA, { signal: "economy", sigma: 99 }).ok, false);
    assert.equal(call("rules_update", ctxA, { signal: "nope", sigma: 2 }).ok, false);
    assert.equal(call("rules_update", ctxA, { signal: "content", enabled: false }).ok, true);
  });
});

describe("psyops — multi-signal scan", () => {
  it("computes a genuine z-score and files alerts past the threshold", () => {
    const r = call("scan_signal", ctxA, {
      signal: "economy",
      samples: cohortWithOutlier("wallet_x", 900),
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.scanned, 25);
    assert.ok(r.result.stddev > 0);
    // wallet_x is a massive outlier — must be flagged.
    const flagged = r.result.newAlerts.map((a) => a.entityId);
    assert.ok(flagged.includes("wallet_x"));
    const outlier = r.result.newAlerts.find((a) => a.entityId === "wallet_x");
    assert.ok(outlier.sigmaAbove >= 3.0);
  });

  it("rejects too-few samples and unknown signals", () => {
    assert.equal(call("scan_signal", ctxA, { signal: "economy", samples: [{ entityId: "x", value: 1 }] }).ok, false);
    assert.equal(call("scan_signal", ctxA, { signal: "bogus", samples: [] }).ok, false);
  });

  it("files a critical notification when an anomaly exceeds the critical sigma", () => {
    // Drop the network critical threshold so the outlier clears it.
    call("rules_update", ctxA, { signal: "network", critical: 3.5 });
    call("scan_signal", ctxA, {
      signal: "network",
      samples: cohortWithOutlier("n_crit", 5000),
    });
    const nt = call("notifications_list", ctxA);
    assert.equal(nt.ok, true);
    assert.ok(nt.result.unacknowledged >= 1);
    assert.match(nt.result.notifications[0].message, /CRITICAL/);
  });
});

describe("psyops — alert list + detail", () => {
  function seed(ctx) {
    return call("scan_signal", ctx, {
      signal: "content",
      samples: cohortWithOutlier("c_out", 400),
    });
  }

  it("alerts_list returns this user's alerts with status counts", () => {
    seed(ctxA);
    const r = call("alerts_list", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.alerts.length >= 1);
    assert.ok(r.result.counts.open >= 1);
  });

  it("alerts are per-user isolated", () => {
    seed(ctxA);
    const r = call("alerts_list", ctxB);
    assert.equal(r.ok, true);
    assert.equal(r.result.alerts.length, 0);
  });

  it("alert_detail returns evidence drill-down + related alerts", () => {
    seed(ctxA);
    const id = call("alerts_list", ctxA).result.alerts[0].id;
    const r = call("alert_detail", ctxA, { alertId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.alert.id, id);
    assert.ok(r.result.alert.evidence.cohortSize >= 2);
    assert.equal(call("alert_detail", ctxA, { alertId: "missing" }).ok, false);
  });
});

describe("psyops — triage workflow", () => {
  function firstAlertId(ctx) {
    call("scan_signal", ctx, {
      signal: "content",
      samples: cohortWithOutlier("t_out", 400),
    });
    return call("alerts_list", ctx).result.alerts[0].id;
  }

  it("assign / investigate / resolve / dismiss advance status and log a note", () => {
    const id = firstAlertId(ctxA);
    assert.equal(call("alert_triage", ctxA, { alertId: id, action: "assign" }).result.alert.status, "assigned");
    assert.equal(call("alert_triage", ctxA, { alertId: id, action: "investigate", note: "looking" }).result.alert.status, "investigating");
    const resolved = call("alert_triage", ctxA, { alertId: id, action: "resolve" });
    assert.equal(resolved.result.alert.status, "resolved");
    assert.ok(resolved.result.alert.notes.length >= 3);
  });

  it("rejects unknown actions and missing alerts", () => {
    const id = firstAlertId(ctxA);
    assert.equal(call("alert_triage", ctxA, { alertId: id, action: "explode" }).ok, false);
    assert.equal(call("alert_triage", ctxA, { alertId: "nope", action: "assign" }).ok, false);
  });
});

describe("psyops — incident correlation", () => {
  function seedTwoAlerts(ctx) {
    const samples = cohortWithOutlier("e_out1", 600);
    samples.push({ entityId: "e_out2", value: 620 });
    call("scan_signal", ctx, { signal: "economy", samples });
    return call("alerts_list", ctx).result.alerts.map((a) => a.id);
  }

  it("incident_create groups alerts and stamps incidentId", () => {
    const ids = seedTwoAlerts(ctxA);
    const r = call("incident_create", ctxA, { title: "Coordinated economy attack", alertIds: ids });
    assert.equal(r.ok, true);
    assert.equal(r.result.incident.alertIds.length, ids.length);
    const detail = call("alert_detail", ctxA, { alertId: ids[0] });
    assert.equal(detail.result.alert.incidentId, r.result.incident.id);
  });

  it("incident_list returns a chronological timeline per incident", () => {
    const ids = seedTwoAlerts(ctxA);
    call("incident_create", ctxA, { title: "Incident X", alertIds: ids });
    const r = call("incident_list", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.incidents.length, 1);
    assert.ok(Array.isArray(r.result.incidents[0].timeline));
    assert.equal(r.result.incidents[0].alertCount, ids.length);
  });

  it("incident_close records an audited resolution", () => {
    const ids = seedTwoAlerts(ctxA);
    const inc = call("incident_create", ctxA, { title: "Incident Y", alertIds: ids }).result.incident;
    const r = call("incident_close", ctxA, { incidentId: inc.id, resolution: "false positive — bulk import" });
    assert.equal(r.ok, true);
    assert.equal(r.result.incident.status, "closed");
    assert.equal(r.result.incident.resolution, "false positive — bulk import");
  });

  it("rejects an incident with no valid alerts or no title", () => {
    assert.equal(call("incident_create", ctxA, { title: "x", alertIds: ["nope"] }).ok, false);
    assert.equal(call("incident_create", ctxA, { alertIds: [] }).ok, false);
  });
});

describe("psyops — quarantine + audited release", () => {
  function firstAlertId(ctx) {
    call("scan_signal", ctx, {
      signal: "network",
      samples: cohortWithOutlier("q_out", 400),
    });
    return call("alerts_list", ctx).result.alerts[0].id;
  }

  it("quarantine_entity isolates the alert and writes an audit row", () => {
    const id = firstAlertId(ctxA);
    const r = call("quarantine_entity", ctxA, { alertId: id, reason: "confirmed adversarial" });
    assert.equal(r.ok, true);
    assert.equal(r.result.alert.quarantined, true);
    const log = call("quarantine_log", ctxA);
    assert.equal(log.result.log[0].action, "quarantine");
  });

  it("quarantine_release requires a reason and is audited", () => {
    const id = firstAlertId(ctxA);
    call("quarantine_entity", ctxA, { alertId: id, reason: "review" });
    assert.equal(call("quarantine_release", ctxA, { alertId: id }).ok, false);
    const r = call("quarantine_release", ctxA, { alertId: id, reason: "cleared after investigation" });
    assert.equal(r.ok, true);
    assert.equal(r.result.alert.quarantined, false);
    const log = call("quarantine_log", ctxA);
    assert.equal(log.result.log[0].action, "release");
  });
});

describe("psyops — critical-alert notifications", () => {
  it("notification_ack acknowledges a single page and an ack-all", () => {
    call("rules_update", ctxA, { signal: "network", critical: 3.5 });
    call("scan_signal", ctxA, {
      signal: "network",
      samples: cohortWithOutlier("x_crit", 9000),
    });
    const nt = call("notifications_list", ctxA).result;
    assert.ok(nt.unacknowledged >= 1);
    const single = call("notification_ack", ctxA, { notificationId: nt.notifications[0].id });
    assert.equal(single.result.acknowledged, 1);
    const all = call("notification_ack", ctxA, { all: true });
    assert.equal(all.ok, true);
    assert.equal(call("notifications_list", ctxA).result.unacknowledged, 0);
  });

  it("notification_ack rejects an unknown id", () => {
    assert.equal(call("notification_ack", ctxA, { notificationId: "nope" }).ok, false);
  });
});

describe("psyops — never throws", () => {
  it("every macro returns an { ok } object on garbage input", () => {
    for (const name of [
      "rules_list", "rules_update", "scan_signal", "alerts_list", "alert_detail",
      "alert_triage", "incident_create", "incident_list", "incident_close",
      "quarantine_entity", "quarantine_release", "quarantine_log",
      "notifications_list", "notification_ack",
    ]) {
      const r = call(name, ctxA, { junk: Symbol("x") });
      assert.equal(typeof r.ok, "boolean", `${name} must return { ok }`);
    }
  });
});
