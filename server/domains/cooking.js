// server/domains/cooking.js
//
// Pure-compute recipe helpers (scale, nutrition estimate, meal plan,
// substitution) plus real USDA FoodData Central integration for
// authoritative nutrient data across 600,000+ foods (SR Legacy +
// Branded Foods + FNDDS). Free; NASA_FDC_API_KEY env optional
// (falls back to DEMO_KEY rate-limited 1000/hr per IP).

const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";

export default function registerCookingActions(registerLensAction) {
  registerLensAction("cooking", "scaleRecipe", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const baseServings = parseFloat(data.servings || data.baseYield) || 4;
    const targetServings = parseFloat(data.targetServings || _params?.targetServings) || 8;
    const ingredients = data.ingredients || [];
    const factor = targetServings / baseServings;
    const scaled = ingredients.map(i => ({ name: i.name, original: `${i.quantity} ${i.unit || ""}`, scaled: `${Math.round(parseFloat(i.quantity || 0) * factor * 100) / 100} ${i.unit || ""}` }));
    return { ok: true, result: { recipe: data.name || artifact.title, baseServings, targetServings, scaleFactor: Math.round(factor * 100) / 100, ingredients: scaled } };
  });
  registerLensAction("cooking", "nutritionEstimate", (ctx, artifact, _params) => {
    const ingredients = artifact.data?.ingredients || [];
    // Rough per-100g estimates
    const db = { flour: { cal: 364, protein: 10, carbs: 76, fat: 1 }, sugar: { cal: 387, protein: 0, carbs: 100, fat: 0 }, butter: { cal: 717, protein: 1, carbs: 0, fat: 81 }, egg: { cal: 155, protein: 13, carbs: 1, fat: 11 }, milk: { cal: 42, protein: 3, carbs: 5, fat: 1 }, chicken: { cal: 239, protein: 27, carbs: 0, fat: 14 }, rice: { cal: 130, protein: 3, carbs: 28, fat: 0 }, oil: { cal: 884, protein: 0, carbs: 0, fat: 100 }, cheese: { cal: 402, protein: 25, carbs: 1, fat: 33 }, potato: { cal: 77, protein: 2, carbs: 17, fat: 0 } };
    let totalCal = 0, totalProtein = 0, totalCarbs = 0, totalFat = 0;
    for (const ing of ingredients) {
      const name = (ing.name || "").toLowerCase();
      const match = Object.keys(db).find(k => name.includes(k));
      if (match) {
        const grams = parseFloat(ing.grams || ing.quantity) || 100;
        const factor = grams / 100;
        totalCal += db[match].cal * factor; totalProtein += db[match].protein * factor;
        totalCarbs += db[match].carbs * factor; totalFat += db[match].fat * factor;
      }
    }
    const servings = parseFloat(artifact.data?.servings) || 1;
    return { ok: true, result: { totalCalories: Math.round(totalCal), perServing: Math.round(totalCal / servings), macros: { protein: `${Math.round(totalProtein)}g`, carbs: `${Math.round(totalCarbs)}g`, fat: `${Math.round(totalFat)}g` }, servings, note: "Estimates based on common ingredient averages" } };
  });
  registerLensAction("cooking", "mealPlan", (ctx, artifact, _params) => {
    const days = parseInt(artifact.data?.days) || 7;
    const preferences = artifact.data?.preferences || {};
    const budget = parseFloat(artifact.data?.budgetPerDay) || 15;
    const meals = ["breakfast", "lunch", "dinner"];
    const plan = Array.from({ length: days }, (_, i) => ({ day: i + 1, dayName: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i % 7], meals: meals.map(m => ({ meal: m, planned: false, estimatedCost: Math.round(budget / 3 * 100) / 100 })) }));
    return { ok: true, result: { days, weeklyBudget: Math.round(budget * days * 100) / 100, dailyBudget: budget, plan, dietaryNotes: preferences.dietary || "none specified", mealsToFill: days * 3 } };
  });
  registerLensAction("cooking", "substitution", (ctx, artifact, _params) => {
    const ingredient = (artifact.data?.ingredient || "").toLowerCase();
    const subs = { butter: [{ sub: "Coconut oil", ratio: "1:1" }, { sub: "Applesauce", ratio: "1:0.5", note: "For baking, reduces fat" }], egg: [{ sub: "Flax egg (1 tbsp ground flax + 3 tbsp water)", ratio: "1 egg" }, { sub: "Mashed banana", ratio: "1/4 cup per egg" }], milk: [{ sub: "Oat milk", ratio: "1:1" }, { sub: "Almond milk", ratio: "1:1" }], flour: [{ sub: "Almond flour", ratio: "1:1", note: "Gluten-free, denser" }, { sub: "Oat flour", ratio: "1:1" }], sugar: [{ sub: "Honey", ratio: "1:0.75", note: "Reduce liquid by 2 tbsp" }, { sub: "Maple syrup", ratio: "1:0.75" }], cream: [{ sub: "Coconut cream", ratio: "1:1" }, { sub: "Cashew cream", ratio: "1:1" }] };
    const match = Object.keys(subs).find(k => ingredient.includes(k));
    return { ok: true, result: { ingredient, substitutions: match ? subs[match] : [{ sub: "No common substitutions found", ratio: "N/A" }], found: !!match } };
  });

  /**
   * usda-search — Search USDA FoodData Central for ingredients by name.
   * Returns matches with FDC IDs the caller can pass to usda-nutrition.
   * Free; NASA_FDC_API_KEY env optional (DEMO_KEY fallback).
   *
   * params: { query: string, dataType?: "Branded"|"Survey (FNDDS)"|"Foundation"|"SR Legacy", pageSize?: 1-50 }
   */
  registerLensAction("cooking", "usda-search", async (_ctx, _artifact, params = {}) => {
    const query = String(params.query || "").trim();
    if (!query) return { ok: false, error: "query required" };
    if (query.length < 2) return { ok: false, error: "query must be ≥ 2 characters" };
    const apiKey = process.env.NASA_FDC_API_KEY || process.env.FDC_API_KEY || "DEMO_KEY";
    const pageSize = Math.max(1, Math.min(50, Number(params.pageSize) || 10));
    const dataType = params.dataType ? `&dataType=${encodeURIComponent(String(params.dataType))}` : "";
    try {
      const r = await fetch(`${FDC_BASE}/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}&pageSize=${pageSize}${dataType}`);
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "FDC rate limit exceeded — set FDC_API_KEY env (free at api.data.gov/signup)" };
        throw new Error(`fdc ${r.status}`);
      }
      const data = await r.json();
      const foods = (data.foods || []).map((f) => ({
        fdcId: f.fdcId,
        description: f.description,
        dataType: f.dataType,
        brandOwner: f.brandOwner,
        brandName: f.brandName,
        gtinUpc: f.gtinUpc,
        servingSize: f.servingSize,
        servingSizeUnit: f.servingSizeUnit,
        score: f.score,
        publishedDate: f.publishedDate,
      }));
      return {
        ok: true,
        result: {
          foods, count: foods.length,
          totalHits: data.totalHits,
          currentPage: data.currentPage,
          totalPages: data.totalPages,
          source: "usda-fooddata-central",
          usingDemoKey: apiKey === "DEMO_KEY",
        },
      };
    } catch (e) {
      return { ok: false, error: `fdc unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  /**
   * usda-nutrition — Full nutrient profile by FDC ID. Returns calories,
   * macros (protein/carbs/fat/fiber/sugar), vitamins, minerals, and
   * the full nutrient list per 100g (or per serving for branded foods).
   *
   * params: { fdcId: number }
   */
  registerLensAction("cooking", "usda-nutrition", async (_ctx, _artifact, params = {}) => {
    const fdcId = Number(params.fdcId);
    if (!Number.isFinite(fdcId) || fdcId <= 0) return { ok: false, error: "fdcId required (integer from usda-search)" };
    const apiKey = process.env.NASA_FDC_API_KEY || process.env.FDC_API_KEY || "DEMO_KEY";
    try {
      const r = await fetch(`${FDC_BASE}/food/${fdcId}?api_key=${encodeURIComponent(apiKey)}`);
      if (r.status === 404) return { ok: false, error: `FDC ID not found: ${fdcId}` };
      if (!r.ok) {
        if (r.status === 429) return { ok: false, error: "FDC rate limit exceeded — set FDC_API_KEY env" };
        throw new Error(`fdc ${r.status}`);
      }
      const food = await r.json();
      // Build a {nutrientName: { amount, unit }} dict
      const nutrients = {};
      for (const n of food.foodNutrients || []) {
        const name = n.nutrient?.name || n.nutrientName;
        if (!name) continue;
        nutrients[name] = {
          amount: n.amount ?? n.value ?? null,
          unit: n.nutrient?.unitName || n.unitName,
        };
      }
      // Pull out the headline values
      const pick = (k) => nutrients[k]?.amount ?? null;
      return {
        ok: true,
        result: {
          fdcId: food.fdcId,
          description: food.description,
          dataType: food.dataType,
          brandOwner: food.brandOwner,
          servingSize: food.servingSize,
          servingSizeUnit: food.servingSizeUnit,
          householdServingFullText: food.householdServingFullText,
          headline: {
            caloriesKcal: pick("Energy"),
            proteinG: pick("Protein"),
            totalFatG: pick("Total lipid (fat)"),
            saturatedFatG: pick("Fatty acids, total saturated"),
            carbsG: pick("Carbohydrate, by difference"),
            fiberG: pick("Fiber, total dietary"),
            sugarG: pick("Sugars, total including NLEA"),
            sodiumMg: pick("Sodium, Na"),
            calciumMg: pick("Calcium, Ca"),
            ironMg: pick("Iron, Fe"),
            potassiumMg: pick("Potassium, K"),
            vitaminCMg: pick("Vitamin C, total ascorbic acid"),
          },
          nutrients,
          source: "usda-fooddata-central",
          usingDemoKey: apiKey === "DEMO_KEY",
        },
      };
    } catch (e) {
      return { ok: false, error: `fdc unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ═══════════════════════════════════════════════════════════════
  //  Paprika + Samsung Food + Plan to Eat 2026 parity — recipes,
  //  collections, recipe scaling, meal-plan calendar, auto grocery
  //  list (consolidated + aisle-grouped), pantry, AI meal plan.
  // ═══════════════════════════════════════════════════════════════

  function getCookState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.cookingLens) {
      STATE.cookingLens = {
        recipes: new Map(),      // userId -> Array<Recipe>
        collections: new Map(),  // userId -> Array<Collection>
        mealPlan: new Map(),     // userId -> Map<"YYYY-MM-DD|slot", { recipeId, servings }>
        shopping: new Map(),     // userId -> Array<ShoppingItem>
        pantry: new Map(),       // userId -> Array<PantryItem>
        seq: new Map(),          // userId -> { rec, col }
      };
    }
    return STATE.cookingLens;
  }
  function saveCook() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) {} } }
  function aidCk(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uidCk(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function isoCk() { return new Date().toISOString(); }
  function listCk(map, k) { if (!map.has(k)) map.set(k, []); return map.get(k); }
  function mapCk(map, k) { if (!map.has(k)) map.set(k, new Map()); return map.get(k); }
  function ensureSeqCk(s, userId) {
    if (!s.seq.has(userId)) s.seq.set(userId, { rec: 1, col: 1 });
    const seq = s.seq.get(userId);
    for (const k of ['rec','col']) if (!Number.isFinite(seq[k])) seq[k] = 1;
    return seq;
  }

  const MEAL_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack'];
  // Aisle classifier — keyword → supermarket section. Used to group the grocery list.
  const AISLE_RULES = [
    ['produce',  /\b(apple|banana|lettuce|tomato|onion|garlic|carrot|potato|pepper|spinach|kale|cucumber|broccoli|lemon|lime|herb|basil|cilantro|parsley|avocado|mushroom|celery|ginger|berr|fruit|vegetable)\b/i],
    ['meat',     /\b(chicken|beef|pork|turkey|lamb|bacon|sausage|steak|ground meat|mince)\b/i],
    ['seafood',  /\b(salmon|tuna|shrimp|fish|cod|crab|scallop|prawn)\b/i],
    ['dairy',    /\b(milk|cheese|butter|yogurt|cream|egg|sour cream|mozzarella|parmesan)\b/i],
    ['bakery',   /\b(bread|bun|bagel|tortilla|roll|baguette|pita|croissant)\b/i],
    ['frozen',   /\b(frozen|ice cream|peas frozen)\b/i],
    ['pantry',   /\b(flour|sugar|salt|pepper|oil|vinegar|rice|pasta|noodle|bean|lentil|can|sauce|stock|broth|spice|baking|honey|syrup|oat|cereal|nut|seed)\b/i],
    ['beverages',/\b(water|juice|soda|coffee|tea|wine|beer)\b/i],
  ];
  function classifyAisle(name) {
    for (const [aisle, re] of AISLE_RULES) if (re.test(name)) return aisle;
    return 'other';
  }

  // ── Recipes ────────────────────────────────────────────────────

  registerLensAction("cooking", "recipes-list", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = String(params.q || "").trim().toLowerCase();
    const collectionId = params.collectionId ? String(params.collectionId) : null;
    let list = listCk(s.recipes, aidCk(ctx));
    if (q) list = list.filter(r => `${r.title} ${(r.tags || []).join(' ')}`.toLowerCase().includes(q));
    if (collectionId) {
      const col = listCk(s.collections, aidCk(ctx)).find(c => c.id === collectionId);
      const ids = new Set(col?.recipeIds || []);
      list = list.filter(r => ids.has(r.id));
    }
    return { ok: true, result: { recipes: list.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')) } };
  });

  registerLensAction("cooking", "recipes-get", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = listCk(s.recipes, aidCk(ctx)).find(x => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recipe not found" };
    return { ok: true, result: { recipe: r } };
  });

  function normalizeIngredients(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(ing => {
      if (typeof ing === 'string') return { name: ing.trim(), qty: null, unit: '' };
      return {
        name: String(ing.name || '').trim(),
        qty: Number.isFinite(Number(ing.qty)) ? Number(ing.qty) : null,
        unit: String(ing.unit || ''),
      };
    }).filter(i => i.name);
  }

  registerLensAction("cooking", "recipes-create", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const seq = ensureSeqCk(s, userId);
    const recipe = {
      id: uidCk('rec'),
      number: `R-${String(seq.rec).padStart(5, '0')}`,
      title,
      servings: Math.max(1, Number(params.servings) || 4),
      prepMin: Math.max(0, Number(params.prepMin) || 0),
      cookMin: Math.max(0, Number(params.cookMin) || 0),
      ingredients: normalizeIngredients(params.ingredients),
      steps: Array.isArray(params.steps) ? params.steps.map(String).filter(Boolean) : [],
      tags: Array.isArray(params.tags) ? params.tags.map(String) : [],
      cuisine: String(params.cuisine || ''),
      photoUrl: String(params.photoUrl || ''),
      sourceUrl: String(params.sourceUrl || ''),
      notes: String(params.notes || ''),
      createdAt: isoCk(),
    };
    seq.rec++;
    listCk(s.recipes, userId).push(recipe);
    saveCook();
    return { ok: true, result: { recipe } };
  });

  registerLensAction("cooking", "recipes-update", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = listCk(s.recipes, aidCk(ctx)).find(x => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recipe not found" };
    for (const k of ['title', 'cuisine', 'photoUrl', 'sourceUrl', 'notes']) if (typeof params[k] === 'string') r[k] = params[k];
    if (Number.isFinite(Number(params.servings))) r.servings = Math.max(1, Number(params.servings));
    if (Number.isFinite(Number(params.prepMin))) r.prepMin = Math.max(0, Number(params.prepMin));
    if (Number.isFinite(Number(params.cookMin))) r.cookMin = Math.max(0, Number(params.cookMin));
    if (params.ingredients !== undefined) r.ingredients = normalizeIngredients(params.ingredients);
    if (Array.isArray(params.steps)) r.steps = params.steps.map(String).filter(Boolean);
    if (Array.isArray(params.tags)) r.tags = params.tags.map(String);
    saveCook();
    return { ok: true, result: { recipe: r } };
  });

  registerLensAction("cooking", "recipes-delete", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const id = String(params.id || "");
    const list = listCk(s.recipes, userId);
    const i = list.findIndex(r => r.id === id);
    if (i < 0) return { ok: false, error: "recipe not found" };
    list.splice(i, 1);
    // remove from collections + meal plan
    for (const c of listCk(s.collections, userId)) c.recipeIds = (c.recipeIds || []).filter(rid => rid !== id);
    const plan = mapCk(s.mealPlan, userId);
    for (const [key, slot] of plan) if (slot.recipeId === id) plan.delete(key);
    saveCook();
    return { ok: true, result: { deleted: true } };
  });

  // Recipe scaling — returns scaled ingredient quantities for a target serving count.
  registerLensAction("cooking", "recipes-scale", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = listCk(s.recipes, aidCk(ctx)).find(x => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recipe not found" };
    const targetServings = Math.max(1, Number(params.targetServings) || r.servings);
    const factor = r.servings > 0 ? targetServings / r.servings : 1;
    const scaled = r.ingredients.map(ing => ({
      name: ing.name,
      unit: ing.unit,
      qty: ing.qty !== null ? Math.round(ing.qty * factor * 1000) / 1000 : null,
      originalQty: ing.qty,
    }));
    return { ok: true, result: { recipeId: r.id, title: r.title, baseServings: r.servings, targetServings, factor: Math.round(factor * 1000) / 1000, ingredients: scaled } };
  });

  // ── Collections (recipe books) ────────────────────────────────

  registerLensAction("cooking", "collections-list", (ctx, _a, _p = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const recipes = listCk(s.recipes, userId);
    const cols = listCk(s.collections, userId).map(c => ({
      ...c,
      recipeCount: (c.recipeIds || []).length,
      recipes: (c.recipeIds || []).map(rid => recipes.find(r => r.id === rid)).filter(Boolean),
    }));
    return { ok: true, result: { collections: cols } };
  });

  registerLensAction("cooking", "collections-create", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const seq = ensureSeqCk(s, userId);
    const col = { id: uidCk('col'), number: `CB-${String(seq.col).padStart(3, '0')}`, name, recipeIds: [], createdAt: isoCk() };
    seq.col++;
    listCk(s.collections, userId).push(col);
    saveCook();
    return { ok: true, result: { collection: col } };
  });

  registerLensAction("cooking", "collections-toggle-recipe", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const col = listCk(s.collections, userId).find(c => c.id === String(params.collectionId || ""));
    if (!col) return { ok: false, error: "collection not found" };
    const recipeId = String(params.recipeId || "");
    if (!listCk(s.recipes, userId).find(r => r.id === recipeId)) return { ok: false, error: "recipe not found" };
    col.recipeIds = col.recipeIds || [];
    const idx = col.recipeIds.indexOf(recipeId);
    if (idx >= 0) col.recipeIds.splice(idx, 1); else col.recipeIds.push(recipeId);
    saveCook();
    return { ok: true, result: { collection: col, inCollection: idx < 0 } };
  });

  registerLensAction("cooking", "collections-delete", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listCk(s.collections, aidCk(ctx));
    const i = list.findIndex(c => c.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "collection not found" };
    list.splice(i, 1);
    saveCook();
    return { ok: true, result: { deleted: true } };
  });

  // ── Meal plan calendar ────────────────────────────────────────

  registerLensAction("cooking", "meal-plan-get", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const start = String(params.start || new Date().toISOString().slice(0, 10));
    const end = String(params.end || new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
    const plan = mapCk(s.mealPlan, userId);
    const recipes = listCk(s.recipes, userId);
    const entries = [];
    for (const [key, slot] of plan) {
      const [date, mealSlot] = key.split('|');
      if (date < start || date > end) continue;
      const recipe = recipes.find(r => r.id === slot.recipeId);
      entries.push({ date, slot: mealSlot, recipeId: slot.recipeId, servings: slot.servings, recipe: recipe || null });
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || MEAL_SLOTS.indexOf(a.slot) - MEAL_SLOTS.indexOf(b.slot));
    return { ok: true, result: { start, end, entries } };
  });

  registerLensAction("cooking", "meal-plan-set", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const date = String(params.date || "");
    const slot = MEAL_SLOTS.includes(params.slot) ? params.slot : null;
    const recipeId = String(params.recipeId || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "date (YYYY-MM-DD) required" };
    if (!slot) return { ok: false, error: `slot must be one of: ${MEAL_SLOTS.join(', ')}` };
    const recipe = listCk(s.recipes, userId).find(r => r.id === recipeId);
    if (!recipe) return { ok: false, error: "recipe not found" };
    const servings = Math.max(1, Number(params.servings) || recipe.servings);
    mapCk(s.mealPlan, userId).set(`${date}|${slot}`, { recipeId, servings });
    saveCook();
    return { ok: true, result: { date, slot, recipeId, servings } };
  });

  registerLensAction("cooking", "meal-plan-clear", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const date = String(params.date || "");
    const slot = String(params.slot || "");
    const plan = mapCk(s.mealPlan, userId);
    if (date && slot) plan.delete(`${date}|${slot}`);
    else if (date) { for (const key of [...plan.keys()]) if (key.startsWith(date + '|')) plan.delete(key); }
    saveCook();
    return { ok: true, result: { cleared: true } };
  });

  // ── Shopping list (auto from meal plan, consolidated + aisle-grouped) ─

  registerLensAction("cooking", "shopping-list-generate", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const start = String(params.start || new Date().toISOString().slice(0, 10));
    const end = String(params.end || new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
    const subtractPantry = params.subtractPantry !== false;
    const plan = mapCk(s.mealPlan, userId);
    const recipes = listCk(s.recipes, userId);
    // Aggregate ingredients across all planned recipes, scaled by servings.
    const agg = new Map(); // key: name|unit -> { name, unit, qty }
    for (const [key, slot] of plan) {
      const [date] = key.split('|');
      if (date < start || date > end) continue;
      const recipe = recipes.find(r => r.id === slot.recipeId);
      if (!recipe) continue;
      const factor = recipe.servings > 0 ? slot.servings / recipe.servings : 1;
      for (const ing of recipe.ingredients) {
        const k = `${ing.name.toLowerCase()}|${ing.unit.toLowerCase()}`;
        const cur = agg.get(k) || { name: ing.name, unit: ing.unit, qty: 0, hasQty: false };
        if (ing.qty !== null) { cur.qty += ing.qty * factor; cur.hasQty = true; }
        agg.set(k, cur);
      }
    }
    // Subtract pantry items the user already has.
    const pantry = listCk(s.pantry, userId);
    const items = [];
    for (const [, ing] of agg) {
      let needed = true;
      if (subtractPantry) {
        const inPantry = pantry.find(p => p.name.toLowerCase() === ing.name.toLowerCase() && (p.qty === null || p.qty > 0));
        if (inPantry && inPantry.qty === null) needed = false; // "have it" with no count
      }
      if (!needed) continue;
      items.push({
        id: uidCk('shop'),
        name: ing.name,
        qty: ing.hasQty ? Math.round(ing.qty * 1000) / 1000 : null,
        unit: ing.unit,
        aisle: classifyAisle(ing.name),
        checked: false,
      });
    }
    items.sort((a, b) => a.aisle.localeCompare(b.aisle) || a.name.localeCompare(b.name));
    s.shopping.set(userId, items);
    saveCook();
    const byAisle = {};
    for (const it of items) (byAisle[it.aisle] = byAisle[it.aisle] || []).push(it);
    return { ok: true, result: { items, byAisle, itemCount: items.length, range: { start, end } } };
  });

  registerLensAction("cooking", "shopping-list-get", (ctx, _a, _p = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = listCk(s.shopping, aidCk(ctx));
    const byAisle = {};
    for (const it of items) (byAisle[it.aisle] = byAisle[it.aisle] || []).push(it);
    return { ok: true, result: { items, byAisle, itemCount: items.length, checkedCount: items.filter(i => i.checked).length } };
  });

  registerLensAction("cooking", "shopping-list-toggle", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const it = listCk(s.shopping, aidCk(ctx)).find(x => x.id === String(params.id || ""));
    if (!it) return { ok: false, error: "item not found" };
    it.checked = !it.checked;
    saveCook();
    return { ok: true, result: { item: it } };
  });

  registerLensAction("cooking", "shopping-list-add", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const item = {
      id: uidCk('shop'),
      name,
      qty: Number.isFinite(Number(params.qty)) ? Number(params.qty) : null,
      unit: String(params.unit || ''),
      aisle: classifyAisle(name),
      checked: false,
    };
    listCk(s.shopping, aidCk(ctx)).push(item);
    saveCook();
    return { ok: true, result: { item } };
  });

  registerLensAction("cooking", "shopping-list-clear", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    if (params.checkedOnly) {
      s.shopping.set(userId, listCk(s.shopping, userId).filter(i => !i.checked));
    } else {
      s.shopping.set(userId, []);
    }
    saveCook();
    return { ok: true, result: { cleared: true } };
  });

  // ── Pantry ────────────────────────────────────────────────────

  registerLensAction("cooking", "pantry-list", (ctx, _a, _p = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { pantry: listCk(s.pantry, aidCk(ctx)).slice().sort((a, b) => a.name.localeCompare(b.name)) } };
  });

  registerLensAction("cooking", "pantry-add", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const list = listCk(s.pantry, userId);
    const existing = list.find(p => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      if (Number.isFinite(Number(params.qty))) existing.qty = Number(params.qty);
      saveCook();
      return { ok: true, result: { item: existing, updated: true } };
    }
    const item = {
      id: uidCk('pan'),
      name,
      qty: Number.isFinite(Number(params.qty)) ? Number(params.qty) : null,
      unit: String(params.unit || ''),
      aisle: classifyAisle(name),
      addedAt: isoCk(),
    };
    list.push(item);
    saveCook();
    return { ok: true, result: { item } };
  });

  registerLensAction("cooking", "pantry-delete", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = listCk(s.pantry, aidCk(ctx));
    const i = list.findIndex(p => p.id === String(params.id || ""));
    if (i < 0) return { ok: false, error: "pantry item not found" };
    list.splice(i, 1);
    saveCook();
    return { ok: true, result: { deleted: true } };
  });

  // "What can I cook" — ranks recipes by how many ingredients the pantry covers.
  registerLensAction("cooking", "pantry-cook-suggestions", (ctx, _a, _p = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const pantryNames = new Set(listCk(s.pantry, userId).map(p => p.name.toLowerCase()));
    if (pantryNames.size === 0) return { ok: true, result: { suggestions: [], message: "Add pantry items to get cook suggestions." } };
    const recipes = listCk(s.recipes, userId);
    const ranked = recipes.map(r => {
      const total = r.ingredients.length || 1;
      const have = r.ingredients.filter(ing => {
        const n = ing.name.toLowerCase();
        for (const pn of pantryNames) if (n.includes(pn) || pn.includes(n)) return true;
        return false;
      });
      const missing = r.ingredients.filter(ing => !have.includes(ing));
      return {
        recipeId: r.id, title: r.title,
        haveCount: have.length, totalCount: total,
        coveragePct: Math.round((have.length / total) * 100),
        missing: missing.map(m => m.name),
      };
    }).filter(x => x.haveCount > 0).sort((a, b) => b.coveragePct - a.coveragePct);
    return { ok: true, result: { suggestions: ranked } };
  });

  // ── AI meal plan (Samsung Food / FoodiePrep parity) ──────────

  registerLensAction("cooking", "ai-meal-plan", async (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const recipes = listCk(s.recipes, userId);
    if (recipes.length === 0) return { ok: false, error: "add some recipes first — the planner fills the week from your recipe box" };
    const days = Math.max(1, Math.min(14, Number(params.days) || 7));
    const slots = Array.isArray(params.slots) && params.slots.every(x => MEAL_SLOTS.includes(x)) ? params.slots : ['dinner'];
    const startDate = String(params.start || new Date().toISOString().slice(0, 10));
    const tagFilter = String(params.preference || '').toLowerCase().trim();
    // Candidate pool — filter by preference tag if given.
    let pool = recipes;
    if (tagFilter) {
      const filtered = recipes.filter(r => `${r.title} ${(r.tags || []).join(' ')} ${r.cuisine}`.toLowerCase().includes(tagFilter));
      if (filtered.length > 0) pool = filtered;
    }
    // Round-robin assignment, minimising repeats.
    const plan = mapCk(s.mealPlan, userId);
    const assigned = [];
    let poolIdx = 0;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    for (let d = 0; d < days; d++) {
      const date = new Date(new Date(startDate).getTime() + d * 86_400_000).toISOString().slice(0, 10);
      for (const slot of slots) {
        const recipe = shuffled[poolIdx % shuffled.length];
        poolIdx++;
        plan.set(`${date}|${slot}`, { recipeId: recipe.id, servings: recipe.servings });
        assigned.push({ date, slot, recipeId: recipe.id, title: recipe.title });
      }
    }
    saveCook();
    return { ok: true, result: { assigned, days, slots, poolSize: pool.length, preference: tagFilter || null, source: 'deterministic' } };
  });

  // ── Dashboard summary ────────────────────────────────────────

  registerLensAction("cooking", "cooking-dashboard-summary", (ctx, _a, _p = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const recipes = listCk(s.recipes, userId);
    const plan = mapCk(s.mealPlan, userId);
    const shopping = listCk(s.shopping, userId);
    const today = new Date().toISOString().slice(0, 10);
    const weekEnd = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    let plannedThisWeek = 0;
    for (const [key] of plan) { const [date] = key.split('|'); if (date >= today && date <= weekEnd) plannedThisWeek++; }
    return {
      ok: true,
      result: {
        recipeCount: recipes.length,
        collectionCount: listCk(s.collections, userId).length,
        plannedMealsThisWeek: plannedThisWeek,
        shoppingItems: shopping.length,
        shoppingChecked: shopping.filter(i => i.checked).length,
        pantryItems: listCk(s.pantry, userId).length,
      },
    };
  });

  // feed — ingest real recipes from TheMealDB as visible DTUs.
  // Free public API (public test key "1"), no signup.
  registerLensAction("cooking", "feed", async (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 10)));
    const letter = "abcdefghijklmnoprst"[new Date().getHours() % 19];
    try {
      const r = await fetch(`https://www.themealdb.com/api/json/v1/1/search.php?f=${letter}`);
      if (!r.ok) return { ok: false, error: `themealdb ${r.status}` };
      const data = await r.json();
      const meals = (Array.isArray(data?.meals) ? data.meals : []).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const m of meals) {
        const id = `meal_${m.idMeal}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const title = `Recipe: ${m.strMeal}`;
        const ings = [];
        for (let i = 1; i <= 20; i++) {
          const ing = m[`strIngredient${i}`];
          if (ing && ing.trim()) ings.push(`${m[`strMeasure${i}`] || ""} ${ing}`.trim());
        }
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nCuisine: ${m.strArea || "?"} · Category: ${m.strCategory || "?"}\n\nIngredients:\n${ings.map((x) => `- ${x}`).join("\n")}\n\n${m.strInstructions || ""}`.slice(0, 4000),
          tags: ["cooking", "feed", "recipe", "themealdb"],
          source: "themealdb-feed",
          meta: { mealId: m.idMeal, name: m.strMeal, area: m.strArea, category: m.strCategory },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveCook();
      return { ok: true, result: { ingested, skipped, source: "themealdb-recipes", dtuIds } };
    } catch (e) {
      return { ok: false, error: `themealdb unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });
}
