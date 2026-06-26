// server/lib/sandwich/router.js
//
// Router — the DETERMINISTIC MIDDLE of the verified sandwich.
//
// Maps a parsed intent (the validated { steps:[{domain,name,input}] } from the
// parse gate) onto a real `macro_dag` plan: steps with stable ids, dependency
// edges, and `${steps.<id>.result.<path>}` threading between them. This is the
// part that must be trustworthy — it is pure data transformation on CPU, no
// model, no acceleration, no randomness.
//
// Routing strategy (deterministic-first, honest):
//   1. RULES: keyword/shape rules match a known chainable workflow and emit a
//      hand-authored multi-step plan (e.g. derivative → simplify on the CAS).
//      These are the cases where the macro outputs genuinely thread together.
//   2. PASSTHROUGH: if no chain rule matches, fall back to a 1:1 plan — one DAG
//      step per parsed step, in order, with no inter-step threading. This is
//      the correct behavior for direct single-tool calls.
//   3. If even passthrough can't produce a valid step (e.g. zero parsed steps),
//      return { ok:false, reason:'no_route' } — explicit, never a silent
//      mis-pick.
//
// An LLM router fallback is intentionally NOT included: the parse gate already
// did the NL→intent translation under schema constraint. Routing intent→plan is
// a deterministic mapping and keeping a model out of it is the whole point of
// the "deterministic middle".

/**
 * Built-in chain rules. Each rule:
 *   match(steps): boolean — does this parsed intent fit the chainable shape?
 *   build(steps): { steps:[...] } — the macro_dag plan with ${steps...} threading.
 *
 * Rules are tried in order; first match wins. Seeded with REAL chainable math
 * workflows (the CAS macros' outputs are strings the next CAS call can consume).
 */
export const DEFAULT_RULES = [
  {
    id: "cas_derivative_then_simplify",
    description:
      "When the user asks for a derivative AND wants it simplified, run math.symbolicCompute(derivative) then feed its output expression into math.symbolicCompute(simplify).",
    match(steps) {
      if (steps.length !== 1) return false;
      const s = steps[0];
      if (s.domain !== "math" || s.name !== "symbolicCompute") return false;
      const op = String(s.input?.operation || "").toLowerCase();
      const wantsSimplify =
        s.input?.simplify === true || s.input?.thenSimplify === true;
      return (op === "derivative" || op === "differentiate") && wantsSimplify;
    },
    build(steps) {
      const s = steps[0];
      return {
        steps: [
          {
            id: "deriv",
            macro: "math.symbolicCompute",
            input: {
              operation: "derivative",
              expression: s.input.expression,
              variable: s.input.variable || "x",
            },
          },
          {
            id: "simplified",
            macro: "math.symbolicCompute",
            // The derivative step returns { ok, result: { derivative: "<expr>" } }.
            // Thread that expression string into a simplify pass.
            input: {
              operation: "simplify",
              expression: "${steps.deriv.result.derivative}",
            },
            dependsOn: ["deriv"],
          },
        ],
      };
    },
  },
];

/**
 * Convert one parsed step into a DAG step with a stable id.
 */
function passthroughStep(parsed, index) {
  return {
    id: `s${index}`,
    macro: `${parsed.domain}.${parsed.name}`,
    input: parsed.input || {},
  };
}

/**
 * Route a parsed intent to an executable macro_dag plan.
 *
 * @param {{ ok:boolean, steps:Array<{domain,name,input}> }} parsed
 * @param {{ rules?: Array }} opts
 * @returns {{ ok:true, plan:object, ruleId:string|null } | { ok:false, reason:string }}
 */
export function routeToPlan(parsed, { rules = DEFAULT_RULES } = {}) {
  if (!parsed || parsed.ok === false) return { ok: false, reason: "no_route" };
  const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
  if (steps.length === 0) return { ok: false, reason: "no_route" };

  // 1. Deterministic chain rules first.
  for (const rule of rules || []) {
    try {
      if (typeof rule?.match === "function" && rule.match(steps)) {
        const plan = rule.build(steps);
        if (plan && Array.isArray(plan.steps) && plan.steps.length > 0) {
          return { ok: true, plan, ruleId: rule.id || null };
        }
      }
    } catch {
      // A throwing rule must never silently mis-route — skip it and continue.
      continue;
    }
  }

  // 2. Passthrough — one DAG step per parsed step, in order, no threading.
  const planSteps = steps.map((s, i) => {
    if (!s || !s.domain || !s.name) return null;
    return passthroughStep(s, i);
  });
  if (planSteps.some((s) => s === null)) return { ok: false, reason: "no_route" };

  return { ok: true, plan: { steps: planSteps }, ruleId: null };
}

export default { routeToPlan, DEFAULT_RULES };
