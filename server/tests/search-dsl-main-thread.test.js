// /api/search/dsl → search.query must not be offloaded to the worker pool,
// whose isolated search has no visibility filter and a stale snapshot.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isHeavy } from "../workers/macro-pool.js";

describe("search.query runs on the main thread", () => {
  it("search.query and search.semantic are light overrides", () => {
    assert.equal(isHeavy("search", "query"), false);
    assert.equal(isHeavy("search", "semantic"), false);
  });
  it("other heavy domains are unchanged", () => {
    assert.equal(isHeavy("system", "autogen"), true);
    assert.equal(isHeavy("dtu", "get"), false);
  });
});
