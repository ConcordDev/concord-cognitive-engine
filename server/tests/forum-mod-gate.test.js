// Forum moderation gate — security regression tests.
//
// Pins the fix for: `forum.pin` / `forum.moderate` lens actions let ANY
// signed-in member mutate ANY forum post artifact (pinned flag,
// moderationStatus/moderatedBy) because `forum` is a LENS_SOCIAL_DOMAINS
// domain on the generic lens run path. Product default (safest): only
// moderator-class roles may pin/unpin or moderate.
//
// Two layers:
//   1. Unit tests for forumModDenial (member 403, anon 401, every
//      moderator-class role allowed, roles array allowed, internal allowed).
//   2. Source-order assertions that BOTH handlers in server.js call
//      forumModDenial BEFORE the first `artifact.data =` mutation.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { forumModDenial, FORUM_MOD_ROLES } from "../lib/forum-mod-gate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_JS = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");

const MEMBER_DENIED = Object.freeze({ ok: false, status: 403, code: "FORBIDDEN", error: "forbidden: moderator role required" });
const ANON_DENIED = Object.freeze({ ok: false, status: 401, code: "AUTH_REQUIRED", error: "sign in required" });

describe("forum-mod-gate — forumModDenial unit", () => {
  it("a signed-in plain member is denied 403", () => {
    assert.deepEqual(forumModDenial({ actor: { userId: "member-1", role: "member" } }), MEMBER_DENIED);
  });

  it("a member with no role at all is denied 403", () => {
    assert.deepEqual(forumModDenial({ actor: { userId: "member-2" } }), MEMBER_DENIED);
  });

  it("an unknown/non-moderator role string is denied 403", () => {
    assert.deepEqual(forumModDenial({ actor: { userId: "member-3", role: "viewer" } }), MEMBER_DENIED);
  });

  it("the anon sentinel is denied 401", () => {
    assert.deepEqual(forumModDenial({ actor: { userId: "anon", role: "member" } }), ANON_DENIED);
  });

  it("a missing userId is denied 401", () => {
    assert.deepEqual(forumModDenial({ actor: { role: "member" } }), ANON_DENIED);
  });

  it("an empty ctx (no actor) is denied 401", () => {
    assert.deepEqual(forumModDenial({}), ANON_DENIED);
    assert.deepEqual(forumModDenial(undefined), ANON_DENIED);
    assert.deepEqual(forumModDenial(null), ANON_DENIED);
  });

  it("every FORUM_MOD_ROLES string role is allowed", () => {
    for (const role of FORUM_MOD_ROLES) {
      assert.equal(forumModDenial({ actor: { userId: "u-" + role, role } }), null, role);
    }
  });

  it("the role match is case-insensitive", () => {
    assert.equal(forumModDenial({ actor: { userId: "u1", role: "Moderator" } }), null);
    assert.equal(forumModDenial({ actor: { userId: "u2", role: "ADMIN" } }), null);
  });

  it("a roles array containing a moderator-class role is allowed", () => {
    assert.equal(forumModDenial({ actor: { userId: "u3", role: "member", roles: ["member", "moderator"] } }), null);
    assert.equal(forumModDenial({ actor: { userId: "u4", roles: ["Member", "Sovereign"] } }), null);
  });

  it("a roles array with no moderator-class role is denied 403", () => {
    assert.deepEqual(forumModDenial({ actor: { userId: "u5", roles: ["member", "viewer"] } }), MEMBER_DENIED);
  });

  it("internal ctx / internal actor is allowed", () => {
    assert.equal(forumModDenial({ internal: true }), null);
    assert.equal(forumModDenial({ actor: { internal: true } }), null);
    assert.equal(forumModDenial({ internal: true, actor: { userId: "anon" } }), null);
  });

  it("FORUM_MOD_ROLES is the frozen moderator-class set from domains/forum.js", () => {
    assert.equal(Object.isFrozen(FORUM_MOD_ROLES), true);
    assert.deepEqual([...FORUM_MOD_ROLES].sort(), ["admin", "founder", "moderator", "owner", "sovereign"]);
  });
});

describe("forum-mod-gate — server.js handler wiring (source order)", () => {
  // Delimit each handler's registration block by the next registration after it.
  const pinStart = SERVER_JS.indexOf('registerLensAction("forum", "pin"');
  const moderateStart = SERVER_JS.indexOf('registerLensAction("forum", "moderate"');
  const rankStart = SERVER_JS.indexOf('registerLensAction("forum", "rank_posts"');

  it("all three forum action registrations are found in order", () => {
    assert.ok(pinStart > 0, "forum.pin registration found");
    assert.ok(moderateStart > pinStart, "forum.moderate registration found after forum.pin");
    assert.ok(rankStart > moderateStart, "forum.rank_posts registration found after forum.moderate");
  });

  it("forum.pin gates with forumModDenial before mutating artifact.data", () => {
    const body = SERVER_JS.slice(pinStart, moderateStart);
    const gateAt = body.indexOf("forumModDenial");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(gateAt > 0, "forum.pin calls forumModDenial");
    assert.ok(mutateAt > 0, "forum.pin mutates artifact.data");
    assert.ok(gateAt < mutateAt, "forum.pin: forumModDenial precedes the artifact.data mutation");
  });

  it("forum.moderate gates with forumModDenial before mutating artifact.data", () => {
    const body = SERVER_JS.slice(moderateStart, rankStart);
    const gateAt = body.indexOf("forumModDenial");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(gateAt > 0, "forum.moderate calls forumModDenial");
    assert.ok(mutateAt > 0, "forum.moderate mutates artifact.data");
    assert.ok(gateAt < mutateAt, "forum.moderate: forumModDenial precedes the artifact.data mutation");
  });

  it("forum.moderate validates the action against the allowlist before mutating", () => {
    const body = SERVER_JS.slice(moderateStart, rankStart);
    const allowlistAt = body.indexOf("invalid moderation action");
    const mutateAt = body.indexOf("artifact.data =");
    assert.ok(allowlistAt > 0, "forum.moderate rejects unknown actions");
    assert.ok(allowlistAt < mutateAt, "forum.moderate: allowlist check precedes the artifact.data mutation");
    for (const action of ["flag", "approve", "remove", "lock", "unlock", "hide", "restore"]) {
      assert.ok(body.includes(`"${action}"`), `allowlist contains "${action}"`);
    }
  });

  it("server.js imports forumModDenial from lib/forum-mod-gate.js", () => {
    assert.ok(
      SERVER_JS.includes('import { forumModDenial } from "./lib/forum-mod-gate.js";'),
      "server.js imports the shared gate helper"
    );
  });
});