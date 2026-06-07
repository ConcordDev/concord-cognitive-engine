// server/lib/grounding-runners.js
//
// Deterministic runners for the DTU grounding gate's reproducibility check (lib/dtu-grounding.js).
// A creative/generative DTU is only "grounded" if its embedded computation re-runs to the
// SAME result twice (and matches any declared `expected`). These runners do that re-run.
// Kept dependency-light + side-effect-free so verification is itself reproducible.

import { resolveCraft } from "./craft-resolve.js";

// Safe arithmetic evaluator — NO identifiers allowed (whitelist of math chars only), so there
// is no path to function calls / require / property access. Deterministic by construction.
// Supports + - * / ( ) . % and ^ (mapped to **). Returns a number, or NaN if unsafe/invalid.
export function formulaRunner(expr) {
  const s = String(expr || "").trim();
  if (!s || !/^[-+*/().\d\s^%]+$/.test(s)) return NaN;
  try {
    // eslint-disable-next-line no-new-func
    const v = Function(`"use strict"; return (${s.replace(/\^/g, "**")});`)();
    return typeof v === "number" && Number.isFinite(v) ? v : NaN;
  } catch { return NaN; }
}

// Recipe runner — re-resolves a craft recipe deterministically (resolveCraft is seed-stable).
// Returns the canonical { potency, affinity, stability } shape so two runs compare equal.
export function recipeRunner(recipe) {
  try {
    const r = recipe?.recipe || recipe || {};
    const out = resolveCraft({ inputs: Array.isArray(r.inputs) ? r.inputs : [], recipe: r, playerSkill: 0, stationQuality: 0, risk: 0, seed: r.seed ?? "grounding" });
    return { potency: out?.potency ?? null, affinity: out?.affinity ?? null, stability: out?.stability ?? null };
  } catch { return null; }
}

// Code runner is intentionally omitted for now — arbitrary code execution needs a sandbox
// (the programming-puzzle VM is instruction-format-specific). A creative DTU whose only
// executable is raw `code` will fall to probation until a sandboxed runner is wired, which
// is the safe default ("can't prove it reproducible → don't launder it in").

export const DEFAULT_RUNNERS = { formula: formulaRunner, recipe: recipeRunner };
export default DEFAULT_RUNNERS;
