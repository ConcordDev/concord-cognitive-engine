// Wave 8b — the authored-cosmology read surface.
//
// Pins: list/get/facets/spine read the authored canon from source JSON, the
// hidden_truth author-only invariant is enforced (stripped everywhere), the
// newly-locked Pantheon events are present, and filters work.
//
// Run: node --test tests/authored-lore.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  listAuthoredLore, getAuthoredLore, authoredLoreFacets, cosmologySpine, _resetAuthoredLoreCache,
} from "../lib/authored-lore.js";
import registerLoreMacros from "../domains/lore.js";

function registry() {
  const m = new Map();
  registerLoreMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
  return m;
}

describe("Wave 8b — authored lore read", () => {
  it("lists the canon and includes the locked Pantheon events", () => {
    _resetAuthoredLoreCache();
    const all = listAuthoredLore({});
    assert.ok(all.length > 50, `expected the full canon, got ${all.length}`);
    const ids = new Set(all.map((e) => e.id));
    assert.ok(ids.has("lore_the_concord_link"), "The Concord Link must be present");
    assert.ok(ids.has("lore_first_thought"), "Concord (First Law) must be present");
    assert.ok(ids.has("fantasy_the_unwatched_realm"), "Fantasy vacation-world event must be present");
  });

  it("STRIPS hidden_truth everywhere (author-only invariant)", () => {
    const all = listAuthoredLore({});
    for (const e of all) {
      assert.equal("hidden_truth" in e, false, `hidden_truth leaked on ${e.id}`);
    }
    // The Great Purge HAS a hidden_truth in source — confirm get() also strips it.
    const purge = getAuthoredLore("lore_great_purge");
    assert.ok(purge, "great_purge resolvable");
    assert.equal("hidden_truth" in purge, false, "get() must strip hidden_truth");
    // and the secret string itself must not appear in the served description.
    assert.equal(/price-fixing collusion/.test(JSON.stringify(purge)), false);
  });

  it("filters by world + type", () => {
    const fantasy = listAuthoredLore({ worldId: "fantasy" });
    assert.ok(fantasy.length > 0 && fantasy.every((e) => e.world_id === "fantasy"));
    const primordial = listAuthoredLore({ type: "primordial" });
    assert.ok(primordial.length > 0 && primordial.every((e) => e.type === "primordial"));
  });

  it("facets + spine surface the cosmology", () => {
    const f = authoredLoreFacets();
    assert.ok(f.count > 50 && f.types.includes("primordial") && f.worlds.includes("fantasy"));
    const spine = cosmologySpine();
    const spineIds = new Set(spine.map((e) => e.id));
    assert.ok(spineIds.has("lore_first_refusal") && spineIds.has("lore_the_concord_link"));
  });

  it("macros: lore.list / get / facets / spine", async () => {
    const reg = registry();
    const list = await reg.get("lore.list")({}, { type: "primordial" });
    assert.equal(list.ok, true);
    assert.ok(list.events.length > 0);
    const get = await reg.get("lore.get")({}, { id: "lore_the_concord_link" });
    assert.equal(get.ok, true);
    assert.equal("hidden_truth" in get.event, false);
    const bad = await reg.get("lore.get")({}, { id: "nope" });
    assert.equal(bad.ok, false);
    assert.equal((await reg.get("lore.facets")({}, {})).ok, true);
    assert.equal((await reg.get("lore.spine")({}, {})).ok, true);
  });
});
