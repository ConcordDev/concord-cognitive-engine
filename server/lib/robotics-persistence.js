// server/lib/robotics-persistence.js
//
// Robotics persistence (#27) — records a REAL computed robotics run (a
// kinematics solution, a path plan, a sensor-fusion result — produced by the
// robotics domain's pure-compute calculators) into robotics_runs (mig 346) and
// optionally mints a DTU so the run is a first-class, citable artifact (the
// action→DTU genesis the in-memory control surface lacked). Stores real computed
// telemetry only; physical actuation is the actuator-adapter boundary.

import { createDTU } from "../economy/dtu-pipeline.js";

const VALID_KINDS = new Set(["kinematics", "path_plan", "sensor_fusion", "battery", "teleop", "mission"]);
let _idc = 0;
function runId() { return `rrun_${Date.now().toString(36)}_${(_idc++).toString(36)}`; }

/**
 * Persist a robotics run. Returns { ok, runId, dtuId }.
 * @param {object} db
 * @param {object} opts { userId, robotId?, kind, input, result, mintDtu? }
 */
export function recordRun(db, { userId, robotId = null, kind, input = {}, result = {}, mintDtu = false } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const uid = String(userId || "");
  if (!uid) return { ok: false, reason: "no_user" };
  const k = VALID_KINDS.has(kind) ? kind : "mission";

  let dtuId = null;
  if (mintDtu) {
    try {
      const r = createDTU(db, {
        creatorId: uid, title: `Robotics run: ${k}${robotId ? " — " + robotId : ""}`,
        content: JSON.stringify({ kind: k, robotId, input, result }, null, 2),
        contentType: "application/json", lensId: "robotics", citationMode: "original",
        tags: ["robotics", k], metadata: { kind: "robotics_run", robotId, runKind: k },
      });
      if (r?.ok && r.dtu?.id) dtuId = r.dtu.id;
    } catch { /* DTU mint best-effort */ }
  }

  const id = runId();
  try {
    db.prepare(`INSERT INTO robotics_runs (id, user_id, robot_id, kind, input_json, result_json, dtu_id) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, uid, robotId, k, JSON.stringify(input), JSON.stringify(result), dtuId);
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, runId: id, dtuId };
}

/** List a user's runs (newest first). */
export function listRuns(db, userId, { robotId = null, limit = 50 } = {}) {
  if (!db || !userId) return [];
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  try {
    const where = robotId ? `WHERE user_id = ? AND robot_id = ?` : `WHERE user_id = ?`;
    const args = robotId ? [String(userId), robotId, lim] : [String(userId), lim];
    return db.prepare(`SELECT id, robot_id AS robotId, kind, dtu_id AS dtuId, created_at AS createdAt FROM robotics_runs ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(...args);
  } catch {
    return [];
  }
}

/** Read one run with its full input/result. */
export function getRun(db, id) {
  if (!db || !id) return null;
  try {
    const r = db.prepare(`SELECT id, user_id AS userId, robot_id AS robotId, kind, input_json, result_json, dtu_id AS dtuId, created_at AS createdAt FROM robotics_runs WHERE id = ?`).get(id);
    if (!r) return null;
    return { ...r, input: JSON.parse(r.input_json || "{}"), result: JSON.parse(r.result_json || "{}") };
  } catch {
    return null;
  }
}

export default { recordRun, listRuns, getRun };
