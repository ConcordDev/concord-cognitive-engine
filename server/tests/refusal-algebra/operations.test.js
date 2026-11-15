// server/tests/refusal-algebra/operations.test.js
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { add, subtract, multiply, divide, computeBase6Layer, generateDTUSemantic } from "../../lib/refusal-algebra/operations.js";
import { GLYPHS } from "../../lib/refusal-algebra/glyphs.js";
import { refusalGlyphsToDecimal } from "../../lib/refusal-algebra/conversion.js";

describe("Refusal Algebra — Operations", () => {
  it("add(3, 4) = 7, numerical and decimal match", () => {
    const r = add(3, 4);
    assert.equal(r.decimal, 7);
    assert.ok(Math.abs(refusalGlyphsToDecimal(r.numerical) - 7) < 1e-8);
  });

  it("add(0, 0) semantic mentions Refusal", () => {
    const r = add(0, 0);
    assert.ok(r.semantic.toLowerCase().includes("refusal"));
  });

  it("subtract(10, 4) = 6", () => {
    const r = subtract(10, 4);
    assert.equal(r.decimal, 6);
  });

  it("subtract self produces 0 (Refusal glyph)", () => {
    const r = subtract(5, 5);
    assert.equal(r.decimal, 0);
    assert.equal(r.numerical, GLYPHS[0]);
  });

  it("multiply(6, 7) = 42 correct base-6", () => {
    const r = multiply(6, 7);
    assert.equal(r.decimal, 42);
    assert.ok(Math.abs(refusalGlyphsToDecimal(r.numerical) - 42) < 1e-8);
  });

  it("multiply by Refusal (0) semantic mentions absorption", () => {
    const r = multiply(0, 7);
    assert.ok(r.semantic.toLowerCase().includes("refusal"));
    assert.equal(r.decimal, 0);
  });

  it("multiply(2, 2) — Bridge×Bridge semantic mentions Bridge", () => {
    const r = multiply(2, 2);
    assert.ok(r.semantic.toLowerCase().includes("bridge"));
  });

  it("divide(12, 3) = 4", () => {
    const r = divide(12, 3);
    assert.equal(r.decimal, 4);
  });

  it("divide by 0 is undefined — numerical agrees with the semantic (FIX-root-001)", () => {
    const r = divide(5, 0);
    assert.equal(r.numerical, "undefined");
    assert.equal(r.decimal, null);
    assert.ok(r.semantic.toLowerCase().includes("undefined") || r.semantic.toLowerCase().includes("cannot"));
  });

  it("semantic does not change numerical result", () => {
    const r = add(10, 15);
    const check = add(10, 15);
    assert.equal(r.numerical, check.numerical);
    assert.equal(r.decimal, check.decimal);
  });

  it("operations accept glyph strings as input", () => {
    const r = add(GLYPHS[1], GLYPHS[2]); // Pivot + Bridge = 1 + 2 = 3
    assert.equal(r.decimal, 3);
  });

  it("computeBase6Layer returns glyph string for finite numbers", () => {
    const r = computeBase6Layer(36);
    assert.equal(typeof r, "string");
    assert.ok(r.length > 0);
    assert.ok(Math.abs(refusalGlyphsToDecimal(r) - 36) < 1e-8);
  });

  it("computeBase6Layer returns null for non-numeric", () => {
    assert.equal(computeBase6Layer(NaN), null);
    assert.equal(computeBase6Layer(Infinity), null);
  });

  it("generateDTUSemantic returns string for valid number", () => {
    const r = generateDTUSemantic(7);
    assert.equal(typeof r, "string");
    assert.ok(r.includes("7"));
  });

  it("generateDTUSemantic returns null for NaN", () => {
    assert.equal(generateDTUSemantic(NaN), null);
  });
});
