// server/routes/vehicles.js
//
// Vehicle ownership + mount state. Mounted at /api/vehicles.
//
//   GET   /                        — list your active vehicles
//   POST  /spawn                   — spawn a new vehicle (auth)
//                                     body: { type: 'car'|'glider'|'plane', world?, pose? }
//   POST  /:id/mount               — flip presence to in-vehicle (auth)
//                                     body: { pose? } — passes pose through to client
//   POST  /dismount                 — leave current vehicle (auth)
//   POST  /:id/despawn             — destroy your vehicle (auth)
//   POST  /:id/pose                — update vehicle pose between client tick (auth)
//
// All vehicle authority is on the server: clients cannot forge a vehicle type
// to gain a higher speed clamp. Mount/dismount is gated by validateOwnership.

import { Router } from "express";
import {
  spawnVehicle,
  listOwnedVehicles,
  getVehicle,
  validateOwnership,
  updatePose,
  despawnVehicle,
} from "../lib/vehicles.js";
import { setUserVehicle, getUserVehicle } from "./../lib/city-presence.js";

export default function createVehiclesRouter({ requireAuth, db }) {
  const router = Router();
  const auth = requireAuth;
  const _userId = (req) => req.user?.id || req.headers["x-user-id"] || null;

  router.get("/", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const world = req.query.world ? String(req.query.world) : null;
      const vehicles = listOwnedVehicles(db, userId, { world });
      const current  = getUserVehicle(userId);
      res.json({ ok: true, vehicles, current });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  router.post("/spawn", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const { type = "car", world = "concordia", pose = null } = req.body || {};
      const r = spawnVehicle(db, { ownerId: userId, world, type, pose });
      if (!r.ok) return res.status(400).json(r);
      res.status(201).json(r);
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  router.post("/:id/mount", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const v = validateOwnership(db, req.params.id, userId);
      if (!v) return res.status(403).json({ ok: false, error: "not_owner" });
      // Server-authoritative mount: presence type is read from DB, not body.
      setUserVehicle(userId, { vehicleId: v.id, vehicleType: v.type });
      res.json({ ok: true, vehicle: v });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  router.post("/dismount", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      setUserVehicle(userId, { vehicleId: null, vehicleType: null });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  router.post("/:id/pose", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const v = validateOwnership(db, req.params.id, userId);
      if (!v) return res.status(403).json({ ok: false, error: "not_owner" });
      updatePose(db, v.id, req.body?.pose || {});
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  router.post("/:id/despawn", auth, (req, res) => {
    try {
      const userId = _userId(req);
      if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
      const r = despawnVehicle(db, req.params.id, userId);
      if (!r.ok) return res.status(400).json(r);
      // If the player was riding this vehicle, dismount them automatically.
      const cur = getUserVehicle(userId);
      if (cur.vehicleId === req.params.id) {
        setUserVehicle(userId, { vehicleId: null, vehicleType: null });
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false, error: "An unexpected error occurred" });
    }
  });

  return router;
}
