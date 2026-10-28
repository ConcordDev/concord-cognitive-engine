// Phase 9b (static, no network): the AutoSourceButton talks only to the
// research lens actions from 9a, surfaces the honest failure states, and is
// mounted in the Research workbench search tab only when coverage is thin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const button = readFileSync(join(root, "concord-frontend/components/common/AutoSourceButton.tsx"), "utf8");
const workbench = readFileSync(join(root, "concord-frontend/components/research/ResearchWorkbench.tsx"), "utf8");

test("the button calls the 9a lens actions and nothing upstream directly", () => {
  assert.match(button, /lensRun<[^>]*>\('research', 'auto-source',/);
  assert.match(button, /lensRun\('research', 'auto-source-publish', \{ summaryId \}\)/);
  assert.match(button, /lensRun<[^>]*>\('dtu', 'get', \{ id: res\.summaryId \}\)/);
  for (const host of ["api.gdeltproject.org", "en.wikipedia.org", "api.openalex.org", "api.crossref.org", "export.arxiv.org", "catalog.data.gov"]) {
    assert.ok(!button.includes(host), `AutoSourceButton must not call ${host} directly`);
  }
});

test("the honest failure states are surfaced, not hidden", () => {
  for (const s of ["auto_source_disabled", "insufficient_sources", "user_hourly_limit", "global_daily_cap", "llm_unavailable", "not_author", "citation_missing"]) {
    assert.ok(button.includes(s), `missing honest state: ${s}`);
  }
  assert.match(button, /Nothing was saved/);
  assert.match(button, /Private draft/);
  assert.match(button, /Publish summary/);
});

test("the workbench mounts it only when search coverage is thin", () => {
  assert.match(workbench, /import \{ AutoSourceButton \} from '@\/components\/common\/AutoSourceButton';/);
  assert.match(workbench, /searched && hits\.length < 3/);
  assert.match(workbench, /<AutoSourceButton key=\{query\} topic=\{query\} lensDomain="research" \/>/);
});

test("the button reads auto-source-status up front and shows a clear disabled state while the server switch is off", () => {
  assert.match(button, /lensRun<AutoSourceStatus>\('research', 'auto-source-status', \{\}\)/);
  assert.match(button, /Auto-source is off on this server/);
  assert.match(button, /disabled=\{phase\.kind === 'running' \|\| trimmed\.length < 2 \|\| !!blocked\}/);
  assert.match(button, /Sign in to auto-source a topic/);
  assert.ok(button.includes("auth_required"), "signed-out refusal is explained");
  assert.match(button, /runs left this hour/);
});
