// server/tests/project-continuation-initiative.test.js
//
// Suggestion-only project continuation nudge (lib/project-continuation-
// initiative.js + emergent/project-continuation-cycle.js). Proves:
//   (a) the module NEVER calls startMarathon / mutates a marathon directly
//       — grep-tested against the actual source text, not just behavior.
//   (b) it respects the EXISTING initiative-engine rate-limit/quiet-hours
//       gate — a second pass right after a fired suggestion does not
//       double-insert.
//   (c) a project with no actionable next step, or with an already-
//       `running` marathon linked, produces no suggestion.
//
// Run: node --test server/tests/project-continuation-initiative.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { createProject, linkMarathonToProject } from "../lib/project-thread.js";
import { createGoalTree, addSubgoals, setNodeStatus } from "../lib/goal-decomposition.js";
import { startMarathon } from "../lib/agent-marathon.js";
import { createInitiativeEngine } from "../lib/initiative-engine.js";
import {
  runProjectContinuationPass,
  _resetProjectContinuationEngine,
} from "../lib/project-continuation-initiative.js";
import { runProjectContinuationCycle } from "../emergent/project-continuation-cycle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function backdateProject(db, projectId, secondsAgo) {
  db.prepare(`UPDATE projects SET updated_at = unixepoch() - ? WHERE id = ?`).run(secondsAgo, projectId);
}

/** Build a project with a real goal tree + one actionable subgoal, backdated
 *  past the idle threshold. */
function makeIdleActionableProject(db, userId, name) {
  const tree = createGoalTree(db, { userId, title: name, mintDtu: false });
  addSubgoals(db, { treeId: tree.treeId, parentId: tree.rootId, subgoals: ["Write the first draft"] });
  const p = createProject(db, userId, name, { goalTreeId: tree.treeId });
  backdateProject(db, p.project.id, 3600); // 1h idle, past the 30min threshold
  return { project: p.project, tree };
}

test("static source contract — never touches startMarathon or agent-marathon.js internals", () => {
  const libSrc = fs.readFileSync(path.join(__dirname, "../lib/project-continuation-initiative.js"), "utf8");
  const cycleSrc = fs.readFileSync(path.join(__dirname, "../emergent/project-continuation-cycle.js"), "utf8");
  assert.ok(!libSrc.includes("startMarathon"), "lib module must never reference startMarathon");
  assert.ok(!cycleSrc.includes("startMarathon"), "heartbeat module must never reference startMarathon");
  assert.ok(!libSrc.includes("agent-marathon.js"), "lib module must not import agent-marathon.js");
  assert.ok(!cycleSrc.includes("agent-marathon.js"), "heartbeat module must not import agent-marathon.js");
});

test("Project continuation initiative — suggestion-only, gated pass", async (t) => {
  await t.test("proposes a real, pending `initiatives` row for an idle project with a real next step", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return runMigrations(db).then(() => {
      const { project } = makeIdleActionableProject(db, "u1", "Ship the R&D engine");
      const engine = createInitiativeEngine(db);
      const r = runProjectContinuationPass(db, { engine });

      assert.equal(r.ok, true);
      assert.equal(r.evaluated, 1);
      assert.equal(r.proposed, 1);

      const pending = engine.getPending("u1");
      assert.equal(pending.count, 1);
      assert.equal(pending.initiatives[0].triggerType, "pending_work");
      assert.equal(pending.initiatives[0].status, "pending");
      assert.equal(pending.initiatives[0].metadata.projectId, project.id);
      assert.match(pending.initiatives[0].message, /Write the first draft/);
    });
  });

  await t.test("(b) a second pass right after does NOT double-insert — the shared rate-limit gate holds", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return runMigrations(db).then(() => {
      makeIdleActionableProject(db, "u2", "Second gating project");
      const engine = createInitiativeEngine(db);

      const first = runProjectContinuationPass(db, { engine });
      assert.equal(first.proposed, 1, "first pass fires");

      // Immediately re-run — same user, same candidate. The initiative
      // engine's own 4h minimum gap between initiatives must veto this,
      // proving this module never bypasses the shared gate.
      const second = runProjectContinuationPass(db, { engine });
      assert.equal(second.proposed, 0, "second pass is rate-limited by the shared engine, not by this module");
      assert.equal(second.skipped[0].reason, "min_gap_not_met");

      const history = engine.getHistory("u2");
      assert.equal(history.total, 1, "only ONE initiative row exists after two passes");
    });
  });

  await t.test("(c) a project with no actionable next step produces no suggestion", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return runMigrations(db).then(() => {
      // A goal tree whose only node is already done -> nextActionable() is empty.
      const tree = createGoalTree(db, { userId: "u3", title: "Already finished", mintDtu: false });
      setNodeStatus(db, { treeId: tree.treeId, nodeId: tree.rootId, status: "done" });
      const p = createProject(db, "u3", "Done project", { goalTreeId: tree.treeId });
      backdateProject(db, p.project.id, 3600);

      const engine = createInitiativeEngine(db);
      const r = runProjectContinuationPass(db, { engine });
      assert.equal(r.evaluated, 0);
      assert.equal(r.proposed, 0);
      assert.equal(r.skipped[0].reason, "no_actionable_next_step");
      assert.equal(engine.getPending("u3").count, 0);
    });
  });

  await t.test("(c) a project with an already-running marathon linked produces no suggestion", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return runMigrations(db).then(() => {
      const { project } = makeIdleActionableProject(db, "u4", "Has a running marathon");
      const mar = startMarathon(db, "u4", { goal: "keep going" });
      linkMarathonToProject(db, project.id, mar.sessionId); // bumps projects.updated_at — real activity
      db.prepare(`UPDATE agent_marathon_sessions SET status = 'running' WHERE id = ?`).run(mar.sessionId);
      backdateProject(db, project.id, 3600); // re-idle it AFTER the link, so only `running` is under test

      const engine = createInitiativeEngine(db);
      const r = runProjectContinuationPass(db, { engine });
      assert.equal(r.evaluated, 0, "the project is excluded before nextActionable is even consulted");
      assert.equal(r.proposed, 0);
      assert.equal(engine.getPending("u4").count, 0);
    });
  });

  await t.test("a project with only a PAUSED or PENDING marathon (not running) still qualifies", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return runMigrations(db).then(() => {
      const { project } = makeIdleActionableProject(db, "u5", "Paused marathon project");
      const mar = startMarathon(db, "u5", { goal: "paused task" });
      linkMarathonToProject(db, project.id, mar.sessionId); // bumps projects.updated_at — real activity
      db.prepare(`UPDATE agent_marathon_sessions SET status = 'paused' WHERE id = ?`).run(mar.sessionId);
      backdateProject(db, project.id, 3600); // re-idle it AFTER the link, so only `paused` is under test

      const engine = createInitiativeEngine(db);
      const r = runProjectContinuationPass(db, { engine });
      assert.equal(r.proposed, 1, "only `running` suppresses the nudge, per spec");
    });
  });

  await t.test("a project that has NOT sat idle long enough is not yet a candidate", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return runMigrations(db).then(() => {
      const tree = createGoalTree(db, { userId: "u6", title: "Just touched", mintDtu: false });
      addSubgoals(db, { treeId: tree.treeId, parentId: tree.rootId, subgoals: ["Do the thing"] });
      createProject(db, "u6", "Freshly active project", { goalTreeId: tree.treeId });
      // NOT backdated — updated_at is "now", well inside the 30-min idle window.

      const engine = createInitiativeEngine(db);
      const r = runProjectContinuationPass(db, { engine });
      assert.equal(r.evaluated, 0);
      assert.equal(r.proposed, 0);
    });
  });

  await t.test("kill-switch + totality (never throws)", () => {
    const db = new Database(":memory:");
    const prev = process.env.CONCORD_PROJECT_CONTINUATION;
    process.env.CONCORD_PROJECT_CONTINUATION = "0";
    assert.equal(runProjectContinuationPass(db).reason, "disabled");
    if (prev === undefined) delete process.env.CONCORD_PROJECT_CONTINUATION; else process.env.CONCORD_PROJECT_CONTINUATION = prev;

    assert.doesNotThrow(() => runProjectContinuationPass(null));
    assert.equal(runProjectContinuationPass(null).ok, true);
    assert.doesNotThrow(() => runProjectContinuationCycle({}));
    assert.equal(runProjectContinuationCycle({ db: null }).ok, true);
  });

  await t.test("heartbeat wrapper delegates cleanly to the lib pass", () => {
    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    return runMigrations(db).then(() => {
      makeIdleActionableProject(db, "u7", "Via heartbeat wrapper");
      _resetProjectContinuationEngine();
      const r = runProjectContinuationCycle({ db });
      assert.equal(r.ok, true);
      assert.equal(r.proposed, 1);
      _resetProjectContinuationEngine();
    });
  });
});
