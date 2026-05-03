// Tests for recipe DTU validators.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  validateFightingStyleRecipe,
  validateSpellRecipe,
  validateBlueprint,
  validateRecipeByType,
  PERSONAL_DEFAULT_RECIPE_TYPES,
} from "../lib/dtu-validators/recipe-validators.js";

describe("recipe validators", () => {
  describe("fighting_style_recipe", () => {
    test("accepts a minimal valid recipe", () => {
      const r = validateFightingStyleRecipe({
        moves: [{ comboId: "c1" }],
        stance: "boxer",
      });
      assert.equal(r.ok, true);
    });

    test("rejects empty moves", () => {
      const r = validateFightingStyleRecipe({ moves: [], stance: "boxer" });
      assert.equal(r.ok, false);
      assert.match(r.error, /moves_required/);
    });

    test("rejects move missing comboId", () => {
      const r = validateFightingStyleRecipe({ moves: [{}], stance: "boxer" });
      assert.equal(r.ok, false);
    });

    test("rejects unknown control scheme", () => {
      const r = validateFightingStyleRecipe({
        moves: [{ comboId: "c1" }],
        stance: "boxer",
        controlScheme: "made_up",
      });
      assert.equal(r.ok, false);
      assert.match(r.error, /controlScheme/);
    });
  });

  describe("spell_recipe", () => {
    test("accepts a minimal valid recipe", () => {
      const r = validateSpellRecipe({
        formula: "fire+arcane",
        costs: { mana: 30 },
        range: "mid",
        targetType: "single",
      });
      assert.equal(r.ok, true);
    });

    test("rejects negative cost", () => {
      const r = validateSpellRecipe({
        formula: "f",
        costs: { mana: -1 },
        range: "mid",
        targetType: "single",
      });
      assert.equal(r.ok, false);
    });

    test("rejects unknown range", () => {
      const r = validateSpellRecipe({
        formula: "f",
        costs: { mana: 5 },
        range: "outerspace",
        targetType: "single",
      });
      assert.equal(r.ok, false);
    });
  });

  describe("blueprint", () => {
    test("accepts a minimal valid blueprint", () => {
      const r = validateBlueprint({
        kind: "building",
        dimensions: { x: 10, y: 5, z: 10 },
        materials: [{ resource: "wood", qty: 50 }],
      });
      assert.equal(r.ok, true);
    });

    test("rejects zero dimension", () => {
      const r = validateBlueprint({
        kind: "building",
        dimensions: { x: 0, y: 5, z: 10 },
        materials: [{ resource: "wood", qty: 50 }],
      });
      assert.equal(r.ok, false);
    });

    test("rejects unknown kind", () => {
      const r = validateBlueprint({
        kind: "spaceship",
        dimensions: { x: 1, y: 1, z: 1 },
        materials: [{ resource: "wood", qty: 1 }],
      });
      assert.equal(r.ok, false);
    });
  });

  describe("validateRecipeByType dispatch", () => {
    test("passes through unknown types", () => {
      assert.equal(validateRecipeByType("not_a_recipe", {}).ok, true);
    });

    test("dispatches to spell validator", () => {
      const r = validateRecipeByType("spell_recipe", { formula: "f" });
      assert.equal(r.ok, false);
    });
  });

  test("PERSONAL_DEFAULT_RECIPE_TYPES contains all three", () => {
    assert.equal(PERSONAL_DEFAULT_RECIPE_TYPES.has("fighting_style_recipe"), true);
    assert.equal(PERSONAL_DEFAULT_RECIPE_TYPES.has("spell_recipe"), true);
    assert.equal(PERSONAL_DEFAULT_RECIPE_TYPES.has("blueprint"), true);
  });
});
