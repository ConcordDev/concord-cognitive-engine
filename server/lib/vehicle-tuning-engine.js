// server/lib/vehicle-tuning-engine.js
//
// Phase II Wave 15 — vehicle parts catalog + install / uninstall +
// perf-delta math. Each part is authored by a player, registered as a
// DTU (kind='vehicle_part' or 'item' since evo_assets doesn't yet have
// a part kind — we use the dtus table for royalty-cascade tracking),
// optionally listed on the marketplace for purchase, and installable
// onto a vehicle the player owns.
//
// Perf deltas applied via `manifest_json`:
//   { mass_delta_kg, drag_delta, lift_delta, top_speed_delta_mps,
//     hp_delta, torque_delta, paint_color?, decal? }
//
// At runtime, computeVehicleStats(vehicleId) returns the base stats
// (from the vehicle-system kinematics table) plus the sum of all
// installed parts' deltas. Frontend AvatarSystem3D / world-vehicles
// physics tick reads from this when accelerating.

import crypto from "node:crypto";

export const VALID_VEHICLE_KINDS = Object.freeze([
  "cart", "boat", "canal_taxi",
  "car", "motorcycle", "hovercraft", "spaceship",
]);
export const VALID_SLOTS = Object.freeze([
  "engine", "induction", "exhaust", "gearbox", "drivetrain",
  "suspension", "brakes", "tires", "aero", "body_kit",
  "paint", "livery", "interior", "accessory",
]);

// Base stats per vehicle kind. Mirror the kinematics in
// concord-frontend/lib/world-lens/vehicle-system.ts; server-side
// values authoritative for tuning math.
const BASE_STATS = Object.freeze({
  cart:        { mass_kg: 220,  drag: 0.85, lift: 0.0,  top_speed: 8,   hp: 6,    torque: 80   },
  boat:        { mass_kg: 800,  drag: 1.05, lift: 0.0,  top_speed: 12,  hp: 14,   torque: 120  },
  canal_taxi:  { mass_kg: 1100, drag: 1.10, lift: 0.0,  top_speed: 9,   hp: 22,   torque: 180  },
  car:         { mass_kg: 1400, drag: 0.32, lift: 0.0,  top_speed: 55,  hp: 180,  torque: 290  },
  motorcycle:  { mass_kg: 220,  drag: 0.27, lift: 0.0,  top_speed: 75,  hp: 110,  torque: 95   },
  hovercraft:  { mass_kg: 900,  drag: 0.45, lift: 0.9,  top_speed: 40,  hp: 220,  torque: 250  },
  spaceship:   { mass_kg: 14000, drag: 0.05, lift: 1.0, top_speed: 220, hp: 4000, torque: 8500 },
});

export function baseStatsForKind(kind) {
  return BASE_STATS[kind] ? { ...BASE_STATS[kind] } : null;
}

/* ───────── Catalog CRUD ────────────────────────────────────────────── */

/** Register a new part in the catalog. Returns { id, created }. */
export function registerPart(db, opts) {
  if (!opts?.authorUserId) throw new Error("authorUserId required");
  if (!VALID_VEHICLE_KINDS.includes(opts.vehicleKind)) throw new Error(`invalid vehicleKind: ${opts.vehicleKind}`);
  if (!VALID_SLOTS.includes(opts.slot)) throw new Error(`invalid slot: ${opts.slot}`);
  if (!opts.name) throw new Error("name required");

  const id = `vpart_${crypto.randomBytes(8).toString("hex")}`;
  db.prepare(`
    INSERT INTO vehicle_parts_catalog (
      id, author_user_id, vehicle_kind, slot, name, description,
      manifest_json, dtu_id, listed_cents, visibility
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, opts.authorUserId, opts.vehicleKind, opts.slot,
    String(opts.name).slice(0, 120),
    String(opts.description || "").slice(0, 600),
    JSON.stringify(opts.manifest || {}),
    opts.dtuId || null,
    Math.max(0, Math.floor(Number(opts.listedCents) || 0)),
    opts.visibility === "marketplace" || opts.visibility === "public" ? opts.visibility : "private",
  );
  return { id, created: true };
}

export function getPart(db, partId) {
  return db.prepare("SELECT * FROM vehicle_parts_catalog WHERE id = ?").get(partId) || null;
}

export function listPartsByKindAndSlot(db, vehicleKind, slot, options = {}) {
  const visibility = options.visibility || "public";
  if (visibility === "all") {
    return db.prepare(`
      SELECT * FROM vehicle_parts_catalog WHERE vehicle_kind = ? AND slot = ?
      ORDER BY created_at DESC LIMIT 200
    `).all(vehicleKind, slot);
  }
  return db.prepare(`
    SELECT * FROM vehicle_parts_catalog
    WHERE vehicle_kind = ? AND slot = ?
      AND visibility IN ('public','marketplace')
    ORDER BY created_at DESC LIMIT 200
  `).all(vehicleKind, slot);
}

export function listPartsForAuthor(db, authorUserId, vehicleKind) {
  return vehicleKind
    ? db.prepare(`
        SELECT * FROM vehicle_parts_catalog
        WHERE author_user_id = ? AND vehicle_kind = ?
        ORDER BY created_at DESC
      `).all(authorUserId, vehicleKind)
    : db.prepare(`
        SELECT * FROM vehicle_parts_catalog
        WHERE author_user_id = ?
        ORDER BY created_at DESC LIMIT 200
      `).all(authorUserId);
}

/* ───────── Install / uninstall ─────────────────────────────────────── */

/**
 * Install a part onto a vehicle. Updates vehicle_installations + the
 * vehicle's tuning_json. Idempotent — re-installing the same part to
 * the same slot is a no-op. Installing a different part replaces the
 * previous one in that slot.
 */
export function installPart(db, vehicleId, partId, actorUserId) {
  const vehicle = db.prepare("SELECT id, owner_kind, owner_id, kind, tuning_json FROM world_vehicles WHERE id = ?").get(vehicleId);
  if (!vehicle) return { ok: false, reason: "vehicle_not_found" };
  if (vehicle.owner_kind !== "player" || vehicle.owner_id !== actorUserId) {
    return { ok: false, reason: "not_vehicle_owner" };
  }
  const part = getPart(db, partId);
  if (!part) return { ok: false, reason: "part_not_found" };
  if (part.vehicle_kind !== vehicle.kind) {
    return { ok: false, reason: "part_kind_mismatch", expected: vehicle.kind, got: part.vehicle_kind };
  }
  const tuning = JSON.parse(vehicle.tuning_json || "{}");
  if (tuning[part.slot] === partId) {
    return { ok: true, alreadyInstalled: true, slot: part.slot, partId };
  }
  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO vehicle_installations (vehicle_id, slot, part_id, installed_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(vehicle_id, slot) DO UPDATE SET part_id = excluded.part_id, installed_at = unixepoch()
    `).run(vehicleId, part.slot, partId);
    tuning[part.slot] = partId;
    db.prepare(`
      UPDATE world_vehicles SET tuning_json = ?, updated_at = unixepoch() WHERE id = ?
    `).run(JSON.stringify(tuning), vehicleId);
  });
  tx();
  return { ok: true, slot: part.slot, partId };
}

/** Remove a part from a vehicle's slot. */
export function uninstallPart(db, vehicleId, slot, actorUserId) {
  const vehicle = db.prepare("SELECT id, owner_kind, owner_id, tuning_json FROM world_vehicles WHERE id = ?").get(vehicleId);
  if (!vehicle) return { ok: false, reason: "vehicle_not_found" };
  if (vehicle.owner_kind !== "player" || vehicle.owner_id !== actorUserId) {
    return { ok: false, reason: "not_vehicle_owner" };
  }
  const tuning = JSON.parse(vehicle.tuning_json || "{}");
  if (!tuning[slot]) {
    return { ok: false, reason: "slot_empty" };
  }
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM vehicle_installations WHERE vehicle_id = ? AND slot = ?").run(vehicleId, slot);
    delete tuning[slot];
    db.prepare(`
      UPDATE world_vehicles SET tuning_json = ?, updated_at = unixepoch() WHERE id = ?
    `).run(JSON.stringify(tuning), vehicleId);
  });
  tx();
  return { ok: true, slot };
}

export function listInstalledParts(db, vehicleId) {
  const rows = db.prepare(`
    SELECT vi.slot, vi.installed_at, p.*
    FROM vehicle_installations vi
    JOIN vehicle_parts_catalog p ON p.id = vi.part_id
    WHERE vi.vehicle_id = ?
    ORDER BY vi.installed_at DESC
  `).all(vehicleId);
  return rows;
}

/* ───────── Perf compute ────────────────────────────────────────────── */

/**
 * Compute the effective stats for a vehicle given its installed parts.
 * Returns { base, deltas, effective } so callers can show a delta UI.
 */
export function computeVehicleStats(db, vehicleId) {
  const vehicle = db.prepare("SELECT kind FROM world_vehicles WHERE id = ?").get(vehicleId);
  if (!vehicle) return null;
  const base = baseStatsForKind(vehicle.kind);
  if (!base) return null;
  const installed = listInstalledParts(db, vehicleId);
  const deltas = { mass_kg: 0, drag: 0, lift: 0, top_speed: 0, hp: 0, torque: 0 };
  for (const row of installed) {
    let m = {};
    try { m = JSON.parse(row.manifest_json || "{}"); } catch { continue; }
    deltas.mass_kg   += Number(m.mass_delta_kg)        || 0;
    deltas.drag      += Number(m.drag_delta)           || 0;
    deltas.lift      += Number(m.lift_delta)           || 0;
    deltas.top_speed += Number(m.top_speed_delta_mps)  || 0;
    deltas.hp        += Number(m.hp_delta)             || 0;
    deltas.torque    += Number(m.torque_delta)         || 0;
  }
  const effective = {
    mass_kg:   Math.max(50, base.mass_kg   + deltas.mass_kg),
    drag:      Math.max(0.01, base.drag    + deltas.drag),
    lift:      Math.max(0, base.lift       + deltas.lift),
    top_speed: Math.max(0.5, base.top_speed + deltas.top_speed),
    hp:        Math.max(1, base.hp         + deltas.hp),
    torque:    Math.max(1, base.torque     + deltas.torque),
  };
  return { vehicleKind: vehicle.kind, base, deltas, effective };
}

/* ───────── Paint / livery ──────────────────────────────────────────── */

export function setPaint(db, vehicleId, hexColor, actorUserId) {
  if (!/^#[0-9a-fA-F]{6}$/.test(String(hexColor || ""))) {
    return { ok: false, reason: "invalid_hex" };
  }
  const r = db.prepare(`
    UPDATE world_vehicles SET paint_color = ?, updated_at = unixepoch()
    WHERE id = ? AND owner_kind = 'player' AND owner_id = ?
  `).run(hexColor, vehicleId, actorUserId);
  if (r.changes === 0) return { ok: false, reason: "not_vehicle_owner_or_not_found" };
  return { ok: true, paintColor: hexColor };
}

export function addDecal(db, vehicleId, decal, actorUserId) {
  if (!decal || typeof decal !== "object") return { ok: false, reason: "invalid_decal" };
  const vehicle = db.prepare("SELECT decal_json, owner_kind, owner_id FROM world_vehicles WHERE id = ?").get(vehicleId);
  if (!vehicle) return { ok: false, reason: "vehicle_not_found" };
  if (vehicle.owner_kind !== "player" || vehicle.owner_id !== actorUserId) {
    return { ok: false, reason: "not_vehicle_owner" };
  }
  const arr = JSON.parse(vehicle.decal_json || "[]");
  if (arr.length >= 12) return { ok: false, reason: "decal_cap_reached" };
  const cleanDecal = {
    id: crypto.randomBytes(4).toString("hex"),
    kind: String(decal.kind || "label").slice(0, 32),
    x: Number(decal.x) || 0,
    y: Number(decal.y) || 0,
    rotation: Number(decal.rotation) || 0,
    color: typeof decal.color === "string" && /^#[0-9a-fA-F]{6}$/.test(decal.color) ? decal.color : "#222",
    text: typeof decal.text === "string" ? decal.text.slice(0, 80) : null,
    dtuId: typeof decal.dtuId === "string" ? decal.dtuId.slice(0, 80) : null,
  };
  arr.push(cleanDecal);
  db.prepare("UPDATE world_vehicles SET decal_json = ?, updated_at = unixepoch() WHERE id = ?").run(JSON.stringify(arr), vehicleId);
  return { ok: true, decal: cleanDecal };
}

export function removeDecal(db, vehicleId, decalId, actorUserId) {
  const vehicle = db.prepare("SELECT decal_json, owner_kind, owner_id FROM world_vehicles WHERE id = ?").get(vehicleId);
  if (!vehicle) return { ok: false, reason: "vehicle_not_found" };
  if (vehicle.owner_kind !== "player" || vehicle.owner_id !== actorUserId) {
    return { ok: false, reason: "not_vehicle_owner" };
  }
  const arr = JSON.parse(vehicle.decal_json || "[]");
  const next = arr.filter((d) => d.id !== decalId);
  if (next.length === arr.length) return { ok: false, reason: "decal_not_found" };
  db.prepare("UPDATE world_vehicles SET decal_json = ?, updated_at = unixepoch() WHERE id = ?").run(JSON.stringify(next), vehicleId);
  return { ok: true, removed: decalId };
}
