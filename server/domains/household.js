// server/domains/household.js
// Domain actions for household management: grocery lists, maintenance,
// chore rotation, plus real Open Food Facts product lookup
// (2,000,000+ food products, ingredients, allergens, nutrition,
// Nutri-Score grade). Free, no API key.

const OPEN_FOOD_FACTS = "https://world.openfoodfacts.org/api/v2";

// Fail-closed numeric parse. parseFloat/Number() silently pass Infinity/NaN
// ("Infinity", "1e999", NaN) — guard with Number.isFinite so a poisoned input
// collapses to the fallback instead of leaking Infinity/NaN into output.
function finiteNum(v, fallback = 0) {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}
function finiteInt(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
// Date that is parseable AND finite, else null (so date math never yields NaN).
function finiteDate(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

export default function registerHouseholdActions(registerLensAction) {
  /**
   * generateGroceryList
   * Aggregate ingredients from a meal plan into a consolidated grocery list,
   * combining duplicates and subtracting what is already on hand.
   * artifact.data.mealPlan: [{ day, meal, recipe, ingredients: [{ name, quantity, unit }] }]
   * artifact.data.pantry: [{ name, quantity, unit }] (optional)
   */
  registerLensAction("household", "generateGroceryList", (ctx, artifact, params) => {
  try {
    const d = artifact.data || {};
    const p = params || {};
    // Accept the canonical structured `mealPlan` [{ingredients:[...]}], OR a
    // flat `meals` array (objects with ingredients, or bare recipe-name strings),
    // from either artifact.data or params.
    const rawPlan = d.mealPlan || p.mealPlan || d.meals || p.meals || [];
    const mealPlan = (Array.isArray(rawPlan) ? rawPlan : []).map((m) =>
      typeof m === "string" ? { recipe: m, ingredients: [] } : (m || {})
    );
    const pantry = d.pantry || p.pantry || [];
    const categorize = p.categorize !== false;

    // Aggregate all ingredients from the meal plan
    const aggregated = {};
    for (const meal of mealPlan) {
      for (const ing of (meal.ingredients || [])) {
        const key = `${(ing.name || "").toLowerCase()}|${(ing.unit || "").toLowerCase()}`;
        if (!aggregated[key]) {
          aggregated[key] = {
            name: ing.name,
            quantity: 0,
            unit: ing.unit || "",
            category: ing.category || "other",
            usedIn: [],
          };
        }
        aggregated[key].quantity += finiteNum(ing.quantity, 0);
        const mealLabel = `${meal.day || ""} ${meal.meal || ""}`.trim();
        if (mealLabel && !aggregated[key].usedIn.includes(mealLabel)) {
          aggregated[key].usedIn.push(mealLabel);
        }
      }
    }

    // Subtract pantry quantities
    const pantryMap = {};
    for (const item of pantry) {
      const key = `${(item.name || "").toLowerCase()}|${(item.unit || "").toLowerCase()}`;
      pantryMap[key] = (pantryMap[key] || 0) + finiteNum(item.quantity, 0);
    }

    const groceryList = [];
    for (const [key, item] of Object.entries(aggregated)) {
      const onHand = pantryMap[key] || 0;
      const needed = Math.round((item.quantity - onHand) * 100) / 100;
      if (needed > 0) {
        groceryList.push({
          name: item.name,
          quantity: needed,
          unit: item.unit,
          category: item.category,
          usedIn: item.usedIn,
          hadOnHand: onHand > 0 ? onHand : 0,
        });
      }
    }

    // Group by category if requested
    let byCategory = null;
    if (categorize) {
      byCategory = {};
      for (const item of groceryList) {
        const cat = item.category || "other";
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(item);
      }
    }

    // Sort alphabetically within categories
    groceryList.sort((a, b) => {
      if (a.category !== b.category) return (a.category || "").localeCompare(b.category || "");
      return (a.name || "").localeCompare(b.name || "");
    });

    const result = {
      generatedAt: new Date().toISOString(),
      mealsPlanned: mealPlan.length,
      uniqueItems: groceryList.length,
      pantryItemsSubtracted: Object.keys(pantryMap).length,
      list: groceryList,
      byCategory,
    };

    artifact.data.groceryList = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * maintenanceCheck
   * Check home maintenance items for overdue tasks based on schedule/intervals.
   * artifact.data.maintenanceItems: [{ name, lastCompleted, intervalDays, category, priority }]
   * params.lookaheadDays (default 14)
   */
  registerLensAction("household", "maintenanceCheck", (ctx, artifact, params) => {
  try {
    const items = artifact.data.maintenanceItems || params.maintenanceItems || [];
    const lookaheadDays = finiteNum(params.lookaheadDays, 14);
    const now = new Date();

    const overdue = [];
    const upcoming = [];
    const current = [];

    for (const item of items) {
      const lastDone = finiteDate(item.lastCompleted);
      const interval = finiteInt(item.intervalDays, 30);

      if (!lastDone) {
        overdue.push({ name: item.name, category: item.category || "general", priority: item.priority || "normal", status: "never-completed", daysOverdue: null });
        continue;
      }

      const nextDue = new Date(lastDone.getTime() + interval * 86400000);
      const daysUntil = Math.ceil((nextDue - now) / 86400000);

      if (daysUntil < 0) {
        overdue.push({ name: item.name, category: item.category || "general", priority: item.priority || "normal", lastCompleted: item.lastCompleted, nextDue: nextDue.toISOString().split("T")[0], daysOverdue: Math.abs(daysUntil), status: "overdue" });
      } else if (daysUntil <= lookaheadDays) {
        upcoming.push({ name: item.name, category: item.category || "general", priority: item.priority || "normal", nextDue: nextDue.toISOString().split("T")[0], daysUntil, status: "upcoming" });
      } else {
        current.push({ name: item.name, category: item.category || "general", nextDue: nextDue.toISOString().split("T")[0], daysUntil, status: "current" });
      }
    }

    overdue.sort((a, b) => (b.daysOverdue || 999) - (a.daysOverdue || 999));
    upcoming.sort((a, b) => a.daysUntil - b.daysUntil);

    const result = {
      checkedAt: now.toISOString(),
      totalItems: items.length,
      overdueCount: overdue.length,
      upcomingCount: upcoming.length,
      currentCount: current.length,
      overdue,
      upcoming,
    };

    artifact.data.maintenanceCheckResult = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * rotateChores
   * Rotate chore assignments among household members based on current assignments.
   * artifact.data.chores: [{ name, currentAssignee, frequency }]
   * artifact.data.members: [string] or [{ name }]
   */
  registerLensAction("household", "rotateChores", (ctx, artifact, params = {}) => {
    const rawChores = artifact.data.chores || params.chores || [];
    const chores = rawChores.map(c => typeof c === "string" ? { name: c } : (c || {}));
    const rawMembers = artifact.data.members || params.members || [];
    const members = rawMembers.map(m => typeof m === "string" ? m : m.name).filter(Boolean);

    if (members.length === 0) return { ok: true, result: { error: "No household members defined." } };
    if (chores.length === 0) return { ok: true, result: { error: "No chores defined." } };

    const newAssignments = [];
    for (const chore of chores) {
      const currentIdx = members.indexOf(chore.currentAssignee);
      const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % members.length;
      const assignee = members[nextIdx];
      newAssignments.push({
        chore: chore.name,
        previousAssignee: chore.currentAssignee || null,
        newAssignee: assignee,
        frequency: chore.frequency || "weekly",
      });
      chore.currentAssignee = assignee;
    }

    const choreCounts = {};
    for (const a of newAssignments) choreCounts[a.newAssignee] = (choreCounts[a.newAssignee] || 0) + 1;

    const result = {
      rotatedAt: new Date().toISOString(),
      totalChores: chores.length,
      members: members.length,
      assignments: newAssignments,
      choresPerMember: choreCounts,
    };

    artifact.data.lastChoreRotation = result;

    return { ok: true, result };
  });

  /**
   * weeklySummary
   * Summarize weekly household activity.
   * artifact.data.chores: [{ name, completedDate, currentAssignee }]
   * artifact.data.mealPlan: [{ day, meal, recipe }]
   * artifact.data.shoppingList: [{ item, purchased }]
   * artifact.data.upcomingTasks: [{ name, dueDate }]
   */
  registerLensAction("household", "weeklySummary", (ctx, artifact, params = {}) => {
  try {
    const d0 = artifact.data || {};
    const p = params || {};
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const weekAhead = new Date(now.getTime() + 7 * 86400000);

    // Chores completed this week
    const chores = d0.chores || p.chores || [];
    const completedChores = chores.filter(c => {
      const d = finiteDate(c.completedDate);
      if (!d) return false;
      return d >= weekAgo && d <= now;
    });

    // Meals planned
    const mealPlan = d0.mealPlan || p.mealPlan || d0.meals || p.meals || [];
    const mealsPlanned = mealPlan.length;

    // Shopping status
    const shoppingList = d0.shoppingList || p.shoppingList || d0.groceryList?.list || [];
    const totalShoppingItems = shoppingList.length;
    const purchasedItems = shoppingList.filter(i => i.purchased || i.done).length;

    // Upcoming tasks
    const upcoming = (d0.upcomingTasks || p.upcomingTasks || []).filter(t => {
      if (!t.dueDate) return true;
      const d = finiteDate(t.dueDate);
      if (!d) return true;
      return d >= now && d <= weekAhead;
    });

    // Maintenance items due
    const maintenanceItems = d0.maintenanceItems || p.maintenanceItems || [];
    const maintenanceDue = maintenanceItems.filter(m => {
      const last = finiteDate(m.lastCompleted);
      const interval = finiteInt(m.intervalDays, 0);
      if (!last || interval <= 0) return false;
      const nextDue = new Date(last.getTime() + interval * 86400000);
      return nextDue <= weekAhead;
    });

    const result = {
      generatedAt: now.toISOString(),
      weekOf: weekAgo.toISOString().split("T")[0],
      choresCompleted: completedChores.length,
      totalChores: chores.length,
      choreCompletionRate: chores.length > 0 ? Math.round((completedChores.length / chores.length) * 10000) / 100 : 0,
      mealsPlanned,
      shoppingProgress: { total: totalShoppingItems, purchased: purchasedItems, remaining: totalShoppingItems - purchasedItems },
      upcomingTasks: upcoming.map(t => ({ name: t.name, dueDate: t.dueDate || "unscheduled" })),
      maintenanceDueSoon: maintenanceDue.map(m => m.name),
    };

    artifact.data.weeklySummary = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * maintenanceDue
   * Flag household items or systems past their service date.
   * artifact.data.maintenanceItems: [{ name, lastServiceDate, intervalDays, category, notes }]
   * params.lookaheadDays (default 30) — also flag items due soon
   */
  registerLensAction("household", "maintenanceDue", (ctx, artifact, params) => {
  try {
    const items = artifact.data.maintenanceItems || params.maintenanceItems || [];
    const lookaheadDays = finiteNum(params.lookaheadDays, 30);
    const now = new Date();

    const overdue = [];
    const upcoming = [];
    const current = [];

    for (const item of items) {
      const lastService = finiteDate(item.lastServiceDate);
      const interval = finiteInt(item.intervalDays, 365);

      if (!lastService) {
        overdue.push({
          ...item,
          status: "never-serviced",
          daysOverdue: null,
          nextDueDate: null,
        });
        continue;
      }

      const nextDue = new Date(lastService.getTime() + interval * 86400000);
      const daysUntilDue = Math.ceil((nextDue - now) / 86400000);

      if (daysUntilDue < 0) {
        overdue.push({
          name: item.name,
          category: item.category || "general",
          lastServiceDate: item.lastServiceDate,
          intervalDays: interval,
          nextDueDate: nextDue.toISOString().split("T")[0],
          daysOverdue: Math.abs(daysUntilDue),
          status: "overdue",
          notes: item.notes || "",
        });
      } else if (daysUntilDue <= lookaheadDays) {
        upcoming.push({
          name: item.name,
          category: item.category || "general",
          lastServiceDate: item.lastServiceDate,
          intervalDays: interval,
          nextDueDate: nextDue.toISOString().split("T")[0],
          daysUntilDue,
          status: "upcoming",
          notes: item.notes || "",
        });
      } else {
        current.push({
          name: item.name,
          category: item.category || "general",
          nextDueDate: nextDue.toISOString().split("T")[0],
          daysUntilDue,
          status: "current",
        });
      }
    }

    // Sort overdue by most overdue first, upcoming by soonest first
    overdue.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));
    upcoming.sort((a, b) => a.daysUntilDue - b.daysUntilDue);

    const report = {
      checkedAt: new Date().toISOString(),
      lookaheadDays,
      totalItems: items.length,
      overdueCount: overdue.length,
      upcomingCount: upcoming.length,
      currentCount: current.length,
      overdue,
      upcoming,
    };

    artifact.data.maintenanceReport = report;

    return { ok: true, result: report };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * choreRotation
   * Rotate chore assignments among household members.
   * artifact.data.chores: [{ name, currentAssignee, frequency }]
   * artifact.data.members: [{ name, preferences }] or string[]
   * params.strategy — "round-robin" (default) or "random"
   */
  registerLensAction("household", "choreRotation", (ctx, artifact, params = {}) => {
  try {
    // Accept chores/members from artifact.data OR params (HouseholdActionPanel
    // sends them via the flat run-action input, which the dispatch maps to BOTH
    // artifact.data and params). Chores may be bare-string recipe names.
    const rawChores = artifact.data.chores || params.chores || [];
    const chores = rawChores.map((c) => (typeof c === "string" ? { name: c } : (c || {})));
    const rawMembers = artifact.data.members || params.members || [];
    const strategy = params.strategy || "round-robin";

    const members = rawMembers.map((m) => (typeof m === "string" ? m : m.name)).filter(Boolean);

    if (members.length === 0) {
      return { ok: true, result: { error: "No household members defined." } };
    }
    if (chores.length === 0) {
      return { ok: true, result: { error: "No chores defined." } };
    }

    const previousAssignments = chores.map((c) => ({
      chore: c.name,
      previousAssignee: c.currentAssignee || null,
    }));

    const newAssignments = [];

    if (strategy === "random") {
      // Shuffle members and assign chores round-robin from shuffled list
      const shuffled = members.slice().sort(() => Math.random() - 0.5);
      chores.forEach((chore, idx) => {
        const assignee = shuffled[idx % shuffled.length];
        newAssignments.push({
          chore: chore.name,
          frequency: chore.frequency || "weekly",
          assignee,
          previousAssignee: chore.currentAssignee || null,
        });
        chore.currentAssignee = assignee;
      });
    } else {
      // Round-robin: shift each chore's assignee to the next member in the list
      for (const chore of chores) {
        const currentIdx = members.indexOf(chore.currentAssignee);
        let nextIdx;
        if (currentIdx === -1) {
          // Assign to the member with the fewest current assignments
          const counts = {};
          members.forEach((m) => (counts[m] = 0));
          for (const a of newAssignments) counts[a.assignee] = (counts[a.assignee] || 0) + 1;
          nextIdx = members.indexOf(
            members.reduce((min, m) => ((counts[m] || 0) < (counts[min] || 0) ? m : min), members[0])
          );
        } else {
          nextIdx = (currentIdx + 1) % members.length;
        }

        const assignee = members[nextIdx];
        newAssignments.push({
          chore: chore.name,
          frequency: chore.frequency || "weekly",
          assignee,
          previousAssignee: chore.currentAssignee || null,
        });
        chore.currentAssignee = assignee;
      }
    }

    // Summary: how many chores per person
    const choreCounts = {};
    for (const a of newAssignments) {
      choreCounts[a.assignee] = (choreCounts[a.assignee] || 0) + 1;
    }

    const result = {
      rotatedAt: new Date().toISOString(),
      strategy,
      totalChores: chores.length,
      members: members.length,
      assignments: newAssignments,
      choresPerMember: choreCounts,
      previousAssignments,
    };

    artifact.data.lastRotation = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * off-product-lookup — Real Open Food Facts product lookup by UPC/EAN
   * barcode. Returns name, brand, ingredients, allergens, Nutri-Score
   * grade (A-E), Eco-Score, nutrition facts, image URL.
   * Free, no API key.
   *
   * params: { barcode: 8-14 digit UPC/EAN }
   */
  registerLensAction("household", "off-product-lookup", async (_ctx, _artifact, params = {}) => {
    const barcode = String(params.barcode || "").replace(/\D/g, "");
    if (!barcode) return { ok: false, error: "barcode required (UPC/EAN, 8-14 digits)" };
    if (barcode.length < 8 || barcode.length > 14) return { ok: false, error: `barcode must be 8-14 digits (got ${barcode.length})` };
    try {
      const r = await fetch(`${OPEN_FOOD_FACTS}/product/${barcode}.json`);
      if (!r.ok) throw new Error(`openfoodfacts ${r.status}`);
      const data = await r.json();
      if (data.status !== 1 || !data.product) {
        return { ok: false, error: `product not found: ${barcode}` };
      }
      const p = data.product;
      return {
        ok: true,
        result: {
          barcode,
          name: p.product_name,
          brand: p.brands,
          quantity: p.quantity,
          categories: p.categories,
          ingredients: p.ingredients_text,
          allergens: p.allergens_tags,
          additives: p.additives_tags,
          nutriScore: p.nutriscore_grade,  // a/b/c/d/e
          ecoScore: p.ecoscore_grade,
          novaGroup: p.nova_group,  // 1=unprocessed, 4=ultra-processed
          nutrition: {
            energyKcal100g: p.nutriments?.["energy-kcal_100g"],
            fat100g: p.nutriments?.fat_100g,
            saturatedFat100g: p.nutriments?.["saturated-fat_100g"],
            sugars100g: p.nutriments?.sugars_100g,
            salt100g: p.nutriments?.salt_100g,
            sodium100g: p.nutriments?.sodium_100g,
            proteins100g: p.nutriments?.proteins_100g,
            fiber100g: p.nutriments?.fiber_100g,
            carbohydrates100g: p.nutriments?.carbohydrates_100g,
          },
          servingSize: p.serving_size,
          imageUrl: p.image_url,
          imageNutritionUrl: p.image_nutrition_url,
          imageIngredientsUrl: p.image_ingredients_url,
          countries: p.countries_tags,
          source: "open-food-facts",
        },
      };
    } catch (e) {
      return { ok: false, error: `open food facts unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * off-product-search — Search Open Food Facts by name/brand.
   * params: { query: string, page?: 1+, pageSize?: 1-100 }
   */
  registerLensAction("household", "off-product-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query must be ≥ 2 characters" };
    const page = Math.max(1, Number(params.page) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(params.pageSize) || 20));
    try {
      const url = `${OPEN_FOOD_FACTS}/search?search_terms=${encodeURIComponent(query)}&page=${page}&page_size=${pageSize}&fields=code,product_name,brands,nutriscore_grade,image_url,quantity`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`openfoodfacts ${r.status}`);
      const data = await r.json();
      const products = (data.products || []).map((p) => ({
        barcode: p.code,
        name: p.product_name,
        brand: p.brands,
        nutriScore: p.nutriscore_grade,
        imageUrl: p.image_url,
        quantity: p.quantity,
      }));
      return {
        ok: true,
        result: {
          query, products, count: products.length,
          totalResults: data.count,
          page,
          source: "open-food-facts",
        },
      };
    } catch (e) {
      return { ok: false, error: `open food facts unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Tody / Sweepy-shape chore substrate (per-user, STATE-backed) ────
  // Condition-based cleaning: tasks "get dirty" over time relative to
  // their interval; a prioritised chore board surfaces the most urgent.

  function getHomeState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.householdLens) STATE.householdLens = {};
    const s = STATE.householdLens;
    if (!(s.rooms instanceof Map)) s.rooms = new Map();       // userId -> Array<room>
    if (!(s.tasks instanceof Map)) s.tasks = new Map();       // userId -> Array<task>
    if (!(s.choreLog instanceof Map)) s.choreLog = new Map(); // userId -> Array<logentry>
    if (!(s.vacation instanceof Map)) s.vacation = new Map(); // userId -> { pausedAt } | null
    return s;
  }
  function saveHome() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const hmId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const hmNow = () => new Date().toISOString();
  const hmActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const hmClean = (v, max = 120) => String(v == null ? "" : v).trim().slice(0, max);
  const hmList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };

  // Effective "now" — frozen at the vacation start if paused.
  function effectiveNow(s, userId) {
    const vac = s.vacation.get(userId);
    return vac && vac.pausedAt ? new Date(vac.pausedAt).getTime() : Date.now();
  }
  function taskCondition(task, nowMs) {
    const last = new Date(task.lastDoneAt || task.createdAt).getTime();
    const ratio = (nowMs - last) / (task.intervalDays * 86400000);
    return {
      ratio: Math.round(ratio * 100) / 100,
      state: ratio >= 1 ? "needs_attention" : ratio >= 0.5 ? "getting_dirty" : "clean",
      daysOverdue: ratio >= 1 ? Math.floor((nowMs - last) / 86400000 - task.intervalDays) : 0,
    };
  }

  registerLensAction("household", "room-create", (ctx, _a, params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hmClean(params.name, 80);
    if (!name) return { ok: false, error: "room name required" };
    const room = { id: hmId("rm"), name, createdAt: hmNow() };
    hmList(s.rooms, hmActor(ctx)).push(room);
    saveHome();
    return { ok: true, result: { room } };
  });

  registerLensAction("household", "room-list", (ctx, _a, _params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const tasks = hmList(s.tasks, userId);
    const rooms = hmList(s.rooms, userId).map((r) => ({
      ...r, taskCount: tasks.filter((t) => t.roomId === r.id).length,
    }));
    return { ok: true, result: { rooms, count: rooms.length } };
  });

  registerLensAction("household", "room-delete", (ctx, _a, params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const arr = hmList(s.rooms, userId);
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "room not found" };
    arr.splice(i, 1);
    s.tasks.set(userId, hmList(s.tasks, userId).filter((t) => t.roomId !== params.id));
    saveHome();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("household", "task-create", (ctx, _a, params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const room = hmList(s.rooms, userId).find((r) => r.id === params.roomId);
    if (!room) return { ok: false, error: "room not found" };
    const name = hmClean(params.name, 120);
    if (!name) return { ok: false, error: "task name required" };
    const task = {
      id: hmId("tk"), roomId: room.id, name,
      intervalDays: Math.max(1, Math.min(365, Math.round(Number(params.intervalDays) || 7))),
      effort: ["light", "medium", "heavy"].includes(params.effort) ? params.effort : "medium",
      assignee: hmClean(params.assignee, 60) || null,
      lastDoneAt: null,
      createdAt: hmNow(),
    };
    hmList(s.tasks, userId).push(task);
    saveHome();
    return { ok: true, result: { task } };
  });

  registerLensAction("household", "task-list", (ctx, _a, params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const nowMs = effectiveNow(s, userId);
    let tasks = hmList(s.tasks, userId);
    if (params.roomId) tasks = tasks.filter((t) => t.roomId === params.roomId);
    const out = tasks.map((t) => ({ ...t, condition: taskCondition(t, nowMs) }));
    return { ok: true, result: { tasks: out, count: out.length } };
  });

  registerLensAction("household", "task-update", (ctx, _a, params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const task = hmList(s.tasks, hmActor(ctx)).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    if (params.name != null) task.name = hmClean(params.name, 120) || task.name;
    if (params.intervalDays != null) task.intervalDays = Math.max(1, Math.min(365, Math.round(Number(params.intervalDays) || task.intervalDays)));
    if (params.assignee !== undefined) task.assignee = hmClean(params.assignee, 60) || null;
    if (params.effort != null && ["light", "medium", "heavy"].includes(params.effort)) task.effort = params.effort;
    saveHome();
    return { ok: true, result: { task } };
  });

  registerLensAction("household", "task-delete", (ctx, _a, params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hmList(s.tasks, hmActor(ctx));
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "task not found" };
    arr.splice(i, 1);
    saveHome();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("household", "task-done", (ctx, _a, params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const task = hmList(s.tasks, userId).find((t) => t.id === params.id);
    if (!task) return { ok: false, error: "task not found" };
    task.lastDoneAt = hmNow();
    const points = { light: 5, medium: 10, heavy: 20 }[task.effort] || 10;
    const by = hmClean(params.by, 60) || task.assignee || "me";
    hmList(s.choreLog, userId).push({ taskId: task.id, taskName: task.name, by, points, at: hmNow() });
    saveHome();
    return { ok: true, result: { task, pointsAwarded: points, by } };
  });

  // chore-board — the prioritised cross-room cleaning list (Tody's core).
  registerLensAction("household", "chore-board", (ctx, _a, _params = {}) => {
  try {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const nowMs = effectiveNow(s, userId);
    const rooms = new Map(hmList(s.rooms, userId).map((r) => [r.id, r.name]));
    const board = hmList(s.tasks, userId)
      .map((t) => ({
        id: t.id, name: t.name, room: rooms.get(t.roomId) || "?",
        assignee: t.assignee, effort: t.effort, condition: taskCondition(t, nowMs),
      }))
      .sort((a, b) => b.condition.ratio - a.condition.ratio);
    return {
      ok: true,
      result: {
        board,
        needsAttention: board.filter((t) => t.condition.state === "needs_attention").length,
        gettingDirty: board.filter((t) => t.condition.state === "getting_dirty").length,
        paused: !!s.vacation.get(userId),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("household", "assignee-leaderboard", (ctx, _a, _params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const log = hmList(s.choreLog, hmActor(ctx));
    const byPerson = {};
    for (const e of log) {
      if (!byPerson[e.by]) byPerson[e.by] = { person: e.by, points: 0, choresDone: 0 };
      byPerson[e.by].points += e.points;
      byPerson[e.by].choresDone += 1;
    }
    const leaderboard = Object.values(byPerson).sort((a, b) => b.points - a.points);
    return { ok: true, result: { leaderboard, totalChoresLogged: log.length } };
  });

  registerLensAction("household", "vacation-toggle", (ctx, _a, params = {}) => {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const on = params.on != null ? params.on === true : !s.vacation.get(userId);
    if (on) {
      s.vacation.set(userId, { pausedAt: hmNow() });
    } else {
      // Resume — shift every task's lastDoneAt forward by the paused span
      // so conditions resume from where they froze.
      const vac = s.vacation.get(userId);
      if (vac) {
        const span = Date.now() - new Date(vac.pausedAt).getTime();
        for (const t of hmList(s.tasks, userId)) {
          const base = new Date(t.lastDoneAt || t.createdAt).getTime() + span;
          if (t.lastDoneAt) t.lastDoneAt = new Date(base).toISOString();
          else t.createdAt = new Date(base).toISOString();
        }
      }
      s.vacation.delete(userId);
    }
    saveHome();
    return { ok: true, result: { paused: on } };
  });

  registerLensAction("household", "household-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getHomeState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const nowMs = effectiveNow(s, userId);
    const tasks = hmList(s.tasks, userId);
    const conditions = tasks.map((t) => taskCondition(t, nowMs));
    const cleanPct = tasks.length > 0
      ? Math.round((conditions.filter((c) => c.state === "clean").length / tasks.length) * 100) : 100;
    return {
      ok: true,
      result: {
        rooms: hmList(s.rooms, userId).length,
        tasks: tasks.length,
        cleanlinessPct: cleanPct,
        needsAttention: conditions.filter((c) => c.state === "needs_attention").length,
        choresLoggedAllTime: hmList(s.choreLog, userId).length,
        paused: !!s.vacation.get(userId),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Coordination layer (Cozi-shape): calendar, meal plan, rewards,
  //     notifications, shared lists, recurring templates, expense splits.
  //     All per-user, STATE-backed. No seed data — empty until the user
  //     creates real entries.

  function getCoState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.householdLens) STATE.householdLens = {};
    const s = STATE.householdLens;
    if (!(s.events instanceof Map)) s.events = new Map();        // userId -> Array<event>
    if (!(s.meals instanceof Map)) s.meals = new Map();          // userId -> Array<meal>
    if (!(s.notifications instanceof Map)) s.notifications = new Map(); // userId -> Array<notification>
    if (!(s.shoppingLists instanceof Map)) s.shoppingLists = new Map(); // userId -> Array<list>
    if (!(s.taskTemplates instanceof Map)) s.taskTemplates = new Map(); // userId -> Array<template>
    if (!(s.expenses instanceof Map)) s.expenses = new Map();    // userId -> Array<expense>
    return s;
  }

  // ── Shared family calendar ───────────────────────────────────────
  registerLensAction("household", "calendar-event-create", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = hmClean(params.title, 120);
    if (!title) return { ok: false, error: "event title required" };
    if (!params.date) return { ok: false, error: "event date required" };
    const ev = {
      id: hmId("ev"),
      title,
      date: hmClean(params.date, 10),
      time: hmClean(params.time, 5) || null,
      endDate: hmClean(params.endDate, 10) || null,
      assignee: hmClean(params.assignee, 60) || null,
      location: hmClean(params.location, 120) || null,
      color: hmClean(params.color, 9) || "#3B82F6",
      recurrence: ["none", "daily", "weekly", "biweekly", "monthly", "yearly"].includes(params.recurrence) ? params.recurrence : "none",
      reminderMinutes: Math.max(0, Math.min(20160, Math.round(Number(params.reminderMinutes) || 0))),
      notes: hmClean(params.notes, 500) || "",
      createdAt: hmNow(),
    };
    hmList(s.events, hmActor(ctx)).push(ev);
    saveHome();
    return { ok: true, result: { event: ev } };
  });

  registerLensAction("household", "calendar-event-list", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let events = hmList(s.events, hmActor(ctx)).slice();
    if (params.from) events = events.filter((e) => e.date >= params.from);
    if (params.to) events = events.filter((e) => e.date <= params.to);
    if (params.assignee) events = events.filter((e) => e.assignee === params.assignee);
    events.sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
    return { ok: true, result: { events, count: events.length } };
  });

  registerLensAction("household", "calendar-event-update", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ev = hmList(s.events, hmActor(ctx)).find((e) => e.id === params.id);
    if (!ev) return { ok: false, error: "event not found" };
    if (params.title != null) ev.title = hmClean(params.title, 120) || ev.title;
    if (params.date != null) ev.date = hmClean(params.date, 10) || ev.date;
    if (params.time !== undefined) ev.time = hmClean(params.time, 5) || null;
    if (params.endDate !== undefined) ev.endDate = hmClean(params.endDate, 10) || null;
    if (params.assignee !== undefined) ev.assignee = hmClean(params.assignee, 60) || null;
    if (params.location !== undefined) ev.location = hmClean(params.location, 120) || null;
    if (params.color != null) ev.color = hmClean(params.color, 9) || ev.color;
    if (params.recurrence != null && ["none", "daily", "weekly", "biweekly", "monthly", "yearly"].includes(params.recurrence)) ev.recurrence = params.recurrence;
    if (params.reminderMinutes != null) ev.reminderMinutes = Math.max(0, Math.min(20160, Math.round(Number(params.reminderMinutes) || 0)));
    if (params.notes !== undefined) ev.notes = hmClean(params.notes, 500) || "";
    saveHome();
    return { ok: true, result: { event: ev } };
  });

  registerLensAction("household", "calendar-event-delete", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hmList(s.events, hmActor(ctx));
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "event not found" };
    arr.splice(i, 1);
    saveHome();
    return { ok: true, result: { deleted: params.id } };
  });

  // calendar-upcoming-reminders — events within the reminder window.
  registerLensAction("household", "calendar-upcoming-reminders", (ctx, _a, _params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const now = Date.now();
    const due = [];
    for (const e of hmList(s.events, hmActor(ctx))) {
      if (!e.reminderMinutes) continue;
      const startMs = new Date(`${e.date}T${e.time || "00:00"}:00`).getTime();
      if (Number.isNaN(startMs)) continue;
      const fireAt = startMs - e.reminderMinutes * 60000;
      if (fireAt <= now && startMs >= now) {
        due.push({ eventId: e.id, title: e.title, date: e.date, time: e.time, assignee: e.assignee, minutesUntil: Math.round((startMs - now) / 60000) });
      }
    }
    due.sort((a, b) => a.minutesUntil - b.minutesUntil);
    return { ok: true, result: { reminders: due, count: due.length } };
  });

  // ── Meal-planning calendar ───────────────────────────────────────
  registerLensAction("household", "meal-plan-set", (ctx, _a, params = {}) => {
  try {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const date = hmClean(params.date, 10);
    if (!date) return { ok: false, error: "meal date required" };
    const slot = ["breakfast", "lunch", "dinner", "snack"].includes(params.slot) ? params.slot : null;
    if (!slot) return { ok: false, error: "slot must be breakfast/lunch/dinner/snack" };
    const recipe = hmClean(params.recipe, 120);
    if (!recipe) return { ok: false, error: "recipe required" };
    const ingredients = Array.isArray(params.ingredients)
      ? params.ingredients.map((x) => hmClean(x, 80)).filter(Boolean).slice(0, 50)
      : [];
    const userId = hmActor(ctx);
    const arr = hmList(s.meals, userId);
    let meal = arr.find((m) => m.date === date && m.slot === slot);
    if (meal) {
      meal.recipe = recipe;
      meal.ingredients = ingredients;
      meal.servings = Math.max(1, Math.min(50, Math.round(Number(params.servings) || meal.servings || 1)));
      meal.cook = hmClean(params.cook, 60) || meal.cook || null;
      meal.updatedAt = hmNow();
    } else {
      meal = {
        id: hmId("ml"), date, slot, recipe, ingredients,
        servings: Math.max(1, Math.min(50, Math.round(Number(params.servings) || 1))),
        cook: hmClean(params.cook, 60) || null,
        createdAt: hmNow(),
      };
      arr.push(meal);
    }
    saveHome();
    return { ok: true, result: { meal } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("household", "meal-plan-list", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let meals = hmList(s.meals, hmActor(ctx)).slice();
    if (params.from) meals = meals.filter((m) => m.date >= params.from);
    if (params.to) meals = meals.filter((m) => m.date <= params.to);
    const slotOrder = { breakfast: 0, lunch: 1, dinner: 2, snack: 3 };
    meals.sort((a, b) => a.date.localeCompare(b.date) || (slotOrder[a.slot] - slotOrder[b.slot]));
    return { ok: true, result: { meals, count: meals.length } };
  });

  registerLensAction("household", "meal-plan-delete", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hmList(s.meals, hmActor(ctx));
    const i = arr.findIndex((m) => m.id === params.id);
    if (i < 0) return { ok: false, error: "meal not found" };
    arr.splice(i, 1);
    saveHome();
    return { ok: true, result: { deleted: params.id } };
  });

  // meal-grocery-list — aggregate ingredients across planned meals into a
  // consolidated, deduped grocery list (ties meal calendar to shopping).
  registerLensAction("household", "meal-grocery-list", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let meals = hmList(s.meals, hmActor(ctx)).slice();
    if (params.from) meals = meals.filter((m) => m.date >= params.from);
    if (params.to) meals = meals.filter((m) => m.date <= params.to);
    const agg = {};
    for (const m of meals) {
      for (const ing of (m.ingredients || [])) {
        const key = ing.toLowerCase();
        if (!agg[key]) agg[key] = { name: ing, count: 0, meals: [] };
        agg[key].count += 1;
        const label = `${m.date} ${m.slot}`;
        if (!agg[key].meals.includes(label)) agg[key].meals.push(label);
      }
    }
    const list = Object.values(agg).sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, result: { list, uniqueItems: list.length, mealsCovered: meals.length } };
  });

  // ── Reward points / allowance ────────────────────────────────────
  // allowance-summary computes per-person points and dollar allowance
  // from the existing real chore-completion log.
  registerLensAction("household", "allowance-summary", (ctx, _a, params = {}) => {
  try {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const home = getHomeState();
    const log = home ? hmList(home.choreLog, hmActor(ctx)) : [];
    const rate = Math.max(0, Math.min(10, finiteNum(params.dollarsPerPoint, 0.05)));
    const byPerson = {};
    for (const e of log) {
      if (!byPerson[e.by]) byPerson[e.by] = { person: e.by, points: 0, choresDone: 0 };
      byPerson[e.by].points += e.points;
      byPerson[e.by].choresDone += 1;
    }
    const members = Object.values(byPerson).map((m) => ({
      ...m, allowance: Math.round(m.points * rate * 100) / 100,
    })).sort((a, b) => b.points - a.points);
    const totalPoints = members.reduce((sum, m) => sum + m.points, 0);
    const totalAllowance = Math.round(members.reduce((sum, m) => sum + m.allowance, 0) * 100) / 100;
    return { ok: true, result: { members, dollarsPerPoint: rate, totalPoints, totalAllowance } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Per-member notifications ─────────────────────────────────────
  registerLensAction("household", "notification-create", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const recipient = hmClean(params.recipient, 60);
    if (!recipient) return { ok: false, error: "recipient required" };
    const message = hmClean(params.message, 240);
    if (!message) return { ok: false, error: "message required" };
    const note = {
      id: hmId("nt"),
      recipient,
      message,
      kind: ["task", "event", "bill", "general"].includes(params.kind) ? params.kind : "general",
      refId: hmClean(params.refId, 60) || null,
      read: false,
      createdAt: hmNow(),
    };
    hmList(s.notifications, hmActor(ctx)).push(note);
    saveHome();
    return { ok: true, result: { notification: note } };
  });

  registerLensAction("household", "notification-list", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let notes = hmList(s.notifications, hmActor(ctx)).slice();
    if (params.recipient) notes = notes.filter((n) => n.recipient === params.recipient);
    if (params.unreadOnly === true) notes = notes.filter((n) => !n.read);
    notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { notifications: notes, count: notes.length, unread: notes.filter((n) => !n.read).length } };
  });

  registerLensAction("household", "notification-mark-read", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hmList(s.notifications, hmActor(ctx));
    if (params.all === true) {
      let n = 0;
      for (const note of arr) { if (!note.read) { note.read = true; n++; } }
      saveHome();
      return { ok: true, result: { markedRead: n } };
    }
    const note = arr.find((n) => n.id === params.id);
    if (!note) return { ok: false, error: "notification not found" };
    note.read = true;
    saveHome();
    return { ok: true, result: { notification: note } };
  });

  // ── Shared shopping lists (multi-member live editing) ─────────────
  registerLensAction("household", "shopping-list-create", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hmClean(params.name, 80);
    if (!name) return { ok: false, error: "list name required" };
    const list = { id: hmId("sl"), name, items: [], createdAt: hmNow() };
    hmList(s.shoppingLists, hmActor(ctx)).push(list);
    saveHome();
    return { ok: true, result: { list } };
  });

  registerLensAction("household", "shopping-list-list", (ctx, _a, _params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lists = hmList(s.shoppingLists, hmActor(ctx)).map((l) => ({
      ...l,
      itemCount: l.items.length,
      checkedCount: l.items.filter((it) => it.checked).length,
    }));
    return { ok: true, result: { lists, count: lists.length } };
  });

  registerLensAction("household", "shopping-list-delete", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hmList(s.shoppingLists, hmActor(ctx));
    const i = arr.findIndex((l) => l.id === params.id);
    if (i < 0) return { ok: false, error: "list not found" };
    arr.splice(i, 1);
    saveHome();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("household", "shopping-item-add", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = hmList(s.shoppingLists, hmActor(ctx)).find((l) => l.id === params.listId);
    if (!list) return { ok: false, error: "list not found" };
    const name = hmClean(params.name, 80);
    if (!name) return { ok: false, error: "item name required" };
    const item = {
      id: hmId("si"), name,
      quantity: hmClean(params.quantity, 30) || "",
      addedBy: hmClean(params.addedBy, 60) || null,
      checked: false,
      addedAt: hmNow(),
    };
    list.items.push(item);
    saveHome();
    return { ok: true, result: { item, list } };
  });

  registerLensAction("household", "shopping-item-toggle", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = hmList(s.shoppingLists, hmActor(ctx)).find((l) => l.id === params.listId);
    if (!list) return { ok: false, error: "list not found" };
    const item = list.items.find((it) => it.id === params.itemId);
    if (!item) return { ok: false, error: "item not found" };
    item.checked = params.checked != null ? params.checked === true : !item.checked;
    item.checkedBy = item.checked ? (hmClean(params.by, 60) || null) : null;
    saveHome();
    return { ok: true, result: { item } };
  });

  registerLensAction("household", "shopping-item-remove", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = hmList(s.shoppingLists, hmActor(ctx)).find((l) => l.id === params.listId);
    if (!list) return { ok: false, error: "list not found" };
    const i = list.items.findIndex((it) => it.id === params.itemId);
    if (i < 0) return { ok: false, error: "item not found" };
    list.items.splice(i, 1);
    saveHome();
    return { ok: true, result: { removed: params.itemId } };
  });

  // ── Recurring task templates ─────────────────────────────────────
  registerLensAction("household", "task-template-create", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = hmClean(params.name, 120);
    if (!name) return { ok: false, error: "template name required" };
    const tpl = {
      id: hmId("tt"),
      name,
      frequency: ["daily", "weekly", "biweekly", "monthly", "quarterly", "yearly"].includes(params.frequency) ? params.frequency : "weekly",
      room: hmClean(params.room, 80) || null,
      assignee: hmClean(params.assignee, 60) || null,
      effort: ["light", "medium", "heavy"].includes(params.effort) ? params.effort : "medium",
      notes: hmClean(params.notes, 300) || "",
      lastSpawnedAt: null,
      createdAt: hmNow(),
    };
    hmList(s.taskTemplates, hmActor(ctx)).push(tpl);
    saveHome();
    return { ok: true, result: { template: tpl } };
  });

  registerLensAction("household", "task-template-list", (ctx, _a, _params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const templates = hmList(s.taskTemplates, hmActor(ctx)).slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, result: { templates, count: templates.length } };
  });

  registerLensAction("household", "task-template-delete", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hmList(s.taskTemplates, hmActor(ctx));
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "template not found" };
    arr.splice(i, 1);
    saveHome();
    return { ok: true, result: { deleted: params.id } };
  });

  // task-template-spawn — materialise a recurring template into a real
  // chore task (creating its room if needed). Closes the loop with the
  // condition-based chore board.
  const FREQ_INTERVAL = { daily: 1, weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, yearly: 365 };
  registerLensAction("household", "task-template-spawn", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const home = getHomeState();
    if (!home) return { ok: false, error: "STATE unavailable" };
    const userId = hmActor(ctx);
    const tpl = hmList(s.taskTemplates, userId).find((t) => t.id === params.id);
    if (!tpl) return { ok: false, error: "template not found" };
    const roomName = tpl.room || "General";
    let room = hmList(home.rooms, userId).find((r) => r.name.toLowerCase() === roomName.toLowerCase());
    if (!room) {
      room = { id: hmId("rm"), name: roomName, createdAt: hmNow() };
      hmList(home.rooms, userId).push(room);
    }
    const task = {
      id: hmId("tk"), roomId: room.id, name: tpl.name,
      intervalDays: FREQ_INTERVAL[tpl.frequency] || 7,
      effort: tpl.effort,
      assignee: tpl.assignee,
      lastDoneAt: null,
      createdAt: hmNow(),
      fromTemplate: tpl.id,
    };
    hmList(home.tasks, userId).push(task);
    tpl.lastSpawnedAt = hmNow();
    saveHome();
    return { ok: true, result: { task, room } };
  });

  // ── Budget / shared-expense splitting ────────────────────────────
  registerLensAction("household", "expense-add", (ctx, _a, params = {}) => {
  try {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const description = hmClean(params.description, 120);
    if (!description) return { ok: false, error: "description required" };
    const amount = Math.round(finiteNum(params.amount, 0) * 100) / 100;
    if (!(amount > 0) || !Number.isFinite(amount)) return { ok: false, error: "amount must be a finite number > 0" };
    const paidBy = hmClean(params.paidBy, 60);
    if (!paidBy) return { ok: false, error: "paidBy required" };
    const splitAmong = Array.isArray(params.splitAmong)
      ? params.splitAmong.map((x) => hmClean(x, 60)).filter(Boolean)
      : [];
    if (splitAmong.length === 0) return { ok: false, error: "splitAmong must list at least one member" };
    const share = Math.round((amount / splitAmong.length) * 100) / 100;
    const expense = {
      id: hmId("ex"),
      description,
      amount,
      category: hmClean(params.category, 40) || "Other",
      paidBy,
      splitAmong,
      sharePerPerson: share,
      date: hmClean(params.date, 10) || hmNow().slice(0, 10),
      settled: false,
      createdAt: hmNow(),
    };
    hmList(s.expenses, hmActor(ctx)).push(expense);
    saveHome();
    return { ok: true, result: { expense } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("household", "expense-list", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let expenses = hmList(s.expenses, hmActor(ctx)).slice();
    if (params.from) expenses = expenses.filter((e) => e.date >= params.from);
    if (params.to) expenses = expenses.filter((e) => e.date <= params.to);
    if (params.unsettledOnly === true) expenses = expenses.filter((e) => !e.settled);
    expenses.sort((a, b) => b.date.localeCompare(a.date));
    const total = Math.round(expenses.reduce((sum, e) => sum + e.amount, 0) * 100) / 100;
    return { ok: true, result: { expenses, count: expenses.length, total } };
  });

  registerLensAction("household", "expense-settle", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const exp = hmList(s.expenses, hmActor(ctx)).find((e) => e.id === params.id);
    if (!exp) return { ok: false, error: "expense not found" };
    exp.settled = params.settled != null ? params.settled === true : !exp.settled;
    saveHome();
    return { ok: true, result: { expense: exp } };
  });

  registerLensAction("household", "expense-delete", (ctx, _a, params = {}) => {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = hmList(s.expenses, hmActor(ctx));
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "expense not found" };
    arr.splice(i, 1);
    saveHome();
    return { ok: true, result: { deleted: params.id } };
  });

  // expense-balances — net owed/owing per member across unsettled
  // shared expenses, plus minimal settle-up transfers.
  registerLensAction("household", "expense-balances", (ctx, _a, _params = {}) => {
  try {
    const s = getCoState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const expenses = hmList(s.expenses, hmActor(ctx)).filter((e) => !e.settled);
    const net = {};
    const touch = (p) => { if (!(p in net)) net[p] = 0; };
    for (const e of expenses) {
      touch(e.paidBy);
      net[e.paidBy] += e.amount;
      for (const m of e.splitAmong) {
        touch(m);
        net[m] -= e.sharePerPerson;
      }
    }
    const balances = Object.entries(net)
      .map(([person, amount]) => ({ person, net: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.net - a.net);
    // Greedy settle-up: largest creditor receives from largest debtor.
    const creditors = balances.filter((b) => b.net > 0.005).map((b) => ({ ...b }));
    const debtors = balances.filter((b) => b.net < -0.005).map((b) => ({ ...b, net: -b.net }));
    const transfers = [];
    let ci = 0, di = 0;
    while (ci < creditors.length && di < debtors.length) {
      const pay = Math.round(Math.min(creditors[ci].net, debtors[di].net) * 100) / 100;
      if (pay > 0) transfers.push({ from: debtors[di].person, to: creditors[ci].person, amount: pay });
      creditors[ci].net = Math.round((creditors[ci].net - pay) * 100) / 100;
      debtors[di].net = Math.round((debtors[di].net - pay) * 100) / 100;
      if (creditors[ci].net <= 0.005) ci++;
      if (debtors[di].net <= 0.005) di++;
    }
    return { ok: true, result: { balances, transfers, unsettledExpenses: expenses.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
};
