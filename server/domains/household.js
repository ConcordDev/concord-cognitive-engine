// server/domains/household.js
// Domain actions for household management: grocery lists, maintenance,
// chore rotation, plus real Open Food Facts product lookup
// (2,000,000+ food products, ingredients, allergens, nutrition,
// Nutri-Score grade). Free, no API key.

const OPEN_FOOD_FACTS = "https://world.openfoodfacts.org/api/v2";

export default function registerHouseholdActions(registerLensAction) {
  /**
   * generateGroceryList
   * Aggregate ingredients from a meal plan into a consolidated grocery list,
   * combining duplicates and subtracting what is already on hand.
   * artifact.data.mealPlan: [{ day, meal, recipe, ingredients: [{ name, quantity, unit }] }]
   * artifact.data.pantry: [{ name, quantity, unit }] (optional)
   */
  registerLensAction("household", "generateGroceryList", (ctx, artifact, params) => {
    const mealPlan = artifact.data.mealPlan || [];
    const pantry = artifact.data.pantry || [];
    const categorize = params.categorize !== false;

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
        aggregated[key].quantity += parseFloat(ing.quantity) || 0;
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
      pantryMap[key] = (pantryMap[key] || 0) + (parseFloat(item.quantity) || 0);
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
  });

  /**
   * maintenanceCheck
   * Check home maintenance items for overdue tasks based on schedule/intervals.
   * artifact.data.maintenanceItems: [{ name, lastCompleted, intervalDays, category, priority }]
   * params.lookaheadDays (default 14)
   */
  registerLensAction("household", "maintenanceCheck", (ctx, artifact, params) => {
    const items = artifact.data.maintenanceItems || [];
    const lookaheadDays = params.lookaheadDays != null ? params.lookaheadDays : 14;
    const now = new Date();

    const overdue = [];
    const upcoming = [];
    const current = [];

    for (const item of items) {
      const lastDone = item.lastCompleted ? new Date(item.lastCompleted) : null;
      const interval = parseInt(item.intervalDays, 10) || 30;

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
  });

  /**
   * rotateChores
   * Rotate chore assignments among household members based on current assignments.
   * artifact.data.chores: [{ name, currentAssignee, frequency }]
   * artifact.data.members: [string] or [{ name }]
   */
  registerLensAction("household", "rotateChores", (ctx, artifact, _params) => {
    const chores = artifact.data.chores || [];
    const rawMembers = artifact.data.members || [];
    const members = rawMembers.map(m => typeof m === "string" ? m : m.name);

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
  registerLensAction("household", "weeklySummary", (ctx, artifact, _params) => {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const weekAhead = new Date(now.getTime() + 7 * 86400000);

    // Chores completed this week
    const chores = artifact.data.chores || [];
    const completedChores = chores.filter(c => {
      if (!c.completedDate) return false;
      const d = new Date(c.completedDate);
      return d >= weekAgo && d <= now;
    });

    // Meals planned
    const mealPlan = artifact.data.mealPlan || [];
    const mealsPlanned = mealPlan.length;

    // Shopping status
    const shoppingList = artifact.data.shoppingList || artifact.data.groceryList?.list || [];
    const totalShoppingItems = shoppingList.length;
    const purchasedItems = shoppingList.filter(i => i.purchased || i.done).length;

    // Upcoming tasks
    const upcoming = (artifact.data.upcomingTasks || []).filter(t => {
      if (!t.dueDate) return true;
      const d = new Date(t.dueDate);
      return d >= now && d <= weekAhead;
    });

    // Maintenance items due
    const maintenanceItems = artifact.data.maintenanceItems || [];
    const maintenanceDue = maintenanceItems.filter(m => {
      if (!m.lastCompleted || !m.intervalDays) return false;
      const nextDue = new Date(new Date(m.lastCompleted).getTime() + parseInt(m.intervalDays, 10) * 86400000);
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
  });

  /**
   * maintenanceDue
   * Flag household items or systems past their service date.
   * artifact.data.maintenanceItems: [{ name, lastServiceDate, intervalDays, category, notes }]
   * params.lookaheadDays (default 30) — also flag items due soon
   */
  registerLensAction("household", "maintenanceDue", (ctx, artifact, params) => {
    const items = artifact.data.maintenanceItems || [];
    const lookaheadDays = params.lookaheadDays != null ? params.lookaheadDays : 30;
    const now = new Date();

    const overdue = [];
    const upcoming = [];
    const current = [];

    for (const item of items) {
      const lastService = item.lastServiceDate ? new Date(item.lastServiceDate) : null;
      const interval = parseInt(item.intervalDays, 10) || 365;

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
  });

  /**
   * choreRotation
   * Rotate chore assignments among household members.
   * artifact.data.chores: [{ name, currentAssignee, frequency }]
   * artifact.data.members: [{ name, preferences }] or string[]
   * params.strategy — "round-robin" (default) or "random"
   */
  registerLensAction("household", "choreRotation", (ctx, artifact, params) => {
    const chores = artifact.data.chores || [];
    const rawMembers = artifact.data.members || [];
    const strategy = params.strategy || "round-robin";

    const members = rawMembers.map((m) => (typeof m === "string" ? m : m.name));

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
  });
};
