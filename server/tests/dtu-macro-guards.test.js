// DTU macro guards — security regression tests (HANDOFF-SEC-2 Fix 8).
//
// Pins the fix for: a family of server.js macros (council.credibility,
// schema.apply, the autotag family, scope readers, mobile.touchOptimized,
// vscode.dtuToCode) performed by-id reads/writes on ANY DTU with no
// ctxMayReadDtu / ownership check, and collab.lock/collab.unlock let any
// caller lock/unlock any path in any session with a SPOOFABLE input.userId.
//
// Two layers:
//   1. Unit tests for the three helpers in lib/dtu-macro-guards.js.
//   2. Source-order assertions that every wired handler in server.js calls
//      its guard after the DTU/session lookup and before the first
//      mutation or content-bearing return.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  dtuReadDenial,
  credibilityAdminDenial,
  collabParticipantDenial,
} from "../lib/dtu-macro-guards.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const MEMBER_A = { actor: { id: "user-a", userId: "user-a", role: "member" } };
const MEMBER_B = { actor: { id: "user-b", userId: "user-b", role: "member" } };
const ADMIN = { actor: { id: "root", userId: "root", role: "admin" } };
const ANON = { actor: { userId: "anon" } };
const NO_ACTOR = {};
const INTERNAL = { internal: true, actor: { userId: "anon" } };

const PUBLIC_DTU = { id: "d1", visibility: "public", source: "system", title: "News" };
const PRIVATE_B = { id: "d2", privacy: "private", author: "user-b", title: "B secret" };
const PRIVATE_A = { id: "d3", privacy: "private", author: "user-a", title: "A secret" };
const INTERNAL_DTU = { id: "d4", visibility: "internal", title: "oracle row" };

const NOT_FOUND = { ok: false, status: 404, error: "DTU not found" };
const AUTH_REQUIRED = { ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" };

describe("dtu-macro-guards — dtuReadDenial unit", () => {
  it("allows a member to read a public DTU", () => {
    assert.equal(dtuReadDenial(MEMBER_A, PUBLIC_DTU), null);
  });

  it("allows the owner to read their own private DTU", () => {
    assert.equal(dtuReadDenial(MEMBER_A, PRIVATE_A), null);
  });

  it("denies another member's private DTU with the not-found shape", () => {
    assert.deepEqual(dtuReadDenial(MEMBER_A, PRIVATE_B), NOT_FOUND);
  });

  it("denies a missing DTU with the not-found shape", () => {
    assert.deepEqual(dtuReadDenial(MEMBER_A, null), NOT_FOUND);
    assert.deepEqual(dtuReadDenial(MEMBER_A, undefined), NOT_FOUND);
  });

  it("hides visibility:internal rows from HTTP callers", () => {
    assert.deepEqual(dtuReadDenial(ADMIN, INTERNAL_DTU), NOT_FOUND);
  });

  it("allows internal callers to read anything", () => {
    assert.equal(dtuReadDenial(INTERNAL, PRIVATE_B), null);
    assert.equal(dtuReadDenial(INTERNAL, INTERNAL_DTU), null);
  });

  it("supports an injected mayRead predicate", () => {
    assert.equal(dtuReadDenial(MEMBER_A, PRIVATE_B, () => true), null);
    assert.deepEqual(dtuReadDenial(MEMBER_A, PUBLIC_DTU, () => false), NOT_FOUND);
  });

  it("supports a handler-specific not-found body (scope.* shape)", () => {
    const scopeShape = { ok: false, status: 404, error: "dtu_not_found" };
    assert.deepEqual(dtuReadDenial(MEMBER_A, PRIVATE_B, undefined, scopeShape), scopeShape);
  });

  it("returns fresh objects — mutating one denial does not affect the next", () => {
    const first = dtuReadDenial(MEMBER_A, PRIVATE_B);
    first.error = "tampered";
    first.status = 200;
    assert.deepEqual(dtuReadDenial(MEMBER_A, PRIVATE_B), NOT_FOUND);
  });
});

describe("dtu-macro-guards — credibilityAdminDenial unit", () => {
  it("allows every admin-class role", () => {
    for (const role of ["owner", "admin", "founder", "sovereign", "Admin", "FOUNDER"]) {
      assert.equal(
        credibilityAdminDenial({ actor: { userId: "x", role } }),
        null,
        `role ${role} allowed`,
      );
    }
  });

  it("allows an admin-class role carried in the roles array", () => {
    assert.equal(
      credibilityAdminDenial({ actor: { userId: "x", role: "member", roles: ["member", "admin"] } }),
      null,
    );
  });

  it("allows internal callers", () => {
    assert.equal(credibilityAdminDenial(INTERNAL), null);
    assert.equal(credibilityAdminDenial({ actor: { internal: true } }), null);
  });

  it("denies a plain member 403 — even for their own DTU (handler-level rule)", () => {
    assert.deepEqual(credibilityAdminDenial(MEMBER_A), {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      error: "forbidden: admin role required",
    });
  });

  it("denies anonymous / missing actors 401", () => {
    assert.deepEqual(credibilityAdminDenial(ANON), AUTH_REQUIRED);
    assert.deepEqual(credibilityAdminDenial(NO_ACTOR), AUTH_REQUIRED);
    assert.deepEqual(credibilityAdminDenial({ actor: { role: "member" } }), AUTH_REQUIRED);
  });

  it("returns fresh objects", () => {
    const first = credibilityAdminDenial(MEMBER_A);
    first.error = "tampered";
    assert.equal(credibilityAdminDenial(MEMBER_A).error, "forbidden: admin role required");
  });
});

describe("dtu-macro-guards — collabParticipantDenial unit", () => {
  const SESSION = {
    participants: [
      { userId: "user-a", joinedAt: "t", role: "owner" },
      { userId: "user-c", joinedAt: "t", role: "collaborator" },
    ],
  };

  it("allows session participants", () => {
    assert.equal(collabParticipantDenial(MEMBER_A, SESSION, "user-a"), null);
    assert.equal(
      collabParticipantDenial({ actor: { userId: "user-c", role: "member" } }, SESSION, "user-c"),
      null,
    );
  });

  it("denies a signed-in non-participant 403", () => {
    assert.deepEqual(collabParticipantDenial(MEMBER_B, SESSION, "user-b"), {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      error: "forbidden: join the session first",
    });
  });

  it("denies missing / anon actor ids 401", () => {
    assert.deepEqual(collabParticipantDenial(NO_ACTOR, SESSION, "anonymous"), AUTH_REQUIRED);
    assert.deepEqual(collabParticipantDenial(ANON, SESSION, "anon"), AUTH_REQUIRED);
    assert.deepEqual(collabParticipantDenial(MEMBER_A, SESSION, ""), AUTH_REQUIRED);
    assert.deepEqual(collabParticipantDenial(MEMBER_A, SESSION, null), AUTH_REQUIRED);
  });

  it("allows admins and internal callers who are not participants", () => {
    assert.equal(collabParticipantDenial(ADMIN, SESSION, "root"), null);
    assert.equal(collabParticipantDenial(INTERNAL, SESSION, "anonymous"), null);
  });

  it("returns fresh objects", () => {
    const first = collabParticipantDenial(MEMBER_B, SESSION, "user-b");
    first.error = "tampered";
    assert.equal(
      collabParticipantDenial(MEMBER_B, SESSION, "user-b").error,
      "forbidden: join the session first",
    );
  });
});

describe("dtu-macro-guards — server.js handler wiring (source order)", () => {
  function block(startMarker, endMarker) {
    const start = SERVER_JS.indexOf(startMarker);
    assert.ok(start > 0, `found: ${startMarker}`);
    const end = SERVER_JS.indexOf(endMarker, start + 1);
    assert.ok(end > start, `found end: ${endMarker}`);
    return SERVER_JS.slice(start, end);
  }

  it("server.js imports the guards from lib/dtu-macro-guards.js", () => {
    assert.ok(
      SERVER_JS.includes('from "./lib/dtu-macro-guards.js"'),
      "import present",
    );
  });

  it("council.credibility: admin gate, then read gate, before the credibility write", () => {
    const body = block('register("council", "credibility"', 'register("council", "list"');
    const adminAt = body.indexOf("credibilityAdminDenial");
    const readAt = body.indexOf("dtuReadDenial");
    const writeAt = body.indexOf("dtu.authority.credibility =");
    assert.ok(adminAt > 0 && readAt > adminAt, "admin gate precedes read gate");
    assert.ok(writeAt > readAt, "both gates precede the credibility write");
  });

  it("schema.apply: lookup + read + mutation gates before validate and usageCount++", () => {
    const body = block('register("schema", "apply"', 'register("schema", "evolve"');
    const lookupAt = body.indexOf("STATE.dtus.get(dtuId)");
    const readAt = body.indexOf("dtuReadDenial");
    const mutationAt = body.indexOf("dtuMutationDenial");
    const validateAt = body.indexOf('runMacro("schema", "validate"');
    const bumpAt = body.indexOf("schema.usageCount++");
    assert.ok(lookupAt > 0 && readAt > lookupAt, "read gate after lookup");
    assert.ok(mutationAt > readAt, "mutation gate after read gate");
    assert.ok(validateAt > mutationAt, "validate runs after both gates");
    assert.ok(bumpAt > validateAt, "usageCount bump stays after validate");
  });

  it("autotag.apply: read + mutation gates before the first tag write", () => {
    const body = block('register("autotag", "apply"', 'register("autotag", "batchProcess"');
    const readAt = body.indexOf("dtuReadDenial");
    const mutationAt = body.indexOf("dtuMutationDenial");
    const writeAt = body.indexOf("dtu.tags =");
    assert.ok(readAt > 0 && mutationAt > readAt, "gates in order");
    assert.ok(writeAt > mutationAt, "gates precede the tag write");
  });

  it("autotag.batchProcess: candidate filter runs before the limit slice", () => {
    const body = block('register("autotag", "batchProcess"', 'register("visual", "moodboard"');
    const filterAt = body.indexOf("ctxMayReadDtu(ctx, d) && !dtuMutationDenial(d, ctx");
    const sliceAt = body.indexOf("dtus.slice(0");
    assert.ok(filterAt > 0, "read+mutation candidate filter present");
    assert.ok(sliceAt > filterAt, "filter precedes the slice");
  });

  it("autotag.analyze: read gate before content use; relations loop skips unreadable DTUs", () => {
    const body = block('register("autotag", "analyze"', 'register("autotag", "apply"');
    const readAt = body.indexOf("dtuReadDenial");
    const textAt = body.indexOf("const text =");
    assert.ok(readAt > 0 && textAt > readAt, "read gate precedes content use");
    assert.ok(
      body.includes("if (!ctxMayReadDtu(ctx, d)) continue;"),
      "suggestedRelations skips DTUs the caller may not read",
    );
  });

  it("autotag.classify: read gate before classification reads the DTU", () => {
    const body = block('register("autotag", "classify"', "autotag_init");
    const readAt = body.indexOf("dtuReadDenial");
    const classifyAt = body.indexOf("autoClassifyDTU(dtu)");
    assert.ok(readAt > 0 && classifyAt > readAt, "read gate precedes autoClassifyDTU");
  });

  it("scope.promote: keeps the no_user check, read gate after lookup", () => {
    const body = block('register("scope", "promote"', 'register("scope", "checkCitations"');
    assert.ok(body.includes('reason: "no_user"'), "existing no_user check kept");
    const lookupAt = body.indexOf("STATE.dtus.get(dtuId)");
    const readAt = body.indexOf("dtuReadDenial");
    const scopeWriteAt = body.indexOf("dtu.scope === targetScope");
    assert.ok(readAt > lookupAt, "read gate after lookup");
    assert.ok(scopeWriteAt > readAt, "read gate precedes scope handling");
  });

  it("scope.checkCitations: read gate before verifyCitationIntegrity", () => {
    const body = block('register("scope", "checkCitations"', 'register("scope", "royaltyPreview"');
    const readAt = body.indexOf("dtuReadDenial");
    const callAt = body.indexOf("verifyCitationIntegrity(dtu)");
    assert.ok(readAt > 0 && callAt > readAt, "read gate precedes the integrity read");
  });

  it("scope.royaltyPreview: read gate before computeRoyaltyCascade", () => {
    const body = block('register("scope", "royaltyPreview"', 'app.post("/api/scope/promote"');
    const readAt = body.indexOf("dtuReadDenial");
    const callAt = body.indexOf("computeRoyaltyCascade(dtu)");
    assert.ok(readAt > 0 && callAt > readAt, "read gate precedes the cascade read");
  });

  it("mobile.touchOptimized: read gate before the compact view is built", () => {
    const body = block('register("mobile", "touchOptimized"', 'register("sync", "force"');
    const readAt = body.indexOf("dtuReadDenial");
    const viewAt = body.indexOf("compactView");
    assert.ok(readAt > 0 && viewAt > readAt, "read gate precedes the content return");
  });

  it("vscode.dtuToCode: read gate before code is read out of the DTU", () => {
    const body = block('register("vscode", "dtuToCode"', 'register("vscode", "search"');
    const readAt = body.indexOf("dtuReadDenial");
    const codeAt = body.indexOf("dtu.machine?.code");
    assert.ok(readAt > 0 && codeAt > readAt, "read gate precedes the code read");
  });

  it("collab.lock: actor id from ctx (input.userId ignored), participant gate before the lock write", () => {
    const body = block('register("collab", "lock"', 'register("collab", "unlock"');
    assert.ok(!body.includes("userId, path } = input"), "input.userId no longer destructured");
    assert.ok(body.includes("const actorId = _collabActorId(ctx);"), "actor id from ctx");
    const gateAt = body.indexOf("collabParticipantDenial");
    const writeAt = body.indexOf("COLLAB_LOCKS.set");
    assert.ok(gateAt > 0 && writeAt > gateAt, "participant gate precedes the lock write");
    assert.ok(body.includes("userId: actorId"), "lock stores the actor id");
  });

  it("collab.unlock: participant gate + holder check before the lock delete", () => {
    const body = block('register("collab", "unlock"', 'register("whiteboard", "create"');
    const gateAt = body.indexOf("collabParticipantDenial");
    const holderAt = body.indexOf("forbidden: lock held by another user");
    const deleteAt = body.indexOf("COLLAB_LOCKS.delete");
    assert.ok(gateAt > 0 && holderAt > gateAt, "holder check after participant gate");
    assert.ok(deleteAt > holderAt, "both checks precede the delete");
  });
});
