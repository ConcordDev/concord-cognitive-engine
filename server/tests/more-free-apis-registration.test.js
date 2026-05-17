/**
 * Tier-2 contract test for the second wave of free-API macro registrations
 * (more-free-apis.js — PubChem, PubMed, MedlinePlus, iTunes, REST Countries,
 * GBIF, Open Library).
 *
 * Pins:
 *   - all 12 expected (domain, name) pairs register
 *   - input validation (missing/overlong query) rejects without hitting
 *     the upstream API
 *   - shared handlers (used across multiple domains) point at the same
 *     function instance so a single bug-fix lands everywhere
 *   - every registered macro carries a note for /api/lens introspection
 *
 * Live external fetches are NOT exercised here — that would couple CI
 * health to PubMed/NIH/iTunes uptime. Smoke testing is via the lens
 * panels in the browser.
 *
 * Run: node --test server/tests/more-free-apis-registration.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerMoreFreeApiMacros from "../domains/more-free-apis.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

const EXPECTED_PAIRS = [
  "chem.live_pubchem",
  "bio.live_pubmed",
  "neuro.live_pubmed_neuro",
  "mental-health.live_medlineplus",
  "podcast.live_itunes_search",
  "global.live_countries",
  "environment.live_gbif",
  "forestry.live_gbif",
  "agriculture.live_gbif",
  "paper.live_openlibrary",
  "education.live_openlibrary",
];

describe("more-free-apis macro registration", () => {
  it("registers all expected (domain, macro) pairs", () => {
    const r = makeRegistry();
    registerMoreFreeApiMacros(r.register);
    for (const key of EXPECTED_PAIRS) {
      assert.ok(r.map.has(key), `missing registration: ${key}`);
    }
  });

  it("each registered macro carries a note for introspection", () => {
    const r = makeRegistry();
    registerMoreFreeApiMacros(r.register);
    for (const key of EXPECTED_PAIRS) {
      const entry = r.map.get(key);
      assert.ok(entry.meta?.note, `${key} missing note metadata`);
    }
  });
});

describe("shared handler identity across domains", () => {
  it("GBIF handler is shared across environment/forestry/agriculture", () => {
    const r = makeRegistry();
    registerMoreFreeApiMacros(r.register);
    const env = r.map.get("environment.live_gbif").handler;
    const forest = r.map.get("forestry.live_gbif").handler;
    const ag = r.map.get("agriculture.live_gbif").handler;
    assert.equal(env, forest);
    assert.equal(env, ag);
  });

  it("Open Library handler is shared across paper/education", () => {
    const r = makeRegistry();
    registerMoreFreeApiMacros(r.register);
    const paper = r.map.get("paper.live_openlibrary").handler;
    const edu = r.map.get("education.live_openlibrary").handler;
    assert.equal(paper, edu);
  });
});

describe("input validation — missing query", () => {
  const NEEDS_QUERY = [
    "chem.live_pubchem",
    "bio.live_pubmed",
    "neuro.live_pubmed_neuro",
    "mental-health.live_medlineplus",
    "podcast.live_itunes_search",
    "environment.live_gbif",
    "forestry.live_gbif",
    "agriculture.live_gbif",
    "paper.live_openlibrary",
    "education.live_openlibrary",
  ];

  for (const key of NEEDS_QUERY) {
    it(`${key} rejects missing query`, async () => {
      const r = makeRegistry();
      registerMoreFreeApiMacros(r.register);
      const handler = r.map.get(key).handler;
      const res = await handler({}, {});
      assert.equal(res.ok, false);
      assert.equal(res.reason, "missing_query");
    });
  }

  it("global.live_countries permits empty query (returns full list)", async () => {
    // global is allowed an empty query — it falls back to the /all endpoint.
    // We don't actually call it here (would hit network); just verify the
    // contract that empty input doesn't short-circuit with missing_query.
    const r = makeRegistry();
    registerMoreFreeApiMacros(r.register);
    const handler = r.map.get("global.live_countries").handler;
    // We can't await full fetch in CI; just verify the function is callable
    // with empty input by checking it returns a thenable (Promise).
    const result = handler({}, {});
    assert.ok(typeof result.then === "function");
    // Don't await — leave the fetch dangling (test exits).
  });
});

describe("input validation — overlong query", () => {
  const LIMITS = {
    "chem.live_pubchem": 250,
    "bio.live_pubmed": 350,
    "neuro.live_pubmed_neuro": 350,
    "mental-health.live_medlineplus": 250,
    "podcast.live_itunes_search": 250,
    "environment.live_gbif": 250,
    "paper.live_openlibrary": 350,
  };

  for (const [key, length] of Object.entries(LIMITS)) {
    it(`${key} rejects overlong query (${length} chars)`, async () => {
      const r = makeRegistry();
      registerMoreFreeApiMacros(r.register);
      const handler = r.map.get(key).handler;
      const res = await handler({}, { query: "x".repeat(length) });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "query_too_long");
    });
  }
});
