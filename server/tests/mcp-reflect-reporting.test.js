/**
 * Reflect reporting fix — behaviour tests (MCP lane spec
 * reflect-reporting-fix-spec-2026-10-28; lane acceptance is the post-ship
 * scoped sweep, these tests pin the same invariants in-repo).
 *
 * reflect_search: the match total is computed BEFORE the page slice.
 * `count` means the match total (= totalMatches); the page size is
 * `returned`; `truncated` says whether the page is the whole match set.
 * Test case of record (lane Addendum 1): Timeline's inventory — 21 macros
 * at limit 60 vs the 20-result default page that used to hide the 21st.
 *
 * reflect_stats: parts (macros/exports/routes) are PRE-cap discovery
 * counts; generatedTotal (with `total` as its deprecated alias) is the
 * POST-cap, post-dedup generation count; `cap` is the cap the reflection
 * pass actually ran with; capped == (discoveredTotal > generatedTotal).
 *
 * Run: node --test server/tests/mcp-reflect-reporting.test.js
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { MCP_TOOLS, reflectSearch, reflectStats } from "../lib/mcp-tools.js";
import { REFLECTED_TOOLS, getReflectionStats, reflectMacros } from "../lib/macro-reflection.js";

function toolDef(name) {
  const t = MCP_TOOLS.find((x) => x.name === name);
  assert.ok(t, `${name} definition exists`);
  return t;
}

describe("reflect_search reporting", () => {
  it("Timeline case of record: default page truncates and says so; limit 60 returns the whole set", async () => {
    const page = await reflectSearch(null, { query: "macro.timeline" });
    assert.equal(page.ok, true);
    assert.equal(page.returned, 20, "default page is 20");
    assert.ok(page.totalMatches > 20, `totalMatches (${page.totalMatches}) exceeds the default page`);
    assert.equal(page.count, page.totalMatches, "count means the match total");
    assert.equal(page.truncated, true);

    const full = await reflectSearch(null, { query: "macro.timeline", limit: 60 });
    assert.equal(full.ok, true);
    assert.ok(full.totalMatches >= 21, `Timeline inventory is at least 21 macros (got ${full.totalMatches})`);
    assert.equal(full.returned, full.totalMatches, "limit 60 returns every match");
    assert.equal(full.count, full.totalMatches);
    assert.equal(full.truncated, false);
    assert.ok(full.matches.some((m) => m.name === "macro.timeline.post-delete"), "the 21st macro (post-delete) is in the full set");
  });

  it("a synthetic >limit match set reports totalMatches > returned and truncated:true", async () => {
    const probe = [];
    for (let i = 0; i < 25; i++) {
      probe.push({
        name: `macro.b11probe.item${String(i).padStart(2, "0")}`,
        description: "b11probe synthetic reflected tool",
        _meta: { file: "b11probe.js", domain: "b11probe", kind: "macro" },
      });
    }
    REFLECTED_TOOLS.push(...probe);
    try {
      const page = await reflectSearch(null, { query: "b11probe" });
      assert.equal(page.returned, 20);
      assert.equal(page.totalMatches, 25);
      assert.equal(page.count, 25);
      assert.equal(page.truncated, true);

      const all = await reflectSearch(null, { query: "b11probe", limit: 100 });
      assert.equal(all.returned, 25);
      assert.equal(all.totalMatches, 25);
      assert.equal(all.truncated, false);
    } finally {
      for (const p of probe) {
        const idx = REFLECTED_TOOLS.indexOf(p);
        if (idx >= 0) REFLECTED_TOOLS.splice(idx, 1);
      }
    }
  });

  it("description and schema state the default and maximum, and carry no hard-coded count", () => {
    const def = toolDef("reflect_search");
    assert.match(def.description, /defaults to 20/);
    assert.match(def.description, /maximum 100/);
    assert.ok(!/\d[\d,]*\+/.test(def.description), "no hard-coded count figure in the description");
    const limit = def.inputSchema.properties.limit;
    assert.ok(limit, "limit is in the inputSchema");
    assert.match(limit.description, /default 20/);
    assert.match(limit.description, /max 100/);
  });
});

describe("reflect_stats reporting", () => {
  it("boot-pass invariants: parts sum, alias, capped flag, cap, registrySize", async () => {
    const s = await reflectStats(null, {});
    assert.equal(s.ok, true);
    assert.equal(s.macros + s.exports + s.routes, s.discoveredTotal, "parts sum == discoveredTotal");
    assert.equal(s.total, s.generatedTotal, "total == generatedTotal (deprecated alias)");
    assert.equal(s.capped, s.discoveredTotal > s.generatedTotal, "capped == (discoveredTotal > generatedTotal)");
    assert.equal(s.cap, 20000, "cap is the boot-pass config value mcp-tools runs with");
    assert.equal(s.generatedTotal, REFLECTED_TOOLS.length, "generatedTotal is the generated tool count");
    assert.ok(Number.isInteger(s.registrySize) && s.registrySize > 0, "registrySize present (distinct macro domains in the registry)");
    assert.match(s.note, /pre-cap/);
    assert.match(s.note, /post-cap/);
  });

  it("reflect_stats description states every denominator and carries no hard-coded count", () => {
    const def = toolDef("reflect_stats");
    assert.match(def.description, /pre-cap/);
    assert.match(def.description, /post-cap/);
    assert.match(def.description, /deprecated alias/);
    assert.match(def.description, /distinct macro domains/);
    assert.ok(!/\d[\d,]*\+/.test(def.description), "no hard-coded count figure in the description");
  });

  it("cap is read from the pass config, not hard-coded: a small-cap pass reports its own cap", async () => {
    try {
      await reflectMacros({ maxTools: 5, includeExports: true, includeRoutes: false });
      const s = getReflectionStats();
      assert.equal(s.cap, 5, "cap follows the maxTools the pass ran with");
      assert.equal(s.generatedTotal, REFLECTED_TOOLS.length);
      assert.ok(s.generatedTotal <= 5);
      assert.equal(s.macros + s.exports + s.routes, s.discoveredTotal);
      assert.equal(s.capped, s.discoveredTotal > s.generatedTotal);
      assert.equal(s.capped, true, "discovery far exceeds a 5-tool cap");
    } finally {
      // Restore the boot-shaped pass so no later test in this process sees
      // the 5-tool registry.
      await reflectMacros({ maxTools: 20000, includeExports: true, includeRoutes: true });
    }
  });

  after(async () => {
    const s = getReflectionStats();
    assert.equal(s.cap, 20000, "boot-shaped pass restored");
  });
});
