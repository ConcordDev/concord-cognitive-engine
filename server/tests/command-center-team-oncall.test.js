// server/tests/command-center-team-oncall.test.js
//
// WAVE4 (command-center): re-scopes the ops cockpit substrate from
// per-operator to optionally ORG-SHARED, plus a real on-call rotation. This
// pins the ADDITIVE org-scoped path on top of server/domains/commandcenter.js
// (mirrors the lab/supplychain Wave-3 units' pattern — server/lib/
// world-organizations.js is CONSUMED, never modified):
//   - lead (leader/officer) can do everything, incl. manage roster + set
//     the on-call schedule
//   - responder (member) can read+write incidents/alerts/vitals/dashboards/
//     runbooks, but cannot manage the roster or the on-call schedule
//   - observer (apprentice) is read-only everywhere
// and pins that the pre-existing per-operator path is byte-identical when
// no orgId is supplied (command-center-domain-parity.test.js, unchanged and
// still passing).
//
// Also pins the on-call rotation resolver: deterministic wall-clock ->
// roster-member resolution, no fabrication, honest empty/unstarted states.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCommandCenterActions from "../domains/commandcenter.js";
import { up as upWorldOrgs } from "../migrations/383_world_organizations.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, data = {}) {
  const fn = ACTIONS.get(`command-center.${name}`);
  assert.ok(fn, `command-center.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => { registerCommandCenterActions(register); });

// Organizations are now DB-backed (durability fix — see
// lib/world-organizations.js's header comment); the macros read/write
// through `ctx.db`. One in-memory db for the whole file — every test mints
// a fresh org id via teamCreate so there's no cross-test bleed.
const _orgDb = new Database(":memory:");
upWorldOrgs(_orgDb);

beforeEach(() => {
  // Fresh STATE per test so per-operator AND org-shared Maps don't leak
  // between cases (org membership itself lives in world-organizations.js's
  // DB-backed tables, which are NOT reset here — every test mints a fresh
  // org id via teamCreate so there's no cross-test bleed there either).
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis._concordRealtimeEmit = undefined;
});

const ctxOf = (userId) => ({ actor: { userId }, userId, db: _orgDb });
const lead = ctxOf("cc_lead");
const responder = ctxOf("cc_responder");
const observer = ctxOf("cc_observer");
const outsider = ctxOf("cc_outsider");

function makeTeam() {
  const r = call("teamCreate", lead, { name: "SRE On-Call" });
  assert.equal(r.ok, true, "teamCreate must succeed");
  return r.result.team.id;
}

function makeStaffedTeam() {
  const orgId = makeTeam();
  const joinResponder = call("teamJoin", responder, { orgId });
  assert.equal(joinResponder.ok, true);
  const setResponder = call("teamSetRole", lead, { orgId, userId: "cc_responder", tier: "responder" });
  assert.equal(setResponder.ok, true, "lead must be able to promote a joiner to responder");
  const joinObserver = call("teamJoin", observer, { orgId });
  assert.equal(joinObserver.ok, true); // stays apprentice/observer by default
  return orgId;
}

describe("command-center team lifecycle (thin wrapper over world-organizations.js)", () => {
  it("teamCreate: caller becomes leader / lead tier on a type:department org", () => {
    const r = call("teamCreate", lead, { name: "Platform SRE", description: "prod on-call" });
    assert.equal(r.ok, true);
    assert.equal(r.result.team.type, "department");
    assert.equal(r.result.team.leaderId, "cc_lead");
    assert.equal(r.result.tier, "lead");
  });

  it("teamCreate: rejects a missing name", () => {
    const r = call("teamCreate", lead, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "team_name_required");
  });

  it("teamJoin: self-service join always enters at observer tier, never self-elevates", () => {
    const orgId = makeTeam();
    const r = call("teamJoin", responder, { orgId });
    assert.equal(r.ok, true);
    assert.equal(r.result.tier, "observer");
    assert.equal(r.result.orgRole, "apprentice");
  });

  it("teamJoin: rejects an unknown org id honestly", () => {
    const r = call("teamJoin", responder, { orgId: "org_does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "org_not_found");
  });

  it("teamListMine: lists only the caller's teams, with tier", () => {
    const orgId = makeTeam();
    call("teamJoin", responder, { orgId });
    const mine = call("teamListMine", responder, {});
    assert.equal(mine.ok, true);
    const found = mine.result.teams.find((t) => t.orgId === orgId);
    assert.ok(found, "teamListMine must include the joined team");
    assert.equal(found.tier, "observer");
    const leadMine = call("teamListMine", lead, {});
    assert.equal(leadMine.result.teams.find((t) => t.orgId === orgId).tier, "lead");
  });

  it("teamListMine: an outsider sees no teams", () => {
    makeTeam();
    const r = call("teamListMine", outsider, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });

  it("teamSetRole: only lead (leader/officer) may promote/demote a member", () => {
    const orgId = makeStaffedTeam();
    const r = call("teamSetRole", lead, { orgId, userId: "cc_observer", tier: "responder" });
    assert.equal(r.ok, true);
    assert.equal(r.result.orgRole, "member");
    assert.equal(r.result.tier, "responder");
  });

  it("teamSetRole: a responder cannot change anyone's role", () => {
    const orgId = makeStaffedTeam();
    const r = call("teamSetRole", responder, { orgId, userId: "cc_observer", tier: "lead" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_role");
  });

  it("teamSetRole: rejects an unknown tier", () => {
    const orgId = makeStaffedTeam();
    const r = call("teamSetRole", lead, { orgId, userId: "cc_responder", tier: "wizard" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "tier_must_be_lead_responder_or_observer");
  });

  it("teamMembers: roster shows every member with derived tier; a non-member is refused", () => {
    const orgId = makeStaffedTeam();
    const roster = call("teamMembers", lead, { orgId });
    assert.equal(roster.ok, true);
    const byUser = Object.fromEntries(roster.result.members.map((m) => [m.userId, m]));
    assert.equal(byUser.cc_lead.tier, "lead");
    assert.equal(byUser.cc_responder.tier, "responder");
    assert.equal(byUser.cc_observer.tier, "observer");

    const outsiderView = call("teamMembers", outsider, { orgId });
    assert.equal(outsiderView.ok, false);
    assert.equal(outsiderView.error, "not_a_member");
  });

  it("teamLeave: the founding leader cannot leave their own team", () => {
    const orgId = makeTeam();
    const r = call("teamLeave", lead, { orgId });
    assert.equal(r.ok, false);
  });
});

describe("command-center org-scoped writes are role-gated (lead/responder write, observer read-only)", () => {
  it("lead and responder can record vitals + create alert rules in the shared team scope", () => {
    const orgId = makeStaffedTeam();
    const rec = call("recordVital", responder, { orgId, metric: "error_rate", value: 12 });
    assert.equal(rec.ok, true, "responder must be able to write shared vitals");
    assert.equal(rec.result.scope, "org");

    const rule = call("createAlertRule", lead, { orgId, name: "Error spike", metric: "error_rate", comparator: "gt", threshold: 10, severity: "high" });
    assert.equal(rule.ok, true, "lead must be able to write shared alert rules");
  });

  it("observer cannot write vitals, alert rules, incidents, dashboards, or runbooks", () => {
    const orgId = makeStaffedTeam();
    assert.equal(call("recordVital", observer, { orgId, metric: "x", value: 1 }).error, "insufficient_role");
    assert.equal(call("createAlertRule", observer, { orgId, name: "x", metric: "x", threshold: 1 }).error, "insufficient_role");
    assert.equal(call("openIncident", observer, { orgId, title: "nope" }).error, "insufficient_role");
    assert.equal(call("saveDashboard", observer, { orgId, name: "nope" }).error, "insufficient_role");
    assert.equal(call("saveRunbook", observer, { orgId, name: "nope", steps: [{ label: "x" }] }).error, "insufficient_role");
  });

  it("observer CAN read shared vitals, alert rules, incidents, dashboards, runbooks, health rollup", () => {
    const orgId = makeStaffedTeam();
    call("recordVital", lead, { orgId, metric: "cpu", value: 55 });
    call("createAlertRule", lead, { orgId, name: "CPU high", metric: "cpu", comparator: "gt", threshold: 90 });
    call("openIncident", lead, { orgId, title: "seed incident" });
    call("saveDashboard", lead, { orgId, name: "Team view", widgets: [{ type: "panel", id: "cpu" }] });
    call("saveRunbook", lead, { orgId, name: "Restart", steps: [{ label: "restart", action: "noop" }] });

    assert.equal(call("vitalHistory", observer, { orgId, metric: "cpu" }).ok, true);
    assert.equal(call("vitalMetrics", observer, { orgId }).ok, true);
    assert.equal(call("listAlertRules", observer, { orgId }).ok, true);
    assert.equal(call("listIncidents", observer, { orgId }).ok, true);
    assert.equal(call("listDashboards", observer, { orgId }).ok, true);
    assert.equal(call("listRunbooks", observer, { orgId }).ok, true);
    assert.equal(call("healthRollup", observer, { orgId }).ok, true);
    assert.equal(call("correlateVitals", observer, { orgId }).ok, true);
  });

  it("a non-member is refused with not_a_member on every org-scoped macro", () => {
    const orgId = makeStaffedTeam();
    assert.equal(call("vitalHistory", outsider, { orgId, metric: "x" }).error, "not_a_member");
    assert.equal(call("recordVital", outsider, { orgId, metric: "x", value: 1 }).error, "not_a_member");
    assert.equal(call("listAlertRules", outsider, { orgId }).error, "not_a_member");
    assert.equal(call("listIncidents", outsider, { orgId }).error, "not_a_member");
    assert.equal(call("listDashboards", outsider, { orgId }).error, "not_a_member");
    assert.equal(call("listRunbooks", outsider, { orgId }).error, "not_a_member");
  });

  it("rejects an unknown org id honestly on a write macro", () => {
    const r = call("recordVital", lead, { orgId: "org_bogus", metric: "x", value: 1 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "org_not_found");
  });
});

describe("shared incident visibility: org-scoped incident state is visible to a SECOND member", () => {
  it("an incident opened by one member is visible + editable by another member (shared, not per-caller)", () => {
    const orgId = makeStaffedTeam();
    const opened = call("openIncident", responder, { orgId, title: "DB latency spike", severity: "high" });
    assert.equal(opened.ok, true);
    assert.equal(opened.result.incident.openedBy, "cc_responder");

    // lead (a different user) sees the SAME incident via the org-scoped list
    const leadView = call("listIncidents", lead, { orgId });
    assert.equal(leadView.ok, true);
    assert.equal(leadView.result.count, 1);
    assert.equal(leadView.result.incidents[0].id, opened.result.incident.id);

    // and lead can post an update to the SAME incident the responder opened
    const updated = call("updateIncident", lead, { orgId, incidentId: opened.result.incident.id, message: "mitigated", status: "monitoring" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.incident.status, "monitoring");

    // observer sees the update too (read-only)
    const observerView = call("listIncidents", observer, { orgId });
    assert.equal(observerView.result.incidents[0].status, "monitoring");
    assert.equal(observerView.result.incidents[0].updates.length, 2);
  });

  it("broadcasts a real-time event to the org room when an incident opens/updates in team scope", () => {
    const orgId = makeStaffedTeam();
    const events = [];
    globalThis._concordRealtimeEmit = (event, payload, opts) => events.push({ event, payload, opts });

    const opened = call("openIncident", lead, { orgId, title: "Broadcast me" });
    assert.equal(opened.ok, true);
    const openEvt = events.find((e) => e.event === "command-center:incident-opened");
    assert.ok(openEvt, "must emit an incident-opened event");
    assert.equal(openEvt.opts.orgId, orgId);
    assert.equal(openEvt.payload.incident.id, opened.result.incident.id);

    call("updateIncident", lead, { orgId, incidentId: opened.result.incident.id, message: "update", status: "identified" });
    const updateEvt = events.find((e) => e.event === "command-center:incident-updated");
    assert.ok(updateEvt, "must emit an incident-updated event");
  });

  it("does NOT broadcast for the personal (non-org) path", () => {
    const events = [];
    globalThis._concordRealtimeEmit = (event, payload, opts) => events.push({ event, payload, opts });
    call("openIncident", lead, { title: "personal incident, no orgId" });
    assert.equal(events.length, 0, "personal-scope incidents must never fan out to a room");
  });
});

describe("on-call rotation: deterministic wall-clock resolution, no fabrication", () => {
  it("onCallScheduleSet: lead-only, rejects a non-roster member honestly", () => {
    const orgId = makeStaffedTeam();
    const asResponder = call("onCallScheduleSet", responder, { orgId, members: ["cc_lead", "cc_responder"], shiftHours: 24 });
    assert.equal(asResponder.ok, false);
    assert.equal(asResponder.error, "insufficient_role");

    const badMember = call("onCallScheduleSet", lead, { orgId, members: ["cc_lead", "cc_nobody"], shiftHours: 24 });
    assert.equal(badMember.ok, false);
    assert.equal(badMember.error, "unknown_member");
    assert.deepEqual(badMember.members, ["cc_nobody"]);

    const empty = call("onCallScheduleSet", lead, { orgId, members: [] });
    assert.equal(empty.ok, false);
    assert.equal(empty.error, "at_least_one_member_required");
  });

  it("resolves who's on call at exact shift boundaries against a real clock, deterministically", () => {
    const orgId = makeStaffedTeam();
    const startAt = new Date("2026-01-01T00:00:00.000Z").toISOString();
    const set = call("onCallScheduleSet", lead, {
      orgId, members: ["cc_lead", "cc_responder", "cc_observer"], shiftHours: 24, startAt,
    });
    assert.equal(set.ok, true);
    assert.equal(set.result.schedule.members.length, 3);

    // Shift 0: [Jan 1 00:00, Jan 2 00:00) -> cc_lead
    const t0 = call("onCallWho", responder, { orgId, at: "2026-01-01T12:00:00.000Z" });
    assert.equal(t0.ok, true);
    assert.equal(t0.result.onCall.userId, "cc_lead");
    assert.equal(t0.result.onCall.shiftIndex, 0);

    // Shift 1: [Jan 2 00:00, Jan 3 00:00) -> cc_responder
    const t1 = call("onCallWho", observer, { orgId, at: "2026-01-02T00:00:01.000Z" });
    assert.equal(t1.result.onCall.userId, "cc_responder");
    assert.equal(t1.result.onCall.shiftIndex, 1);

    // Shift 3 wraps the 3-person rotation back to cc_lead (3 % 3 === 0)
    const t3 = call("onCallWho", lead, { orgId, at: "2026-01-04T00:00:01.000Z" });
    assert.equal(t3.result.onCall.userId, "cc_lead");
    assert.equal(t3.result.onCall.shiftIndex, 3);

    // Before the schedule starts: honest null, never a guess.
    const before = call("onCallWho", lead, { orgId, at: "2025-12-31T00:00:00.000Z" });
    assert.equal(before.ok, true);
    assert.equal(before.result.onCall, null);
  });

  it("onCallSchedule: read-only for any member, reports current + upcoming shifts", () => {
    const orgId = makeStaffedTeam();
    const startAt = Date.now() - 3600000; // started 1h ago
    call("onCallScheduleSet", lead, { orgId, members: ["cc_lead", "cc_responder"], shiftHours: 24, startAt: new Date(startAt).toISOString() });

    const view = call("onCallSchedule", observer, { orgId });
    assert.equal(view.ok, true);
    assert.ok(view.result.onCallNow);
    assert.equal(view.result.onCallNow.userId, "cc_lead");
    assert.equal(view.result.upcoming.length, 2); // rotation of 2 -> 2 upcoming entries
    assert.equal(view.result.upcoming[0].userId, "cc_lead");
    assert.equal(view.result.upcoming[1].userId, "cc_responder");
  });

  it("onCallSchedule / onCallWho: honest empty state before any schedule is set", () => {
    const orgId = makeStaffedTeam();
    const sched = call("onCallSchedule", lead, { orgId });
    assert.equal(sched.ok, true);
    assert.equal(sched.result.schedule, null);
    assert.equal(sched.result.onCallNow, null);
    assert.deepEqual(sched.result.upcoming, []);

    const who = call("onCallWho", lead, { orgId });
    assert.equal(who.ok, true);
    assert.equal(who.result.onCall, null);
    assert.match(who.result.message, /no on-call schedule/);
  });

  it("shared incident opened in team scope stamps the real resolved on-call operator, not a guess", () => {
    const orgId = makeStaffedTeam();
    call("onCallScheduleSet", lead, {
      orgId, members: ["cc_responder"], shiftHours: 24, startAt: new Date(Date.now() - 1000).toISOString(),
    });
    const opened = call("openIncident", lead, { orgId, title: "paged incident" });
    assert.equal(opened.ok, true);
    assert.equal(opened.result.incident.onCallAt, "cc_responder");
  });

  it("a personal-scope incident (no orgId) never stamps onCallAt", () => {
    const opened = call("openIncident", lead, { title: "personal incident" });
    assert.equal(opened.ok, true);
    assert.equal(opened.result.incident.onCallAt, null);
  });

  it("on-call macros refuse a non-member and require orgId (rotation has no personal analog)", () => {
    const orgId = makeStaffedTeam();
    assert.equal(call("onCallWho", outsider, { orgId }).error, "not_a_member");
    assert.equal(call("onCallSchedule", lead, {}).error, "orgId_required");
    assert.equal(call("onCallWho", lead, {}).error, "orgId_required");
    assert.equal(call("onCallScheduleSet", lead, { members: ["cc_lead"] }).error, "orgId_required");
  });
});

describe("command-center per-operator path is unchanged when no orgId is supplied", () => {
  it("vitals/alerts/incidents/dashboards/runbooks all behave exactly as before — fully isolated per caller", () => {
    assert.equal(call("recordVital", lead, { metric: "heap_mb", value: 100 }).ok, true);
    assert.equal(call("vitalMetrics", responder, {}).result.count, 0, "a second user's personal vitals are empty");
    assert.equal(call("vitalMetrics", lead, {}).result.count, 1);

    const rule = call("createAlertRule", lead, { name: "x", metric: "heap_mb", comparator: "gt", threshold: 1 });
    assert.equal(rule.ok, true);
    assert.equal(call("listAlertRules", responder, {}).result.count, 0);

    const inc = call("openIncident", lead, { title: "personal" });
    assert.equal(inc.ok, true);
    assert.equal(call("listIncidents", responder, {}).result.count, 0);

    const dash = call("saveDashboard", lead, { name: "mine", widgets: [] });
    assert.equal(dash.ok, true);
    assert.equal(call("listDashboards", responder, {}).result.count, 0);

    const rb = call("saveRunbook", lead, { name: "mine", steps: [{ label: "x" }] });
    assert.equal(rb.ok, true);
    assert.equal(call("listRunbooks", responder, {}).result.count, 0);
  });

  it("a personal-scope macro never requires org membership, even for a user who is an observer elsewhere", () => {
    const orgId = makeStaffedTeam();
    // observer is apprentice-tier in the shared team, but their OWN personal
    // vitals are fully theirs to write — no orgId means no gate at all.
    const r = call("recordVital", observer, { metric: "my_metric", value: 1 });
    assert.equal(r.ok, true);
    assert.equal(r.result.scope, "user");
    void orgId;
  });
});
