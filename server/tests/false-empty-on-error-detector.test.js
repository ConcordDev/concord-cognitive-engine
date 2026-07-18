/**
 * Tier-2 contract tests for FalseEmptyOnErrorDetector.
 *
 * Seeded from a real, just-fixed instance (2026-07-18, commit e201116b —
 * the projects lens): `lensRun()` (concord-frontend/lib/api/client.ts) is
 * fully try/catch-wrapped internally and NEVER throws — on failure it
 * resolves to `{ data: { ok:false, result:null, error } }`. Several
 * projects-lens panels read `r.data?.result?.tasks || []` straight off that
 * envelope with no `r.data?.ok` check anywhere, so an ACTUAL fetch failure
 * silently rendered "No issues match these filters" — indistinguishable
 * from a real empty project (a false-empty-on-error). The fix checks
 * `r.data?.ok === false` before ever reaching the `|| []` fallback and
 * renders an `<ErrorState>` with the real server reason.
 *
 * Pinned behavior:
 *   - FIRES on a `lensRun`-bound identifier whose `.data?.result?.field`
 *     falls back to `|| []` with zero `.ok` check / try-catch / setError /
 *     isError / ErrorState anywhere in the enclosing function (high — a
 *     silent honest-by-construction violation; the PR ratchet blocks a new one).
 *   - Does NOT fire when the same block checks `.data?.ok === false` before
 *     the fallback (the house fix idiom).
 *   - Does NOT fire when the call is wrapped in try/catch, or chains a
 *     `.catch(...)` directly on the awaited call.
 *   - Does NOT fire on a clean file with no lensRun/runDomain calls at all.
 *
 * Run: node --test tests/false-empty-on-error-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runFalseEmptyOnErrorDetector } from "../lib/detectors/false-empty-on-error-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `false-empty-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

const REPORT_SHAPE = ["id", "ok", "summary", "findings", "durationMs"];
function assertReportShape(r) {
  assert.ok(typeof r === "object" && r !== null);
  for (const k of REPORT_SHAPE) assert.ok(k in r, `missing key: ${k}`);
  assert.equal(typeof r.ok, "boolean");
  assert.ok(Array.isArray(r.findings));
}
function realFindings(r) {
  return r.findings.filter((f) => f.id === "false_empty_on_error");
}

// The exact historical bug shape (pre-fix PjPortfolioPanel.tsx): a lensRun()
// result falls straight through to `.data?.result?.projects || []` with NO
// `.ok` check, try/catch, setError, isError, or ErrorState render anywhere
// in the enclosing function.
const POSITIVE_FIXTURE = `'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export function PjPortfolioPanel() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('projects', 'portfolio', {});
    setProjects(r.data?.result?.projects || []);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return <div>{projects.length}</div>;
}
`;

// The house fix idiom (post-fix ProjectsSection.tsx): check
// \`.data?.ok === false\` and render an ErrorState BEFORE the \`|| []\`
// fallback is ever reached.
const NEGATIVE_FIXTURE_OK_CHECK = `'use client';

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { ErrorState } from '@/components/ui';

export function ProjectsSection() {
  const [projects, setProjects] = useState([]);
  const [loadError, setLoadError] = useState(null);

  const refreshProjects = useCallback(async () => {
    const r = await lensRun('projects', 'project-list', {});
    if (r.data?.ok === false) {
      setLoadError(r.data?.error || 'Could not load projects.');
      return;
    }
    setLoadError(null);
    const list = r.data?.result?.projects || [];
    setProjects(list);
  }, []);

  return loadError ? <ErrorState message={loadError} onRetry={refreshProjects} /> : <div>{projects.length}</div>;
}
`;

// try/catch directly wrapping the awaited call — also a legitimate
// distinguishing-the-error-case idiom.
const NEGATIVE_FIXTURE_TRY_CATCH = `'use client';

import { apiHelpers } from '@/lib/api/client';

export async function fetchWhoAmI() {
  try {
    const r = await apiHelpers.lens.runDomain('auth', 'whoami');
    return (r.data?.result?.items || []);
  } catch (e) {
    return [];
  }
}
`;

const CLEAN_FIXTURE = `'use client';

export default function EmptyPage() {
  return <div>Nothing fetched here.</div>;
}
`;

describe("FalseEmptyOnErrorDetector — positive: unguarded envelope fallback", () => {
  it("flags `r.data?.result?.projects || []` with zero error handling as false_empty_on_error (high)", async () => {
    const dir = withFixture({ "concord-frontend/components/projects/PjPortfolioPanel.tsx": POSITIVE_FIXTURE });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(r.ok, true);
      const findings = realFindings(r);
      const hit = findings.find((f) => f.id === "false_empty_on_error");
      assert.ok(hit, `expected a false_empty_on_error finding, got: ${JSON.stringify(findings)}`);
      assert.equal(hit.severity, "high");
      assert.match(hit.location, /PjPortfolioPanel\.tsx/);
      assert.equal(hit.evidence.identifier, "r");
      assert.match(hit.evidence.chain, /r\.data\?\.result\?\.projects/);
    } finally { teardown(dir); }
  });

  it("flags the Promise.all-destructured shape (a genuine second lensRun in the codebase)", async () => {
    const dir = withFixture({
      "concord-frontend/components/projects/PjBoardPanel.tsx": `'use client';
import { useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

export function PjBoardPanel({ projectId }) {
  const refresh = useCallback(async () => {
    const [b, w] = await Promise.all([
      lensRun('projects', 'board', { projectId }),
      lensRun('projects', 'wip-list', { projectId }),
    ]);
    return (w.data?.result?.limits || []);
  }, [projectId]);
  return null;
}
`,
    });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      const hit = realFindings(r).find((f) => f.evidence.identifier === "w");
      assert.ok(hit, `expected a finding on the Promise.all-destructured 'w', got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });
});

describe("FalseEmptyOnErrorDetector — negative: error case is distinguished", () => {
  it("does NOT flag when the block checks `.data?.ok === false` before the fallback (house fix idiom)", async () => {
    const dir = withFixture({ "concord-frontend/components/projects/ProjectsSection.tsx": NEGATIVE_FIXTURE_OK_CHECK });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0, `expected zero findings, got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });

  it("does NOT flag when the awaited call is directly wrapped in try/catch", async () => {
    const dir = withFixture({ "concord-frontend/components/auth/WhoAmI.tsx": NEGATIVE_FIXTURE_TRY_CATCH });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, `expected zero findings, got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });

  it("does NOT flag when `.catch(...)` is chained directly on the awaited call", async () => {
    const dir = withFixture({
      "concord-frontend/components/auth/WhoAmICatch.tsx": `'use client';
import { apiHelpers } from '@/lib/api/client';

export async function fetchWhoAmI() {
  const r = await apiHelpers.lens.runDomain('auth', 'whoami').catch(() => null);
  return (r?.data?.result?.items || []);
}
`,
    });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, `expected zero findings, got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });

  it("does NOT flag a react-query isError-handled fetch", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo/FooPanel.tsx": `'use client';
import { lensRun } from '@/lib/api/client';

export function FooPanel() {
  async function load() {
    const r = await lensRun('foo', 'list', {});
    const isError = r.data?.ok === false;
    if (isError) return [];
    return (r.data?.result?.items || []);
  }
  return null;
}
`,
    });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, `expected zero findings, got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });
});

describe("FalseEmptyOnErrorDetector — clean file / no sources", () => {
  it("returns zero findings on a file with no lensRun/runDomain calls at all", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/empty/page.tsx": CLEAN_FIXTURE });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.id, "false-empty-on-error");
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag a plain `|| []` with no envelope source nearby", async () => {
    const dir = withFixture({
      "concord-frontend/components/bar/BarPanel.tsx": `'use client';
export function BarPanel({ items }) {
  const list = items || [];
  return <ul>{list.map((x) => <li key={x.id}>{x.id}</li>)}</ul>;
}
`,
    });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });
});

describe("FalseEmptyOnErrorDetector — annotation opt-out", () => {
  it("respects @false-empty-on-error-ok-file anywhere in the file", async () => {
    const dir = withFixture({
      "concord-frontend/components/projects/OptOutPanel.tsx":
        `// @false-empty-on-error-ok-file: legacy panel, tracked in TICKET-456\n` + POSITIVE_FIXTURE,
    });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "file-level annotation suppresses every finding");
    } finally { teardown(dir); }
  });

  it("respects a detector-allow line comment up to 4 lines above the finding", async () => {
    const fixture = `'use client';

import { useCallback } from 'react';
import { lensRun } from '@/lib/api/client';

export function OptOutLine() {
  const refresh = useCallback(async () => {
    const r = await lensRun('projects', 'portfolio', {});
    // detector-allow: false-empty-on-error intentional — legacy panel, TICKET-789
    return (r.data?.result?.projects || []);
  }, []);
  return null;
}
`;
    const dir = withFixture({ "concord-frontend/components/projects/OptOutLine.tsx": fixture });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "line-level annotation suppresses this finding");
    } finally { teardown(dir); }
  });
});

describe("FalseEmptyOnErrorDetector — report shape + robustness", () => {
  it("returns canonical DetectorReport shape and never throws on an empty tree", async () => {
    const dir = withFixture({ "README.md": "no frontend here" });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });

  it("only scans concord-frontend/{app,components} — ignores server/ or root-level tsx", async () => {
    const dir = withFixture({
      "server/domains/foo.tsx": POSITIVE_FIXTURE,
      "random/page.tsx": POSITIVE_FIXTURE,
    });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "files outside the scan dirs must never be flagged");
    } finally { teardown(dir); }
  });
});
