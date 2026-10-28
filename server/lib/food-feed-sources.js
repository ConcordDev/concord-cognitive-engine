// server/lib/food-feed-sources.js
//
// Food / cooking upstreams routed through lib/feed-cache.js: Open Food Facts
// (category, search, product), Spoonacular meal plans, TheMealDB and USDA FDC.
// Every outbound call goes through the SSRF-guarded fetchPublicUrl and a
// per-source budget, so user clicks never fan out into upstream traffic.
//
// Honesty: failures are never cached as data. When nothing truthful can be
// served the caller gets { ok:false, status:"unavailable", reason, lastOkAt };
// stale data is served with stale:true + fetchedAt. Nothing here invents a
// product, recipe or plan.
//
// Sources register on import (register-once via hasSource) and again on demand
// via ensureFoodFeedSources(), because feed-cache's test reset clears them.

import { registerSource, hasSource, get, peek } from "./feed-cache.js";
import { fetchPublicUrl } from "./public-fetch.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const OFF_CATEGORIES = ["snacks", "beverages", "breakfasts", "cheeses", "pastas", "chocolates"];
export const OFF_CATEGORY_PAGE_SIZE = 24;
const OFF_BASE = "https://world.openfoodfacts.org";
// OFF serves list/search pages (cgi/search.pl, /api/v2/search, /category/*.json)
// only to signed-in users now (anonymous callers get a 503 "not available to
// anonymous users" page). Search-a-licious is OFF's official public search API.
const OFF_SEARCH_BASE = process.env.CONCORD_OFF_SEARCH_BASE || "https://search.openfoodfacts.org";
const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const OFF_FIELDS_LIST = "code,product_name,brands,nutriscore_grade,categories,nova_group,ecoscore_grade,image_url,quantity,countries_tags";
const OFF_FIELDS_PRODUCT = "product_name,brands,quantity,categories,ingredients_text,allergens_tags,additives_tags,nutriscore_grade,ecoscore_grade,nova_group,nutriments,serving_size,image_url,image_nutrition_url,image_ingredients_url,countries_tags";

function offHeaders() {
  return {
    "User-Agent": process.env.CONCORD_OFF_USER_AGENT || "ConcordOS/1.0 (contact@concord-os.org)",
    Accept: "application/json",
  };
}

class UpstreamError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function getJson(url, init, signal, label) {
  const r = await fetchPublicUrl(url, { ...init, signal });
  if (!r.ok) throw new UpstreamError(`${label} ${r.status}`, r.status);
  return { r, data: await r.json() };
}

// "|" is the compound-key delimiter, so it can never survive inside a user term.
const norm = (s) => String(s ?? "").replace(/\|/g, " ").trim().toLowerCase().replace(/\s+/g, " ");

// ── fetchers (key, { signal }) -> JSON-serializable data ────────────────────

// Search-a-licious returns brands as an array; the legacy API used a string.
const joinList = (v) => (Array.isArray(v) ? v.filter(Boolean).join(", ") : v);
// Search-a-licious answers { hits, count }; the legacy API answered { products, count }.
const offHits = (data) => (Array.isArray(data?.hits) ? data.hits : Array.isArray(data?.products) ? data.products : []);

function offListItem(p) {
  return {
    code: p.code, product_name: p.product_name, brands: joinList(p.brands),
    nutriscore_grade: p.nutriscore_grade, categories: p.categories,
    nova_group: p.nova_group, ecoscore_grade: p.ecoscore_grade,
    image_url: p.image_url, quantity: p.quantity, countries_tags: p.countries_tags,
  };
}

async function fetchOffCategory(slug, { signal }) {
  const q = encodeURIComponent(`categories_tags:"en:${slug}"`);
  const url = `${OFF_SEARCH_BASE}/search?q=${q}&page_size=${OFF_CATEGORY_PAGE_SIZE}&fields=${OFF_FIELDS_LIST}`;
  const { data } = await getJson(url, { headers: offHeaders() }, signal, "openfoodfacts");
  return { products: offHits(data).map(offListItem) };
}

// key: "terms|page|pageSize". Full-text search via Search-a-licious (the legacy
// cgi/search.pl and v2 /search now refuse anonymous callers).
async function fetchOffSearch(key, { signal }) {
  const [terms, page, pageSize] = key.split("|");
  const url = `${OFF_SEARCH_BASE}/search?q=${encodeURIComponent(terms)}&page=${page}&page_size=${pageSize}&fields=${OFF_FIELDS_LIST}`;
  const { data } = await getJson(url, { headers: offHeaders() }, signal, "openfoodfacts");
  return { products: offHits(data).map(offListItem), count: data?.count ?? null };
}

async function fetchOffProduct(barcode, { signal }) {
  const url = `${OFF_BASE}/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${OFF_FIELDS_PRODUCT}`;
  const r = await fetchPublicUrl(url, { headers: offHeaders(), signal });
  if (r.status === 404) return { found: false, product: null }; // a real "no such barcode" answer
  if (!r.ok) throw new UpstreamError(`openfoodfacts ${r.status}`, r.status);
  const data = await r.json();
  if (data?.status !== 1 || !data.product) return { found: false, product: null };
  const p = data.product;
  const n = p.nutriments || {};
  return {
    found: true,
    product: {
      product_name: p.product_name, brands: p.brands, quantity: p.quantity, categories: p.categories,
      ingredients_text: p.ingredients_text, allergens_tags: p.allergens_tags, additives_tags: p.additives_tags,
      nutriscore_grade: p.nutriscore_grade, ecoscore_grade: p.ecoscore_grade, nova_group: p.nova_group,
      nutriments: {
        "energy-kcal_100g": n["energy-kcal_100g"], fat_100g: n.fat_100g, "saturated-fat_100g": n["saturated-fat_100g"],
        sugars_100g: n.sugars_100g, salt_100g: n.salt_100g, sodium_100g: n.sodium_100g,
        proteins_100g: n.proteins_100g, fiber_100g: n.fiber_100g, carbohydrates_100g: n.carbohydrates_100g,
      },
      serving_size: p.serving_size, image_url: p.image_url, image_nutrition_url: p.image_nutrition_url,
      image_ingredients_url: p.image_ingredients_url, countries_tags: p.countries_tags,
    },
  };
}

// Spoonacular quota headers from the most recent real upstream response.
let _spoonQuota = null;
let _spoonBlockedUntil = 0;
export function getSpoonacularQuota() { return _spoonQuota ? { ..._spoonQuota } : null; }

// key: "week|targetCalories|diet"
async function fetchSpoonacularPlan(key, { signal }) {
  const apiKey = process.env.SPOONACULAR_API_KEY;
  if (!apiKey) throw new UpstreamError("no_api_key", 0);
  const [timeFrame, cal, diet] = key.split("|");
  const url = `https://api.spoonacular.com/mealplanner/generate?timeFrame=${encodeURIComponent(timeFrame)}&targetCalories=${encodeURIComponent(cal)}${diet ? `&diet=${encodeURIComponent(diet)}` : ""}`;
  // Key goes in a header, never the URL (URLs end up in logs and error strings).
  const r = await fetchPublicUrl(url, { headers: { "x-api-key": apiKey, Accept: "application/json" }, signal });
  const h = r.headers && typeof r.headers.get === "function" ? r.headers : null;
  if (h) {
    const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
    _spoonQuota = { request: num(h.get("x-api-quota-request")), used: num(h.get("x-api-quota-used")), at: Date.now() };
  }
  if (r.status === 402) throw new UpstreamError("quota_exhausted", 402);
  if (!r.ok) throw new UpstreamError(`spoonacular ${r.status}`, r.status);
  return await r.json();
}

async function fetchMealDb(letter, { signal }) {
  const url = `https://www.themealdb.com/api/json/v1/1/search.php?f=${encodeURIComponent(letter)}`;
  const { data } = await getJson(url, { headers: { Accept: "application/json" }, signal }, signal, "themealdb");
  return { meals: Array.isArray(data?.meals) ? data.meals : [] };
}

function fdcKey() { return process.env.NASA_FDC_API_KEY || process.env.FDC_API_KEY || "DEMO_KEY"; }
const fdcInit = (signal) => ({ headers: { "X-Api-Key": fdcKey(), Accept: "application/json" }, signal });

const slimNutrient = (n) => ({
  nutrient: n.nutrient ? { name: n.nutrient.name, unitName: n.nutrient.unitName } : undefined,
  nutrientName: n.nutrientName, unitName: n.unitName, amount: n.amount, value: n.value,
});

// key: "search|query|pageSize|dataType" or "food|fdcId"
async function fetchUsda(key, { signal }) {
  const [kind, a, b, c] = key.split("|");
  if (kind === "food") {
    const r = await fetchPublicUrl(`${FDC_BASE}/food/${encodeURIComponent(a)}`, fdcInit(signal));
    if (r.status === 404) return { notFound: true };
    if (!r.ok) throw new UpstreamError(`fdc ${r.status}`, r.status);
    const f = await r.json();
    return {
      fdcId: f.fdcId, description: f.description, dataType: f.dataType, brandOwner: f.brandOwner,
      servingSize: f.servingSize, servingSizeUnit: f.servingSizeUnit, householdServingFullText: f.householdServingFullText,
      foodNutrients: (f.foodNutrients || []).map(slimNutrient),
    };
  }
  const dataType = c ? `&dataType=${encodeURIComponent(c)}` : "";
  const url = `${FDC_BASE}/foods/search?query=${encodeURIComponent(a)}&pageSize=${encodeURIComponent(b)}${dataType}`;
  const { data } = await getJson(url, fdcInit(signal), signal, "fdc");
  return {
    foods: (data.foods || []).map((f) => ({
      fdcId: f.fdcId, description: f.description, dataType: f.dataType, brandOwner: f.brandOwner,
      brandName: f.brandName, gtinUpc: f.gtinUpc, servingSize: f.servingSize, servingSizeUnit: f.servingSizeUnit,
      score: f.score, publishedDate: f.publishedDate,
      foodNutrients: (f.foodNutrients || []).map(slimNutrient),
    })),
    totalHits: data.totalHits, currentPage: data.currentPage, totalPages: data.totalPages,
  };
}

// ── registration ────────────────────────────────────────────────────────────

const SOURCES = [
  ["openfoodfacts-category", { ttlMs: DAY, staleMaxMs: 7 * DAY, budget: { perMin: 2, perDay: 50, minSpacingMs: 5000 }, timeoutMs: 15000, license: "public", maxKeys: 12,
    fetcher: fetchOffCategory, warm: { keys: OFF_CATEGORIES, everyTicks: 20 } }],
  ["openfoodfacts-search", { ttlMs: 6 * HOUR, staleMaxMs: 3 * DAY, budget: { perMin: 8, perDay: 400, minSpacingMs: 1000 }, timeoutMs: 15000, license: "public", maxKeys: 500, fetcher: fetchOffSearch }],
  ["openfoodfacts-product", { ttlMs: DAY, staleMaxMs: 14 * DAY, budget: { perMin: 10, perDay: 800, minSpacingMs: 1000 }, timeoutMs: 15000, license: "public", maxKeys: 2000, fetcher: fetchOffProduct }],
  ["spoonacular-mealplan", { ttlMs: DAY, staleMaxMs: 7 * DAY, budget: { perMin: 1, perDay: 20, minSpacingMs: 1100 }, timeoutMs: 20000, license: "keyed-display-ok", maxKeys: 100, fetcher: fetchSpoonacularPlan }],
  ["themealdb-search", { ttlMs: DAY, staleMaxMs: 30 * DAY, budget: { perMin: 4, perDay: 100, minSpacingMs: 1000 }, timeoutMs: 15000, license: "public", maxKeys: 26, fetcher: fetchMealDb }],
  ["usda-fdc", { ttlMs: DAY, staleMaxMs: 7 * DAY, budget: { perMin: 10, perDay: 900, minSpacingMs: 0 }, timeoutMs: 15000, license: "keyed-display-ok", maxKeys: 1000, fetcher: fetchUsda }],
];

/** Register-once; safe to call repeatedly (feed-cache's test reset clears the registry). */
export function ensureFoodFeedSources() {
  for (const [id, cfg] of SOURCES) {
    if (!hasSource(id)) registerSource(id, { ...cfg, persist: true });
  }
}
ensureFoodFeedSources();

// ── accessors ───────────────────────────────────────────────────────────────

function nextUtcMidnight() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

function normReason(reason) {
  const s = String(reason || "");
  if (/quota_exhausted/.test(s)) return "quota_exhausted";
  return s || "unavailable";
}

/**
 * Wrap a feed-cache get() result. Returns
 *   { ok:true, data, fetchedAt, stale }  or
 *   { ok:false, status:"unavailable", reason, lastOkAt, error }
 */
function shape(r) {
  if (r.status === "unavailable" || r.data == null) {
    const reason = normReason(r.reason);
    return { ok: false, status: "unavailable", reason, lastOkAt: r.lastOkAt ?? null, error: `upstream unavailable: ${reason}` };
  }
  return { ok: true, data: r.data, fetchedAt: r.fetchedAt, stale: !!r.stale };
}

async function via(sourceId, key) {
  ensureFoodFeedSources();
  return shape(await get(sourceId, key));
}

/** Freshness fields to merge into a successful macro result. */
export function freshness(s) {
  return s.stale ? { fetchedAt: s.fetchedAt, stale: true } : { fetchedAt: s.fetchedAt };
}

export const getOffCategory = (slug) => via("openfoodfacts-category", String(slug));

export function getOffSearch({ query, page = 1, pageSize = 20 }) {
  const terms = norm(query);
  return via("openfoodfacts-search", `${terms}|${Math.max(1, Math.floor(page))}|${Math.max(1, Math.min(100, Math.floor(pageSize)))}`);
}

export const getOffProduct = (barcode) => via("openfoodfacts-product", String(barcode));

export async function getSpoonacularMealPlan({ targetCalories = 2000, diet = "" } = {}) {
  ensureFoodFeedSources();
  const key = `week|${Math.round(Number(targetCalories) || 2000)}|${norm(diet)}`;
  if (_spoonBlockedUntil > Date.now()) {
    // Daily points are spent: serve what we already hold, but make no upstream call.
    const hit = peek("spoonacular-mealplan", key);
    if (hit) return { ok: true, data: hit.data, fetchedAt: hit.fetchedAt, stale: true };
    return { ok: false, status: "unavailable", reason: "quota_exhausted", lastOkAt: null, error: "upstream unavailable: quota_exhausted" };
  }
  const s = await via("spoonacular-mealplan", key);
  if (!s.ok && s.reason === "quota_exhausted") _spoonBlockedUntil = nextUtcMidnight();
  return s;
}

export const getMealDbLetter = (letter) => via("themealdb-search", String(letter).toLowerCase());

export function getUsdaSearch({ query, pageSize = 10, dataType = "" }) {
  return via("usda-fdc", `search|${norm(query)}|${pageSize}|${String(dataType || "").replace(/\|/g, " ").trim()}`);
}
export const getUsdaFood = (fdcId) => via("usda-fdc", `food|${fdcId}`);

/** Test hook: forget the Spoonacular quota block + last quota headers. */
export function _resetFoodFeedForTests() { _spoonBlockedUntil = 0; _spoonQuota = null; }
