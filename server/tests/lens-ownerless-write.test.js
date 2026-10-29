// Lens ownerless-write gate — security regression tests (HANDOFF-SEC-2 Fix 10).
//
// Pins the fix for: lens.update's ownership clause only ran when
// ownerId was a concrete user id, and the /publish route's check had
// the same shape — so artifacts with NO owner (missing ownerId,
// "anon", "anonymous", "system", or marketplace artifacts with no
// owner fields at all) were writable and publishable by ANY signed-in
// member. Ownerless writes are now admin/internal-only (moderators on
// social domains), with AUTH_MODE=public (solo local-first) exempt.
//
// Two layers:
//   1. Unit tests for isOwnerlessArtifact + lensOwnerlessDenial in
//      lib/lens-update-gate.js.
//   2. Source assertions that server.js wires the ownerless gate into
//      lens.update (before status validation, the first assignment
//      and the DTU emit) and into the /publish route (before the
//      visibility flip), and that the short-circuit clause is gone.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  isOwnerlessArtifact,
  lensOwnerlessDenial,
} from "../lib/lens-update-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const MEMBER = { actor: { userId: "member-1", role: "member" } };
const MOD = { actor: { userId: "mod-1", role: "moderator" } };
const ANON = { actor: { userId: "anon" } };
const NO_ACTOR = {};
const INTERNAL = { internal: true, actor: { userId: "anon" } };

const FORBIDDEN_UPDATE = {
  ok: false,
  status: 403,
  code: "FORBIDDEN",
  error: "unauthorized: you can only update your own artifacts",
};
const FORBIDDEN_PUBLISH = {
  ok: false,
  status: 403,
  code: "FORBIDDEN",
  error: "not your artifact",
};
const AUTH_REQUIRED = {
  ok: false,
  status: 401,
  code: "AUTH_REQUIRED",
  error: "sign in required",
};

describe("lens-ownerless-write — isOwnerlessArtifact unit", () => {
  it("treats missing owner fields as ownerless (the marketplace no-owner-fields case)", () => {
    assert.equal(isOwnerlessArtifact({ id: "a", domain: "marketplace" }), true);
    assert.equal(isOwnerlessArtifact({ ownerId: undefined }), true);
    assert.equal(isOwnerlessArtifact({ ownerId: null }), true);
    assert.equal(isOwnerlessArtifact({ ownerId: "" }), true);
    assert.equal(isOwnerlessArtifact(null), true);
  });

  it("treats the sentinel owner stamps as ownerless", () => {
    for (const ownerId of ["anon", "anonymous", "system", "ANON", "System"]) {
      assert.equal(isOwnerlessArtifact({ ownerId }), true, ownerId);
    }
  });

  it("a concrete ownerId is owned", () => {
    assert.equal(isOwnerlessArtifact({ ownerId: "user-123" }), false);
  });

  it("createdBy / createdByUser count as ownership when ownerId is missing or sentinel", () => {
    assert.equal(isOwnerlessArtifact({ createdBy: "user-123" }), false);
    assert.equal(isOwnerlessArtifact({ ownerId: "anon", createdByUser: "user-123" }), false);
    assert.equal(isOwnerlessArtifact({ ownerId: "system", createdBy: "user-123" }), false);
  });

  it("sentinel createdBy does not rescue a sentinel ownerId", () => {
    assert.equal(isOwnerlessArtifact({ ownerId: "anon", createdBy: "anon" }), true);
    assert.equal(isOwnerlessArtifact({ createdBy: "system" }), true);
  });

  it("non-user system stamps like 'pipeline' are concrete owners, not ownerless", () => {
    assert.equal(isOwnerlessArtifact({ ownerId: "pipeline" }), false);
  });
});

describe("lens-ownerless-write — lensOwnerlessDenial unit", () => {
  const base = { isAdmin: false, isSocialDomain: false, authMode: "hybrid" };

  it("denies a plain member 403 on an ownerless artifact (update + publish shapes)", () => {
    assert.deepEqual(lensOwnerlessDenial({ ctx: MEMBER, ...base }), FORBIDDEN_UPDATE);
    assert.deepEqual(
      lensOwnerlessDenial({ ctx: MEMBER, ...base, forbiddenError: "not your artifact" }),
      FORBIDDEN_PUBLISH,
    );
    assert.deepEqual(
      lensOwnerlessDenial({ ctx: MEMBER, ...base, isSocialDomain: true }),
      FORBIDDEN_UPDATE,
    );
  });

  it("denies anonymous callers 401", () => {
    assert.deepEqual(lensOwnerlessDenial({ ctx: ANON, ...base }), AUTH_REQUIRED);
    assert.deepEqual(lensOwnerlessDenial({ ctx: NO_ACTOR, ...base }), AUTH_REQUIRED);
  });

  it("allows admins and internal callers", () => {
    assert.equal(lensOwnerlessDenial({ ctx: MEMBER, ...base, isAdmin: true }), null);
    assert.equal(lensOwnerlessDenial({ ctx: INTERNAL, ...base }), null);
    assert.equal(
      lensOwnerlessDenial({ ctx: { actor: { internal: true, userId: "anon" } }, ...base }),
      null,
    );
  });

  it("allows a moderator on a social domain only", () => {
    assert.equal(lensOwnerlessDenial({ ctx: MOD, ...base, isSocialDomain: true }), null);
    assert.deepEqual(lensOwnerlessDenial({ ctx: MOD, ...base, isSocialDomain: false }), FORBIDDEN_UPDATE);
  });

  it("AUTH_MODE=public never denies (solo local-first: the only user is anon)", () => {
    assert.equal(lensOwnerlessDenial({ ctx: ANON, ...base, authMode: "public" }), null);
    assert.equal(lensOwnerlessDenial({ ctx: MEMBER, ...base, authMode: "public" }), null);
    assert.equal(lensOwnerlessDenial({ ctx: NO_ACTOR, ...base, authMode: "public" }), null);
  });

  it("returns fresh objects — mutating one denial does not affect the next", () => {
    const first = lensOwnerlessDenial({ ctx: MEMBER, ...base });
    first.error = "tampered";
    assert.deepEqual(lensOwnerlessDenial({ ctx: MEMBER, ...base }), FORBIDDEN_UPDATE);
  });
});

describe("lens-ownerless-write — server.js wiring (source order)", () => {
  const start = SERVER_JS.indexOf('register("lens", "update"');
  const end = SERVER_JS.indexOf('register("lens", "delete"', start + 1);
  const body = SERVER_JS.slice(start, end);

  it("server.js imports the ownerless helpers from lib/lens-update-gate.js", () => {
    assert.ok(
      SERVER_JS.includes("lensOwnerlessDenial, isOwnerlessArtifact"),
      "import present",
    );
  });

  it("lens.update branches on isOwnerlessArtifact and the short-circuit clause is gone", () => {
    assert.ok(start > 0 && end > start, "handler block located");
    assert.ok(body.includes("isOwnerlessArtifact(artifact)"), "ownerless branch present");
    assert.ok(
      !body.includes('artifact.ownerId && artifact.ownerId !== "anon"'),
      "old short-circuit clause removed",
    );
  });

  it("the ownerless gate runs before status validation, the first assignment and the emit", () => {
    const gateAt = body.indexOf("lensOwnerlessDenial({");
    const statusAt = body.indexOf("getValidTransitions");
    const assignAt = body.indexOf("artifact.title =");
    const emitAt = body.indexOf("_lensEmitDTU");
    assert.ok(gateAt > 0, "ownerless gate called");
    assert.ok(body.includes("authMode: AUTH_MODE"), "gate receives the server's AUTH_MODE");
    assert.ok(statusAt > gateAt, "status-transition validation stays after the gate");
    assert.ok(assignAt > gateAt, "gate precedes the first artifact assignment");
    assert.ok(emitAt > gateAt, "gate precedes _lensEmitDTU (no emit on denial)");
  });

  it("the /publish route gates ownerless artifacts before the visibility flip", () => {
    const pStart = SERVER_JS.indexOf('app.post("/api/lens/:domain/:id/publish"');
    const pEnd = SERVER_JS.indexOf('app.post("/api/lens/:domain/:id/run"', pStart + 1);
    const route = SERVER_JS.slice(pStart, pEnd);
    assert.ok(pStart > 0 && pEnd > pStart, "publish route located");
    const gateAt = route.indexOf("lensOwnerlessDenial({");
    const flipAt = route.indexOf('artifact.meta.visibility = "published"');
    assert.ok(route.includes("isOwnerlessArtifact(artifact)"), "ownerless branch present in route");
    assert.ok(gateAt > 0, "ownerless gate called in route");
    assert.ok(flipAt > gateAt, "gate precedes the visibility flip");
    assert.ok(
      route.includes("_lensIsOwnerActor(ctx, artifact)"),
      "owned artifacts use the full ownership helper (createdBy counts)",
    );
    assert.ok(
      !route.includes('artifact.ownerId && artifact.ownerId !== "anon"'),
      "old publish short-circuit removed",
    );
  });
});
