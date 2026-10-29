// server/tests/command-center-web-push-paging.test.js
//
// Q77 (remaining-work audit, founder decision 2026-10-28): SMS/Twilio paging
// is DECLINED — command-center paging rides Web Push only. This pins the
// wiring in server/domains/commandcenter.js:
//   - an alert-rule fire pages the resolved on-call operator (org scope)
//     or the rule owner (solo scope) via pageViaPush -> lib/push.js#sendPush
//   - opening an incident pages the on-call operator stamped at open time
//   - no schedule resolved -> nobody is paged, the macro still succeeds
//   - paging is best-effort: a throwing push sender never breaks a macro
//
// The push sender is captured through the globalThis._concordSendPush hook
// (same pattern as _concordRealtimeEmit), so no push provider, VAPID keys,
// or network are involved.
//
// Run: node --test server/tests/command-center-web-push-paging.test.js

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

const _orgDb = new Database(":memory:");
upWorldOrgs(_orgDb);

let pages;
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis._concordRealtimeEmit = undefined;
  pages = [];
  globalThis._concordSendPush = (_db, payload) => { pages.push(payload); return Promise.resolve({ ok: true, sent: 1 }); };
});

const ctxOf = (userId) => ({ actor: { userId }, userId, db: _orgDb });
const lead = ctxOf("cc_lead");
const responder = ctxOf("cc_responder");

function makeStaffedTeamWithSchedule() {
  const orgId = call("teamCreate", lead, { name: "SRE On-Call" }).result.team.id;
  assert.equal(call("teamJoin", responder, { orgId }).ok, true);
  assert.equal(call("teamSetRole", lead, { orgId, userId: "cc_responder", tier: "responder" }).ok, true);
  // Responder is first in the rotation and the schedule starts now, so the
  // deterministic resolver must pick cc_responder as on-call.
  const sched = call("onCallScheduleSet", lead, {
    orgId, members: ["cc_responder", "cc_lead"], shiftHours: 24, startAt: new Date(Date.now() - 60000).toISOString(),
  });
  assert.equal(sched.ok, true);
  assert.equal(sched.result.onCallNow.userId, "cc_responder");
  return orgId;
}

describe("command-center Web Push paging (Q77)", () => {
  it("an org alert fire pages the resolved on-call operator", () => {
    const orgId = makeStaffedTeamWithSchedule();
    const rule = call("createAlertRule", lead, { orgId, name: "CPU burn", metric: "cpu", comparator: "gt", threshold: 90, severity: "critical" });
    assert.equal(rule.ok, true);
    pages = [];
    const r = call("recordVital", responder, { orgId, metric: "cpu", value: 97 });
    assert.equal(r.ok, true);
    assert.equal(r.result.rulesFired.length, 1);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].userId, "cc_responder");
    assert.match(pages[0].title, /CPU burn/);
    assert.equal(pages[0].data.kind, "command-center-alert");
  });

  it("a solo alert fire pages the rule owner", () => {
    const solo = ctxOf("cc_solo");
    const rule = call("createAlertRule", solo, { name: "Disk", metric: "disk", comparator: "gte", threshold: 95 });
    assert.equal(rule.ok, true);
    pages = [];
    const r = call("recordVital", solo, { metric: "disk", value: 96 });
    assert.equal(r.ok, true);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].userId, "cc_solo");
  });

  it("opening an incident pages the on-call operator stamped at open time", () => {
    const orgId = makeStaffedTeamWithSchedule();
    pages = [];
    const r = call("openIncident", lead, { orgId, title: "API 5xx spike", severity: "high" });
    assert.equal(r.ok, true);
    assert.equal(r.result.incident.onCallAt, "cc_responder");
    assert.equal(pages.length, 1);
    assert.equal(pages[0].userId, "cc_responder");
    assert.equal(pages[0].data.kind, "command-center-incident");
    assert.equal(pages[0].data.incidentId, r.result.incident.id);
  });

  it("an incident with no schedule pages nobody and still opens", () => {
    const orgId = call("teamCreate", lead, { name: "No Schedule Team" }).result.team.id;
    pages = [];
    const r = call("openIncident", lead, { orgId, title: "Quiet incident" });
    assert.equal(r.ok, true);
    assert.equal(r.result.incident.onCallAt, null);
    assert.equal(pages.length, 0);
  });

  it("paging is best-effort: a throwing push sender never breaks the macro", () => {
    globalThis._concordSendPush = () => { throw new Error("push provider down"); };
    const solo = ctxOf("cc_solo2");
    assert.equal(call("createAlertRule", solo, { name: "Mem", metric: "mem", comparator: "gt", threshold: 10 }).ok, true);
    const r = call("recordVital", solo, { metric: "mem", value: 50 });
    assert.equal(r.ok, true);
    assert.equal(r.result.rulesFired.length, 1);
  });
});
