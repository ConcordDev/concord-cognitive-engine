// Behavioral macro tests for server/domains/ops.js — the PagerDuty-shape
// incident-management substrate behind the ops lens.
//
// LIGHTWEIGHT + HERMETIC: a local register harness (no server boot, no network,
// no LLM, no DB) drives each registered macro the way runMacro would — a
// (ctx, input) call — against the REAL in-memory globalThis._concordSTATE.opsLens
// store the domain uses for persistence. These are NOT shape-only assertions:
// every test asserts ACTUAL values + multi-step round-trips (open incident →
// transition state machine → resolve; ingest alert → auto-create incident → map
// to service; build escalation policy → evaluate active tier; schedule shifts →
// detect coverage gaps → override wins; register services → blast-radius graph;
// MTTA/MTTR analytics; status-page derivation), per-user isolation, idempotent
// notification dispatch, and the fail-CLOSED numeric guard the macro-assassin's
// V2 vector probes.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerOpsActions from "../domains/ops.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "ops", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`ops.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerOpsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("ops — registration (every macro the lens calls is wired)", () => {
  it("registers all 22 lens-facing macros", () => {
    for (const m of [
      // legacy artifact macros (OpsActionPanel)
      "pageOnCall", "runbookLookup", "postmortemDraft", "escalationCheck",
      // incident lifecycle (IncidentConsole)
      "incidentCreate", "incidentTransition", "incidentList", "incidentNote",
      // alerts
      "alertIngest", "alertList",
      // escalation policies
      "policyCreate", "policyList", "policyEvaluate",
      // on-call calendar
      "shiftCreate", "shiftOverride", "calendarView",
      // notifications
      "notifyDispatch", "notifyList",
      // service directory
      "serviceCreate", "serviceList", "serviceGraph",
      // analytics + status page
      "analytics", "statusPage",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing ops.${m}`);
    }
  });
});

describe("ops — legacy artifact macros compute real values", () => {
  it("pageOnCall resolves the on-call slot from a 24h rotation", () => {
    const r = call("pageOnCall", ctxA, {
      rotation: [{ user: "alice", startHour: 0, endHour: 24 }],
      now: "2026-06-27T08:00:00Z",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.current, "alice");
    assert.equal(r.result.currentUtcHour, 8);
  });

  it("runbookLookup matches a runbook by alert signature substring", () => {
    const r = call("runbookLookup", ctxA, {
      runbooks: [{ alertPattern: "db-timeout", steps: ["restart", "failover"], owner: "dba" }],
      alert: "prod db-timeout spike",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.matches, 1);
    assert.equal(r.result.topMatch.owner, "dba");
    assert.equal(r.result.allMatches[0].stepCount, 2);
  });

  it("postmortemDraft returns the 5-section skeleton with a computed duration", () => {
    const r = call("postmortemDraft", ctxA, {
      title: "API outage", severity: "sev2",
      startedAt: "2026-06-27T00:00:00Z", resolvedAt: "2026-06-27T01:30:00Z",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.sections.length, 5);
    assert.equal(r.result.durationMin, 90);
    assert.deepEqual(r.result.sections.map((s) => s.name),
      ["summary", "timeline", "impact", "root_cause", "action_items"]);
  });

  it("escalationCheck flags a breach exactly at the severity threshold", () => {
    const within = call("escalationCheck", ctxA, { severity: "sev1", minutesOpen: 4 });
    assert.equal(within.result.breached, false);
    const breach = call("escalationCheck", ctxA, { severity: "sev1", minutesOpen: 5 });
    assert.equal(breach.result.breached, true);
    assert.equal(breach.result.thresholdMinutes, 5);
  });
});

describe("ops — incident lifecycle round-trip (open → ack → resolve)", () => {
  it("drives the full state machine and stamps the timestamps", () => {
    const created = call("incidentCreate", ctxA, { title: "Checkout down", severity: "sev1", summary: "5xx spike" });
    assert.equal(created.ok, true);
    assert.equal(created.result.incident.status, "triggered");
    assert.equal(created.result.incident.severity, "sev1");
    assert.equal(created.result.incident.number, 1);
    assert.equal(created.result.incident.timeline.length, 1);
    const id = created.result.incident.id;

    const ack = call("incidentTransition", ctxA, { incidentId: id, to: "acknowledged", note: "on it" });
    assert.equal(ack.ok, true);
    assert.ok(ack.result.incident.acknowledgedAt);

    const res = call("incidentTransition", ctxA, { incidentId: id, to: "resolved" });
    assert.equal(res.ok, true);
    assert.ok(res.result.incident.resolvedAt);
    assert.equal(res.result.incident.timeline.length, 3);

    // list reflects the resolved state — 0 open
    const listed = call("incidentList", ctxA, {});
    assert.equal(listed.result.total, 1);
    assert.equal(listed.result.open, 0);
  });

  it("rejects an incident with no title and an invalid state transition", () => {
    assert.equal(call("incidentCreate", ctxA, {}).ok, false);
    const id = call("incidentCreate", ctxA, { title: "Y" }).result.incident.id;
    // triggered → resolved is allowed, but resolved → acknowledged is not
    call("incidentTransition", ctxA, { incidentId: id, to: "resolved" });
    const bad = call("incidentTransition", ctxA, { incidentId: id, to: "acknowledged" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /invalid transition/);
  });

  it("appends a freeform note to the timeline", () => {
    const id = call("incidentCreate", ctxA, { title: "Z" }).result.incident.id;
    const note = call("incidentNote", ctxA, { incidentId: id, note: "looking into it" });
    assert.equal(note.ok, true);
    const tail = note.result.incident.timeline.at(-1);
    assert.equal(tail.event, "note");
    assert.equal(tail.note, "looking into it");
    assert.equal(call("incidentNote", ctxA, { incidentId: id, note: "  " }).ok, false);
  });
});

describe("ops — alert ingestion + service mapping", () => {
  it("auto-creates an incident from an alert and maps it to a service by alertKey", () => {
    call("serviceCreate", ctxA, { name: "payments", alertKeys: ["stripe"] });
    const r = call("alertIngest", ctxA, { signature: "stripe webhook failing", message: "402s", autoCreate: true, severity: "sev2" });
    assert.equal(r.ok, true);
    assert.equal(r.result.mappedService, "payments");
    assert.ok(r.result.incident);
    assert.equal(r.result.alert.incidentId, r.result.incident.id);
    assert.equal(r.result.incident.severity, "sev2");

    const alerts = call("alertList", ctxA, {});
    assert.equal(alerts.result.total, 1);
  });

  it("rejects an alert with no signature", () => {
    assert.equal(call("alertIngest", ctxA, {}).ok, false);
  });
});

describe("ops — escalation policy evaluation", () => {
  it("creates a tiered policy and resolves the active tier at a given minutes-open", () => {
    const pol = call("policyCreate", ctxA, {
      name: "Critical chain",
      tiers: [
        { afterMinutes: 0, target: "primary", channel: "push" },
        { afterMinutes: 10, target: "secondary", channel: "sms" },
        { afterMinutes: 30, target: "lead", channel: "email" },
      ],
    }).result.policy;
    assert.equal(pol.tiers.length, 3);

    const ev = call("policyEvaluate", ctxA, { policyId: pol.id, minutesOpen: 15 });
    assert.equal(ev.ok, true);
    assert.equal(ev.result.currentTier.target, "secondary");
    assert.equal(ev.result.nextTier.target, "lead");
    assert.equal(ev.result.nextTierInMinutes, 15);
    assert.equal(ev.result.fullyEscalated, false);
    assert.equal(call("policyList", ctxA, {}).result.total, 1);
  });

  it("rejects a policy with no tiers", () => {
    assert.equal(call("policyCreate", ctxA, { name: "empty" }).ok, false);
  });
});

describe("ops — on-call calendar: gaps + override precedence", () => {
  it("detects a coverage gap between two non-adjacent shifts", () => {
    const base = Date.now();
    call("shiftCreate", ctxA, { responder: "alice", startsAt: new Date(base).toISOString(), endsAt: new Date(base + 3600000).toISOString() });
    call("shiftCreate", ctxA, { responder: "bob", startsAt: new Date(base + 7200000).toISOString(), endsAt: new Date(base + 10800000).toISOString() });
    const cal = call("calendarView", ctxA, { from: new Date(base - 3600000).toISOString(), to: new Date(base + 14400000).toISOString() });
    assert.equal(cal.result.hasGaps, true);
    assert.equal(cal.result.gaps[0].minutes, 60);
  });

  it("an active override wins over the base shift for current on-call", () => {
    const base = Date.now();
    call("shiftCreate", ctxA, { responder: "alice", startsAt: new Date(base - 3600000).toISOString(), endsAt: new Date(base + 3600000).toISOString() });
    call("shiftOverride", ctxA, { responder: "carol", startsAt: new Date(base - 600000).toISOString(), endsAt: new Date(base + 600000).toISOString(), reason: "swap" });
    const cal = call("calendarView", ctxA, {});
    assert.equal(cal.result.currentOnCall, "carol");
    assert.equal(cal.result.currentOnCallSource, "override");
  });

  it("rejects a shift whose endsAt precedes startsAt", () => {
    const r = call("shiftCreate", ctxA, { responder: "x", startsAt: new Date(Date.now() + 3600000).toISOString(), endsAt: new Date(Date.now()).toISOString() });
    assert.equal(r.ok, false);
  });
});

describe("ops — notification dispatch is idempotent on the key", () => {
  it("dispatches a page once, dedupes a re-fire, and links the incident timeline", () => {
    const inc = call("incidentCreate", ctxA, { title: "Outage" }).result.incident;
    const n1 = call("notifyDispatch", ctxA, { incidentId: inc.id, target: "alice", channel: "sms", tier: 1 });
    assert.equal(n1.result.deduped, false);
    const n2 = call("notifyDispatch", ctxA, { incidentId: inc.id, target: "alice", channel: "sms", tier: 1 });
    assert.equal(n2.result.deduped, true);
    assert.equal(call("notifyList", ctxA, {}).result.total, 1);

    // the page is threaded into the incident timeline
    const refreshed = call("incidentList", ctxA, {}).result.incidents.find((i) => i.id === inc.id);
    assert.ok(refreshed.timeline.some((t) => t.event === "notified"));
    assert.equal(call("notifyDispatch", ctxA, {}).ok, false);
  });
});

describe("ops — service directory dependency graph + blast radius", () => {
  it("builds edges and resolves the transitive blast radius", () => {
    const db = call("serviceCreate", ctxA, { name: "database", tier: "critical" }).result.service;
    const api = call("serviceCreate", ctxA, { name: "api", dependsOn: [db.id] }).result.service;
    call("serviceCreate", ctxA, { name: "web", dependsOn: [api.id] });
    assert.equal(call("serviceList", ctxA, {}).result.total, 3);

    const g = call("serviceGraph", ctxA, { rootServiceId: db.id });
    assert.equal(g.result.edges.length, 2);
    assert.equal(g.result.blastRadius.impactedCount, 2);
    assert.deepEqual(g.result.blastRadius.impacted.sort(), ["api", "web"]);
    assert.equal(call("serviceCreate", ctxA, {}).ok, false);
  });
});

describe("ops — MTTA / MTTR analytics over resolved incidents", () => {
  it("computes counts, MTTA, MTTR, and a per-severity breakdown", () => {
    const id = call("incidentCreate", ctxA, { title: "Slow", severity: "sev2" }).result.incident.id;
    call("incidentTransition", ctxA, { incidentId: id, to: "acknowledged" });
    call("incidentTransition", ctxA, { incidentId: id, to: "resolved" });
    const a = call("analytics", ctxA, {});
    assert.equal(a.ok, true);
    assert.equal(a.result.totalIncidents, 1);
    assert.equal(a.result.resolvedIncidents, 1);
    assert.equal(typeof a.result.mttrMinutes, "number");
    assert.ok(a.result.bySeverity.sev2);
    assert.equal(a.result.bySeverity.sev2.resolved, 1);
    assert.ok(Array.isArray(a.result.weeklyTrend));
  });
});

describe("ops — public status page derivation", () => {
  it("reports operational with no incidents and degrades on an open sev1", () => {
    const svc = call("serviceCreate", ctxA, { name: "core" }).result.service;
    let r = call("statusPage", ctxA, {});
    assert.equal(r.result.overall, "all_systems_operational");
    assert.equal(r.result.components.length, 1);

    call("incidentCreate", ctxA, { title: "Outage", severity: "sev1", serviceId: svc.id });
    r = call("statusPage", ctxA, {});
    assert.equal(r.result.overall, "major_outage");
    assert.equal(r.result.components[0].status, "major_outage");
    assert.equal(r.result.activeIncidentCount, 1);
  });
});

describe("ops — per-user isolation", () => {
  it("never leaks one user's incidents/services to another", () => {
    call("incidentCreate", ctxA, { title: "A-only" });
    call("serviceCreate", ctxA, { name: "a-svc" });
    assert.equal(call("incidentList", ctxA, {}).result.total, 1);
    assert.equal(call("incidentList", ctxB, {}).result.total, 0);
    assert.equal(call("serviceList", ctxB, {}).result.total, 0);
    assert.equal(call("statusPage", ctxB, {}).result.components.length, 0);
  });
});

describe("ops — fail-CLOSED numeric guard (assassin V2)", () => {
  it("rejects poisoned numeric inputs instead of clamping to ok:true", () => {
    for (const bad of [NaN, Infinity, -1, 1e308]) {
      assert.equal(call("escalationCheck", ctxA, { severity: "sev2", minutesOpen: bad }).ok, false, `escalationCheck minutesOpen=${bad}`);
      assert.equal(call("alertList", ctxA, { limit: bad }).ok, false, `alertList limit=${bad}`);
      assert.equal(call("analytics", ctxA, { sinceDays: bad }).ok, false, `analytics sinceDays=${bad}`);
      assert.equal(call("notifyDispatch", ctxA, { target: "x", tier: bad }).ok, false, `notifyDispatch tier=${bad}`);
      const pol = call("policyCreate", ctxA, { name: "P", tiers: [{ afterMinutes: bad, target: "a" }] });
      assert.equal(pol.ok, false, `policyCreate tier afterMinutes=${bad}`);
    }
  });

  it("still honours valid numeric inputs", () => {
    assert.equal(call("escalationCheck", ctxA, { severity: "sev2", minutesOpen: 20 }).ok, true);
    assert.equal(call("alertList", ctxA, { limit: 10 }).ok, true);
    assert.equal(call("analytics", ctxA, { sinceDays: 30 }).ok, true);
  });
});
