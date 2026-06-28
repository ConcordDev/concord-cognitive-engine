// Contract tests for server/domains/ops.js — PagerDuty-shape incident
// management substrate: legacy artifact macros plus the 2026 parity
// macros (incident lifecycle, alert ingestion, escalation policies,
// on-call calendar, notification dispatch, service directory + graph,
// MTTA/MTTR analytics, status page).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerOpsActions from "../domains/ops.js";

// ops.js now registers through the canonical 2-arg `register(domain, name,
// (ctx, input) => ...)` convention (saved-class fix); the legacy
// `(ctx, artifact, params)` shape is adapted internally by the module's shim.
// Drive each macro the way runMacro would — a (ctx, input) call.
const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`ops.${name}`);
  assert.ok(fn, `ops.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerOpsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("ops legacy artifact macros", () => {
  it("pageOnCall resolves the current slot from a rotation", () => {
    const r = call("pageOnCall", ctxA, { rotation: [{ user: "alice", startHour: 0, endHour: 24 }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.current, "alice");
  });
  it("runbookLookup matches by alert signature", () => {
    const r = call("runbookLookup", ctxA, {
      runbooks: [{ alertPattern: "db-timeout", steps: ["restart", "failover"], owner: "dba" }],
      alert: "prod db-timeout spike",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.matches, 1);
  });
  it("postmortemDraft returns a 5-section skeleton", () => {
    const r = call("postmortemDraft", ctxA, { title: "API outage", severity: "sev2" });
    assert.equal(r.ok, true);
    assert.equal(r.result.sections.length, 5);
  });
  it("escalationCheck flags a breach", () => {
    const r = call("escalationCheck", ctxA, { severity: "sev1", minutesOpen: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.breached, true);
  });
});

describe("ops incident lifecycle [L]", () => {
  it("creates an incident in the triggered state", () => {
    const r = call("incidentCreate", ctxA, { title: "Checkout down", severity: "sev1" });
    assert.equal(r.ok, true);
    assert.equal(r.result.incident.status, "triggered");
    assert.equal(r.result.incident.severity, "sev1");
  });
  it("rejects an incident with no title", () => {
    const r = call("incidentCreate", ctxA, {});
    assert.equal(r.ok, false);
  });
  it("drives the state machine triggered → acknowledged → resolved", () => {
    const id = call("incidentCreate", ctxA, { title: "X" }).result.incident.id;
    const ack = call("incidentTransition", ctxA, { incidentId: id, to: "acknowledged" });
    assert.equal(ack.ok, true);
    assert.ok(ack.result.incident.acknowledgedAt);
    const res = call("incidentTransition", ctxA, { incidentId: id, to: "resolved" });
    assert.equal(res.ok, true);
    assert.ok(res.result.incident.resolvedAt);
  });
  it("rejects an invalid transition", () => {
    const id = call("incidentCreate", ctxA, { title: "Y" }).result.incident.id;
    call("incidentTransition", ctxA, { incidentId: id, to: "resolved" });
    const bad = call("incidentTransition", ctxA, { incidentId: id, to: "acknowledged" });
    assert.equal(bad.ok, false);
  });
  it("appends notes and lists by status; data is per-user", () => {
    const id = call("incidentCreate", ctxA, { title: "Z" }).result.incident.id;
    const note = call("incidentNote", ctxA, { incidentId: id, note: "looking into it" });
    assert.equal(note.ok, true);
    const listA = call("incidentList", ctxA, { status: "triggered" });
    assert.equal(listA.ok, true);
    assert.equal(listA.result.open, 1);
    assert.equal(call("incidentList", ctxB, {}).result.total, 0);
  });
});

describe("ops alert ingestion [M]", () => {
  it("ingests an alert and auto-creates an incident", () => {
    const r = call("alertIngest", ctxA, { signature: "cpu-high", message: "CPU 99%", autoCreate: true });
    assert.equal(r.ok, true);
    assert.ok(r.result.incident);
    assert.equal(r.result.alert.incidentId, r.result.incident.id);
  });
  it("rejects an alert with no signature", () => {
    assert.equal(call("alertIngest", ctxA, {}).ok, false);
  });
  it("lists ingested alerts", () => {
    call("alertIngest", ctxA, { signature: "disk-full" });
    const r = call("alertList", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 1);
  });
});

describe("ops escalation policies [M]", () => {
  it("creates a tiered policy and evaluates the active tier", () => {
    const pol = call("policyCreate", ctxA, {
      name: "Critical chain",
      tiers: [
        { afterMinutes: 0, target: "primary", channel: "push" },
        { afterMinutes: 10, target: "secondary", channel: "sms" },
        { afterMinutes: 30, target: "lead", channel: "email" },
      ],
    });
    assert.equal(pol.ok, true);
    assert.equal(pol.result.policy.tiers.length, 3);
    const ev = call("policyEvaluate", ctxA, { policyId: pol.result.policy.id, minutesOpen: 15 });
    assert.equal(ev.ok, true);
    assert.equal(ev.result.currentTier.target, "secondary");
    assert.equal(ev.result.nextTier.target, "lead");
    assert.equal(ev.result.fullyEscalated, false);
  });
  it("rejects a policy with no tiers and lists policies", () => {
    assert.equal(call("policyCreate", ctxA, { name: "empty" }).ok, false);
    call("policyCreate", ctxA, { name: "P", tiers: [{ afterMinutes: 0, target: "a" }] });
    assert.equal(call("policyList", ctxA, {}).result.total, 1);
  });
});

describe("ops on-call calendar + overrides [S]", () => {
  it("creates shifts and resolves coverage gaps", () => {
    const base = Date.now();
    const s1 = call("shiftCreate", ctxA, {
      responder: "alice",
      startsAt: new Date(base).toISOString(),
      endsAt: new Date(base + 3600000).toISOString(),
    });
    assert.equal(s1.ok, true);
    call("shiftCreate", ctxA, {
      responder: "bob",
      startsAt: new Date(base + 7200000).toISOString(),
      endsAt: new Date(base + 10800000).toISOString(),
    });
    const cal = call("calendarView", ctxA, {
      from: new Date(base - 3600000).toISOString(),
      to: new Date(base + 14400000).toISOString(),
    });
    assert.equal(cal.ok, true);
    assert.equal(cal.result.hasGaps, true);
    assert.equal(cal.result.gaps[0].minutes, 60);
  });
  it("override wins over base shift for current on-call", () => {
    const base = Date.now();
    call("shiftCreate", ctxA, {
      responder: "alice",
      startsAt: new Date(base - 3600000).toISOString(),
      endsAt: new Date(base + 3600000).toISOString(),
    });
    const ov = call("shiftOverride", ctxA, {
      responder: "carol",
      startsAt: new Date(base - 600000).toISOString(),
      endsAt: new Date(base + 600000).toISOString(),
      reason: "swap",
    });
    assert.equal(ov.ok, true);
    const cal = call("calendarView", ctxA, {});
    assert.equal(cal.result.currentOnCall, "carol");
    assert.equal(cal.result.currentOnCallSource, "override");
  });
  it("rejects a shift where endsAt precedes startsAt", () => {
    const r = call("shiftCreate", ctxA, {
      responder: "x",
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now()).toISOString(),
    });
    assert.equal(r.ok, false);
  });
});

describe("ops notification dispatch [M]", () => {
  it("dispatches a notification and is idempotent on the key", () => {
    const inc = call("incidentCreate", ctxA, { title: "Outage" }).result.incident;
    const n1 = call("notifyDispatch", ctxA, { incidentId: inc.id, target: "alice", channel: "sms", tier: 1 });
    assert.equal(n1.ok, true);
    assert.equal(n1.result.deduped, false);
    const n2 = call("notifyDispatch", ctxA, { incidentId: inc.id, target: "alice", channel: "sms", tier: 1 });
    assert.equal(n2.result.deduped, true);
    assert.equal(call("notifyList", ctxA, {}).result.total, 1);
  });
  it("rejects a dispatch with no target", () => {
    assert.equal(call("notifyDispatch", ctxA, {}).ok, false);
  });
});

describe("ops service directory + dependency mapping [M]", () => {
  it("registers services and builds the dependency graph + blast radius", () => {
    const db = call("serviceCreate", ctxA, { name: "database", tier: "critical" }).result.service;
    const api = call("serviceCreate", ctxA, { name: "api", dependsOn: [db.id] }).result.service;
    call("serviceCreate", ctxA, { name: "web", dependsOn: [api.id] });
    assert.equal(call("serviceList", ctxA, {}).result.total, 3);
    const g = call("serviceGraph", ctxA, { rootServiceId: db.id });
    assert.equal(g.ok, true);
    assert.equal(g.result.edges.length, 2);
    assert.equal(g.result.blastRadius.impactedCount, 2);
  });
  it("maps an ingested alert to a service by alertKey", () => {
    call("serviceCreate", ctxA, { name: "payments", alertKeys: ["stripe"] });
    const r = call("alertIngest", ctxA, { signature: "stripe webhook failing" });
    assert.equal(r.result.mappedService, "payments");
  });
  it("rejects a service with no name", () => {
    assert.equal(call("serviceCreate", ctxA, {}).ok, false);
  });
});

describe("ops MTTA/MTTR analytics [S]", () => {
  it("computes MTTA and MTTR over resolved incidents", () => {
    const id = call("incidentCreate", ctxA, { title: "Slow", severity: "sev2" }).result.incident.id;
    call("incidentTransition", ctxA, { incidentId: id, to: "acknowledged" });
    call("incidentTransition", ctxA, { incidentId: id, to: "resolved" });
    const a = call("analytics", ctxA, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.totalIncidents, 1);
    assert.equal(a.result.resolvedIncidents, 1);
    assert.ok(typeof a.result.mttrMinutes === "number");
    assert.ok(a.result.bySeverity.sev2);
    assert.ok(Array.isArray(a.result.weeklyTrend));
  });
});

describe("ops status page [M]", () => {
  it("renders an operational page with no incidents", () => {
    call("serviceCreate", ctxA, { name: "core" });
    const r = call("statusPage", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.overall, "all_systems_operational");
    assert.equal(r.result.components.length, 1);
  });
  it("degrades a component when an open incident targets it", () => {
    const svc = call("serviceCreate", ctxA, { name: "core" }).result.service;
    call("incidentCreate", ctxA, { title: "Outage", severity: "sev1", serviceId: svc.id });
    const r = call("statusPage", ctxA, {});
    assert.equal(r.result.overall, "major_outage");
    assert.equal(r.result.components[0].status, "major_outage");
    assert.equal(r.result.activeIncidentCount, 1);
  });
});
