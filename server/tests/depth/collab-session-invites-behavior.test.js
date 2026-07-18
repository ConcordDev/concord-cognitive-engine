// tests/depth/collab-session-invites-behavior.test.js — REAL behavioral
// tests for the targeted (1:1) session-invitation macros
// (sessionInvite / sessionInviteRespond / sessionInviteList), the
// producer for the collab lens's "Invitations" tab
// (docs/lens-specs/collab-capability-map.md — was GENUINELY MISSING).
//
// Distinct from the pairwise `sessionJoin`/`sessionLeave`/`sessionRoster`
// self-service roster suite in collab-behavior.test.js: these macros model
// an inviter targeting a SPECIFIC invitee, tracked until responded. Accept
// must genuinely reuse the real sessionJoin logic (verified against the
// real roster via an independently-issued sessionRoster read, not just the
// invite's own status field).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";

describe("collab — session invitations (targeted 1:1, producer for the Invitations tab)", () => {
  let ctxA, ctxB, ctxC, STATE;

  before(async () => {
    const harness = await load();
    STATE = harness.STATE;
    ctxA = await depthCtx("collab-invite-a");
    ctxB = await depthCtx("collab-invite-b");
    ctxC = await depthCtx("collab-invite-c");
  });

  function seedRealSession(id, overrides = {}) {
    STATE.lensArtifacts.set(id, {
      id, domain: "collab", type: "session",
      ownerId: ctxA.actor.userId,
      title: overrides.title || "Depth-test invite session",
      data: {
        name: overrides.title || "Depth-test invite session",
        participants: [],
        projectType: overrides.projectType || "development",
        genre: overrides.genre || ["backend", "api"],
      },
      meta: { tags: [], status: "draft", visibility: "private" },
    });
  }

  it("sessionInvite: creates a real targeted invitation carrying the session's real name/type/genre", async () => {
    const sessionId = "depth-invite-sess-1";
    seedRealSession(sessionId, { title: "Q3 Sprint Room", projectType: "design", genre: ["ui", "ux"] });
    const inv = await lensRun("collab", "sessionInvite", {
      params: { sessionId, inviteeId: ctxB.actor.userId, inviteeName: "Bo", message: "join us" },
    }, ctxA);
    assert.equal(inv.ok, true);
    assert.equal(inv.result.invite.sessionId, sessionId);
    assert.equal(inv.result.invite.sessionName, "Q3 Sprint Room");
    assert.equal(inv.result.invite.projectType, "design");
    assert.deepEqual(inv.result.invite.genre, ["ui", "ux"]);
    assert.equal(inv.result.invite.fromId, ctxA.actor.userId);
    assert.equal(inv.result.invite.toId, ctxB.actor.userId);
    assert.equal(inv.result.invite.toName, "Bo");
    assert.equal(inv.result.invite.message, "join us");
    assert.equal(inv.result.invite.status, "pending");
    assert.ok(typeof inv.result.invite.id === "string" && inv.result.invite.id.length > 0);
  });

  it("validation: sessionInvite to a nonexistent session is rejected", async () => {
    const bad = await lensRun("collab", "sessionInvite", {
      params: { sessionId: "depth-invite-sess-ghost", inviteeId: ctxB.actor.userId },
    }, ctxA);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /session not found/);
  });

  it("validation: self-invite is rejected", async () => {
    const sessionId = "depth-invite-sess-self";
    seedRealSession(sessionId);
    const bad = await lensRun("collab", "sessionInvite", {
      params: { sessionId, inviteeId: ctxA.actor.userId },
    }, ctxA);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cannot invite yourself/);
  });

  it("validation: sessionInvite requires inviteeId and sessionId", async () => {
    const sessionId = "depth-invite-sess-missing-params";
    seedRealSession(sessionId);
    const noInvitee = await lensRun("collab", "sessionInvite", { params: { sessionId } }, ctxA);
    assert.equal(noInvitee.result.ok, false);
    assert.match(noInvitee.result.error, /inviteeId is required/);
    const noSession = await lensRun("collab", "sessionInvite", { params: { inviteeId: ctxB.actor.userId } }, ctxA);
    assert.equal(noSession.result.ok, false);
    assert.match(noSession.result.error, /sessionId is required/);
  });

  it("sessionInviteRespond(accept): genuinely adds the invitee as a REAL roster participant (verified via an independent sessionRoster read)", async () => {
    const sessionId = "depth-invite-sess-accept";
    seedRealSession(sessionId);
    const inv = await lensRun("collab", "sessionInvite", {
      params: { sessionId, inviteeId: ctxB.actor.userId },
    }, ctxA);
    const inviteId = inv.result.invite.id;

    // Before responding, the real roster (independently read by a third
    // user, not the invitee's own echo) must NOT contain the invitee.
    const before = await lensRun("collab", "sessionRoster", { params: { sessionId } }, ctxC);
    assert.equal(before.result.count, 0);

    const resp = await lensRun("collab", "sessionInviteRespond", {
      params: { inviteId, accept: true },
    }, ctxB);
    assert.equal(resp.ok, true);
    assert.equal(resp.result.invite.status, "accepted");
    assert.ok(resp.result.invite.respondedAt > 0);
    // The response itself reports the real join result (not a status-only echo).
    assert.equal(resp.result.joined.count, 1);
    assert.equal(resp.result.joined.participants[0].userId, ctxB.actor.userId);

    // Independent post-accept read confirms the roster genuinely changed.
    const after = await lensRun("collab", "sessionRoster", { params: { sessionId } }, ctxC);
    assert.equal(after.result.count, 1);
    assert.equal(after.result.participants[0].userId, ctxB.actor.userId);
  });

  it("sessionInviteRespond(decline): marks declined with NO participant side effect", async () => {
    const sessionId = "depth-invite-sess-decline";
    seedRealSession(sessionId);
    const inv = await lensRun("collab", "sessionInvite", {
      params: { sessionId, inviteeId: ctxB.actor.userId },
    }, ctxA);
    const resp = await lensRun("collab", "sessionInviteRespond", {
      params: { inviteId: inv.result.invite.id, accept: false },
    }, ctxB);
    assert.equal(resp.ok, true);
    assert.equal(resp.result.invite.status, "declined");
    assert.ok(!("joined" in resp.result), "decline never touches the roster");
    const roster = await lensRun("collab", "sessionRoster", { params: { sessionId } }, ctxC);
    assert.equal(roster.result.count, 0);
  });

  it("validation: responding to a bogus inviteId is rejected honestly", async () => {
    const bad = await lensRun("collab", "sessionInviteRespond", {
      params: { inviteId: "inv_does_not_exist", accept: true },
    }, ctxB);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invitation not found/);
  });

  it("validation: only the real invitee can respond to their invitation", async () => {
    const sessionId = "depth-invite-sess-forbidden";
    seedRealSession(sessionId);
    const inv = await lensRun("collab", "sessionInvite", {
      params: { sessionId, inviteeId: ctxB.actor.userId },
    }, ctxA);
    const bad = await lensRun("collab", "sessionInviteRespond", {
      params: { inviteId: inv.result.invite.id, accept: true },
    }, ctxC);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /forbidden/);
  });

  it("double-response idempotency: responding twice never double-joins or corrupts state", async () => {
    const sessionId = "depth-invite-sess-double";
    seedRealSession(sessionId);
    const inv = await lensRun("collab", "sessionInvite", {
      params: { sessionId, inviteeId: ctxB.actor.userId },
    }, ctxA);
    const inviteId = inv.result.invite.id;

    const first = await lensRun("collab", "sessionInviteRespond", { params: { inviteId, accept: true } }, ctxB);
    assert.equal(first.ok, true);

    // Second response — same invite, same or different answer — must be
    // honestly rejected, never silently re-processed.
    const second = await lensRun("collab", "sessionInviteRespond", { params: { inviteId, accept: true } }, ctxB);
    assert.equal(second.result.ok, false);
    assert.match(second.result.error, /already accepted/);
    const thirdDecline = await lensRun("collab", "sessionInviteRespond", { params: { inviteId, accept: false } }, ctxB);
    assert.equal(thirdDecline.result.ok, false);

    // Roster still has exactly one entry — no duplicate join, no corruption.
    const roster = await lensRun("collab", "sessionRoster", { params: { sessionId } }, ctxC);
    assert.equal(roster.result.count, 1);
    assert.equal(roster.result.participants[0].userId, ctxB.actor.userId);
  });

  it("sessionInviteList: 'received' (default) and 'sent' scopes each return the real, correctly-scoped invites", async () => {
    const sessionId1 = "depth-invite-sess-list-1";
    const sessionId2 = "depth-invite-sess-list-2";
    seedRealSession(sessionId1, { title: "List Room One" });
    seedRealSession(sessionId2, { title: "List Room Two" });

    // A invites B to two different sessions; C invites B to one.
    const invAB1 = await lensRun("collab", "sessionInvite", { params: { sessionId: sessionId1, inviteeId: ctxB.actor.userId } }, ctxA);
    const invAB2 = await lensRun("collab", "sessionInvite", { params: { sessionId: sessionId2, inviteeId: ctxB.actor.userId } }, ctxA);
    seedRealSession("depth-invite-sess-list-3", { title: "List Room Three" });
    // ctxC re-uses ctxA's owned session artifact for a 3rd invite to keep the fixture simple —
    // ownership of the session artifact is irrelevant to invite scoping.
    const invCB = await lensRun("collab", "sessionInvite", { params: { sessionId: "depth-invite-sess-list-3", inviteeId: ctxB.actor.userId } }, ctxC);

    const received = await lensRun("collab", "sessionInviteList", {}, ctxB);
    assert.equal(received.ok, true);
    assert.equal(received.result.scope, "received");
    const receivedIds = received.result.invitations.map((i) => i.id);
    assert.ok(receivedIds.includes(invAB1.result.invite.id));
    assert.ok(receivedIds.includes(invAB2.result.invite.id));
    assert.ok(receivedIds.includes(invCB.result.invite.id));
    assert.ok(received.result.invitations.every((i) => i.toId === ctxB.actor.userId));

    const sentByA = await lensRun("collab", "sessionInviteList", { params: { scope: "sent" } }, ctxA);
    assert.equal(sentByA.result.scope, "sent");
    const sentIds = sentByA.result.invitations.map((i) => i.id);
    assert.ok(sentIds.includes(invAB1.result.invite.id));
    assert.ok(sentIds.includes(invAB2.result.invite.id));
    assert.ok(!sentIds.includes(invCB.result.invite.id), "C's invite must not appear in A's sent list");
    assert.ok(sentByA.result.invitations.every((i) => i.fromId === ctxA.actor.userId));

    // B never sent anything in this test.
    const sentByB = await lensRun("collab", "sessionInviteList", { params: { scope: "sent" } }, ctxB);
    assert.equal(sentByB.result.invitations.length, 0);
  });
});
