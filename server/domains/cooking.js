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
}
