// Source pins for the Docs remainder build (S-DOCS-1..4). The
// behavioural proof is server-side (docs-analysis.test.js: the
// page-bound Analysis delegates to the artifact-form computations;
// title collisions refused). These pins assert the surfaces' shapes:
// the Analysis panel binds pages, not the artifact store the
// workspace never writes; the stats panel subscribes to the workspace
// snapshot; the title field commits on blur with visible refusals;
// the two write-through field types edit local drafts.

import { describe, it } from 'vitest';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(here, "..", rel), "utf8");

const analysis = read("components/docs/AnalysisPanel.tsx");
const workspacePanel = read("components/docs/WorkspacePanel.tsx");
const workspace = read("components/docs/DocsWorkspace.tsx");
const blockRow = read("components/docs/BlockEditorRow.tsx");
const dbViews = read("components/docs/DatabaseViews.tsx");

describe("S-DOCS-1 — Analysis binds the page store", () => {
  it("the panel runs docs-analyze over a picked page", () => {
    assert.ok(analysis.includes("'docs-analyze'"));
    assert.ok(analysis.includes("'page-list'"));
    assert.ok(analysis.includes("'version-list'"));
  });
  it("the panel no longer binds the artifact store", () => {
    assert.ok(!analysis.includes("use-lens-data"));
    assert.ok(!analysis.includes("use-lens-artifacts"));
    assert.ok(!analysis.includes("useRunArtifact("));
  });
});

describe("S-DOCS-2 — stats refresh on workspace change", () => {
  it("the panel subscribes to the workspace snapshot", () => {
    assert.ok(workspacePanel.includes("subscribeDocsWorkspace"));
    assert.ok(workspacePanel.includes("docs-dashboard"));
  });
});

describe("S-DOCS-3 — the title field commits once, refusals visible", () => {
  it("the title is a committing field, not a per-keystroke update", () => {
    assert.ok(workspace.includes("PageTitleField"));
    assert.ok(!workspace.includes("onChange={e => renamePage(e.target.value)}"));
  });
  it("an empty rename reverts with a named notice", () => {
    assert.ok(workspace.includes("A page needs a title"));
  });
});

describe("S-DOCS-4 — write-through fields edit local drafts", () => {
  it("the Embed URL commits on blur from a draft", () => {
    assert.ok(blockRow.includes("urlDraft"));
    assert.ok(blockRow.includes("commitUrl"));
    assert.ok(!blockRow.includes("onChange={e => onChange({ data: { ...block.data, url: e.target.value } })}"));
  });
  it("database cells commit a draft on blur", () => {
    assert.ok(dbViews.includes("commitDraft"));
    assert.ok(dbViews.includes("onBlur={commitDraft}"));
  });
});
