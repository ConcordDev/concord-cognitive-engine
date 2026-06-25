// server/domains/robolab.js
//
// Robotics persistence (#27) — DB-backed macros that record a REAL computed
// robotics run (from the robotics lens's pure-compute calculators) and optionally
// mint a DTU (action→DTU genesis). Separate domain from the in-memory `robotics`
// control surface. Physical actuation goes through the honest actuator adapter —
// with no robot attached it reports unavailable, never a faked move.
//
// Registered from server.js: registerRobolabMacros(register).

import { recordRun, listRuns, getRun } from "../lib/robotics-persistence.js";
import { actuate, hasActuator } from "../lib/robotics/actuator-adapter.js";

export default function registerRobolabMacros(register) {
  register("robolab", "record_run", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return recordRun(db, { userId, robotId: input.robotId, kind: input.kind, input: input.input, result: input.result, mintDtu: input.mintDtu === true });
  }, { note: "persist a real computed robotics run; optionally mint a DTU (#27)" });

  register("robolab", "runs", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, runs: listRuns(db, userId, { robotId: input.robotId, limit: input.limit }) };
  }, { note: "list a user's persisted robotics runs (#27)" });

  register("robolab", "run", async (ctx, input = {}) => {
    const db = ctx?.db; if (!db) return { ok: false, reason: "no_db" };
    const r = getRun(db, input.runId);
    return r ? { ok: true, run: r } : { ok: false, reason: "not_found" };
  }, { note: "read one persisted robotics run (#27)" });

  register("robolab", "actuate", async (_ctx, input = {}) => {
    // Honest: with no physical robot attached this reports unavailable.
    return { ok: true, hasActuator: hasActuator(), ...(await actuate({ robotId: input.robotId, command: input.command })) };
  }, { note: "send a motion command to a real actuator (honest no_actuator when none attached) (#27)" });
}
