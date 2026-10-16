// server/lib/conkay/chat/run.js
//
// One chat message -> a designed car, with no human steps when the message is complete:
//   parseChatBrief (item 1): the IR, its claims, and any questions. Questions come back to the user first; nothing
//   is run on a guess.
//   orchestrate (this item): from the body defaults (the 0.22 m tail of cad/body-params.js, the lightest
//   speed-capable drive unit) the repair table decides; the compiler's own motor repair is off, so every decision
//   is in the orchestrator's log.
//
// The car is the domain wired end to end here; beams, brackets and trusses get their evaluators with item 6.

import { parseChatBrief } from "./brief-parser.js";
import { orchestrate, carEvaluator } from "./orchestrator.js";
import { REPAIR_RULES } from "./repair-rules.js";
import { CAD_BODY_DEFAULTS } from "../cad/body-params.js";
import { carAcceptanceAsync } from "../compiler/car-from-library.js";

export async function designFromChat(text, { budget, pick, evaluate = null, onEvent = null } = {}) {
  const parsed = parseChatBrief(text);
  if (!parsed.ok) return { ok: false, stage: "parse", errors: parsed.errors };
  if (parsed.questions.length) return { ok: true, stage: "questions", domain: parsed.domain, questions: parsed.questions, claims: parsed.claims };
  if (parsed.domain !== "car") return { ok: false, stage: "orchestrate", errors: [{ error: `the orchestrator runs cars so far; ${parsed.domain} is parsed (claims attached) and waits for its evaluator` }], claims: parsed.claims };
  const initialState = {
    brief: parsed.ir.brief,
    fuelType: parsed.ir.config.fuelType,
    tailExtensionM: CAD_BODY_DEFAULTS.tailExtensionM, // the body default: the orchestrator decides any change
  };
  const run = await orchestrate({ evaluate: evaluate || carEvaluator({ carAcceptanceAsync }), rules: REPAIR_RULES, initialState, budget, pick, onEvent });
  if (!run.final) return { ok: true, stage: "infeasible", domain: "car", claims: parsed.claims, outcome: run.outcome, state: run.state, log: run.log, receiptSha256: run.receiptSha256 };
  const r = run.final.report;
  return {
    ok: true, stage: "designed", domain: "car", claims: parsed.claims, ir: parsed.ir,
    outcome: run.outcome, state: run.state, log: run.log, receiptSha256: run.receiptSha256,
    final: run.final, // the live design (its session), for follow-ups (chat/what-if.js); not serialized
    result: {
      verdict: r.verdict, topSpeed: { mph: r.topSpeed.mph, limitedBy: r.topSpeed.limitedBy, unlimitedMph: r.topSpeed.unlimitedMph },
      drive: r.selection?.engine_or_motor?.chosen, cd: run.final.envelopes.get("aero.drag-buildup@VEH")?.outputs?.dragCoefficient?.value ?? null,
      warnings: [...run.final.envelopes.values()].filter((e) => e.status === "WARN").map((e) => e.runId).sort(),
      massKg: run.final.massKg,
    },
  };
}
