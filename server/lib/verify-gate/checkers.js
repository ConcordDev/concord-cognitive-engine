// server/lib/verify-gate/checkers.js
//
// One checker per claim kind. Each returns { claimId, kind, checker, result, detail, ... } with result:
//   verified   the checker established it
//   refuted    the checker established it is false (counterexample / recomputation disagrees / citation does not exist)
//   failed     a proof attempt did not succeed: NOT a disproof, NOT verified
//   pending    the checker is unavailable right now (Lean pod down, no model); try again later
//   unchecked  nothing we have can check this claim kind here
//   n/a        speculative / narrative: not a checkable claim
// Every dependency is injected, so the whole thing runs offline in tests.

import { evaluate } from "../compute/symbolic-math.js";
import * as formalLogic from "../compute/formal-logic.js";
import { extractLean } from "../proof-gate.js";
import { checkLean } from "./lean-client.js";

const LEAN_PROMPT =
  "You are a Lean 4 theorem prover. Write a SELF-CONTAINED Lean 4 file that states the user's claim as a `theorem` and PROVES it " +
  "(prefer core + tactics like simp, omega, decide, induction, norm_num; Mathlib imports allowed). No sorry, admit, axioms, #eval or macros. " +
  "Output ONLY one ```lean block. If the claim is false or you cannot prove it, output exactly ```lean\n-- UNPROVABLE\n```.";

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
const done = (claim, checker, result, detail, extra = {}) => ({ claimId: claim.id, kind: claim.kind, checker, result, detail, ...extra });

async function checkMath(claim, deps) {
  // 1. a purely propositional formula: exact, instant, no model
  try {
    const ast = formalLogic.parse(claim.text);
    if (ast && formalLogic.getVariables(claim.text).length) {
      return formalLogic.isTautology(claim.text)
        ? done(claim, "formal-logic", "verified", "propositional tautology (truth table)")
        : formalLogic.isContradiction(claim.text)
          ? done(claim, "formal-logic", "refuted", "propositional contradiction (truth table)")
          : done(claim, "formal-logic", "failed", "satisfiable but not valid as a propositional formula");
    }
  } catch { /* not a propositional formula: go on */ }

  // 2. Z3 (and its own Lean escalation) when it exists
  if (typeof deps.proveClaim === "function") {
    const p = await deps.proveClaim({ claim: claim.text, brainFn: deps.brainFn, timeoutMs: deps.z3TimeoutMs });
    if (p.verdict === "proven") return done(claim, p.verifier || "z3", "verified", `proven by ${p.verifier || "z3"}`, { smt: p.smt || null, lean: p.lean || null });
    if (p.verdict === "refuted") return done(claim, "z3", "refuted", "counterexample found by Z3", { smt: p.smt || null });
    if (p.verdict === "unknown") { /* SMT could not settle it: try Lean directly below */ }
    if (p.verdict === "not_amenable") return done(claim, "proof-gate", "unchecked", "no formalisable structure");
  }

  // 3. Lean 4 on the pod: the model writes the proof, the pod checks it
  if (typeof deps.brainFn !== "function") return done(claim, "lean", "pending", "no model available to translate the claim to Lean");
  let source = null;
  try {
    const r = await deps.brainFn([{ role: "system", content: LEAN_PROMPT }, { role: "user", content: `Claim: "${claim.text}"` }]);
    source = extractLean(String(r?.text ?? r ?? ""));
  } catch { source = null; }
  if (!source) return done(claim, "lean", "failed", "the model could not produce a proof to check");
  const lean = await (deps.checkLean || checkLean)(source, { timeoutS: deps.leanTimeoutS ?? 30 });
  const ev = { leanSource: source, leanElapsedMs: lean.elapsedMs ?? null };
  if (lean.status === "verified") return done(claim, "lean4", "verified", "Lean 4 accepted the proof (no sorry, standard axioms only)", ev);
  if (lean.status === "pending") return done(claim, "lean4", "pending", lean.reason || "Lean service unavailable", ev);
  if (lean.status === "rejected") return done(claim, "lean4", "failed", `proof not acceptable: ${(lean.rejected || []).join("; ")}`, ev);
  return done(claim, "lean4", "failed", `Lean did not accept the proof: ${(lean.errors || []).slice(0, 2).join(" | ") || "no detail"}`, ev);
}

function checkArithmetic(claim) {
  try {
    const expr = claim.arithmetic.expression.replace(/(\d)\s*\^\s*(\d)/g, "$1^$2");
    const got = evaluate(expr, {});
    const ok = Number.isFinite(got) && rel(got, claim.arithmetic.value) <= 0.005;
    return done(claim, "symbolic.evaluate", ok ? "verified" : "refuted", ok ? `${expr} = ${got}` : `${expr} = ${got}, not ${claim.arithmetic.value}`);
  } catch (e) {
    return done(claim, "symbolic.evaluate", "unchecked", `could not evaluate: ${String(e?.message || e)}`);
  }
}

async function checkCitation(claim, deps) {
  if (typeof deps.dtuExists !== "function") return done(claim, "dtu-lookup", "pending", "no DTU lookup available");
  const missing = [];
  for (const id of claim.dtuIds || []) { if (!(await deps.dtuExists(id))) missing.push(id); }
  return missing.length
    ? done(claim, "dtu-lookup", "refuted", `cites DTU(s) that do not exist: ${missing.join(", ")}`)
    : done(claim, "dtu-lookup", "verified", `${(claim.dtuIds || []).length} cited DTU(s) exist`);
}

// A quantity with a unit is verified only when it appears in the sources the candidate was built from
// (or in the reference corpus); otherwise it is unchecked, not refuted: absence from sources is not falsity.
function checkNumeric(claim, deps) {
  const nums = [...claim.text.matchAll(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)].map((m) => Number(m[0]));
  const pool = deps.sourceNumbers;
  if (!pool || !pool.length) return done(claim, "numeric-trace", "unchecked", "no source numbers to trace against");
  const SCALES = [1, 1e3, 1e-3, 1e6, 1e-6, 1e9, 1e-9];
  const traced = nums.filter((n) => pool.some((p) => SCALES.some((k) => rel(n, p * k) <= 0.005)));
  return traced.length === nums.length
    ? done(claim, "numeric-trace", "verified", "every figure appears in the source material")
    : done(claim, "numeric-trace", "unchecked", `figure(s) not in the source material: ${nums.filter((n) => !traced.includes(n)).join(", ")}`);
}

export async function checkClaim(claim, deps = {}) {
  switch (claim.kind) {
    case "math": return checkMath(claim, deps);
    case "arithmetic": return checkArithmetic(claim);
    case "citation": return checkCitation(claim, deps);
    case "numeric": return checkNumeric(claim, deps);
    default: return done(claim, "none", "n/a", claim.kind === "speculative" ? "speculative: not a checkable claim" : "descriptive prose: nothing to check");
  }
}
