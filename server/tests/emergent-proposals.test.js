// Emergent lens-action governance proposals (Q40 / audit A#24).
//
// Before this slice, a mutating emergent lens action returned a proposal
// stub that evaporated — nothing persisted, queued, decided, or applied
// it. These tests pin the lifecycle that now exists:
//
//   mutation → persisted "pending" → governance decide → apply (approved only)
//
// Run: node --test --import=./tests/preload/no-egress.mjs tests/emergent-proposals.test.js

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  executeEmergentLensAction,
  applyEmergentLensProposal,
  getLensIntegrationMetrics,
} from "../emergent/lens-integration.js";
import {
  PROPOSAL_LIMITS,
  createLensProposal,
  getLensProposal,
  listLensProposals,
  decideLensProposal,
  pruneLensProposals,
} from "../lib/emergent-proposals.js";

function makeState() {
  const artifact = { id: "art_1", domain: "whiteboard", type: "board", title: "Board" };
  return {
    lensArtifacts: new Map([[artifact.id, artifact]]),
    dtus: new Map(),
    emergentLensProposals: new Map(),
  };
}

function mutate(STATE, extra = {}) {
  return executeEmergentLensAction(STATE, {
    emergentId: "em_1",
    artifactId: "art_1",
    action: "delete",
    params: { hard: true },
    justification: "cleanup",
    ...extra,
  });
}

test("mutation returns a persisted pending proposal (not an evaporating stub)", () => {
  const STATE = makeState();
  const before = getLensIntegrationMetrics().metrics.emergentProposals;
  const r = mutate(STATE);
  assert.equal(r.ok, true);
  assert.equal(r.executed, false);
  assert.equal(r.requiresGovernance, true);
  assert.ok(r.proposalId, "proposalId returned");
  const stored = getLensProposal(STATE, r.proposalId);
  assert.ok(stored, "proposal is in the store");
  assert.equal(stored.status, "pending");
  assert.equal(stored.action, "delete");
  assert.equal(stored.domain, "whiteboard");
  assert.equal(stored.emergentId, "em_1");
  assert.deepEqual(stored.params, { hard: true });
  assert.equal(getLensIntegrationMetrics().metrics.emergentProposals, before + 1, "metric increments");
});

test("safe actions still execute immediately through the runner", () => {
  const STATE = makeState();
  const r = executeEmergentLensAction(STATE, {
    emergentId: "em_1",
    artifactId: "art_1",
    action: "analyze",
    params: {},
    runMacro: (domain, action, input) => ({ domain, action, echoed: input.id }),
  });
  assert.equal(r.ok, true);
  assert.equal(r.executed, true);
  assert.equal(r.result.echoed, "art_1");
  assert.equal(listLensProposals(STATE).length, 0, "no proposal created for a safe action");
});

test("list filters by status and get round-trips", () => {
  const STATE = makeState();
  const a = mutate(STATE).proposalId;
  mutate(STATE, { params: { hard: false } });
  assert.equal(listLensProposals(STATE).length, 2);
  assert.equal(listLensProposals(STATE, { status: "pending" }).length, 2);
  decideLensProposal(STATE, a, { decision: "rejected", decidedBy: "root", decidedByRole: "founder" });
  assert.equal(listLensProposals(STATE, { status: "pending" }).length, 1);
  assert.equal(listLensProposals(STATE, { status: "rejected" }).length, 1);
  assert.equal(getLensProposal(STATE, "elp_nope"), null);
});

test("decide authorization matrix: only human governance roles may decide", () => {
  const STATE = makeState();
  const id = mutate(STATE).proposalId;
  // An emergent can never decide — including its own proposal.
  assert.equal(decideLensProposal(STATE, id, { decision: "approved", decidedBy: "em_1", decidedByRole: "emergent" }).error, "not_governance_role");
  // Ordinary users cannot decide.
  assert.equal(decideLensProposal(STATE, id, { decision: "approved", decidedBy: "u1", decidedByRole: "user" }).error, "not_governance_role");
  // No role cannot decide.
  assert.equal(decideLensProposal(STATE, id, { decision: "approved", decidedBy: "u1" }).error, "not_governance_role");
  // Bad decision value from a governance role.
  assert.equal(decideLensProposal(STATE, id, { decision: "maybe", decidedBy: "root", decidedByRole: "admin" }).error, "invalid_decision");
  // Unknown proposal.
  assert.equal(decideLensProposal(STATE, "elp_nope", { decision: "approved", decidedBy: "root", decidedByRole: "admin" }).error, "proposal_not_found");
  // A governance role can decide, and the decision is recorded + immutable.
  const ok = decideLensProposal(STATE, id, { decision: "approved", decidedBy: "root", decidedByRole: "admin" });
  assert.equal(ok.ok, true);
  assert.equal(ok.proposal.status, "approved");
  assert.equal(ok.proposal.decidedBy, "root");
  assert.ok(ok.proposal.decidedAt);
  const again = decideLensProposal(STATE, id, { decision: "rejected", decidedBy: "root", decidedByRole: "admin" });
  assert.equal(again.error, "already_decided");
  assert.equal(getLensProposal(STATE, id).status, "approved", "first decision stands");
});

test("apply refuses from pending and from rejected — nothing applies without approval", () => {
  const STATE = makeState();
  const runner = () => ({ done: true });
  const pendingId = mutate(STATE).proposalId;
  const fromPending = applyEmergentLensProposal(STATE, pendingId, { runMacro: runner });
  assert.equal(fromPending.ok, false);
  assert.equal(fromPending.error, "proposal_not_applicable");

  const rejectedId = mutate(STATE).proposalId;
  decideLensProposal(STATE, rejectedId, { decision: "rejected", decidedBy: "root", decidedByRole: "sovereign" });
  const fromRejected = applyEmergentLensProposal(STATE, rejectedId, { runMacro: runner });
  assert.equal(fromRejected.ok, false);
  assert.equal(fromRejected.error, "proposal_not_applicable");
  assert.equal(getLensProposal(STATE, rejectedId).status, "rejected", "rejection is terminal");

  assert.equal(applyEmergentLensProposal(STATE, "elp_nope", { runMacro: runner }).error, "proposal_not_found");
});

test("approved proposal applies through the macro path and records the result", () => {
  const STATE = makeState();
  const id = mutate(STATE).proposalId;
  decideLensProposal(STATE, id, { decision: "approved", decidedBy: "root", decidedByRole: "owner" });
  const seen = [];
  const r = applyEmergentLensProposal(STATE, id, {
    runMacro: (domain, action, input, ctx) => {
      seen.push({ domain, action, input, role: ctx.actor.role, internal: ctx.internal });
      return { mutated: true };
    },
  });
  assert.equal(r.ok, true);
  assert.equal(r.executed, true);
  assert.deepEqual(r.result, { mutated: true });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].input.action, "delete", "the stored action is what runs");
  assert.deepEqual(seen[0].input.params, { hard: true }, "the stored params are what run");
  const stored = getLensProposal(STATE, id);
  assert.equal(stored.status, "applied");
  assert.deepEqual(stored.applyResult, { mutated: true });
  assert.ok(stored.appliedAt);
});

test("apply failure is recorded as apply_failed and can be retried", () => {
  const STATE = makeState();
  const id = mutate(STATE).proposalId;
  decideLensProposal(STATE, id, { decision: "approved", decidedBy: "root", decidedByRole: "admin" });
  const bad = applyEmergentLensProposal(STATE, id, {
    runMacro: () => { throw new Error("macro exploded"); },
  });
  assert.equal(bad.ok, false);
  let stored = getLensProposal(STATE, id);
  assert.equal(stored.status, "apply_failed");
  assert.match(stored.applyError, /macro exploded/);
  const good = applyEmergentLensProposal(STATE, id, { runMacro: () => ({ retried: true }) });
  assert.equal(good.ok, true);
  stored = getLensProposal(STATE, id);
  assert.equal(stored.status, "applied");
  assert.equal(stored.applyError, null);
});

test("apply against a vanished artifact records apply_failed honestly", () => {
  const STATE = makeState();
  const id = mutate(STATE).proposalId;
  decideLensProposal(STATE, id, { decision: "approved", decidedBy: "root", decidedByRole: "admin" });
  STATE.lensArtifacts.delete("art_1");
  const r = applyEmergentLensProposal(STATE, id, { runMacro: () => ({}) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "artifact_not_found");
  assert.equal(getLensProposal(STATE, id).status, "apply_failed");
});

// ── Review HOLD (Q40): bounded store, no spoofed deciders ──────────────────

test("an identical pending proposal is returned, not duplicated", () => {
  const STATE = makeState();
  const a = mutate(STATE);
  const b = mutate(STATE);
  assert.equal(b.proposalId, a.proposalId);
  assert.equal(b.deduped, true);
  assert.equal(listLensProposals(STATE).length, 1);
  // Once decided, the same request is a new proposal.
  decideLensProposal(STATE, a.proposalId, { decision: "rejected", decidedBy: "root", decidedByRole: "admin" });
  assert.notEqual(mutate(STATE).proposalId, a.proposalId);
});

test("pending proposals are capped per emergent", () => {
  const STATE = makeState();
  for (let i = 0; i < PROPOSAL_LIMITS.maxPendingPerEmergent; i++) {
    assert.equal(mutate(STATE, { params: { i } }).ok, true);
  }
  const over = mutate(STATE, { params: { i: "one-too-many" } });
  assert.equal(over.ok, false);
  assert.equal(over.error, "emergent_pending_cap");
  assert.equal(listLensProposals(STATE).length, PROPOSAL_LIMITS.maxPendingPerEmergent);
  // A different emergent still has room.
  assert.equal(mutate(STATE, { emergentId: "em_2" }).ok, true);
});

test("the pending queue is capped globally", () => {
  const STATE = makeState();
  const per = PROPOSAL_LIMITS.maxPendingPerEmergent;
  for (let i = 0; i < PROPOSAL_LIMITS.maxPending; i++) {
    const r = createLensProposal(STATE, { emergentId: `em_${Math.floor(i / per)}`, artifactId: "art_1", action: "delete", params: { i } });
    assert.equal(r.ok, true, `proposal ${i}`);
  }
  const over = createLensProposal(STATE, { emergentId: "em_fresh", artifactId: "art_1", action: "delete", params: {} });
  assert.equal(over.ok, false);
  assert.equal(over.error, "proposal_queue_full");
  assert.equal(STATE.emergentLensProposals.size, PROPOSAL_LIMITS.maxPending);
});

test("stale pending proposals expire and free the cap", () => {
  const STATE = makeState();
  const now = Date.now();
  const old = new Date(now - PROPOSAL_LIMITS.pendingTtlMs - 1000).toISOString();
  const r = createLensProposal(STATE, { emergentId: "em_1", artifactId: "art_1", action: "delete", params: {}, createdAt: old }, { now });
  assert.equal(r.ok, true);
  assert.equal(pruneLensProposals(STATE, now).expired, 1);
  assert.equal(getLensProposal(STATE, r.proposal.id).status, "expired");
  assert.equal(listLensProposals(STATE, { status: "pending" }).length, 0);
  // An expired proposal can no longer be decided.
  assert.equal(decideLensProposal(STATE, r.proposal.id, { decision: "approved", decidedBy: "root", decidedByRole: "admin" }).error, "already_decided");
});

test("old terminal records are pruned past the retention size; pending ones never are", () => {
  const STATE = makeState();
  const store = STATE.emergentLensProposals;
  const t0 = Date.now() - 60_000;
  for (let i = 0; i < PROPOSAL_LIMITS.maxStored + 50; i++) {
    store.set(`elp_old_${i}`, { id: `elp_old_${i}`, status: "rejected", createdAt: new Date(t0 + i).toISOString() });
  }
  store.set("elp_pending", { id: "elp_pending", status: "pending", createdAt: new Date(t0 - 1).toISOString() });
  const { pruned } = pruneLensProposals(STATE);
  assert.equal(pruned, 51);
  assert.equal(store.size, PROPOSAL_LIMITS.maxStored);
  assert.ok(store.has("elp_pending"), "pending proposals are never pruned for size");
  assert.ok(!store.has("elp_old_0"), "oldest terminal record goes first");
});

test("an emergent or internal actor can never decide, even with role owner", () => {
  const STATE = makeState();
  const id = mutate(STATE).proposalId;
  // _executeViaMacro elevates emergent ctx to role "owner" + internal.
  assert.equal(decideLensProposal(STATE, id, { decision: "approved", decidedBy: "emergent:em_1", decidedByRole: "owner" }).error, "emergent_cannot_decide");
  assert.equal(decideLensProposal(STATE, id, { decision: "approved", decidedBy: "system", decidedByRole: "owner", internal: true }).error, "emergent_cannot_decide");
  assert.equal(getLensProposal(STATE, id).status, "pending");
});

test("the submitting actor is recorded on the proposal", () => {
  const STATE = makeState();
  const r = mutate(STATE, { submittedBy: "emergent:em_1" });
  assert.equal(getLensProposal(STATE, r.proposalId).submittedBy, "emergent:em_1");
});
