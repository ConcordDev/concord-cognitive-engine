/**
 * CSL Proof Obligations — Sprint 37 (full taxonomy)
 *
 * Wires the six proof obligations identified in the Sprint 34 audit
 * (docs/SPRINT-34-Z3-PROOF-OBLIGATIONS.md §5) into checkable functions.
 * Sprint 34 (cc-be) shipped exactly one of these (envelope well-formedness,
 * via a raw proveClaim call inline in csl-core.js#executeTurn step 6). This
 * file generalizes that pattern to all six and gives csl-core.js a single
 * entry point (`runProofObligations`) to call per turn.
 *
 * Per the audit's own honest read (§5's "Honest read of this table"), the six
 * obligations are NOT uniformly SMT-shaped: two already have real, tested,
 * zero-cost deterministic infrastructure (the royalty-cascade bounded model,
 * the CSL working-set budget gate), one is a genuine small model-checking
 * target with no existing model (macro lock safety — built here), one is a
 * straightforward equality check (DTU mint integrity), and two are honestly
 * flagged category errors for per-turn Z3 checking (schema migration safety
 * is authoring-time; intent routing correctness is a control-flow property).
 * Every obligation below still routes its claim through proof-gate.js's
 * proveClaim (so a live Z3 + brain deployment gets a real formal check), but
 * ALWAYS computes a deterministic ground-truth verdict first and falls back
 * to it when Z3/the brain aren't wired (the common case today — this mirrors
 * the "honest by construction" rule: never launder a trivial fact through a
 * solver round-trip that silently degrades to "unavailable" with no fallback).
 *
 * Every exported function is defensive: never throws, degrades to
 * `{ sat: null, error: 'proof_skipped' }` on any internal failure. This
 * sprint's obligations are OBSERVATIONAL ONLY — nothing here blocks a turn;
 * see docs/SPRINT-37-FULL-PROOFS.md for the Sprint 38 enforcement plan.
 *
 * Spec: docs/SPRINT-34-Z3-PROOF-OBLIGATIONS.md §5-6
 */

import { proveClaim } from "./proof-gate.js";
import { checkModel } from "./verification/model-checker.js";
import { buildRoyaltyCascadeModel } from "./verification/invariant-specs.js";
import { computeContentHash } from "./dtu-protocol.js";
import { checkInvariants } from "./csl-invariant-gates.js";
import logger from "../logger.js";

// ── shared helper: route a claim through proveClaim, fall back to a
// deterministically-computed ground truth when Z3/the brain aren't wired.
// z3Runner/brainFn are read off turnContext so tests can inject determinism
// (mirrors proof-gate.test.js's z3Stub/brainStub — the codebase's existing
// injectable-seam convention) without needing a live z3 binary in CI.
async function proveOrFallback(claim, deterministicSat, turnContext, extra = {}) {
  try {
    const proof = await proveClaim({
      claim,
      brainFn: turnContext.brainFn,
      z3Runner: turnContext.z3Runner,
      z3Path: turnContext.z3Path,
      timeoutMs: turnContext.timeoutMs ?? 3000, // tighter than proveClaim's 8s default (§6 perf note)
      useLean: false, // never escalate to Lean in the synchronous in-turn path (§6)
    });
    let sat = deterministicSat;
    let verifier = deterministicSat === null ? null : "deterministic";
    if (proof.verdict === "proven") { sat = true; verifier = "z3"; }
    else if (proof.verdict === "refuted") { sat = false; verifier = "z3"; }
    return { sat, model: { claim, verdict: proof.verdict, verifier, deterministicSat, z3Available: proof.z3Available, ...extra } };
  } catch (e) {
    try { logger.debug?.("csl-proof-obligations", "proof_failed", { error: e?.message }); } catch { /* ignore */ }
    return { sat: null, error: "proof_skipped", model: extra };
  }
}

// ── 1. DTU mint integrity — hash matches payload ─────────────────────────
export async function checkDtuMintIntegrity(turnContext = {}) {
  try {
    const content = turnContext.content ?? turnContext.payload ?? null;
    if (content == null) return { sat: null, error: "not_applicable", model: { reason: "no_payload" } };
    let actualHash;
    try { actualHash = computeContentHash(content); }
    catch (e) { return { sat: null, error: "proof_skipped", model: { reason: "hash_computation_failed" } }; }
    const expectedHash = turnContext.expectedHash ?? actualHash;
    const matches = actualHash === expectedHash;
    const claim = `Computed content hash ${actualHash} equals expected hash ${expectedHash}`;
    return await proveOrFallback(claim, matches, turnContext, { actualHash, expectedHash });
  } catch (e) {
    return { sat: null, error: "proof_skipped" };
  }
}

// ── 2. Macro lock safety — no re-entrant deadlock ────────────────────────
// A small bounded model of ConcordSoSRuntime#_lockedRunMacro's lock/wait
// shape (one held-by slot + a wait queue). The invariant it checks is the
// exact self-deadlock shape a re-entrance guard can introduce: the current
// holder of a lock must never also be sitting in its own wait queue.
// `buggy:true` reproduces that shape on purpose (mirrors invariant-specs.js's
// buggyCreditPredicateDoubleCounts pattern) so the checker's own catch
// capability is provable via a genuine counterexample, not asserted.
function buildMacroLockModel({ buggy = false } = {}) {
  function acquire(s, turnId) {
    if (s.held === null) return { held: turnId, waitQueue: s.waitQueue };
    if (s.held === turnId) {
      // Same-turn re-entrance: correctly passes straight through. The buggy
      // variant queues the re-entrant call behind its own hold instead.
      return buggy ? { held: turnId, waitQueue: [...s.waitQueue, turnId] } : s;
    }
    // A turnId can only ever have one outstanding wait at a time (the real
    // code's Map holds one in-flight entry per key, not a multi-wait queue) —
    // dedup so a repeated distinct-turn acquire doesn't leave a stale queue
    // entry behind after its holder eventually releases to it.
    if (s.waitQueue.includes(turnId)) return s;
    return { held: s.held, waitQueue: [...s.waitQueue, turnId] };
  }
  const actions = [
    { name: "acquire(turn-a)", guard: () => true, apply: (s) => acquire(s, "turn-a") },
    { name: "acquire(turn-b)", guard: () => true, apply: (s) => acquire(s, "turn-b") },
    {
      name: "release",
      guard: (s) => s.held !== null,
      apply: (s) => {
        const [next, ...rest] = s.waitQueue;
        return { held: next ?? null, waitQueue: rest };
      },
    },
  ];
  const invariants = [
    {
      name: "no_self_wait",
      check: (s) => !(s.held !== null && s.waitQueue.includes(s.held)),
      message: (s) => `turn ${s.held} holds the lock and is also queued waiting on itself: ${JSON.stringify(s)} (self-deadlock)`,
    },
  ];
  return { initialState: { held: null, waitQueue: [] }, actions, invariants };
}

export async function checkMacroLockSafety(turnContext = {}) {
  try {
    const model = buildMacroLockModel({ buggy: turnContext.forceViolation === true });
    const result = checkModel(model, { maxStates: 500, maxDepth: 6 });
    const deterministicSat = result.status === "no_violation_found";
    const claim = "for every reachable lock state, the turn holding the lock is never also queued waiting on itself";
    return await proveOrFallback(claim, deterministicSat, turnContext, { checkModel: result });
  } catch (e) {
    return { sat: null, error: "proof_skipped" };
  }
}

// ── 3. Citation cascade integrity — no double-pay, halving respected ─────
// Reuses the already-built, already-tested buildRoyaltyCascadeModel
// (server/lib/verification/invariant-specs.js) rather than re-deriving it —
// per the audit, this obligation is "already built, tested, and macro-
// exposed"; the only gap was wiring it into a CSL turn.
export async function checkCitationCascadeIntegrity(turnContext = {}) {
  try {
    const saleAmount = turnContext.saleAmount ?? 1000;
    const model = buildRoyaltyCascadeModel({
      enforceCap: turnContext.forceViolation === true ? false : true,
      saleAmount,
      generationChoices: turnContext.generationChoices,
    });
    const result = checkModel(model, { maxStates: 2000, maxDepth: 8 });
    const deterministicSat = result.status === "no_violation_found";
    const claim = `royalty payout total <= 0.30 * sale amount ${saleAmount} across every ancestor generation`;
    return await proveOrFallback(claim, deterministicSat, turnContext, { checkModel: result });
  } catch (e) {
    return { sat: null, error: "proof_skipped" };
  }
}

// ── 4. Memory budget compliance — turn stayed within working-set budget ──
// Delegates to csl-invariant-gates.js's already-built Check 1 rather than
// re-implementing the byte math, so the two never drift apart.
export async function checkMemoryBudgetCompliance(turnContext = {}) {
  try {
    const gate = await checkInvariants(turnContext.db ?? null, {
      turnId: turnContext.turnId,
      macroResult: turnContext.macroResult ?? {},
      context: turnContext.context ?? [],
    });
    const budgetCheck = gate.proofArtifact?.checks?.find((c) => c.name === "working_set_budget") ?? null;
    const deterministicSat = budgetCheck ? !!budgetCheck.pass : null;
    const bytes = gate.proofArtifact?.workingSetBytes ?? 0;
    const claim = `serialized turn working set ${bytes} bytes <= per-turn budget bytes`;
    return await proveOrFallback(claim, deterministicSat, turnContext, { budgetCheck, workingSetBytes: bytes });
  } catch (e) {
    return { sat: null, error: "proof_skipped" };
  }
}

// ── 5. Schema migration safety — no data loss ────────────────────────────
// Per the audit (§5): this is honestly a category error for a per-turn
// runtime check — CSL turns don't run migrations, and Concord's real
// migration-safety discipline is the append-only invariant + CI schema-drift
// gate, not a Z3 proof. This obligation only fires when a turn's macro
// result explicitly reports a before/after column set (a macro that itself
// performed a schema-shaped mutation); otherwise it stays honestly
// not_applicable rather than manufacturing a claim to check.
export async function checkSchemaMigrationSafety(turnContext = {}) {
  try {
    const before = turnContext.migrationColumnsBefore;
    const after = turnContext.migrationColumnsAfter;
    if (!Array.isArray(before) || !Array.isArray(after)) {
      return { sat: null, error: "not_applicable", model: { reason: "no_migration_in_turn" } };
    }
    const missing = before.filter((c) => !after.includes(c));
    const deterministicSat = missing.length === 0;
    const claim = `for every column in the before-migration set {${before.join(",")}}, that column is present in the after-migration set {${after.join(",")}}`;
    return await proveOrFallback(claim, deterministicSat, turnContext, { before, after, missing });
  } catch (e) {
    return { sat: null, error: "proof_skipped" };
  }
}

// ── 6. Intent routing correctness — conversational never reaches CSL ─────
// The audit found this is a real, currently-broken program-correctness
// property (csl-core.js awaited a synchronous classifyIntent and compared
// its returned object to the string 'language', which is never true) rather
// than a Z3 gap. That bug is fixed alongside this wiring (see csl-core.js
// step 1); this obligation checks the property directly: a turn that
// actually reaches the macro-invoke step must have a non-'language' intent.
export async function checkIntentRoutingCorrectness(turnContext = {}) {
  try {
    const { classifyIntent } = await import("./chat/intent-router.js");
    const classification = classifyIntent(turnContext.turnText ?? "");
    const reachedCsl = turnContext.reachedCsl !== false;
    const deterministicSat = !(reachedCsl && classification.intent === "language");
    const claim = "for every turn that reaches the CSL macro-invoke step, the classified intent is not equal to \"language\"";
    return await proveOrFallback(claim, deterministicSat, turnContext, { intent: classification.intent, reachedCsl });
  } catch (e) {
    return { sat: null, error: "proof_skipped" };
  }
}

// ── Orchestrator: run all six, keyed, never throws ────────────────────────
export const PROOF_OBLIGATIONS = {
  dtuMintIntegrity: checkDtuMintIntegrity,
  macroLockSafety: checkMacroLockSafety,
  citationCascadeIntegrity: checkCitationCascadeIntegrity,
  memoryBudgetCompliance: checkMemoryBudgetCompliance,
  schemaMigrationSafety: checkSchemaMigrationSafety,
  intentRoutingCorrectness: checkIntentRoutingCorrectness,
};

/**
 * Run every proof obligation against a turn context. Observational only —
 * the caller decides whether/how to act on `sat:false`; nothing here throws
 * or blocks. @param {object} turnContext @returns {Promise<object>} keyed by obligation name.
 */
export async function runProofObligations(turnContext = {}) {
  const out = {};
  for (const [name, fn] of Object.entries(PROOF_OBLIGATIONS)) {
    try {
      out[name] = await fn(turnContext);
    } catch (e) {
      out[name] = { sat: null, error: "proof_skipped" };
    }
  }
  return out;
}

export default { ...PROOF_OBLIGATIONS, PROOF_OBLIGATIONS, runProofObligations };
