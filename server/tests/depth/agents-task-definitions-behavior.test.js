// tests/depth/agents-task-definitions-behavior.test.js — REAL behavioral
// tests closing docs/WAVE4_INVENTORY.md line 87 / agents-capability-map.md
// ("routeTask's requiredSkills input has no UI to author a task definition
// — ranking ignores skill filters"). Two things are pinned:
//
//   1. The new per-user task-definition CRUD family (createTaskDefinition /
//      listTaskDefinitions / deleteTaskDefinition), structurally cloned from
//      the createSchedule/listSchedules/toggleSchedule/deleteSchedule family
//      in server/domains/agents.js — round-trips, validation rejections, and
//      per-user ownership isolation (a saved definition is invisible to and
//      undeletable by a different user).
//   2. routeTask's `taskDefinitionId` handling actually changes the ranked
//      result — not just "doesn't crash". This is the load-bearing
//      assertion: the SAME two candidate agents, in the SAME order, produce
//      a DIFFERENT top-ranked agent depending on whether a real skill filter
//      (sourced from a saved task definition) is supplied.
//
// Follows the established shared-server-boot depth harness (see the sibling
// server/tests/depth/agents-behavior.test.js for the same domain). Isolated
// DB via a unique DB_PATH so this file never collides with a parallel run.

import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/agents-task-definitions-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("agents — task definition CRUD round-trip + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`agents-taskdef-${randomUUID()}`); });

  it("createTaskDefinition → listTaskDefinitions → deleteTaskDefinition full lifecycle", async () => {
    const created = await lensRun("agents", "createTaskDefinition", {
      params: { name: "Parse logs", requiredSkills: ["Python", "Regex"], priority: "high", description: "Extract errors from nightly logs" },
    }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.taskDefinition.name, "Parse logs");
    assert.deepEqual(created.result.taskDefinition.requiredSkills, ["Python", "Regex"]);
    assert.equal(created.result.taskDefinition.priority, "high");
    const id = created.result.taskDefinition.id;
    assert.ok(id);

    const list = await lensRun("agents", "listTaskDefinitions", {}, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.taskDefinitions.some((d) => d.id === id));
    assert.equal(list.result.total, list.result.taskDefinitions.length);

    const del = await lensRun("agents", "deleteTaskDefinition", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const after = await lensRun("agents", "listTaskDefinitions", {}, ctx);
    assert.ok(!after.result.taskDefinitions.some((d) => d.id === id));
  });

  it("createTaskDefinition rejects a missing name", async () => {
    const bad = await lensRun("agents", "createTaskDefinition", { params: { requiredSkills: ["x"] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("createTaskDefinition accepts an empty requiredSkills array (no skill requirement is valid)", async () => {
    const created = await lensRun("agents", "createTaskDefinition", {
      params: { name: "No-skill task", requiredSkills: [] },
    }, ctx);
    assert.equal(created.ok, true);
    assert.deepEqual(created.result.taskDefinition.requiredSkills, []);
  });

  it("createTaskDefinition coerces non-array requiredSkills to an empty array", async () => {
    const created = await lensRun("agents", "createTaskDefinition", {
      params: { name: "Malformed skills", requiredSkills: "not-an-array" },
    }, ctx);
    assert.equal(created.ok, true);
    assert.deepEqual(created.result.taskDefinition.requiredSkills, []);
  });

  it("deleteTaskDefinition rejects an unknown id", async () => {
    const bad = await lensRun("agents", "deleteTaskDefinition", { params: { id: "taskdef_missing" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /task definition not found/);
  });
});

describe("agents — task definitions are per-user (ownership isolation)", () => {
  it("a definition created by one user is invisible to and undeletable by another", async () => {
    const ctxA = await depthCtx(`agents-taskdef-owner-a-${randomUUID()}`);
    const ctxB = await depthCtx(`agents-taskdef-owner-b-${randomUUID()}`);

    const created = await lensRun("agents", "createTaskDefinition", {
      params: { name: "Owner A's task", requiredSkills: ["secret-skill"] },
    }, ctxA);
    const id = created.result.taskDefinition.id;

    // Owner A sees it.
    const listA = await lensRun("agents", "listTaskDefinitions", {}, ctxA);
    assert.ok(listA.result.taskDefinitions.some((d) => d.id === id));

    // Owner B does not.
    const listB = await lensRun("agents", "listTaskDefinitions", {}, ctxB);
    assert.ok(!listB.result.taskDefinitions.some((d) => d.id === id));

    // Owner B cannot delete it (it doesn't exist in B's bucket).
    const delB = await lensRun("agents", "deleteTaskDefinition", { params: { id } }, ctxB);
    assert.equal(delB.result.ok, false);
    assert.match(delB.result.error, /task definition not found/);

    // It's still there for owner A.
    const listA2 = await lensRun("agents", "listTaskDefinitions", {}, ctxA);
    assert.ok(listA2.result.taskDefinitions.some((d) => d.id === id));
  });
});

describe("agents — routeTask's skill filter genuinely changes the ranked outcome", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`agents-routetask-taskdef-${randomUUID()}`); });

  // Two candidates, in this fixed order:
  //   "NoMatch" — skills unrelated to the task, listed FIRST
  //   "Match"   — skills that exactly satisfy the task definition, listed SECOND
  // Both have identical load (0) and reliability (1), so with NO skill filter
  // the skill term is the neutral 0.5 default for both — the resulting scores
  // tie, and Array.prototype.sort's stability preserves the original order
  // ("NoMatch" first, since it was first in the input and ties don't reorder).
  // Supplying a REAL skill filter via a saved taskDefinitionId breaks that
  // tie in favor of the genuinely matching agent — flipping which agent is
  // ranked #1, not just changing a number.
  const CANDIDATES = [
    { name: "NoMatch", skills: ["cooking"], currentLoad: 0, reliability: 1 },
    { name: "Match", skills: ["python", "ml"], currentLoad: 0, reliability: 1 },
  ];

  it("without a skill filter: neutral skill term ties the candidates, order-preserving sort picks the FIRST-listed agent", async () => {
    const r = await lensRun("agents", "routeTask", {
      data: { task: { name: "Train a model" }, agents: CANDIDATES },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.bestAgent, "NoMatch");
    assert.equal(r.result.rankings[0].score, r.result.rankings[1].score); // genuine tie
    assert.deepEqual(r.result.requiredSkills, []);
    assert.equal(r.result.taskDefinitionId, null);
  });

  it("with a saved task definition's skill filter: the genuinely matching agent wins instead", async () => {
    const def = await lensRun("agents", "createTaskDefinition", {
      params: { name: "Train a model", requiredSkills: ["python", "ml"] },
    }, ctx);
    const taskDefinitionId = def.result.taskDefinition.id;

    const r = await lensRun("agents", "routeTask", {
      data: { task: { name: "Train a model" }, agents: CANDIDATES, taskDefinitionId },
    }, ctx);
    assert.equal(r.ok, true);
    // The ranking outcome flips relative to the no-filter case above.
    assert.equal(r.result.bestAgent, "Match");
    assert.equal(r.result.taskDefinitionId, taskDefinitionId);
    assert.deepEqual(r.result.requiredSkills, ["python", "ml"]);
    // Exact score math: Match — skillMatch 2/2 -> skillScore 1.0; load 1.0;
    // reliability 1.0 => (1*0.5 + 1*0.25 + 1*0.25)*100 = 100.
    assert.equal(r.result.rankings[0].name, "Match");
    assert.equal(r.result.rankings[0].score, 100);
    assert.equal(r.result.rankings[0].skillMatch, 2);
    // NoMatch — skillMatch 0/2 -> skillScore 0; (0*0.5 + 1*0.25 + 1*0.25)*100 = 50.
    assert.equal(r.result.rankings[1].name, "NoMatch");
    assert.equal(r.result.rankings[1].score, 50);
    assert.equal(r.result.rankings[1].skillMatch, 0);
    assert.ok(r.result.rankings[0].score > r.result.rankings[1].score);
  });

  it("an unresolvable taskDefinitionId degrades gracefully to the no-filter default (never throws)", async () => {
    const r = await lensRun("agents", "routeTask", {
      data: { task: { name: "Train a model" }, agents: CANDIDATES, taskDefinitionId: "taskdef_never_existed" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.taskDefinitionId, null);
    assert.deepEqual(r.result.requiredSkills, []);
    assert.equal(r.result.bestAgent, "NoMatch"); // same as the no-filter tie-break above
  });

  it("inline task.requiredSkills back-compat path still works when no taskDefinitionId is supplied", async () => {
    const r = await lensRun("agents", "routeTask", {
      data: { task: { name: "Train a model", requiredSkills: ["python", "ml"] }, agents: CANDIDATES },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.bestAgent, "Match");
    assert.equal(r.result.taskDefinitionId, null);
    assert.deepEqual(r.result.requiredSkills, ["python", "ml"]);
  });
});
