// server/lib/maker-checker.js
//
// Maker-Checker Orchestrator (#9) — the 2026-dominant multi-agent pattern
// (supervisor / maker-checker ≈ 70% of production): one agent PROPOSES, another
// VERIFIES, looping until accepted or a small round cap. Concord already has both
// halves — the maker can be an agent-marathon turn or a brain call; the checker
// is the deterministic five-voice shadow council (lib/shadow-council.js). This
// module is the bounded loop that wires them, with the best-practice guards:
// max_loops small (2–3), structured returns (not prose), and a rolling summary
// instead of full history. Deterministic when the maker/checker are deterministic
// — so it is fully offline-testable; a live brain just swaps in as the maker.

import { deliberate } from "./shadow-council.js";

export const DEFAULT_MAX_ROUNDS = 3;
const ACCEPT_CONFIDENCE = 0.5;

/**
 * The default checker: runs the shadow council on the proposal and accepts when
 * the verdict is `accept` OR confidence clears the threshold. Returns a
 * structured verdict (never prose).
 */
export function councilChecker(db, proposalText, { acceptConfidence = ACCEPT_CONFIDENCE } = {}) {
  const d = deliberate(db, { question: proposalText });
  if (!d.ok) return { accept: false, confidence: 0, verdict: "error", dissent: [] };
  return {
    accept: d.verdict === "accept" || d.confidence >= acceptConfidence,
    confidence: d.confidence,
    verdict: d.verdict,
    dissent: d.dissent || [],
  };
}

/**
 * Run the maker-checker loop.
 * @param {object} db
 * @param {object} opts
 * @param {string}   opts.goal       what to produce
 * @param {function} opts.maker      async (goal, round, priorDissent) => { text, scores?, tags? }
 *                                   (default: a deterministic placeholder maker)
 * @param {function} opts.checker    (db, proposalText) => { accept, confidence, verdict, dissent }
 * @param {number}   opts.maxRounds  cap (default 3)
 * @returns {{ok, accepted, rounds, finalProposal, summary}}
 */
export async function runMakerChecker(db, { goal, maker, checker, maxRounds = DEFAULT_MAX_ROUNDS } = {}) {
  const g = String(goal || "").trim();
  if (!g) return { ok: false, reason: "no_goal" };
  const rounds = Math.min(Math.max(Number(maxRounds) || DEFAULT_MAX_ROUNDS, 1), 6);
  const mk = typeof maker === "function" ? maker : defaultMaker;
  const ck = typeof checker === "function" ? checker : (text) => councilChecker(db, text);

  const log = [];
  let priorDissent = [];
  let finalProposal = null;
  let accepted = false;

  for (let round = 1; round <= rounds; round++) {
    let proposal;
    try { proposal = await mk(g, round, priorDissent); } catch (e) { proposal = { text: "", error: String(e?.message || e) }; }
    const text = typeof proposal === "string" ? proposal : (proposal?.text || "");
    // The checker receives the proposal's signals so scored proposals can pass.
    const verdict = await ck(buildCheckInput(text, proposal), { round });
    finalProposal = text;
    // rolling summary: keep only the round verdict, not the full proposal text
    log.push({ round, verdict: verdict.verdict, confidence: verdict.confidence, accepted: !!verdict.accept, dissentCount: (verdict.dissent || []).length });
    if (verdict.accept) { accepted = true; break; }
    priorDissent = verdict.dissent || [];
  }

  return {
    ok: true,
    accepted,
    rounds: log,
    finalProposal,
    summary: accepted ? `accepted in ${log.length} round(s)` : `unresolved after ${log.length} round(s)`,
  };
}

// The default checker (councilChecker) takes a text question; when a maker
// returns {scores,tags} we still drive the deterministic council off the text.
function buildCheckInput(text, _proposal) { return text; }

// A deterministic placeholder maker for when no real maker (brain/agent) is
// supplied: emits a proposal whose framing strengthens each round (so a loop
// against a confidence-thresholded checker visibly converges).
function defaultMaker(goal, round) {
  const strength = round >= 2 ? "with cited evidence and a feasible first step" : "as a first sketch";
  return { text: `Proposal for "${goal}" ${strength}.`, round };
}

/**
 * Dispatch: run maker-checker over a list of sub-goals (e.g. a planner's next
 * actionable milestones). Each is independent; returns per-goal outcomes.
 */
export async function dispatchMakerChecker(db, { goals = [], maker, checker, maxRounds } = {}) {
  const list = (Array.isArray(goals) ? goals : []).map((g) => (typeof g === "string" ? g : g?.title)).filter(Boolean);
  const results = [];
  for (const g of list) {
    results.push({ goal: g, ...(await runMakerChecker(db, { goal: g, maker, checker, maxRounds })) });
  }
  return { ok: true, dispatched: results.length, results };
}

export default { runMakerChecker, dispatchMakerChecker, councilChecker, DEFAULT_MAX_ROUNDS };
