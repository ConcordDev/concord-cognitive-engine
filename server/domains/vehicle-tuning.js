// server/domains/vehicle-tuning.js
//
// Phase II Wave 15 — vehicle customization lens macros.
//
// Players craft + list parts, install them on their owned vehicles,
// paint + decal the bodywork. Each part is a DTU; royalty cascade
// tracks derivatives forever.

import {
  registerPart,
  getPart,
  listPartsByKindAndSlot,
  listPartsForAuthor,
  installPart,
  uninstallPart,
  listInstalledParts,
  computeVehicleStats,
  setPaint,
  addDecal,
  removeDecal,
  baseStatsForKind,
  VALID_VEHICLE_KINDS,
  VALID_SLOTS,
} from "../lib/vehicle-tuning-engine.js";

export default function registerVehicleTuningMacros(register) {
  register("vehicle_tuning", "create_part", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    try {
      return registerPart(db, {
        authorUserId: userId,
        vehicleKind: input?.vehicleKind,
        slot: input?.slot,
        name: input?.name,
        description: input?.description,
        manifest: input?.manifest,
        dtuId: input?.dtuId,
        listedCents: input?.listedCents,
        visibility: input?.visibility,
      });
    } catch (err) {
      return { ok: false, reason: "invalid_input", message: err?.message || String(err) };
    }
  });

  register("vehicle_tuning", "list_catalog", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const vehicleKind = String(input?.vehicleKind || "");
    const slot = String(input?.slot || "");
    if (!VALID_VEHICLE_KINDS.includes(vehicleKind)) return { ok: false, reason: "invalid_vehicleKind" };
    if (!VALID_SLOTS.includes(slot)) return { ok: false, reason: "invalid_slot" };
    return {
      ok: true,
      parts: listPartsByKindAndSlot(db, vehicleKind, slot, { visibility: "public" }),
    };
  });

  register("vehicle_tuning", "list_mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const vehicleKind = input?.vehicleKind ? String(input.vehicleKind) : null;
    if (vehicleKind && !VALID_VEHICLE_KINDS.includes(vehicleKind)) return { ok: false, reason: "invalid_vehicleKind" };
    return { ok: true, parts: listPartsForAuthor(db, userId, vehicleKind) };
  });

  register("vehicle_tuning", "install", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const vehicleId = String(input?.vehicleId || "");
    const partId = String(input?.partId || "");
    if (!vehicleId || !partId) return { ok: false, reason: "missing_inputs" };
    return installPart(db, vehicleId, partId, userId);
  });

  register("vehicle_tuning", "uninstall", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    const vehicleId = String(input?.vehicleId || "");
    const slot = String(input?.slot || "");
    if (!vehicleId || !slot) return { ok: false, reason: "missing_inputs" };
    return uninstallPart(db, vehicleId, slot, userId);
  });

  register("vehicle_tuning", "vehicle_stats", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const vehicleId = String(input?.vehicleId || "");
    if (!vehicleId) return { ok: false, reason: "missing_inputs" };
    const stats = computeVehicleStats(db, vehicleId);
    if (!stats) return { ok: false, reason: "vehicle_not_found" };
    return { ok: true, ...stats };
  });

  register("vehicle_tuning", "list_installed", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const vehicleId = String(input?.vehicleId || "");
    if (!vehicleId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, installed: listInstalledParts(db, vehicleId) };
  });

  register("vehicle_tuning", "set_paint", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return setPaint(db, String(input?.vehicleId || ""), String(input?.paintColor || ""), userId);
  });

  register("vehicle_tuning", "add_decal", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return addDecal(db, String(input?.vehicleId || ""), input?.decal, userId);
  });

  register("vehicle_tuning", "remove_decal", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return removeDecal(db, String(input?.vehicleId || ""), String(input?.decalId || ""), userId);
  });

  register("vehicle_tuning", "base_stats", async (_ctx, input = {}) => {
    const stats = baseStatsForKind(String(input?.kind || ""));
    if (!stats) return { ok: false, reason: "invalid_kind" };
    return { ok: true, kind: input.kind, baseStats: stats };
  });

  register("vehicle_tuning", "get_part", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const part = getPart(db, String(input?.partId || ""));
    if (!part) return { ok: false, reason: "part_not_found" };
    return { ok: true, part };
  });
}
