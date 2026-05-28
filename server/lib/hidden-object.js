// server/lib/hidden-object.js
//
// Phase CB6 — hidden object via photo gallery.
//
// Host marks N objects on a photo (each with a bounding box).
// Players play the scene and click coordinates; found objects accumulate.

import crypto from "node:crypto";

export function createScene(db, hostUserId, opts = {}) {
  if (!db || !hostUserId) return { ok: false, error: "missing_inputs" };
  const { sceneDtuId, title, targets } = opts;
  if (!sceneDtuId) return { ok: false, error: "missing_scene_dtu" };
  if (!Array.isArray(targets) || targets.length === 0) {
    return { ok: false, error: "no_targets" };
  }
  // Each target: { id, label, x, y, w, h }.
  for (const t of targets) {
    if (!t.id || typeof t.x !== "number" || typeof t.y !== "number" ||
        typeof t.w !== "number" || typeof t.h !== "number") {
      return { ok: false, error: "invalid_target" };
    }
  }
  try {
    const id = `hos_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO hidden_object_scenes
        (id, scene_dtu_id, host_user_id, title, target_objects_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, sceneDtuId, hostUserId, title || "Untitled scene", JSON.stringify(targets));
    return { ok: true, sceneId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function playScene(db, userId, sceneId) {
  if (!db || !userId || !sceneId) return { ok: false, error: "missing_inputs" };
  try {
    const s = db.prepare(`SELECT id FROM hidden_object_scenes WHERE id = ?`).get(sceneId);
    if (!s) return { ok: false, error: "no_scene" };
    const id = `hor_${crypto.randomBytes(6).toString("hex")}`;
    db.prepare(`
      INSERT INTO hidden_object_runs (id, scene_id, user_id)
      VALUES (?, ?, ?)
    `).run(id, sceneId, userId);
    return { ok: true, runId: id };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function submitFind(db, runId, opts = {}) {
  if (!db || !runId) return { ok: false, error: "missing_inputs" };
  const { x, y } = opts;
  if (typeof x !== "number" || typeof y !== "number") {
    return { ok: false, error: "invalid_coords" };
  }
  try {
    const run = db.prepare(`SELECT scene_id, found_object_ids, finished_at FROM hidden_object_runs WHERE id = ?`).get(runId);
    if (!run) return { ok: false, error: "no_run" };
    if (run.finished_at) return { ok: false, error: "run_finished" };

    const scene = db.prepare(`SELECT target_objects_json FROM hidden_object_scenes WHERE id = ?`).get(run.scene_id);
    if (!scene) return { ok: false, error: "no_scene" };
    const targets = JSON.parse(scene.target_objects_json);
    const found = JSON.parse(run.found_object_ids);

    // Find first target whose bbox contains (x, y) and isn't already found.
    let matched = null;
    for (const t of targets) {
      if (found.includes(t.id)) continue;
      if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) {
        matched = t;
        break;
      }
    }

    if (!matched) return { ok: true, found: false };

    found.push(matched.id);
    const score = found.length;
    const allFound = found.length === targets.length;

    db.prepare(`
      UPDATE hidden_object_runs
      SET found_object_ids = ?, score = ?, finished_at = ?
      WHERE id = ?
    `).run(JSON.stringify(found), score, allFound ? Math.floor(Date.now() / 1000) : null, runId);

    return {
      ok: true,
      found: true,
      foundId: matched.id,
      label: matched.label,
      totalFound: score,
      totalTargets: targets.length,
      complete: allFound,
    };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function leaderboardForScene(db, sceneId, limit = 10) {
  if (!db || !sceneId) return [];
  try {
    return db.prepare(`
      SELECT id, user_id, score, finished_at
      FROM hidden_object_runs
      WHERE scene_id = ? AND finished_at IS NOT NULL
      ORDER BY score DESC, finished_at ASC
      LIMIT ?
    `).all(sceneId, Math.max(1, Math.min(100, limit)));
  } catch { return []; }
}
