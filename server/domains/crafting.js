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

  /**
   * marketplace_browse — search recipe listings without going through the
   * /api/marketplace/artifacts route. Lets the universal /api/lens/run
   * pipeline (and analytics / subagents) discover listings the same way
   * the Browse tab does.
   *
   * Input: { types?: string[], search?: string, sort?: 'newest'|'price-asc'|'price-desc', limit?: number }
   */
  registerLensAction("crafting", "marketplace_browse", (_ctx, input = {}) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { items: [], total: 0 } };
    const TYPES = new Set(
      Array.isArray(input.types) && input.types.length
        ? input.types
        : ["fighting_style_recipe", "spell_recipe", "blueprint", "food_recipe"],
    );
    const search = String(input.search || "").toLowerCase();
    const limit = Number.isFinite(input.limit) ? Math.min(Number(input.limit), 200) : 100;
    const items = [];
    for (const dtu of STATE.dtus.values?.() ?? []) {
      const t = dtu.meta?.type ?? dtu.body?.meta?.type;
      if (!t || !TYPES.has(t)) continue;
      const listing = dtu.marketplaceListing || dtu.meta?.marketplace_listing;
      if (!listing) continue; // unlisted personal recipes don't show up
      const title = String(dtu.title || "");
      if (search && !title.toLowerCase().includes(search)) continue;
      items.push({
        id: dtu.id,
        title,
        type: t,
        price: listing.price ?? null,
        tier_prices: listing.tier_prices ?? null,
        creator_id: dtu.ownerUserId,
        listed_at: listing.listed_at ?? listing.created_at ?? null,
      });
    }
    if (input.sort === "price-asc")  items.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    if (input.sort === "price-desc") items.sort((a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity));
    if (!input.sort || input.sort === "newest") {
      items.sort((a, b) => String(b.listed_at || "").localeCompare(String(a.listed_at || "")));
    }
    const total = items.length;
    return { ok: true, result: { items: items.slice(0, limit), total } };
  });

  /**
   * forge_preflight — preview a craft execution without committing it.
   * Returns the skill / resource gate evaluation that the UI's Forge tab
   * displays inline. Lets agents and subagents reason about feasibility
   * before calling /api/crafting/execute.
   *
   * Input: { recipeId: string, worldId?: string }
   * Output: { feasible: boolean, missing_skills: [], missing_resources: [] }
   */
  registerLensAction("crafting", "forge_preflight", (ctx, input = {}) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: false, error: "state_unavailable" };
    const recipeId = String(input.recipeId || "");
    if (!recipeId) return { ok: false, error: "recipeId required" };
    const dtu = STATE.dtus.get?.(recipeId);
    if (!dtu) return { ok: false, error: "recipe_not_found" };
    const userId = ctx?.actor?.id || ctx?.actor?.userId;
    if (userId && dtu.ownerUserId && dtu.ownerUserId !== userId) {
      return { ok: false, error: "forbidden" };
    }
    const spec = dtu.meta?.spec || dtu.body?.spec || {};
    const skillReqs = Array.isArray(spec.skill_requirements) ? spec.skill_requirements : [];
    const resourceReqs = Array.isArray(spec.resource_requirements) ? spec.resource_requirements : [];
    return {
      ok: true,
      result: {
        feasible: skillReqs.length === 0 && resourceReqs.length === 0,
        skill_requirements: skillReqs,
        resource_requirements: resourceReqs,
        recipe_title: dtu.title,
        recipe_type: spec.output?.type ?? null,
      },
    };
  });
}
