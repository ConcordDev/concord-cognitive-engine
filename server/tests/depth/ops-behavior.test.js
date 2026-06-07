// tests/depth/ops-behavior.test.js — REAL behavioral tests (ops / SRE incident-mgmt lens-actions).
//
// ops is a PagerDuty-shaped lens registered via registerLensAction("ops", …),
// so every macro dispatches through lens.run and the harness `lensRun` invoker.
// lens.run UNWRAPS a handler's { ok, result }: on success `r.ok === true` and
// `r.result.<field>` is the handler payload; on a handler rejection the handler
// returns `{ ok:false, error }` (no `result` key) so lens.run surfaces it as
// `r.result.ok === false` + `r.result.error`.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("ops — pure calc macros (no state)", () => {
  it("escalationCheck: sev1 open 6m breaches the 5m threshold", async () => {
    const r = await lensRun("ops", "escalationCheck", { params: { severity: "sev1", minutesOpen: 6 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.thresholdMinutes, 5);
    assert.equal(r.result.breached, true);
    assert.match(String(r.result.recommendation), /Escalate now/);
  });

  it("escalationCheck: sev3 open 10m is within the 60m window (not breached)", async () => {
    const r = await lensRun("ops", "escalationCheck", { params: { severity: "sev3", minutesOpen: 10 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.thresholdMinutes, 60);
    assert.equal(r.result.breached, false);
    // re-check window = ceil((60-10)/2) = 25m
    assert.match(String(r.result.recommendation), /re-check in 25m/);
  });

  it("pageOnCall: resolves the slot covering the queried UTC hour", async () => {
    const r = await lensRun("ops", "pageOnCall", {
      params: {
        rotation: [
          { user: "alice", startHour: 0, endHour: 12 },
          { user: "bob", startHour: 12, endHour: 24 },
        ],
        now: "2026-06-07T14:00:00Z", // hour 14 → bob's 12–24 slot
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.currentUtcHour, 14);
    assert.equal(r.result.current, "bob");
    assert.equal(r.result.rotationSize, 2);
  });

  it("runbookLookup: rejects when no alert signature supplied", async () => {
    const r = await lensRun("ops", "runbookLookup", { params: { runbooks: [{ alertPattern: "cpu" }] } });
    // handler returns { ok:false } directly → surfaced through r.result
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /alert required/i);
  });

  it("postmortemDraft: computes durationMin from the start/resolve window", async () => {
    const r = await lensRun("ops", "postmortemDraft", {
      params: {
        startedAt: "2026-06-07T00:00:00Z",
        resolvedAt: "2026-06-07T01:30:00Z", // 90 minutes
        severity: "sev2",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.durationMin, 90);
    assert.equal(r.result.severity, "sev2");
    assert.ok(r.result.sections.some((sec) => sec.name === "root_cause"));
  });
});

describe("ops — incident lifecycle (state round-trips)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("ops-incidents"); });

  it("incidentCreate: rejects an empty title", async () => {
    const r = await lensRun("ops", "incidentCreate", { params: { title: "   " } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /title required/i);
  });

  it("incidentCreate → incidentTransition: triggered → acknowledged → resolved is valid; stamps timestamps", async () => {
    const created = await lensRun("ops", "incidentCreate", { params: { title: "DB latency spike", severity: "sev1" } }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.incident.id;
    assert.equal(created.result.incident.status, "triggered");
    assert.equal(created.result.incident.severity, "sev1");

    const ack = await lensRun("ops", "incidentTransition", { params: { incidentId: id, to: "acknowledged" } }, ctx);
    assert.equal(ack.ok, true);
    assert.equal(ack.result.incident.status, "acknowledged");
    assert.ok(ack.result.incident.acknowledgedAt, "acknowledgedAt stamped");

    const res = await lensRun("ops", "incidentTransition", { params: { incidentId: id, to: "resolved" } }, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.result.incident.status, "resolved");
    assert.ok(res.result.incident.resolvedAt, "resolvedAt stamped");
    // timeline accreted: triggered + acknowledged + resolved
    assert.ok(res.result.incident.timeline.some((t) => t.event === "acknowledged"));
    assert.ok(res.result.incident.timeline.some((t) => t.event === "resolved"));
  });

  it("incidentTransition: rejects an illegal state-machine hop (triggered → triggered)", async () => {
    const created = await lensRun("ops", "incidentCreate", { params: { title: "bad transition probe" } }, ctx);
    const id = created.result.incident.id;
    const bad = await lensRun("ops", "incidentTransition", { params: { incidentId: id, to: "triggered" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /invalid transition/i);
  });

  it("incidentList: filters by status and reports the open count", async () => {
    const r = await lensRun("ops", "incidentList", { params: { status: "resolved" } }, ctx);
    assert.equal(r.ok, true);
    // exactly the one we resolved above is in this owner-scoped store
    assert.ok(r.result.incidents.every((i) => i.status === "resolved"));
    assert.equal(r.result.total, r.result.incidents.length);
    assert.equal(typeof r.result.open, "number");
  });
});

describe("ops — escalation policy evaluation", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("ops-policy"); });

  it("policyCreate: rejects a policy with no tiers", async () => {
    const r = await lensRun("ops", "policyCreate", { params: { name: "empty", tiers: [] } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /at least one tier/i);
  });

  it("policyEvaluate: at 20m open, the 0m + 10m tiers have fired and the 30m tier is next", async () => {
    const created = await lensRun("ops", "policyCreate", {
      params: {
        name: "tiered chain",
        tiers: [
          { afterMinutes: 0, target: "oncall", channel: "push" },
          { afterMinutes: 10, target: "secondary", channel: "sms" },
          { afterMinutes: 30, target: "lead", channel: "email" },
        ],
      },
    }, ctx);
    assert.equal(created.ok, true);
    const policyId = created.result.policy.id;
    assert.equal(created.result.policy.tiers.length, 3);

    const ev = await lensRun("ops", "policyEvaluate", { params: { policyId, minutesOpen: 20 } }, ctx);
    assert.equal(ev.ok, true);
    assert.equal(ev.result.firedCount, 2);
    assert.equal(ev.result.currentTier.target, "secondary");
    assert.equal(ev.result.nextTier.target, "lead");
    assert.equal(ev.result.nextTierInMinutes, 10); // 30 - 20
    assert.equal(ev.result.fullyEscalated, false);
  });
});

describe("ops — on-call calendar + overrides", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("ops-calendar"); });

  it("shiftCreate: rejects a shift whose end is not after its start", async () => {
    const r = await lensRun("ops", "shiftCreate", {
      params: { responder: "carol", startsAt: "2026-06-07T10:00:00Z", endsAt: "2026-06-07T09:00:00Z" },
    }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(String(r.result.error), /endsAt must be after startsAt/i);
  });

  it("calendarView: an override covering 'now' wins over the base shift", async () => {
    const now = Date.now();
    const start = new Date(now - 3600_000).toISOString();
    const end = new Date(now + 3600_000).toISOString();
    await lensRun("ops", "shiftCreate", { params: { responder: "base-dave", startsAt: start, endsAt: end } }, ctx);
    await lensRun("ops", "shiftOverride", { params: { responder: "swap-erin", startsAt: start, endsAt: end, reason: "vacation" } }, ctx);

    const view = await lensRun("ops", "calendarView", {
      params: { from: new Date(now - 86400_000).toISOString(), to: new Date(now + 86400_000).toISOString() },
    }, ctx);
    assert.equal(view.ok, true);
    assert.equal(view.result.currentOnCall, "swap-erin");
    assert.equal(view.result.currentOnCallSource, "override");
    assert.ok(view.result.shifts.some((sh) => sh.responder === "base-dave"));
  });
});

describe("ops — service graph, notifications, analytics, status page", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("ops-services"); });

  it("serviceGraph: computes the transitive blast radius of a root service", async () => {
    const api = await lensRun("ops", "serviceCreate", { params: { name: "api", tier: "critical" } }, ctx);
    const apiId = api.result.service.id;
    const web = await lensRun("ops", "serviceCreate", { params: { name: "web", dependsOn: [apiId] } }, ctx);
    const webId = web.result.service.id;
    await lensRun("ops", "serviceCreate", { params: { name: "mobile", dependsOn: [webId] } }, ctx);

    const g = await lensRun("ops", "serviceGraph", { params: { rootServiceId: apiId } }, ctx);
    assert.equal(g.ok, true);
    assert.equal(g.result.serviceCount, 3);
    // web depends on api directly, mobile depends on web → both transitively impacted
    assert.equal(g.result.blastRadius.impactedCount, 2);
    assert.ok(g.result.blastRadius.impacted.includes("web"));
    assert.ok(g.result.blastRadius.impacted.includes("mobile"));
  });

  it("notifyDispatch: is idempotent on the derived idempotency key", async () => {
    const first = await lensRun("ops", "notifyDispatch", { params: { incidentId: "inc-x", target: "pager@x", channel: "sms", tier: 1 } }, ctx);
    assert.equal(first.ok, true);
    assert.equal(first.result.deduped, false);
    const dup = await lensRun("ops", "notifyDispatch", { params: { incidentId: "inc-x", target: "pager@x", channel: "sms", tier: 1 } }, ctx);
    assert.equal(dup.ok, true);
    assert.equal(dup.result.deduped, true);
    assert.equal(dup.result.notification.id, first.result.notification.id);
  });

  it("analytics: computes MTTR over a resolved incident in a fresh owner store", async () => {
    const ac = await depthCtx("ops-analytics");
    const created = await lensRun("ops", "incidentCreate", { params: { title: "mttr probe", severity: "sev2" } }, ac);
    const id = created.result.incident.id;
    await lensRun("ops", "incidentTransition", { params: { incidentId: id, to: "acknowledged" } }, ac);
    await lensRun("ops", "incidentTransition", { params: { incidentId: id, to: "resolved" } }, ac);

    const a = await lensRun("ops", "analytics", { params: { sinceDays: 30 } }, ac);
    assert.equal(a.ok, true);
    assert.equal(a.result.totalIncidents, 1);
    assert.equal(a.result.resolvedIncidents, 1);
    assert.equal(a.result.bySeverity.sev2.resolved, 1);
    // create→resolve is near-instant in test → MTTR rounds to 0 minutes, but the field is computed
    assert.equal(typeof a.result.mttrMinutes, "number");
  });

  it("statusPage: a sev1 open incident drives the component to major_outage and overall posture", async () => {
    const sc = await depthCtx("ops-status");
    const svc = await lensRun("ops", "serviceCreate", { params: { name: "checkout", tier: "critical" } }, sc);
    const svcId = svc.result.service.id;
    await lensRun("ops", "incidentCreate", { params: { title: "checkout down", severity: "sev1", serviceId: svcId } }, sc);

    const page = await lensRun("ops", "statusPage", {}, sc);
    assert.equal(page.ok, true);
    const comp = page.result.components.find((c) => c.id === svcId);
    assert.equal(comp.status, "major_outage");
    assert.equal(page.result.overall, "major_outage");
    assert.equal(page.result.activeIncidentCount, 1);
  });
});
