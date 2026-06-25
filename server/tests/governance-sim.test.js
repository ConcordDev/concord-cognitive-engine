// server/tests/governance-sim.test.js
//
// Governance Proposal Simulator (#41) — deterministic policy-impact projection
// over the governed economic constants. The reference scenario makes every
// projection an exact oracle. Offline.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { openProposal } from "../lib/governance.js";
import { projectImpact, simulateProposal, getSimulation } from "../lib/governance-sim.js";
import registerGovernanceMacros from "../domains/governance.js";

describe("Governance Proposal Simulator (#41)", () => {
  let db, macros;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    await runMigrations(db);
    macros = new Map();
    registerGovernanceMacros((d, n, fn) => macros.set(`${d}.${n}`, fn));
  });

  it("projects a platform-fee change on the reference 100 CC sale", () => {
    // fee 0.05 → 0.10: creator pool drops from 95 to 90 CC.
    const r = projectImpact("marketplace.platform_fee_rate", 0.05, 0.10);
    assert.equal(r.ok, true);
    assert.equal(r.baseline.value, 95);
    assert.equal(r.projected.value, 90);
    assert.equal(r.delta, -5);
    assert.ok(r.summary.includes("decrease"));
  });

  it("projects a royalty-rate change through the cascade", () => {
    // Higher initial royalty rate → more total ancestor royalty (bounded by cap).
    const lo = projectImpact("royalty.initial_rate", 0.10, 0.10).projected.value;
    const hi = projectImpact("royalty.initial_rate", 0.10, 0.25).projected.value;
    assert.ok(hi > lo, "raising the rate raises projected ancestor royalty");
    // The 30% cap holds — never project more than 30 CC of a 100 CC sale.
    const capped = projectImpact("royalty.initial_rate", 0.10, 0.90).projected.value;
    assert.ok(capped <= 30, "royalty cap respected in projection");
  });

  it("projects a withdrawal-hold change in hours", () => {
    const r = projectImpact("withdrawals.hold_hours", 48, 24);
    assert.equal(r.baseline.value, 48);
    assert.equal(r.projected.value, 24);
    assert.equal(r.delta, -24);
    assert.equal(r.baseline.unit, "hours");
  });

  it("simulates a stored proposal and caches the projection", () => {
    const p = openProposal(db, {
      title: "Lower the fee", summary: "fee 5%→3%", proposerId: "u1",
      constantPath: "marketplace.platform_fee_rate", currentValue: 0.05, proposedValue: 0.03,
      rationale: "creators keep more",
    });
    assert.equal(p.ok, true);
    const sim = simulateProposal(db, p.proposalId);
    assert.equal(sim.ok, true);
    assert.equal(sim.baseline.value, 95);
    assert.equal(sim.projected.value, 97);
    const cached = getSimulation(db, p.proposalId);
    assert.ok(cached && cached.projected.value === 97, "projection cached + readable");
  });

  it("governance.simulate macro works for stored + ad-hoc projections", async () => {
    const adhoc = await macros.get("governance.simulate")({ db }, { constantPath: "marketplace.creator_share", currentValue: 0.70, proposedValue: 0.80 });
    assert.equal(adhoc.ok, true);
    assert.equal(adhoc.delta, 10, "creator take rises 70→80 CC");

    const p = openProposal(db, { title: "t", summary: "s", proposerId: "u2", constantPath: "withdrawals.hold_hours", currentValue: 48, proposedValue: 72 });
    const sim = await macros.get("governance.simulate")({ db }, { proposalId: p.proposalId });
    assert.equal(sim.delta, 24);
    const read = await macros.get("governance.simulation")({ db }, { proposalId: p.proposalId });
    assert.equal(read.ok, true);
  });
});
