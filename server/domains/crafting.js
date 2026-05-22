// server/domains/crafting.js
// Crafting lens domain. The crafting page is mostly self-contained — it
// calls /api/personal-locker/dtus + /api/world/cook directly — but the
// universal lens-action pipeline (POST /api/lens/run with domain
// 'crafting') still expects at least a `list` action that returns the
// player's recipe DTUs. Without it, the lens shows empty when the
// universal LensFeaturePanel polls.
//
// The backlog macros below (grid_*, discovery_*, queue_*, etc.) persist
// per-user crafting state in globalThis._concordSTATE Maps. Every value
// is real user input or computed from real input — no seed data.

const RECIPE_TYPES = new Set([
  "fighting_style_recipe",
  "spell_recipe",
  "blueprint",
  "food_recipe",
]);

// ── per-user state helpers ──────────────────────────────────────────
// All crafting backlog state lives on dedicated Maps hung off the
// shared STATE object, keyed by userId. They are created lazily.

function userIdOf(ctx) {
  return ctx?.actor?.id || ctx?.actor?.userId || ctx?.userId || "anon";
}

function bucket(name) {
  const STATE = (globalThis._concordSTATE ||= {});
  return (STATE[name] ||= new Map());
}

function userList(name, uid) {
  const m = bucket(name);
  if (!m.has(uid)) m.set(uid, []);
  return m.get(uid);
}

function userMap(name, uid) {
  const m = bucket(name);
  if (!m.has(uid)) m.set(uid, new Map());
  return m.get(uid);
}

function persist() {
  try { globalThis._concordSaveStateDebounced?.(); } catch { /* non-fatal */ }
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// Quality tier ladder — derived from a 0..1 roll, never random sample data.
const QUALITY_TIERS = [
  { tier: "crude",      min: 0.0,  label: "Crude",      multiplier: 0.7 },
  { tier: "standard",   min: 0.35, label: "Standard",   multiplier: 1.0 },
  { tier: "fine",       min: 0.7,  label: "Fine",       multiplier: 1.3 },
  { tier: "exquisite",  min: 0.9,  label: "Exquisite",  multiplier: 1.7 },
  { tier: "masterwork", min: 0.98, label: "Masterwork", multiplier: 2.2 },
];

function tierForRoll(roll) {
  let chosen = QUALITY_TIERS[0];
  for (const t of QUALITY_TIERS) if (roll >= t.min) chosen = t;
  return chosen;
}

export default function registerCraftingActions(registerLensAction) {
  /**
   * list — return the caller's personal recipe DTUs (fighting_style /
   * spell / blueprint / food). The lens UI fetches via personal-locker
   * directly, so this is mostly used by analytics + cross-domain search.
   */
  registerLensAction("crafting", "list", (ctx) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: true, result: { items: [] } };
    const userId = userIdOf(ctx);
    const items = [];
    for (const dtu of STATE.dtus.values?.() ?? []) {
      if (userId && userId !== "anon" && dtu.ownerUserId !== userId) continue;
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
    if (!STATE?.dtus) return { ok: true, result: { fighting_style_recipe: 0, spell_recipe: 0, blueprint: 0, food_recipe: 0 } };
    const userId = userIdOf(ctx);
    const counts = { fighting_style_recipe: 0, spell_recipe: 0, blueprint: 0, food_recipe: 0 };
    for (const dtu of STATE.dtus.values?.() ?? []) {
      if (userId && userId !== "anon" && dtu.ownerUserId !== userId) continue;
      const t = dtu.meta?.type ?? dtu.body?.meta?.type;
      if (t && counts[t] != null) counts[t]++;
    }
    return { ok: true, result: counts };
  });

  /**
   * marketplace_browse — search recipe listings without going through the
   * /api/marketplace/artifacts route.
   *
   * Input: { types?: string[], search?: string, sort?: 'newest'|'price-asc'|'price-desc', limit?: number }
   */
  registerLensAction("crafting", "marketplace_browse", (_ctx, _artifact, input = {}) => {
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
   *
   * Input: { recipeId: string, worldId?: string }
   */
  registerLensAction("crafting", "forge_preflight", (ctx, _artifact, input = {}) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: false, error: "state_unavailable" };
    const recipeId = String(input.recipeId || "");
    if (!recipeId) return { ok: false, error: "recipeId required" };
    const dtu = STATE.dtus.get?.(recipeId);
    if (!dtu) return { ok: false, error: "recipe_not_found" };
    const userId = userIdOf(ctx);
    if (userId && userId !== "anon" && dtu.ownerUserId && dtu.ownerUserId !== userId) {
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

  // ══ Backlog: Visual crafting grid / drag-drop assembly ═════════════
  // A 3×3 assembly grid. The user drops materials into slots; the grid
  // shape is persisted so an authored recipe can be reconstructed. Each
  // saved grid pattern can later be promoted to a recipe DTU.

  /**
   * grid_save — persist a 3×3 assembly grid pattern.
   * params: { name, cells: [{ slot:0..8, material, quantity }], output?:{name,type} }
   */
  registerLensAction("crafting", "grid_save", (ctx, _artifact, params = {}) => {
    const uid = userIdOf(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const cellsIn = Array.isArray(params.cells) ? params.cells : [];
    const cells = cellsIn
      .filter((c) => c && Number.isInteger(c.slot) && c.slot >= 0 && c.slot <= 8 && String(c.material || "").trim())
      .map((c) => ({
        slot: c.slot,
        material: String(c.material).trim(),
        quantity: Math.max(1, parseInt(c.quantity, 10) || 1),
      }));
    if (cells.length === 0) return { ok: false, error: "at least one filled cell required" };
    const grids = userList("craftingGrids", uid);
    const existing = grids.find((g) => g.name.toLowerCase() === name.toLowerCase());
    const output = params.output && typeof params.output === "object"
      ? { name: String(params.output.name || name), type: String(params.output.type || "blueprint") }
      : { name, type: "blueprint" };
    if (existing) {
      existing.cells = cells;
      existing.output = output;
      existing.updatedAt = new Date().toISOString();
      persist();
      return { ok: true, result: { grid: existing, updated: true } };
    }
    const grid = {
      id: newId("grid"),
      name,
      cells,
      output,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    grids.push(grid);
    persist();
    return { ok: true, result: { grid, updated: false } };
  });

  /**
   * grid_list — list the caller's saved assembly grids.
   */
  registerLensAction("crafting", "grid_list", (ctx) => {
    const uid = userIdOf(ctx);
    const grids = userList("craftingGrids", uid);
    return { ok: true, result: { grids: grids.slice(), count: grids.length } };
  });

  /**
   * grid_delete — remove a saved grid pattern.
   * params: { id }
   */
  registerLensAction("crafting", "grid_delete", (ctx, _artifact, params = {}) => {
    const uid = userIdOf(ctx);
    const id = String(params.id || "");
    const grids = userList("craftingGrids", uid);
    const idx = grids.findIndex((g) => g.id === id);
    if (idx === -1) return { ok: false, error: "grid_not_found" };
    grids.splice(idx, 1);
    persist();
    return { ok: true, result: { deleted: id, count: grids.length } };
  });

  // ══ Backlog: Recipe discovery / experimentation ════════════════════
  // The user combines materials. A discovery is the deterministic
  // fingerprint of the sorted material set. Re-submitting the same set
  // is idempotent; a new combination is recorded as "discovered".

  /**
   * discovery_combine — submit a material combination for experimentation.
   * params: { materials: [{ material, quantity }] }
   * Returns whether the combination was newly discovered + a derived
   * recipe outline the user can promote to an authored recipe.
   */
  registerLensAction("crafting", "discovery_combine", (ctx, _artifact, params = {}) => {
    const uid = userIdOf(ctx);
    const matsIn = Array.isArray(params.materials) ? params.materials : [];
    const mats = matsIn
      .filter((m) => m && String(m.material || "").trim())
      .map((m) => ({
        material: String(m.material).trim().toLowerCase(),
        quantity: Math.max(1, parseInt(m.quantity, 10) || 1),
      }));
    if (mats.length < 2) return { ok: false, error: "combine at least 2 materials to experiment" };
    // Deterministic fingerprint — sorted material:qty pairs.
    const fingerprint = mats
      .map((m) => `${m.material}:${m.quantity}`)
      .sort()
      .join("|");
    const discoveries = userMap("craftingDiscoveries", uid);
    if (discoveries.has(fingerprint)) {
      const prior = discoveries.get(fingerprint);
      prior.attempts += 1;
      prior.lastAttemptAt = new Date().toISOString();
      persist();
      return { ok: true, result: { discovered: false, recipe: prior, fingerprint } };
    }
    // Derive an outline deterministically from the input — no random sample.
    const distinct = mats.length;
    const totalQty = mats.reduce((s, m) => s + m.quantity, 0);
    const complexity = distinct * 2 + Math.min(totalQty, 20);
    const outputType =
      distinct >= 4 ? "blueprint" :
      distinct === 3 ? "fighting_style_recipe" :
      "food_recipe";
    const outputName = mats.map((m) => m.material).sort().join(" + ");
    const record = {
      id: newId("disc"),
      fingerprint,
      materials: mats,
      outline: {
        suggestedType: outputType,
        suggestedName: outputName,
        complexity,
        estimatedXp: complexity * 5,
      },
      attempts: 1,
      discoveredAt: new Date().toISOString(),
      lastAttemptAt: new Date().toISOString(),
    };
    discoveries.set(fingerprint, record);
    persist();
    return { ok: true, result: { discovered: true, recipe: record, fingerprint } };
  });

  /**
   * discovery_list — list all combinations the caller has discovered.
   */
  registerLensAction("crafting", "discovery_list", (ctx) => {
    const uid = userIdOf(ctx);
    const discoveries = userMap("craftingDiscoveries", uid);
    const items = [...discoveries.values()].sort((a, b) =>
      String(b.discoveredAt).localeCompare(String(a.discoveredAt)));
    return { ok: true, result: { discoveries: items, count: items.length } };
  });

  // ══ Backlog: Crafting queue + batch crafting ═══════════════════════
  // Queue of pending crafts. queue_craft_all processes every pending
  // entry, rolling quality per entry, and returns the batch outcome.

  /**
   * queue_add — enqueue a craft job.
   * params: { recipeId, recipeName, quantity?, skillLevel? }
   */
  registerLensAction("crafting", "queue_add", (ctx, _artifact, params = {}) => {
    const uid = userIdOf(ctx);
    const recipeId = String(params.recipeId || "").trim();
    const recipeName = String(params.recipeName || "").trim();
    if (!recipeId || !recipeName) return { ok: false, error: "recipeId and recipeName required" };
    const quantity = Math.min(99, Math.max(1, parseInt(params.quantity, 10) || 1));
    const skillLevel = Math.max(0, Number(params.skillLevel) || 0);
    const queue = userList("craftingQueue", uid);
    const entry = {
      id: newId("job"),
      recipeId,
      recipeName,
      quantity,
      skillLevel,
      status: "pending",
      enqueuedAt: new Date().toISOString(),
    };
    queue.push(entry);
    persist();
    return { ok: true, result: { job: entry, queueDepth: queue.filter((j) => j.status === "pending").length } };
  });

  /**
   * queue_list — list the caller's craft queue.
   */
  registerLensAction("crafting", "queue_list", (ctx) => {
    const uid = userIdOf(ctx);
    const queue = userList("craftingQueue", uid);
    const pending = queue.filter((j) => j.status === "pending");
    return {
      ok: true,
      result: {
        queue: queue.slice(),
        pending: pending.length,
        totalUnits: pending.reduce((s, j) => s + j.quantity, 0),
      },
    };
  });

  /**
   * queue_remove — drop a queued job.
   * params: { id }
   */
  registerLensAction("crafting", "queue_remove", (ctx, _artifact, params = {}) => {
    const uid = userIdOf(ctx);
    const id = String(params.id || "");
    const queue = userList("craftingQueue", uid);
    const idx = queue.findIndex((j) => j.id === id);
    if (idx === -1) return { ok: false, error: "job_not_found" };
    queue.splice(idx, 1);
    persist();
    return { ok: true, result: { removed: id } };
  });

  /**
   * queue_craft_all — process every pending job in the queue. Each unit
   * rolls a quality tier (see quality_roll). Crafted jobs move to
   * crafting history. Returns the per-job batch outcome.
   * params: { seed? } — optional deterministic seed for the quality roll.
   */
  registerLensAction("crafting", "queue_craft_all", (ctx, _artifact, params = {}) => {
    const uid = userIdOf(ctx);
    const queue = userList("craftingQueue", uid);
    const history = userList("craftingHistory", uid);
    const pending = queue.filter((j) => j.status === "pending");
    if (pending.length === 0) return { ok: false, error: "queue empty" };
    // Deterministic roll: seeded mulberry32 so a test can pin output.
    let seed = Number.isFinite(params.seed) ? (params.seed >>> 0) : (Date.now() >>> 0);
    const rng = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const results = [];
    let totalUnits = 0;
    for (const job of pending) {
      const units = [];
      for (let i = 0; i < job.quantity; i++) {
        // Skill biases the roll upward (capped); base is a fair roll.
        const skillBias = Math.min(0.25, job.skillLevel * 0.01);
        const roll = Math.min(0.999, rng() * (1 - skillBias) + skillBias);
        const tier = tierForRoll(roll);
        units.push({ tier: tier.tier, label: tier.label, multiplier: tier.multiplier });
      }
      job.status = "crafted";
      job.craftedAt = new Date().toISOString();
      job.units = units;
      totalUnits += units.length;
      const historyEntry = {
        id: newId("hist"),
        recipeId: job.recipeId,
        recipeName: job.recipeName,
        quantity: job.quantity,
        units,
        bestTier: units.reduce((best, u) =>
          u.multiplier > best.multiplier ? u : best, units[0]),
        craftedAt: job.craftedAt,
      };
      history.unshift(historyEntry);
      results.push(historyEntry);
    }
    // Cap history at 200 entries.
    if (history.length > 200) history.length = 200;
    // Drop crafted jobs from the live queue.
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].status === "crafted") queue.splice(i, 1);
    }
    persist();
    return {
      ok: true,
      result: {
        crafted: results,
        jobsProcessed: results.length,
        totalUnits,
      },
    };
  });

  // ══ Backlog: "Craftable now" filter ════════════════════════════════
  // Given the caller's recipes (with resource_requirements) and a live
  // inventory snapshot, return which recipes can be crafted right now.

  /**
   * craftable_now — filter recipes by current inventory availability.
   * params: {
   *   recipes: [{ id, title, requirements:[{material, quantity}] }],
   *   inventory: [{ item_name, quantity }]
   * }
   */
  registerLensAction("crafting", "craftable_now", (_ctx, _artifact, params = {}) => {
    const recipes = Array.isArray(params.recipes) ? params.recipes : [];
    const inventory = Array.isArray(params.inventory) ? params.inventory : [];
    // Build an availability map from real inventory input.
    const have = new Map();
    for (const it of inventory) {
      const name = String(it?.item_name || it?.name || "").trim().toLowerCase();
      if (!name) continue;
      have.set(name, (have.get(name) || 0) + (parseInt(it.quantity, 10) || 1));
    }
    const evaluated = recipes.map((r) => {
      const reqs = Array.isArray(r?.requirements) ? r.requirements : [];
      const missing = [];
      for (const req of reqs) {
        const name = String(req?.material || req?.resource_type || "").trim().toLowerCase();
        const need = Math.max(1, parseInt(req.quantity, 10) || 1);
        const got = have.get(name) || 0;
        if (got < need) missing.push({ material: name, need, have: got, short: need - got });
      }
      return {
        id: r?.id,
        title: r?.title,
        craftable: missing.length === 0,
        missing,
        requirementCount: reqs.length,
      };
    });
    const craftable = evaluated.filter((e) => e.craftable);
    return {
      ok: true,
      result: {
        recipes: evaluated,
        craftableCount: craftable.length,
        blockedCount: evaluated.length - craftable.length,
      },
    };
  });

  // ══ Backlog: Quality/rarity tiers on crafted output ════════════════

  /**
   * quality_tiers — return the quality tier ladder so the UI can render
   * the rarity scale.
   */
  registerLensAction("crafting", "quality_tiers", () => {
    return { ok: true, result: { tiers: QUALITY_TIERS.slice() } };
  });

  /**
   * quality_roll — roll a single craft's quality outcome (crit-craft).
   * params: { skillLevel?, focus?:0..1, seed? }
   * focus is the player's deliberate effort (e.g. spent stamina) and
   * biases toward higher tiers. Returns the resulting tier.
   */
  registerLensAction("crafting", "quality_roll", (_ctx, _artifact, params = {}) => {
    const skillLevel = Math.max(0, Number(params.skillLevel) || 0);
    const focus = Math.min(1, Math.max(0, Number(params.focus) || 0));
    let base;
    if (Number.isFinite(params.seed)) {
      let seed = params.seed >>> 0;
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      base = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    } else {
      base = Math.random();
    }
    const skillBias = Math.min(0.3, skillLevel * 0.012);
    const focusBias = focus * 0.2;
    const roll = Math.min(0.999, base * (1 - skillBias - focusBias) + skillBias + focusBias);
    const tier = tierForRoll(roll);
    return {
      ok: true,
      result: {
        roll: Math.round(roll * 1000) / 1000,
        tier: tier.tier,
        label: tier.label,
        multiplier: tier.multiplier,
        crit: tier.multiplier >= 1.7,
      },
    };
  });

  // ══ Backlog: Material gathering integration ════════════════════════
  // Aggregate the material requirements across a set of recipes into a
  // single gather list, then check it against an inventory snapshot to
  // produce a "still need" shopping list with gather-node hints.

  /**
   * gather_plan — build a consolidated gather list for chosen recipes.
   * params: {
   *   recipes: [{ id, title, requirements:[{material, quantity}] }],
   *   inventory?: [{ item_name, quantity }],
   *   nodeHints?: { [material]: nodeType }  — optional gather-node map
   * }
   */
  registerLensAction("crafting", "gather_plan", (_ctx, _artifact, params = {}) => {
    const recipes = Array.isArray(params.recipes) ? params.recipes : [];
    const inventory = Array.isArray(params.inventory) ? params.inventory : [];
    const nodeHints = params.nodeHints && typeof params.nodeHints === "object" ? params.nodeHints : {};
    if (recipes.length === 0) return { ok: false, error: "select at least one recipe to plan a gather run" };
    // Sum material demand across all selected recipes.
    const demand = new Map();
    for (const r of recipes) {
      const reqs = Array.isArray(r?.requirements) ? r.requirements : [];
      for (const req of reqs) {
        const name = String(req?.material || req?.resource_type || "").trim().toLowerCase();
        if (!name) continue;
        const qty = Math.max(1, parseInt(req.quantity, 10) || 1);
        demand.set(name, (demand.get(name) || 0) + qty);
      }
    }
    const have = new Map();
    for (const it of inventory) {
      const name = String(it?.item_name || it?.name || "").trim().toLowerCase();
      if (!name) continue;
      have.set(name, (have.get(name) || 0) + (parseInt(it.quantity, 10) || 1));
    }
    const lines = [...demand.entries()].map(([material, need]) => {
      const got = have.get(material) || 0;
      const stillNeed = Math.max(0, need - got);
      return {
        material,
        need,
        have: got,
        stillNeed,
        satisfied: stillNeed === 0,
        nodeHint: nodeHints[material] || null,
      };
    }).sort((a, b) => b.stillNeed - a.stillNeed);
    const outstanding = lines.filter((l) => !l.satisfied);
    return {
      ok: true,
      result: {
        lines,
        materialCount: lines.length,
        outstandingCount: outstanding.length,
        fullySatisfied: outstanding.length === 0,
        totalUnitsToGather: outstanding.reduce((s, l) => s + l.stillNeed, 0),
      },
    };
  });

  // ══ Backlog: Recipe favorites + crafting history log ═══════════════

  /**
   * favorite_toggle — pin/unpin a recipe as a favorite.
   * params: { recipeId, recipeName?, recipeType? }
   */
  registerLensAction("crafting", "favorite_toggle", (ctx, _artifact, params = {}) => {
    const uid = userIdOf(ctx);
    const recipeId = String(params.recipeId || "").trim();
    if (!recipeId) return { ok: false, error: "recipeId required" };
    const favs = userMap("craftingFavorites", uid);
    if (favs.has(recipeId)) {
      favs.delete(recipeId);
      persist();
      return { ok: true, result: { favorited: false, recipeId, count: favs.size } };
    }
    favs.set(recipeId, {
      recipeId,
      recipeName: String(params.recipeName || recipeId),
      recipeType: String(params.recipeType || ""),
      favoritedAt: new Date().toISOString(),
    });
    persist();
    return { ok: true, result: { favorited: true, recipeId, count: favs.size } };
  });

  /**
   * favorite_list — list the caller's favorite recipes.
   */
  registerLensAction("crafting", "favorite_list", (ctx) => {
    const uid = userIdOf(ctx);
    const favs = userMap("craftingFavorites", uid);
    const items = [...favs.values()].sort((a, b) =>
      String(b.favoritedAt).localeCompare(String(a.favoritedAt)));
    return { ok: true, result: { favorites: items, count: items.length } };
  });

  /**
   * history_list — the caller's crafting history log (most recent first).
   * params: { limit? }
   */
  registerLensAction("crafting", "history_list", (ctx, _artifact, params = {}) => {
    const uid = userIdOf(ctx);
    const history = userList("craftingHistory", uid);
    const limit = Number.isFinite(params.limit) ? Math.min(Math.max(1, params.limit), 200) : 50;
    const slice = history.slice(0, limit);
    // Tier distribution across all logged units.
    const tierTotals = {};
    let unitTotal = 0;
    for (const h of history) {
      for (const u of h.units || []) {
        tierTotals[u.tier] = (tierTotals[u.tier] || 0) + 1;
        unitTotal++;
      }
    }
    return {
      ok: true,
      result: {
        history: slice,
        count: history.length,
        unitsCrafted: unitTotal,
        tierDistribution: tierTotals,
      },
    };
  });

  /**
   * history_clear — wipe the caller's crafting history log.
   */
  registerLensAction("crafting", "history_clear", (ctx) => {
    const uid = userIdOf(ctx);
    const history = userList("craftingHistory", uid);
    const cleared = history.length;
    history.length = 0;
    persist();
    return { ok: true, result: { cleared } };
  });
}
