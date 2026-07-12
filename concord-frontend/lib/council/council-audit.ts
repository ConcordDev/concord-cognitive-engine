/**
 * Pure, testable helpers for the council lens's Budget Simulation +
 * Process Audit panels (Wave 4 gap-closure — see
 * docs/lens-specs/council-capability-map.md).
 *
 * Both `registerLensAction("council", "simulate-budget", …)` and
 * `registerLensAction("council", "audit", …)` (server/server.js ~40272 /
 * ~40301) read ONLY from `artifact.data` — they take no useful `params`, so
 * reaching them for real requires the target artifact's stored `.data` to
 * already hold the shape they expect. For a real council Proposal artifact
 * that turned out to be safe for `simulate-budget` (see
 * `buildBudgetSimulationInput` below) but NOT safe for `audit`:
 *
 *   - `simulate-budget` reads `artifact.data.budget = { total, items }`. A
 *     Proposal has no `budget` field today (budget line items are separate
 *     linked BudgetItem artifacts, referenced by id via
 *     `proposal.linkedBudgetItems`), so writing `data.budget` via
 *     `PUT /api/lens/council/:id` (`lens.update`) before calling the action
 *     is a clean, additive write — nothing else on this page reads
 *     `proposal.data.budget`. This is wired for real in page.tsx via
 *     `useRunArtifact('council').mutateAsync({ id, action: 'simulate-budget' })`.
 *
 *   - `audit` reads `artifact.data.votes` and does `votes.map(v => v.voterId)`
 *     with no shape guard, expecting an ARRAY of {voterId, choice, weight?,
 *     timestamp?}. This page's `Proposal.votes` is a
 *     `Record<voterId, VoteChoice>` — the shape `VoteTallyBar`,
 *     `handleCastVote`, and `dashboardStats.quorumMet` all depend on
 *     everywhere else on this page. Overwriting the artifact's stored
 *     `data.votes` with an array to satisfy the macro would corrupt every
 *     other reader of that same field. (A separate, unrelated bug in
 *     `server/lib/domain-logic.js`'s council `computedFields` used to also
 *     throw on ANY update to a proposal with Record-shaped votes — verified
 *     live and fixed alongside this change — but even after that fix, the
 *     `audit` ACTION HANDLER ITSELF still assumes an array, so calling it
 *     against the real proposal is not safe without editing that macro,
 *     which is out of scope here.) So `computeProcessCompleteness` below is
 *     a faithful client-side port of the SAME 3-factor formula the macro
 *     computes (votes cast / debate present / budget present-if-required),
 *     fed from the real fields this Proposal actually has — see its own
 *     doc comment for the exact, documented substitutions.
 */

export interface BudgetSimulationInput {
  total: number;
  items: { name: string; amount: number }[];
}

export interface BudgetSimulationItemBreakdown {
  name: string;
  budgeted: number;
  low: number;
  high: number;
  expected: number;
  variance: number;
}

export interface BudgetSimulation {
  projected: number;
  totalBudgeted: number;
  range: { low: number; high: number };
  confidence: number;
  overBudgetRisk: number;
  risks: string[];
  approvalRate: number | null;
  itemBreakdown: BudgetSimulationItemBreakdown[];
  simulatedAt: string;
}

interface MinimalBudgetItem {
  id: string;
  description: string;
  category: string;
  amount: number;
}

interface MinimalProposalForBudget {
  linkedBudgetItems: string[];
}

/**
 * Assemble the `{ total, items }` shape `council.simulate-budget` expects
 * (server/server.js:40273-40274 reads `item.amount || item.cost` and
 * `item.name || item.label`) from this proposal's real linked BudgetItems.
 * Pure — does not call the API or mutate anything.
 */
export function buildBudgetSimulationInput(
  proposal: MinimalProposalForBudget,
  budgetItems: MinimalBudgetItem[]
): BudgetSimulationInput {
  const linked = proposal.linkedBudgetItems
    .map((id) => budgetItems.find((b) => b.id === id))
    .filter((b): b is MinimalBudgetItem => !!b);
  const items = linked.map((b) => ({
    name: b.description || b.category,
    amount: b.amount,
  }));
  const total = items.reduce((sum, i) => sum + i.amount, 0);
  return { total, items };
}

export interface ProcessAuditTrail {
  entityType: 'proposal';
  entityId: string;
  totalVotes: number;
  uniqueVoters: number;
  choiceTally: Record<string, number>;
  totalWeight: number;
  debateTurns: number;
  processCompleteness: number;
  voteTimeline: { voterId: string; choice: string; weight: number }[];
  lastAction: string;
  createdAt: string;
  auditedAt: string;
}

interface MinimalProposalForAudit {
  id: string;
  type: string;
  votes: Record<string, string>;
  discussion: unknown[];
  linkedBudgetItems: string[];
  updatedAt: string;
  createdAt: string;
}

/**
 * Client-side port of `registerLensAction("council", "audit", …)`
 * (server/server.js:40301-40323). See the module doc comment above for why
 * this doesn't round-trip through the real macro.
 *
 * Documented substitutions vs. the server macro (both real, not fabricated —
 * they read fields this Proposal actually has):
 *   - `hasDebate`: the macro reads a nested `artifact.data.debate.turns`
 *     array that only exists on the UNRELATED 'debate' lens-artifact type
 *     (proposals and debates are unlinked entities in this data model — a
 *     DebateSession carries no `proposalId`). This proposal's own
 *     `discussion` comments are the closest real, honest substitute for
 *     "this proposal has been deliberated on".
 *   - `hasBudget`: the macro checks `!!data.budget || !data.requiresBudget`
 *     — for a real Proposal, `data.budget` is never embedded (see
 *     `buildBudgetSimulationInput`) and `requiresBudget` is never set, so a
 *     literal port would make this factor trivially always-true. Instead
 *     this uses the real, meaningful signal: does the proposal have linked
 *     budget items (required only for `type === 'budget'` proposals, mirror
 *     of the macro's "or budget isn't required" branch).
 * `weight` is not tracked per-vote in this data model (votes are a plain
 * Record<voterId, choice>), so it defaults to 1 for every vote — the exact
 * same default the macro itself uses (`v.weight || 1`) when a vote object
 * doesn't carry one.
 */
export function computeProcessCompleteness(
  proposal: MinimalProposalForAudit,
  now: () => string = () => new Date().toISOString()
): ProcessAuditTrail {
  const voteEntries = Object.entries(proposal.votes);
  const choiceTally: Record<string, number> = {};
  let totalWeight = 0;
  for (const [, choice] of voteEntries) {
    const c = choice || 'abstain';
    choiceTally[c] = (choiceTally[c] || 0) + 1;
    totalWeight += 1;
  }
  const hasVotes = voteEntries.length > 0;
  const hasDebate = proposal.discussion.length > 0;
  const requiresBudget = proposal.type === 'budget';
  const hasBudget = proposal.linkedBudgetItems.length > 0 || !requiresBudget;
  const completeness = [hasVotes, hasDebate, hasBudget].filter(Boolean).length / 3;

  return {
    entityType: 'proposal',
    entityId: proposal.id,
    totalVotes: voteEntries.length,
    uniqueVoters: voteEntries.length, // Record keys are already unique voter ids
    choiceTally,
    totalWeight,
    debateTurns: proposal.discussion.length,
    processCompleteness: Math.round(completeness * 100) / 100,
    voteTimeline: voteEntries.slice(-20).map(([voterId, choice]) => ({ voterId, choice, weight: 1 })),
    lastAction: proposal.updatedAt,
    createdAt: proposal.createdAt,
    auditedAt: now(),
  };
}
