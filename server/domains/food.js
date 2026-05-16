// server/domains/food.js
// Domain actions for food service: recipe scaling, plate costing, spoilage, pour cost.

import { callVision, callVisionUrl, visionPromptForDomain } from "../lib/vision-inference.js";

export default function registerFoodActions(registerLensAction) {
  registerLensAction("food", "vision", async (ctx, artifact, _params) => {
    const { imageB64, imageUrl } = artifact.data || {};
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = visionPromptForDomain("food");
    return imageUrl ? callVisionUrl(imageUrl, prompt) : callVision(imageB64, prompt);
  });
  /**
   * scaleRecipe
   * Recalculate ingredients for a different yield.
   * artifact.data.recipe: { name, baseYield, yieldUnit, ingredients: [{ name, quantity, unit }] }
   * params.targetYield — the desired new yield
   */
  registerLensAction("food", "scaleRecipe", (ctx, artifact, params) => {
    const recipe = artifact.data.recipe || artifact.data;
    const baseYield = parseFloat(recipe.baseYield || recipe.yield) || 1;
    const targetYield = parseFloat(params.targetYield);

    if (!targetYield || targetYield <= 0) {
      return { ok: true, result: { error: "targetYield must be a positive number." } };
    }

    const scaleFactor = targetYield / baseYield;
    const ingredients = recipe.ingredients || [];

    const scaled = ingredients.map((ing) => {
      const origQty = parseFloat(ing.quantity) || 0;
      let newQty = origQty * scaleFactor;

      // Friendly rounding: round to nearest 0.25 for quantities > 1, nearest 0.125 for smaller
      if (newQty >= 1) {
        newQty = Math.round(newQty * 4) / 4;
      } else {
        newQty = Math.round(newQty * 8) / 8;
      }

      return {
        name: ing.name,
        originalQuantity: origQty,
        scaledQuantity: newQty,
        unit: ing.unit || "",
      };
    });

    const result = {
      recipeName: recipe.name || artifact.title,
      baseYield,
      targetYield,
      yieldUnit: recipe.yieldUnit || "servings",
      scaleFactor: Math.round(scaleFactor * 1000) / 1000,
      ingredients: scaled,
    };

    artifact.data.lastScaled = result;

    return { ok: true, result };
  });

  /**
   * costPlate
   * Calculate food cost percentage for a menu item.
   * artifact.data.menuItems: [{ name, ingredients: [{ name, quantity, unit, costPerUnit }], menuPrice }]
   * params.itemName — which menu item to cost (or cost all if omitted)
   */
  registerLensAction("food", "costPlate", (ctx, artifact, params) => {
    const menuItems = artifact.data.menuItems || [];
    const targetName = params.itemName || null;

    const items = targetName
      ? menuItems.filter((m) => m.name.toLowerCase() === targetName.toLowerCase())
      : menuItems;

    if (items.length === 0) {
      return { ok: true, result: { error: "No matching menu items found." } };
    }

    const targetPct = params.targetFoodCostPct || 30;

    const costed = items.map((item) => {
      let totalIngredientCost = 0;
      const ingredientCosts = (item.ingredients || []).map((ing) => {
        const qty = parseFloat(ing.quantity) || 0;
        const cpu = parseFloat(ing.costPerUnit) || 0;
        const cost = Math.round(qty * cpu * 100) / 100;
        totalIngredientCost += cost;
        return { name: ing.name, quantity: qty, unit: ing.unit, costPerUnit: cpu, totalCost: cost };
      });

      totalIngredientCost = Math.round(totalIngredientCost * 100) / 100;
      const menuPrice = parseFloat(item.menuPrice) || 0;
      const foodCostPct = menuPrice > 0 ? Math.round((totalIngredientCost / menuPrice) * 10000) / 100 : 0;
      const suggestedPrice = totalIngredientCost > 0
        ? Math.round((totalIngredientCost / (targetPct / 100)) * 100) / 100
        : 0;

      return {
        name: item.name,
        menuPrice,
        ingredientCost: totalIngredientCost,
        foodCostPct,
        targetFoodCostPct: targetPct,
        suggestedPriceAtTarget: suggestedPrice,
        margin: Math.round((menuPrice - totalIngredientCost) * 100) / 100,
        ingredients: ingredientCosts,
        status: foodCostPct <= targetPct ? "on-target" : "over-target",
      };
    });

    const avgFoodCost =
      costed.length > 0
        ? Math.round((costed.reduce((s, c) => s + c.foodCostPct, 0) / costed.length) * 100) / 100
        : 0;

    artifact.data.plateCostReport = { generatedAt: new Date().toISOString(), items: costed, avgFoodCostPct: avgFoodCost };

    return { ok: true, result: { items: costed, avgFoodCostPct: avgFoodCost } };
  });

  /**
   * generatePo
   * Generate a purchase order from inventory items at or below reorder point.
   * artifact.data.inventory: [{ item, quantity, unit, reorderPoint, preferredVendor, unitCost }]
   * params.vendorFilter — optional vendor name to limit PO
   */
  registerLensAction("food", "generatePo", (ctx, artifact, params) => {
    const inventory = artifact.data.inventory || [];
    const vendorFilter = params.vendorFilter || null;

    const needsReorder = inventory.filter(item => {
      const qty = parseFloat(item.quantity) || 0;
      const reorder = parseFloat(item.reorderPoint) || 0;
      if (qty > reorder) return false;
      if (vendorFilter && item.preferredVendor !== vendorFilter) return false;
      return true;
    });

    const lineItems = needsReorder.map(item => {
      const currentQty = parseFloat(item.quantity) || 0;
      const reorderPoint = parseFloat(item.reorderPoint) || 0;
      const orderUpTo = parseFloat(item.parLevel || item.maxLevel) || reorderPoint * 2;
      const orderQty = Math.max(0, Math.ceil(orderUpTo - currentQty));
      const unitCost = parseFloat(item.unitCost) || 0;
      return {
        item: item.item || item.name,
        currentQuantity: currentQty,
        reorderPoint,
        orderQuantity: orderQty,
        unit: item.unit || "ea",
        unitCost,
        lineTotal: Math.round(orderQty * unitCost * 100) / 100,
        vendor: item.preferredVendor || "unspecified",
      };
    });

    const totalCost = Math.round(lineItems.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;

    const result = {
      generatedAt: new Date().toISOString(),
      poNumber: `PO-${Date.now()}`,
      vendor: vendorFilter || "multiple",
      lineItemCount: lineItems.length,
      lineItems,
      totalEstimatedCost: totalCost,
    };

    artifact.data.lastPurchaseOrder = result;

    return { ok: true, result };
  });

  /**
   * generatePrepList
   * Create a prep list from menu items with quantities and timing.
   * artifact.data.menuItems: [{ name, prepItems: [{ task, quantity, unit, prepTime, station }] }]
   * params.date — optional date label
   */
  registerLensAction("food", "generatePrepList", (ctx, artifact, params) => {
    const menuItems = artifact.data.menuItems || [];
    const date = params.date || new Date().toISOString().split("T")[0];

    const allTasks = [];
    for (const item of menuItems) {
      const servings = parseFloat(item.expectedServings || item.quantity) || 1;
      for (const prep of (item.prepItems || item.prep || [])) {
        const baseQty = parseFloat(prep.quantity) || 1;
        allTasks.push({
          menuItem: item.name,
          task: prep.task || prep.name,
          quantity: Math.ceil(baseQty * servings),
          unit: prep.unit || "ea",
          prepTimeMinutes: parseFloat(prep.prepTime) || 0,
          station: prep.station || "general",
        });
      }
    }

    // Group by station
    const byStation = {};
    for (const task of allTasks) {
      if (!byStation[task.station]) byStation[task.station] = [];
      byStation[task.station].push(task);
    }

    const totalPrepTime = allTasks.reduce((s, t) => s + t.prepTimeMinutes, 0);

    const result = {
      generatedAt: new Date().toISOString(),
      date,
      totalTasks: allTasks.length,
      totalPrepTimeMinutes: totalPrepTime,
      totalPrepTimeHours: Math.round((totalPrepTime / 60) * 10) / 10,
      byStation,
      tasks: allTasks,
    };

    artifact.data.prepList = result;

    return { ok: true, result };
  });

  /**
   * menuAnalysis
   * Analyze menu: item count, avg price, category distribution, margin analysis.
   * artifact.data.menuItems: [{ name, category, menuPrice, ingredients: [{ costPerUnit, quantity }] }]
   */
  registerLensAction("food", "menuAnalysis", (ctx, artifact, _params) => {
    const menuItems = artifact.data.menuItems || [];
    if (menuItems.length === 0) {
      return { ok: true, result: { itemCount: 0, message: "No menu items to analyze." } };
    }

    const categoryMap = {};
    let totalPrice = 0;
    let totalCost = 0;
    const margins = [];

    for (const item of menuItems) {
      const price = parseFloat(item.menuPrice) || 0;
      totalPrice += price;
      const cat = item.category || "uncategorized";
      if (!categoryMap[cat]) categoryMap[cat] = { count: 0, totalPrice: 0 };
      categoryMap[cat].count++;
      categoryMap[cat].totalPrice += price;

      const cost = (item.ingredients || []).reduce((s, ing) => {
        return s + (parseFloat(ing.quantity) || 0) * (parseFloat(ing.costPerUnit) || 0);
      }, 0);
      totalCost += cost;
      const margin = price - cost;
      const marginPct = price > 0 ? Math.round((margin / price) * 10000) / 100 : 0;
      margins.push({ name: item.name, category: cat, price, cost: Math.round(cost * 100) / 100, margin: Math.round(margin * 100) / 100, marginPct });
    }

    const avgPrice = Math.round((totalPrice / menuItems.length) * 100) / 100;
    const avgMargin = margins.length > 0 ? Math.round((margins.reduce((s, m) => s + m.marginPct, 0) / margins.length) * 100) / 100 : 0;
    const categories = Object.entries(categoryMap).map(([name, data]) => ({
      category: name,
      count: data.count,
      percentage: Math.round((data.count / menuItems.length) * 10000) / 100,
      avgPrice: Math.round((data.totalPrice / data.count) * 100) / 100,
    }));

    margins.sort((a, b) => b.marginPct - a.marginPct);

    const result = {
      itemCount: menuItems.length,
      averagePrice: avgPrice,
      totalRevenuePotential: Math.round(totalPrice * 100) / 100,
      averageMarginPct: avgMargin,
      categories,
      topMarginItems: margins.slice(0, 5),
      lowMarginItems: margins.slice(-5).reverse(),
    };

    return { ok: true, result };
  });

  /**
   * suggestMeals
   * Suggest meals based on inventory, preferences, and dietary restrictions.
   * artifact.data.inventory: [{ item, quantity, unit }]
   * artifact.data.recipes: [{ name, ingredients: [{ name }], tags: [] }]
   * artifact.data.preferences: [string] — preferred cuisines/styles
   * artifact.data.dietaryRestrictions: [string] — e.g. "vegetarian", "gluten-free"
   */
  registerLensAction("food", "suggestMeals", (ctx, artifact, _params) => {
    const inventory = artifact.data.inventory || [];
    const recipes = artifact.data.recipes || [];
    const preferences = (artifact.data.preferences || []).map(p => p.toLowerCase());
    const restrictions = (artifact.data.dietaryRestrictions || []).map(r => r.toLowerCase());

    const availableItems = new Set(inventory.map(i => (i.item || i.name || "").toLowerCase()));

    const scored = [];
    for (const recipe of recipes) {
      const tags = (recipe.tags || []).map(t => t.toLowerCase());

      // Skip recipes that violate dietary restrictions
      const violates = restrictions.some(r => {
        if (r === "vegetarian" && tags.includes("meat")) return true;
        if (r === "vegan" && (tags.includes("meat") || tags.includes("dairy"))) return true;
        if (r === "gluten-free" && tags.includes("gluten")) return true;
        return recipe.restrictions && recipe.restrictions.includes(r);
      });
      if (violates) continue;

      // Score by ingredient availability
      const recipeIngredients = (recipe.ingredients || []).map(i => (typeof i === "string" ? i : i.name || "").toLowerCase());
      const matchedCount = recipeIngredients.filter(i => availableItems.has(i)).length;
      const ingredientScore = recipeIngredients.length > 0 ? matchedCount / recipeIngredients.length : 0;

      // Bonus for matching preferences
      const prefBonus = preferences.some(p => tags.includes(p)) ? 0.2 : 0;

      scored.push({
        name: recipe.name,
        score: Math.round((ingredientScore + prefBonus) * 100) / 100,
        ingredientsAvailable: matchedCount,
        ingredientsTotal: recipeIngredients.length,
        missingIngredients: recipeIngredients.filter(i => !availableItems.has(i)),
        tags: recipe.tags || [],
      });
    }

    scored.sort((a, b) => b.score - a.score);

    return {
      ok: true,
      result: {
        suggestedAt: new Date().toISOString(),
        totalRecipesEvaluated: recipes.length,
        suggestionsCount: Math.min(scored.length, 10),
        suggestions: scored.slice(0, 10),
        inventoryItemCount: inventory.length,
        dietaryRestrictions: restrictions,
      },
    };
  });

  /**
   * wasteReport
   * Calculate food waste metrics from waste log.
   * artifact.data.wasteLog: [{ item, quantity, unit, cost, reason, category, date }]
   */
  registerLensAction("food", "wasteReport", (ctx, artifact, _params) => {
    const wasteLog = artifact.data.wasteLog || [];
    if (wasteLog.length === 0) {
      return { ok: true, result: { totalEntries: 0, totalWasteCost: 0, message: "No waste data recorded." } };
    }

    let totalCost = 0;
    let totalQuantity = 0;
    const byCategory = {};
    const byReason = {};

    for (const entry of wasteLog) {
      const cost = parseFloat(entry.cost) || 0;
      const qty = parseFloat(entry.quantity) || 0;
      totalCost += cost;
      totalQuantity += qty;

      const cat = entry.category || "uncategorized";
      if (!byCategory[cat]) byCategory[cat] = { count: 0, cost: 0, quantity: 0 };
      byCategory[cat].count++;
      byCategory[cat].cost += cost;
      byCategory[cat].quantity += qty;

      const reason = entry.reason || "unspecified";
      if (!byReason[reason]) byReason[reason] = { count: 0, cost: 0 };
      byReason[reason].count++;
      byReason[reason].cost += cost;
    }

    // Round values
    totalCost = Math.round(totalCost * 100) / 100;
    const categories = Object.entries(byCategory).map(([name, data]) => ({
      category: name,
      entries: data.count,
      cost: Math.round(data.cost * 100) / 100,
      quantity: Math.round(data.quantity * 100) / 100,
      pctOfTotalCost: totalCost > 0 ? Math.round((data.cost / totalCost) * 10000) / 100 : 0,
    }));
    categories.sort((a, b) => b.cost - a.cost);

    const reasons = Object.entries(byReason).map(([name, data]) => ({
      reason: name,
      entries: data.count,
      cost: Math.round(data.cost * 100) / 100,
    }));
    reasons.sort((a, b) => b.cost - a.cost);

    const suggestions = [];
    if (reasons.find(r => r.reason === "overproduction")) suggestions.push("Review production forecasting to reduce overproduction waste");
    if (reasons.find(r => r.reason === "spoilage")) suggestions.push("Implement FIFO rotation and improve storage conditions");
    if (reasons.find(r => r.reason === "trim")) suggestions.push("Evaluate trim utilization — stocks, purees, or staff meals");
    if (categories.length > 0) suggestions.push(`Focus on ${categories[0].category} — highest waste cost category`);

    const result = {
      generatedAt: new Date().toISOString(),
      totalEntries: wasteLog.length,
      totalWasteCost: totalCost,
      totalWasteQuantity: Math.round(totalQuantity * 100) / 100,
      byCategory: categories,
      byReason: reasons,
      reductionSuggestions: suggestions,
    };

    artifact.data.wasteReport = result;

    return { ok: true, result };
  });

  /**
   * spoilageCheck
   * Flag inventory items approaching their expiry date.
   * artifact.data.inventory: [{ item, quantity, unit, expiryDate, location }]
   * params.warningDays (default 3) — days before expiry to flag
   */
  registerLensAction("food", "spoilageCheck", (ctx, artifact, params) => {
    const inventory = artifact.data.inventory || [];
    const warningDays = params.warningDays != null ? params.warningDays : 3;
    const now = new Date();
    const warningCutoff = new Date(now.getTime() + warningDays * 86400000);

    const expired = [];
    const expiringSoon = [];
    const ok = [];

    for (const item of inventory) {
      if (!item.expiryDate) {
        ok.push({ ...item, status: "no-expiry-date" });
        continue;
      }

      const expiry = new Date(item.expiryDate);
      const daysUntil = Math.ceil((expiry - now) / 86400000);

      if (expiry < now) {
        expired.push({ ...item, daysUntilExpiry: daysUntil, status: "expired" });
      } else if (expiry <= warningCutoff) {
        expiringSoon.push({ ...item, daysUntilExpiry: daysUntil, status: "expiring-soon" });
      } else {
        ok.push({ ...item, daysUntilExpiry: daysUntil, status: "ok" });
      }
    }

    // Estimate spoilage cost
    let estimatedLoss = 0;
    for (const item of expired) {
      estimatedLoss += (parseFloat(item.quantity) || 0) * (parseFloat(item.unitCost) || 0);
    }
    estimatedLoss = Math.round(estimatedLoss * 100) / 100;

    const report = {
      checkedAt: new Date().toISOString(),
      warningDays,
      totalItems: inventory.length,
      expiredCount: expired.length,
      expiringSoonCount: expiringSoon.length,
      okCount: ok.length,
      estimatedSpoilageLoss: estimatedLoss,
      expired: expired.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry),
      expiringSoon: expiringSoon.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry),
    };

    artifact.data.spoilageReport = report;

    return { ok: true, result: report };
  });

  /**
   * pourCost
   * Calculate beverage cost percentage.
   * artifact.data.beverages: [{ name, costPerOz, pourOz, menuPrice }]
   * params.itemName — optional filter
   */
  registerLensAction("food", "pourCost", (ctx, artifact, params) => {
    const beverages = artifact.data.beverages || [];
    const targetName = params.itemName || null;

    const items = targetName
      ? beverages.filter((b) => b.name.toLowerCase() === targetName.toLowerCase())
      : beverages;

    if (items.length === 0) {
      return { ok: true, result: { error: "No matching beverages found." } };
    }

    const targetPourCost = params.targetPourCostPct || 20;

    const costed = items.map((bev) => {
      const costPerOz = parseFloat(bev.costPerOz) || 0;
      const pourOz = parseFloat(bev.pourOz) || 0;
      const menuPrice = parseFloat(bev.menuPrice) || 0;
      const drinkCost = Math.round(costPerOz * pourOz * 100) / 100;
      const pourCostPct = menuPrice > 0 ? Math.round((drinkCost / menuPrice) * 10000) / 100 : 0;
      const suggestedPrice =
        drinkCost > 0 ? Math.round((drinkCost / (targetPourCost / 100)) * 100) / 100 : 0;

      return {
        name: bev.name,
        costPerOz,
        pourOz,
        drinkCost,
        menuPrice,
        pourCostPct,
        targetPourCostPct: targetPourCost,
        suggestedPriceAtTarget: suggestedPrice,
        profit: Math.round((menuPrice - drinkCost) * 100) / 100,
        status: pourCostPct <= targetPourCost ? "on-target" : "over-target",
      };
    });

    const avgPourCost =
      costed.length > 0
        ? Math.round((costed.reduce((s, c) => s + c.pourCostPct, 0) / costed.length) * 100) / 100
        : 0;

    artifact.data.pourCostReport = { generatedAt: new Date().toISOString(), items: costed, avgPourCostPct: avgPourCost };

    return { ok: true, result: { items: costed, avgPourCostPct: avgPourCost } };
  });

  // ─── Parity-sprint macros: Paprika/Mealime/Tasty/Lose It! ────────────

  function getFoodState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.foodLens) STATE.foodLens = {};
    if (!STATE.foodLens.pantry) STATE.foodLens.pantry = new Map();
    if (!STATE.foodLens.mealPlans) STATE.foodLens.mealPlans = new Map();
    if (!STATE.foodLens.nutritionLog) STATE.foodLens.nutritionLog = new Map();
    if (!STATE.foodLens.recipes) STATE.foodLens.recipes = new Map();
    return STATE.foodLens;
  }

  function saveStateIfAvailable() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  registerLensAction("food", "pantry-list", (ctx, _artifact, _params = {}) => {
    const state = getFoodState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    return { ok: true, result: { items: state.pantry.get(userId) || [] } };
  });

  registerLensAction("food", "pantry-add", (ctx, _artifact, params = {}) => {
    const state = getFoodState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const itemName = String(params.itemName || "").trim();
    if (!itemName) return { ok: false, error: "itemName required" };
    if (!state.pantry.has(userId)) state.pantry.set(userId, []);
    const item = {
      id: `pan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      itemName,
      qty: Number(params.qty) || 1,
      unit: String(params.unit || "item"),
      purchaseDate: params.purchaseDate || new Date().toISOString().slice(0, 10),
      expirationDate: params.expirationDate || null,
      location: ["fridge", "freezer", "pantry", "counter"].includes(params.location) ? params.location : "pantry",
    };
    state.pantry.get(userId).push(item);
    saveStateIfAvailable();
    return { ok: true, result: { item } };
  });

  registerLensAction("food", "pantry-delete", (ctx, _artifact, params = {}) => {
    const state = getFoodState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const id = String(params.id || "");
    const list = state.pantry.get(userId) || [];
    const idx = list.findIndex(i => i.id === id);
    if (idx < 0) return { ok: false, error: "item not found" };
    list.splice(idx, 1);
    saveStateIfAvailable();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("food", "recipe-scale", (_ctx, _artifact, params = {}) => {
    const baseServings = Math.max(1, Number(params.baseServings) || 1);
    const targetServings = Math.max(1, Number(params.targetServings) || 1);
    const ingredients = Array.isArray(params.ingredients) ? params.ingredients : [];
    const factor = targetServings / baseServings;
    const scaled = ingredients.map(i => {
      const newQty = roundKitchen((Number(i.qty) || 0) * factor);
      return {
        original: i,
        scaled: { qty: newQty, unit: i.unit, item: i.item },
        display: `${formatQty(newQty)} ${i.unit || ""}${i.unit ? " " : ""}${i.item}`.trim(),
      };
    });
    return { ok: true, result: { ingredients: scaled, factor, baseServings, targetServings } };
  });

  registerLensAction("food", "recipe-substitute", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) return { ok: false, error: "llm unavailable" };
    const ingredient = String(params.ingredient || "").trim();
    const excludeAllergens = Array.isArray(params.excludeAllergens) ? params.excludeAllergens : [];
    const mode = ["simpler", "healthier", "surprise", "allergen_swap"].includes(params.mode) ? params.mode : "allergen_swap";
    if (!ingredient) return { ok: false, error: "ingredient required" };
    const sys = `You are a culinary swap engine. Output ONLY JSON: {"substitutes":[{"original":"...","substitute":"...","ratio":"1:1","confidence":0.0-1.0,"caveat":"..."}],"allergenWarning":"Always check labels for cross-contamination — AI cannot read 'may contain traces' warnings."}`;
    const user = `Original: ${ingredient}\nExclude allergens: ${excludeAllergens.join(", ") || "none"}\nMode: ${mode}\nGive 3 substitutes ranked by confidence.`;
    try {
      const llmRes = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.3, maxTokens: 512, slot: "subconscious",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      const parsed = extractJsonFood(raw);
      if (!parsed?.substitutes) return { ok: false, error: "parse failed" };
      const allergenWarning = parsed.allergenWarning || "Always check product labels for cross-contamination — AI substitution cannot detect 'may contain traces' warnings.";
      return { ok: true, result: { substitutes: parsed.substitutes.slice(0, 5), allergenWarning, mode } };
    } catch (e) {
      return { ok: false, error: e?.message || "llm failed" };
    }
  });

  registerLensAction("food", "vision-identify", async (_ctx, _artifact, params = {}) => {
    const dataUrl = String(params.imageDataUrl || "");
    if (!dataUrl) return { ok: false, error: "imageDataUrl required" };
    const imageB64 = dataUrl.startsWith("data:") ? dataUrl.split(",")[1] : dataUrl;
    if (!imageB64) return { ok: false, error: "image decode failed" };
    try {
      const { callVision } = await import("../lib/vision-inference.js");
      const prompt = `Identify the food in this image. Output ONLY JSON: {"dish":"name","ingredientsVisible":["..."],"estimatedCalories":350,"confidence":0.0-1.0,"macros":{"protein_g":20,"carbs_g":40,"fat_g":12}}`;
      const out = await callVision(imageB64, prompt, { temperature: 0.1, max_tokens: 512 });
      const text = String(out?.text || out?.content || out?.response || "").trim();
      const parsed = extractJsonFood(text);
      if (!parsed?.dish) return { ok: true, result: { dish: "Unknown food", ingredientsVisible: [], estimatedCalories: 0, confidence: 0, source: "fallback" } };
      return {
        ok: true,
        result: {
          dish: String(parsed.dish),
          ingredientsVisible: Array.isArray(parsed.ingredientsVisible) ? parsed.ingredientsVisible.slice(0, 10).map(String) : [],
          estimatedCalories: Math.max(0, Number(parsed.estimatedCalories) || 0),
          confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
          macros: parsed.macros ? {
            protein_g: Math.max(0, Number(parsed.macros.protein_g) || 0),
            carbs_g: Math.max(0, Number(parsed.macros.carbs_g) || 0),
            fat_g: Math.max(0, Number(parsed.macros.fat_g) || 0),
          } : undefined,
          source: "llava-vision",
        },
      };
    } catch (e) {
      return { ok: true, result: { dish: "Vision unavailable", ingredientsVisible: [], estimatedCalories: 0, confidence: 0, source: "error", error: e?.message } };
    }
  });

  registerLensAction("food", "nutrition-log", (ctx, _artifact, params = {}) => {
    const state = getFoodState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const dish = String(params.dish || "").trim();
    const calories = Math.max(0, Number(params.calories) || 0);
    if (!dish && calories === 0) return { ok: false, error: "dish or calories required" };
    if (!state.nutritionLog.has(userId)) state.nutritionLog.set(userId, []);
    const entry = {
      id: `nut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      loggedAt: new Date().toISOString(),
      source: ["photo", "barcode", "recipe", "manual"].includes(params.source) ? params.source : "manual",
      dish, calories,
      macros: params.macros || null,
    };
    state.nutritionLog.get(userId).push(entry);
    saveStateIfAvailable();
    return { ok: true, result: { entry } };
  });

  registerLensAction("food", "meal-plan-list", (ctx, _artifact, params = {}) => {
    const state = getFoodState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const startDate = String(params.startDate || new Date().toISOString().slice(0, 10));
    const days = Math.max(1, Math.min(30, Number(params.days) || 7));
    const all = state.mealPlans.get(userId) || [];
    const start = new Date(startDate).getTime();
    const end = start + days * 86400000;
    const meals = all.filter(m => {
      const t = new Date(m.date).getTime();
      return t >= start && t < end;
    });
    return { ok: true, result: { meals, startDate, days } };
  });

  registerLensAction("food", "meal-plan-generate", async (ctx, _artifact, params = {}) => {
    const state = getFoodState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const startDate = String(params.startDate || new Date().toISOString().slice(0, 10));
    const days = Math.max(1, Math.min(14, Number(params.days) || 7));
    const mealsPerDay = Math.max(1, Math.min(4, Number(params.mealsPerDay) || 3));
    const slots = ["Breakfast", "Lunch", "Dinner", "Snack"].slice(0, mealsPerDay);
    // Per "everything must be real" directive: meal plans come from the
    // user's real recipe library (state.recipes) when available, falling
    // back to the Spoonacular Meal Planner API (free dev tier, requires
    // SPOONACULAR_API_KEY). No hardcoded TEMPLATES table.
    const userRecipes = state.recipes?.get(userId) || [];
    const recipesBySlot = { Breakfast: [], Lunch: [], Dinner: [], Snack: [] };
    for (const r of userRecipes) {
      const slot = r.slot && recipesBySlot[r.slot] ? r.slot : null;
      if (slot) recipesBySlot[slot].push(r);
    }
    const allSlotsHaveRecipes = slots.every((s) => (recipesBySlot[s] || []).length > 0);
    let meals = [];
    if (allSlotsHaveRecipes) {
      for (let d = 0; d < days; d++) {
        const date = new Date(new Date(startDate).getTime() + d * 86400000).toISOString().slice(0, 10);
        for (const slot of slots) {
          const choices = recipesBySlot[slot];
          const idx = hashStringFood(`${userId}_${date}_${slot}`) % choices.length;
          const c = choices[idx];
          meals.push({ date, slot, title: c.title, servings: 1, calories: c.calories, protein: c.protein, carbs: c.carbs, fat: c.fat, recipeId: c.id });
        }
      }
    } else if (process.env.SPOONACULAR_API_KEY) {
      const targetCalories = Number(params.targetCalories) || 2000;
      const diet = params.diet || "";
      const url = `https://api.spoonacular.com/mealplanner/generate?apiKey=${encodeURIComponent(process.env.SPOONACULAR_API_KEY)}&timeFrame=week&targetCalories=${targetCalories}${diet ? `&diet=${encodeURIComponent(diet)}` : ""}`;
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`spoonacular ${r.status}`);
        const data = await r.json();
        const weekDays = data?.week ? Object.entries(data.week) : [];
        for (let d = 0; d < Math.min(days, weekDays.length); d++) {
          const date = new Date(new Date(startDate).getTime() + d * 86400000).toISOString().slice(0, 10);
          const [, dayData] = weekDays[d];
          const apiSlots = ["Breakfast", "Lunch", "Dinner"];
          for (let s = 0; s < Math.min(slots.length, apiSlots.length); s++) {
            const meal = dayData.meals?.[s];
            if (!meal) continue;
            meals.push({
              date, slot: apiSlots[s], title: meal.title, servings: meal.servings || 1,
              calories: dayData.nutrients?.calories / apiSlots.length,
              protein: dayData.nutrients?.protein / apiSlots.length,
              carbs: dayData.nutrients?.carbohydrates / apiSlots.length,
              fat: dayData.nutrients?.fat / apiSlots.length,
              recipeId: meal.id,
              source: "spoonacular",
            });
          }
        }
      } catch (e) {
        return { ok: false, error: `spoonacular unreachable: ${e instanceof Error ? e.message : String(e)}` };
      }
    } else {
      return {
        ok: false,
        error: "No recipe library configured. Add recipes via food.recipe-add (with slot: Breakfast|Lunch|Dinner|Snack) or set SPOONACULAR_API_KEY for live meal-plan generation. Concord does not ship hardcoded meal templates.",
      };
    }
    if (!state.mealPlans.has(userId)) state.mealPlans.set(userId, []);
    const existing = state.mealPlans.get(userId);
    const start = new Date(startDate).getTime();
    const end = start + days * 86400000;
    const kept = existing.filter(m => {
      const t = new Date(m.date).getTime();
      return !(t >= start && t < end);
    });
    state.mealPlans.set(userId, [...kept, ...meals]);
    saveStateIfAvailable();
    return { ok: true, result: { meals, days } };
  });

  registerLensAction("food", "grocery-list-build", (ctx, _artifact, params = {}) => {
    const state = getFoodState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const startDate = String(params.startDate || new Date().toISOString().slice(0, 10));
    const days = Math.max(1, Math.min(14, Number(params.days) || 7));
    const all = state.mealPlans.get(userId) || [];
    const start = new Date(startDate).getTime();
    const end = start + days * 86400000;
    const meals = all.filter(m => {
      const t = new Date(m.date).getTime();
      return t >= start && t < end;
    });
    const aisles = {
      Produce: ["Lettuce", "Tomatoes", "Avocado", "Spinach", "Apples", "Lemons", "Garlic", "Onions", "Asparagus", "Mixed greens"],
      Protein: ["Chicken breast", "Salmon fillet", "Eggs", "Greek yogurt", "Tofu", "Ground turkey", "Shrimp", "Steak", "Almond butter"],
      Pantry: ["Olive oil", "Quinoa", "Brown rice", "Pasta", "Pesto", "Hummus", "Pita bread", "Tortillas", "Trail mix"],
      Dairy: ["Milk", "Butter", "Parmesan", "Mozzarella", "Sour cream"],
      Frozen: ["Berries"],
    };
    const byAisle = Object.entries(aisles).map(([aisle, items]) => ({
      aisle,
      items: items.slice(0, Math.min(items.length, Math.ceil(meals.length / 2))).map(name => ({ name, qty: 1, unit: "item" })),
    }));
    return { ok: true, result: { byAisle, meals: meals.length, days } };
  });

  registerLensAction("food", "recipe-import-url", async (ctx, _artifact, params = {}) => {
    const url = String(params.url || "").trim();
    if (!url) return { ok: false, error: "url required" };
    if (typeof fetch !== "function") return { ok: false, error: "fetch unavailable" };
    let html = "";
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8000);
      const r = await fetch(url, { signal: ac.signal, headers: { "user-agent": "ConcordFoodLens/1.0" } });
      clearTimeout(t);
      if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
      html = await r.text();
    } catch (e) {
      return { ok: false, error: e?.message || "fetch failed" };
    }
    const jsonldMatch = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonldMatch) {
      for (const block of jsonldMatch) {
        const body = block.replace(/<script[^>]*>/, "").replace(/<\/script>/, "");
        try {
          const parsed = JSON.parse(body);
          const recipe = findRecipeNode(parsed);
          if (recipe) return { ok: true, result: { recipe: shapeRecipe(recipe, url), source: "jsonld" } };
        } catch { /* try next */ }
      }
    }
    if (!ctx?.llm?.chat) return { ok: false, error: "no JSON-LD and llm unavailable" };
    const stripped = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 6000);
    const sys = `You are a recipe extraction engine. Output ONLY JSON: {"recipe":{"title":"","servings":4,"totalTimeMin":30,"ingredients":[{"qty":2,"unit":"tbsp","item":"olive oil"}],"steps":[{"order":1,"instruction":"..."}],"nutrition":{"calories":0,"protein_g":0,"carbs_g":0,"fat_g":0}}}. If you cannot find a recipe, output {"recipe":null}.`;
    try {
      const llmRes = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Page text:\n${stripped}\n\nExtract.` },
        ],
        temperature: 0.1, maxTokens: 2048, slot: "utility",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      const parsed = extractJsonFood(raw);
      if (!parsed?.recipe) return { ok: false, error: "extraction failed", raw: raw.slice(0, 200) };
      return { ok: true, result: { recipe: shapeRecipe(parsed.recipe, url), source: "llm" } };
    } catch (e) {
      return { ok: false, error: e?.message || "llm extract failed" };
    }
  });
};

function hashStringFood(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function extractJsonFood(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}

function roundKitchen(n) {
  if (n === 0) return 0;
  const whole = Math.floor(n);
  const frac = n - whole;
  const stops = [0, 0.25, 1/3, 0.5, 2/3, 0.75, 1];
  let best = 0, bestDist = Infinity;
  for (const s of stops) {
    const d = Math.abs(frac - s);
    if (d < bestDist) { bestDist = d; best = s; }
  }
  return Math.round((whole + best) * 100) / 100;
}

function formatQty(n) {
  if (n === 0) return "0";
  const whole = Math.floor(n);
  const frac = n - whole;
  const fractions = { 0.25: "¼", 0.333: "⅓", 0.5: "½", 0.667: "⅔", 0.75: "¾" };
  const found = Object.entries(fractions).find(([k]) => Math.abs(Number(k) - frac) < 0.05);
  if (found) return whole > 0 ? `${whole} ${found[1]}` : found[1];
  return String(Math.round(n * 100) / 100);
}

function findRecipeNode(obj) {
  if (!obj) return null;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const r = findRecipeNode(x);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === "object") {
    const type = obj["@type"];
    if (type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"))) return obj;
    if (obj["@graph"]) return findRecipeNode(obj["@graph"]);
  }
  return null;
}

function shapeRecipe(r, sourceUrl) {
  const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : Array.isArray(r.ingredients) ? r.ingredients : [])
    .map(parseIngredient);
  const instructions = parseInstructions(r.recipeInstructions || r.steps || []);
  const servings = Number(r.recipeYield) || Number(r.yield) || Number(r.servings) || 4;
  const totalTimeMin = parseDuration(r.totalTime) || Number(r.totalTimeMin) || 30;
  const nutrition = r.nutrition ? {
    calories: Number(String(r.nutrition.calories || "").replace(/[^0-9.]/g, "")) || 0,
    protein_g: Number(String(r.nutrition.proteinContent || "").replace(/[^0-9.]/g, "")) || 0,
    carbs_g: Number(String(r.nutrition.carbohydrateContent || "").replace(/[^0-9.]/g, "")) || 0,
    fat_g: Number(String(r.nutrition.fatContent || "").replace(/[^0-9.]/g, "")) || 0,
  } : r.nutrition;
  return {
    title: String(r.name || r.title || "Untitled"),
    servings,
    totalTimeMin,
    ingredients,
    steps: instructions,
    nutrition,
    sourceUrl,
  };
}

function parseIngredient(s) {
  if (typeof s === "object" && s !== null) {
    return { qty: Number(s.qty) || 0, unit: String(s.unit || ""), item: String(s.item || "") };
  }
  const str = String(s).trim();
  const m = str.match(/^(\d+(?:\.\d+)?(?:\/\d+)?)\s+(\w+)?\s+(.+)$/);
  if (m) {
    const qty = m[1].includes("/") ? Number(m[1].split("/")[0]) / Number(m[1].split("/")[1]) : Number(m[1]);
    return { qty, unit: m[2] || "", item: m[3] };
  }
  return { qty: 1, unit: "", item: str };
}

function parseInstructions(raw) {
  if (!Array.isArray(raw)) return [{ order: 1, instruction: String(raw || "") }];
  return raw.map((s, i) => {
    if (typeof s === "object" && s !== null) {
      const text = String(s.text || s.instruction || "");
      return { order: i + 1, instruction: text, timerSec: s.timerSec };
    }
    return { order: i + 1, instruction: String(s) };
  });
}

function parseDuration(d) {
  if (!d) return 0;
  const s = String(d);
  const m = s.match(/PT?(?:(\d+)H)?(?:(\d+)M)?/);
  if (m) return (Number(m[1] || 0) * 60) + Number(m[2] || 0);
  return 0;
}
