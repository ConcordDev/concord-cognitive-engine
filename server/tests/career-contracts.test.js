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
import { getSparks } from "../lib/sparks-service.js";
import {
  offerContract, counterContract, acceptContract, rejectContract,
  listContractsFor, reputationGateTier, reputationWageMultiplier, get,
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
