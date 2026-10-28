// OpenTDB's own rate limit (HTTP 429, or response_code 5) is an upstream
// fault: game.live_trivia reports reason upstream_rate_limited, which
// /api/lens/run answers as HTTP 200 { ok:false } (lib/lens-run-http.js).
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerCuratedFreeApiMacros from "../domains/curated-free-apis.js";
import { shapeLensRunHttp } from "../lib/lens-run-http.js";

const handlers = {};
registerCuratedFreeApiMacros((domain, name, fn) => { handlers[`${domain}.${name}`] = fn; });
const trivia = handlers["game.live_trivia"];
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("game.live_trivia upstream rate limit", () => {
  it("HTTP 429 → upstream_rate_limited, HTTP 200 envelope", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
    const r = await trivia({}, { amount: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "upstream_rate_limited");
    const shaped = shapeLensRunHttp(r);
    assert.equal(shaped.status, 200);
    assert.equal(shaped.body.error, "upstream_rate_limited");
  });
  it("response_code 5 → upstream_rate_limited", async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ response_code: 5, results: [] }) });
    const r = await trivia({}, { amount: 5 });
    assert.equal(r.reason, "upstream_rate_limited");
    assert.equal(shapeLensRunHttp(r).status, 200);
  });
  it("HTTP 503 stays opentdb_unreachable (also HTTP 200)", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
    const r = await trivia({}, { amount: 5 });
    assert.equal(r.reason, "opentdb_unreachable");
    assert.equal(shapeLensRunHttp(r).status, 200);
  });
});
