/**
 * App-maker pipeline (Group B B7) — the founder-ruled owner-promote slice.
 *
 * Founder ruling (decision walk #1, Decision 11): promote is an owner action
 * checked against OWNERSHIP, not a platform role. The REST routes in
 * server.js are thin glue over the helpers pinned here:
 *   - POST /api/apps stamps `author` from the authenticated caller
 *     (appCallerKey) — a client-supplied author is ignored;
 *   - POST /api/apps/:id/promote drops its requireRole("owner") gate and
 *     refuses anyone isAppOwner() rejects, including a caller who holds a
 *     platform role but is not the app's author;
 *   - GET /api/apps unions the caller's Studio projects into the list via
 *     collectCallerProjects + projectAsApp (F9: one app object at the read,
 *     stores unmerged), and promote crosses to promoteProject for them.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createApp,
  getApp,
  promoteApp,
  appCallerKey,
  isAppOwner,
  projectStage,
  projectAsApp,
  collectCallerProjects,
  promoteProject,
} from "../emergent/app-maker.js";

const VALID_SPEC = {
  primitives: {
    artifacts: { types: [], schema: {} },
    execution: { macros: [] },
    governance: { council_gated: false },
  },
  ui: { lens: "custom", layout: "dashboard", panels: [] },
};

function makeProject(overrides = {}) {
  return {
    id: "proj_test1",
    name: "Studio Thing",
    createdAt: "2026-11-06T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
    pages: [{ id: "page_1", name: "Home", route: "/", elements: [] }],
    versions: [],
    deployment: { status: "undeployed", url: null, deployedAt: null },
    ...overrides,
  };
}

// ── appCallerKey ────────────────────────────────────────────────────────────

describe("appCallerKey — the stamp/check identity derivation", () => {
  it("prefers userId, then id, then username", () => {
    assert.equal(appCallerKey({ userId: "u1", id: "u2", username: "u3" }), "u1");
    assert.equal(appCallerKey({ id: "u2", username: "u3" }), "u2");
    assert.equal(appCallerKey({ username: "u3" }), "u3");
  });

  it("returns null when no identity is present", () => {
    assert.equal(appCallerKey(null), null);
    assert.equal(appCallerKey({}), null);
    assert.equal(appCallerKey({ id: "   " }), null);
  });
});

// ── Ownership ───────────────────────────────────────────────────────────────

describe("isAppOwner — the promote verb's check", () => {
  it("passes for the app's author and no one else", () => {
    const app = { author: "user_a" };
    assert.equal(isAppOwner(app, "user_a"), true);
    assert.equal(isAppOwner(app, "user_b"), false);
    assert.equal(isAppOwner(app, null), false);
    assert.equal(isAppOwner(null, "user_a"), false);
  });

  it("a legacy 'anonymous' app is owned by no real caller", () => {
    // Apps created before the stamp carry author 'anonymous' (the FE never
    // sent one). Their ownership was never recorded; the slice does not
    // invent it, so no authenticated caller can promote them.
    assert.equal(isAppOwner({ author: "anonymous" }, "user_a"), false);
  });

  it("the stamped-at-create flow: the creator promotes, another account cannot", () => {
    // Mirrors the route flow: create stamps author = appCallerKey(req.user)
    // (a body-supplied author never reaches createApp), promote checks it.
    const creator = { userId: "user_creator", username: "creator" };
    const created = createApp({ ...VALID_SPEC, name: "Mine", author: appCallerKey(creator) });
    assert.equal(created.ok, true);
    const app = getApp(created.app.id).app;
    assert.equal(app.author, "user_creator");
    assert.equal(isAppOwner(app, appCallerKey(creator)), true);
    assert.equal(isAppOwner(app, appCallerKey({ userId: "user_other" })), false);
    // And the underlying verb still advances the stage for the owner path.
    const promoted = promoteApp(created.app.id);
    assert.equal(promoted.ok, true);
    assert.equal(promoted.stage, "published");
  });

  it("createApp's own contract is unchanged for its direct (sovereign) callers", () => {
    const r = createApp({ ...VALID_SPEC, name: "Sovereign", author: "alice" });
    assert.equal(getApp(r.app.id).app.author, "alice");
  });
});

// ── The vocabulary mapping + projection (F9) ────────────────────────────────

describe("projectStage — the one deploy/published mapping", () => {
  it("undeployed reads as draft; snapshotted reads as published", () => {
    assert.equal(projectStage(makeProject()), "draft");
    assert.equal(
      projectStage(makeProject({ deployment: { status: "snapshotted", url: null, deployedAt: "2026-11-06T01:00:00.000Z" } })),
      "published",
    );
  });

  it("an advanced _pipelineStage wins over the deployment implication", () => {
    const p = makeProject({
      deployment: { status: "snapshotted", url: null, deployedAt: "2026-11-06T01:00:00.000Z" },
      _pipelineStage: "marketplace",
    });
    assert.equal(projectStage(p), "marketplace");
  });
});

describe("projectAsApp — the projected app object", () => {
  it("carries the pipeline shape plus its Studio facts, honestly labelled", () => {
    const p = makeProject({
      versions: [{ id: "ver_1" }, { id: "ver_2" }],
      deployment: { status: "snapshotted", url: null, deployedAt: "2026-11-06T01:00:00.000Z" },
    });
    const view = projectAsApp(p, "user_a");
    assert.equal(view.id, p.id);
    assert.equal(view.name, "Studio Thing");
    assert.equal(view.status, "published");
    assert.equal(view.author, "user_a");
    assert.equal(view.source, "studio");
    assert.equal(view.deploymentStatus, "snapshotted");
    assert.equal(view.snapshotCount, 2);
  });
});

describe("collectCallerProjects — only the caller's own shelf", () => {
  function stateWith(entries) {
    return { projects: new Map(entries) };
  }

  it("finds the caller's projects under whichever identity key the domain used", () => {
    const mine = makeProject({ id: "proj_mine" });
    const state = stateWith([
      ["user_a", [mine]],
      ["user_b", [makeProject({ id: "proj_theirs" })]],
    ]);
    const found = collectCallerProjects(state, { id: "user_a" });
    assert.equal(found.length, 1);
    assert.equal(found[0].project.id, "proj_mine");
    assert.equal(found[0].ownerKey, "user_a");
  });

  it("never surfaces another account's projects", () => {
    const state = stateWith([["user_b", [makeProject({ id: "proj_theirs" })]]]);
    assert.deepEqual(collectCallerProjects(state, { id: "user_a" }), []);
    assert.deepEqual(collectCallerProjects(state, { userId: "user_a", username: "a" }), []);
  });

  it("tolerates a missing or malformed store", () => {
    assert.deepEqual(collectCallerProjects(null, { id: "user_a" }), []);
    assert.deepEqual(collectCallerProjects({}, { id: "user_a" }), []);
    assert.deepEqual(collectCallerProjects({ projects: [] }, { id: "user_a" }), []);
  });
});

// ── promoteProject ──────────────────────────────────────────────────────────

describe("promoteProject — stage advance on the project's own record", () => {
  it("refuses to call an unsnapshotted project published", () => {
    const p = makeProject();
    const r = promoteProject(p);
    assert.equal(r.ok, false);
    assert.match(r.error, /snapshot/i);
    assert.equal(p._pipelineStage, undefined);
    assert.equal(projectStage(p), "draft");
  });

  it("a snapshotted project advances from its mapped stage and persists on the record", () => {
    const p = makeProject({
      deployment: { status: "snapshotted", url: null, deployedAt: "2026-11-06T01:00:00.000Z" },
      versions: [{ id: "ver_1" }],
    });
    const r = promoteProject(p);
    assert.equal(r.ok, true);
    assert.equal(r.stage, "marketplace");
    assert.equal(p._pipelineStage, "marketplace");
    assert.equal(projectStage(p), "marketplace");
  });

  it("stops at the top of the ladder", () => {
    const p = makeProject({ _pipelineStage: "global" });
    const r = promoteProject(p);
    assert.equal(r.ok, false);
    assert.match(r.error, /max stage/i);
  });
});
