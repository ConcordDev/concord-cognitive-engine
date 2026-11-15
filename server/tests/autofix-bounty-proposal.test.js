// Generation-hop shaping tests — server/lib/autofix/bounty-proposal.js
// (Group B B9, the Bounties pair; founder-ruled 2026-11-05: build the
// hop, generation proposes ONLY).
//
// The helper is pure: it shapes the staged autofix_proposals payload for
// the legacy `bounty` domain's propose_from_fix macro. These tests pin:
//   - a real registered fix + a matching finding (with content) shapes a
//     proposal carrying fix label, description, file, risk tier, dedupe;
//   - refusals in words for every failure shape;
//   - the payload NEVER carries the finding's file content;
//   - fix.apply is never invoked (a spy fix proves the hop only checks).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getFix, listFixes } from "../lib/autofix/index.js";
import { shapeBountyProposal, proposalDedupeKey, findingFilePath } from "../lib/autofix/bounty-proposal.js";

const CONTENT_WITH_LET = "let count = 1;\nconsole.log(count);\n";

describe("autofix bounty proposal — the generation hop's shaping core", () => {
  it("the registry is populated (the hop's source exists)", () => {
    assert.ok(listFixes().length >= 8);
    assert.ok(getFix("prefer_const"), "prefer_const is a registered fix");
  });

  it("shapes a staged proposal from a real fix + a matching finding", () => {
    const fix = getFix("prefer_const");
    const shaped = shapeBountyProposal(fix, {
      id: "let_never_reassigned",
      detector: "hygiene",
      severity: "low",
      file: "server/example.js",
      content: CONTENT_WITH_LET,
    });
    assert.equal(shaped.ok, true);
    assert.equal(shaped.proposalKind, "prefer_const");
    assert.equal(shaped.filePath, "server/example.js");
    assert.equal(shaped.dedupeKey, "prefer_const::server/example.js");
    assert.equal(shaped.payload.source, "fix_registry");
    assert.equal(shaped.payload.fixId, "prefer_const");
    assert.equal(shaped.payload.riskTier, fix.riskTier);
    assert.ok(shaped.payload.description.length > 0);
    assert.equal(shaped.payload.finding.detector, "hygiene");
    assert.ok(!("content" in shaped.payload), "the payload never warehouses file content");
    assert.ok(!JSON.stringify(shaped.payload).includes("let count"), "content text appears nowhere in the payload");
  });

  it("refuses a fix that does not exist", () => {
    const shaped = shapeBountyProposal(getFix("no_such_fix"), { id: "x", file: "a.js", content: "" });
    assert.deepEqual(shaped, { ok: false, reason: "fix_not_found" });
  });

  it("refuses a finding the fix does not claim", () => {
    const fix = getFix("prefer_const");
    const shaped = shapeBountyProposal(fix, {
      id: "some_other_finding", file: "server/example.js", content: CONTENT_WITH_LET,
    });
    assert.equal(shaped.ok, false);
    assert.equal(shaped.reason, "finding_not_matched");
  });

  it("refuses when applicability cannot be verified (no content)", () => {
    const fix = getFix("prefer_const");
    const shaped = shapeBountyProposal(fix, {
      id: "let_never_reassigned", file: "server/example.js",
    });
    assert.equal(shaped.ok, false);
    assert.equal(shaped.reason, "applicability_unverifiable");
  });

  it("refuses when the fix does not apply to the content", () => {
    const fix = getFix("prefer_const");
    const shaped = shapeBountyProposal(fix, {
      id: "let_never_reassigned", file: "server/example.js",
      content: "const already = 1;\n",
    });
    assert.equal(shaped.ok, false);
    assert.equal(shaped.reason, "fix_not_applicable");
  });

  it("refuses a finding with no file", () => {
    const fix = getFix("prefer_const");
    const shaped = shapeBountyProposal(fix, { id: "let_never_reassigned", content: CONTENT_WITH_LET });
    assert.equal(shaped.ok, false);
    assert.equal(shaped.reason, "finding_missing_file");
  });

  it("never calls fix.apply — generation proposes only", () => {
    let applied = 0;
    const spyFix = {
      id: "spy_fix",
      label: "Spy fix",
      riskTier: "low",
      matchFinding: () => true,
      isApplicable: () => true,
      apply: () => { applied += 1; return "changed"; },
      describe: () => "spy description",
    };
    const shaped = shapeBountyProposal(spyFix, { filePath: "x.js", content: "anything" });
    assert.equal(shaped.ok, true);
    assert.equal(applied, 0, "the hop checks and describes — it never applies");
  });

  it("dedupe keys are stable per (fix, file) and distinct across files", () => {
    assert.equal(proposalDedupeKey("prefer_const", "a.js"), proposalDedupeKey("prefer_const", "a.js"));
    assert.notEqual(proposalDedupeKey("prefer_const", "a.js"), proposalDedupeKey("prefer_const", "b.js"));
    assert.equal(findingFilePath({ path: "p.js" }), "p.js");
    assert.equal(findingFilePath({ filePath: "q.js" }), "q.js");
    assert.equal(findingFilePath({}), null);
  });
});
