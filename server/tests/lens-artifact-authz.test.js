// tests/lens-artifact-authz.test.js
//
// Regression guard for an IDOR in the generic lens-artifact runtime
// (server.js's "GENERIC LENS ARTIFACT RUNTIME" section, `register("lens", …)`).
//
// `lens.list` and `lens.get` already enforced "a private, non-social-domain
// artifact is only visible to its owner or an admin". `lens.run` and
// `lens.export` did NOT — any authenticated caller who knew (or could
// enumerate) another user's private lens-artifact id could invoke ANY
// registered domain action against it via `POST /api/lens/:domain/:id/run`,
// or dump its full `data` via `GET /api/lens/:domain/:id/export`. Found while
// auditing the `security` lens: an attacker could have read another user's
// Incident artifact (assignee, root cause, lessons learned) or
// Access-Control artifact (badge holder, visitor name) this way.
// `lens.update` had the matching write-side gap — no ownership check at all
// (unlike `lens.delete`, which already required owner-or-admin) — so any
// authenticated caller could silently overwrite another user's artifact.
//
// This test pins that all four by-id operations now agree, and that the
// fix didn't regress the two carve-outs that must keep working: admin
// bypass (mirrors lens.delete) and social-domain artifacts staying open to
// non-owners (mirrors lens.list/lens.get).

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { load } from "./depth/_harness.js";

test("lens artifact authz", async (t) => {
  const { runMacro, STATE } = await load();

  function ctxFor(userId, role = "member") {
    return { actor: { userId, role }, userId };
  }

  const OWNER = "lens-authz-owner";
  const OTHER = "lens-authz-other";
  const ADMIN = "lens-authz-admin";

  // Seed the artifact directly into STATE.lensArtifacts (the same pattern
  // tests/depth/_harness.js#lensRun uses) instead of going through
  // `lens.create` — this test is about the by-id ownership gates, not
  // artifact creation, so seeding directly keeps the two concerns separate.
  // (The `lens.create` scope-check's un-awaited-Promise bug this comment
  // used to describe is fixed and pinned separately at
  // tests/lens-create-scope-check-await.test.js.)
  function makeArtifact(domain = "security") {
    const id = `lens-authz-${domain}-${randomUUID()}`;
    STATE.lensArtifacts.set(id, {
      id, domain, type: "Incident",
      ownerId: OWNER, createdBy: OWNER,
      title: "original title",
      data: { rootCause: "sensitive investigation notes" },
      meta: { visibility: "private" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    });
    return id;
  }

  await t.test("lens.get already blocked a non-owner (sanity check on the existing rule)", async () => {
    const id = await makeArtifact();
    const r = await runMacro("lens", "get", { id }, ctxFor(OTHER));
    assert.equal(r.ok, false);
  });

  await t.test("lens.export blocks a non-owner from reading another user's private artifact", async () => {
    const id = await makeArtifact();
    const asOther = await runMacro("lens", "export", { id, format: "json" }, ctxFor(OTHER));
    assert.equal(asOther.ok, false, "non-owner must not be able to export another user's artifact");
    const asOwner = await runMacro("lens", "export", { id, format: "json" }, ctxFor(OWNER));
    assert.equal(asOwner.ok, true);
  });

  await t.test("lens.run blocks a non-owner from invoking an action on another user's private artifact", async () => {
    const id = await makeArtifact();
    const asOther = await runMacro("lens", "run", { id, action: "accessAudit", params: {} }, ctxFor(OTHER));
    assert.equal(asOther.ok, false, "non-owner must not be able to run an action against another user's artifact");
    const asOwner = await runMacro("lens", "run", { id, action: "accessAudit", params: {} }, ctxFor(OWNER));
    assert.equal(asOwner.ok, true);
  });

  await t.test("lens.update blocks a non-owner from silently overwriting another user's artifact", async () => {
    const id = await makeArtifact();
    const asOther = await runMacro("lens", "update", { id, title: "hijacked" }, ctxFor(OTHER));
    assert.equal(asOther.ok, false, "non-owner must not be able to update another user's artifact");
    assert.notEqual(STATE.lensArtifacts.get(id).title, "hijacked");
    const asOwner = await runMacro("lens", "update", { id, title: "owner-edit" }, ctxFor(OWNER));
    assert.equal(asOwner.ok, true);
    assert.equal(STATE.lensArtifacts.get(id).title, "owner-edit");
  });

  await t.test("an admin actor can still run/export/update any artifact (mirrors lens.delete's existing bypass)", async () => {
    const id = await makeArtifact();
    const runR = await runMacro("lens", "run", { id, action: "accessAudit", params: {} }, ctxFor(ADMIN, "admin"));
    assert.equal(runR.ok, true, JSON.stringify(runR));
    const exportR = await runMacro("lens", "export", { id, format: "json" }, ctxFor(ADMIN, "admin"));
    assert.equal(exportR.ok, true, JSON.stringify(exportR));
    const updateR = await runMacro("lens", "update", { id, title: "admin-edit" }, ctxFor(ADMIN, "admin"));
    assert.equal(updateR.ok, true, JSON.stringify(updateR));
  });

  await t.test("social-domain artifacts stay readable/actionable by non-owners (no regression)", async () => {
    const id = makeArtifact("forum");
    const exportR = await runMacro("lens", "export", { id, format: "json" }, ctxFor(OTHER));
    assert.equal(exportR.ok, true, "social-domain artifacts should stay visible to non-owners");
  });
});
