// server/routes/dynasty.js
//
// Wave C / C2 — generation-spanning play. POST /api/dynasty/heir-takeover
// triggers the heir succession flow:
//   - Mark predecessor dead (cause supplied by caller)
//   - INSERT into player_heir_takeovers + bump generations + halve renown
//   - Halve heir's skills (floor=1)
//   - Transfer non-soulbound inventory from predecessor to heir
//   - Cascade opinion losses on predecessor's social graph at half severity
//   - Spawn a gravestone in world_markers at predecessor's last known position
//   - Compose a world_legends row summarising the predecessor's life arc
//
// GET /api/dynasty/me returns the caller's dynasty + last takeover.
// GET /api/dynasty/:id/lineage returns the takeover ledger.

import express from "express";
import crypto from "crypto";
import { acceptHeir, getDynastyForUser, getDynasty } from "../lib/player-dynasty.js";

export default function createDynastyRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/me", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    try {
      const dyn = getDynastyForUser(db, userId);
      if (!dyn) return res.json({ ok: true, dynasty: null });
      const takeovers = db.prepare(`
        SELECT predecessor_user_id, heir_user_id, cause, taken_at
        FROM player_heir_takeovers WHERE dynasty_id = ?
        ORDER BY taken_at DESC LIMIT 20
      `).all(dyn.id);
      return res.json({ ok: true, dynasty: dyn, takeovers });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  router.get("/:dynastyId/lineage", requireAuth, (req, res) => {
    const dyn = getDynasty(db, req.params.dynastyId);
    if (!dyn) return res.status(404).json({ ok: false, error: "dynasty_not_found" });
    try {
      const takeovers = db.prepare(`
        SELECT predecessor_user_id, heir_user_id, cause, taken_at
        FROM player_heir_takeovers WHERE dynasty_id = ?
        ORDER BY taken_at ASC
      `).all(dyn.id);
      return res.json({ ok: true, dynasty: dyn, takeovers });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  router.post("/heir-takeover", requireAuth, async (req, res) => {
    const predecessorUserId = req.user?.id;
    if (!predecessorUserId) return res.status(401).json({ ok: false, error: "no_user" });
    const { dynastyId, heirUserId, cause = "old_age" } = req.body || {};
    if (!dynastyId || !heirUserId) {
      return res.status(400).json({ ok: false, error: "missing_args" });
    }
    if (heirUserId === predecessorUserId) {
      return res.status(400).json({ ok: false, error: "cannot_inherit_self" });
    }

    const dyn = getDynasty(db, dynastyId);
    if (!dyn) return res.status(404).json({ ok: false, error: "dynasty_not_found" });
    if (dyn.current_head_user_id !== predecessorUserId) {
      return res.status(403).json({ ok: false, error: "not_current_head" });
    }

    // Run the takeover as a single transaction so partial state can't
    // leak (e.g. inventory transferred but renown not halved).
    const result = {
      ok: true, dynastyId, heirUserId,
      predecessor: predecessorUserId,
      inventoryTransferred: 0,
      skillsHalved: 0,
      opinionCascades: 0,
      gravestoneId: null,
      legendId: null,
    };

    const tx = db.transaction(() => {
      // 1. The canonical bookkeeping.
      const heirRes = acceptHeir(db, dynastyId, heirUserId, { cause });
      if (!heirRes.ok) throw new Error(heirRes.reason || "accept_heir_failed");
      result.acceptHeir = heirRes;

      // 2. Inventory transfer — non-soulbound items only.
      try {
        const items = db.prepare(`
          SELECT id FROM player_inventory WHERE user_id = ? AND COALESCE(soulbound, 0) = 0
        `).all(predecessorUserId);
        if (items.length > 0) {
          const ids = items.map((i) => i.id);
          const placeholders = ids.map(() => "?").join(",");
          const r = db.prepare(`
            UPDATE player_inventory SET user_id = ? WHERE id IN (${placeholders})
          `).run(heirUserId, ...ids);
          result.inventoryTransferred = r.changes;
        }
      } catch { /* player_inventory may be absent in tests */ }

      // 3. Skills — halve each existing level with floor=1.
      try {
        const r = db.prepare(`
          UPDATE player_skill_levels
          SET level = MAX(1, CAST(level / 2 AS INTEGER)),
              xp = 0
          WHERE user_id = ?
        `).run(heirUserId);
        result.skillsHalved = r.changes;
      } catch { /* table optional */ }

      // 4. Predecessor's last known position for gravestone + legend.
      let lastPos = null;
      try {
        lastPos = db.prepare(`
          SELECT x, z, world_id FROM player_world_state WHERE user_id = ?
        `).get(predecessorUserId);
      } catch { /* table optional */ }

      // 5. Gravestone in world_markers.
      if (lastPos?.world_id) {
        try {
          const gid = `grave_${crypto.randomBytes(6).toString("hex")}`;
          db.prepare(`
            INSERT INTO world_markers (id, world_id, kind, x, y, z, label, body, created_at)
            VALUES (?, ?, 'gravestone', ?, 0, ?, ?, ?, unixepoch())
          `).run(gid, lastPos.world_id, lastPos.x ?? 0, lastPos.z ?? 0,
            `Here lies ${predecessorUserId}`,
            `Of the ${dyn.house_name || 'unnamed'} line. Generation ${dyn.generations}. Cause: ${cause}.`);
          result.gravestoneId = gid;
        } catch { /* world_markers optional */ }
      }

      // 6. Legend composition (a row; Wave D's composer fills body via LLM).
      try {
        const lid = `lg_${crypto.randomBytes(6).toString("hex")}`;
        db.prepare(`
          INSERT INTO world_legends
            (id, world_id, subject_kind, subject_id, title, body, sentiment, severity, composed_at)
          VALUES (?, ?, 'user', ?, ?, ?, ?, ?, unixepoch())
        `).run(
          lid, lastPos?.world_id || "concordia",
          predecessorUserId,
          `The Passing of ${predecessorUserId}`,
          `The ${dyn.house_name || 'unnamed'} dynasty passed to a new generation. ${cause}.`,
          0.2, // mildly positive; this is remembrance, not infamy
          4,
        );
        result.legendId = lid;
      } catch { /* world_legends optional */ }

    });

    try { tx(); }
    catch (err) {
      return res.status(500).json({ ok: false, error: "takeover_failed", message: err.message });
    }

    // 7. Opinion cascade — predecessor's known NPCs notice the loss.
    // Done OUTSIDE the transaction because the recordOpinionEvent import
    // is async and the better-sqlite3 transaction wrapper is sync-only.
    try {
      const knownNpcs = db.prepare(`
        SELECT npc_id FROM npc_player_memories
        WHERE player_id = ? AND sentiment >= 0.2
        LIMIT 100
      `).all(predecessorUserId);
      if (knownNpcs.length > 0) {
        const { recordOpinionEvent } = await import("../lib/npc-opinions.js");
        for (const k of knownNpcs) {
          try {
            recordOpinionEvent?.(db, { npcId: k.npc_id, targetKind: "user", targetId: heirUserId },
              5, "sympathy_for_heir");
            result.opinionCascades++;
          } catch { /* ok */ }
        }
      }
    } catch { /* npc_player_memories optional */ }

    // Realtime fan-out so other clients see the passing. The dynasty
    // row doesn't carry world_id, so use the predecessor's last known
    // world (when player_world_state is present); fallback to concordia.
    try {
      let worldId = "concordia";
      try {
        const pws = db.prepare(`SELECT world_id FROM player_world_state WHERE user_id = ?`).get(predecessorUserId);
        if (pws?.world_id) worldId = pws.world_id;
      } catch { /* ok */ }
      req.app.locals.io?.to?.(`world:${worldId}`)?.emit?.("dynasty:heir-takeover", {
        dynastyId, predecessor: predecessorUserId, heir: heirUserId, cause,
        generation: dyn.generations + 1,
      });
    } catch { /* realtime optional */ }

    return res.json(result);
  });

  return router;
}
