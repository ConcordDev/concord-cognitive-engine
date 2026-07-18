// Behavior tests for the intel.research.* Tier-2 governance workflow —
// docs/WAVE4_INVENTORY.md line 303 / docs/lens-specs/sentinel-capability-map.md
// "intel.research.* governance-controlled research-access workflow
// completely unsurfaced".
//
// Two real backend gaps closed alongside the frontend wiring:
//   1. reviewResearchApplication (server/lib/foundation-intelligence.js) was
//      imported into server.js but never registered as a macro — every
//      submitResearchApplication call was permanently stuck at
//      status:"pending" with no way to ever reach "approved"/"denied".
//      This suite pins the new intel.research.review macro.
//   2. research.apply / research.status / research.data / research.synthesis /
//      research.archive previously trusted a client-supplied `researcherId`
//      instead of deriving identity from ctx.actor — this suite pins that a
//      caller can only apply for / check / pull data under their OWN
//      identity, and that a spoofed researcherId in the input is ignored.
//
// Boots the real server.js once via the shared depth harness (macroRuntime-
// style manual ctx construction, since we need DISTINCT actor identities
// and roles — the harness's own `depthCtx`/`makeInternalCtx` always returns
// a single hardcoded role:"owner" actor, which can't exercise the
// isolation / role-gating assertions this file is about). Isolated DB via
// a unique DB_PATH so this file never collides with a parallel test run.

import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/sentinel-research-access-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load } from "./_harness.js";

let runMacro, makeCtx;

before(async () => {
  const t = await load();
  runMacro = t.runMacro;
  makeCtx = t.makeCtx;
});

/** A ctx for a distinct, authenticated actor with a given governance role. */
function ctxFor(userId, role = "member") {
  const base = makeCtx(null);
  return {
    ...base,
    actor: { userId, id: userId, orgId: "default", role, scopes: ["read", "write"] },
  };
}

describe("intel.research.* — registration", () => {
  it("research.review is now registered (was imported but never wired)", async () => {
    const ctx = ctxFor(`owner_${randomUUID()}`, "owner");
    // Missing applicationId is a distinct, well-formed rejection — proves
    // the macro exists and its role gate was already passed, rather than
    // failing with unknown_macro.
    const r = await runMacro("intel", "research.review", {}, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "applicationId required");
  });
});

describe("intel.research.apply / research.status — identity scoping", () => {
  it("researcherId is derived from ctx.actor, not trusted from client input", async () => {
    const alice = `alice_${randomUUID()}`;
    const ctx = ctxFor(alice);
    const r = await runMacro("intel", "research.apply", {
      researcherId: "someone_else_entirely", // spoof attempt — must be ignored
      institution: "Test University",
      purpose: "studying signal patterns",
      categories: ["cross_medium_synthesis"],
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.status, "pending");
    assert.ok(r.applicationId);

    const status = await runMacro("intel", "research.status", { applicationId: r.applicationId }, ctx);
    assert.equal(status.ok, true);
    assert.equal(status.application.researcherId, alice);
    assert.notEqual(status.application.researcherId, "someone_else_entirely");
  });

  it("a non-owner cannot read another user's application status", async () => {
    const alice = `alice_${randomUUID()}`;
    const bob = `bob_${randomUUID()}`;
    const apply = await runMacro("intel", "research.apply", {
      institution: "Alice Institute", purpose: "alice's research",
    }, ctxFor(alice));
    assert.equal(apply.ok, true);

    const bobRead = await runMacro("intel", "research.status", { applicationId: apply.applicationId }, ctxFor(bob));
    assert.equal(bobRead.ok, false);
    assert.equal(bobRead.reason, "not_your_application");

    const aliceRead = await runMacro("intel", "research.status", { applicationId: apply.applicationId }, ctxFor(alice));
    assert.equal(aliceRead.ok, true);
  });

  it("a governance reviewer (owner/admin/founder) CAN read someone else's application status", async () => {
    const alice = `alice_${randomUUID()}`;
    const reviewer = `gov_${randomUUID()}`;
    const apply = await runMacro("intel", "research.apply", {
      institution: "Alice Institute", purpose: "reviewer visibility check",
    }, ctxFor(alice));

    const reviewerRead = await runMacro("intel", "research.status", { applicationId: apply.applicationId }, ctxFor(reviewer, "admin"));
    assert.equal(reviewerRead.ok, true);
    assert.equal(reviewerRead.application.researcherId, alice);
  });
});

describe("intel.research.review — governance gate", () => {
  it("a plain member cannot review (approve/deny) an application", async () => {
    const alice = `alice_${randomUUID()}`;
    const bob = `bob_${randomUUID()}`; // bob is a "member", not a reviewer
    const apply = await runMacro("intel", "research.apply", {
      institution: "Alice Institute", purpose: "member cannot approve",
    }, ctxFor(alice));

    const denied = await runMacro("intel", "research.review", {
      applicationId: apply.applicationId, approved: true,
    }, ctxFor(bob, "member"));
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "governance_role_required");

    // still pending — the rejected review attempt did not mutate anything
    const status = await runMacro("intel", "research.status", { applicationId: apply.applicationId }, ctxFor(alice));
    assert.equal(status.application.status, "pending");
  });

  it("owner/admin/founder roles can approve, transitioning pending -> approved", async () => {
    const alice = `alice_${randomUUID()}`;
    const gov = `gov_${randomUUID()}`;
    const apply = await runMacro("intel", "research.apply", {
      institution: "Alice Institute", purpose: "approval happy path",
      categories: ["cross_medium_synthesis"],
    }, ctxFor(alice));

    const review = await runMacro("intel", "research.review", {
      applicationId: apply.applicationId, approved: true,
    }, ctxFor(gov, "founder"));
    assert.equal(review.ok, true);
    assert.equal(review.status, "approved");

    const status = await runMacro("intel", "research.status", { applicationId: apply.applicationId }, ctxFor(alice));
    assert.equal(status.application.status, "approved");
    assert.equal(status.application.decision, "granted");
    assert.equal(status.application.reviewedBy, gov);
  });

  it("honest denial path — denied stays denied, no access is granted", async () => {
    const alice = `alice_${randomUUID()}`;
    const gov = `gov_${randomUUID()}`;
    const apply = await runMacro("intel", "research.apply", {
      institution: "Alice Institute", purpose: "denial path",
    }, ctxFor(alice));

    const review = await runMacro("intel", "research.review", {
      applicationId: apply.applicationId, approved: false,
    }, ctxFor(gov, "admin"));
    assert.equal(review.ok, true);
    assert.equal(review.status, "denied");

    const data = await runMacro("intel", "research.data", { limit: 5 }, ctxFor(alice));
    assert.equal(data.ok, false);
    assert.equal(data.error, "access_denied");
  });

  it("re-reviewing an already-reviewed application is rejected, not silently re-applied", async () => {
    const alice = `alice_${randomUUID()}`;
    const gov = `gov_${randomUUID()}`;
    const apply = await runMacro("intel", "research.apply", {
      institution: "Alice Institute", purpose: "double review",
    }, ctxFor(alice));
    const first = await runMacro("intel", "research.review", {
      applicationId: apply.applicationId, approved: true,
    }, ctxFor(gov, "owner"));
    assert.equal(first.ok, true);

    const second = await runMacro("intel", "research.review", {
      applicationId: apply.applicationId, approved: false,
    }, ctxFor(gov, "owner"));
    assert.equal(second.ok, false);
    assert.equal(second.error, "already_reviewed");
  });

  it("reviewing a bogus applicationId fails honestly", async () => {
    const gov = `gov_${randomUUID()}`;
    const r = await runMacro("intel", "research.review", {
      applicationId: "app_does_not_exist", approved: true,
    }, ctxFor(gov, "owner"));
    assert.equal(r.ok, false);
    assert.equal(r.error, "application_not_found");
  });
});

describe("intel.research.data / synthesis / archive — gated on approval state, scoped to caller", () => {
  it("data access is denied before approval, then works after approval — for the applicant only", async () => {
    const alice = `alice_${randomUUID()}`;
    const bob = `bob_${randomUUID()}`;
    const gov = `gov_${randomUUID()}`;
    const apply = await runMacro("intel", "research.apply", {
      institution: "Alice Institute", purpose: "data gating",
      categories: ["cross_medium_synthesis", "historical_archaeology"],
    }, ctxFor(alice));

    // Before approval: denied for the applicant themselves.
    const before = await runMacro("intel", "research.data", {}, ctxFor(alice));
    assert.equal(before.ok, false);
    assert.equal(before.error, "access_denied");

    const review = await runMacro("intel", "research.review", {
      applicationId: apply.applicationId, approved: true,
    }, ctxFor(gov, "owner"));
    assert.equal(review.ok, true);

    // After approval: alice can pull data/synthesis/archive.
    const data = await runMacro("intel", "research.data", {}, ctxFor(alice));
    assert.equal(data.ok, true);
    assert.equal(data.researcherId, alice);

    const synthesis = await runMacro("intel", "research.synthesis", {}, ctxFor(alice));
    assert.equal(synthesis.ok, true);

    const archive = await runMacro("intel", "research.archive", {}, ctxFor(alice));
    assert.equal(archive.ok, true);

    // Bob, who never applied, is NOT granted access just because alice was —
    // and cannot borrow alice's grant by spoofing researcherId in the input.
    const bobDenied = await runMacro("intel", "research.data", { researcherId: alice }, ctxFor(bob));
    assert.equal(bobDenied.ok, false);
    assert.equal(bobDenied.error, "access_denied");
  });
});
