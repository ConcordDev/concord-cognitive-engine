// server/domains/rnd.js
//
// Private R&D Engine (capability #21) + Tier-0 wire-the-unwired.
//
// Unifies engines that already existed in the corpus but were never reachable:
//   • FEA            — lib/simulation/fea-solver.js  (Direct Stiffness 2D/3D)   [was 0 refs]
//   • Causal-Closure — lib/causal-closure.js          (residual / underfit gate) [was lib-only]
//   • Hypothesis     — emergent/hypothesis-engine.js  (proposed→…→confirmed)     [was unreachable]
//   • CAS            — lib/compute/symbolic-math.js    (symbolic algebra)
// and grounds them in the lattice via the Literary Resonance Lattice (literary.search)
// + the DTU substrate. `rnd.run` is the orchestrator: one verifiable research loop
//   goal → hypothesis → grounded retrieval → CAS/FEA compute → closure/residual check
//        → synthesis → a provenance-carrying DTU.
//
// Every step is best-effort + try/catch isolated; the loop never throws and degrades
// gracefully (no Ollama, no corpus, no data → still returns a structured result).
//
// Registered from server.js: `import registerRndMacros from "./domains/rnd.js";
// registerRndMacros(register);`

import { runFEA } from "../lib/simulation/fea-solver.js";
import { causalClosure } from "../lib/causal-closure.js";
import {
  proposeHypothesis, listHypotheses, getHypothesis, addEvidence,
  recalculateConfidence, checkAutoTransitions,
} from "../emergent/hypothesis-engine.js";
import {
  simplify, expand, differentiate, integrate, solve, evaluate, stringify,
} from "../lib/compute/symbolic-math.js";
import { searchLiterary } from "./literary.js";
import { createDTU } from "../economy/dtu-pipeline.js";

// ── CAS dispatch ──────────────────────────────────────────────────────────────
function casRun(op, expression, variable, assignment) {
  if (!expression) return { ok: false, reason: "missing_expression" };
  try {
    switch (op) {
      case "simplify":      return { ok: true, op, result: stringify(simplify(expression)) };
      case "expand":        return { ok: true, op, result: stringify(expand(expression)) };
      case "differentiate": return { ok: true, op, result: stringify(differentiate(expression, variable || "x")) };
      case "integrate":     return { ok: true, op, result: stringify(integrate(expression, variable || "x")) };
      case "solve":         return { ok: true, op, result: stringify(solve(expression, variable || "x")) };
      case "evaluate":      return { ok: true, op, result: evaluate(expression, assignment || {}) };
      default:              return { ok: false, reason: "unknown_op", op };
    }
  } catch (e) {
    return { ok: false, reason: String(e?.message || e), op };
  }
}

export default function registerRndMacros(register) {
  // ── FEA (wire the dead solver) ───────────────────────────────────────────
  register("rnd", "fea", async (_ctx, input = {}) => {
    const model = input.model || input;
    try { return runFEA(model); }
    catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }, { note: "Direct-Stiffness FEA: input {nodes, members, loads, supports} -> displacements/forces/stresses" });

  // ── CAS ──────────────────────────────────────────────────────────────────
  register("rnd", "cas", async (_ctx, input = {}) => {
    return casRun(input.op || "simplify", input.expression, input.variable, input.assignment);
  }, { note: "symbolic algebra: op simplify|expand|differentiate|integrate|solve|evaluate" });

  // ── Causal-closure / residual (wire the analyzer) ─────────────────────────
  register("rnd", "causal_closure", async (_ctx, input = {}) => {
    try {
      return causalClosure(input.rows, {
        featureKeys: input.featureKeys, targetKey: input.targetKey,
        historyWindow: input.historyWindow, awarenessKey: input.awarenessKey,
      });
    } catch (e) { return { ok: false, reason: String(e?.message || e) }; }
  }, { note: "fits a capacity ladder + analyses the out-of-sample residual; flags hidden variables / unexplained variance" });

  // ── Hypothesis lifecycle (wire the engine) ────────────────────────────────
  register("rnd", "hypothesize", async (_ctx, input = {}) => {
    return proposeHypothesis(String(input.statement || ""), input.domain || "rnd", input.priority || "normal");
  }, { note: "propose a falsifiable hypothesis (proposed -> testing -> confirmed/rejected)" });

  register("rnd", "hypotheses", async (_ctx, input = {}) => {
    return { ok: true, hypotheses: listHypotheses(input.status) };
  }, { note: "list hypotheses, optionally filtered by status" });

  register("rnd", "hypothesis_get", async (_ctx, input = {}) => {
    const h = getHypothesis(String(input.id || ""));
    return h ? { ok: true, hypothesis: h } : { ok: false, reason: "not_found" };
  }, { note: "get one hypothesis by id" });

  register("rnd", "hypothesis_evidence", async (_ctx, input = {}) => {
    const r = addEvidence(String(input.id || ""), input.side, input.dtuId, Number(input.weight) || 0.5, input.summary || "");
    if (!r?.ok) return r;
    recalculateConfidence(String(input.id));
    const t = checkAutoTransitions(String(input.id));
    return { ok: true, transition: t };
  }, { note: "add for/against evidence to a hypothesis; recomputes confidence + auto-transitions" });

  // ── run — the orchestrator (capability #21) ───────────────────────────────
  register("rnd", "run", async (ctx, input = {}) => {
    const db = ctx?.db;
    const goal = String(input.goal || "").trim();
    if (!goal) return { ok: false, reason: "missing_goal" };

    const steps = {};

    // 1) Frame a falsifiable hypothesis.
    let hypothesisId = null;
    try {
      const h = proposeHypothesis(goal, input.domain || "rnd", input.priority || "normal");
      if (h?.ok) { hypothesisId = h.hypothesis?.id; steps.hypothesis = h.hypothesis; }
    } catch { /* engine optional */ }

    // 2) Ground it in the lattice (LRL cross-domain retrieval).
    let grounding = [];
    if (db) {
      try {
        const g = await searchLiterary(db, { query: goal, limit: input.groundingK || 5 });
        grounding = (g?.results || []).map((r) => ({ chunkId: r.chunkId, title: r.title, author: r.author, snippet: r.snippet, score: r.score }));
      } catch { grounding = []; }
    }
    steps.grounding = grounding;

    // 3) Compute — CAS and/or FEA, whichever inputs are present.
    const compute = {};
    if (input.expression) compute.cas = casRun(input.casOp || "simplify", input.expression, input.variable, input.assignment);
    if (input.model) { try { compute.fea = runFEA(input.model); } catch (e) { compute.fea = { ok: false, error: String(e?.message || e) }; } }
    steps.compute = compute;

    // 4) Verify — residual / causal-closure check when data is supplied.
    let closure = null;
    if (Array.isArray(input.rows) && input.featureKeys && input.targetKey) {
      try { closure = causalClosure(input.rows, { featureKeys: input.featureKeys, targetKey: input.targetKey, historyWindow: input.historyWindow }); }
      catch (e) { closure = { ok: false, reason: String(e?.message || e) }; }
    }
    steps.closure = closure;

    // 5) Synthesize a grounded, deterministic summary (LLM-narrated when available).
    const lines = [`# R&D run: ${goal}`, ""];
    if (steps.hypothesis) lines.push(`Hypothesis (${steps.hypothesis.id}): ${steps.hypothesis.statement || goal} — status ${steps.hypothesis.status}.`);
    if (grounding.length) lines.push(`Grounded in ${grounding.length} passage(s): ${grounding.map((g) => g.title).filter(Boolean).slice(0, 3).join("; ")}.`);
    if (compute.cas?.ok) lines.push(`CAS (${compute.cas.op}): ${compute.cas.result}.`);
    if (compute.fea?.ok) lines.push(`FEA: solved ${compute.fea.displacements?.length || 0} node displacement(s).`);
    if (closure?.ok) {
      const r2 = Number(closure.prediction?.r2 ?? 0);
      const fu = Number(closure.prediction?.fractionUnexplained ?? 0);
      lines.push(`Closure verdict: ${closure.verdict || "n/a"} (R²=${r2.toFixed(3)}, unexplained ${(fu * 100).toFixed(2)}%).`);
    }
    const synthesis = lines.join("\n");

    // Optional grounded-LLM narrative (graceful — never blocks the loop).
    let narrative = null;
    if (input.narrate && ctx?.llm?.chat) {
      try {
        const ctxText = grounding.map((g) => `- ${g.title}: ${g.snippet}`).join("\n").slice(0, 2000);
        const out = await ctx.llm.chat([
          { role: "system", content: "You are a careful R&D analyst. Summarize the result grounded ONLY in the provided computation + passages. Do not invent facts." },
          { role: "user", content: `${synthesis}\n\nGrounding:\n${ctxText}` },
        ], { timeoutMs: 8000 });
        narrative = typeof out === "string" ? out : out?.content || null;
      } catch { narrative = null; }
    }

    // 6) Mint a provenance-carrying DTU capturing the run.
    let dtuId = null;
    if (db) {
      try {
        const res = createDTU(db, {
          creatorId: ctx?.actor?.userId || "system",
          title: `R&D: ${goal}`.slice(0, 160),
          content: narrative ? `${synthesis}\n\n---\n${narrative}` : synthesis,
          contentType: "text", lensId: "rnd", tier: "REGULAR",
          tags: ["rnd", "research", input.domain].filter(Boolean).map((t) => String(t).toLowerCase()),
          citationMode: "original",
          metadata: { via: "rnd-run", hypothesisId, grounded: grounding.map((g) => g.dtuId || g.chunkId), hasCompute: Object.keys(compute).length > 0, hasClosure: !!closure?.ok },
        });
        if (res?.ok) { dtuId = res.dtu?.id; try { db.prepare("UPDATE dtus SET visibility='public' WHERE id=?").run(dtuId); } catch { /* col optional */ } }
      } catch { dtuId = null; }
    }

    return { ok: true, goal, hypothesisId, steps, synthesis, narrative, dtuId };
  }, { note: "Private R&D Engine: goal -> hypothesis -> LRL grounding -> CAS/FEA -> causal-closure -> synthesis -> DTU" });
}
