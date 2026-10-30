// server/lib/verify-gate/claims.js
//
// Pull the checkable claims out of a candidate theory / hypothesis / mega / hyper body. Deterministic, no model.
//   math         an equation, inequality, quantified or logical statement           -> Lean / Z3 / propositional
//   arithmetic   "a op b = c" with numbers only                                     -> recomputed
//   numeric      a number with a physical unit                                      -> traced to sources / reference
//   citation     a dtu_ id or "DTU: title" reference                                -> must resolve to a real DTU
//   speculative  hedged or imaginative ("might", "could", "hypothesis", "suppose")  -> never a mega/hyper, never fact
//   narrative    descriptive prose with nothing checkable                           -> neither verified nor refuted
// A sentence gets the strongest kind that applies (math > arithmetic > citation > numeric), unless it is hedged.

import { classifyAmenable } from "../proof-gate.js";

const UNITS = "(?:GPa|MPa|kPa|Pa|psi|ksi|kN|MN|N|lbf|kg|g|mm|cm|km|m|ft|in|K|°C|°F|kW|MW|W|kJ|MJ|J|Hz|kHz|V|kV|A|mA|ohms?|Ω|m/s|%)";
const QUANTITY = new RegExp(`-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\s*${UNITS}(?![A-Za-z])`);
const ARITH = /(-?\d+(?:\.\d+)?(?:\s*[-+*/^×÷]\s*-?\d+(?:\.\d+)?)+)\s*=\s*(-?\d+(?:\.\d+)?)/;
const DTU_ID = /\bdtu_[a-z0-9_]{6,}\b/gi;
const HEDGE = /\b(might|may|could|perhaps|possibly|probably|conjecture|hypothes[ie]s|hypothesi[sz]e|suppose|speculat\w*|imagine|what if|it is possible|suggests? that|appears? to|seems? to|likely)\b/i;
const MAX_CLAIMS = 40;

export const CLAIM_KINDS = Object.freeze(["math", "arithmetic", "citation", "numeric", "speculative", "narrative"]);

const sentences = (text) => String(text || "")
  .replace(/```[\s\S]*?```/g, " ")
  .split(/(?<=[.!?])\s+|\n+/)
  .map((s) => s.replace(/^[\s>*#\-•\d.)]+/, "").trim())
  .filter((s) => s.length >= 12);

export function extractClaims(text) {
  const out = [];
  for (const s of sentences(text)) {
    if (out.length >= MAX_CLAIMS) break;
    const ids = [...s.matchAll(DTU_ID)].map((m) => m[0].toLowerCase());
    const arith = s.match(ARITH);
    let kind;
    if (HEDGE.test(s)) kind = "speculative";
    else if (arith) kind = "arithmetic";
    else if (classifyAmenable(s).amenable && /[=<>≤≥≠∀∃]|\b(for all|for every|there exists|implies|if and only if|iff|prime|divisible|even|odd)\b/i.test(s)) kind = "math";
    else if (ids.length) kind = "citation";
    else if (QUANTITY.test(s)) kind = "numeric";
    else kind = "narrative";
    out.push({ id: `c${out.length + 1}`, kind, text: s.slice(0, 400), ...(ids.length ? { dtuIds: ids } : {}), ...(arith ? { arithmetic: { expression: arith[1].replace(/×/g, "*").replace(/÷/g, "/").replace(/\^/g, "^"), value: Number(arith[2]) } } : {}) });
  }
  return out;
}
