// Page-bound Analysis (S-DOCS-1 / F3) + title integrity (S-DOCS-3 / F13)
// for the docs lens. The Analysis computations live as artifact-form
// handlers (readabilityScore / crossReference / versionDiff over
// artifact.data); the workspace's documents are domain-state pages, so
// docs-analyze synthesizes each handler's input from the page store
// and delegates to the same handler. Pinned here: the page-bound
// results equal the artifact-bound results on identical content, the
// outputs name the page, the diff runs snapshot → current, and title
// collisions are refused while the "Untitled" create default stands.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDocsActions from "../domains/docs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}, artifact = { id: null, data: {}, meta: {} }) {
  const fn = ACTIONS.get(`docs.${name}`);
  assert.ok(fn, `docs.${name} not registered`);
  return fn(ctx, artifact, params);
}

before(() => { registerDocsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

const TEXT = "The quick brown fox jumps over the lazy dog. Simple tools make careful work visible to everyone on the team.";

function pageWithText(title, text) {
  const p = call("page-create", ctxA, { title }).result.page;
  call("block-add", ctxA, { pageId: p.id, type: "paragraph", text });
  return call("page-detail", ctxA, { id: p.id }).result.page;
}

describe("docs.docs-analyze — page-bound Analysis", () => {
  it("readability runs over the page's real text and names the page", () => {
    const p = pageWithText("Readable page", TEXT);
    const r = call("docs-analyze", ctxA, { pageId: p.id, tool: "readabilityScore" });
    assert.equal(r.ok, true);
    assert.equal(r.result.page.title, "Readable page");
    assert.equal(r.result.statistics.wordCount, TEXT.split(/\s+/).length);
  });

  it("page-bound readability EQUALS the artifact-bound computation on the same text", () => {
    const p = pageWithText("Parity page", TEXT);
    const viaPage = call("docs-analyze", ctxA, { pageId: p.id, tool: "readabilityScore" }).result;
    const viaArtifact = call("readabilityScore", ctxA, {}, { id: null, data: { text: TEXT }, meta: {} }).result;
    assert.deepEqual(viaPage.metrics, viaArtifact.metrics);
    assert.deepEqual(viaPage.summary, viaArtifact.summary);
    assert.deepEqual(viaPage.statistics, viaArtifact.statistics);
  });

  it("crossReference sees the workspace's [[title]] links", () => {
    const target = pageWithText("Target page", "Some body text here.");
    pageWithText("Linking page", `See [[${target.title}]] for details.`);
    const r = call("docs-analyze", ctxA, { pageId: target.id, tool: "crossReference" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalPages, 2);
    assert.ok(r.result.totalLinks >= 1, `expected >=1 link, got ${r.result.totalLinks}`);
    assert.equal(r.result.page.title, "Target page");
  });

  it("versionDiff runs from the first snapshot to the current page", () => {
    const p = pageWithText("Versioned page", "Alpha bravo charlie delta echo.");
    call("version-snapshot", ctxA, { pageId: p.id, label: "v1" });
    const blocks = call("page-detail", ctxA, { id: p.id }).result.page.blocks;
    call("block-update", ctxA, { pageId: p.id, blockId: blocks[0].id, text: "Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo." });
    const r = call("docs-analyze", ctxA, { pageId: p.id, tool: "versionDiff" });
    assert.equal(r.ok, true);
    assert.equal(r.result.from, "v1");
    assert.equal(r.result.to, "current");
    assert.ok(r.result.wordDelta > 0, `expected positive word delta, got ${r.result.wordDelta}`);
  });

  it("versionDiff with no snapshots answers with the named instruction, not a dead end", () => {
    const p = pageWithText("Unsnapshotted", "Some text without versions.");
    const r = call("docs-analyze", ctxA, { pageId: p.id, tool: "versionDiff" });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /save a version/i);
  });

  it("an unknown page and an unknown tool are refused plainly", () => {
    assert.equal(call("docs-analyze", ctxA, { pageId: "nope", tool: "readabilityScore" }).ok, false);
    const p = pageWithText("Tool page", "Text.");
    assert.equal(call("docs-analyze", ctxA, { pageId: p.id, tool: "nope" }).ok, false);
  });
});

describe("docs title integrity (F13)", () => {
  it("an explicit duplicate title is refused at create", () => {
    call("page-create", ctxA, { title: "Meeting notes" });
    const dup = call("page-create", ctxA, { title: "meeting notes" });
    assert.equal(dup.ok, false);
    assert.match(dup.error, /already exists/);
  });

  it("the Untitled default stays exempt — two untitled pages coexist", () => {
    assert.equal(call("page-create", ctxA, {}).ok, true);
    assert.equal(call("page-create", ctxA, {}).ok, true);
  });

  it("a rename onto another page's title is refused; the title stands", () => {
    const a = call("page-create", ctxA, { title: "Alpha" }).result.page;
    const b = call("page-create", ctxA, { title: "Beta" }).result.page;
    const r = call("page-update", ctxA, { id: b.id, title: "alpha" });
    assert.equal(r.ok, false);
    assert.equal(call("page-detail", ctxA, { id: b.id }).result.page.title, "Beta");
    assert.equal(call("page-detail", ctxA, { id: a.id }).result.page.title, "Alpha");
  });

  it("a rename to a free title, or a case-only change of its own, stands", () => {
    const p = call("page-create", ctxA, { title: "Gamma" }).result.page;
    assert.equal(call("page-update", ctxA, { id: p.id, title: "GAMMA" }).ok, true);
    assert.equal(call("page-update", ctxA, { id: p.id, title: "Delta" }).ok, true);
    assert.equal(call("page-detail", ctxA, { id: p.id }).result.page.title, "Delta");
  });
});
