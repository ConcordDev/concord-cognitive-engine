// server/lib/refusal-algebra/conversion.js
// Decimal ↔ base-6 glyph conversion for the Refusal Algebra numeral system.

import { GLYPHS, GLYPH_TO_DIGIT, GLYPH_NAMES, RADIX_SEPARATOR, NEG_MARKER } from "./glyphs.js";

const FRAC_PRECISION = 10; // base-6 digits of fractional precision

/**
 * Parse a glyph string into an array of base-6 digit values.
 * Handles both single-char glyphs (⟐,⟲,⊚) and two-char composites (⟐⟲,⊚⟲,⟐⊚).
 *
 * @param {string} s
 * @returns {number[]}
 */
export function parseGlyphs(s) {
  const digits = [];
  let i = 0;
  while (i < s.length) {
    // Try two-character compound first
    if (i + 1 < s.length) {
      const two = s.slice(i, i + 2);
      if (two in GLYPH_TO_DIGIT) {
        digits.push(GLYPH_TO_DIGIT[two]);
        i += 2;
        continue;
      }
    }
    const one = s[i];
    if (one in GLYPH_TO_DIGIT) {
      digits.push(GLYPH_TO_DIGIT[one]);
      i += 1;
    } else if (one === RADIX_SEPARATOR || one === NEG_MARKER) {
      i += 1; // handled at higher level
    } else {
      throw new Error(`Unknown glyph at position ${i}: "${one}" (U+${one.codePointAt(0).toString(16).toUpperCase()})`);
    }
  }
  return digits;
}

/**
 * Convert a non-negative integer to its base-6 glyph representation.
 * @param {number} n - Non-negative integer
 * @returns {string}
 */
function intToGlyphs(n) {
  if (n === 0) return GLYPHS[0];
  let result = "";
  let temp = n;
  while (temp > 0) {
    result = GLYPHS[temp % 6] + result;
    temp = Math.floor(temp / 6);
  }
  return result;
}

/**
 * Convert a decimal number to Refusal Algebra base-6 glyph notation.
 *
 * @param {number} n
 * @returns {string}
 */
export function decimalToRefusalGlyphs(n) {
  if (typeof n !== "number" || isNaN(n)) throw new TypeError("Input must be a finite number");
  if (!isFinite(n)) throw new RangeError("Input must be finite");

  if (n < 0) return NEG_MARKER + decimalToRefusalGlyphs(-n);
  if (n === 0) return GLYPHS[0];

  const integer = Math.floor(n);
  const fractional = n - integer;

  const intGlyphs = intToGlyphs(integer);

  if (fractional < 1e-12) return intGlyphs;

  // Convert fractional part to base-6
  let fracGlyphs = RADIX_SEPARATOR;
  let f = fractional;
  let precision = FRAC_PRECISION;

  while (f > 1e-12 && precision-- > 0) {
    f *= 6;
    const digit = Math.floor(f);
    fracGlyphs += GLYPHS[digit];
    f -= digit;
  }

  return intGlyphs + fracGlyphs;
}

/**
 * Convert a Refusal Algebra base-6 glyph string to a decimal number.
 *
 * @param {string} glyphString
 * @returns {number}
 */
export function refusalGlyphsToDecimal(glyphString) {
  if (typeof glyphString !== "string" || glyphString.length === 0) {
    throw new TypeError("Input must be a non-empty string");
  }

  if (glyphString.startsWith(NEG_MARKER)) {
    return -refusalGlyphsToDecimal(glyphString.slice(NEG_MARKER.length));
  }

  const [intPart, fracPart] = glyphString.split(RADIX_SEPARATOR);

  const intDigits = parseGlyphs(intPart || GLYPHS[0]);
  let result = intDigits.reduce((acc, d) => acc * 6 + d, 0);

  if (fracPart) {
    const fracDigits = parseGlyphs(fracPart);
    let divisor = 6;
    for (const digit of fracDigits) {
      result += digit / divisor;
      divisor *= 6;
    }
  }

  return result;
}

/**
 * Enumerate EVERY valid tokenization of a glyph-only string (no radix /
 * negation handling — see glyphStringReadings for full numbers).
 *
 * Refusal Algebra's compounds make some strings genuinely ambiguous:
 * "⟲⟐⊚" tokenizes as [1,0,2] digit-wise and as [1,5] by compounds. The
 * greedy parseGlyphs silently picks one; surfaces that must not choose
 * silently (Root S-ROOT-1, per the Lead's §8 disposition — the round-trip
 * property is the standard and ambiguity is resolved explicitly) enumerate
 * the readings here instead. Enumeration is capped so a pasted string
 * cannot blow up combinatorially.
 *
 * @param {string} s - glyph characters only
 * @param {number} [cap=16] - maximum tokenizations to return
 * @returns {number[][]} digit arrays, greedy (compound-first) reading first
 */
export function parseGlyphsAll(s, cap = 16) {
  const out = [];
  const walk = (i, acc) => {
    if (out.length >= cap) return;
    if (i === s.length) { out.push([...acc]); return; }
    if (i + 1 < s.length) {
      const two = s.slice(i, i + 2);
      if (two in GLYPH_TO_DIGIT) { acc.push(GLYPH_TO_DIGIT[two]); walk(i + 2, acc); acc.pop(); }
    }
    const one = s[i];
    if (one in GLYPH_TO_DIGIT) { acc.push(GLYPH_TO_DIGIT[one]); walk(i + 1, acc); acc.pop(); }
  };
  walk(0, []);
  return out;
}

/**
 * Every distinct reading of a full glyph number string (optional negation
 * marker, optional fractional part after the radix separator).
 *
 * @param {string} glyphString
 * @returns {{ digits: number[], fracDigits: number[], decimal: number, label: string }[]}
 *   readings sorted with the greedy (canonical) reading first; `label`
 *   names the tokenization digit by digit ("Pivot · Refusal · Bridge").
 */
export function glyphStringReadings(glyphString) {
  if (typeof glyphString !== "string" || glyphString.length === 0) return [];
  let s = glyphString;
  let sign = 1;
  if (s.startsWith(NEG_MARKER)) { sign = -1; s = s.slice(NEG_MARKER.length); }
  const [intPart, fracPart] = s.split(RADIX_SEPARATOR);
  const intSets = parseGlyphsAll(intPart || GLYPHS[0]);
  const fracSets = fracPart ? parseGlyphsAll(fracPart) : [[]];
  const byDecimal = new Map();
  for (const intDigits of intSets) {
    for (const fracDigits of fracSets) {
      let value = intDigits.reduce((acc, d) => acc * 6 + d, 0);
      let divisor = 6;
      for (const d of fracDigits) { value += d / divisor; divisor *= 6; }
      const decimal = sign * value;
      const key = Math.round(decimal * 1e10) / 1e10;
      if (!byDecimal.has(key)) {
        const names = [...intDigits, ...fracDigits].map((d) => GLYPH_NAMES[GLYPHS[d]] || String(d));
        byDecimal.set(key, { digits: intDigits, fracDigits, decimal, label: names.join(" · ") });
      }
    }
  }
  const readings = [...byDecimal.values()];
  // Canonical (greedy) reading first: its value is what refusalGlyphsToDecimal returns.
  let canonical = null;
  try { canonical = refusalGlyphsToDecimal(glyphString); } catch { canonical = null; }
  readings.sort((a, b) => {
    if (canonical !== null) {
      const aHit = Math.abs(a.decimal - canonical) < 1e-9 ? 0 : 1;
      const bHit = Math.abs(b.decimal - canonical) < 1e-9 ? 0 : 1;
      if (aHit !== bHit) return aHit - bHit;
    }
    return Math.abs(a.decimal) - Math.abs(b.decimal);
  });
  return readings;
}
