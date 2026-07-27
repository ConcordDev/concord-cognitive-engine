// tests/depth/collab-session-membership-behavior.test.js — REAL behavioral
// tests for the `register("collab", ...)` real-time editing-session macros
// (createSession/join/edit/merge — the in-memory COLLAB_SESSIONS Map family,
// distinct from the Yjs/lensArtifacts "docCreate"/"sessionJoin" family already
// covered by collab-behavior.test.js).
//
// Pins the audit fix (2026-07-27, Gate-2 publicReadDomains sweep): these four
// macros used to trust input.userId (a caller-supplied request field) as the
// acting identity, and edit()/merge() never checked session participation at
// all — any caller could impersonate an arbitrary userId while editing a
// session they never created, and merge a stranger's pending changes into a
// real DTU with zero membership check.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime, depthCtx } from "./_harness.js";

describe("collab session macros — real identity + membership enforcement", () => {
  let runMacro;
  let ownerCtx, outsiderCtx;

  before(async () => {
    ({ runMacro, ctx: ownerCtx } = await macroRuntime("collab-owner-1"));
    outsiderCtx = await depthCtx("collab-outsider-1");
  });

  it("createSession stamps the REAL actor as creator, ignoring any input.userId spoof", async () => {
    const r = await runMacro("collab", "createSession", { dtuId: "dtu-1", userId: "spoofed-identity" }, ownerCtx);
    assert.equal(r.ok, true);
    assert.equal(r.session.creatorId, "collab-owner-1");
    assert.equal(r.session.participants[0].userId, "collab-owner-1");
  });

  it("join adds the REAL actor as a participant, ignoring any input.userId spoof", async () => {
    const created = await runMacro("collab", "createSession", { dtuId: "dtu-2" }, ownerCtx);
    const r = await runMacro("collab", "join", { sessionId: created.session.id, userId: "spoofed-identity" }, outsiderCtx);
    assert.equal(r.ok, true);
    assert.ok(r.session.participants.some((p) => p.userId === "collab-outsider-1"));
    assert.ok(!r.session.participants.some((p) => p.userId === "spoofed-identity"));
  });

  it("edit is rejected for a caller who never joined the session", async () => {
    const created = await runMacro("collab", "createSession", { dtuId: "dtu-3" }, ownerCtx);
    const r = await runMacro("collab", "edit", { sessionId: created.session.id, operation: "update", path: "title", value: "Hacked" }, outsiderCtx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_a_participant");
  });

  it("edit succeeds once the caller has actually joined, and stamps their real identity on the change", async () => {
    const created = await runMacro("collab", "createSession", { dtuId: "dtu-4" }, ownerCtx);
    await runMacro("collab", "join", { sessionId: created.session.id }, outsiderCtx);
    const r = await runMacro("collab", "edit", { sessionId: created.session.id, operation: "update", path: "title", value: "Legit edit" }, outsiderCtx);
    assert.equal(r.ok, true);
    assert.equal(r.change.userId, "collab-outsider-1");
  });

  it("merge is rejected for a caller who never joined the session, even though the session id is guessable/enumerable", async () => {
    const created = await runMacro("collab", "createSession", { dtuId: "dtu-5" }, ownerCtx);
    await runMacro("collab", "edit", { sessionId: created.session.id, operation: "update", path: "title", value: "Owner edit" }, ownerCtx);
    const r = await runMacro("collab", "merge", { sessionId: created.session.id }, outsiderCtx);
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_a_participant");
  });

  it("merge succeeds for an actual participant (owner) and queues for council review", async () => {
    const created = await runMacro("collab", "createSession", { dtuId: "dtu-6" }, ownerCtx);
    await runMacro("collab", "edit", { sessionId: created.session.id, operation: "update", path: "title", value: "Owner edit" }, ownerCtx);
    const r = await runMacro("collab", "merge", { sessionId: created.session.id }, ownerCtx);
    assert.equal(r.ok, true);
    assert.equal(r.queuedChanges, 1);
  });
});
