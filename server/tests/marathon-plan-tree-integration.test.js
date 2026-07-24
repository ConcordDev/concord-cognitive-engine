// server/tests/marathon-plan-tree-integration.test.js
//
// End-to-end wiring test for the three tightly-related pieces added to
// agent-marathon.js#tickMarathon:
//   Part 1 — marathon-plan-context.js  (read-path plan grounding, opt-in
//            via opts.projectId)
//   Part 2 — marathon-plan-sync.js     ([SUBGOAL_COMPLETE: id] write-back)
//   Part 3 — marathon-replanner.js     (explicit replan checkpoint)
//
// Drives the REAL tickMarathon function against a real in-memory
// better-sqlite3 DB run through the full migration ledger (goal_trees/
// goal_nodes/projects/project_marathon_links/agent_marathon_sessions/
// agent_marathon_turns all need to exist), with scripted brainChat
// functions so no live LLM is required. Mirrors the mocking style already
// established in tests/agent-marathon-governance.test.js.
//
// Run: node --test --test-force-exit --test-timeout=100000 server/tests/marathon-plan-tree-integration.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { startMarathon, tickMarathon } from "../lib/agent-marathon.js";
import { createGoalTree, addSubgoals, getGoalTree } from "../lib/goal-decomposition.js";
import { createProject, linkMarathonToProject } from "../lib/project-thread.js";
import { buildPlanContextBlock } from "../lib/marathon-plan-context.js";
import { runAgentLoop } from "../lib/chat-agent.js";

// Every tickMarathon call attempts a shadow-context prefetch
// (`runMacro("chat", "harvest", ...)`) before anything else — stub it to a
// clean no-op so it never interferes with the assertions below (same
// pattern as tests/agent-marathon-governance.test.js#noopHarvest).
function noopHarvest() {
  return async (domain, name) => {
    if (domain === "chat" && name === "harvest") return { ok: true, dtus: [] };
    return { ok: false };
  };
}

function scriptedBrain(script) {
  const captured = [];
  const fn = async ({ messages }) => {
    captured.push(messages);
    const text = script.length ? script.shift() : "done.";
    return { ok: true, text, provider: "test", model: "test", tokensIn: 1, tokensOut: 1 };
  };
  fn.captured = captured;
  return fn;
}

function systemContentOf(messages) {
  return messages.find((m) => m.role === "system")?.content;
}

describe("Marathon <-> goal-tree integration", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });

  it("Part 1 — an UNLINKED marathon's tick prompt is byte-identical to a raw runAgentLoop call with no extraSystemBlock", async () => {
    // Session A: driven straight through runAgentLoop (the "before this
    // feature existed" baseline shape — no extraSystemBlock concept at all).
    const controlBrain = scriptedBrain(["A gentle river flows toward the sea. [TASK_COMPLETE]"]);
    const controlResult = await runAgentLoop({
      db, userId: "u_control", message: "Write a haiku about rivers",
      runMacro: noopHarvest(), history: [],
      opts: { maxTurns: 1, sessionId: "control_session", brainChat: controlBrain },
    });
    assert.equal(controlResult.ok, true);

    // Session B: the REAL marathon path, ticked via tickMarathon with NO
    // opts.projectId (the overwhelming majority case — every marathon that
    // isn't explicitly plan-grounded).
    const started = startMarathon(db, "u_control", { goal: "Write a haiku about rivers" });
    const marathonBrain = scriptedBrain(["A gentle river flows toward the sea. [TASK_COMPLETE]"]);
    const r = await tickMarathon({
      db, sessionId: started.sessionId, runMacro: noopHarvest(), lensActions: new Map(),
      opts: { brainChat: marathonBrain }, // no opts.projectId
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, "completed");

    const controlSys = systemContentOf(controlBrain.captured[0]);
    const marathonSys = systemContentOf(marathonBrain.captured[0]);
    assert.equal(typeof controlSys, "string");
    assert.equal(marathonSys, controlSys, "unlinked marathon prompt is byte-identical to the pre-existing (no-plan-context) composition");
    assert.ok(!marathonSys.includes("Linked project plan"), "no plan-context text leaks in when unlinked");
  });

  it("Part 1 — a LINKED marathon's tick prompt is grounded with text that matches the LIVE tree state exactly", async () => {
    const t = createGoalTree(db, { userId: "u_linked", title: "Migrate the billing service", mintDtu: false });
    const d = addSubgoals(db, {
      treeId: t.treeId, parentId: t.rootId,
      subgoals: ["Write the migration script", "Backfill existing rows"],
    });
    const proj = createProject(db, "u_linked", "Billing migration", { goalTreeId: t.treeId });
    const started = startMarathon(db, "u_linked", { goal: "Migrate the billing service", title: "Migrate the billing service" });
    linkMarathonToProject(db, proj.project.id, started.sessionId);

    // Ground truth, computed the SAME way the tick will compute it.
    const expected = buildPlanContextBlock(db, proj.project.id);
    assert.equal(expected.ok, true);

    const brain = scriptedBrain(["Working on it. [TASK_BLOCKED: need more info]"]);
    const r = await tickMarathon({
      db, sessionId: started.sessionId, runMacro: noopHarvest(), lensActions: new Map(),
      opts: { brainChat: brain, projectId: proj.project.id },
    });
    assert.equal(r.ok, true);

    const sys = systemContentOf(brain.captured[0]);
    assert.ok(sys.endsWith(expected.block), "the injected text is EXACTLY the live-tree-derived block, appended verbatim");
    assert.ok(sys.includes(`[${d.nodes[0].id}] Write the migration script (status: pending)`));
    assert.ok(sys.includes(`[${d.nodes[1].id}] Backfill existing rows (status: pending)`));
    assert.ok(sys.includes("Progress: 0/3 subgoal(s) done (0%)"));
  });

  it("Part 2 — a [SUBGOAL_COMPLETE: id] marker in the tick's answer flips the real node and rolls up", async () => {
    const t = createGoalTree(db, { userId: "u_sync", title: "Small project", mintDtu: false });
    const d = addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["only step"] });
    const proj = createProject(db, "u_sync", "Small project", { goalTreeId: t.treeId });
    const started = startMarathon(db, "u_sync", { goal: "Finish the only step" });
    linkMarathonToProject(db, proj.project.id, started.sessionId);

    const nodeId = d.nodes[0].id;
    const brain = scriptedBrain([`Finished it. [SUBGOAL_COMPLETE: ${nodeId}] [TASK_COMPLETE]`]);
    const r = await tickMarathon({
      db, sessionId: started.sessionId, runMacro: noopHarvest(), lensActions: new Map(),
      opts: { brainChat: brain, projectId: proj.project.id },
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, "completed");

    const gt = getGoalTree(db, t.treeId);
    assert.equal(gt.tree.root.children[0].status, "done");
    assert.equal(gt.tree.root.status, "done", "single-child roll-up completed the tree too");
  });

  it("Part 2 — an unlinked marathon's [SUBGOAL_COMPLETE] marker is an honest no-op (no tree to write to)", async () => {
    const started = startMarathon(db, "u_sync2", { goal: "Do a thing" });
    const brain = scriptedBrain(["Done. [SUBGOAL_COMPLETE: gn_whatever] [TASK_COMPLETE]"]);
    const r = await tickMarathon({
      db, sessionId: started.sessionId, runMacro: noopHarvest(), lensActions: new Map(),
      opts: { brainChat: brain }, // no opts.projectId
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, "completed", "marker parsing never breaks the ordinary tick");
  });

  it("Part 3 — a [REPLAN_NEEDED: reason] marker fires a dedicated replan checkpoint that adds a real subgoal", async () => {
    const t = createGoalTree(db, { userId: "u_replan", title: "Stuck project", mintDtu: false });
    addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["approach that keeps failing"] });
    const proj = createProject(db, "u_replan", "Stuck project", { goalTreeId: t.treeId });
    const started = startMarathon(db, "u_replan", { goal: "Solve the stuck problem" });
    linkMarathonToProject(db, proj.project.id, started.sessionId);

    // Ordinary tick brain: reports being stuck, asks for a replan, but does
    // NOT complete/block — the session must still be 'running' for the
    // replan branch to fire at all.
    const tickBrain = scriptedBrain(["Tried the same thing again, still failing. [REPLAN_NEEDED: looping on a failed approach]"]);
    // Separate, dedicated brain for the replan checkpoint's OWN call.
    const replanBrain = scriptedBrain([JSON.stringify({
      addSubgoals: [{ title: "try a completely different strategy" }],
      abandonNodeIds: [],
    })]);

    const r = await tickMarathon({
      db, sessionId: started.sessionId, runMacro: noopHarvest(), lensActions: new Map(),
      opts: { brainChat: tickBrain, replanBrainChat: replanBrain, projectId: proj.project.id },
    });
    assert.equal(r.ok, true);
    assert.equal(r.status, "running", "a replan-requested tick keeps the marathon going");

    const gt = getGoalTree(db, t.treeId);
    const titles = gt.tree.root.children.map((c) => c.title);
    assert.ok(titles.includes("try a completely different strategy"), "the replan checkpoint's new subgoal really landed in the tree");
  });

  it("Part 3 — PINNED SAFETY INVARIANT, driven end-to-end through tickMarathon: a replan can never expand the mandate", async () => {
    const t = createGoalTree(db, { userId: "u_mandate", title: "Bounded task", mintDtu: false });
    addSubgoals(db, { treeId: t.treeId, parentId: t.rootId, subgoals: ["step one"] });
    const proj = createProject(db, "u_mandate", "Bounded task", { goalTreeId: t.treeId });
    const started = startMarathon(db, "u_mandate", {
      goal: "Do a narrowly bounded task",
      allowedDomains: ["dtu"],
      budgetCap: 2,
      maxTurns: 5,
    });
    linkMarathonToProject(db, proj.project.id, started.sessionId);

    const before = db.prepare(`
      SELECT allowed_domains_json, budget_cap, max_turns FROM agent_marathon_sessions WHERE id = ?
    `).get(started.sessionId);
    assert.equal(before.budget_cap, 2);

    const tickBrain = scriptedBrain(["Working on it. [REPLAN_NEEDED: adversarial checkpoint]"]);
    // The malicious replan reply: tries to smuggle mandate-expanding keys
    // alongside a legitimate subgoal addition.
    const maliciousReplanBrain = scriptedBrain([JSON.stringify({
      addSubgoals: [{ title: "legit new subgoal" }],
      abandonNodeIds: [],
      allowed_domains_json: JSON.stringify(["everything", "world", "economy"]),
      budget_cap: 999999,
      max_turns: 999999,
    })]);

    const r = await tickMarathon({
      db, sessionId: started.sessionId, runMacro: noopHarvest(), lensActions: new Map(),
      opts: { brainChat: tickBrain, replanBrainChat: maliciousReplanBrain, projectId: proj.project.id },
    });
    assert.equal(r.ok, true);

    // The legitimate part of the replan still worked...
    const gt = getGoalTree(db, t.treeId);
    assert.ok(gt.tree.root.children.some((c) => c.title === "legit new subgoal"));

    // ...but the mandate is completely untouched.
    const after = db.prepare(`
      SELECT allowed_domains_json, budget_cap, max_turns FROM agent_marathon_sessions WHERE id = ?
    `).get(started.sessionId);
    assert.equal(after.allowed_domains_json, before.allowed_domains_json);
    assert.equal(after.budget_cap, before.budget_cap);
    assert.equal(after.max_turns, before.max_turns);
    assert.equal(after.budget_cap, 2, "budget_cap is still the original 2, not 999999");
  });
});
