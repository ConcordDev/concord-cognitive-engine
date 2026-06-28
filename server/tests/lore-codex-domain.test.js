// Behavioral macro tests for server/domains/lore.js — the authored-cosmology
// READ surface the Codex lens (concord-frontend/app/lenses/codex) drives.
//
// The lore lib (lib/authored-lore.js) reads the hand-authored content/world/**
// lore.json files straight off disk (deterministic, seed-independent), so NO DB
// boot is needed here — we drive each registered macro the way runMacro would
// (a (ctx, input) call) against the REAL authored content. These are NOT
// shape-only assertions: every test pins ACTUAL values (real entry ids, the
// real facet counts, the cosmology spine), the hidden_truth author-only
// invariant, AND the fail-CLOSED numeric guard the macro-assassin's V2 vectors
// probe.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerLoreMacros from "../domains/lore.js";
import {
  authoredLoreFacets, cosmologySpine, listAuthoredLore,
} from "../lib/authored-lore.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "lore", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, input = {}, ctx = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`lore.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerLoreMacros(register); });

describe("lore — registration", () => {
  it("registers every macro the codex lens calls", () => {
    for (const m of ["list", "get", "facets", "spine"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing lore.${m}`);
    }
  });
});

describe("lore.list — returns the real seeded canon", () => {
  it("an unfiltered read returns the authored events", async () => {
    const out = await call("list", {});
    assert.equal(out.ok, true);
    assert.ok(Array.isArray(out.events));
    // The authored corpus is non-trivially large (167+ events at HEAD; assert a
    // conservative floor so the test survives new authored worlds being added).
    assert.ok(out.events.length >= 100, `expected >=100 events, got ${out.events.length}`);
    // The lib caps at its default 500.
    assert.ok(out.events.length <= 500);
  });

  it("surfaces the founding-compact anchor event with its real fields", async () => {
    const out = await call("list", {});
    const compact = out.events.find((e) => e.id === "lore_founding_compact");
    assert.ok(compact, "the Founding Compact anchor event must be present");
    assert.equal(compact.title, "The Founding Compact");
    assert.equal(compact.type, "founding");
    assert.equal(typeof compact.description, "string");
    assert.ok(compact.description.length > 0);
  });

  it("NEVER leaks hidden_truth (author-only invariant)", async () => {
    const out = await call("list", { limit: 500 });
    for (const e of out.events) {
      assert.ok(!("hidden_truth" in e), `hidden_truth leaked on ${e.id}`);
    }
  });

  it("worldId filter narrows to that world (real tunya count)", async () => {
    const all = await call("list", {});
    const tunya = await call("list", { worldId: "tunya" });
    assert.equal(tunya.ok, true);
    assert.ok(tunya.events.length > 0);
    assert.ok(tunya.events.length < all.events.length);
    assert.ok(tunya.events.every((e) => e.world_id === "tunya"));
    // Cross-check against the lib directly — the macro must not reshape the data.
    assert.equal(tunya.events.length, listAuthoredLore({ worldId: "tunya" }).length);
  });

  it("type filter narrows to that kind (primordial)", async () => {
    const prim = await call("list", { type: "primordial" });
    assert.equal(prim.ok, true);
    assert.ok(prim.events.length > 0);
    assert.ok(prim.events.every((e) => e.type === "primordial"));
  });

  it("q filter matches title/description substring", async () => {
    const hits = await call("list", { q: "compact" });
    assert.equal(hits.ok, true);
    assert.ok(hits.events.some((e) => e.id === "lore_founding_compact"));
  });

  it("limit bounds the page size to the requested count", async () => {
    const two = await call("list", { limit: 2 });
    assert.equal(two.ok, true);
    assert.equal(two.events.length, 2);
  });

  it("FAIL-CLOSED on a poisoned numeric limit (never a clamped ok:true)", async () => {
    for (const bad of [-1, NaN, Infinity, 1e308, "abc"]) {
      const out = await call("list", { limit: bad });
      assert.equal(out.ok, false, `limit=${String(bad)} must fail closed`);
      assert.equal(out.reason, "invalid_limit");
    }
  });

  it("an empty input ({}) returns ok:true with rows (live-content reality)", async () => {
    const out = await call("list", {});
    assert.equal(out.ok, true);
    assert.notEqual(out.reason, "no_db");
  });
});

describe("lore.get — single authored event by id", () => {
  it("resolves a real id and strips hidden_truth", async () => {
    const out = await call("get", { id: "lore_founding_compact" });
    assert.equal(out.ok, true);
    assert.equal(out.event.id, "lore_founding_compact");
    assert.ok(!("hidden_truth" in out.event));
  });

  it("missing id → ok:false missing_id", async () => {
    const out = await call("get", {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "missing_id");
  });

  it("unknown id → ok:false unknown_event", async () => {
    const out = await call("get", { id: "lore_does_not_exist_xyz" });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "unknown_event");
  });
});

describe("lore.facets — aggregates real distinct values + count", () => {
  it("returns sorted distinct worlds/types/eras + a true count", async () => {
    const out = await call("facets", {});
    assert.equal(out.ok, true);
    const f = out.facets;
    assert.ok(Array.isArray(f.worlds) && f.worlds.length > 0);
    assert.ok(Array.isArray(f.types) && f.types.length > 0);
    assert.ok(Array.isArray(f.eras));
    assert.equal(typeof f.count, "number");

    // The count must equal the total listable corpus (the macro aggregates the
    // SAME events the list macro pages over — no double-count, no drift).
    const everything = await call("list", { limit: 1000 });
    assert.equal(f.count, everything.events.length);

    // Sorted + de-duplicated — assert against the lib to pin the contract.
    const libFacets = authoredLoreFacets();
    assert.deepEqual(f.worlds, libFacets.worlds);
    assert.deepEqual(f.types, libFacets.types);
    assert.ok(f.worlds.includes("tunya"));
  });
});

describe("lore.spine — the real cosmology narrative spine", () => {
  it("returns the Pillars/founding/great_refusal events only", async () => {
    const out = await call("spine", {});
    assert.equal(out.ok, true);
    assert.ok(Array.isArray(out.events));
    assert.ok(out.events.length > 0);
    const kinds = new Set(out.events.map((e) => e.type));
    for (const k of kinds) {
      assert.ok(
        ["primordial", "great_refusal", "founding"].includes(k),
        `spine should not include type=${k}`,
      );
    }
    // The codex header filters this to `primordial` — assert the Pillars exist.
    assert.ok(out.events.some((e) => e.type === "primordial"));
    // Cross-check the macro against the lib so the spine isn't reshaped.
    assert.equal(out.events.length, cosmologySpine().length);
    // hidden_truth never reaches the spine either.
    for (const e of out.events) assert.ok(!("hidden_truth" in e));
  });
});
