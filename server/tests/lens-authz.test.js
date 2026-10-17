// server/tests/lens-authz.test.js
//
// Regression pins for the shared authorization helper used by lens actions
// and libraries. Refusals are returned as { ok:false, reason:... } objects.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  actorId,
  requireActor,
  requireOwner,
} from "../lib/lens-authz.js";

describe("lens-authz — actorId", () => {
  it("returns null when there is no actor", () => {
    assert.equal(actorId(null), null);
    assert.equal(actorId({}), null);
    assert.equal(actorId({ actor: {} }), null);
  });

  it("returns null for anonymous/placeholder ids (any case)", () => {
    for (const id of ["anon", "anonymous", "guest", "Anon", "ANONYMOUS", "Guest"]) {
      assert.equal(actorId({ actor: { userId: id } }), null, `actorId should reject ${id}`);
      assert.equal(actorId({ userId: id }), null, `actorId should reject ${id}`);
    }
  });

  it("returns the real user id for a normal actor", () => {
    assert.equal(actorId({ actor: { userId: "alice" } }), "alice");
    assert.equal(actorId({ userId: "bob" }), "bob");
  });
});

describe("lens-authz — requireActor", () => {
  it("refuses missing actor with reason auth_required", () => {
    assert.deepEqual(requireActor({}), { ok: false, reason: "auth_required" });
  });

  it("refuses anonymous ids with reason auth_required", () => {
    for (const id of ["anon", "anonymous", "guest", "Anon"]) {
      assert.deepEqual(requireActor({ actor: { userId: id } }), { ok: false, reason: "auth_required" });
    }
  });

  it("allows a real actor", () => {
    assert.deepEqual(requireActor({ actor: { userId: "alice" } }), { ok: true, actorId: "alice" });
  });
});

describe("lens-authz — requireOwner", () => {
  it("allows the owner", () => {
    assert.deepEqual(requireOwner({ actor: { userId: "alice" } }, "alice"), { ok: true, actorId: "alice" });
  });

  it("refuses another user with reason forbidden", () => {
    assert.deepEqual(requireOwner({ actor: { userId: "bob" } }, "alice"), { ok: false, reason: "forbidden" });
  });

  it("allows role admin/owner/founder", () => {
    for (const role of ["admin", "owner", "founder", "ADMIN", "Owner", "Founder"]) {
      const ctx = { actor: { userId: "adminUser", role } };
      assert.deepEqual(requireOwner(ctx, "alice"), { ok: true, actorId: "adminUser" }, `role ${role} should be allowed`);
    }
  });

  it("allows isAdmin:true", () => {
    const ctx = { actor: { userId: "adminUser", isAdmin: true } };
    assert.deepEqual(requireOwner(ctx, "alice"), { ok: true, actorId: "adminUser" });
  });

  it("refuses role member/moderator", () => {
    for (const role of ["member", "moderator"]) {
      const ctx = { actor: { userId: "other", role } };
      assert.deepEqual(requireOwner(ctx, "alice"), { ok: false, reason: "forbidden" }, `role ${role} should be refused`);
    }
  });
});
