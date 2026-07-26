// server/tests/lab-org-roles.test.js
//
// Multi-user lab roles/permissions (PI / tech / guest tiers) — WAVE4_INVENTORY.md
// flagged this as needing a new permissions layer; it doesn't. The org/roster
// substrate already exists (server/lib/world-organizations.js, ORG_TYPES
// includes "lab"). This pins the ADDITIVE org-scoped path on top of
// server/domains/lab.js's notebook/inventory/protocol macros:
//   - PI (leader/officer) has full edit incl. protocols + member management
//   - tech (member) can edit notebook + inventory, NOT protocols/members
//   - guest (apprentice) is read-only everywhere
// and pins that the pre-existing per-user path is byte-identical when no
// orgId is supplied (see lab-domain-parity.test.js, unchanged and still
// passing).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerLabActions from "../domains/lab.js";
import { up as upWorldOrgs } from "../migrations/383_world_organizations.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`lab.${name}`);
  if (!fn) throw new Error(`lab.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerLabActions(register); });

// Organizations are now DB-backed (durability fix — see
// lib/world-organizations.js's header comment); the macros read/write
// through `ctx.db`. One in-memory db for the whole file — every test mints
// a fresh org id via createOrganization so there's no cross-test bleed.
const _orgDb = new Database(":memory:");
upWorldOrgs(_orgDb);

beforeEach(() => {
  // Fresh STATE per test so per-user AND org-shared Maps don't leak
  // between cases (org membership itself lives in world-organizations.js's
  // DB-backed tables, which are NOT reset here — every test uses a
  // freshly-created org id via createOrganization so no cross-test bleed).
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = (userId) => ({ actor: { userId }, userId, db: _orgDb });
const pi = ctx("lab_pi");
const tech = ctx("lab_tech");
const guest = ctx("lab_guest");
const outsider = ctx("lab_outsider");

function makeLabOrg() {
  const r = call("org-create", pi, { name: "Genomics Core" });
  assert.equal(r.ok, true, "org-create must succeed");
  return r.result.organization.id;
}

function makeStaffedLabOrg() {
  const orgId = makeLabOrg();
  const joinTech = call("org-join", tech, { orgId });
  assert.equal(joinTech.ok, true);
  const setTech = call("org-set-role", pi, { orgId, userId: "lab_tech", tier: "tech" });
  assert.equal(setTech.ok, true, "PI must be able to promote a joiner to tech");
  const joinGuest = call("org-join", guest, { orgId });
  assert.equal(joinGuest.ok, true); // stays apprentice/guest by default
  return orgId;
}

describe("lab org lifecycle (thin wrappers over world-organizations.js)", () => {
  it("org-create: caller becomes leader / pi tier on a type:lab org", () => {
    const r = call("org-create", pi, { name: "Structural Biology Lab", description: "cryo-EM" });
    assert.equal(r.ok, true);
    assert.equal(r.result.organization.type, "lab");
    assert.equal(r.result.organization.leaderId, "lab_pi");
    assert.equal(r.result.tier, "pi");
  });

  it("org-create: rejects a missing name", () => {
    const r = call("org-create", pi, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "lab name required");
  });

  it("org-join: self-service join always enters at guest tier, never self-elevates", () => {
    const orgId = makeLabOrg();
    const r = call("org-join", tech, { orgId });
    assert.equal(r.ok, true);
    assert.equal(r.result.tier, "guest");
    assert.equal(r.result.orgRole, "apprentice");
  });

  it("org-join: rejects an unknown org id honestly", () => {
    const r = call("org-join", tech, { orgId: "org_does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "org_not_found");
  });

  it("org-list-mine: lists only the caller's lab orgs, with tier", () => {
    const orgId = makeLabOrg();
    call("org-join", tech, { orgId });
    const mine = call("org-list-mine", tech, {});
    assert.equal(mine.ok, true);
    const found = mine.result.labs.find((l) => l.orgId === orgId);
    assert.ok(found, "org-list-mine must include the joined lab org");
    assert.equal(found.tier, "guest");
    const piMine = call("org-list-mine", pi, {});
    assert.equal(piMine.result.labs.find((l) => l.orgId === orgId).tier, "pi");
  });

  it("org-list-mine: an outsider sees no labs", () => {
    makeLabOrg();
    const r = call("org-list-mine", outsider, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 0);
  });

  it("org-set-role: only PI (leader/officer) may promote/demote a member", () => {
    const orgId = makeStaffedLabOrg();
    const r = call("org-set-role", pi, { orgId, userId: "lab_guest", tier: "tech" });
    assert.equal(r.ok, true);
    assert.equal(r.result.orgRole, "member");
    assert.equal(r.result.tier, "tech");
  });

  it("org-set-role: a tech (member) cannot change anyone's role", () => {
    const orgId = makeStaffedLabOrg();
    const r = call("org-set-role", tech, { orgId, userId: "lab_guest", tier: "pi" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_role");
  });

  it("org-set-role: a guest cannot change anyone's role", () => {
    const orgId = makeStaffedLabOrg();
    const r = call("org-set-role", guest, { orgId, userId: "lab_tech", tier: "guest" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_role");
  });

  it("org-set-role: rejects an unknown tier", () => {
    const orgId = makeStaffedLabOrg();
    const r = call("org-set-role", pi, { orgId, userId: "lab_tech", tier: "wizard" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "tier must be pi, tech, or guest");
  });

  it("org-members: roster shows every member with derived tier; a non-member is refused", () => {
    const orgId = makeStaffedLabOrg();
    const roster = call("org-members", pi, { orgId });
    assert.equal(roster.ok, true);
    const byUser = Object.fromEntries(roster.result.members.map((m) => [m.userId, m]));
    assert.equal(byUser.lab_pi.tier, "pi");
    assert.equal(byUser.lab_tech.tier, "tech");
    assert.equal(byUser.lab_guest.tier, "guest");
    assert.equal(roster.result.canManageMembers, true);

    const outsiderView = call("org-members", outsider, { orgId });
    assert.equal(outsiderView.ok, false);
    assert.equal(outsiderView.error, "not_a_member");
  });

  it("org-leave: the org leader (founding PI) cannot leave their own org", () => {
    const orgId = makeLabOrg();
    const r = call("org-leave", pi, { orgId });
    assert.equal(r.ok, false);
  });
});

describe("lab role-gated writes on org-shared notebook/inventory/protocols", () => {
  it("PI can create + revise protocols in the org (full edit incl. protocols)", () => {
    const orgId = makeStaffedLabOrg();
    const created = call("protocol-create", pi, {
      orgId, name: "Western Blot SOP", steps: [{ text: "Run gel", durationMinutes: 60 }],
    });
    assert.equal(created.ok, true);
    assert.equal(created.result.protocol.orgId, orgId);
    const revised = call("protocol-revise", pi, { orgId, id: created.result.protocol.id, description: "v2" });
    assert.equal(revised.ok, true);
    assert.equal(revised.result.protocol.version, 2);
  });

  it("tech (member) can edit notebook + inventory, but NOT protocols", () => {
    const orgId = makeStaffedLabOrg();

    const nb = call("notebook-create", tech, { orgId, title: "Run log", body: "gel ran clean" });
    assert.equal(nb.ok, true, "tech must be able to write the shared notebook");

    const rgt = call("inventory-add", tech, { orgId, name: "Taq polymerase", quantity: 5 });
    assert.equal(rgt.ok, true, "tech must be able to write the shared inventory");

    const proto = call("protocol-create", tech, { orgId, name: "Should be blocked", steps: [{ text: "x" }] });
    assert.equal(proto.ok, false);
    assert.equal(proto.error, "insufficient_role");
  });

  it("tech cannot manage members (not gated here directly, but confirms tier separation)", () => {
    const orgId = makeStaffedLabOrg();
    const r = call("org-set-role", tech, { orgId, userId: "lab_guest", tier: "tech" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_role");
  });

  it("guest write attempts on notebook/inventory/protocols all return insufficient_role", () => {
    const orgId = makeStaffedLabOrg();
    const nb = call("notebook-create", guest, { orgId, title: "nope" });
    assert.equal(nb.ok, false);
    assert.equal(nb.error, "insufficient_role");

    const rgt = call("inventory-add", guest, { orgId, name: "nope" });
    assert.equal(rgt.ok, false);
    assert.equal(rgt.error, "insufficient_role");

    const proto = call("protocol-create", guest, { orgId, name: "nope", steps: [{ text: "x" }] });
    assert.equal(proto.ok, false);
    assert.equal(proto.error, "insufficient_role");
  });

  it("guest CAN read the shared notebook/inventory/protocols and run a protocol", () => {
    const orgId = makeStaffedLabOrg();
    call("notebook-create", pi, { orgId, title: "seed entry" });
    call("inventory-add", pi, { orgId, name: "Ethanol" });
    const proto = call("protocol-create", pi, { orgId, name: "Prep", steps: [{ text: "step 1", durationMinutes: 5 }] });

    assert.equal(call("notebook-list", guest, { orgId }).ok, true);
    assert.equal(call("inventory-list", guest, { orgId }).ok, true);
    assert.equal(call("protocol-list", guest, { orgId }).ok, true);

    const run = call("protocol-run", guest, { orgId, id: proto.result.protocol.id });
    assert.equal(run.ok, true, "running a protocol is a read/execute action, not an edit — guest allowed");
    assert.equal(run.result.run.protocolId, proto.result.protocol.id);
  });

  it("a non-member is refused with not_a_member on every org-scoped macro", () => {
    const orgId = makeStaffedLabOrg();
    assert.equal(call("notebook-list", outsider, { orgId }).error, "not_a_member");
    assert.equal(call("notebook-create", outsider, { orgId, title: "x" }).error, "not_a_member");
    assert.equal(call("inventory-list", outsider, { orgId }).error, "not_a_member");
    assert.equal(call("inventory-add", outsider, { orgId, name: "x" }).error, "not_a_member");
    assert.equal(call("protocol-list", outsider, { orgId }).error, "not_a_member");
    assert.equal(call("protocol-create", outsider, { orgId, name: "x" }).error, "not_a_member");
  });

  it("org-shared notebook state is visible to a SECOND member (shared, not per-caller)", () => {
    const orgId = makeStaffedLabOrg();
    const created = call("notebook-create", pi, { orgId, title: "Shared entry", body: "from PI" });
    assert.equal(created.ok, true);

    // tech (a different user) sees the SAME entry via the org-scoped list
    const techView = call("notebook-list", tech, { orgId });
    assert.equal(techView.ok, true);
    assert.equal(techView.result.total, 1);
    assert.equal(techView.result.entries[0].id, created.result.entry.id);
    assert.equal(techView.result.entries[0].title, "Shared entry");

    // and tech can edit the SAME entry the PI created
    const updated = call("notebook-update", tech, { orgId, id: created.result.entry.id, body: "amended by tech" });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.entry.body, "amended by tech");

    // guest sees the amendment too (read-only)
    const guestView = call("notebook-list", guest, { orgId });
    assert.equal(guestView.result.entries[0].body, "amended by tech");
  });

  it("org-shared inventory state is visible to a SECOND member and consume/remove work across members", () => {
    const orgId = makeStaffedLabOrg();
    const added = call("inventory-add", tech, { orgId, name: "dNTPs", quantity: 10 });
    assert.equal(added.ok, true);

    const piView = call("inventory-list", pi, { orgId });
    assert.equal(piView.result.total, 1);
    assert.equal(piView.result.items[0].name, "dNTPs");

    const consumed = call("inventory-consume", pi, { orgId, id: added.result.item.id, delta: -3 });
    assert.equal(consumed.ok, true);
    assert.equal(consumed.result.item.quantity, 7);

    const removed = call("inventory-remove", pi, { orgId, id: added.result.item.id });
    assert.equal(removed.ok, true);
    assert.equal(call("inventory-list", tech, { orgId }).result.total, 0);
  });
});

describe("lab per-user path is unchanged when no orgId is supplied", () => {
  it("notebook/inventory/protocol macros behave exactly as before — fully isolated per caller", () => {
    const nb = call("notebook-create", pi, { title: "Personal notes" });
    assert.equal(nb.ok, true);
    assert.equal(nb.result.entry.orgId, null);

    // a second user (tech) has their own, empty, personal notebook
    const techList = call("notebook-list", tech, {});
    assert.equal(techList.result.total, 0);

    const piList = call("notebook-list", pi, {});
    assert.equal(piList.result.total, 1);

    const rgt = call("inventory-add", pi, { name: "Personal reagent", quantity: 1 });
    assert.equal(rgt.ok, true);
    assert.equal(rgt.result.item.orgId, null);
    assert.equal(call("inventory-list", tech, {}).result.total, 0);

    const proto = call("protocol-create", pi, { name: "Personal SOP", steps: [{ text: "a" }] });
    assert.equal(proto.ok, true);
    assert.equal(proto.result.protocol.orgId, null);
    assert.equal(call("protocol-list", tech, {}).result.total, 0);
  });

  it("a personal-scope macro never requires org membership, even for a user who is a guest elsewhere", () => {
    const orgId = makeStaffedLabOrg();
    // guest is apprentice-tier in the shared org, but their OWN personal
    // notebook is fully theirs to write — no orgId means no gate at all.
    const r = call("notebook-create", guest, { title: "my private notes" });
    assert.equal(r.ok, true);
    assert.equal(r.result.entry.orgId, null);
    void orgId;
  });
});
