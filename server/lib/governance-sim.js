// server/lib/governance-sim.js
//
// Governance Proposal Simulator (#41) — a deterministic policy-impact projector
// for the governed economic constants (lib/governance.js#GOVERNED_CONSTANTS).
// Given a proposal's (constant_path, current → proposed) delta, it runs a fixed
// reference scenario (a sample sale + a sample royalty lineage) through the
// constant BOTH ways and reports the projected change — the agent-based "what if
// this passes" computational laboratory, but closed-form and deterministic.
//
// It NEVER mutates a live constant; it projects on a snapshot. Royalty math here
// mirrors the real cascade shape for projection only — the constitutional
// constants in code are the source of truth.

const SAMPLE_SALE = 100;        // CC — reference sale price
const SAMPLE_LINEAGE_DEPTH = 5; // ancestors deep for the royalty projection
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const round = (v) => Math.round(v * 10000) / 10000;

/** Project the reference scenario for a single constant value. Pure. */
function projectScenario(constantPath, value) {
  const v = num(value);
  switch (constantPath) {
    case "marketplace.platform_fee_rate":
      return { metric: "creator pool on a 100 CC sale", value: round(SAMPLE_SALE * (1 - v)), unit: "CC", note: `platform keeps ${round(SAMPLE_SALE * v)} CC` };
    case "marketplace.creator_share":
      return { metric: "creator take of the 100 CC creator pool", value: round(SAMPLE_SALE * v), unit: "CC" };
    case "marketplace.royalty_share":
      return { metric: "royalty pool from a 100 CC sale", value: round(SAMPLE_SALE * v), unit: "CC" };
    case "marketplace.treasury_share":
      return { metric: "treasury take of a 100 CC sale", value: round(SAMPLE_SALE * v), unit: "CC" };
    case "royalty.initial_rate":
    case "royalty.halving":
    case "royalty.floor":
    case "royalty.max_rate":
    case "royalty.max_cascade_depth":
      return { metric: "total ancestor royalty on a 100 CC sale (5-deep lineage)", value: round(projectCascade(constantPath, v) * SAMPLE_SALE), unit: "CC" };
    case "withdrawals.hold_hours":
      return { metric: "time until earned CC is withdrawable", value: round(v), unit: "hours" };
    default:
      return { metric: constantPath, value: v, unit: "raw" };
  }
}

// Reference royalty-cascade total (as a fraction of sale) using whichever
// constant is being varied; the others use their documented defaults.
function projectCascade(varyPath, varyValue) {
  const c = {
    initial: varyPath === "royalty.initial_rate" ? varyValue : 0.21,
    halving: varyPath === "royalty.halving" ? Math.max(1.01, varyValue) : 2,
    floor: varyPath === "royalty.floor" ? varyValue : 0.0005,
    maxRate: varyPath === "royalty.max_rate" ? varyValue : 0.30,
    depth: varyPath === "royalty.max_cascade_depth" ? Math.floor(varyValue) : SAMPLE_LINEAGE_DEPTH,
  };
  let total = 0;
  let rate = c.initial;
  for (let i = 0; i < Math.min(c.depth, 50); i++) {
    const applied = Math.max(rate, c.floor);
    if (total + applied > c.maxRate) { total = c.maxRate; break; }
    total += applied;
    rate = rate / c.halving;
  }
  return Math.min(total, c.maxRate);
}

/**
 * Project a proposal's impact: run the reference scenario at current vs proposed.
 * Returns { ok, constantPath, baseline, projected, delta, deltaPct, summary }.
 * Pure — no DB.
 */
export function projectImpact(constantPath, currentValue, proposedValue) {
  if (!constantPath) return { ok: false, reason: "no_constant" };
  const baseline = projectScenario(constantPath, currentValue);
  const projected = projectScenario(constantPath, proposedValue);
  const delta = round(projected.value - baseline.value);
  const deltaPct = baseline.value !== 0 ? round((delta / Math.abs(baseline.value)) * 100) : null;
  const dir = delta > 0 ? "increase" : delta < 0 ? "decrease" : "no change";
  const summary = `If passed, ${baseline.metric} would ${dir} from ${baseline.value} to ${projected.value} ${baseline.unit}` +
    (deltaPct != null ? ` (${deltaPct > 0 ? "+" : ""}${deltaPct}%).` : ".");
  return { ok: true, constantPath, baseline, projected, delta, deltaPct, summary };
}

/** Simulate a stored proposal and cache the projection. Returns the projection. */
export function simulateProposal(db, proposalId) {
  if (!db || !proposalId) return { ok: false, reason: "missing_proposal" };
  const p = db.prepare(`SELECT id, constant_path, current_value, proposed_value FROM governance_proposals WHERE id = ?`).get(proposalId);
  if (!p) return { ok: false, reason: "proposal_not_found" };
  const proj = projectImpact(p.constant_path, p.current_value, p.proposed_value);
  if (!proj.ok) return proj;
  try {
    db.prepare(`
      INSERT INTO governance_simulations (proposal_id, constant_path, baseline_json, projected_json, summary, computed_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(proposal_id) DO UPDATE SET baseline_json = excluded.baseline_json,
        projected_json = excluded.projected_json, summary = excluded.summary, computed_at = unixepoch()
    `).run(proposalId, p.constant_path, JSON.stringify(proj.baseline), JSON.stringify(proj.projected), proj.summary);
  } catch { /* cache write best-effort */ }
  return { ok: true, proposalId, ...proj };
}

/** Read a cached simulation. */
export function getSimulation(db, proposalId) {
  if (!db || !proposalId) return null;
  try {
    const r = db.prepare(`SELECT constant_path AS constantPath, baseline_json, projected_json, summary, computed_at AS computedAt FROM governance_simulations WHERE proposal_id = ?`).get(proposalId);
    if (!r) return null;
    return { ...r, baseline: JSON.parse(r.baseline_json || "{}"), projected: JSON.parse(r.projected_json || "{}") };
  } catch {
    return null;
  }
}

export default { projectImpact, simulateProposal, getSimulation };
