// server/routes/minigames.js
//
// REST surface for the basketball + racing minigames.

import { Router } from "express";
import {
  createMatch as bbCreateMatch,
  recordShot as bbRecordShot,
  endMatch as bbEndMatch,
  getMatch as bbGetMatch,
} from "../lib/minigames/basketball.js";
import {
  createRace,
  recordCheckpoint,
  getRace,
} from "../lib/minigames/racing.js";

export default function createMinigamesRouter({ requireAuth, db, realtimeEmit }) {
  const router = Router();

  /* ── Basketball ─────────────────────────────────────────────────── */

  router.post("/basketball", requireAuth, (req, res) => {
    try {
      const { opponentId, worldId, districtId, hoopPosition, targetScore } = req.body || {};
      const result = bbCreateMatch(db, {
        challengerId: req.user.id,
        opponentId: String(opponentId || "").slice(0, 80),
        worldId, districtId, hoopPosition,
        targetScore: Math.max(1, Math.min(99, Number(targetScore) || 21)),
      });
      if (result.ok && realtimeEmit) {
        try { realtimeEmit("minigame:started", { matchId: result.matchId, kind: "basketball", players: [req.user.id, opponentId] }); }
        catch { /* ok */ }
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post("/basketball/:id/shot", requireAuth, (req, res) => {
    try {
      const { shooterPos, made, hitRim, ballVelocity } = req.body || {};
      const result = bbRecordShot(db, req.params.id, {
        shooterId: req.user.id,
        shooterPos: shooterPos || { x: 0, y: 0, z: 0 },
        made: !!made,
        hitRim: !!hitRim,
        ballVelocity: ballVelocity || null,
      });
      if (result.ok && realtimeEmit) {
        try {
          realtimeEmit("minigame:scored", {
            matchId: req.params.id, kind: "basketball",
            actor: req.user.id, eventKind: result.eventKind, points: result.points,
          });
          if (result.ended) {
            realtimeEmit("minigame:complete", { matchId: req.params.id, kind: "basketball", winner: result.winner });
          }
        } catch { /* ok */ }
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post("/basketball/:id/end", requireAuth, (req, res) => {
    try {
      const result = bbEndMatch(db, req.params.id, { reason: "manual" });
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.get("/basketball/:id", requireAuth, (req, res) => {
    try {
      const m = bbGetMatch(db, req.params.id);
      if (!m) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true, match: m });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  /* ── Racing ─────────────────────────────────────────────────────── */

  router.post("/racing", requireAuth, (req, res) => {
    try {
      const { trackId, racerIds, worldId, districtId, lapCount, allowedVehicleClasses } = req.body || {};
      const result = createRace(db, {
        worldId, districtId,
        trackId: String(trackId || "").slice(0, 80),
        racerIds: Array.isArray(racerIds) ? racerIds.slice(0, 16) : [req.user.id],
        lapCount: Math.max(1, Math.min(20, Number(lapCount) || 3)),
        allowedVehicleClasses: Array.isArray(allowedVehicleClasses) ? allowedVehicleClasses : ["car"],
      });
      if (result.ok && realtimeEmit) {
        try { realtimeEmit("minigame:started", { matchId: result.raceId, kind: "racing", trackId, players: racerIds }); }
        catch { /* ok */ }
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.post("/racing/:id/checkpoint", requireAuth, (req, res) => {
    try {
      const { checkpointIdx, checkpointPos, prevCheckpointPos, vehicleClass } = req.body || {};
      const result = recordCheckpoint(db, req.params.id, {
        racerId: req.user.id,
        checkpointIdx: Number(checkpointIdx) || 0,
        checkpointPos: checkpointPos || { x: 0, y: 0, z: 0 },
        prevCheckpointPos: prevCheckpointPos || null,
        vehicleClass: String(vehicleClass || "car"),
        t: Date.now(),
      });
      if (result.ok && result.ended && realtimeEmit) {
        try { realtimeEmit("minigame:complete", { matchId: req.params.id, kind: "racing", winner: result.winner }); }
        catch { /* ok */ }
      }
      res.json(result);
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  router.get("/racing/:id", requireAuth, (req, res) => {
    try {
      const r = getRace(db, req.params.id);
      if (!r) return res.status(404).json({ ok: false, error: "not_found" });
      res.json({ ok: true, race: r });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // GET /api/minigames/:matchId/events — play-by-play feed.
  // basketball.js / racing.js write to minigame_events on every shot,
  // checkpoint, lap-complete and crash, but pre-this-route nothing read
  // them back. UI replay surfaces (post-match recap, share-card) and
  // future match-chronicle-DTU enrichment consume this shape.
  router.get("/:matchId/events", requireAuth, (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
      const events = db
        .prepare(
          `SELECT id, match_id, actor_id, event_kind, payload_json, ts
             FROM minigame_events
            WHERE match_id = ?
            ORDER BY ts ASC
            LIMIT ?`,
        )
        .all(req.params.matchId, limit);
      const parsed = events.map((e) => ({
        ...e,
        payload: (() => { try { return JSON.parse(e.payload_json); } catch { return null; } })(),
      }));
      res.json({ ok: true, matchId: req.params.matchId, events: parsed, count: parsed.length });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  return router;
}
