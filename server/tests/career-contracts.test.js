// WAVE JOBS — contract negotiation (persisted + sparks-wired). Pins the
// offer→counter→accept state machine, the signing-bonus sparks transfer on
// accept (the wallet wire), reputation tier-gating, and the can't-accept-your-
// own-offer rule.
//
// Run: node --test tests/career-contracts.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { getSparks, creditSparks } from "../lib/sparks-service.js";
import {
  offerContract, counterContract, acceptContract, rejectContract,
  listContractsFor, reputationGateTier, reputationWageMultiplier, get,
  deriveWorkerReputation,
} from "../lib/career-contracts.js";

describe("reputation gating", () => {
  it("gates the hireable tier + scales wage", () => {
    assert.ok(reputationGateTier(10) < reputationGateTier(90));
    assert.equal(reputationGateTier(95), 10);
    assert.ok(reputationWageMultiplier(100) > reputationWageMultiplier(0));
  });
});

describe("negotiation + sparks wire (npc employer hires npc worker)", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    db.prepare("INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('emp','w',1000)").run();
    db.prepare("INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('wkr','w',0)").run();
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  const baseOffer = () => offerContract(db, {
    worldId: "w", employerKind: "npc", employerId: "emp", workerKind: "npc", workerId: "wkr",
    trackId: "chef", tier: 3, role: "Line Cook", baseWage: 14, signingBonus: 100,
    offeredByKind: "npc", offeredById: "emp", clauses: ["release", "bogus"],
  });

  it("offer → worker counters → employer accepts → signing bonus paid in sparks", () => {
    const o = baseOffer();
    assert.equal(o.ok, true);
    // worker counters the wage up (the other party — allowed)
    const c = counterContract(db, o.contractId, "npc", "wkr", { baseWage: 20 });
    assert.equal(c.ok, true);
    // employer (did not make the standing offer now) accepts → pays signing bonus
    const a = acceptContract(db, o.contractId, "npc", "emp");
    assert.equal(a.ok, true);
    assert.equal(a.bonusPaid, 100);
    assert.equal(getSparks(db, "npc", "wkr"), 100);   // worker got the bonus
    assert.equal(getSparks(db, "npc", "emp"), 900);   // employer paid it
    assert.equal(get(db, o.contractId).status, "active");
    assert.equal(get(db, o.contractId).base_wage_sparks, 20); // counter stuck
    // invalid clause was filtered
    assert.deepEqual(JSON.parse(get(db, o.contractId).clauses_json), ["release"]);
  });

  it("signing bonus is idempotent (re-accept doesn't double-pay)", () => {
    const o = baseOffer();
    acceptContract(db, o.contractId, "npc", "wkr"); // worker accepts employer's standing offer
    const before = getSparks(db, "npc", "wkr");
    acceptContract(db, o.contractId, "npc", "wkr"); // already active → not_negotiable
    assert.equal(getSparks(db, "npc", "wkr"), before);
  });

  it("cannot accept your own standing offer", () => {
    const o = baseOffer(); // offered by emp
    const a = acceptContract(db, o.contractId, "npc", "emp");
    assert.equal(a.ok, false);
    assert.equal(a.reason, "cannot_accept_own_offer");
  });

  it("reputation too low for the tier rejects the offer", () => {
    const r = offerContract(db, {
      employerKind: "npc", employerId: "emp", workerKind: "npc", workerId: "wkr",
      trackId: "chef", tier: 8, baseWage: 50, offeredByKind: "npc", offeredById: "emp",
      workerReputation: 10,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "reputation_too_low");
  });

  it("reject closes negotiation; listContractsFor finds it", () => {
    const o = baseOffer();
    rejectContract(db, o.contractId, "npc", "wkr");
    assert.equal(get(db, o.contractId).status, "rejected");
    assert.ok(listContractsFor(db, "npc", "wkr").some((c) => c.id === o.contractId));
  });
});

// deriveWorkerReputation — the real, grounded reputation source the
// careers.myReputation macro and the careers.offer self-worker path both
// call. Pinned against a fully-migrated DB (real career_contracts +
// sparks_txn_refs schemas), never a hand-assumed number.
describe("deriveWorkerReputation — grounded on real career_contracts + sparks_txn_refs rows", () => {
  let db;
  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?,?,?,'x',?)`)
      .run("player1", "player1", "player1@test.local", Math.floor(Date.now() / 1000));
    db.prepare("INSERT INTO world_npcs (id, world_id, wealth_sparks) VALUES ('emp','w',1000)").run();
  });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("a fresh worker with no history has reputation 0 (honest no-track-record, not fabricated)", () => {
    assert.equal(deriveWorkerReputation(db, "player", "player1"), 0);
    assert.equal(deriveWorkerReputation(db, "player", "player1", "chef"), 0);
    assert.equal(deriveWorkerReputation(db, "player", "nobody-with-this-id"), 0);
  });

  it("counts real worked-shift sparks_txn_refs rows (the exact refId shape careers.work writes)", () => {
    // simulate 3 chef shifts + 1 smith shift the way domain/careers.js#work does:
    // creditSparks with refId `career:<uid>:<trackId>:<ts>`, reason 'career_play_shift'.
    for (let i = 0; i < 3; i++) {
      creditSparks(db, {
        holderKind: "player", holderId: "player1", amount: 10,
        refId: `career:player1:chef:${1000 + i}`, reason: "career_play_shift", worldId: "w",
      });
    }
    creditSparks(db, {
      holderKind: "player", holderId: "player1", amount: 10,
      refId: "career:player1:smith:5000", reason: "career_play_shift", worldId: "w",
    });

    // scoped to chef: 3 shifts * 4 pts = 12
    assert.equal(deriveWorkerReputation(db, "player", "player1", "chef"), 12);
    // scoped to smith: 1 shift * 4 pts = 4
    assert.equal(deriveWorkerReputation(db, "player", "player1", "smith"), 4);
    // unscoped (all tracks): 4 shifts * 4 pts = 16
    assert.equal(deriveWorkerReputation(db, "player", "player1"), 16);
  });

  it("counts real signed (active/completed) career_contracts as the worker, weighted heavier than shifts", () => {
    // employer offers, player1 (the worker) accepts → contract flips to 'active'.
    const o = offerContract(db, {
      worldId: "w", employerKind: "npc", employerId: "emp", workerKind: "player", workerId: "player1",
      trackId: "chef", tier: 2, baseWage: 20, signingBonus: 0,
      offeredByKind: "npc", offeredById: "emp",
    });
    assert.equal(o.ok, true);
    const a = acceptContract(db, o.contractId, "player", "player1");
    assert.equal(a.ok, true);

    // 1 active contract in chef = 20 pts
    assert.equal(deriveWorkerReputation(db, "player", "player1", "chef"), 20);
    // a different track sees no signal from this contract
    assert.equal(deriveWorkerReputation(db, "player", "player1", "smith"), 0);

    // an OFFERED (not yet accepted) contract contributes nothing — only
    // active/completed count.
    offerContract(db, {
      worldId: "w", employerKind: "npc", employerId: "emp", workerKind: "player", workerId: "player1",
      trackId: "chef", tier: 1, baseWage: 5, offeredByKind: "npc", offeredById: "emp",
    });
    assert.equal(deriveWorkerReputation(db, "player", "player1", "chef"), 20, "a pending offer must not inflate reputation");
  });

  it("reputation saturates at 100 and the SAME reputationGateTier/reputationWageMultiplier the offer gate uses read it consistently", () => {
    // 6 signed contracts (>5, over the 100-point saturation) all in 'chef'.
    for (let i = 0; i < 6; i++) {
      const o = offerContract(db, {
        worldId: "w", employerKind: "npc", employerId: "emp", workerKind: "player", workerId: "player1",
        trackId: "chef", tier: 1, baseWage: 5, offeredByKind: "npc", offeredById: "emp",
      });
      const a = acceptContract(db, o.contractId, "player", "player1");
      assert.equal(a.ok, true, `contract ${i} should accept`);
    }
    const rep = deriveWorkerReputation(db, "player", "player1", "chef");
    assert.equal(rep, 100, "6 contracts * 20 pts saturates at the 0..100 clamp, not 120");
    // the macro surface must call these exact functions — assert they agree
    // on THIS computed value rather than re-deriving the tier/multiplier logic.
    assert.equal(reputationGateTier(rep), 10);
    assert.ok(reputationWageMultiplier(rep) > reputationWageMultiplier(0));
  });
});
