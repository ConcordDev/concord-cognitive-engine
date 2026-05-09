/**
 * Tier-2 contract tests for Governance.
 *
 * Run: node --test tests/governance.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  openProposal,
  castVote,
  tallyProposal,
  resolveIfDue,
  listOpenProposals,
  GOVERNED_CONSTANTS,
} from "../lib/governance.js";

function makeFakeDb() {
  const tables = { governance_proposals: new Map(), governance_votes: new Map() };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function runStmt(sql, args) {
    if (sql.startsWith("INSERT INTO governance_proposals")) {
      const [id, title, summary, proposer, path, cur, prop, rationale, q, t, opened, closes] = args;
      tables.governance_proposals.set(id, {
        id, title, summary, proposer_id: proposer, constant_path: path,
        current_value: cur, proposed_value: prop, rationale,
        status: "open", quorum: q, threshold_pct: t,
        opened_at: opened, closes_at: closes, closed_at: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO governance_votes")) {
      const [proposalId, voterId, vote] = args;
      const key = `${proposalId}|${voterId}`;
      tables.governance_votes.set(key, { proposal_id: proposalId, voter_id: voterId, vote, cast_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE governance_proposals SET status")) {
      const [status, id] = args;
      const p = tables.governance_proposals.get(id);
      if (p && p.status === "open") {
        p.status = status;
        p.closed_at = Math.floor(Date.now() / 1000);
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    return { changes: 0 };
  }
  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM governance_proposals WHERE id = ?")) {
      return tables.governance_proposals.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT status, closes_at FROM governance_proposals WHERE id = ?")) {
      const p = tables.governance_proposals.get(args[0]);
      return p ? { status: p.status, closes_at: p.closes_at } : null;
    }
    return null;
  }
  function allStmt(sql, args) {
    if (sql.startsWith("SELECT vote, COUNT(*) AS n FROM governance_votes WHERE proposal_id = ?")) {
      const [proposalId] = args;
      const counts = {};
      for (const v of tables.governance_votes.values()) {
        if (v.proposal_id === proposalId) counts[v.vote] = (counts[v.vote] || 0) + 1;
      }
      return Object.entries(counts).map(([vote, n]) => ({ vote, n }));
    }
    if (sql.startsWith("SELECT * FROM governance_proposals WHERE status = 'open'")) {
      return Array.from(tables.governance_proposals.values()).filter(p => p.status === "open" && p.closes_at > Math.floor(Date.now() / 1000));
    }
    return [];
  }
  return { prepare, _tables: tables };
}

describe("openProposal", () => {
  it("inserts a proposal for a governed constant", () => {
    const db = makeFakeDb();
    const r = openProposal(db, {
      title: "Lower platform fee", summary: "Drop 5% to 3%",
      proposerId: "u1", constantPath: "marketplace.platform_fee_rate",
      currentValue: 0.05, proposedValue: 0.03,
    });
    assert.equal(r.ok, true);
    assert.ok(r.proposalId);
  });
  it("rejects non-governed constants", () => {
    const db = makeFakeDb();
    const r = openProposal(db, {
      title: "x", summary: "y", proposerId: "u1",
      constantPath: "system.heartbeat_interval", currentValue: 15, proposedValue: 30,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "constant_not_governed");
  });
  it("rejects missing inputs", () => {
    const db = makeFakeDb();
    const r = openProposal(db, { title: "x" });
    assert.equal(r.ok, false);
  });
});

describe("castVote + tallyProposal", () => {
  it("records yes/no/abstain", () => {
    const db = makeFakeDb();
    const p = openProposal(db, {
      title: "x", summary: "y", proposerId: "u1",
      constantPath: "marketplace.platform_fee_rate", currentValue: 0.05, proposedValue: 0.03,
    });
    castVote(db, { proposalId: p.proposalId, voterId: "u1", vote: "yes" });
    castVote(db, { proposalId: p.proposalId, voterId: "u2", vote: "yes" });
    castVote(db, { proposalId: p.proposalId, voterId: "u3", vote: "no" });
    const t = tallyProposal(db, p.proposalId);
    assert.equal(t.counts.yes, 2);
    assert.equal(t.counts.no, 1);
    assert.equal(t.totalCast, 3);
  });
  it("voter can change their vote (upsert)", () => {
    const db = makeFakeDb();
    const p = openProposal(db, {
      title: "x", summary: "y", proposerId: "u1",
      constantPath: "royalty.floor", currentValue: 0.0005, proposedValue: 0.001,
    });
    castVote(db, { proposalId: p.proposalId, voterId: "u1", vote: "yes" });
    castVote(db, { proposalId: p.proposalId, voterId: "u1", vote: "no" });
    const t = tallyProposal(db, p.proposalId);
    assert.equal(t.counts.yes, 0);
    assert.equal(t.counts.no, 1);
  });
  it("rejects bad vote value", () => {
    const db = makeFakeDb();
    const p = openProposal(db, {
      title: "x", summary: "y", proposerId: "u1",
      constantPath: "royalty.floor", currentValue: 0.0005, proposedValue: 0.001,
    });
    const r = castVote(db, { proposalId: p.proposalId, voterId: "u1", vote: "maybe" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "bad_vote");
  });
});

describe("resolveIfDue", () => {
  it("passes when quorum + threshold met", () => {
    const db = makeFakeDb();
    const p = openProposal(db, {
      title: "x", summary: "y", proposerId: "u0",
      constantPath: "royalty.floor", currentValue: 0.0005, proposedValue: 0.001,
      quorum: 3, thresholdPct: 0.6,
    });
    castVote(db, { proposalId: p.proposalId, voterId: "u1", vote: "yes" });
    castVote(db, { proposalId: p.proposalId, voterId: "u2", vote: "yes" });
    castVote(db, { proposalId: p.proposalId, voterId: "u3", vote: "no" });
    const r = resolveIfDue(db, p.proposalId);
    assert.equal(r.ok, true);
    assert.equal(r.action, "passed");
  });
  it("rejects after window when below threshold", () => {
    const db = makeFakeDb();
    const p = openProposal(db, {
      title: "x", summary: "y", proposerId: "u0",
      constantPath: "royalty.floor", currentValue: 0.0005, proposedValue: 0.001,
      quorum: 3, thresholdPct: 0.66,
      durationS: 60,
    });
    castVote(db, { proposalId: p.proposalId, voterId: "u1", vote: "yes" });
    castVote(db, { proposalId: p.proposalId, voterId: "u2", vote: "no" });
    castVote(db, { proposalId: p.proposalId, voterId: "u3", vote: "no" });
    // Force expiry by editing the row directly.
    db._tables.governance_proposals.get(p.proposalId).closes_at = Math.floor(Date.now() / 1000) - 1;
    const r = resolveIfDue(db, p.proposalId);
    assert.equal(r.action, "rejected");
  });
  it("still_open when below quorum and not expired", () => {
    const db = makeFakeDb();
    const p = openProposal(db, {
      title: "x", summary: "y", proposerId: "u0",
      constantPath: "royalty.floor", currentValue: 0.0005, proposedValue: 0.001,
      quorum: 5, thresholdPct: 0.66,
    });
    castVote(db, { proposalId: p.proposalId, voterId: "u1", vote: "yes" });
    const r = resolveIfDue(db, p.proposalId);
    assert.equal(r.action, "still_open");
  });
});

describe("listOpenProposals + GOVERNED_CONSTANTS", () => {
  it("lists open ones", () => {
    const db = makeFakeDb();
    openProposal(db, { title: "x", summary: "y", proposerId: "u1", constantPath: "royalty.floor", currentValue: 0.0005, proposedValue: 0.001 });
    openProposal(db, { title: "y", summary: "z", proposerId: "u1", constantPath: "royalty.halving", currentValue: 2, proposedValue: 1.5 });
    const list = listOpenProposals(db);
    assert.equal(list.length, 2);
  });
  it("GOVERNED_CONSTANTS is non-empty + frozen", () => {
    assert.ok(GOVERNED_CONSTANTS.length > 5);
    assert.throws(() => GOVERNED_CONSTANTS.push("anything"));
  });
});
