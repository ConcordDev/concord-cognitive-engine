// FIX-forge-007 — the Forge template catalogue derived its Languages /
// Categories stats from `language` / `category` fields on the forge.list
// payload, but template entries carried NEITHER field (their sections
// carry the language; categories existed nowhere), so both stats
// rendered a definitive 0 over a full 7-template catalogue.
//
// Pins:
//   - every listed template carries a non-empty `language` projected
//     from the languages of the sections it actually contains, and a
//     non-empty authored `category`;
//   - the catalogue's own derivation (distinct counts over the payload)
//     is non-zero for both stats;
//   - the projected language is honest: it names only languages of
//     sections the template includes.

import { test } from "node:test";
import assert from "node:assert/strict";

import { listForgeTemplates, getForgeTemplateSections } from "../lib/forge-template-generator.js";

test("every template carries a language and a category", () => {
  const templates = listForgeTemplates();
  assert.ok(templates.length >= 6, `expected the base templates, got ${templates.length}`);
  for (const t of templates) {
    assert.ok(typeof t.language === "string" && t.language.length > 0, `${t.id} must carry a projected language`);
    assert.ok(typeof t.category === "string" && t.category.length > 0, `${t.id} must carry a category`);
  }
});

test("the catalogue derivation counts real facets, not 0/0", () => {
  const list = listForgeTemplates();
  const langs = new Set(list.map((t) => t.language).filter(Boolean)).size;
  const cats = new Set(list.map((t) => t.category).filter(Boolean)).size;
  assert.ok(langs >= 1, `Languages stat derivation must be >= 1, got ${langs}`);
  assert.ok(cats >= 2, `Categories stat derivation must cover the template kinds, got ${cats}`);
});

test("projected language names only languages of the template's own sections", () => {
  for (const t of listForgeTemplates()) {
    const sectionLanguages = new Set(getForgeTemplateSections(t.id).map((s) => s.language).filter(Boolean));
    for (const lang of String(t.language).split(",").map((x) => x.trim())) {
      assert.ok(sectionLanguages.has(lang), `${t.id} claims language ${lang} but none of its sections use it`);
    }
  }
});
