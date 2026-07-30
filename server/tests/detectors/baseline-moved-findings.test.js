// server/tests/detectors/baseline-moved-findings.test.js
//
// Pins move-detection in diffAgainstBaseline BOTH ways (2026-07-28).
//
// WHY THIS EXISTS. The detector fingerprint is
// sha256(detector|ruleId|location|severity) and `location` carries the LINE,
// so any commit that shifts lines re-fingerprints findings that did not
// change. They then present as "added", and if high/critical they redden the
// ratchet. Observed concretely: a +1061-line diff in server.js re-fingerprinted
//   creditWallet           server/server.js:74445 -> :75506
//   debitWallet            server/server.js:74505 -> :75566
//   requestAccountDeletion server/lib/account-lifecycle.js:42 -> :43
// all three with byte-identical messages. CLAUDE.md already records this as
// "the reason a red ratchet carries less signal than it looks like it does".
//
// A gate that fires on non-events teaches people to re-baseline past it —
// which is precisely the goalpost-moving that scripts/autoloop/guard.mjs
// exists to prevent. So a moved finding is now classified `moved`, not `added`.
//
// THE RISK THIS FILE GUARDS. Move-matching is the one place where a too-loose
// rule could silently swallow a real regression. Hence the negative controls:
// a changed message, a different file, a different rule and a second
// occurrence must all still count as ADDED. Only same-detector +
// same-rule + same-severity + same-FILE + same-MESSAGE pairs may be treated
// as moved, and matching is strictly one-to-one.
//
// Run: node --test server/tests/detectors/baseline-moved-findings.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diffAgainstBaseline, fingerprint, ciDecision } from "../../lib/detectors/baseline.js";

/** Build a report in the shape reportFingerprints() consumes. */
function report(findings) {
  const byDetector = new Map();
  for (const f of findings) {
    if (!byDetector.has(f.detector)) byDetector.set(f.detector, []);
    byDetector.get(f.detector).push({
      id: f.id, severity: f.severity, kind: f.kind || "x",
      location: f.location, message: f.message,
    });
  }
  return { reports: [...byDetector.entries()].map(([id, fs]) => ({ id, findings: fs })) };
}

/** Build a baseline from the same finding descriptors. */
function baselineOf(findings) {
  const fps = {};
  for (const f of findings) {
    const fp = fingerprint({ id: f.id, severity: f.severity, location: f.location }, f.detector);
    fps[fp] = {
      detector: f.detector, id: f.id, severity: f.severity, kind: f.kind || "x",
      location: f.location, message: (f.message || "").slice(0, 200),
    };
  }
  return { version: 1, generatedAt: "t", fingerprints: fps };
}

const CREDIT = {
  detector: "money-txn-hygiene", id: "untransacted_money_writes", severity: "high",
  message: "creditWallet() performs 2 money-table write(s) with no db.transaction(...) wrapper",
};

describe("diffAgainstBaseline — a line shift is a MOVE, not a new finding", () => {
  it("classifies the real creditWallet shift as moved, not added", () => {
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([{ ...CREDIT, location: "server/server.js:75506" }]);
    const d = diffAgainstBaseline(cur, base);

    assert.equal(d.movedCount, 1, "should be recognised as the same finding at a new line");
    assert.equal(d.addedCount, 0, "must NOT be reported as new");
    assert.equal(d.addedBySeverity.high, 0, "must not contribute a new high");
    assert.equal(d.removedCount, 0, "the baseline entry is still present — not removed");
    assert.equal(d.moved[0].fromLocation, "server/server.js:74445");
    assert.equal(d.moved[0].finding.location, "server/server.js:75506");
  });

  it("the gate PASSES on a pure line shift of a high finding", () => {
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([{ ...CREDIT, location: "server/server.js:75506" }]);
    const d = diffAgainstBaseline(cur, base);
    assert.equal(ciDecision(d, { total: 1 }, null).pass, true);
  });

  it("an unmoved finding is still plain `unchanged`, not `moved`", () => {
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([{ ...CREDIT, location: "server/server.js:74445" }]);
    const d = diffAgainstBaseline(cur, base);
    assert.equal(d.unchangedCount, 1);
    assert.equal(d.movedCount, 0);
    assert.equal(d.addedCount, 0);
  });
});

describe("diffAgainstBaseline — NEGATIVE CONTROLS: these must still be ADDED", () => {
  it("a genuinely new high still trips the gate", () => {
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([
      { ...CREDIT, location: "server/server.js:75506" },                       // moved
      { ...CREDIT, message: "transferFunds() performs 3 money-table write(s)", // NEW
        location: "server/server.js:80000" },
    ]);
    const d = diffAgainstBaseline(cur, base);
    assert.equal(d.movedCount, 1);
    assert.equal(d.addedCount, 1, "the new finding must not be absorbed by the move matcher");
    assert.equal(d.addedBySeverity.high, 1);
    const decision = ciDecision(d, { total: 2 }, null);
    assert.equal(decision.pass, false, "gate must still fail on a genuinely new high");
    assert.equal(decision.reason, "new_high_or_critical");
  });

  it("the SAME message in a DIFFERENT file is added, not moved", () => {
    // A finding relocating across files is not a line shift; it is a new site.
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([{ ...CREDIT, location: "server/routes/wallet.js:120" }]);
    const d = diffAgainstBaseline(cur, base);
    assert.equal(d.movedCount, 0);
    assert.equal(d.addedCount, 1);
    assert.equal(d.removedCount, 1, "the original site really did go away");
  });

  it("a changed MESSAGE at the SAME line is `unchanged` — pre-existing collision, documented", () => {
    // Not a move-detection behaviour, and NOT introduced by it: `fingerprint()`
    // is sha256(detector|ruleId|location|severity) and deliberately EXCLUDES
    // the message, so a same-rule/same-line finding whose message changed is
    // byte-identical as far as the baseline is concerned and lands in
    // `unchanged`. CLAUDE.md already tracks this as the "fingerprint()
    // message-collision" limitation; closing it would invalidate every
    // existing fingerprint and so is a separate, human-authorised change.
    //
    // Asserted here rather than left implicit so the limitation is visible at
    // the exact spot someone would otherwise assume move-detection caused it.
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([{ ...CREDIT, message: "creditWallet() performs 5 money-table write(s)",
      location: "server/server.js:74445" }]);
    const d = diffAgainstBaseline(cur, base);
    assert.equal(d.unchangedCount, 1);
    assert.equal(d.movedCount, 0);
    assert.equal(d.addedCount, 0);
  });

  it("a changed MESSAGE at a DIFFERENT line is added, not moved", () => {
    // This is the case move-detection actually governs, and it must not
    // absorb a finding whose message changed.
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([{ ...CREDIT, message: "creditWallet() performs 5 money-table write(s)",
      location: "server/server.js:75506" }]);
    const d = diffAgainstBaseline(cur, base);
    assert.equal(d.movedCount, 0, "a different message is a different finding");
    assert.equal(d.addedCount, 1);
    assert.equal(d.addedBySeverity.high, 1);
    assert.equal(ciDecision(d, { total: 1 }, null).pass, false);
  });

  it("a different RULE id with the same text is added, not moved", () => {
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([{ ...CREDIT, id: "some_other_rule", location: "server/server.js:75506" }]);
    const d = diffAgainstBaseline(cur, base);
    assert.equal(d.movedCount, 0);
    assert.equal(d.addedCount, 1);
  });

  it("matching is ONE-TO-ONE: 1 baseline + 2 current = 1 moved, 1 added", () => {
    // The case that would otherwise let a genuine SECOND occurrence hide
    // behind the first one's move.
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const cur = report([
      { ...CREDIT, location: "server/server.js:75506" },
      { ...CREDIT, location: "server/server.js:79000" },
    ]);
    const d = diffAgainstBaseline(cur, base);
    assert.equal(d.movedCount, 1);
    assert.equal(d.addedCount, 1, "the second occurrence is genuinely new and must be reported");
    assert.equal(d.addedBySeverity.high, 1);
    assert.equal(ciDecision(d, { total: 2 }, null).pass, false);
  });

  it("a finding that truly disappeared is still `removed`", () => {
    const base = baselineOf([{ ...CREDIT, location: "server/server.js:74445" }]);
    const d = diffAgainstBaseline(report([]), base);
    assert.equal(d.removedCount, 1);
    assert.equal(d.movedCount, 0);
  });
});
