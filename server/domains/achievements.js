// server/domains/achievements.js
//
// Phase U2 — macro surface for the achievements gallery lens.
//
// The `/lenses/achievements` page reads the REST routes
// /api/achievements/{catalog,mine,recent}; these macros expose the SAME
// read-only engine surface through runMacro so the generic lens shell, ⌘K
// palette, and the Orchestrated Invariant Engine (contract: achievements.*)
// can reach them. All read-only — unlocks happen server-side off realtime
// events via evaluateAchievement, never from a client macro call.

import {
  listCatalog,
  getAchievement,
  listEarned,
  listRecent,
} from "../lib/achievement-engine.js";

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
  register("achievements", "recent", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), 200);
    return { ok: true, recent: listRecent(db, { limit }) };
  }, { note: "recent non-hidden achievement unlocks" });
}
