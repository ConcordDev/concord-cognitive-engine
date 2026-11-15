// server/domains/achievements.js
//
// Phase U2 — macro surface for the achievements gallery lens.
//
// The `/lenses/achievements` page reads the REST routes
// /api/achievements/{catalog,mine,recent}; these macros expose the SAME
// read-only engine surface through runMacro so the generic lens shell, ⌘K
// palette, and the Orchestrated Invariant Engine (contract: achievements.*)
// can reach them. Unlocks happen server-side. achievements.sync re-checks
// DTUs the caller already owns. It does not grant an achievement the
// count has not earned.

import {
  listCatalog,
  getAchievement,
  listEarned,
  listRecent,
  syncDtuCreationAchievements,
} from "../lib/achievement-engine.js";
import { registerLensExportProvider } from "../lib/lens-export.js";

function achievementsExportRows(ctx) {
  const db = ctx?.db;
  const userId = ctx?.actor?.userId || ctx?.userId || null;
  if (!db || !userId) return [];
  return listEarned(db, userId).map((row) => ({
    id: row.achievement_id,
    type: "achievement",
    title: row.title || row.achievement_id,
    createdAt: row.earned_at || null,
    updatedAt: row.earned_at || null,
    data: {
      achievementId: row.achievement_id,
      title: row.title || null,
      category: row.category || null,
      earnedAt: row.earned_at || null,
      rarity: row.rarity || null,
    },
  }));
}

/** Shape one catalog entry exactly as GET /api/achievements/catalog does. */
function shapeCatalogEntry(a) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    category: a.category,
    icon: a.icon,
    rarity: a.rarity,
    hidden: !!a.hidden,
    rewardSparks: (a.rewardSparks ?? a.rewardCc) || 0,
    rewardTitle: a.rewardTitle || null,
  };
}

export default function registerAchievementMacros(register) {
  registerLensExportProvider("achievements", achievementsExportRows);
  /**
   * achievements.list — the full authored catalog (display fields only).
   * Public-read: the catalog is the same data the catalog REST route serves.
   */
  register("achievements", "list", async (_ctx, input = {}) => {
    let catalog = listCatalog().map(shapeCatalogEntry);
    if (input.category && input.category !== "all") {
      catalog = catalog.filter((a) => a.category === input.category);
    }
    // Hidden entries are only meaningful once earned — the lens filters them
    // per-user, so the catalog macro returns them but flagged.
    return { ok: true, catalog };
  }, { note: "authored achievement catalog (display fields)" });

  /**
   * achievements.get — a single catalog entry by id.
   */
  register("achievements", "get", async (_ctx, input = {}) => {
    if (!input.id) return { ok: false, reason: "missing_id" };
    const a = getAchievement(input.id);
    if (!a) return { ok: false, reason: "unknown_achievement" };
    return { ok: true, achievement: shapeCatalogEntry(a) };
  }, { note: "single achievement catalog entry by id" });

  /**
   * achievements.mine — the actor's earned achievements (catalog-joined).
   */
  register("achievements", "mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = input.userId || ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, earned: listEarned(db, userId) };
  }, { note: "the actor's earned achievements" });

  /**
   * achievements.recent — recent non-hidden unlocks across all players.
   */
  /**
   * achievements.sync — count the caller's DTUs and unlock First DTU /
   * Creator when that count already qualifies. The create broadcast
   * used to omit the owner, so a library of hundreds of DTUs stayed at
   * 0 earned until this re-check.
   */
  register("achievements", "sync", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!userId || userId === "anon") return { ok: false, error: "no_user" };
    let count = 0;
    try {
      const row = db.prepare("SELECT COUNT(*) AS n FROM dtus WHERE owner_user_id = ?").get(userId);
      count = Number(row?.n) || 0;
    } catch { count = 0; }
    try {
      const state = globalThis._concordSTATE;
      if (state?.dtus && typeof state.dtus.values === "function") {
        let mem = 0;
        for (const d of state.dtus.values()) {
          const owner = d?.ownerUserId || d?.ownerId || d?.author || d?.userId || d?.createdBy;
          if (owner === userId) mem += 1;
        }
        if (mem > count) count = mem;
      }
    } catch { /* the memory store is optional */ }
    const synced = syncDtuCreationAchievements(db, userId, count);
    return { ok: true, count, unlocked: synced.unlocked || [] };
  }, { note: "re-check First DTU and Creator from DTUs the caller already owns" });

  register("achievements", "recent", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    return { ok: true, recent: listRecent(db, { limit }) };
  }, { note: "recent non-hidden achievement unlocks" });
}
