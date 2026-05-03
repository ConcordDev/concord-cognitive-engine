// server/domains/crafting.js
// Crafting lens domain. The crafting page is mostly self-contained — it
// calls /api/personal-locker/dtus + /api/world/cook directly — but the
// universal lens-action pipeline (POST /api/lens/run with domain
// 'crafting') still expects at least a `list` action that returns the
// player's recipe DTUs. Without it, the lens shows empty when the
// universal LensFeaturePanel polls.

export default function registerCraftingActions(registerLensAction) {
  /**
   * list — return the caller's personal recipe DTUs (fighting_style /
   * spell / blueprint / food). The lens UI fetches via personal-locker
   * directly, so this is mostly used by analytics + cross-domain search.
   */
  registerLensAction("crafting", "list", (ctx) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { items: [] } };
    const userId = ctx?.actor?.id || ctx?.actor?.userId;
    const RECIPE_TYPES = new Set([
      "fighting_style_recipe",
      "spell_recipe",
      "blueprint",
      "food_recipe",
    ]);
    const items = [];
    for (const dtu of STATE.dtus.values?.() ?? []) {
      if (userId && dtu.ownerUserId !== userId) continue;
      const t = dtu.meta?.type ?? dtu.body?.meta?.type;
      if (!t || !RECIPE_TYPES.has(t)) continue;
      items.push({
        dtuId: dtu.id,
        title: dtu.title,
        type: t,
        createdAt: dtu.createdAt,
      });
    }
    return { ok: true, result: { items, count: items.length } };
  });

  /**
   * counts — quick stats for the lens header.
   */
  registerLensAction("crafting", "counts", (ctx) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { fighting_style: 0, spell: 0, blueprint: 0, food: 0 } };
    const userId = ctx?.actor?.id || ctx?.actor?.userId;
    const counts = { fighting_style_recipe: 0, spell_recipe: 0, blueprint: 0, food_recipe: 0 };
    for (const dtu of STATE.dtus.values?.() ?? []) {
      if (userId && dtu.ownerUserId !== userId) continue;
      const t = dtu.meta?.type ?? dtu.body?.meta?.type;
      if (t && counts[t] != null) counts[t]++;
    }
    return { ok: true, result: counts };
  });
}
