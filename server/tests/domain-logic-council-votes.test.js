// Regression test for a real, verified bug: server/lib/domain-logic.js's
// council `computedFields` unconditionally called `data.votes.map(...)`,
// assuming `votes` is always an array of {voterId, choice, ...} objects.
// The council lens frontend (concord-frontend/app/lenses/council/page.tsx)
// stores `Proposal.votes` as a Record<voterId, VoteChoice> instead — a real,
// live shape (every proposal is created with `votes: {}` and cast votes add
// keys to that same object). Any `lens.update` PUT on a council/proposal
// artifact therefore threw `votes.map is not a function` in computeFields,
// for every vote cast / status advance / comment / amendment — verified
// live via runMacro("lens","update",...) before this fix (see the Wave 4
// council gap-closure session that introduced _normalizeVotesForCompute).
//
// This pins the fix bidirectionally: array-shaped votes (the shape some
// other registerLensAction handlers write) still compute correctly, AND
// Record-shaped votes (the shape the real frontend uses) no longer crash
// and now compute the SAME derived fields correctly instead of just not
// throwing.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeFields, validateArtifact, DOMAIN_RULES } from "../lib/domain-logic.js";

describe("domain-logic — council computedFields handles both votes shapes", () => {
  it("array-shaped votes (pre-existing supported shape): unaffected", () => {
    const data = {
      votes: [
        { voterId: "u1", choice: "approve" },
        { voterId: "u2", choice: "approve" },
        { voterId: "u3", choice: "reject" },
      ],
    };
    const out = computeFields("council", "proposal", data);
    assert.equal(out.voteCount, 3);
    assert.equal(out.uniqueVoters, 3);
    assert.deepEqual(out.voteTally, { approve: 2, reject: 1 });
  });

  it("Record-shaped votes (the real council-lens frontend shape): does not throw, computes correctly", () => {
    const data = {
      votes: { s1: "support", s2: "oppose", s3: "support" },
    };
    assert.doesNotThrow(() => computeFields("council", "proposal", data));
    const out = computeFields("council", "proposal", { votes: { s1: "support", s2: "oppose", s3: "support" } });
    assert.equal(out.voteCount, 3);
    assert.equal(out.uniqueVoters, 3);
    assert.deepEqual(out.voteTally, { support: 2, oppose: 1 });
  });

  it("empty Record votes ({}) — the default shape on every freshly-created proposal — does not throw", () => {
    const out = computeFields("council", "proposal", { votes: {} });
    assert.equal(out.voteCount, 0);
    assert.equal(out.uniqueVoters, 0);
    assert.equal(out.voteTally, undefined); // only set when votes.length > 0
  });

  it("missing votes field: still works (backward compatible)", () => {
    const out = computeFields("council", "proposal", {});
    assert.equal(out.voteCount, 0);
    assert.equal(out.uniqueVoters, 0);
  });

  it("does NOT mutate the stored votes value itself — only adds derived fields", () => {
    const votesRecord = { s1: "support" };
    const data = { votes: votesRecord };
    const out = computeFields("council", "proposal", data);
    assert.equal(out.votes, votesRecord); // same reference, untouched
    assert.deepEqual(out.votes, { s1: "support" }); // still a Record, not converted to an array
  });

  it("scoring: Record-shaped votes now correctly count toward hasVotes (previously always false, undercounting quality score)", () => {
    const rule = DOMAIN_RULES.get("council");
    // No votes, no debate, no budget -> only the flat +0.1 base
    assert.equal(rule.scoring("proposal", {}), 0.1);
    // Record-shaped votes alone should add the 0.4 "hasVotes" weight
    assert.equal(rule.scoring("proposal", { votes: { s1: "support" } }), 0.5);
    // Array-shaped votes (pre-existing supported shape) unaffected
    assert.equal(rule.scoring("proposal", { votes: [{ voterId: "s1", choice: "support" }] }), 0.5);
  });

  it("sanity: validateArtifact still rejects an invalid council type (unrelated, unchanged behavior)", () => {
    const v = validateArtifact("council", "not-a-real-type", {}, {});
    assert.equal(v.ok, false);
  });
});
