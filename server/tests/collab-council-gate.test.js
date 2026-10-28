// Collab council gate — security regression tests.
//
// Pins the fix for: `collab.run_council` let ANY signed-in member start a
// council vote on ANY member's collab session artifact because `collab` is
// a LENS_SOCIAL_DOMAINS domain on the generic lens run path. The action
// OVERWRITES artifact.data.councilVote — replacing an in-progress council
// vote with a new "pending" one on an attacker-chosen topic. Product
// default (safest): only the session owner, a moderator-class role, or an
// internal/admin caller may start a council vote.
//
// Two layers:
//   1. Unit tests for collabCouncilDenial (owner/admin-flag/moderator role/
//      roles array/internal ok, anon 401, member 403, fresh denial objects).
//   2. Source-order assertions that the run_council handler in server.js
//      calls collabCouncilDenial BEFORE the first `artifact.data =` mutation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { collabCouncilDenial } from "../lib/collab-council-gate.js";
import { FORUM_MOD_ROLES } from "../lib/forum-mod-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const ANON_DENIED = Object.freeze({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" });
const MEMBER_DENIED = Object.freeze({ ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: only the session owner or a moderator can start a council vote" });

describe("collab-council-gate — collabCouncilDenial unit", () => {
  it("the session owner is allowed", () => {
    assert.equal(collabCouncilDenial({ isSessionOwner: true, userId: "owner-1", role: "member" }), null);
  });

  it("an admin-flagged actor is allowed (the call site folds _lensIsAdminActor into isSessionOwner)", () => {
    assert.equal(collabCouncilDenial({ isSessionOwner: true, userId: "admin-1", role: "member" }), null);
    assert.equal(collabCouncilDenial({ isSessionOwner: true }), null);
  });

  it("a moderator role is allowed", () => {
    assert.equal(collabCouncilDenial({ isSessionOwner: false, role: "moderator", userId: "mod-1" }), null);
  });

  it("an admin role is allowed via FORUM_MOD_ROLES", () => {
    assert.equal(collabCouncilDenial({ isSessionOwner: false, role: "admin", userId: "admin-1" }), null);
  });

  it("every FORUM_MOD_ROLES string role is allowed", () => {
    for (const role of FORUM_MOD_ROLES) {
      assert.equal(collabCouncilDenial({ userId: "u-" + role, role }), null, role);
    }
  });

  it("the role match is case-insensitive (string and roles array)", () => {
    assert.equal(collabCouncilDenial({ userId: "u1", role: "Moderator" }), null);
    assert.equal(collabCouncilDenial({ userId: "u2", role: "ADMIN" }), null);
  });

  it("a roles array containing a moderator-class role is allowed", () => {
    assert.equal(collabCouncilDenial({ userId: "u3", role: "member", roles: ["member", "moderator"] }), null);
    assert.equal(collabCouncilDenial({ userId: "u4", roles: ["Member", "Sovereign"] }), null);
  });

  it("a roles array with no moderator-class role is denied 403", () => {
    assert.deepEqual(collabCouncilDenial({ userId: "u5", roles: ["member", "viewer"] }), MEMBER_DENIED);
  });

  it("internal callers are allowed", () => {
    assert.equal(collabCouncilDenial({ internal: true, userId: "member-1" }), null);
    assert.equal(collabCouncilDenial({ internal: true }), null);
  });

  it("internal beats the anon sentinel (allow order)", () => {
    assert.equal(collabCouncilDenial({ internal: true, userId: "anon" }), null);
  });

  it("the anon sentinel / missing userId / empty input is denied 401", () => {
    assert.deepEqual(collabCouncilDenial({ userId: "anon", role: "member" }), ANON_DENIED);
    assert.deepEqual(collabCouncilDenial({ role: "member" }), ANON_DENIED);
    assert.deepEqual(collabCouncilDenial({}), ANON_DENIED);
    assert.deepEqual(collabCouncilDenial(undefined), ANON_DENIED);
    assert.deepEqual(collabCouncilDenial(null), ANON_DENIED);
  });

  it("a signed-in plain member is denied 403", () => {
    assert.deepEqual(collabCouncilDenial({ isSessionOwner: false, userId: "member-1", role: "member" }), MEMBER_DENIED);
    assert.deepEqual(collabCouncilDenial({ userId: "member-2" }), MEMBER_DENIED);
    assert.deepEqual(collabCouncilDenial({ userId: "member-3", role: "viewer", roles: ["member", "viewer"] }), MEMBER_DENIED);
  });

  it("denial results are fresh objects every time", () => {
    const a = collabCouncilDenial({ userId: "member-1" });
    const b = collabCouncilDenial({ userId: "member-1" });
    assert.deepEqual(a, b);
    assert.notEqual(a, b);
    a.error = "mutated";
    assert.deepEqual(collabCouncilDenial({ userId: "member-1" }), MEMBER_DENIED);
    const c = collabCouncilDenial({ userId: "anon" });
    const d = collabCouncilDenial({ userId: "anon" });
    assert.deepEqual(c, d);
    assert.notEqual(c, d);
    c.error = "mutated";
    assert.deepEqual(collabCouncilDenial({ userId: "anon" }), ANON_DENIED);
  });
});

describe("collab-council-gate — server.js handler wiring (source order)", () => {
  // Delimit the handler's registration block by the next registration after it.
  const summarizeStart = SERVER_JS.indexOf('registerLensAction("collab", "summarize_thread"');
  const councilStart = SERVER_JS.indexOf('registerLensAction("collab", "run_council"');
  const extractStart = SERVER_JS.indexOf('registerLensAction("collab", "extract_actions"');

  it("the collab action registrations are found in order", () => {
    assert.ok(summarizeStart > 0, "collab.summarize_thread registration found");
    assert.ok(councilStart > summarizeStart, "collab.run_council registration found after collab.summarize_thread");
    assert.ok(extractStart > councilStart, "collab.extract_actions registration found after collab.run_council");
  });

  it("collab.run_council gates with collabCouncilDenial before mutating artifact.data", () => {
    const body = SERVER_JS.slice(councilStart, extractStart);
    const gateAt = body.indexOf("collabCouncilDenial");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(gateAt > 0, "collab.run_council calls collabCouncilDenial");
    assert.ok(mutateAt > 0, "collab.run_council mutates artifact.data");
    assert.ok(gateAt < mutateAt, "collab.run_council: collabCouncilDenial precedes the artifact.data mutation");
  });

  it("the gate call is the first statement of the run_council handler", () => {
    const body = SERVER_JS.slice(councilStart, extractStart);
    const arrowAt = body.indexOf("=> {");
    const handlerBody = body.slice(arrowAt);
    const gateAt = handlerBody.indexOf("collabCouncilDenial");
    const denialReturnAt = handlerBody.indexOf("if (denial) return denial;");
    const voteAt = handlerBody.indexOf("const vote = ");
    assert.ok(arrowAt > 0, "collab.run_council handler body found");
    assert.ok(gateAt > 0, "collab.run_council calls collabCouncilDenial");
    assert.ok(denialReturnAt > gateAt, "collab.run_council: the denial early-return follows the gate call");
    assert.ok(voteAt > denialReturnAt, "collab.run_council: the vote construction follows the denial early-return");
  });

  it("the gate passes the shared owner/admin/role/roles/internal/userId context shape", () => {
    const body = SERVER_JS.slice(councilStart, extractStart);
    assert.ok(body.includes("isSessionOwner: _lensIsOwnerActor(ctx, artifact) || _lensIsAdminActor(ctx)"), "passes the owner-or-admin flag");
    assert.ok(body.includes("role: ctx?.actor?.role"), "passes the actor role");
    assert.ok(body.includes("roles: ctx?.actor?.roles"), "passes the actor roles array");
    assert.ok(body.includes("internal: ctx?.internal === true || ctx?.actor?.internal === true"), "passes the internal flag");
    assert.ok(body.includes("userId: ctx?.actor?.userId"), "passes the actor userId");
  });

  it("server.js imports collabCouncilDenial from lib/collab-council-gate.js", () => {
    assert.ok(
      SERVER_JS.includes('import { collabCouncilDenial } from "./lib/collab-council-gate.js";'),
      "server.js imports the shared gate helper"
    );
  });
});