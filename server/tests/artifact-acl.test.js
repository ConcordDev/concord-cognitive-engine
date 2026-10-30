import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  initArtifactAclTable,
  createArtifactAcl,
  ARTIFACT_ACL_LEVELS,
} from "../lib/artifact-acl.js";

// Platform ACL: one model for every lens artifact kind. Owners are
// resolved through an injected resolver over this fixture map, standing
// in for the per-kind owner lookups the wiring follow-ups will supply.
const OWNERS = new Map([
  ["board:board-1", "alice"],
  ["map:map-1", "alice"],
  ["dtu:dtu-1", "bob"],
]);

describe("artifact-acl", () => {
  let db;
  let acl;

  beforeEach(() => {
    db = new Database(":memory:");
    initArtifactAclTable(db);
    acl = createArtifactAcl(db, {
      resolveOwner: (kind, id) => OWNERS.get(`${kind}:${id}`) ?? null,
    });
  });

  it("initArtifactAclTable is idempotent", () => {
    assert.equal(initArtifactAclTable(db), true);
    assert.equal(initArtifactAclTable(db), true);
  });

  it("owner has full access without any grant", () => {
    assert.equal(acl.levelFor("board", "board-1", "alice"), "owner");
    assert.equal(acl.canView("board", "board-1", "alice"), true);
    assert.equal(acl.canEdit("board", "board-1", "alice"), true);
  });

  it("non-grantee is denied read and write", () => {
    assert.equal(acl.levelFor("board", "board-1", "carol"), null);
    assert.equal(acl.canView("board", "board-1", "carol"), false);
    assert.equal(acl.canEdit("board", "board-1", "carol"), false);
  });

  it("view grant allows read but denies write", () => {
    const res = acl.grant({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      level: ARTIFACT_ACL_LEVELS.VIEW,
      byUserId: "alice",
    });
    assert.equal(res.ok, true);
    assert.equal(res.grant.level, "view");
    assert.equal(acl.canView("board", "board-1", "carol"), true);
    assert.equal(acl.canEdit("board", "board-1", "carol"), false);
  });

  it("edit grant allows read and write", () => {
    acl.grant({
      kind: "map",
      id: "map-1",
      granteeId: "carol",
      level: ARTIFACT_ACL_LEVELS.EDIT,
      byUserId: "alice",
    });
    assert.equal(acl.levelFor("map", "map-1", "carol"), "edit");
    assert.equal(acl.canView("map", "map-1", "carol"), true);
    assert.equal(acl.canEdit("map", "map-1", "carol"), true);
  });

  it("grants are per-artifact: a board grant does not leak to the map", () => {
    acl.grant({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      level: "edit",
      byUserId: "alice",
    });
    assert.equal(acl.levelFor("map", "map-1", "carol"), null);
    assert.equal(acl.levelFor("dtu", "dtu-1", "carol"), null);
  });

  it("non-owner cannot grant", () => {
    const res = acl.grant({
      kind: "board",
      id: "board-1",
      granteeId: "dave",
      level: "view",
      byUserId: "carol",
    });
    assert.deepEqual(res, { ok: false, error: "not_owner" });
    assert.equal(acl.levelFor("board", "board-1", "dave"), null);
  });

  it("non-owner cannot revoke", () => {
    acl.grant({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      level: "view",
      byUserId: "alice",
    });
    const res = acl.revoke({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      byUserId: "dave",
    });
    assert.deepEqual(res, { ok: false, error: "not_owner" });
    assert.equal(acl.canView("board", "board-1", "carol"), true);
  });

  it("grant on an unknown artifact is denied as not found", () => {
    const res = acl.grant({
      kind: "board",
      id: "nope",
      granteeId: "carol",
      level: "view",
      byUserId: "alice",
    });
    assert.deepEqual(res, { ok: false, error: "artifact_not_found" });
    assert.equal(acl.levelFor("board", "nope", "carol"), null);
  });

  it("granting the owner themself is rejected", () => {
    const res = acl.grant({
      kind: "board",
      id: "board-1",
      granteeId: "alice",
      level: "view",
      byUserId: "alice",
    });
    assert.deepEqual(res, { ok: false, error: "self_grant" });
  });

  it("invalid level is rejected", () => {
    const res = acl.grant({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      level: "admin",
      byUserId: "alice",
    });
    assert.deepEqual(res, { ok: false, error: "invalid_level" });
  });

  it("revoked grant denies read and write immediately", () => {
    acl.grant({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      level: "edit",
      byUserId: "alice",
    });
    assert.equal(acl.canEdit("board", "board-1", "carol"), true);
    const res = acl.revoke({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      byUserId: "alice",
    });
    assert.equal(res.ok, true);
    assert.ok(res.grant.revokedAt);
    assert.equal(acl.levelFor("board", "board-1", "carol"), null);
    assert.equal(acl.canView("board", "board-1", "carol"), false);
    assert.equal(acl.canEdit("board", "board-1", "carol"), false);
  });

  it("revoking with no active grant reports no_active_grant", () => {
    const res = acl.revoke({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      byUserId: "alice",
    });
    assert.deepEqual(res, { ok: false, error: "no_active_grant" });
  });

  it("re-grant after revoke works (revoked rows do not block)", () => {
    acl.grant({ kind: "board", id: "board-1", granteeId: "carol", level: "view", byUserId: "alice" });
    acl.revoke({ kind: "board", id: "board-1", granteeId: "carol", byUserId: "alice" });
    const res = acl.grant({ kind: "board", id: "board-1", granteeId: "carol", level: "edit", byUserId: "alice" });
    assert.equal(res.ok, true);
    assert.equal(acl.canEdit("board", "board-1", "carol"), true);
  });

  it("re-grant updates the level in place (one active grant)", () => {
    acl.grant({ kind: "board", id: "board-1", granteeId: "carol", level: "view", byUserId: "alice" });
    const res = acl.grant({ kind: "board", id: "board-1", granteeId: "carol", level: "edit", byUserId: "alice" });
    assert.equal(res.ok, true);
    assert.equal(res.updated, true);
    const list = acl.listGrants("board", "board-1", "alice");
    assert.equal(list.ok, true);
    assert.equal(list.grants.length, 1);
    assert.equal(list.grants[0].level, "edit");
  });

  it("listGrants is owner-only", () => {
    acl.grant({ kind: "board", id: "board-1", granteeId: "carol", level: "view", byUserId: "alice" });
    assert.deepEqual(acl.listGrants("board", "board-1", "carol"), {
      ok: false,
      error: "not_owner",
    });
  });

  it("listSharedWith shows a grantee their active grants only", () => {
    acl.grant({ kind: "board", id: "board-1", granteeId: "carol", level: "view", byUserId: "alice" });
    acl.grant({ kind: "dtu", id: "dtu-1", granteeId: "carol", level: "edit", byUserId: "bob" });
    acl.grant({ kind: "map", id: "map-1", granteeId: "carol", level: "view", byUserId: "alice" });
    acl.revoke({ kind: "map", id: "map-1", granteeId: "carol", byUserId: "alice" });
    const res = acl.listSharedWith("carol");
    assert.equal(res.ok, true);
    assert.deepEqual(
      res.grants.map((g) => `${g.artifactKind}:${g.artifactId}:${g.level}`).sort(),
      ["board:board-1:view", "dtu:dtu-1:edit"]
    );
  });

  it("ownership transfer moves grant control to the new owner", () => {
    acl.grant({ kind: "board", id: "board-1", granteeId: "carol", level: "view", byUserId: "alice" });
    OWNERS.set("board:board-1", "dave");
    try {
      // Old owner can no longer grant or revoke.
      assert.deepEqual(
        acl.grant({ kind: "board", id: "board-1", granteeId: "erin", level: "view", byUserId: "alice" }),
        { ok: false, error: "not_owner" }
      );
      // The existing grant still serves the grantee.
      assert.equal(acl.canView("board", "board-1", "carol"), true);
      // New owner holds owner level and can revoke.
      assert.equal(acl.levelFor("board", "board-1", "dave"), "owner");
      const res = acl.revoke({ kind: "board", id: "board-1", granteeId: "carol", byUserId: "dave" });
      assert.equal(res.ok, true);
      assert.equal(acl.canView("board", "board-1", "carol"), false);
    } finally {
      OWNERS.set("board:board-1", "alice");
    }
  });

  it("without a resolver the manager fails closed", () => {
    const closed = createArtifactAcl(db, {});
    const res = closed.grant({
      kind: "board",
      id: "board-1",
      granteeId: "carol",
      level: "view",
      byUserId: "alice",
    });
    assert.deepEqual(res, { ok: false, error: "artifact_not_found" });
    assert.equal(closed.levelFor("board", "board-1", "alice"), null);
  });
});
