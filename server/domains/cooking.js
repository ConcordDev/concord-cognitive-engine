// server/domains/cooking.js
//
// Pure-compute recipe helpers (scale, nutrition estimate, meal plan,
// substitution) plus real USDA FoodData Central integration for
// authoritative nutrient data across 600,000+ foods (SR Legacy +
// Branded Foods + FNDDS). Free; NASA_FDC_API_KEY env optional
// (falls back to DEMO_KEY rate-limited 1000/hr per IP).

import { fetchJsonWithTimeout } from "../lib/external-fetch.js";
import { callVision, callVisionUrl } from "../lib/vision-inference.js";

const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";

export default function registerCookingActions(registerLensAction) {
  // The CookingActionPanel client wraps its payload as { artifact: { data } }
  // and posts it as the lens-run body (no `input` key), so the live dispatch
  // sets virtualArtifact.data = { artifact: { data } } — one extra layer.
  // Unwrap that here so the pure-compute calculators see the real recipe data
  // whether the caller sent it flat (input.data) or double-wrapped.
  function recipeData(artifact, params) {
    const d = artifact?.data;
    if (d && typeof d === "object") {
      if (d.artifact && typeof d.artifact === "object" && d.artifact.data && typeof d.artifact.data === "object") {
        return d.artifact.data;
      }
      // Flat-but-empty artifact.data: fall back to the 3rd-arg params if it
      // carries the recipe (e.g. { ingredients } / { servings } at top level).
      if (!d.ingredients && !d.servings && !d.name && !d.ingredient && params && typeof params === "object") {
        if (params.artifact && typeof params.artifact === "object" && params.artifact.data && typeof params.artifact.data === "object") {
          return params.artifact.data;
        }
        if (params.ingredients || params.servings || params.name || params.ingredient) return params;
      }
      return d;
    }
    if (params && typeof params === "object") {
      if (params.artifact && typeof params.artifact === "object" && params.artifact.data && typeof params.artifact.data === "object") {
        return params.artifact.data;
      }
      return params;
    }
    return {};
  }

  registerLensAction("cooking", "scaleRecipe", (ctx, artifact, _params) => {
    const data = recipeData(artifact, _params) || {};
    const baseServings = parseFloat(data.servings || data.baseYield) || 4;
    const targetServings = parseFloat(data.targetServings || _params?.targetServings) || 8;
    const ingredients = data.ingredients || [];
    const factor = targetServings / baseServings;
    const scaled = ingredients.map(i => ({ name: i.name, original: `${i.quantity} ${i.unit || ""}`, scaled: `${Math.round(parseFloat(i.quantity || 0) * factor * 100) / 100} ${i.unit || ""}` }));
    return { ok: true, result: { recipe: data.name || artifact?.title, baseServings, targetServings, scaleFactor: Math.round(factor * 100) / 100, ingredients: scaled } };
  });
  registerLensAction("cooking", "nutritionEstimate", (ctx, artifact, _params) => {
    const ndata = recipeData(artifact, _params) || {};
    const ingredients = ndata.ingredients || [];
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
    const servings = parseFloat(ndata.servings) || 1;
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
    const sdata = recipeData(artifact, _params) || {};
    const ingredient = (sdata.ingredient || "").toLowerCase();
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
  function saveCook() { if (typeof globalThis._concordSaveStateDebounced === "function") { try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best-effort: ignore */ } } }
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
  try {
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
      ratings: [],
      madeLog: [],
      nutrition: null,
      createdAt: isoCk(),
    };
    seq.rec++;
    listCk(s.recipes, userId).push(recipe);
    saveCook();
    return { ok: true, result: { recipe } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
    const reqTarget = Number(params.targetServings);
    // Fail-CLOSED on poisoned numerics: a non-finite or absurd targetServings
    // must not mint Infinity/NaN quantities. Clamp to a sane [1, 10000] bound.
    const targetServings = Number.isFinite(reqTarget) && reqTarget > 0
      ? Math.min(10000, reqTarget)
      : r.servings;
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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

  // ═══════════════════════════════════════════════════════════════
  //  Paprika 3 + Samsung Food gap-closing backlog — URL import,
  //  cook-mode timers, photo OCR, made-it log + ratings, USDA-linked
  //  per-recipe nutrition, multi-store shopping, printable export.
  // ═══════════════════════════════════════════════════════════════

  // ── ISO-8601 duration → minutes (schema.org cookTime/prepTime) ──
  function isoDurationToMinutes(d) {
    if (!d || typeof d !== "string") return 0;
    const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(d.trim());
    if (!m) return 0;
    return (Number(m[1] || 0) * 1440) + (Number(m[2] || 0) * 60) + Number(m[3] || 0);
  }

  // Split a free-text ingredient line into { qty, unit, name }.
  const UNIT_WORDS = ["cups", "cup", "tablespoons", "tablespoon", "tbsp", "teaspoons", "teaspoon", "tsp", "grams", "gram", "g", "kg", "kilograms", "ml", "milliliters", "liters", "litre", "l", "ounces", "ounce", "oz", "pounds", "pound", "lb", "lbs", "cloves", "clove", "pinch", "pinches", "cans", "can", "slices", "slice", "pieces", "piece", "sprigs", "sprig", "sticks", "stick", "bunch", "bunches", "package", "packages", "pkg"];
  function parseIngredientLine(line) {
    const raw = String(line || "").trim();
    if (!raw) return null;
    const fracMap = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 0.333, "⅔": 0.667, "⅛": 0.125 };
    let work = raw;
    for (const [g, v] of Object.entries(fracMap)) work = work.replace(g, ` ${v} `);
    const qtyMatch = /^([0-9]+(?:\.[0-9]+)?(?:\s*\/\s*[0-9]+)?(?:\s+[0-9]+\s*\/\s*[0-9]+)?)\s*(.*)$/.exec(work.trim());
    let qty = null, rest = work.trim();
    if (qtyMatch) {
      const parts = qtyMatch[1].trim().split(/\s+/);
      let total = 0;
      for (const p of parts) {
        if (p.includes("/")) { const [a, b] = p.split("/").map(Number); if (b) total += a / b; }
        else total += Number(p) || 0;
      }
      if (total > 0) { qty = Math.round(total * 1000) / 1000; rest = qtyMatch[2].trim(); }
    }
    let unit = "";
    const restWords = rest.split(/\s+/);
    if (restWords.length > 1) {
      const candidate = restWords[0].toLowerCase().replace(/[.,]/g, "");
      if (UNIT_WORDS.includes(candidate)) { unit = restWords[0].replace(/[.,]/g, ""); rest = restWords.slice(1).join(" "); }
    }
    return { name: rest.trim() || raw, qty, unit };
  }

  // ── 1. Recipe import from URL (schema.org/Recipe JSON-LD) ──────
  function findRecipeNode(node) {
    if (!node || typeof node !== "object") return null;
    const types = [].concat(node["@type"] || []);
    if (types.some((t) => String(t).toLowerCase() === "recipe")) return node;
    if (Array.isArray(node["@graph"])) {
      for (const g of node["@graph"]) { const f = findRecipeNode(g); if (f) return f; }
    }
    if (Array.isArray(node)) {
      for (const g of node) { const f = findRecipeNode(g); if (f) return f; }
    }
    return null;
  }

  registerLensAction("cooking", "import-from-url", async (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const url = String(params.url || "").trim();
    if (!/^https?:\/\/.+/i.test(url)) return { ok: false, error: "valid http(s) url required" };
    let html;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 ConcordCooking/1.0" }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) return { ok: false, error: `fetch failed: HTTP ${r.status}` };
      html = await r.text();
    } catch (e) {
      return { ok: false, error: `page unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    // Extract every <script type="application/ld+json"> block.
    let recipeNode = null;
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      try {
        const json = JSON.parse(m[1].trim());
        const found = findRecipeNode(json);
        if (found) { recipeNode = found; break; }
      } catch { /* skip malformed block */ }
    }
    if (!recipeNode) return { ok: false, error: "no schema.org/Recipe JSON-LD found on that page" };
    // Map JSON-LD → recipe shape.
    const ingLines = []
      .concat(recipeNode.recipeIngredient || recipeNode.ingredients || [])
      .map((x) => String(x));
    const steps = [];
    const instr = recipeNode.recipeInstructions;
    if (typeof instr === "string") {
      for (const part of instr.split(/\n+/)) if (part.trim()) steps.push(part.trim());
    } else if (Array.isArray(instr)) {
      for (const it of instr) {
        if (typeof it === "string") steps.push(it.trim());
        else if (it && typeof it === "object") {
          if (Array.isArray(it.itemListElement)) {
            for (const sub of it.itemListElement) steps.push(String(sub.text || sub.name || "").trim());
          } else steps.push(String(it.text || it.name || "").trim());
        }
      }
    }
    const img = recipeNode.image;
    const photoUrl = typeof img === "string" ? img : Array.isArray(img) ? (typeof img[0] === "string" ? img[0] : img[0]?.url || "") : img?.url || "";
    const yieldRaw = recipeNode.recipeYield;
    const servings = Math.max(1, parseInt(Array.isArray(yieldRaw) ? yieldRaw[0] : yieldRaw, 10) || 4);
    const seq = ensureSeqCk(s, userId);
    const recipe = {
      id: uidCk("rec"),
      number: `R-${String(seq.rec).padStart(5, "0")}`,
      title: String(recipeNode.name || "Imported recipe").trim(),
      servings,
      prepMin: isoDurationToMinutes(recipeNode.prepTime),
      cookMin: isoDurationToMinutes(recipeNode.cookTime) || isoDurationToMinutes(recipeNode.totalTime),
      ingredients: normalizeIngredients(ingLines.map(parseIngredientLine).filter(Boolean)),
      steps: steps.filter(Boolean),
      tags: [].concat(recipeNode.keywords ? String(recipeNode.keywords).split(",").map((x) => x.trim()) : []).filter(Boolean).slice(0, 8),
      cuisine: String([].concat(recipeNode.recipeCuisine || [])[0] || ""),
      photoUrl: String(photoUrl || ""),
      sourceUrl: url,
      notes: String(recipeNode.description || "").trim(),
      ratings: [], madeLog: [], nutrition: null,
      createdAt: isoCk(),
    };
    seq.rec++;
    listCk(s.recipes, userId).push(recipe);
    saveCook();
    return { ok: true, result: { recipe, importedSteps: recipe.steps.length, importedIngredients: recipe.ingredients.length } };
  });

  // ── 3. Photo-based recipe capture — OCR a cookbook page via LLaVA ─
  registerLensAction("cooking", "import-from-photo", async (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = aidCk(ctx);
    const imageB64 = typeof params.imageB64 === "string" ? params.imageB64.replace(/^data:image\/\w+;base64,/, "") : "";
    const imageUrl = String(params.imageUrl || "").trim();
    if (!imageB64 && !imageUrl) return { ok: false, error: "imageB64 or imageUrl required" };
    const prompt = "You are reading a printed recipe from a cookbook page. Transcribe it as strict JSON only, no prose, with this exact shape: {\"title\":\"\",\"servings\":4,\"prepMin\":0,\"cookMin\":0,\"ingredients\":[\"1 cup flour\"],\"steps\":[\"Step one\"]}. Use the recipe's real values. If a field is not visible, use an empty string, 0, or empty array.";
    let vis;
    try {
      vis = imageB64 ? await callVision(imageB64, prompt) : await callVisionUrl(imageUrl, prompt);
    } catch (e) {
      return { ok: false, error: `vision unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!vis?.ok) return { ok: false, error: vis?.error || "vision failed" };
    let parsed;
    const jsonMatch = /\{[\s\S]*\}/.exec(vis.content || "");
    try { parsed = JSON.parse(jsonMatch ? jsonMatch[0] : vis.content); }
    catch { return { ok: false, error: "could not parse a recipe from the photo — try a clearer image", rawText: vis.content }; }
    const title = String(parsed.title || "").trim();
    if (!title) return { ok: false, error: "no recipe title detected in photo", rawText: vis.content };
    const seq = ensureSeqCk(s, userId);
    const recipe = {
      id: uidCk("rec"),
      number: `R-${String(seq.rec).padStart(5, "0")}`,
      title,
      servings: Math.max(1, Number(parsed.servings) || 4),
      prepMin: Math.max(0, Number(parsed.prepMin) || 0),
      cookMin: Math.max(0, Number(parsed.cookMin) || 0),
      ingredients: normalizeIngredients((Array.isArray(parsed.ingredients) ? parsed.ingredients : []).map(parseIngredientLine).filter(Boolean)),
      steps: (Array.isArray(parsed.steps) ? parsed.steps : []).map(String).filter(Boolean),
      tags: ["photo-import"],
      cuisine: "",
      photoUrl: "",
      sourceUrl: "",
      notes: "Captured from photo via vision OCR.",
      ratings: [], madeLog: [], nutrition: null,
      createdAt: isoCk(),
    };
    seq.rec++;
    listCk(s.recipes, userId).push(recipe);
    saveCook();
    return { ok: true, result: { recipe, model: vis.model } };
  });

  // ── 4. Ratings + notes history + "made it" log ─────────────────
  registerLensAction("cooking", "recipe-rate", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = listCk(s.recipes, aidCk(ctx)).find((x) => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recipe not found" };
    const stars = Math.round(Number(params.stars));
    if (!Number.isFinite(stars) || stars < 1 || stars > 5) return { ok: false, error: "stars must be 1-5" };
    if (!Array.isArray(r.ratings)) r.ratings = [];
    const entry = { id: uidCk("rt"), stars, note: String(params.note || "").trim(), at: isoCk() };
    r.ratings.push(entry);
    saveCook();
    const avg = r.ratings.reduce((a, x) => a + x.stars, 0) / r.ratings.length;
    return { ok: true, result: { entry, avgRating: Math.round(avg * 100) / 100, ratingCount: r.ratings.length } };
  });

  registerLensAction("cooking", "recipe-log-cooked", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = listCk(s.recipes, aidCk(ctx)).find((x) => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recipe not found" };
    if (!Array.isArray(r.madeLog)) r.madeLog = [];
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(params.date)) ? String(params.date) : new Date().toISOString().slice(0, 10);
    const entry = { id: uidCk("ml"), date, note: String(params.note || "").trim(), at: isoCk() };
    r.madeLog.push(entry);
    saveCook();
    return { ok: true, result: { entry, timesCooked: r.madeLog.length, lastCooked: date } };
  });

  registerLensAction("cooking", "recipe-history", (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = listCk(s.recipes, aidCk(ctx)).find((x) => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recipe not found" };
    const ratings = (r.ratings || []).slice().sort((a, b) => (b.at || "").localeCompare(a.at || ""));
    const madeLog = (r.madeLog || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const avg = ratings.length ? ratings.reduce((a, x) => a + x.stars, 0) / ratings.length : 0;
    return {
      ok: true,
      result: {
        recipeId: r.id, title: r.title,
        ratings, madeLog,
        avgRating: Math.round(avg * 100) / 100,
        ratingCount: ratings.length,
        timesCooked: madeLog.length,
        lastCooked: madeLog[0]?.date || null,
      },
    };
  });

  // ── 5. Per-recipe USDA-linked nutrition ────────────────────────
  // Resolve each ingredient against USDA FDC, sum real per-100g
  // nutrients scaled by ingredient grams. Persists on the recipe.
  const GRAM_PER_UNIT = {
    g: 1, gram: 1, grams: 1, kg: 1000, kilograms: 1000,
    oz: 28.35, ounce: 28.35, ounces: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
    ml: 1, milliliters: 1, l: 1000, liters: 1000, litre: 1000,
    cup: 240, cups: 240, tbsp: 15, tablespoon: 15, tablespoons: 15,
    tsp: 5, teaspoon: 5, teaspoons: 5,
  };
  function ingredientGrams(ing) {
    const u = String(ing.unit || "").toLowerCase().replace(/[.,]/g, "");
    const factor = GRAM_PER_UNIT[u];
    if (ing.qty != null && factor) return ing.qty * factor;
    if (ing.qty != null && !u) return ing.qty * 100; // count items → 100g each
    return 100; // unknown — assume one standard 100g portion
  }

  registerLensAction("cooking", "recipe-nutrition-compute", async (ctx, _a, params = {}) => {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = listCk(s.recipes, aidCk(ctx)).find((x) => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recipe not found" };
    if (!r.ingredients.length) return { ok: false, error: "recipe has no ingredients" };
    const apiKey = process.env.NASA_FDC_API_KEY || process.env.FDC_API_KEY || "DEMO_KEY";
    const totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, fiber: 0, sugar: 0, sodium: 0 };
    const lines = [];
    for (const ing of r.ingredients) {
      const grams = ingredientGrams(ing);
      let resolved = null;
      try {
        const search = await fetchJsonWithTimeout(
          `${FDC_BASE}/foods/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(ing.name)}&pageSize=1`,
          {}, 10000,
        );
        const food = (search.foods || [])[0];
        if (food) {
          const pick = (...names) => {
            for (const n of food.foodNutrients || []) {
              const nm = n.nutrientName || n.nutrient?.name || "";
              if (names.some((x) => nm === x)) return n.value ?? n.amount ?? 0;
            }
            return 0;
          };
          const factor = grams / 100;
          const per = {
            kcal: pick("Energy") * factor,
            protein: pick("Protein") * factor,
            fat: pick("Total lipid (fat)") * factor,
            carbs: pick("Carbohydrate, by difference") * factor,
            fiber: pick("Fiber, total dietary") * factor,
            sugar: pick("Sugars, total including NLEA", "Total Sugars") * factor,
            sodium: pick("Sodium, Na") * factor,
          };
          for (const k of Object.keys(totals)) totals[k] += per[k] || 0;
          resolved = { fdcId: food.fdcId, description: food.description, grams: Math.round(grams), kcal: Math.round(per.kcal) };
        }
      } catch { /* ingredient unresolved — skip, recorded below */ }
      lines.push({ ingredient: ing.name, grams: Math.round(grams), resolved: !!resolved, match: resolved });
    }
    const resolvedCount = lines.filter((l) => l.resolved).length;
    const servings = Math.max(1, r.servings || 1);
    const nutrition = {
      total: {
        caloriesKcal: Math.round(totals.kcal),
        proteinG: Math.round(totals.protein * 10) / 10,
        fatG: Math.round(totals.fat * 10) / 10,
        carbsG: Math.round(totals.carbs * 10) / 10,
        fiberG: Math.round(totals.fiber * 10) / 10,
        sugarG: Math.round(totals.sugar * 10) / 10,
        sodiumMg: Math.round(totals.sodium),
      },
      perServing: {
        caloriesKcal: Math.round(totals.kcal / servings),
        proteinG: Math.round((totals.protein / servings) * 10) / 10,
        fatG: Math.round((totals.fat / servings) * 10) / 10,
        carbsG: Math.round((totals.carbs / servings) * 10) / 10,
      },
      lines, resolvedCount, ingredientCount: r.ingredients.length,
      source: "usda-fooddata-central",
      computedAt: isoCk(),
    };
    r.nutrition = nutrition;
    saveCook();
    return { ok: true, result: nutrition };
  });

  // ── 6. Shopping list — multi-store grouping + unit normalization ─
  // Maps each aisle to a store category and normalizes quantities to
  // a canonical unit (grams / ml / count) so duplicates consolidate.
  const STORE_FOR_AISLE = {
    produce: "Grocery", meat: "Grocery", seafood: "Grocery", dairy: "Grocery",
    bakery: "Bakery", frozen: "Grocery", pantry: "Grocery", beverages: "Grocery", other: "Grocery",
  };
  function normalizeUnit(qty, unit) {
    if (qty == null) return { qty: null, unit: unit || "" };
    const u = String(unit || "").toLowerCase().replace(/[.,]/g, "");
    const massG = { g: 1, gram: 1, grams: 1, kg: 1000, kilograms: 1000, oz: 28.35, ounce: 28.35, ounces: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6 };
    const volMl = { ml: 1, milliliters: 1, l: 1000, liters: 1000, litre: 1000, cup: 240, cups: 240, tbsp: 15, tablespoon: 15, tablespoons: 15, tsp: 5, teaspoon: 5, teaspoons: 5 };
    if (massG[u]) return { qty: Math.round(qty * massG[u] * 100) / 100, unit: "g", canonical: "mass" };
    if (volMl[u]) return { qty: Math.round(qty * volMl[u] * 100) / 100, unit: "ml", canonical: "volume" };
    return { qty, unit: u || "", canonical: "count" };
  }

  registerLensAction("cooking", "shopping-list-by-store", (ctx, _a, params = {}) => {
  try {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = listCk(s.shopping, aidCk(ctx));
    // Normalize + consolidate by (name, canonical unit).
    const merged = new Map();
    for (const it of items) {
      const norm = normalizeUnit(it.qty, it.unit);
      const key = `${it.name.toLowerCase()}|${norm.unit}`;
      const cur = merged.get(key) || { name: it.name, unit: norm.unit, qty: null, aisle: it.aisle, checked: true, ids: [], canonical: norm.canonical || "count" };
      if (norm.qty != null) cur.qty = (cur.qty || 0) + norm.qty;
      cur.checked = cur.checked && it.checked;
      cur.ids.push(it.id);
      merged.set(key, cur);
    }
    // Group by store.
    const stores = {};
    for (const it of merged.values()) {
      const store = STORE_FOR_AISLE[it.aisle] || "Grocery";
      const bucket = (stores[store] = stores[store] || { store, aisles: {}, itemCount: 0 });
      (bucket.aisles[it.aisle] = bucket.aisles[it.aisle] || []).push({
        name: it.name,
        qty: it.qty != null ? Math.round(it.qty * 100) / 100 : null,
        unit: it.unit,
        aisle: it.aisle,
        checked: it.checked,
        normalized: it.qty != null,
        ids: it.ids,
      });
      bucket.itemCount++;
    }
    const storeList = Object.values(stores).map((b) => ({
      ...b,
      aisles: Object.entries(b.aisles).map(([aisle, list]) => ({ aisle, items: list })),
    }));
    return { ok: true, result: { stores: storeList, storeCount: storeList.length, consolidatedFrom: items.length, totalItems: merged.size } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── 7. Recipe export — printable card / PDF-ready structured doc ─
  registerLensAction("cooking", "recipe-export-card", (ctx, _a, params = {}) => {
  try {
    const s = getCookState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const r = listCk(s.recipes, aidCk(ctx)).find((x) => x.id === String(params.id || ""));
    if (!r) return { ok: false, error: "recipe not found" };
    const ratings = r.ratings || [];
    const avg = ratings.length ? Math.round((ratings.reduce((a, x) => a + x.stars, 0) / ratings.length) * 100) / 100 : null;
    const ingLine = (i) => `${i.qty != null ? i.qty : ""}${i.unit ? " " + i.unit : ""} ${i.name}`.trim();
    // Plain-text card — printable, copy-pasteable, PDF-ready.
    const lines = [];
    lines.push(r.title.toUpperCase());
    lines.push("=".repeat(Math.min(60, r.title.length)));
    lines.push("");
    const meta = [`Serves ${r.servings}`];
    if (r.prepMin) meta.push(`Prep ${r.prepMin} min`);
    if (r.cookMin) meta.push(`Cook ${r.cookMin} min`);
    if (r.cuisine) meta.push(r.cuisine);
    if (avg != null) meta.push(`${avg}/5 (${ratings.length})`);
    lines.push(meta.join("  ·  "));
    if (r.sourceUrl) lines.push(`Source: ${r.sourceUrl}`);
    lines.push("");
    lines.push("INGREDIENTS");
    for (const i of r.ingredients) lines.push(`  • ${ingLine(i)}`);
    lines.push("");
    lines.push("METHOD");
    r.steps.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
    if (r.notes) { lines.push(""); lines.push("NOTES"); lines.push(`  ${r.notes}`); }
    const card = lines.join("\n");
    // Minimal self-contained printable HTML.
    const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title>` +
      `<style>body{font-family:Georgia,serif;max-width:680px;margin:2rem auto;color:#222;line-height:1.5}` +
      `h1{border-bottom:2px solid #d97706;padding-bottom:.3rem}.meta{color:#666;font-size:.9rem}` +
      `h2{color:#d97706;font-size:1.1rem;margin-top:1.4rem}ol,ul{padding-left:1.4rem}` +
      `@media print{body{margin:0}}</style></head><body>` +
      `<h1>${esc(r.title)}</h1><p class="meta">${esc(meta.join("  ·  "))}</p>` +
      `<h2>Ingredients</h2><ul>${r.ingredients.map((i) => `<li>${esc(ingLine(i))}</li>`).join("")}</ul>` +
      `<h2>Method</h2><ol>${r.steps.map((stp) => `<li>${esc(stp)}</li>`).join("")}</ol>` +
      (r.notes ? `<h2>Notes</h2><p>${esc(r.notes)}</p>` : "") +
      (r.sourceUrl ? `<p class="meta">Source: ${esc(r.sourceUrl)}</p>` : "") +
      `</body></html>`;
    return { ok: true, result: { recipeId: r.id, title: r.title, card, html, format: "printable-card" } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
