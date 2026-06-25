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
 * The real default maker: calls the actual conscious brain (byo-router#brainChat)
 * to PROPOSE, folding the checker's prior dissent into the next prompt. There is
 * NO placeholder — when no brain is reachable it returns { unavailable: true } so
 * the loop reports honestly rather than fabricating a proposal.
 */
export async function brainMaker(db, userId, goal, round, priorDissent) {
  let brainChat;
  try { ({ brainChat } = await import("./byo-router.js")); } catch { return { text: "", unavailable: true }; }
  const dissentNote = (priorDissent && priorDissent.length)
    ? `Address these concerns raised in the last review: ${priorDissent.map((d) => d.concern || d.voice).join("; ")}.`
    : "";
  const messages = [
    { role: "system", content: "You are the MAKER in a maker-checker loop. Produce one concrete, well-evidenced, feasible proposal. Be specific; cite what grounds it; name a first step. Return the proposal text only." },
    { role: "user", content: `Goal: ${goal}\nRound ${round}. ${dissentNote}` },
  ];
  try {
    const r = await brainChat({ db, userId: userId || null, slot: "conscious", messages });
    const text = String(r?.text || "").trim();
    return text ? { text } : { text: "", unavailable: true };
  } catch {
    return { text: "", unavailable: true };
  }
}

/**
 * Run the maker-checker loop.
 * @param {object} db
 * @param {object} opts
 * @param {string}   opts.goal       what to produce
 * @param {function} opts.maker      async (goal, round, priorDissent) => { text, unavailable? }
 *                                   (default: the REAL brain maker — no placeholder)
 * @param {function} opts.checker    (proposalText) => { accept, confidence, verdict, dissent }
 *                                   (default: the deterministic shadow council)
 * @param {number}   opts.maxRounds  cap (default 3)
 * @param {string}   opts.userId     actor for the brain maker's per-user routing
 * @returns {{ok, accepted, rounds, finalProposal, summary, makerUnavailable?}}
 */
export async function runMakerChecker(db, { goal, maker, checker, maxRounds = DEFAULT_MAX_ROUNDS, userId = null } = {}) {
  const g = String(goal || "").trim();
  if (!g) return { ok: false, reason: "no_goal" };
  const rounds = Math.min(Math.max(Number(maxRounds) || DEFAULT_MAX_ROUNDS, 1), 6);
  const mk = typeof maker === "function" ? maker : (goalText, round, dissent) => brainMaker(db, userId, goalText, round, dissent);
  const ck = typeof checker === "function" ? checker : (text) => councilChecker(db, text);

  const log = [];
  let priorDissent = [];
  let finalProposal = null;
  let accepted = false;

  for (let round = 1; round <= rounds; round++) {
    let proposal;
    try { proposal = await mk(g, round, priorDissent); } catch (e) { proposal = { text: "", error: String(e?.message || e) }; }
    // Honest degradation: a real maker that can't reach a brain stops the loop
    // with makerUnavailable — it does NOT invent a proposal.
    if (proposal && proposal.unavailable) {
      return { ok: true, accepted: false, rounds: log, finalProposal, makerUnavailable: true, summary: "maker (brain) unavailable — no proposal produced" };
    }
    const text = typeof proposal === "string" ? proposal : (proposal?.text || "");
    const verdict = await ck(text, { round });
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

/**
 * Dispatch: run maker-checker over a list of sub-goals (e.g. a planner's next
 * actionable milestones). Each is independent; returns per-goal outcomes.
 */
export async function dispatchMakerChecker(db, { goals = [], maker, checker, maxRounds, userId } = {}) {
  const list = (Array.isArray(goals) ? goals : []).map((g) => (typeof g === "string" ? g : g?.title)).filter(Boolean);
  const results = [];
  for (const g of list) {
    results.push({ goal: g, ...(await runMakerChecker(db, { goal: g, maker, checker, maxRounds, userId })) });
  }
  return { ok: true, dispatched: results.length, results };
}

export default { runMakerChecker, dispatchMakerChecker, councilChecker, DEFAULT_MAX_ROUNDS };
