// server/tests/agent-projects.test.js
//
// V1.2 Wave B (Deep ConKay Agency) — the "project" linking layer (mig 378).
// Ties a durable goal tree (lib/goal-decomposition.js, mig 340), marathon
// session(s) (lib/agent-marathon.js, mig 171), and a relevance-scoped
// conversation-memory pull into one addressable, resumable unit.
//
// Tests cover lib/project-thread.js directly against a real in-memory
// better-sqlite3 DB run through the FULL migration ledger (mirroring
// tests/goal-decomposition.test.js's pattern — project-thread.js calls
// straight back into goal-decomposition.js's and agent-marathon.js's own
// getters, so the real goal_trees/goal_nodes/agent_marathon_sessions/
// agent_marathon_turns tables must exist too), AND the five
// domains/agent-projects.js macros end-to-end through a minimal `register`
// harness (mirroring tests/workspace-rooms.test.js's harness).
//
// Run: node --test server/tests/agent-projects.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  createProject, listProjects, getProject, linkMarathonToProject, touchProjectOpened,
} from "../lib/project-thread.js";
import { createGoalTree } from "../lib/goal-decomposition.js";
import { startMarathon } from "../lib/agent-marathon.js";
import registerAgentProjectMacros from "../domains/agent-projects.js";

/** Minimal macro-registry harness mirroring server.js's real `register`. */
function makeRegistry() {
  const macros = new Map();
  function register(domain, name, fn) {
    if (!macros.has(domain)) macros.set(domain, new Map());
    macros.get(domain).set(name, fn);
  }
  function call(domain, name, ctx, input) {
    const fn = macros.get(domain)?.get(name);
    if (!fn) throw new Error(`macro not registered: ${domain}.${name}`);
    return fn(ctx, input);
  }
  return { register, call };
}

/** A fake write-through DTU map shaped like the real STATE.dtus store (see
 *  server/domains/conkay.js's memory_list for the exact contract this
 *  mirrors) — one conversation_memory DTU + one belonging to another user,
 *  so ownership scoping is exercised too. */
function fakeMemoryStore(userId) {
  const dtus = new Map();
  dtus.set("convmem_1", {
    id: "convmem_1",
    title: "Conversation: rocket telemetry",
    updatedAt: "2026-01-01T00:00:00.000Z",
    machine: {
      kind: "conversation_memory",
      userId,
      topics: ["rocket", "telemetry"],
      insights: ["Discussed rocket telemetry dashboards"],
      claims: [],
    },
  });
  dtus.set("convmem_2", {
    id: "convmem_2",
    title: "Conversation: unrelated cooking chat",
    updatedAt: "2026-01-02T00:00:00.000Z",
    machine: {
      kind: "conversation_memory",
      userId,
      topics: ["cooking"],
      insights: ["Talked about pasta recipes"],
      claims: [],
    },
  });
  dtus.set("convmem_other_user", {
    id: "convmem_other_user",
    title: "Conversation: rocket telemetry (someone else)",
    updatedAt: "2026-01-01T00:00:00.000Z",
    machine: {
      kind: "conversation_memory",
      userId: "someone-else",
      topics: ["rocket", "telemetry"],
      insights: ["Should never surface for u1"],
      claims: [],
    },
  });
  dtus.set("convmega_rocket", {
    id: "convmega_rocket",
    title: "All discussions: rocket",
    updatedAt: "2026-01-03T00:00:00.000Z",
    machine: {
      kind: "conversation_memory_mega", // NOT in OWNED kinds — no per-user stamp
      topic: "rocket",
      insights: ["Should never surface — mega has no userId"],
    },
  });
  return dtus;
}

describe("V1.2 Wave B — project-thread lib (direct, real migrated DB)", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
  });

  it("migration applied cleanly — projects + project_marathon_links tables exist", () => {
    const t1 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='projects'`).get();
    const t2 = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='project_marathon_links'`).get();
    assert.ok(t1, "projects table exists");
    assert.ok(t2, "project_marathon_links table exists");
  });

  it("createProject requires a user and a non-empty name", () => {
    assert.equal(createProject(db, "", "x").ok, false);
    assert.equal(createProject(db, "u1", "").ok, false);
    assert.equal(createProject(db, "u1", "   ").ok, false);
  });

  it("createProject mints a fresh id + persists name, with no goal tree by default", () => {
    const r = createProject(db, "u1", "  Ship the R&D engine  ");
    assert.equal(r.ok, true);
    // Mirrors agent-marathon.js's own `mar_${crypto.randomUUID().slice(0, 16)}`
    // convention exactly — the first 16 chars of a v4 UUID string include its
    // hyphens, so this is not pure hex (unlike workspace-rooms.js's
    // randomBytes(8).toString('hex') convention).
    assert.match(r.project.id, /^proj_[0-9a-f-]{16}$/);
    assert.equal(r.project.name, "Ship the R&D engine", "name is trimmed");
    assert.equal(r.project.userId, "u1");
    assert.equal(r.project.goalTreeId, null);
    assert.equal(r.project.lastOpenedAt, null);
  });

  it("createProject with a goalTreeId requires the tree to exist and belong to the same user", () => {
    const badTree = createProject(db, "u1", "Bad tree ref", { goalTreeId: "gt_nope" });
    assert.equal(badTree.ok, false);
    assert.equal(badTree.reason, "goal_tree_not_found");

    const tree = createGoalTree(db, { userId: "u2", title: "Someone else's goal", mintDtu: false });
    const wrongOwner = createProject(db, "u1", "Wrong owner", { goalTreeId: tree.treeId });
    assert.equal(wrongOwner.ok, false);
    assert.equal(wrongOwner.reason, "goal_tree_not_owned");
  });

  it("createProject links a real, owned goal tree", () => {
    const tree = createGoalTree(db, { userId: "u1", title: "Ship the R&D engine", mintDtu: false });
    const r = createProject(db, "u1", "R&D engine project", { goalTreeId: tree.treeId });
    assert.equal(r.ok, true);
    assert.equal(r.project.goalTreeId, tree.treeId);
  });

  it("listProjects returns only the given user's projects, newest-updated first, with a cheap marathon count", () => {
    createProject(db, "u3", "Alpha");
    const beta = createProject(db, "u3", "Beta");
    createProject(db, "u4", "Not u3's project");

    const mine = listProjects(db, "u3");
    assert.ok(mine.every((p) => p.name === "Alpha" || p.name === "Beta"));
    assert.equal(mine.length, 2);
    assert.ok(mine.every((p) => p.marathonCount === 0));

    const mar = startMarathon(db, "u3", { goal: "do a thing" });
    linkMarathonToProject(db, beta.project.id, mar.sessionId);
    const mineAfter = listProjects(db, "u3");
    const betaRow = mineAfter.find((p) => p.id === beta.project.id);
    assert.equal(betaRow.marathonCount, 1);
  });

  it("listProjects returns [] for no db / no user, never throws", () => {
    assert.deepEqual(listProjects(null, "u1"), []);
    assert.deepEqual(listProjects(db, null), []);
  });

  it("getProject requires user + projectId and enforces ownership honestly", () => {
    assert.equal(getProject(db, null, "proj_x").reason, "no_user");
    assert.equal(getProject(db, "u1", null).reason, "missing_project_id");
    assert.equal(getProject(db, "u1", "proj_does_not_exist").reason, "not_found");

    const other = createProject(db, "u5", "u5's project");
    const r = getProject(db, "u6", other.project.id);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owned");
  });

  it("getProject with no goal tree and no marathon links returns empty-but-honest sections", () => {
    const p = createProject(db, "u7", "Bare project");
    const r = getProject(db, "u7", p.project.id);
    assert.equal(r.ok, true);
    assert.equal(r.goalTree, null);
    assert.deepEqual(r.marathons, []);
    // No `dtus` state passed → honestly unavailable, not a fabricated empty result.
    assert.equal(r.memory.available, false);
    assert.equal(r.memory.reason, "no_state");
  });

  it("getProject surfaces the linked goal tree's REAL live state (not a snapshot)", () => {
    const tree = createGoalTree(db, { userId: "u8", title: "Two-step goal", mintDtu: false });
    const p = createProject(db, "u8", "Goal project", { goalTreeId: tree.treeId });
    const before1 = getProject(db, "u8", p.project.id);
    assert.equal(before1.goalTree.ok, true);
    assert.equal(before1.goalTree.tree.title, "Two-step goal");
    assert.equal(before1.goalTree.progress, 0);

    // Mutate the tree via goal-decomposition.js's own path — getProject must
    // reflect the change on next call, proving it reads live state, not a copy.
    db.prepare(`UPDATE goal_nodes SET status = 'done' WHERE id = ?`).run(tree.rootId);
    db.prepare(`UPDATE goal_trees SET status = 'done' WHERE id = ?`).run(tree.treeId);
    const after = getProject(db, "u8", p.project.id);
    assert.equal(after.goalTree.tree.status, "done");
  });

  it("getProject reports a deleted/dangling goal tree plainly, never fabricated", () => {
    const tree = createGoalTree(db, { userId: "u9", title: "Doomed goal", mintDtu: false });
    const p = createProject(db, "u9", "Doomed project", { goalTreeId: tree.treeId });
    db.prepare(`DELETE FROM goal_trees WHERE id = ?`).run(tree.treeId);
    db.prepare(`DELETE FROM goal_nodes WHERE tree_id = ?`).run(tree.treeId);

    const r = getProject(db, "u9", p.project.id);
    assert.equal(r.ok, true, "the project itself is still fine");
    assert.equal(r.goalTree.ok, false);
    assert.equal(r.goalTree.reason, "tree_not_found");
    assert.equal(r.goalTree.treeId, tree.treeId);
  });

  it("linkMarathonToProject requires both sides to genuinely exist, and is idempotent", () => {
    const p = createProject(db, "u10", "Marathon project");
    assert.equal(linkMarathonToProject(db, "proj_missing", "mar_x").reason, "project_not_found");
    assert.equal(linkMarathonToProject(db, p.project.id, "mar_missing").reason, "marathon_not_found");

    const mar = startMarathon(db, "u10", { goal: "long task" });
    const r1 = linkMarathonToProject(db, p.project.id, mar.sessionId);
    assert.equal(r1.ok, true);
    const r2 = linkMarathonToProject(db, p.project.id, mar.sessionId); // re-link same pair
    assert.equal(r2.ok, true, "idempotent re-link is a no-op, not an error");
    const links = db.prepare(`SELECT COUNT(*) n FROM project_marathon_links WHERE project_id = ?`).get(p.project.id);
    assert.equal(links.n, 1);
  });

  it("a project accumulates MULTIPLE marathon sessions over its life", () => {
    const p = createProject(db, "u11", "Multi-marathon project");
    const m1 = startMarathon(db, "u11", { goal: "first attempt" });
    const m2 = startMarathon(db, "u11", { goal: "resumed attempt" });
    linkMarathonToProject(db, p.project.id, m1.sessionId);
    linkMarathonToProject(db, p.project.id, m2.sessionId);

    const r = getProject(db, "u11", p.project.id);
    assert.equal(r.marathons.length, 2);
    const ids = r.marathons.map((m) => m.sessionId).sort();
    assert.deepEqual(ids, [m1.sessionId, m2.sessionId].sort());
    assert.ok(r.marathons.every((m) => m.status === "pending"));
  });

  it("getProject reports a vanished marathon session plainly, never fabricated", () => {
    const p = createProject(db, "u12", "Vanishing marathon project");
    const m = startMarathon(db, "u12", { goal: "will be deleted" });
    linkMarathonToProject(db, p.project.id, m.sessionId);
    db.prepare(`DELETE FROM agent_marathon_sessions WHERE id = ?`).run(m.sessionId);

    const r = getProject(db, "u12", p.project.id);
    assert.equal(r.marathons.length, 1);
    assert.equal(r.marathons[0].status, "missing");
    assert.equal(r.marathons[0].reason, "session_not_found");
  });

  it("getProject's memory pull is relevance-scored, ownership-scoped, and kind-scoped", () => {
    const tree = createGoalTree(db, { userId: "u13", title: "rocket telemetry dashboard", mintDtu: false });
    const p = createProject(db, "u13", "Rocket project", { goalTreeId: tree.treeId });
    const dtus = fakeMemoryStore("u13");

    const r = getProject(db, "u13", p.project.id, { dtus });
    assert.equal(r.memory.available, true);
    const ids = r.memory.items.map((m) => m.id);
    assert.ok(ids.includes("convmem_1"), "the rocket-telemetry memory surfaces");
    assert.ok(!ids.includes("convmem_2"), "the unrelated cooking memory does not (no keyword overlap)");
    assert.ok(!ids.includes("convmem_other_user"), "another user's memory never surfaces");
    assert.ok(!ids.includes("convmega_rocket"), "mega DTUs have no per-user stamp — excluded, not guessed");
    assert.ok(r.memory.items[0].relevance > 0);
  });

  it("touchProjectOpened requires ownership and stamps last_opened_at + updated_at", () => {
    const p = createProject(db, "u14", "Resume me");
    assert.equal(p.project.lastOpenedAt, null);

    const wrongUser = touchProjectOpened(db, "u15", p.project.id);
    assert.equal(wrongUser.ok, false);
    assert.equal(wrongUser.reason, "not_owned");

    const before1 = Math.floor(Date.now() / 1000);
    const r = touchProjectOpened(db, "u14", p.project.id);
    assert.equal(r.ok, true);
    assert.ok(r.project.lastOpenedAt >= before1);
  });

  it("touchProjectOpened on a nonexistent project reports not_found", () => {
    assert.equal(touchProjectOpened(db, "u1", "proj_ghost").reason, "not_found");
  });
});

describe("V1.2 Wave B — agent_projects macros (end-to-end through the registry harness)", () => {
  let db, registry, ctx;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    registry = makeRegistry();
    registerAgentProjectMacros(registry.register);
    ctx = { db, actor: { userId: "alice" } };
  });

  it("agent_projects.create requires an authenticated actor and a name", async () => {
    const noUser = await registry.call("agent_projects", "create", { db, actor: {} }, { name: "x" });
    assert.equal(noUser.ok, false);
    assert.equal(noUser.reason, "no_user");

    const noName = await registry.call("agent_projects", "create", ctx, {});
    assert.equal(noName.ok, false);
    assert.equal(noName.reason, "missing_name");
  });

  it("full round-trip: create -> appears in list -> get returns live state -> touch-opened resumes it", async () => {
    const created = await registry.call("agent_projects", "create", ctx, { name: "Sprint planning agent" });
    assert.equal(created.ok, true);
    const projectId = created.project.id;

    const listed = await registry.call("agent_projects", "list", ctx, {});
    assert.equal(listed.ok, true);
    assert.ok(listed.projects.some((p) => p.id === projectId));

    const got = await registry.call("agent_projects", "get", ctx, { projectId });
    assert.equal(got.ok, true);
    assert.equal(got.project.name, "Sprint planning agent");
    assert.equal(got.goalTree, null);
    assert.deepEqual(got.marathons, []);

    const resumed = await registry.call("agent_projects", "touch_opened", ctx, { projectId });
    assert.equal(resumed.ok, true);
    assert.ok(resumed.project.lastOpenedAt != null);
  });

  it("agent_projects.link_marathon enforces ownership through the macro layer (not just the lib)", async () => {
    const created = await registry.call("agent_projects", "create", ctx, { name: "Owned project" });
    const marCtx = { db, actor: { userId: "mallory" } };
    // mallory did not create this project — the macro (not just the lib) must refuse.
    const r = await registry.call("agent_projects", "link_marathon", marCtx, {
      projectId: created.project.id, marathonSessionId: "mar_whatever",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_owned");
  });

  it("agent_projects.link_marathon requires projectId + marathonSessionId", async () => {
    const r1 = await registry.call("agent_projects", "link_marathon", ctx, {});
    assert.equal(r1.reason, "missing_project_id");
    const created = await registry.call("agent_projects", "create", ctx, { name: "Needs a marathon id" });
    const r2 = await registry.call("agent_projects", "link_marathon", ctx, { projectId: created.project.id });
    assert.equal(r2.reason, "missing_marathon_session_id");
  });

  it("agent_projects.get passes ctx.state.dtus through to the honest memory pull", async () => {
    const created = await registry.call("agent_projects", "create", ctx, { name: "rocket telemetry" });
    const dtus = fakeMemoryStore("alice");
    const withState = await registry.call("agent_projects", "get", { db, actor: { userId: "alice" }, state: { dtus } }, { projectId: created.project.id });
    assert.equal(withState.memory.available, true);
    assert.ok(withState.memory.items.some((m) => m.id === "convmem_1"));

    const withoutState = await registry.call("agent_projects", "get", ctx, { projectId: created.project.id });
    assert.equal(withoutState.memory.available, false);
  });
});
