// tests/depth/paper-version-behavior.test.js — REAL behavioral tests for the
// `paper` domain's version-history macros (`paper-version-save`,
// `paper-version-list`, `paper-version-diff`), the ENGINEERING gap-closure
// for the previously "GENUINELY MISSING" `revisionDiff` capability
// (docs/lens-specs/paper-capability-map.md). Before this, `revisionDiff`
// only diffed caller-SUPPLIED text with no persisted history behind it —
// these three macros add a real per-paper version-snapshot store (modeled
// on the paper-annotate/-annotations/-annotation-delete pattern) so
// `paper-version-diff` runs against two REAL stored snapshots.
//
// `paper-version-diff` and `revisionDiff` both route through the SAME
// extracted `computeTextDiff` helper in server/domains/paper.js — this file
// also pins that `revisionDiff`'s pre-existing contract (caller-supplied
// `data.original`/`data.revised`) is byte-identical after that refactor.
//
// lens.run UNWRAPS a handler's `{ok:true, result:X}` → r.result === X (read
// r.result.<field>). A handler `{ok:false, error}` (no result key) is NOT
// unwrapped → r.result.ok === false + r.result.error carries the message.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("paper — version history: save / list (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("paper-version-crud"); });

  it("paper-version-save: first snapshot is versionNumber 1, label defaults to null when omitted", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Versioned Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;

    const v1 = await lensRun("paper", "paper-version-save", { params: { paperId, content: "first draft content" } }, ctx);
    assert.equal(v1.ok, true);
    assert.equal(v1.result.version.versionNumber, 1);
    assert.equal(v1.result.version.content, "first draft content");
    assert.equal(v1.result.version.label, null);
    assert.ok(typeof v1.result.version.id === "string" && v1.result.version.id.length > 0);
    assert.ok(typeof v1.result.version.createdAt === "string");
    assert.equal(v1.result.total, 1);
  });

  it("paper-version-save: a label, when provided, is cleaned + stored verbatim", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Labeled Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;

    const v1 = await lensRun("paper", "paper-version-save", { params: { paperId, content: "draft one", label: "Draft 1" } }, ctx);
    assert.equal(v1.result.version.label, "Draft 1");
  });

  it("paper-version-save: versionNumber increments sequentially across repeated saves", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Sequential Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;

    const v1 = await lensRun("paper", "paper-version-save", { params: { paperId, content: "v1", label: "Draft 1" } }, ctx);
    const v2 = await lensRun("paper", "paper-version-save", { params: { paperId, content: "v2", label: "Draft 2" } }, ctx);
    const v3 = await lensRun("paper", "paper-version-save", { params: { paperId, content: "v3", label: "After reviewer feedback" } }, ctx);

    assert.equal(v1.result.version.versionNumber, 1);
    assert.equal(v2.result.version.versionNumber, 2);
    assert.equal(v3.result.version.versionNumber, 3);
    assert.equal(v1.result.total, 1);
    assert.equal(v2.result.total, 2);
    assert.equal(v3.result.total, 3);
  });

  it("paper-version-save: empty content is rejected", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Empty Content Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    const bad = await lensRun("paper", "paper-version-save", { params: { paperId, content: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /content required/);
  });

  it("paper-version-save: whitespace-only content is rejected (trimmed to empty)", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Whitespace Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    const bad = await lensRun("paper", "paper-version-save", { params: { paperId, content: "   \n\t  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /content required/);
  });

  it("paper-version-save: a fabricated paperId is rejected", async () => {
    const bad = await lensRun("paper", "paper-version-save", { params: { paperId: "pp_does_not_exist", content: "anything" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /paper not found/);
  });

  it("paper-version-list: a paper with no saved versions returns an empty list", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `No Versions Paper ${randomUUID()}` } }, ctx);
    const list = await lensRun("paper", "paper-version-list", { params: { paperId: save.result.paper.id } }, ctx);
    assert.equal(list.ok, true);
    assert.deepEqual(list.result.versions, []);
    assert.equal(list.result.count, 0);
  });

  it("paper-version-list: returns snapshots sorted oldest-first by versionNumber", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Ordered Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    await lensRun("paper", "paper-version-save", { params: { paperId, content: "alpha", label: "A" } }, ctx);
    await lensRun("paper", "paper-version-save", { params: { paperId, content: "beta", label: "B" } }, ctx);
    await lensRun("paper", "paper-version-save", { params: { paperId, content: "gamma", label: "C" } }, ctx);

    const list = await lensRun("paper", "paper-version-list", { params: { paperId } }, ctx);
    assert.equal(list.result.count, 3);
    assert.deepEqual(list.result.versions.map((v) => v.versionNumber), [1, 2, 3]);
    assert.deepEqual(list.result.versions.map((v) => v.label), ["A", "B", "C"]);
    assert.deepEqual(list.result.versions.map((v) => v.content), ["alpha", "beta", "gamma"]);
  });

  it("paper-version-list: a fabricated paperId is rejected", async () => {
    const bad = await lensRun("paper", "paper-version-list", { params: { paperId: "pp_does_not_exist" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /paper not found/);
  });
});

describe("paper — version history: real diff between stored snapshots (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("paper-version-diff"); });

  it("paper-version-diff: computes real line/word/char deltas between two stored versions", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Diffable Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    const v1content = "line one\nline two\nline three";
    const v2content = "line one\nline two changed\nline three\nline four";

    await lensRun("paper", "paper-version-save", { params: { paperId, content: v1content, label: "Draft 1" } }, ctx);
    await lensRun("paper", "paper-version-save", { params: { paperId, content: v2content, label: "Draft 2" } }, ctx);

    const diff = await lensRun("paper", "paper-version-diff", { params: { paperId, fromVersion: 1, toVersion: 2 } }, ctx);
    assert.equal(diff.ok, true);
    assert.equal(diff.result.fromVersion, 1);
    assert.equal(diff.result.toVersion, 2);
    assert.equal(diff.result.oldStats.lines, 3);
    assert.equal(diff.result.newStats.lines, 4);
    assert.equal(diff.result.diff.linesAdded, 2);      // "line two changed" + "line four"
    assert.equal(diff.result.diff.linesRemoved, 1);    // "line two"
    assert.equal(diff.result.diff.linesUnchanged, 2);  // "line one" + "line three"
    assert.equal(diff.result.diff.wordDelta, 3);        // 9 new words - 6 old words
    assert.equal(diff.result.diff.charDelta, v2content.length - v1content.length);
    assert.deepEqual(diff.result.addedPreview, ["line two changed", "line four"]);
    assert.deepEqual(diff.result.removedPreview, ["line two"]);
  });

  it("paper-version-diff: skipping an intermediate version diffs only the two requested endpoints", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Skip Middle Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    const v1 = "first line";
    const v2 = "first line\nsecond line";       // intermediate — should be ignored by a 1→3 diff
    const v3 = "first line\nsecond line\nthird line";

    await lensRun("paper", "paper-version-save", { params: { paperId, content: v1 } }, ctx);
    await lensRun("paper", "paper-version-save", { params: { paperId, content: v2 } }, ctx);
    await lensRun("paper", "paper-version-save", { params: { paperId, content: v3 } }, ctx);

    const diff = await lensRun("paper", "paper-version-diff", { params: { paperId, fromVersion: 1, toVersion: 3 } }, ctx);
    assert.equal(diff.ok, true);
    assert.equal(diff.result.diff.linesAdded, 2);       // "second line" + "third line"
    assert.equal(diff.result.diff.linesRemoved, 0);
    assert.equal(diff.result.diff.linesUnchanged, 1);   // "first line"
  });

  it("paper-version-diff: a fabricated paperId is rejected", async () => {
    const bad = await lensRun("paper", "paper-version-diff", { params: { paperId: "pp_does_not_exist", fromVersion: 1, toVersion: 2 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /paper not found/);
  });

  it("paper-version-diff: a nonexistent fromVersion is rejected without fabricating a diff", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `From Missing Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    await lensRun("paper", "paper-version-save", { params: { paperId, content: "only version" } }, ctx);

    const bad = await lensRun("paper", "paper-version-diff", { params: { paperId, fromVersion: 99, toVersion: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "version not found: 99");
  });

  it("paper-version-diff: a nonexistent toVersion is rejected without fabricating a diff", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `To Missing Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    await lensRun("paper", "paper-version-save", { params: { paperId, content: "only version" } }, ctx);

    const bad = await lensRun("paper", "paper-version-diff", { params: { paperId, fromVersion: 1, toVersion: 42 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.equal(bad.result.error, "version not found: 42");
  });

  it("paper-version-diff: missing fromVersion/toVersion params is rejected before any lookup", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `Missing Params Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    const bad = await lensRun("paper", "paper-version-diff", { params: { paperId } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /fromVersion and toVersion required/);
  });

  it("paper-version-diff: a non-numeric fromVersion is rejected the same way as a missing one", async () => {
    const save = await lensRun("paper", "paper-save", { params: { title: `NaN Params Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    await lensRun("paper", "paper-version-save", { params: { paperId, content: "only version" } }, ctx);
    const bad = await lensRun("paper", "paper-version-diff", { params: { paperId, fromVersion: "not-a-number", toVersion: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /fromVersion and toVersion required/);
  });
});

describe("paper — version history: per-user isolation", () => {
  it("a paper's versions are invisible to a different user (paper-version-list 404s the same as paper-detail)", async () => {
    const owner = await depthCtx("paper-version-owner-" + randomUUID());
    const stranger = await depthCtx("paper-version-stranger-" + randomUUID());

    const save = await lensRun("paper", "paper-save", { params: { title: `Private Paper ${randomUUID()}` } }, owner);
    const paperId = save.result.paper.id;
    await lensRun("paper", "paper-version-save", { params: { paperId, content: "owner-only content" } }, owner);

    const strangerList = await lensRun("paper", "paper-version-list", { params: { paperId } }, stranger);
    assert.equal(strangerList.result.ok, false);
    assert.match(strangerList.result.error, /paper not found/);

    const strangerSave = await lensRun("paper", "paper-version-save", { params: { paperId, content: "intruding content" } }, stranger);
    assert.equal(strangerSave.result.ok, false);
    assert.match(strangerSave.result.error, /paper not found/);

    // Owner's own view is unaffected and still has exactly one version.
    const ownerList = await lensRun("paper", "paper-version-list", { params: { paperId } }, owner);
    assert.equal(ownerList.result.count, 1);
  });
});

// Regression coverage — the paper-version-diff macros were built by
// extracting revisionDiff's line/word/char diff computation into a shared
// `computeTextDiff` helper (server/domains/paper.js). These pin that
// revisionDiff's own pre-existing contract (caller-supplied
// data.original/data.revised, no persisted history) is byte-identical
// after that refactor.
describe("paper — revisionDiff regression (unchanged after computeTextDiff extraction)", () => {
  it("revisionDiff: line/word/char deltas between original and revised are unchanged", async () => {
    const r = await lensRun("paper", "revisionDiff", {
      data: {
        original: "line one\nline two\nline three",
        revised: "line one\nline two changed\nline three\nline four",
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.oldStats.lines, 3);
    assert.equal(r.result.oldStats.words, 6);
    assert.equal(r.result.newStats.lines, 4);
    assert.equal(r.result.newStats.words, 9);
    assert.equal(r.result.diff.linesUnchanged, 2);
    assert.equal(r.result.diff.linesAdded, 2);
    assert.equal(r.result.diff.linesRemoved, 1);
    assert.equal(r.result.diff.wordDelta, 3);
    assert.ok(r.result.addedPreview.includes("line four"));
    assert.ok(r.result.removedPreview.includes("line two"));
    assert.equal(typeof r.result.changeRate, "number");
  });

  it("revisionDiff: missing original/revised text still returns the guidance message (no diff computed)", async () => {
    const r = await lensRun("paper", "revisionDiff", { data: {} });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("Provide 'original' and 'revised' text to compare."));
    assert.equal(r.result.diff, undefined);
  });

  it("revisionDiff and paper-version-diff agree byte-for-byte on the same text pair (shared computeTextDiff)", async () => {
    const ctx = await depthCtx("paper-version-vs-revisiondiff-" + randomUUID());
    const original = "alpha\nbeta\ngamma";
    const revised = "alpha\nbeta two\ngamma\ndelta";

    const legacy = await lensRun("paper", "revisionDiff", { data: { original, revised } });

    const save = await lensRun("paper", "paper-save", { params: { title: `Cross-Check Paper ${randomUUID()}` } }, ctx);
    const paperId = save.result.paper.id;
    await lensRun("paper", "paper-version-save", { params: { paperId, content: original } }, ctx);
    await lensRun("paper", "paper-version-save", { params: { paperId, content: revised } }, ctx);
    const modern = await lensRun("paper", "paper-version-diff", { params: { paperId, fromVersion: 1, toVersion: 2 } }, ctx);

    assert.deepEqual(modern.result.oldStats, legacy.result.oldStats);
    assert.deepEqual(modern.result.newStats, legacy.result.newStats);
    assert.deepEqual(modern.result.diff, legacy.result.diff);
    assert.equal(modern.result.changeRate, legacy.result.changeRate);
    assert.deepEqual(modern.result.addedPreview, legacy.result.addedPreview);
    assert.deepEqual(modern.result.removedPreview, legacy.result.removedPreview);
  });
});
