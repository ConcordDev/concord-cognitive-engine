// server/tests/emergency-services-mutual-aid.test.js
//
// WAVE4 (emergency-services): an agency IS an org (server/lib/
// world-organizations.js) — thin additive wrappers (agency-create/join/
// leave/members/set-role/mine/list) mirroring the supplychain/command-
// center org-collab pattern. On top of that, this pins the genuinely-new
// primitive: real cross-org MUTUAL AID — agency A shares one of its own
// real incidents with agency B (a real record keyed by both org ids), and
// B commits one of ITS OWN real units to help. Both sides see the share +
// the commitment through the shared state; honest failures for
// nonexistent/non-consenting agencies and non-members; the legacy
// per-user CAD path stays byte-identical with no orgId.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEmergencyServicesActions from "../domains/emergencyservices.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`emergency-services.${name}`);
  if (!fn) throw new Error(`emergency-services.${name} not registered`);
  const artifact = { id: null, data: {}, meta: {} };
  return fn(ctx, artifact, params);
}

before(() => { registerEmergencyServicesActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { emergencyServicesLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const chiefA = { actor: { userId: "chief_a" }, userId: "chief_a" };
const responderA = { actor: { userId: "responder_a" }, userId: "responder_a" };
const traineeA = { actor: { userId: "trainee_a" }, userId: "trainee_a" };
const chiefB = { actor: { userId: "chief_b" }, userId: "chief_b" };
const responderB = { actor: { userId: "responder_b" }, userId: "responder_b" };
const outsider = { actor: { userId: "rando" }, userId: "rando" };

function makeAgency(ctx, name) {
  const r = call("agency-create", ctx, { name });
  assert.equal(r.ok !== false, true, "agency-create must succeed");
  return r.result.organization.id;
}

describe("emergency-services agency lifecycle (thin wrappers over world-organizations.js)", () => {
  it("agency-create: creator becomes chief on a real 'department' org", () => {
    const r = call("agency-create", chiefA, { name: "Riverside Fire & EMS" });
    assert.equal(r.result.organization.type, "department");
    assert.equal(r.result.organization.leaderId, "chief_a");
    assert.equal(r.result.role, "chief");
    assert.equal(r.result.orgRole, "leader");
  });

  it("agency-create requires a name", () => {
    const r = call("agency-create", chiefA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "name_required");
  });

  it("agency-join: a joiner can only self-select responder or trainee, never a privileged role", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    const r = call("agency-join", responderA, { orgId, role: "officer" });
    assert.equal(r.result.role, "member");
    assert.equal(r.result.emsRole, "responder");
  });

  it("agency-join: trainee role is self-selectable (lowest privilege)", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    const r = call("agency-join", traineeA, { orgId, role: "apprentice" });
    assert.equal(r.result.role, "apprentice");
    assert.equal(r.result.emsRole, "trainee");
  });

  it("agency-members: roster shows every member with their derived EMS role; non-members refused", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    call("agency-join", responderA, { orgId });
    call("agency-join", traineeA, { orgId, role: "apprentice" });
    const r = call("agency-members", chiefA, { orgId });
    const byUser = Object.fromEntries(r.result.members.map((m) => [m.userId, m]));
    assert.equal(byUser.chief_a.emsRole, "chief");
    assert.equal(byUser.responder_a.emsRole, "responder");
    assert.equal(byUser.trainee_a.emsRole, "trainee");

    const denied = call("agency-members", outsider, { orgId });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "not_a_member");
  });

  it("agency-set-role: only chief/supervisor may promote; a responder cannot", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    call("agency-join", responderA, { orgId });
    call("agency-join", traineeA, { orgId, role: "apprentice" });
    const promoted = call("agency-set-role", chiefA, { orgId, targetUserId: "trainee_a", role: "supervisor" });
    assert.equal(promoted.result.role, "officer");
    assert.equal(promoted.result.emsRole, "supervisor");
    const denied = call("agency-set-role", responderA, { orgId, targetUserId: "trainee_a", role: "responder" });
    assert.equal(denied.ok, false);
  });

  it("agency-mine lists every org the caller belongs to with the derived EMS role", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    call("agency-join", responderA, { orgId });
    const r = call("agency-mine", responderA, {});
    const found = r.result.organizations.find((o) => o.id === orgId);
    assert.ok(found, "agency-mine must include the joined agency");
    assert.equal(found.myEmsRole, "responder");
  });

  it("agency-leave: chief (leader) cannot leave their own agency", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    const r = call("agency-leave", chiefA, { orgId });
    assert.equal(r.ok, false);
    assert.equal(r.error, "leader_cannot_leave");
  });
});

describe("emergency-services CAD substrate is additive: org-scoped path is opt-in only", () => {
  it("per-uid path (no orgId) is byte-identical — unaffected by agency/role gating", () => {
    const created = call("incident-create", traineeA, { summary: "Solo call, no agency" });
    assert.equal(created.ok, true);
    assert.ok(created.result.incident.id);
    assert.equal(created.result.incident.orgId, null);
    const listed = call("incident-list", traineeA, {});
    assert.equal(listed.result.count, 1);
  });

  it("org-scoped path requires REAL membership: not_a_member on a real org the caller never joined", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    const r = call("incident-create", outsider, { orgId, summary: "Should be refused" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_a_member");
  });

  it("org-scoped path is honest on a nonexistent orgId: org_not_found, not a crash", () => {
    const r = call("incident-list", chiefA, { orgId: "org_does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "org_not_found");
  });

  it("trainee (apprentice) can read the org board but cannot create an incident (insufficient_role)", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    call("agency-join", traineeA, { orgId, role: "apprentice" });
    const read = call("incident-list", traineeA, { orgId });
    assert.equal(read.ok, true);
    const write = call("incident-create", traineeA, { orgId, summary: "Nope" });
    assert.equal(write.ok, false);
    assert.equal(write.error, "insufficient_role");
  });

  it("org state is SHARED: an incident the chief creates is visible to a responder teammate", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    call("agency-join", responderA, { orgId });
    call("incident-create", chiefA, { orgId, summary: "Structure fire" });
    call("incident-create", responderA, { orgId, summary: "MVA with entrapment" });
    const asChief = call("incident-list", chiefA, { orgId });
    const asResponder = call("incident-list", responderA, { orgId });
    assert.equal(asChief.result.count, 2);
    assert.equal(asResponder.result.count, 2);
  });

  it("org state does NOT bleed into a member's personal (no-orgId) CAD board", () => {
    const orgId = makeAgency(chiefA, "Agency A");
    call("incident-create", chiefA, { orgId, summary: "Agency-only call" });
    call("incident-create", chiefA, { summary: "Personal-only call" }); // no orgId
    const personal = call("incident-list", chiefA, {});
    assert.equal(personal.result.count, 1);
    assert.equal(personal.result.incidents[0].summary, "Personal-only call");
    const org = call("incident-list", chiefA, { orgId });
    assert.equal(org.result.count, 1);
    assert.equal(org.result.incidents[0].summary, "Agency-only call");
  });
});

describe("emergency-services mutual aid — real cross-org incident sharing", () => {
  function setupTwoAgencies() {
    const orgA = makeAgency(chiefA, "Agency A Fire/EMS");
    call("agency-join", responderA, { orgId: orgA });
    const orgB = makeAgency(chiefB, "Agency B Fire/EMS");
    call("agency-join", responderB, { orgId: orgB });
    return { orgA, orgB };
  }

  it("mutual-aid-share fails honestly against a nonexistent target agency (never a silent success)", () => {
    const orgA = makeAgency(chiefA, "Agency A");
    const inc = call("incident-create", chiefA, { orgId: orgA, summary: "5-alarm fire" });
    const r = call("mutual-aid-share", chiefA, {
      sourceOrgId: orgA, targetOrgId: "org_does_not_exist", incidentId: inc.result.incident.id,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "target_agency_not_found");
  });

  it("mutual-aid-share fails honestly when the caller is not a member of the source agency", () => {
    const { orgA, orgB } = setupTwoAgencies();
    call("agency-mutual-aid-consent", chiefB, { orgId: orgB, enabled: true });
    const inc = call("incident-create", chiefA, { orgId: orgA, summary: "Fire" });
    const r = call("mutual-aid-share", outsider, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_a_member");
  });

  it("mutual-aid-share fails honestly when the target agency has NOT consented to mutual aid", () => {
    const { orgA, orgB } = setupTwoAgencies();
    // orgB never called agency-mutual-aid-consent.
    const inc = call("incident-create", chiefA, { orgId: orgA, summary: "Fire" });
    const r = call("mutual-aid-share", chiefA, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "target_agency_not_accepting_mutual_aid");
  });

  it("mutual-aid-share fails honestly against an incident that doesn't really exist in the source agency", () => {
    const { orgA, orgB } = setupTwoAgencies();
    call("agency-mutual-aid-consent", chiefB, { orgId: orgB, enabled: true });
    const r = call("mutual-aid-share", chiefA, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: "inc_fabricated" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "incident_not_found_in_source_agency");
  });

  it("agency A can share a REAL incident with agency B, and B genuinely sees it", () => {
    const { orgA, orgB } = setupTwoAgencies();
    call("agency-mutual-aid-consent", chiefB, { orgId: orgB, enabled: true });
    const inc = call("incident-create-geo", chiefA, {
      orgId: orgA, summary: "Wildland fire spreading toward county line", priority: 1, lat: 10, lng: 10,
    });
    const shared = call("mutual-aid-share", chiefA, {
      sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id, note: "Need engines",
    });
    assert.equal(shared.ok, true);
    assert.equal(shared.result.share.sourceOrgId, orgA);
    assert.equal(shared.result.share.targetOrgId, orgB);
    assert.equal(shared.result.share.incidentId, inc.result.incident.id);
    assert.equal(shared.result.share.status, "active");

    // B (a real member of the target agency) genuinely sees it in their
    // "shared with us" mutual-aid view, with a LIVE resolved incident.
    const listB = call("mutual-aid-list", responderB, { orgId: orgB });
    assert.equal(listB.ok, true);
    assert.equal(listB.result.sharedWithUs.length, 1);
    assert.equal(listB.result.sharedWithUs[0].id, shared.result.share.id);
    assert.equal(listB.result.sharedWithUs[0].incident.summary, "Wildland fire spreading toward county line");

    // A sees it in their own "shared by us" view.
    const listA = call("mutual-aid-list", chiefA, { orgId: orgA });
    assert.equal(listA.result.sharedByUs.length, 1);
    assert.equal(listA.result.sharedByUs[0].id, shared.result.share.id);

    // An outsider to BOTH agencies cannot see the share via either view.
    const denied = call("mutual-aid-list", outsider, { orgId: orgA });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "not_a_member");
  });

  it("agency B can commit one of ITS OWN real units, and agency A genuinely sees the commitment", () => {
    const { orgA, orgB } = setupTwoAgencies();
    call("agency-mutual-aid-consent", chiefB, { orgId: orgB, enabled: true });
    const inc = call("incident-create", chiefA, { orgId: orgA, summary: "Multi-structure fire" });
    const shared = call("mutual-aid-share", chiefA, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id });

    // B adds a real unit to ITS OWN roster and commits it.
    const unit = call("unit-add", chiefB, { orgId: orgB, name: "Engine 12", kind: "fire_engine" });
    assert.equal(unit.ok, true);
    const committed = call("mutual-aid-commit-unit", responderB, { shareId: shared.result.share.id, unitId: unit.result.unit.id });
    assert.equal(committed.ok, true);
    assert.equal(committed.result.commitment.unitId, unit.result.unit.id);
    assert.equal(committed.result.unit.status, "dispatched");

    // The committed unit is now unavailable on B's own roster (a real
    // dispatch, not a paper pledge).
    const bUnits = call("unit-list", chiefB, { orgId: orgB });
    assert.equal(bUnits.result.available, 0);

    // A genuinely sees the commitment on their side of the share.
    const listA = call("mutual-aid-list", chiefA, { orgId: orgA });
    const shareSeenByA = listA.result.sharedByUs.find((r) => r.id === shared.result.share.id);
    assert.equal(shareSeenByA.committedUnits.length, 1);
    assert.equal(shareSeenByA.committedUnits[0].unitId, unit.result.unit.id);
    assert.equal(shareSeenByA.committedUnits[0].unitOrgId, orgB);

    // B also sees it on their own view of the same share.
    const listB = call("mutual-aid-list", chiefB, { orgId: orgB });
    const shareSeenByB = listB.result.sharedWithUs.find((r) => r.id === shared.result.share.id);
    assert.equal(shareSeenByB.committedUnits.length, 1);
  });

  it("mutual-aid-commit-unit fails honestly for a non-member of the target agency", () => {
    const { orgA, orgB } = setupTwoAgencies();
    call("agency-mutual-aid-consent", chiefB, { orgId: orgB, enabled: true });
    const inc = call("incident-create", chiefA, { orgId: orgA, summary: "Fire" });
    const shared = call("mutual-aid-share", chiefA, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id });
    const unit = call("unit-add", chiefB, { orgId: orgB, name: "Engine 1" });
    // Agency A's own chief is not a member of B and cannot commit B's unit.
    const r = call("mutual-aid-commit-unit", chiefA, { shareId: shared.result.share.id, unitId: unit.result.unit.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_a_member");
  });

  it("mutual-aid-commit-unit fails honestly when the unit doesn't belong to the target agency", () => {
    const { orgA, orgB } = setupTwoAgencies();
    call("agency-mutual-aid-consent", chiefB, { orgId: orgB, enabled: true });
    const inc = call("incident-create", chiefA, { orgId: orgA, summary: "Fire" });
    const shared = call("mutual-aid-share", chiefA, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id });
    // A unit that belongs to A's own roster, not B's.
    const aUnit = call("unit-add", chiefA, { orgId: orgA, name: "A's Engine" });
    const r = call("mutual-aid-commit-unit", chiefB, { shareId: shared.result.share.id, unitId: aUnit.result.unit.id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unit_not_found_in_target_agency");
  });

  it("mutual-aid-recall: only the source agency can recall, and a recalled share can't be committed to again", () => {
    const { orgA, orgB } = setupTwoAgencies();
    call("agency-mutual-aid-consent", chiefB, { orgId: orgB, enabled: true });
    const inc = call("incident-create", chiefA, { orgId: orgA, summary: "Fire" });
    const shared = call("mutual-aid-share", chiefA, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id });

    const deniedRecall = call("mutual-aid-recall", chiefB, { shareId: shared.result.share.id });
    assert.equal(deniedRecall.ok, false);
    assert.equal(deniedRecall.error, "not_a_member");

    const recalled = call("mutual-aid-recall", chiefA, { shareId: shared.result.share.id });
    assert.equal(recalled.ok, true);
    assert.equal(recalled.result.share.status, "recalled");

    const unit = call("unit-add", chiefB, { orgId: orgB, name: "Engine 1" });
    const commitAfterRecall = call("mutual-aid-commit-unit", chiefB, { shareId: shared.result.share.id, unitId: unit.result.unit.id });
    assert.equal(commitAfterRecall.ok, false);
    assert.equal(commitAfterRecall.error, "share_is_recalled");
  });

  it("mutual-aid-share refuses a duplicate active share of the same incident to the same target", () => {
    const { orgA, orgB } = setupTwoAgencies();
    call("agency-mutual-aid-consent", chiefB, { orgId: orgB, enabled: true });
    const inc = call("incident-create", chiefA, { orgId: orgA, summary: "Fire" });
    const first = call("mutual-aid-share", chiefA, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id });
    assert.equal(first.ok, true);
    const second = call("mutual-aid-share", chiefA, { sourceOrgId: orgA, targetOrgId: orgB, incidentId: inc.result.incident.id });
    assert.equal(second.ok, false);
    assert.equal(second.error, "already_shared");
  });
});
