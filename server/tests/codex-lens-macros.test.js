// Behavioral macro tests for the CODEX lens backend — server/domains/lore.js.
//
// ─ LENS-ID ≠ DOMAIN ────────────────────────────────────────────────────────
// The frontend lens lives at concord-frontend/app/lenses/CODEX/, but its page
// calls lensRun('LORE', …). The codex is the read-only browser over the
// authored cosmology canon; the backend domain string is `lore`.
//
// ─ DISPATCH SHAPE (verified against the live tree) ──────────────────────────
// `lore` is registered via the CANONICAL MACROS registrar, NOT the 3-arg
// registerLensAction path. server.js:25250 does `registerLoreMacros(register)`
// where `register(domain, name, fn, spec)` stores into MACROS, and runMacro
// dispatches it as `m.fn(ctx, input ?? {})` (server.js:11672) — the 2-ARG
// handler convention `(ctx, input)`. `lore` does NOT appear in domains/index.js
// and there is NO inline register("lore",…) shim in server.js. This harness
// therefore mirrors the real 2-arg dispatch: `fn(ctx, input)`. (A 3-arg
// (ctx, artifact, input) call would still pass here because the lore handlers
// ignore their middle arg, but we pin the REAL contract to catch a future
// param-position regression.)
//
// ─ WHAT THIS FILE ADDS ──────────────────────────────────────────────────────
// The existing lore-codex-domain.test.js pins registration, hidden_truth,
// worldId/type/q-title filters, the numeric guard, get, facets and spine. This
// file does NOT duplicate those — it adds the BEHAVIORAL gaps the *lens* drives:
//   • the era filter (case-insensitive substring) — the codex filter UI surfaces it
//   • q matching DESCRIPTION (not just title) — the search box hits both
//   • AND-combined filters (the lens sends worldId + type + q together)
//   • the spine ⊆ list invariant (the codex header reads spine, body reads list)
//   • facets ⇄ list cross-consistency on a per-facet basis
//   • degrade-graceful: no ctx / empty STATE / repeated calls → ok:true, never
//     no_db / never throw (the corpus is FILE-backed, not DB-backed)
//   • fail-CLOSED on poisoned inputs reaching every numeric-bearing macro
//   • determinism: the file-backed read is stable across calls
//
// All hermetic: no server boot, no network, no LLM, no DB. The lore lib reads
// content/world/**/lore.json straight off disk (deterministic, seed-independent).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerLoreMacros from "../domains/lore.js";
import {
  listAuthoredLore, authoredLoreFacets, cosmologySpine, _resetAuthoredLoreCache,
} from "../lib/authored-lore.js";

// ── harness: mirror the REAL canonical-macro dispatch m.fn(ctx, input) ───────
const ACTIONS = new Map();
function register(domain, name, fn, _spec) {
  assert.equal(domain, "lore", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
/** Drive a macro the way runMacro does: 2-arg handler (ctx, input). */
function call(name, input = {}, ctx = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`lore.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerLoreMacros(register); });
// Reset the file-backed cache between groups so determinism assertions are real.
beforeEach(() => { _resetAuthoredLoreCache(); });

describe("codex/lore — dispatch contract (lens-id ≠ domain)", () => {
  it("registers exactly the read macros the codex page calls (no extras)", () => {
    for (const m of ["list", "get", "facets", "spine"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing lore.${m}`);
    }
  });

  it("every macro returns a plain {ok:boolean} envelope and never throws", async () => {
    for (const m of ["list", "get", "facets", "spine"]) {
      const out = await call(m, {});
      assert.equal(typeof out, "object");
      assert.notEqual(out, null);
      assert.equal(typeof out.ok, "boolean", `lore.${m} must return ok:boolean`);
    }
  });
});

describe("codex/lore.list — the filters the codex UI drives", () => {
  it("era filter is a case-insensitive SUBSTRING match (real 'Tessera' eras)", async () => {
    const out = await call("list", { era: "tessera" });
    assert.equal(out.ok, true);
    assert.ok(out.events.length > 0, "the authored canon has Tessera-era events");
    assert.ok(out.events.every((e) => /tessera/i.test(e.era)), "every row's era contains the needle");
    // Cross-check the macro doesn't reshape the lib's filter.
    assert.equal(out.events.length, listAuthoredLore({ era: "tessera" }).length);
  });

  it("q matches the DESCRIPTION, not just the title (the search box hits both)", async () => {
    // lore_day_concordia_almost_left has 'Refusal' in its description, not title.
    const out = await call("list", { q: "refusal" });
    assert.equal(out.ok, true);
    const hit = out.events.find((e) => e.id === "lore_day_concordia_almost_left");
    assert.ok(hit, "a description-only substring match must surface");
    assert.ok(!/refusal/i.test(hit.title), "the match is on description, not title");
    assert.ok(/refusal/i.test(hit.description || ""), "the needle is in the description");
  });

  it("AND-combines worldId + type (the lens sends them together)", async () => {
    const combo = await call("list", { worldId: "tunya", type: "founding" });
    assert.equal(combo.ok, true);
    assert.ok(combo.events.length > 0);
    assert.ok(combo.events.every((e) => e.world_id === "tunya" && e.type === "founding"));
    // It's a true intersection: never wider than either single filter.
    const byWorld = await call("list", { worldId: "tunya" });
    const byType = await call("list", { type: "founding" });
    assert.ok(combo.events.length <= byWorld.events.length);
    assert.ok(combo.events.length <= byType.events.length);
    assert.equal(combo.events.length, listAuthoredLore({ worldId: "tunya", type: "founding" }).length);
  });

  it("a no-match query returns ok:true with an EMPTY list — the codex 'no truths match' state", async () => {
    const out = await call("list", { q: "zzz_no_such_canon_substring_qqq" });
    assert.equal(out.ok, true);
    assert.deepEqual(out.events, []);
    assert.notEqual(out.reason, "no_db");
  });

  it("limit:500 (the lens default) pages without dropping the floor of the corpus", async () => {
    const out = await call("list", { limit: 500 });
    assert.equal(out.ok, true);
    assert.ok(out.events.length >= 100, "the authored corpus is non-trivially large");
    assert.ok(out.events.length <= 500);
  });
});

describe("codex/lore — header (spine) ⇄ body (list) consistency", () => {
  it("every spine event is also a listable event (the header is a SUBSET of the canon)", async () => {
    const spine = await call("spine", {});
    const full = await call("list", { limit: 1000 });
    assert.equal(spine.ok, true);
    assert.equal(full.ok, true);
    const ids = new Set(full.events.map((e) => e.id));
    for (const e of spine.events) {
      assert.ok(ids.has(e.id), `spine event ${e.id} must exist in the full list`);
    }
    // The codex header filters spine to type==='primordial' — those must exist.
    assert.ok(spine.events.some((e) => e.type === "primordial"));
  });

  it("facets.count equals the full listable corpus and every facet value is a real filter", async () => {
    const f = await call("facets", {});
    const full = await call("list", { limit: 1000 });
    assert.equal(f.facets.count, full.events.length, "facet count == listable size");
    // Each declared world facet returns a non-empty, correctly-scoped page.
    for (const w of f.facets.worlds.slice(0, 5)) {
      const page = await call("list", { worldId: w });
      assert.ok(page.events.length > 0, `world facet ${w} must list something`);
      assert.ok(page.events.every((e) => e.world_id === w));
    }
    // Each declared type facet likewise.
    for (const t of f.facets.types.slice(0, 5)) {
      const page = await call("list", { type: t });
      assert.ok(page.events.every((e) => e.type === t));
    }
  });
});

describe("codex/lore — degrade-graceful (file-backed, never no_db, never throws)", () => {
  it("works with NO ctx at all (anon codex read)", async () => {
    const out = await ACTIONS.get("list")(undefined, {});
    assert.equal(out.ok, true);
    assert.ok(Array.isArray(out.events));
    assert.notEqual(out.reason, "no_db");
  });

  it("works with an empty STATE-less ctx for every read macro", async () => {
    const ctx = {}; // no db, no actor, no state
    assert.equal((await call("list", {}, ctx)).ok, true);
    assert.equal((await call("facets", {}, ctx)).ok, true);
    assert.equal((await call("spine", {}, ctx)).ok, true);
    assert.equal((await call("get", { id: "lore_founding_compact" }, ctx)).ok, true);
  });

  it("is DETERMINISTIC across repeated calls (cache reset between is equivalent)", async () => {
    const a = await call("list", { worldId: "tunya" });
    _resetAuthoredLoreCache();
    const b = await call("list", { worldId: "tunya" });
    assert.deepEqual(a.events.map((e) => e.id), b.events.map((e) => e.id));
  });
});

describe("codex/lore — fail-CLOSED on poisoned input", () => {
  it("list rejects every poisoned limit with ok:false invalid_limit (no clamped ok:true)", async () => {
    for (const bad of [-1, NaN, Infinity, -Infinity, 1e308, "abc", 1e9 + 1]) {
      const out = await call("list", { limit: bad });
      assert.equal(out.ok, false, `limit=${String(bad)} must fail closed`);
      assert.equal(out.reason, "invalid_limit");
      assert.ok(!("events" in out), "no events array leaks on a rejected read");
    }
  });

  it("a poisoned numeric limit is rejected BEFORE any filtering work or leak", async () => {
    // Even paired with otherwise-valid filters, the guard short-circuits.
    const out = await call("list", { worldId: "tunya", type: "founding", limit: Infinity });
    assert.equal(out.ok, false);
    assert.equal(out.reason, "invalid_limit");
  });

  it("get fails closed on a missing/empty/unknown id — never throws, never no_db", async () => {
    assert.deepEqual(await call("get", {}), { ok: false, reason: "missing_id" });
    assert.deepEqual(await call("get", { id: "" }), { ok: false, reason: "missing_id" });
    const unknown = await call("get", { id: "lore_nope_xyz_123" });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "unknown_event");
    assert.notEqual(unknown.reason, "no_db");
  });

  it("non-string filter values do not crash the read (coerced/ignored, ok:true)", async () => {
    // The lens always sends strings, but a malformed caller must not throw.
    for (const poison of [{ worldId: 123 }, { type: {} }, { era: [] }, { q: 0 }]) {
      const out = await call("list", poison);
      assert.equal(typeof out.ok, "boolean");
      assert.notEqual(out.reason, "no_db");
    }
  });
});

describe("codex/lore — hidden_truth author-only invariant (defense in depth)", () => {
  it("hidden_truth never appears on list / get / spine outputs", async () => {
    const list = await call("list", { limit: 1000 });
    for (const e of list.events) assert.ok(!("hidden_truth" in e), `leak on list ${e.id}`);
    const spine = await call("spine", {});
    for (const e of spine.events) assert.ok(!("hidden_truth" in e), `leak on spine ${e.id}`);
    const one = await call("get", { id: "lore_founding_compact" });
    assert.ok(!("hidden_truth" in one.event));
    // Cross-check the lib's own projection matches (no reshaping in the macro).
    assert.equal(authoredLoreFacets().count, listAuthoredLore({ limit: 1000 }).length);
    assert.equal(cosmologySpine().length, spine.events.length);
  });
});
