// tests/food-recipe-keep.test.js — REAL end-to-end proof for the Food lens
// keep-and-draft workflow. Mirrors the established pattern: create a real
// recipe via `recipe-add`, read it back via `recipe-list`, save it as a
// private DTU via `dtu.create`, read that DTU back via `dtu.get`, then draft
// it in Thread via `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("food recipe keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("food-keep-proof"); });

  it("creates a real recipe, lists it, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real recipe via the food domain macro.
    const created = await lensRun("food", "recipe-add", {
      params: {
        title: "Proof Carbonara",
        slot: "Dinner",
        servings: 4,
        calories: 580,
        protein: 22,
        carbs: 65,
        fat: 24,
        tags: ["pasta", "italian"],
        ingredients: [
          { item: "Spaghetti", qty: 400, unit: "g" },
          { item: "Eggs", qty: 3, unit: "item" },
        ],
      },
    }, ctx);
    assert.equal(created.ok, true, "recipe-add should succeed");
    const recId = created.result.recipe.id;
    assert.ok(recId, "recipe should have an id");

    // 2. Read the real recipe list (the same macro the UI uses).
    const listed = await lensRun("food", "recipe-list", {}, ctx);
    assert.equal(listed.ok, true, "recipe-list should succeed");
    const recipe = listed.result.recipes.find((r) => r.id === recId);
    assert.ok(recipe, "recipe-list should contain the created recipe");
    assert.equal(recipe.title, "Proof Carbonara");
    assert.equal(recipe.servings, 4);
    assert.equal(recipe.calories, 580);

    // 3. Save the recipe as a private DTU.
    const sentence = `Proof Carbonara · Dinner: 4 servings, 580 kcal/serving, 22g protein, 65g carbs, 24g fat.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["food", "recipe", "dinner"],
        source: "food-lens:recipe-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "food_recipe_report",
          recipeId: recId,
          title: "Proof Carbonara",
          slot: "Dinner",
          servings: 4,
          calories: 580,
          protein: 22,
          carbs: 65,
          fat: 24,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "food" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 4. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 5. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Food recipe — Proof Carbonara",
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 6. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to add a recipe without a title", async () => {
    const r = await lensRun("food", "recipe-add", { params: { title: "", servings: 2 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "title required");
  });
});