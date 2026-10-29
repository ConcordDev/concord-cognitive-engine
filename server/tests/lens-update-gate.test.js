// Lens update gate — security regression tests (HANDOFF-SEC-2 Fix 7).
//
// Pins the fix for: lens.update skipped its ownership check entirely on
// social domains (forum, feed, marketplace, collab, thread, vote,
// alliance, global, news, questmarket), so any signed-in member could
// overwrite any other user's artifact title/data/meta — a forum post
// body, a marketplace listing's price/status, a collab session.
//
// Two layers:
//   1. Unit tests for lensUpdateDenial in lib/lens-update-gate.js.
//   2. Source assertions that server.js's lens.update handler calls the
//      gate before the status validation, the first artifact assignment
//      and the _lensEmitDTU emit — and that the social bypass is gone.
//      (Fix 10 later replaced the owned-artifact clause with an
//      isOwnerlessArtifact branch; the ordering assertions below pin
//      the current shape — see tests/lens-ownerless-write.test.js.)

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { lensUpdateDenial, isModeratorActor } from "../lib/lens-update-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const MEMBER = { actor: { userId: "member-1", role: "member" } };
const MOD = { actor: { userId: "mod-1", role: "moderator" } };
const MOD_VIA_ROLES = { actor: { userId: "mod-2", role: "member", roles: ["member", "Moderator"] } };
const ANON = { actor: { userId: "anon" } };
const NO_ACTOR = {};
const INTERNAL = { internal: true, actor: { userId: "anon" } };

const FORBIDDEN = {
  ok: false,
  status: 403,
  code: "FORBIDDEN",
  error: "unauthorized: you can only update your own artifacts",
};
const AUTH_REQUIRED = {
  ok: false,
  status: 401,
  code: "AUTH_REQUIRED",
  error: "sign in required",
};

describe("lens-update-gate — lensUpdateDenial unit", () => {
  it("allows the owner on any domain", () => {
    assert.equal(lensUpdateDenial({ ctx: MEMBER, isOwner: true, isAdmin: false, isSocialDomain: true }), null);
    assert.equal(lensUpdateDenial({ ctx: MEMBER, isOwner: true, isAdmin: false, isSocialDomain: false }), null);
  });

  it("allows an admin who is not the owner", () => {
    assert.equal(lensUpdateDenial({ ctx: MEMBER, isOwner: false, isAdmin: true, isSocialDomain: true }), null);
  });

  it("allows internal callers regardless of ownership", () => {
    assert.equal(lensUpdateDenial({ ctx: INTERNAL, isOwner: false, isAdmin: false, isSocialDomain: true }), null);
    assert.equal(lensUpdateDenial({ ctx: { actor: { internal: true } }, isOwner: false, isAdmin: false, isSocialDomain: false }), null);
  });

  it("allows a moderator on a social domain (the forum lock path)", () => {
    assert.equal(lensUpdateDenial({ ctx: MOD, isOwner: false, isAdmin: false, isSocialDomain: true }), null);
    assert.equal(lensUpdateDenial({ ctx: MOD_VIA_ROLES, isOwner: false, isAdmin: false, isSocialDomain: true }), null);
  });

  it("denies a moderator on a NON-social domain they do not own", () => {
    assert.deepEqual(lensUpdateDenial({ ctx: MOD, isOwner: false, isAdmin: false, isSocialDomain: false }), FORBIDDEN);
  });

  it("denies a plain member updating another user's social artifact", () => {
    for (const isSocialDomain of [true, false]) {
      assert.deepEqual(
        lensUpdateDenial({ ctx: MEMBER, isOwner: false, isAdmin: false, isSocialDomain }),
        FORBIDDEN,
      );
    }
  });

  it("denies anonymous callers 401 (after the allow checks)", () => {
    assert.deepEqual(lensUpdateDenial({ ctx: ANON, isOwner: false, isAdmin: false, isSocialDomain: true }), AUTH_REQUIRED);
    assert.deepEqual(lensUpdateDenial({ ctx: NO_ACTOR, isOwner: false, isAdmin: false, isSocialDomain: false }), AUTH_REQUIRED);
  });

  it("returns fresh objects — mutating one denial does not affect the next", () => {
    const first = lensUpdateDenial({ ctx: MEMBER, isOwner: false, isAdmin: false, isSocialDomain: true });
    first.error = "tampered";
    assert.deepEqual(lensUpdateDenial({ ctx: MEMBER, isOwner: false, isAdmin: false, isSocialDomain: true }), FORBIDDEN);
  });

  it("isModeratorActor reads role and roles[], case-insensitively", () => {
    assert.equal(isModeratorActor(MOD), true);
    assert.equal(isModeratorActor(MOD_VIA_ROLES), true);
    assert.equal(isModeratorActor({ actor: { role: "SOVEREIGN" } }), true);
    assert.equal(isModeratorActor(MEMBER), false);
    assert.equal(isModeratorActor(NO_ACTOR), false);
  });
});

describe("lens-update-gate — server.js handler wiring (source order)", () => {
  const start = SERVER_JS.indexOf('register("lens", "update"');
  const end = SERVER_JS.indexOf('register("lens", "delete"', start + 1);
  const body = SERVER_JS.slice(start, end);

  it("the lens.update handler is found before lens.delete", () => {
    assert.ok(start > 0 && end > start, "handler block located");
  });

  it("server.js imports the gate from lib/lens-update-gate.js", () => {
    assert.ok(SERVER_JS.includes('from "./lib/lens-update-gate.js"'), "import present");
  });

  it("the social-domain bypass is gone", () => {
    assert.ok(
      !body.includes("!LENS_SOCIAL_DOMAINS.has(artifact.domain) && artifact.ownerId"),
      "old bypass condition removed",
    );
  });

  it("the gate runs before status validation and any mutation (owned + ownerless branches, Fix 10)", () => {
    // Fix 10 removed the owned-artifact clause this test originally
    // pinned: the handler now branches on isOwnerlessArtifact —
    // ownerless artifacts take lensOwnerlessDenial, owned artifacts
    // keep lensUpdateDenial. Both gates must precede every mutation.
    const ownerlessAt = body.indexOf("isOwnerlessArtifact(artifact)");
    const ownerlessGateAt = body.indexOf("lensOwnerlessDenial({");
    const gateAt = body.indexOf("lensUpdateDenial({");
    const statusAt = body.indexOf("getValidTransitions");
    const assignAt = body.indexOf("artifact.title =");
    const emitAt = body.indexOf("_lensEmitDTU");
    assert.ok(ownerlessAt > 0, "ownerless branch present (Fix 10)");
    assert.ok(ownerlessGateAt > ownerlessAt, "ownerless gate called inside its branch");
    assert.ok(gateAt > ownerlessAt, "owned gate still called");
    assert.ok(
      !body.includes('artifact.ownerId && artifact.ownerId !== "anon"'),
      "the ownerless short-circuit clause is gone (Fix 10)",
    );
    assert.ok(statusAt > gateAt && statusAt > ownerlessGateAt, "status-transition validation stays after both gates");
    assert.ok(assignAt > gateAt && assignAt > ownerlessGateAt, "gates precede the first artifact assignment");
    assert.ok(emitAt > gateAt && emitAt > ownerlessGateAt, "gates precede _lensEmitDTU (no emit on denial)");
  });

  it("the gate receives the handler's own owner/admin resolutions and the social flag", () => {
    assert.ok(body.includes("isOwner: _lensIsOwnerActor(ctx, artifact)"), "owner resolved by the existing helper");
    assert.ok(body.includes("isAdmin: _lensIsAdminActor(ctx)"), "admin resolved by the existing helper");
    assert.ok(body.includes("LENS_SOCIAL_DOMAINS.has(artifact.domain)"), "social flag from the existing set");
    assert.ok(body.includes("isSocialDomain: _lensIsSocialDomain"), "social flag passed to the gate (Fix 10 hoisted it for both branches)");
  });
});
