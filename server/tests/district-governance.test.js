// server/tests/district-governance.test.js
//
// V1.2 Wave D — player-influenced districts governance.
//
// Grounding audit found server/lib/districts.js (migration 374) purely
// server-authored and read-only: zero player-write path existed anywhere.
// This suite pins the new propose -> vote -> resolve pipeline
// (server/lib/district-governance.js, migration 382):
//   - the eligibility gate (real world-visit minutes) genuinely rejects an
//     ineligible proposer
//   - a proposal that reaches quorum + majority genuinely mutates the REAL
//     districts.js read path's output (read before/after, prove the change)
//   - a proposal that doesn't reach quorum expires honestly, never applied
//   - a majority-against proposal is rejected, never applied
//   - a user cannot vote twice on the same proposal (composite PRIMARY KEY)
//   - the district.propose_change / district.vote / district.list_proposals
//     macros (domains/districts.js) are wired correctly end to end
//
// Run: node --test tests/district-governance.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import { seedDefaultDistricts, getDistrict } from "../lib/districts.js";
import {
  KINDS,
  MIN_QUORUM,
  MIN_RESIDENCY_MINUTES,
  computeWorldResidencyMinutes,
  proposeDistrictChange,
  castVote,
  tallyVotes,
  getProposal,
  listProposalsForDistrict,
  resolveDistrictProposals,
} from "../lib/district-governance.js";
import registerDistrictGovernanceMacros from "../domains/districts.js";

function nowS() { return Math.floor(Date.now() / 1000); }

// Running the full migration ledger is the only way to get a schema that
// matches production (migration 042 itself ALTERs a `player_world_state`
// table created by an earlier migration, so cherry-picking individual
// migrations' up() functions is not safe here — see districts.test.js,
// which does the same full-ledger setup for the same reason). Migrating
// once into a template DB and cloning it via serialize()/Database(buffer)
// for each test keeps the suite fast instead of re-running ~380 migrations
// per test.
let TEMPLATE_BUFFER;

before(async () => {
  const tmp = new Database(":memory:");
  await runMigrations(tmp);
  TEMPLATE_BUFFER = tmp.serialize();
  tmp.close();
});

function setupDb() {
  const db = new Database(TEMPLATE_BUFFER);
  seedDefaultDistricts(db, "concordia-hub");
  return db;
}

/** Insert a CLOSED world_visits row directly granting `minutes` of real playtime. */
function grantResidency(db, userId, worldId, minutes, agoS = 3600) {
  db.prepare(`
    INSERT INTO world_visits (id, user_id, world_id, arrived_at, departed_at, total_time_minutes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`wv_${userId}_${Math.random().toString(36).slice(2, 8)}`, userId, worldId, nowS() - agoS, nowS() - agoS + Math.round(minutes * 60), minutes);
}

function plazaId() { return "concordia-hub:plaza"; }

describe("computeWorldResidencyMinutes — real signal, never fabricated", () => {
  it("is honestly 0 for a user with no world_visits rows", () => {
    const db = setupDb();
    assert.equal(computeWorldResidencyMinutes(db, "ghost-user", "concordia-hub"), 0);
  });

  it("sums closed-visit minutes for a real user", () => {
    const db = setupDb();
    grantResidency(db, "u1", "concordia-hub", 12);
    grantResidency(db, "u1", "concordia-hub", 8);
    assert.equal(computeWorldResidencyMinutes(db, "u1", "concordia-hub"), 20);
  });

  it("does not count time spent in a different world", () => {
    const db = setupDb();
    grantResidency(db, "u1", "some-other-world", 50);
    assert.equal(computeWorldResidencyMinutes(db, "u1", "concordia-hub"), 0);
  });

  it("counts elapsed time of a still-open visit", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO world_visits (id, user_id, world_id, arrived_at, departed_at, total_time_minutes)
      VALUES (?, ?, ?, ?, NULL, NULL)
    `).run("wv_open", "u1", "concordia-hub", nowS() - 600); // arrived 10 min ago, still there
    const mins = computeWorldResidencyMinutes(db, "u1", "concordia-hub");
    assert.ok(mins >= 9.5 && mins <= 10.5, `expected ~10 minutes, got ${mins}`);
  });
});

describe("proposeDistrictChange — real eligibility gate", () => {
  it("REJECTS an ineligible proposer (insufficient real residency) — the gate can genuinely fail", () => {
    const db = setupDb();
    // "newcomer" has zero world_visits rows for concordia-hub — a real,
    // unforced failure of the gate, not a fabricated rejection.
    const r = proposeDistrictChange(db, plazaId(), "newcomer", "identity_tag", "The Newcomer's Row");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "ineligible_insufficient_residency");
    assert.equal(r.residencyMinutes, 0);
    assert.equal(r.minutesRequired, MIN_RESIDENCY_MINUTES);
  });

  it("ACCEPTS an eligible proposer (real recorded residency above the floor)", () => {
    const db = setupDb();
    grantResidency(db, "resident1", "concordia-hub", MIN_RESIDENCY_MINUTES + 5);
    const r = proposeDistrictChange(db, plazaId(), "resident1", "identity_tag", "The Merchants' Row");
    assert.equal(r.ok, true);
    assert.ok(r.proposalId);
    assert.ok(r.resolvesAt > nowS());
  });

  it("rejects a district that doesn't exist", () => {
    const db = setupDb();
    grantResidency(db, "resident1", "concordia-hub", 100);
    const r = proposeDistrictChange(db, "concordia-hub:nope", "resident1", "identity_tag", "X");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "district_not_found");
  });

  it("rejects an unknown kind", () => {
    const db = setupDb();
    grantResidency(db, "resident1", "concordia-hub", 100);
    const r = proposeDistrictChange(db, plazaId(), "resident1", "rename_district", "X");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_kind");
  });

  it("rejects an empty identity_tag", () => {
    const db = setupDb();
    grantResidency(db, "resident1", "concordia-hub", 100);
    const r = proposeDistrictChange(db, plazaId(), "resident1", "identity_tag", "   ");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_identity_tag");
  });

  it("rejects a palette_shift with a non-hex color", () => {
    const db = setupDb();
    grantResidency(db, "resident1", "concordia-hub", 100);
    const r = proposeDistrictChange(db, plazaId(), "resident1", "palette_shift", { accent: "notacolor" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_palette_color");
  });

  it("KINDS exports exactly the two supported kinds", () => {
    assert.deepEqual([...KINDS].sort(), ["identity_tag", "palette_shift"]);
  });
});

describe("castVote — one vote per user, real constraint", () => {
  function eligibleProposal(db, kind = "identity_tag", value = "The Guild Quarter") {
    grantResidency(db, "proposer1", "concordia-hub", 100);
    const r = proposeDistrictChange(db, plazaId(), "proposer1", kind, value);
    assert.equal(r.ok, true);
    return r.proposalId;
  }

  it("accepts a first vote and tallies it", () => {
    const db = setupDb();
    const proposalId = eligibleProposal(db);
    const r = castVote(db, proposalId, "voter1", "for");
    assert.equal(r.ok, true);
    assert.equal(r.tally.for, 1);
    assert.equal(r.tally.against, 0);
  });

  it("REJECTS a second vote from the same user on the same proposal", () => {
    const db = setupDb();
    const proposalId = eligibleProposal(db);
    const first = castVote(db, proposalId, "voter1", "for");
    assert.equal(first.ok, true);
    const second = castVote(db, proposalId, "voter1", "against");
    assert.equal(second.ok, false);
    assert.equal(second.reason, "already_voted");
    // The first vote is untouched — still exactly one row, still 'for'.
    const tally = tallyVotes(db, proposalId);
    assert.equal(tally.total, 1);
    assert.equal(tally.for, 1);
  });

  it("allows different users to each cast their own vote", () => {
    const db = setupDb();
    const proposalId = eligibleProposal(db);
    assert.equal(castVote(db, proposalId, "voter1", "for").ok, true);
    assert.equal(castVote(db, proposalId, "voter2", "for").ok, true);
    assert.equal(castVote(db, proposalId, "voter3", "against").ok, true);
    const tally = tallyVotes(db, proposalId);
    assert.equal(tally.total, 3);
    assert.equal(tally.for, 2);
    assert.equal(tally.against, 1);
  });

  it("rejects an invalid vote value", () => {
    const db = setupDb();
    const proposalId = eligibleProposal(db);
    const r = castVote(db, proposalId, "voter1", "maybe");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_vote");
  });

  it("rejects a vote on a proposal that doesn't exist", () => {
    const db = setupDb();
    const r = castVote(db, "does-not-exist", "voter1", "for");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "proposal_not_found");
  });

  it("rejects a vote once the proposal is no longer pending", () => {
    const db = setupDb();
    const proposalId = eligibleProposal(db);
    // Force-resolve it (no votes cast -> expires, quorum unmet).
    const resolved = getProposal(db, proposalId);
    resolveDistrictProposals(db, { now: resolved.resolves_at + 1 });
    const r = castVote(db, proposalId, "voter1", "for");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_pending");
    assert.equal(r.status, "expired");
  });
});

describe("resolveDistrictProposals — deterministic tally, mutates the REAL districts.js read path", () => {
  it("ACCEPTS on quorum + majority and genuinely mutates districts.js's read path (palette_shift)", () => {
    const db = setupDb();
    grantResidency(db, "proposer1", "concordia-hub", 100);

    const before = getDistrict(db, plazaId());
    assert.notEqual(before.palette.accent, "#00ff00", "sanity: not already this color");

    const propose = proposeDistrictChange(db, plazaId(), "proposer1", "palette_shift", { accent: "#00ff00" }, { durationS: 300 });
    assert.equal(propose.ok, true);

    // Real quorum + real majority: MIN_QUORUM votes cast, strictly more 'for'.
    castVote(db, propose.proposalId, "v1", "for");
    castVote(db, propose.proposalId, "v2", "for");
    castVote(db, propose.proposalId, "v3", "against");
    assert.ok(MIN_QUORUM <= 3, "test assumes default quorum <= 3 votes cast");

    const result = resolveDistrictProposals(db, { now: propose.resolvesAt + 1 });
    assert.equal(result.ok, true);
    assert.equal(result.accepted, 1);
    assert.equal(result.rejected, 0);
    assert.equal(result.expired, 0);

    const proposalRow = getProposal(db, propose.proposalId);
    assert.equal(proposalRow.status, "accepted");
    assert.ok(proposalRow.resolved_at > 0);

    // The proof: read the SAME districts.js getDistrict() path again — the
    // palette actually changed, with zero code changes to districts.js.
    const after = getDistrict(db, plazaId());
    assert.equal(after.palette.accent, "#00ff00", "districts.js read path reflects the accepted palette_shift");
    assert.equal(after.palette.primary, before.palette.primary, "un-shifted palette keys are preserved");
  });

  it("ACCEPTS an identity_tag proposal and mutates districts.js's lighting_tag read path", () => {
    const db = setupDb();
    grantResidency(db, "proposer1", "concordia-hub", 100);
    const before = getDistrict(db, plazaId());

    const propose = proposeDistrictChange(db, plazaId(), "proposer1", "identity_tag", "Merchants' Dawn", { durationS: 300 });
    assert.equal(propose.ok, true);
    castVote(db, propose.proposalId, "v1", "for");
    castVote(db, propose.proposalId, "v2", "for");
    castVote(db, propose.proposalId, "v3", "for");

    resolveDistrictProposals(db, { now: propose.resolvesAt + 1 });

    const after = getDistrict(db, plazaId());
    assert.notEqual(after.lightingTag, before.lightingTag);
    assert.equal(after.lightingTag, "Merchants' Dawn");
  });

  it("EXPIRES honestly (never applied) when quorum is not met", () => {
    const db = setupDb();
    grantResidency(db, "proposer1", "concordia-hub", 100);
    const before = getDistrict(db, plazaId());

    const propose = proposeDistrictChange(db, plazaId(), "proposer1", "palette_shift", { accent: "#123456" }, { durationS: 300 });
    // Only 1 vote cast — below MIN_QUORUM (default 3). A single vote must
    // never be able to tip a whole district.
    castVote(db, propose.proposalId, "v1", "for");

    const result = resolveDistrictProposals(db, { now: propose.resolvesAt + 1 });
    assert.equal(result.expired, 1);
    assert.equal(result.accepted, 0);

    const proposalRow = getProposal(db, propose.proposalId);
    assert.equal(proposalRow.status, "expired");

    const after = getDistrict(db, plazaId());
    assert.deepEqual(after.palette, before.palette, "an under-quorum proposal never mutates the district");
  });

  it("REJECTS (never applied) when quorum is met but there is no majority", () => {
    const db = setupDb();
    grantResidency(db, "proposer1", "concordia-hub", 100);
    const before = getDistrict(db, plazaId());

    const propose = proposeDistrictChange(db, plazaId(), "proposer1", "palette_shift", { accent: "#654321" }, { durationS: 300 });
    castVote(db, propose.proposalId, "v1", "for");
    castVote(db, propose.proposalId, "v2", "against");
    castVote(db, propose.proposalId, "v3", "against");

    const result = resolveDistrictProposals(db, { now: propose.resolvesAt + 1 });
    assert.equal(result.rejected, 1);
    assert.equal(result.accepted, 0);

    const proposalRow = getProposal(db, propose.proposalId);
    assert.equal(proposalRow.status, "rejected");

    const after = getDistrict(db, plazaId());
    assert.deepEqual(after.palette, before.palette, "a rejected proposal never mutates the district");
  });

  it("a tie (equal for/against) does not pass — strict majority required", () => {
    const db = setupDb();
    grantResidency(db, "proposer1", "concordia-hub", 100);
    const propose = proposeDistrictChange(db, plazaId(), "proposer1", "palette_shift", { accent: "#111111" }, { durationS: 300 });
    castVote(db, propose.proposalId, "v1", "for");
    castVote(db, propose.proposalId, "v2", "against");
    castVote(db, propose.proposalId, "v3", "for");
    castVote(db, propose.proposalId, "v4", "against");
    // 2 for / 2 against, quorum met (4 >= 3), tie -> rejected.
    const result = resolveDistrictProposals(db, { now: propose.resolvesAt + 1 });
    assert.equal(result.rejected, 1);
  });

  it("leaves proposals whose window has not yet closed alone", () => {
    const db = setupDb();
    grantResidency(db, "proposer1", "concordia-hub", 100);
    const propose = proposeDistrictChange(db, plazaId(), "proposer1", "identity_tag", "Too Soon", { durationS: 3600 });
    castVote(db, propose.proposalId, "v1", "for");
    castVote(db, propose.proposalId, "v2", "for");
    castVote(db, propose.proposalId, "v3", "for");
    const result = resolveDistrictProposals(db, { now: nowS() }); // window still open
    assert.equal(result.resolved, 0);
    assert.equal(getProposal(db, propose.proposalId).status, "pending");
  });
});

describe("listProposalsForDistrict — real, live tallies", () => {
  it("returns proposals newest-first, each with a live vote tally", () => {
    const db = setupDb();
    grantResidency(db, "proposer1", "concordia-hub", 100);
    const p1 = proposeDistrictChange(db, plazaId(), "proposer1", "identity_tag", "First");
    const p2 = proposeDistrictChange(db, plazaId(), "proposer1", "identity_tag", "Second");
    castVote(db, p1.proposalId, "v1", "for");

    const list = listProposalsForDistrict(db, plazaId());
    assert.equal(list.length, 2);
    assert.equal(list[0].id, p2.proposalId, "newest first");
    const firstEntry = list.find((p) => p.id === p1.proposalId);
    assert.equal(firstEntry.tally.for, 1);
  });

  it("returns an honest empty array for a district with no proposals", () => {
    const db = setupDb();
    assert.deepEqual(listProposalsForDistrict(db, "concordia-hub:market"), []);
  });
});

describe("district.propose_change / district.vote / district.list_proposals macros", () => {
  let handlers;
  before(() => {
    handlers = new Map();
    registerDistrictGovernanceMacros((domain, name, fn) => handlers.set(`${domain}.${name}`, fn));
  });

  it("registers all three macros", () => {
    assert.ok(handlers.has("district.propose_change"));
    assert.ok(handlers.has("district.vote"));
    assert.ok(handlers.has("district.list_proposals"));
  });

  it("propose_change requires an authenticated actor", async () => {
    const db = setupDb();
    const r = await handlers.get("district.propose_change")({ db, actor: {} }, { districtId: plazaId(), kind: "identity_tag", value: "X" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_actor");
  });

  it("propose_change -> vote -> list_proposals round-trips through the macro surface", async () => {
    const db = setupDb();
    grantResidency(db, "u-macro", "concordia-hub", 100);
    const ctx = { db, actor: { userId: "u-macro" } };

    const proposed = await handlers.get("district.propose_change")(ctx, {
      districtId: plazaId(), kind: "identity_tag", value: "Macro Row",
    });
    assert.equal(proposed.ok, true);

    const voteCtx = { db, actor: { userId: "voter-macro" } };
    const voted = await handlers.get("district.vote")(voteCtx, { proposalId: proposed.proposalId, vote: "for" });
    assert.equal(voted.ok, true);
    assert.equal(voted.tally.for, 1);

    const listed = await handlers.get("district.list_proposals")({ db }, { districtId: plazaId() });
    assert.equal(listed.ok, true);
    assert.equal(listed.count, 1);
    assert.equal(listed.proposals[0].id, proposed.proposalId);

    const single = await handlers.get("district.list_proposals")({ db }, { proposalId: proposed.proposalId });
    assert.equal(single.ok, true);
    assert.equal(single.proposal.id, proposed.proposalId);
  });
});
