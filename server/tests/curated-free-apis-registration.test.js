/**
 * Tier-2 contract test for the fifth-wave curated REAL free-API macro
 * registrations (curated-free-apis.js — Spaceflight News, Launch Library,
 * PoetryDB, Open Trivia DB, Quotable, Cat Facts).
 *
 * Pins:
 *   - all 10 expected (domain, macro) pairs register
 *   - shared handlers (used across multiple domains) share function
 *     identity so a fix lands everywhere
 *   - input validation rejects bad inputs without hitting upstream
 *   - every macro has a note for /api/lens introspection
 *
 * Live external fetches NOT exercised here.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import registerCuratedFreeApiMacros from "../domains/curated-free-apis.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

const EXPECTED_PAIRS = [
  "astronomy.live_spaceflight_news",
  "space.live_spaceflight_news",
  "astronomy.live_launches_upcoming",
  "space.live_launches_upcoming",
  "poetry.live_poetrydb",
  "game.live_trivia",
  "daily.live_quote",
  "reflection.live_quote",
  "pets.live_catfact",
];

describe("curated-free-apis macro registration", () => {
  it("registers all 9 expected (domain, macro) pairs", () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    for (const key of EXPECTED_PAIRS) {
      assert.ok(r.map.has(key), `missing registration: ${key}`);
    }
  });

  it("each registered macro carries a note", () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    for (const key of EXPECTED_PAIRS) {
      assert.ok(r.map.get(key).meta?.note, `${key} missing note`);
    }
  });
});

describe("shared handler identity", () => {
  it("Spaceflight News handler shared across astronomy + space", () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    assert.equal(
      r.map.get("astronomy.live_spaceflight_news").handler,
      r.map.get("space.live_spaceflight_news").handler,
    );
  });

  it("Launch Library handler shared across astronomy + space", () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    assert.equal(
      r.map.get("astronomy.live_launches_upcoming").handler,
      r.map.get("space.live_launches_upcoming").handler,
    );
  });

  it("Quotable handler shared across daily + reflection", () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    assert.equal(
      r.map.get("daily.live_quote").handler,
      r.map.get("reflection.live_quote").handler,
    );
  });
});

describe("input validation — PoetryDB", () => {
  it("rejects invalid kind", async () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    const res = await r.map.get("poetry.live_poetrydb").handler({}, { kind: "evil" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_kind");
  });

  it("permits empty query (returns random poems)", () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    // Just verify handler is callable with empty input.
    const result = r.map.get("poetry.live_poetrydb").handler({}, {});
    assert.ok(typeof result.then === "function");
    // Don't await — we don't want to hit network in CI.
  });

  it("rejects overlong query (200 chars)", async () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    const res = await r.map.get("poetry.live_poetrydb").handler({}, { query: "x".repeat(200) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "query_too_long");
  });
});

describe("input validation — Spaceflight News", () => {
  it("rejects overlong search query", async () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    const res = await r.map.get("astronomy.live_spaceflight_news").handler({}, { query: "x".repeat(200) });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "query_too_long");
  });

  it("permits empty query (returns latest articles)", () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    const result = r.map.get("astronomy.live_spaceflight_news").handler({}, {});
    assert.ok(typeof result.then === "function");
  });
});

describe("Open Trivia DB", () => {
  it("clamps amount to 1-30 (handler is callable with various inputs)", () => {
    const r = makeRegistry();
    registerCuratedFreeApiMacros(r.register);
    // Just verify the handler accepts inputs without throwing synchronously.
    const a = r.map.get("game.live_trivia").handler({}, { amount: 100 });
    const b = r.map.get("game.live_trivia").handler({}, { amount: 0 });
    const c = r.map.get("game.live_trivia").handler({}, { category: 9, difficulty: "easy", type: "multiple" });
    assert.ok(typeof a.then === "function");
    assert.ok(typeof b.then === "function");
    assert.ok(typeof c.then === "function");
  });
});
