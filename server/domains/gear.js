// server/domains/gear.js
//
// Macro surface for gear DURABILITY + REPAIR.
//
//   gear.durability   — read: list the caller's items that have durability,
//                       with broken/low flags + per-item repair cost + total.
//   gear.repair_all   — write (auth required): repair every damaged equipped/
//                       owned gear item, refilling to max, debiting Concord
//                       Coin (a gold sink) via the canonical wallet debit.
//
// Inventory is USER-GLOBAL — these read/write by user_id only, never world_id.

import {
  getInventoryDurability,
  repairAll,
  makeWalletDebit,
  DURABILITY,
} from "../lib/gear-durability.js";

export default function registerGearMacros(register) {
  register("gear", "durability", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || userId === "anon") return { ok: false, reason: "no_actor" };
    const items = getInventoryDurability(db, userId);
    const repairCostTotal = items
      .filter((i) => !i.broken ? i.current < i.max : true)
      .reduce((sum, i) => sum + (i.repairCost || 0), 0);
    return {
      ok: true,
      items,
      repairCostTotal,
      brokenCount: items.filter((i) => i.broken).length,
      lowCount: items.filter((i) => i.lowDurability).length,
      lowFraction: DURABILITY.LOW_FRACTION,
    };
  }, { note: "list the caller's gear durability + repair cost", read: true });

  register("gear", "repair_all", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || userId === "anon") return { ok: false, reason: "no_actor" };
    const result = repairAll(db, userId, { walletDebit: makeWalletDebit(db, userId) });
    if (!result.ok) return result;
    // Emit the refreshed durability state to the player's client so HUDs update.
    try {
      const io = globalThis?.__CONCORD_REALTIME__?.io;
      io?.to(`user:${userId}`).emit("world:gear-repaired", {
        userId,
        cost: result.cost,
        repaired: result.repaired,
      });
    } catch { /* emit best-effort */ }
    return result;
  }, { note: "repair all damaged gear (gold sink) — refills durability to max" });
}
