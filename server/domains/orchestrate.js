// server/domains/orchestrate.js
//
// Maker-Checker Orchestrator (#9) — macros over lib/maker-checker.js. Runs the
// propose→verify loop with the shadow council as the deterministic checker, and
// can dispatch the loop across a goal list (e.g. a planner's next milestones).
//
// Registered from server.js: registerOrchestrateMacros(register).

import { runMakerChecker, dispatchMakerChecker } from "../lib/maker-checker.js";
import { nextActionable } from "../lib/goal-decomposition.js";

export default function registerOrchestrateMacros(register) {
  register("orchestrate", "run", async (ctx, input = {}) => {
    const db = ctx?.db;
    return runMakerChecker(db, { goal: input.goal, maxRounds: input.maxRounds, userId: ctx?.actor?.userId || null });
  }, { note: "maker-checker loop: real brain proposes → shadow-council verifies → retry on dissent (#9)" });

  register("orchestrate", "dispatch", async (ctx, input = {}) => {
    const db = ctx?.db;
    let goals = input.goals;
    // If a goal tree is given, dispatch over its next actionable leaves.
    if (!goals && input.treeId && db) goals = nextActionable(db, input.treeId, input.limit || 5).map((n) => n.title);
    return dispatchMakerChecker(db, { goals: goals || [], maxRounds: input.maxRounds, userId: ctx?.actor?.userId || null });
  }, { note: "run maker-checker across a goal list or a goal tree's next actionable leaves (#9)" });
}
