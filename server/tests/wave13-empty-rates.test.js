// Empty samples used to report 100%. A rate is a measurement only when
// the sample has at least one record.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { measuredPercent } from "../lib/measured-rate.js";
import registerLogisticsActions from "../domains/logistics.js";
import registerConstructionActions from "../domains/construction.js";
import registerHouseholdActions from "../domains/household.js";
import registerHRActions from "../domains/hr.js";
import registerRetailActions from "../domains/retail.js";
import registerPrivacyActions from "../domains/privacy.js";

function bind(registerFn) {
  const actions = new Map();
  registerFn((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
  return (key, data = {}, params = {}) => {
    const fn = actions.get(key);
    assert.ok(fn, `${key} not registered`);
    return fn(ctx, { id: null, data, meta: {} }, params);
  };
}

const ctx = { actor: { userId: "u" }, userId: "u" };

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("measuredPercent", () => {
  it("refuses a rate over an empty sample", () => {
    assert.deepEqual(measuredPercent(0, 100), { value: null, reason: "no_sample" });
    assert.deepEqual(measuredPercent(2, 50), { value: 50, reason: null });
  });
});

describe("empty-sample rates stay unmeasured", () => {
  const logistics = bind(registerLogisticsActions);
  const construction = bind(registerConstructionActions);
  const household = bind(registerHouseholdActions);
  const hr = bind(registerHRActions);
  const retail = bind(registerRetailActions);
  const privacy = bind(registerPrivacyActions);

  it("logistics complianceAudit does not call zero shipments compliant", () => {
    const r = logistics("logistics.complianceAudit", { shipments: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.shipmentsAudited, 0);
    assert.equal(r.result.complianceRate, null);
    assert.equal(r.result.reason, "no_sample");
  });

  it("logistics inventoryAudit does not call zero SKUs accurate", () => {
    const r = logistics("logistics.inventoryAudit", { inventoryRecords: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSkus, 0);
    assert.equal(r.result.accuracyRate, null);
    assert.equal(r.result.reason, "no_sample");
  });

  it("logistics dashboard on-time percent is null with no delivered ETAs", () => {
    const r = logistics("logistics.dashboard-summary");
    assert.equal(r.ok, true);
    assert.equal(r.result.totalShipments, 0);
    assert.equal(r.result.onTimePct, null);
    assert.equal(r.result.onTimeReason, "no_sample");
  });

  it("construction safetyCompliance does not invent a checklist item", () => {
    const r = construction("construction.safetyCompliance", {});
    assert.equal(r.ok, true);
    assert.equal(r.result.complianceRate, null);
    assert.equal(r.result.rating, null);
    assert.equal(r.result.reason, "no_sample");
    assert.deepEqual(r.result.checklistResults, { passed: 0, failed: 0, total: 0 });
  });

  it("household cleanliness is null when there are no chores", () => {
    const r = household("household.household-dashboard");
    assert.equal(r.ok, true);
    assert.equal(r.result.tasks, 0);
    assert.equal(r.result.cleanlinessPct, null);
    assert.equal(r.result.cleanlinessReason, "no_sample");
  });

  it("hr compliance and I-9 percents are null with no employees", () => {
    const compliance = hr("hr.compliance-status");
    assert.equal(compliance.ok, true);
    assert.equal(compliance.result.totalRequired, 0);
    assert.equal(compliance.result.compliancePct, null);
    assert.equal(compliance.result.reason, "no_sample");
    const i9 = hr("hr.i9-status");
    assert.equal(i9.ok, true);
    assert.equal(i9.result.activeEmployees, 0);
    assert.equal(i9.result.compliancePct, null);
    assert.equal(i9.result.reason, "no_sample");
  });

  it("retail SLA and ticket compliance are null with no resolved sample", () => {
    const sla = retail("retail.slaStatus", { incidents: [] });
    assert.equal(sla.ok, true);
    assert.equal(sla.result.totalIncidents, 0);
    assert.equal(sla.result.complianceRate, null);
    assert.equal(sla.result.tier, null);
    assert.equal(sla.result.reason, "no_sample");
    const tickets = retail("retail.tickets-list");
    assert.equal(tickets.ok, true);
    assert.equal(tickets.result.rollup.resolvedCount, 0);
    assert.equal(tickets.result.rollup.complianceRate, null);
    assert.equal(tickets.result.rollup.reason, "no_sample");
  });

  it("privacy consentAudit does not call a missing book current", () => {
    const r = privacy("privacy.consentAudit", { consents: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.complianceRate, null);
    assert.equal(r.result.reason, "no_sample");
    assert.equal(r.result.action, "No consents recorded");
  });
});
