// server/lib/refusal-algebra/operations.js
// Arithmetic operations on base-6 glyph values with semantic layer generation.

import { GLYPHS, GLYPH_NAMES } from "./glyphs.js";
import { decimalToRefusalGlyphs, refusalGlyphsToDecimal } from "./conversion.js";

/**
 * Normalize input: accept glyph string or decimal number, return { glyph, decimal }.
 */
function normalize(v) {
  if (typeof v === "string") {
    return { glyph: v, decimal: refusalGlyphsToDecimal(v) };
  }
  return { glyph: decimalToRefusalGlyphs(v), decimal: v };
}

/**
 * Get a human-readable glyph name (single or compound).
 */
function glyphName(glyph) {
  return GLYPH_NAMES[glyph] || "compound";
}

/**
 * Generate a semantic reading for an operation result.
 * Pattern matches on operand glyphs to produce philosophical readings.
 */
function generateSemantic(operation, aGlyph, bGlyph, result) {
  // Guard against non-finite results before converting to glyphs
  if (!isFinite(result)) {
    if (operation === "divide") return "Division by Refusal is undefined; the structure cannot resolve";
    return `${glyphName(aGlyph)} ${operation} ${glyphName(bGlyph)} produces a non-finite transformation`;
  }

  const rGlyph = decimalToRefusalGlyphs(result);

  // Specific pattern rules (ordered by specificity)
  if (operation === "multiply") {
    if (aGlyph === GLYPHS[0] || bGlyph === GLYPHS[0]) {
      return "Refusal absorbs the operation; result returns to Refusal";
    }
    if (aGlyph === GLYPHS[1] && bGlyph === GLYPHS[1]) {
      return "Pivot meeting Pivot produces Bridge; motion through motion becomes connection";
    }
    if (aGlyph === GLYPHS[2] && bGlyph === GLYPHS[2]) {
      return "Bridge meeting itself produces directed motion at next scale";
    }
    if (aGlyph === GLYPHS[2] || bGlyph === GLYPHS[2]) {
      return `Bridge mediates the operation; ${glyphName(rGlyph)} emerges as a crossing point`;
    }
  }

  if (operation === "add") {
    if (aGlyph === GLYPHS[0] && bGlyph === GLYPHS[0]) {
      return "Refusal added to Refusal remains Refusal; the null state persists";
    }
    if (aGlyph === GLYPHS[0]) {
      return `Refusal yields to ${glyphName(bGlyph)}; the operation begins with absence`;
    }
    if (bGlyph === GLYPHS[0]) {
      return `${glyphName(aGlyph)} encounters Refusal; the state is preserved unchanged`;
    }
    if (aGlyph === GLYPHS[1] && bGlyph === GLYPHS[2]) {
      return "Pivot and Bridge combine; motion and connection produce compound transformation";
    }
  }

  if (operation === "subtract") {
    if (result === 0) return "Subtraction returns to origin; the states cancel into Refusal";
    if (result < 0) return `${glyphName(aGlyph)} subtracted from ${glyphName(bGlyph)} inverts the structure`;
  }

  if (operation === "divide") {
    if (!isFinite(result)) return "Division by Refusal is undefined; the structure cannot resolve";
  }

  // General pattern
  const aName = glyphName(aGlyph);
  const bName = glyphName(bGlyph);
  const rName = glyphName(rGlyph);
  return `${aName} ${operation} ${bName} produces ${rName} — a structural transformation`;
}

/**
 * @typedef {Object} AlgebraResult
 * @property {string} numerical - Result in base-6 glyph notation
 * @property {number} decimal - Result in decimal
 * @property {string} semantic - Philosophical reading of the operation
 */

/**
 * @param {string|number} a
 * @param {string|number} b
 * @returns {AlgebraResult}
 */
export function add(a, b) {
  const { glyph: aG, decimal: aD } = normalize(a);
  const { glyph: bG, decimal: bD } = normalize(b);
  const sum = aD + bD;
  return { numerical: decimalToRefusalGlyphs(sum), decimal: sum, semantic: generateSemantic("add", aG, bG, sum) };
}

/**
 * @param {string|number} a
 * @param {string|number} b
 * @returns {AlgebraResult}
 */
export function subtract(a, b) {
  const { glyph: aG, decimal: aD } = normalize(a);
  const { glyph: bG, decimal: bD } = normalize(b);
  const diff = aD - bD;
  return { numerical: decimalToRefusalGlyphs(diff), decimal: diff, semantic: generateSemantic("subtract", aG, bG, diff) };
}

/**
 * @param {string|number} a
 * @param {string|number} b
 * @returns {AlgebraResult}
 */
export function multiply(a, b) {
  const { glyph: aG, decimal: aD } = normalize(a);
  const { glyph: bG, decimal: bD } = normalize(b);
  const product = aD * bD;
  return { numerical: decimalToRefusalGlyphs(product), decimal: product, semantic: generateSemantic("multiply", aG, bG, product) };
}

/**
 * @param {string|number} a
 * @param {string|number} b
 * @returns {AlgebraResult}
 */
export function divide(a, b) {
  const { glyph: aG, decimal: aD } = normalize(a);
  const { glyph: bG, decimal: bD } = normalize(b);
  if (bD === 0) {
    // FIX-root-001: the numerical must agree with the semantic (and with
    // Compute): division by Refusal is undefined — not "∞" beside a
    // caption saying undefined.
    return { numerical: "undefined", decimal: null, semantic: generateSemantic("divide", aG, bG, Infinity) };
  }
  const quotient = aD / bD;
  return { numerical: decimalToRefusalGlyphs(quotient), decimal: quotient, semantic: generateSemantic("divide", aG, bG, quotient) };
}

/**
 * Compute the base-6 representation of any numeric value in a DTU's semantic field.
 * Called lazily when DTU.asBase6() is invoked.
 * @param {number} value
 * @returns {string|null}
 */
export function computeBase6Layer(value) {
  if (typeof value !== "number" || !isFinite(value)) return null;
  try { return decimalToRefusalGlyphs(value); } catch { return null; }
}

/**
 * Generate a semantic layer description for a DTU's numeric value.
 * @param {number} value
 * @returns {string|null}
 */
export function generateDTUSemantic(value) {
  if (typeof value !== "number" || !isFinite(value)) return null;
  try {
    const glyph = decimalToRefusalGlyphs(value);
    const name = GLYPH_NAMES[glyph] || "compound";
    return `${value} → ${glyph} (${name}): numeric identity expressed in Refusal Algebra`;
  } catch { return null; }
}
