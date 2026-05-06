// server/domains/council.js
//
// Deterministic per-voice scoring heuristic: counts how many of the voice's
// "lens" keywords (split on whitespace, lowered, len ≥ 4) appear as
// case-insensitive substrings in the proposal text. The keyword-hit ratio
// maps to a delta of ±20 around a neutral 50 anchor. Same proposal +
// same voices → same score (no flakiness). Real LLM-scored deliberation
// is the council brain's job (see lib/council-world-bridge.js); this
// macro is the lightweight analytical lens that doesn't pay LLM cost.
function _voiceScoreFromLens(proposalText, lens) {
  const text = String(proposalText || "").toLowerCase();
  const tokens = String(lens || "general governance").toLowerCase().split(/\s+/).filter(t => t.length >= 4);
  if (tokens.length === 0 || text.length === 0) return 50;
  const hits = tokens.filter(t => text.includes(t)).length;
  const ratio = hits / tokens.length; // 0..1
  return Math.round(50 + (ratio * 40 - 20)); // 30..70 range
}

export default function registerCouncilActions(registerLensAction) {
  registerLensAction("council", "deliberate", (ctx, artifact, _params) => {
    const proposal = artifact.data?.proposal || artifact.data?.description || "";
    const voices = artifact.data?.voices || [];
    if (!proposal) return { ok: true, result: { message: "Submit a proposal for council deliberation." } };
    const perspectives = [
      { voice: "Pragmatist", weight: 0.3, lens: "feasibility and resource cost" },
      { voice: "Ethicist", weight: 0.25, lens: "moral implications and fairness" },
      { voice: "Innovator", weight: 0.2, lens: "novelty and growth potential" },
      { voice: "Guardian", weight: 0.25, lens: "risk and stability" },
    ];
    const evaluations = (voices.length > 0 ? voices : perspectives).map(v => {
      const lens = v.lens || "general governance";
      const score = _voiceScoreFromLens(proposal, lens);
      return { voice: v.voice || v.name, weight: v.weight || 0.25, score, position: score >= 60 ? "support" : score >= 40 ? "neutral" : "oppose", reasoning: `Evaluated through the lens of ${lens}` };
    });
    const weightedScore = Math.round(evaluations.reduce((s, e) => s + e.score * (e.weight || 0.25), 0));
    return { ok: true, result: { proposal: proposal.slice(0, 200), evaluations, weightedScore, recommendation: weightedScore >= 60 ? "Proceed" : weightedScore >= 40 ? "Revise and resubmit" : "Reject", consensus: evaluations.every(e => e.position === "support") ? "unanimous" : evaluations.filter(e => e.position === "support").length > evaluations.length / 2 ? "majority" : "no-consensus" } };
  });
  registerLensAction("council", "voteCount", (ctx, artifact, _params) => {
    const votes = artifact.data?.votes || [];
    const tally = { for: 0, against: 0, abstain: 0 };
    for (const v of votes) { const pos = (v.vote || v.position || "abstain").toLowerCase(); if (pos === "for" || pos === "yes" || pos === "support") tally.for++; else if (pos === "against" || pos === "no" || pos === "oppose") tally.against++; else tally.abstain++; }
    const total = votes.length;
    const forPercent = total > 0 ? Math.round((tally.for / total) * 100) : 0;
    return { ok: true, result: { tally, total, forPercent, passed: forPercent >= 67, passThreshold: "67% supermajority", quorumMet: total >= (parseInt(artifact.data?.quorum) || 3) } };
  });
  registerLensAction("council", "generateMinutes", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const agenda = data.agenda || [];
    const attendees = data.attendees || [];
    const decisions = data.decisions || [];
    return { ok: true, result: { title: data.title || "Council Meeting Minutes", date: data.date || new Date().toISOString().split("T")[0], attendees: attendees.length, agendaItems: agenda.map((a, i) => ({ item: i + 1, topic: a.topic || a, status: a.status || "discussed" })), decisions: decisions.map(d => ({ decision: d.text || d, votedBy: d.votedBy || "council", passed: d.passed !== false })), actionItems: (data.actionItems || []).map(a => ({ task: a.task || a, assignee: a.assignee || "unassigned", dueDate: a.dueDate || "TBD" })) } };
  });
  registerLensAction("council", "conflictResolution", (ctx, artifact, _params) => {
    const parties = artifact.data?.parties || [];
    const issue = artifact.data?.issue || artifact.data?.description || "";
    const positions = parties.map(p => ({ party: p.name || p, position: p.position || "unstated", priority: p.priority || "medium" }));
    const commonGround = positions.filter(p => p.priority === "high").length > positions.length / 2 ? "shared-urgency" : "divergent-priorities";
    return { ok: true, result: { issue: issue.slice(0, 200), parties: positions, commonGround, suggestedApproach: commonGround === "shared-urgency" ? "Mediated negotiation — both sides want resolution" : "Structured dialogue — find common interests first", steps: ["Identify shared interests", "Map each party's needs vs wants", "Generate options that satisfy core needs", "Evaluate options against criteria", "Build agreement incrementally"] } };
  });
}
