// server/routes/settlement.js
//
// Wave 6 / T3.1 — player-buildable settlements. Wraps the existing
// land-claims library (lib/land-claims.js) with a player-facing REST
// surface and adds a building-placement endpoint that writes into
// world_buildings respecting claim bounds.
//
// Endpoints:
//   GET  /api/settlement/my-claims         — list caller's claims + invites
//   POST /api/settlement/claim             — claim land { worldId, x, z, radiusM }
//   POST /api/settlement/:claimId/invite   — invite co-owner / guest / tax_collector
//   POST /api/settlement/:claimId/building — place a building inside the claim
//   GET  /api/settlement/:claimId/buildings — list buildings inside the claim

import express from "express";
import crypto from "crypto";
import {
  claimLand, inviteToClaim, listClaimsForUser, claimAt, canActIn,
} from "../lib/land-claims.js";

const ALLOWED_BUILDING_TYPES = new Set([
  "house", "inn", "market", "forge", "well", "tower",
  "farm", "mine", "dock", "warehouse",
]);
const ALLOWED_MATERIALS = new Set(["wood", "stone", "brick", "steel", "thatch"]);

export default function createSettlementRouter({ db, requireAuth }) {
  const router = express.Router();

  router.get("/my-claims", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    try {
      const claims = listClaimsForUser(db, userId, true);
      return res.json({ ok: true, claims });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  router.post("/claim", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const { worldId, x, z, radiusM } = req.body || {};
    if (!worldId || x == null || z == null || !radiusM) {
      return res.status(400).json({ ok: false, error: "missing_args" });
    }
    try {
      const result = claimLand(db, {
        userId,
        worldId,
        x: Number(x),
        z: Number(z),
        radiusM: Number(radiusM),
        walletDebit: null,  // skip wallet gate for v1 — bond enforcement covered by tickMaintenance
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  router.post("/:claimId/invite", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const { claimId } = req.params;
    const { targetUserId, role } = req.body || {};
    if (!targetUserId) return res.status(400).json({ ok: false, error: "missing_target_user" });
    try {
      const result = inviteToClaim(db, {
        claimId,
        userId: targetUserId,
        role: role || "guest",
        invitedBy: userId,
      });
      return res.json(result);
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  router.post("/:claimId/building", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const { claimId } = req.params;
    const {
      buildingType, x, y = 0, z, name,
      rotation = 0, width = 10, depth = 10, height = 8, material = "stone", floors = 1,
    } = req.body || {};

    if (!ALLOWED_BUILDING_TYPES.has(buildingType)) {
      return res.status(400).json({ ok: false, error: "unknown_building_type", allowed: [...ALLOWED_BUILDING_TYPES] });
    }
    if (!ALLOWED_MATERIALS.has(material)) {
      return res.status(400).json({ ok: false, error: "unknown_material", allowed: [...ALLOWED_MATERIALS] });
    }
    if (x == null || z == null) return res.status(400).json({ ok: false, error: "missing_position" });

    // Resolve the claim to verify the position is inside it and the user
    // has build permission.
    const claim = db.prepare(`SELECT * FROM land_claims WHERE id = ?`).get(claimId);
    if (!claim) return res.status(404).json({ ok: false, error: "claim_not_found" });

    // Verify the position is inside THIS claim (and that there's a claim
    // at that position at all). If a claim exists but it's a different
    // one, the player needs to build in their own area.
    const here = claimAt(db, claim.world_id, Number(x), Number(z));
    if (!here || here.id !== claimId) {
      return res.status(400).json({ ok: false, error: "position_outside_claim" });
    }

    // Ownership / role gate — canActIn returns a plain boolean.
    const isOwner = claim.owner_user_id === userId;
    if (!isOwner) {
      const allowed = canActIn(db, claim.world_id, Number(x), Number(z), userId, "build");
      if (!allowed) return res.status(403).json({ ok: false, error: "not_authorised_to_build" });
    }

    try {
      const id = crypto.randomUUID();
      const buildingName = name || `${userId.slice(0, 6)}'s ${buildingType}`;
      db.prepare(`
        INSERT INTO world_buildings
          (id, world_id, building_type, name, x, y, z, rotation, width, depth, height,
           material, floors, owner_type, owner_id, state, health_pct, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'player', ?, 'standing', 1.0, unixepoch())
      `).run(
        id, claim.world_id, buildingType, buildingName,
        Number(x), Number(y), Number(z),
        Number(rotation), Number(width), Number(depth), Number(height),
        material, Number(floors),
        userId,
      );

      // Audit log via land_claim_events for "I built here".
      try {
        db.prepare(`
          INSERT INTO land_claim_events (id, claim_id, actor_user_id, event_type, event_json)
          VALUES (?, ?, ?, 'building_placed', ?)
        `).run(crypto.randomUUID(), claimId, userId, JSON.stringify({ buildingId: id, type: buildingType, x, z }));
      } catch { /* events table optional */ }

      // Realtime fan-out so other clients in the world see the new building.
      try {
        req.app.locals.io?.to(`world:${claim.world_id}`)?.emit?.("world:building-placed", {
          worldId: claim.world_id,
          buildingId: id,
          claimId,
          ownerId: userId,
          buildingType,
          name: buildingName,
          position: { x, y, z },
        });
      } catch { /* realtime best-effort */ }

      return res.json({ ok: true, buildingId: id, name: buildingName });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "persist_failed", message: err.message });
    }
  });

  router.get("/:claimId/buildings", requireAuth, (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "no_user" });
    const { claimId } = req.params;
    const claim = db.prepare(`SELECT * FROM land_claims WHERE id = ?`).get(claimId);
    if (!claim) return res.status(404).json({ ok: false, error: "claim_not_found" });
    try {
      // Buildings inside the claim circle.
      const buildings = db.prepare(`
        SELECT * FROM world_buildings
        WHERE world_id = ?
          AND ((x - ?) * (x - ?) + (z - ?) * (z - ?)) <= (? * ?)
        ORDER BY created_at DESC
        LIMIT 200
      `).all(
        claim.world_id,
        claim.anchor_x, claim.anchor_x,
        claim.anchor_z, claim.anchor_z,
        claim.radius_m, claim.radius_m,
      );
      return res.json({ ok: true, claim, buildings });
    } catch (err) {
      return res.status(500).json({ ok: false, error: "internal", message: err.message });
    }
  });

  return router;
}
