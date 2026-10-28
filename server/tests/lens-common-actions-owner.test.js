// COMMON_ACTIONS owner check — _requirePersistedLensArtifact used to resolve any
// artifact id with no ownership test, so any signed-in user could save/publish/
// archive/lock/tag/duplicate (and so read) another user's private artifact.
// Write actions follow lens.update's rule; engagement + duplicate follow
// _lensArtifactVisible; refusals look like a missing artifact.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { load } from "./depth/_harness.js";

describe("COMMON_ACTIONS owner/visibility gate", () => {
  let STATE, LENS_ACTIONS;
  const A = "ca-owner-a";
  const B = "ca-other-b";
  const ADMIN = "ca-admin";

  before(async () => {
    const t = await load();
    STATE = t.STATE;
    LENS_ACTIONS = t.LENS_ACTIONS || globalThis.__concordLensActions;
    assert.ok(LENS_ACTIONS, "LENS_ACTIONS missing");
  });

  const ctx = (userId, role = "member") => ({ actor: { userId, role }, userId });
  const act = (name, c, id, params = {}) =>
    LENS_ACTIONS.get(`research.${name}`)(c, { id: null, domain: "research", data: {}, meta: {} }, { id, ...params });

  function seed(visibility = "private") {
    const id = `lart-ca-${randomUUID()}`;
    STATE.lensArtifacts.set(id, {
      id, domain: "research", type: "note", ownerId: A, createdBy: A,
      title: "A note", data: { secret: "s3cret" }, meta: { visibility },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1,
    });
    return id;
  }

  it("B cannot mutate or copy A's private artifact; data unchanged", () => {
    const id = seed();
    const before = JSON.stringify(STATE.lensArtifacts.get(id));
    const sizeBefore = STATE.lensArtifacts.size;
    const calls = {
      save: { title: "pwn", x: 1 }, publish: {}, archive: {}, lock: {}, pin: {}, star: {},
      tag: { tag: "evil" }, assign: { assignee: "me" }, status: { status: "done" },
      priority: { priority: 9 }, move: { column: "done" },
      duplicate: {}, comment: { text: "hi" }, like: {}, share: {}, vote: { direction: 1 },
      rate: { rating: 5 }, bookmark: {}, repost: {}, dislike: {},
    };
    for (const [name, params] of Object.entries(calls)) {
      const r = act(name, ctx(B), id, params);
      assert.equal(r.ok, false, `${name} must be refused`);
      assert.match(r.error, /not found/i, `${name} must look like a missing artifact`);
    }
    assert.equal(JSON.stringify(STATE.lensArtifacts.get(id)), before);
    assert.equal(STATE.lensArtifacts.size, sizeBefore, "no copy may be created");
  });

  it("A (owner) can act on the private artifact", () => {
    const id = seed();
    assert.equal(act("save", ctx(A), id, { note: "x" }).ok, true);
    assert.equal(act("tag", ctx(A), id, { tag: "mine" }).ok, true);
    assert.equal(act("lock", ctx(A), id).ok, true);
    assert.equal(act("archive", ctx(A), id).ok, true);
    assert.equal(act("publish", ctx(A), id).ok, true);
    assert.equal(STATE.lensArtifacts.get(id).meta.visibility, "public");
  });

  it("admin can act on A's private artifact", () => {
    const id = seed();
    assert.equal(act("tag", ctx(ADMIN, "admin"), id, { tag: "mod" }).ok, true);
    assert.equal(act("archive", ctx(ADMIN, "admin"), id).ok, true);
  });

  it("B can like/comment/duplicate a published artifact; copy is B's and private", () => {
    const id = seed("published");
    assert.equal(act("like", ctx(B), id).ok, true);
    assert.equal(act("comment", ctx(B), id, { text: "nice" }).ok, true);
    const dup = act("duplicate", ctx(B), id);
    assert.equal(dup.ok, true, JSON.stringify(dup));
    const copy = STATE.lensArtifacts.get(dup.artifact.id);
    assert.equal(copy.ownerId, B);
    assert.equal(copy.createdBy, B);
    assert.equal(copy.meta.visibility, "private");
    assert.notEqual(copy.id, id);
    // B still cannot write to the published source itself.
    assert.equal(act("lock", ctx(B), id).ok, false);
    assert.equal(act("save", ctx(B), id, { z: 1 }).ok, false);
    // A cannot see B's private copy via duplicate-then-act as someone else.
    assert.equal(act("save", ctx("ca-third"), copy.id, { z: 1 }).ok, false);
    assert.notEqual(copy.meta.status, "published", "a private copy is not marked published");
  });

  it("social-domain post: B can engage but cannot take it over (lock/archive/publish/save)", () => {
    const id = `lart-ca-${randomUUID()}`;
    STATE.lensArtifacts.set(id, {
      id, domain: "forum", type: "post", ownerId: A, createdBy: A, title: "A post",
      data: { body: "hello" }, meta: { visibility: "public", status: "published" },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), version: 1,
    });
    const run = (name, c, params = {}) =>
      LENS_ACTIONS.get(`forum.${name}`)(c, { id: null, domain: "forum", data: {}, meta: {} }, { id, ...params });
    assert.equal(run("like", ctx(B)).ok, true);
    assert.equal(run("comment", ctx(B), { text: "hi" }).ok, true);
    const before = JSON.stringify(STATE.lensArtifacts.get(id).meta);
    for (const name of ["lock", "archive", "save", "publish", "star"]) {
      assert.equal(run(name, ctx(B), { title: "pwn" }).ok, false, `${name} by non-owner must be refused`);
    }
    assert.equal(JSON.stringify(STATE.lensArtifacts.get(id).meta), before);
    assert.equal(run("lock", ctx(A)).ok, true, "owner can still lock");
    STATE.lensArtifacts.delete(id);
  });
});
