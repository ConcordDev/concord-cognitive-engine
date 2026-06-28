// server/domains/sandwich.js
//
// The "verified semantic sandwich" pipeline, registered as `sandwich.run`.
//
//   NL query
//     → parseIntent   (TOP slice: utility brain, structured-output, schema-validated)
//     → routeToPlan   (MIDDLE: deterministic intent → macro_dag plan, no model)
//     → runDag        (deterministic execution over the macro registry, CPU)
//     → formatResult  (BOTTOM slice: constrained synthesis, VERIFIED not trusted)
//
// The middle is deterministic and reproducible: the same parsed intent always
// produces the same plan and (for deterministic macros) the same result. The
// two model touchpoints (parse, format) are both fenced — the parse output is
// schema-validated, the format output is fact-guarded against the data.
//
// Honesty: on a parse or route miss we return { ok:false, reason } rather than
// guessing a macro. The verified flag means "the prose's numbers/entities all
// trace to the computed data + cited claims resolved" — it is NOT a truth oracle.
//
// `deps` injection:
//   - runMacro:   the combined dispatcher (LENS_ACTIONS first, then MACROS) so
//                 the DAG can reach lens-action macros like the math CAS. The
//                 server passes runMcpTool here for exactly that reach.
//   - candidates: the macro catalog the parse gate selects from (each
//                 { domain, name, description?, paramSchema? }).
//   - parseLlmFn / formatLlmFn: optional injectables (default = real brains).

import { parseIntent } from "../lib/sandwich/parse-gate.js";
import { routeToPlan, DEFAULT_RULES } from "../lib/sandwich/router.js";
import { formatResult } from "../lib/sandwich/format-gate.js";
import { runDag } from "../lib/macro-dag.js";

// A small, real, genuinely-chainable default catalog. The CAS macros are
// lens-actions (reachable only through the combined dispatcher) and their
// outputs thread cleanly, which is why they seed both the catalog and the
// router's chain rule. Callers can pass their own `candidates` to widen this.
export const DEFAULT_CANDIDATES = [
  {
    domain: "math",
    name: "symbolicCompute",
    description:
      "Symbolic CAS: simplify an expression, take a derivative, or integrate. Real computer algebra, no guessing.",
    paramSchema: {
      operation: { type: "string", required: true, enum: ["simplify", "derivative", "integral"] },
      expression: { type: "string", required: true },
      variable: { type: "string" },
      lower: { type: "number" },
      upper: { type: "number" },
      // router hint: when true, a derivative result is fed into a simplify pass
      simplify: { type: "boolean" },
    },
  },
  {
    domain: "math",
    name: "unitConvert",
    description: "Convert a numeric value between units (e.g. km to miles, C to F).",
    paramSchema: {
      value: { type: "number", required: true },
      from: { type: "string", required: true },
      to: { type: "string", required: true },
    },
  },
  {
    domain: "math",
    name: "numberTheory",
    description: "Number-theory queries: primality, factorization, gcd/lcm of an integer.",
    paramSchema: {
      operation: { type: "string", required: true },
      n: { type: "number", required: true },
    },
  },
];

/**
 * Pull the canonical "result data" out of a finished DAG run. A single-step
 * plan's answer is that step's result; a multi-step plan returns the LAST
 * step's result (the synthesis target). We keep the full results map too.
 */
function extractResultData(dagOut, plan) {
  const results = dagOut?.results || {};
  const order = dagOut?.order || plan.steps.map((s) => s.id);
  const lastId = order[order.length - 1];
  const last = results[lastId];
  // Macros return { ok, result: {...} } | { ok, ...fields }. Prefer .result.
  if (last && typeof last === "object" && last.result !== undefined) return last.result;
  return last;
}

export default function registerSandwichMacros(register, deps = {}) {
  const {
    runMacro,
    candidates: depsCandidates,
    parseLlmFn,
    formatLlmFn,
    rules = DEFAULT_RULES,
  } = deps;

  register(
    "sandwich",
    "run",
    async (ctx, input = {}) => {
      const query = String(input.query || "").trim();
      if (!query) return { ok: false, reason: "empty_query" };

      // The DAG runner: prefer an injected combined dispatcher (reaches
      // lens-actions like the CAS); fall back to ctx.runMacro if the server
      // threaded one onto ctx; never silently no-op.
      const dispatch = runMacro || ctx?.runMacro;
      if (typeof dispatch !== "function") {
        return { ok: false, reason: "no_dispatcher" };
      }

      const candidates =
        (Array.isArray(input.candidates) && input.candidates.length && input.candidates) ||
        (Array.isArray(depsCandidates) && depsCandidates.length && depsCandidates) ||
        DEFAULT_CANDIDATES;

      // 1. TOP — parse NL → validated intent.
      const parsed = await parseIntent(query, { candidates, llmFn: parseLlmFn });
      if (!parsed.ok) {
        return { ok: false, reason: parsed.reason || "parse_failed", stage: "parse" };
      }

      // 2. MIDDLE — deterministic intent → plan.
      const routed = routeToPlan(parsed, { rules });
      if (!routed.ok) {
        return { ok: false, reason: routed.reason || "no_route", stage: "route", parsed: parsed.steps };
      }

      // 3. MIDDLE — deterministic execution.
      const dagOut = await runDag(routed.plan, ctx, dispatch);
      const resultData = extractResultData(dagOut, routed.plan);

      // 4. BOTTOM — verified formatting.
      const requesterId = input.requesterId || ctx?.actor?.userId || null;
      const formatted = await formatResult(resultData, {
        claimText: query,
        db: ctx?.db || deps?.db || null,
        requesterId,
        citationIds: Array.isArray(input.citationIds) ? input.citationIds : [],
        llmFn: formatLlmFn,
        useLlm: input.useLlm !== false,
      });

      return {
        ok: dagOut.ok !== false,
        result: resultData,
        dag: { ok: dagOut.ok !== false, order: dagOut.order, errors: dagOut.errors },
        prose: formatted.prose,
        verified: formatted.verified,
        verdict: formatted.verdict,
        usedTemplate: formatted.usedTemplate,
        invented: formatted.invented,
        plan: routed.plan,
        ruleId: routed.ruleId,
      };
    },
    {
      note: "verified semantic sandwich: NL → parse → deterministic macro DAG → verified format",
    },
  );
}
