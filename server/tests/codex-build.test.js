// Codex build (S-CDX-1) — the fragment kind at the authored-lore
// projection. Drives the real lib over the repo's content/world files:
// the canon's counts and its incomplete tail are exact, known values.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  listAuthoredLore, getAuthoredLore, authoredLoreFacets, cosmologySpine,
} from "../lib/authored-lore.js";

test("the canon counts stand: 168 entries across 22 worlds", () => {
  const all = listAuthoredLore({ limit: 1000 });
  assert.equal(all.length, 168);
  assert.equal(authoredLoreFacets().worlds.length, 22);
  assert.equal(authoredLoreFacets().count, 168);
});

test("kind-less entries project as fragments, and only those", () => {
  const fragments = listAuthoredLore({ type: "fragment", limit: 1000 });
  assert.equal(fragments.length, 18);
  assert.ok(fragments.every((e) => !e.description || !String(e.description).trim()));
  assert.equal(getAuthoredLore("aekon_ice_oath").type, "fragment"); // "The Ice Oath"
  // a fully authored entry keeps its own kind
  assert.equal(getAuthoredLore("lore_first_thought").type, "primordial");
});

test("the facets carry no blank kind — the fragment bucket is labelled", () => {
  const { types } = authoredLoreFacets();
  assert.ok(types.every((t) => typeof t === "string" && t.length > 0));
  assert.ok(types.includes("fragment"));
});

test("the three pillars stand in the spine by id", () => {
  const ids = new Set(cosmologySpine().map((e) => e.id));
  for (const id of ["lore_first_thought", "lore_first_breath", "lore_first_refusal"]) {
    assert.ok(ids.has(id), `${id} missing from the spine`);
  }
});
