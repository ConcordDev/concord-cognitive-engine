/**
 * cooking/food.live_food_search — USDA FoodData Central request + honest errors.
 * fetch is stubbed; no live HTTP. Run: node --test server/tests/usda-food-search.test.js
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerFreeApiLiveMacros, {
  usdaFoodSearchRequest, usdaErrorMessage, USDA_FOOD_SEARCH_DATA_TYPES,
} from "../domains/free-api-live.js";

const FAKE_KEY = "test-key-abc123XYZ";

function handler(domain = "cooking") {
  const map = new Map();
  registerFreeApiLiveMacros((d, n, h) => map.set(`${d}.${n}`, h));
  return map.get(`${domain}.live_food_search`);
}

let realFetch, savedKey, calls;
function stubFetch(responder) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), init }); return responder(url, init); };
}
const jsonRes = (status, body) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { realFetch = globalThis.fetch; savedKey = process.env.USDA_API_KEY; process.env.USDA_API_KEY = FAKE_KEY; });
afterEach(() => { globalThis.fetch = realFetch; if (savedKey === undefined) delete process.env.USDA_API_KEY; else process.env.USDA_API_KEY = savedKey; });

describe("usdaFoodSearchRequest", () => {
  it("POSTs the criteria as JSON (GET with a Survey (FNDDS) dataType filter is 400'd by USDA)", () => {
    const { url, init } = usdaFoodSearchRequest({ apiKey: FAKE_KEY, query: "apple pie (baked)", limit: 5 });
    assert.equal(init.method, "POST");
    assert.equal(init.headers["Content-Type"], "application/json");
    const u = new URL(url);
    assert.equal(u.pathname, "/fdc/v1/foods/search");
    assert.equal(u.searchParams.get("api_key"), FAKE_KEY);
    assert.equal(u.searchParams.has("dataType"), false, "dataType must not be in the query string");
    assert.equal(u.searchParams.has("query"), false);
    assert.deepEqual(JSON.parse(init.body), { query: "apple pie (baked)", pageSize: 5, dataType: ["Survey (FNDDS)", "SR Legacy"] });
    assert.deepEqual(USDA_FOOD_SEARCH_DATA_TYPES, ["Survey (FNDDS)", "SR Legacy"]);
  });
});

describe("live_food_search handler", () => {
  it("returns foods on 200 and sends the JSON body", async () => {
    stubFetch(() => jsonRes(200, { totalHits: 1, foods: [{ fdcId: 1, description: "Apple, raw", dataType: "SR Legacy", foodNutrients: [{ nutrientName: "Energy", value: 52 }] }] }));
    for (const domain of ["cooking", "food"]) {
      const r = await handler(domain)({}, { query: "apple", limit: 3 });
      assert.equal(r.ok, true);
      assert.equal(r.foods[0].kcalPer100g, 52);
      assert.equal(r.usingDemoKey, false);
    }
    assert.equal(calls[0].init.method, "POST");
    assert.equal(JSON.parse(calls[0].init.body).pageSize, 3);
  });

  it("reports USDA's status and message on an error response, never the key", async () => {
    stubFetch(() => jsonRes(400, { error: { code: "BAD", message: `Invalid request for key ${FAKE_KEY}` } }));
    const r = await handler()({}, { query: "apple" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "usda_http_error");
    assert.equal(r.status, 400);
    assert.match(r.error, /HTTP 400/);
    assert.equal(r.usdaMessage, "Invalid request for key [redacted]");
    assert.equal(JSON.stringify(r).includes(FAKE_KEY), false);
  });

  it("nginx HTML 400 → status kept, usdaMessage null (no invented text)", async () => {
    stubFetch(() => new Response("<html><body>400 Bad Request</body></html>", { status: 400, headers: { "content-type": "text/html" } }));
    const r = await handler()({}, { query: "apple" });
    assert.deepEqual([r.ok, r.reason, r.status, r.usdaMessage], [false, "usda_http_error", 400, null]);
  });

  it("429 → usda_rate_limited", async () => {
    stubFetch(() => jsonRes(429, { error: { message: "rate limited" } }));
    const r = await handler()({}, { query: "apple" });
    assert.equal(r.reason, "usda_rate_limited");
    assert.equal(r.status, 429);
  });

  it("network failure → usda_unreachable without the URL", async () => {
    stubFetch(() => { throw new TypeError("fetch failed"); });
    const r = await handler()({}, { query: "apple" });
    assert.equal(r.reason, "usda_unreachable");
    assert.equal(JSON.stringify(r).includes(FAKE_KEY), false);
  });

  it("rejects empty and over-long queries without calling USDA", async () => {
    stubFetch(() => jsonRes(200, {}));
    assert.equal((await handler()({}, { query: "  " })).reason, "missing_query");
    assert.equal((await handler()({}, { query: "x".repeat(101) })).reason, "query_too_long");
    assert.equal(calls.length, 0);
  });
});

describe("usdaErrorMessage", () => {
  it("reads {error:{message}}, {message}, and ignores non-JSON", () => {
    assert.equal(usdaErrorMessage('{"error":{"message":"m1"}}'), "m1");
    assert.equal(usdaErrorMessage('{"message":"m2"}'), "m2");
    assert.equal(usdaErrorMessage("<html>"), null);
    assert.equal(usdaErrorMessage(""), null);
  });
});
