// server/tests/supplychain-org-collab.test.js
//
// Role-based collaboration (planner / buyer / analyst) for the supplychain
// lens. WAVE4_INVENTORY.md flagged this as needing new substrate; it
// doesn't — server/lib/world-organizations.js already has a real
// org/roster/role primitive. This is additive: every existing state-bearing
// macro must stay byte-identical to its per-user behavior when no `orgId`
// is supplied (see supplychain-lens-macros.test.js's "per-user isolation"
// case, unchanged and still passing). Here we pin the NEW org-scoped path:
// membership verification, role-derived write gating, and shared org state.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSupplychainActions from "../domains/supplychain.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }

function unwrapEnvelope(r) {
  if (r && typeof r === "object" && "ok" in r && "result" in r) return r.result;
  return r;
}

function dispatch(action, ctx, input = {}) {
  const fn = ACTIONS.get(`supplychain.${action}`);
  if (!fn) throw new Error(`supplychain.${action} not registered`);
  const rest = peelRedundantArtifactWrapper(input && typeof input === "object" ? input : {});
  const virtualArtifact = { id: null, domain: "supplychain", type: "domain_action", data: rest, meta: {} };
  const raw = fn(ctx, virtualArtifact, rest);
  return unwrapEnvelope(raw);
}

before(() => { registerSupplychainActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = (userId) => ({ actor: { userId }, userId });
const leader = ctx("sc_leader");
const memberUser = ctx("sc_member");
const apprenticeUser = ctx("sc_apprentice");
const outsider = ctx("sc_outsider");

function makeOrg() {
  const created = dispatch("orgCreate", leader, { name: "Acme Logistics", type: "firm" });
  assert.equal(created.organization ? true : false, true, "orgCreate must return an organization");
  return created.organization.id;
}

describe("supplychain org lifecycle wrappers (thin over world-organizations.js)", () => {
  it("orgCreate: leader gets planner SC role on their own firm", () => {
    const r = dispatch("orgCreate", leader, { name: "Test Firm", type: "firm" });
    assert.equal(r.organization.type, "firm");
    assert.equal(r.organization.leaderId, "sc_leader");
    assert.equal(r.role, "planner");
    assert.equal(r.orgRole, "leader");
  });

  it("orgCreate: rejects a non-business org type by falling back to firm (SC lens only offers firm/department)", () => {
    const r = dispatch("orgCreate", leader, { name: "Not A Guild", type: "guild" });
    assert.equal(r.organization.type, "firm");
  });

  it("orgCreate: name is required", () => {
    const r = dispatch("orgCreate", leader, { type: "firm" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "name_required");
  });

  it("orgJoin: a joiner can only self-select member or apprentice, never a privileged role", () => {
    const orgId = makeOrg();
    const asOfficer = dispatch("orgJoin", memberUser, { orgId, role: "officer" });
    // "officer" is not in the allow-list (member|apprentice) so it silently
    // downgrades to member rather than granting a privileged role.
    assert.equal(asOfficer.role, "member");
    assert.equal(asOfficer.scRole, "buyer");
  });

  it("orgJoin: apprentice role is honored (self-selectable, lowest privilege)", () => {
    const orgId = makeOrg();
    const r = dispatch("orgJoin", apprenticeUser, { orgId, role: "apprentice" });
    assert.equal(r.role, "apprentice");
    assert.equal(r.scRole, "analyst");
  });

  it("orgMembers: roster shows every member with their derived scRole", () => {
    const orgId = makeOrg();
    dispatch("orgJoin", memberUser, { orgId });
    dispatch("orgJoin", apprenticeUser, { orgId, role: "apprentice" });
    const r = dispatch("orgMembers", leader, { orgId });
    assert.equal(r.organization.id, orgId);
    const byUser = Object.fromEntries(r.members.map(m => [m.userId, m]));
    assert.equal(byUser.sc_leader.role, "leader");
    assert.equal(byUser.sc_leader.scRole, "planner");
    assert.equal(byUser.sc_member.role, "member");
    assert.equal(byUser.sc_member.scRole, "buyer");
    assert.equal(byUser.sc_apprentice.role, "apprentice");
    assert.equal(byUser.sc_apprentice.scRole, "analyst");
    assert.equal(r.myRole, "planner");
  });

  it("orgMembers: a non-member is refused (roster is not publicly readable)", () => {
    const orgId = makeOrg();
    const r = dispatch("orgMembers", outsider, { orgId });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_a_member");
  });

  it("orgMembers: unknown orgId is an honest org_not_found, not a crash", () => {
    const r = dispatch("orgMembers", leader, { orgId: "org_does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "org_not_found");
  });

  it("orgSetRole: only the planner class (leader/officer) may promote a member", () => {
    const orgId = makeOrg();
    dispatch("orgJoin", memberUser, { orgId });
    // Leader promotes member -> planner (translated to "officer").
    const r = dispatch("orgSetRole", leader, { orgId, targetUserId: "sc_member", role: "planner" });
    assert.equal(r.role, "officer");
    assert.equal(r.scRole, "planner");
  });

  it("orgSetRole: a buyer (member) cannot change anyone's role", () => {
    const orgId = makeOrg();
    dispatch("orgJoin", memberUser, { orgId });
    dispatch("orgJoin", apprenticeUser, { orgId, role: "apprentice" });
    const r = dispatch("orgSetRole", memberUser, { orgId, targetUserId: "sc_apprentice", role: "buyer" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_rank");
  });

  it("orgMine: lists the orgs a user actually belongs to, with role + scRole", () => {
    const orgId = makeOrg();
    dispatch("orgJoin", memberUser, { orgId });
    const r = dispatch("orgMine", memberUser, {});
    const found = r.organizations.find(o => o.id === orgId);
    assert.ok(found, "orgMine must include the joined org");
    assert.equal(found.myRole, "member");
    assert.equal(found.myScRole, "buyer");
  });

  it("orgLeave: leader cannot leave their own org (delegates to world-organizations.js's rule)", () => {
    const orgId = makeOrg();
    const r = dispatch("orgLeave", leader, { orgId });
    assert.equal(r.ok, false);
    assert.equal(r.error, "leader_cannot_leave");
  });
});

describe("supplychain role-gated writes on org-shared state", () => {
  function setupOrg() {
    const orgId = makeOrg();
    dispatch("orgJoin", memberUser, { orgId }); // buyer
    dispatch("orgJoin", apprenticeUser, { orgId, role: "apprentice" }); // analyst
    return orgId;
  }

  it("planner (leader) can create + advance work orders in the org", () => {
    const orgId = setupOrg();
    const created = dispatch("workOrderCreate", leader, { orgId, item: "Steel Coil", quantity: 10, unitCost: 20 });
    assert.equal(created.ok !== false, true);
    assert.ok(created.workOrder.id);
    const advanced = dispatch("workOrderAdvance", leader, { orgId, workOrderId: created.workOrder.id, stage: "approved" });
    assert.equal(advanced.workOrder.stage, "approved");
  });

  it("buyer (member) is refused write access to work orders (planner-only)", () => {
    const orgId = setupOrg();
    const r = dispatch("workOrderCreate", memberUser, { orgId, item: "Steel Coil" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_role");
  });

  it("analyst (apprentice) is refused write access to work orders", () => {
    const orgId = setupOrg();
    const r = dispatch("workOrderCreate", apprenticeUser, { orgId, item: "Steel Coil" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_role");
  });

  it("buyer (member) CAN create + checkpoint shipments (buyer scope: suppliers/shipments/purchasing)", () => {
    const orgId = setupOrg();
    const created = dispatch("shipmentCreate", memberUser, { orgId, reference: "SHP-ORG-1", origin: "Shanghai", destination: "Los Angeles" });
    assert.equal(created.ok !== false, true);
    const checkpoint = dispatch("shipmentCheckpoint", memberUser, { orgId, shipmentId: created.shipment.id, status: "in_transit" });
    assert.equal(checkpoint.shipment.status, "in_transit");
  });

  it("planner (leader) can ALSO write shipments (planner has full access, not just buyer scope)", () => {
    const orgId = setupOrg();
    const created = dispatch("shipmentCreate", leader, { orgId, reference: "SHP-ORG-2" });
    assert.equal(created.ok !== false, true);
  });

  it("analyst (apprentice) is refused write access to shipments", () => {
    const orgId = setupOrg();
    const r = dispatch("shipmentCreate", apprenticeUser, { orgId, reference: "SHP-ORG-3" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_role");
  });

  it("analyst (apprentice) CAN read every view (shipmentList, workOrderList, networkGraph, exceptionScan, spendAnalytics)", () => {
    const orgId = setupOrg();
    dispatch("shipmentCreate", leader, { orgId, reference: "SHP-READ" });
    dispatch("workOrderCreate", leader, { orgId, item: "Widget", quantity: 5, unitCost: 3 });
    assert.equal(dispatch("shipmentList", apprenticeUser, { orgId }).shipments.length, 1);
    assert.equal(dispatch("workOrderList", apprenticeUser, { orgId }).workOrders.length, 1);
    assert.doesNotThrow(() => dispatch("networkGraph", apprenticeUser, { orgId }));
    assert.doesNotThrow(() => dispatch("exceptionScan", apprenticeUser, { orgId }));
    assert.doesNotThrow(() => dispatch("spendAnalytics", apprenticeUser, { orgId }));
  });

  it("networkSet (topology) is planner-only", () => {
    const orgId = setupOrg();
    const asBuyer = dispatch("networkSet", memberUser, { orgId, nodes: [{ id: "n1", kind: "supplier" }] });
    assert.equal(asBuyer.ok, false);
    assert.equal(asBuyer.error, "insufficient_role");
    const asPlanner = dispatch("networkSet", leader, { orgId, nodes: [{ id: "n1", kind: "supplier" }] });
    assert.equal(asPlanner.nodeCount, 1);
  });

  it("scenarioSimulate (what-if planning) is planner-only", () => {
    const orgId = setupOrg();
    const asAnalyst = dispatch("scenarioSimulate", apprenticeUser, { orgId, disruption: "port_closure" });
    assert.equal(asAnalyst.ok, false);
    assert.equal(asAnalyst.error, "insufficient_role");
  });

  it("a non-member cannot read or write ANY org-scoped state (not_a_member)", () => {
    const orgId = setupOrg();
    const read = dispatch("shipmentList", outsider, { orgId });
    assert.equal(read.ok, false);
    assert.equal(read.error, "not_a_member");
    const write = dispatch("shipmentCreate", outsider, { orgId, reference: "X" });
    assert.equal(write.ok, false);
    assert.equal(write.error, "not_a_member");
  });

  it("org state is SHARED: a shipment the leader creates is visible to a buyer teammate, and vice versa", () => {
    const orgId = setupOrg();
    dispatch("shipmentCreate", leader, { orgId, reference: "SHARED-A" });
    dispatch("shipmentCreate", memberUser, { orgId, reference: "SHARED-B" });
    const asLeader = dispatch("shipmentList", leader, { orgId });
    const asMember = dispatch("shipmentList", memberUser, { orgId });
    assert.equal(asLeader.shipments.length, 2);
    assert.equal(asMember.shipments.length, 2);
    const refs = asMember.shipments.map(s => s.reference).sort();
    assert.deepEqual(refs, ["SHARED-A", "SHARED-B"]);
  });

  it("org state does NOT bleed into a member's personal (no-orgId) planning state", () => {
    const orgId = setupOrg();
    dispatch("shipmentCreate", leader, { orgId, reference: "ORG-ONLY" });
    dispatch("shipmentCreate", leader, { reference: "PERSONAL-ONLY" }); // no orgId
    const personal = dispatch("shipmentList", leader, {});
    assert.equal(personal.shipments.length, 1);
    assert.equal(personal.shipments[0].reference, "PERSONAL-ONLY");
    const org = dispatch("shipmentList", leader, { orgId });
    assert.equal(org.shipments.length, 1);
    assert.equal(org.shipments[0].reference, "ORG-ONLY");
  });

  it("per-user path (no orgId) is completely unaffected by role gating — still byte-identical", () => {
    // Same assertion shape as supplychain-lens-macros.test.js's own
    // per-user-isolation case, re-pinned here alongside the new org tests
    // so a future edit that breaks the additive contract fails loudly in
    // both places.
    const r = dispatch("workOrderCreate", apprenticeUser, { item: "No org, no gate" });
    assert.equal(r.ok !== false, true);
    assert.ok(r.workOrder.id);
  });
});
