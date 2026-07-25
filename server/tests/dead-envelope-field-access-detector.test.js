/**
 * Bidirectional pinning tests for DeadEnvelopeFieldAccessDetector.
 *
 * Seeded from a real, now-fixed bug in
 * concord-frontend/components/art/ConceptArtBoard.tsx: `lensRun()`
 * (concord-frontend/lib/api/client.ts) already unwraps the POST
 * /api/lens/run { ok, result } envelope before it resolves, so a macro's
 * own success/failure normally lands at `r.data.ok` / `r.data.error` — but
 * ONLY when the macro's OWN backend handler nests a `result:` key inside
 * its `ok:true` success return (the `art.concept-art-list` shape). The
 * pre-fix code checked `r.data?.result?.ok === false` as the only failure
 * signal: since `.result.ok` is structurally always undefined for THAT
 * macro, a real "db unavailable" failure never surfaced.
 *
 * Calibration correction (found while spot-checking this detector against
 * the real repo, see the detector's own header for the full story): a naive
 * "always flag .result.ok/.result.error" version produced ~49 findings, but
 * most were WRONG — macros like `sessions.search` / `forecast.recent`
 * return a FLAT `{ ok: true, ...data }` payload with no nested `result:`
 * key, so `.result.ok` genuinely IS that macro's own real success flag.
 * The detector now cross-references the frontend call site's `(domain,
 * action)` against the real backend handler in `server/` before flagging —
 * these tests exercise that cross-reference in both directions, so every
 * fixture below ships a matching backend registration file.
 *
 * Run: cd server && node --test tests/dead-envelope-field-access-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runDeadEnvelopeFieldAccessDetector } from "../lib/detectors/dead-envelope-field-access-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `dead-envelope-test-${Math.random().toString(36).slice(2)}`);
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
  return r.findings.filter((f) => f.severity !== "info");
}

// Backend registration matching the REAL server/domains/art.js shape: every
// ok:true return nests a result:{...} key — "nested" classification.
const ART_BACKEND = `export default function registerArt(registerLensAction) {
  registerLensAction("art", "concept-art-list", (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    return { ok: true, result: { conceptArt: [], count: 0 } };
  });
}
`;

// Backend registration matching the REAL server/domains/sessions.js shape:
// the ok:true return is FLAT — no result: key — "flat" classification.
const SESSIONS_BACKEND = `export default function registerSessions(register) {
  register("sessions", "search", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, sort: "recent", query: "", sessions: [] };
  });
}
`;

const QUESTS_BACKEND = `export default function registerQuests(registerLensAction) {
  registerLensAction("quests", "claimRewards", (ctx, _a, params = {}) => {
    if (!params.questId) return { ok: false, error: "questId required" };
    return { ok: true, result: { rewards: [] } };
  });
}
`;

const X_Y_BACKEND = `export default function registerX(registerLensAction) {
  registerLensAction("x", "y", (ctx, _a, params = {}) => {
    return { ok: true, result: { items: [] } };
  });
}
`;

// The exact pre-fix ConceptArtBoard.tsx shape (reproduced synthetically —
// the real file is fixed): the ONLY failure signal is a read of
// `.result.ok` / `.result.error`, which lensRun's contract guarantees is
// always undefined/null FOR THIS SPECIFIC macro (nested backend shape).
const POSITIVE_FIXTURE = `'use client';
import { lensRun } from '@/lib/api/client';

export function ConceptArtBoard() {
  async function refresh() {
    const r = await lensRun('art', 'concept-art-list', {});
    if (r.data?.result?.ok === false) {
      setError(r.data.result.error || 'failed to load concept board');
      setEntries([]);
    } else {
      setError(null);
      setEntries((r.data?.result?.conceptArt) || []);
    }
  }
  return null;
}
`;

// The house fix: success/failure read directly off r.data.ok / r.data.error;
// the deep .result.conceptArt read is fine (not .ok/.error).
const NEGATIVE_FIXTURE = `'use client';
import { lensRun } from '@/lib/api/client';

export function ConceptArtBoard() {
  async function refresh() {
    const r = await lensRun('art', 'concept-art-list', {});
    if (r.data?.ok === false) {
      setError(r.data.error || 'failed to load concept board');
      setEntries([]);
    } else {
      setError(null);
      setEntries((r.data?.result?.conceptArt) || []);
    }
  }
  return null;
}
`;

const CLEAN_FIXTURE = `'use client';
export function EmptyPage() {
  return <div>Nothing fetched here.</div>;
}
`;

describe("DeadEnvelopeFieldAccessDetector — positive: reproduces the ConceptArtBoard bug", () => {
  it("flags `r.data?.result?.ok === false` and `r.data.result.error` as dead_envelope_field_access (high)", async () => {
    const dir = withFixture({
      "server/domains/art.js": ART_BACKEND,
      "concord-frontend/components/art/ConceptArtBoard.tsx": POSITIVE_FIXTURE,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(r.ok, true);
      const findings = realFindings(r);
      assert.ok(findings.length >= 2, `expected at least 2 findings (.ok and .error), got: ${JSON.stringify(findings)}`);
      const fields = findings.map((f) => f.evidence.field).sort();
      assert.deepEqual(fields, ["error", "ok"]);
      for (const f of findings) {
        assert.equal(f.id, "dead_envelope_field_access");
        assert.equal(f.severity, "high");
        assert.match(f.location, /ConceptArtBoard\.tsx/);
        assert.equal(f.evidence.bindingKind, "full");
        assert.equal(f.evidence.domainAction, "art.concept-art-list");
      }
    } finally { teardown(dir); }
  });

  it("flags the one-hop `.data` derivation idiom (`const node = qRes?.data; node.result.ok`)", async () => {
    const dir = withFixture({
      "server/domains/quests.js": QUESTS_BACKEND,
      "concord-frontend/app/lenses/quests/page.tsx": `'use client';
import { lensRun } from '@/lib/api/client';

export default function QuestsPage() {
  async function handleClaim(questId: string) {
    const qRes = await lensRun('quests', 'claimRewards', { questId });
    const node = qRes?.data;
    if (!node || node.ok === false || !node.result || node.result.ok === false) {
      throw new Error(node?.error || 'Could not claim rewards.');
    }
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      const hit = realFindings(r).find((f) => f.evidence.bindingKind === "dataDirect");
      assert.ok(hit, `expected a dataDirect finding for the one-hop derivation, got: ${JSON.stringify(realFindings(r))}`);
      assert.equal(hit.evidence.field, "ok");
    } finally { teardown(dir); }
  });

  it("flags a lensRun<{...}>(...) call with an explicit TS generic type argument (real repo shape)", async () => {
    // Regression for a real miss found scanning the actual repo:
    // concord-frontend/app/lenses/quests/page.tsx's handleClaim calls
    // `lensRun<{ ok: boolean; rewards?: unknown[]; error?: string }>(...)` —
    // a plain `lensRun\\s*\\(` binding regex never matches a generic
    // argument between the name and the call parens, so the whole binding
    // (and therefore its dead .result.ok/.result.error reads) went
    // undetected until this fix.
    const dir = withFixture({
      "server/domains/quests.js": QUESTS_BACKEND,
      "concord-frontend/app/lenses/quests/page.tsx": `'use client';
import { lensRun } from '@/lib/api/client';

export default function QuestsPage() {
  async function handleClaim(questId: string) {
    const r = await lensRun<{ ok: boolean; rewards?: unknown[]; error?: string }>(
      'quests', 'claimRewards', { questId },
    );
    const node = r?.data;
    if (!node || node.ok === false || !node.result || node.result.ok === false) {
      return node?.result?.error || node?.error || 'Could not claim rewards.';
    }
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      const findings = realFindings(r);
      assert.ok(findings.length >= 2, `expected findings for both node.result.ok and node?.result?.error, got: ${JSON.stringify(findings)}`);
      assert.ok(findings.every((f) => f.evidence.bindingKind === "dataDirect"));
    } finally { teardown(dir); }
  });

  it("flags `const { data } = await lensRun(...)` destructured form", async () => {
    const dir = withFixture({
      "server/domains/x.js": X_Y_BACKEND,
      "concord-frontend/components/x/Panel.tsx": `'use client';
import { lensRun } from '@/lib/api/client';

export function Panel() {
  async function load() {
    const { data } = await lensRun('x', 'y', {});
    if (data?.result?.error) return data.result.error;
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      const hit = realFindings(r).find((f) => f.evidence.field === "error");
      assert.ok(hit, `expected a dead .result.error finding, got: ${JSON.stringify(realFindings(r))}`);
      assert.equal(hit.evidence.bindingKind, "dataDirect");
    } finally { teardown(dir); }
  });
});

describe("DeadEnvelopeFieldAccessDetector — negative: the corrected version is quiet", () => {
  it("does NOT flag the fixed ConceptArtBoard (ok/error read off r.data, not r.data.result)", async () => {
    const dir = withFixture({
      "server/domains/art.js": ART_BACKEND,
      "concord-frontend/components/art/ConceptArtBoardFixed.tsx": NEGATIVE_FIXTURE,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0, `expected zero findings, got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });

  it("returns zero findings on a clean file with no lensRun calls at all", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/empty/page.tsx": CLEAN_FIXTURE });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.id, "dead-envelope-field-access");
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });
});

describe("DeadEnvelopeFieldAccessDetector — anti-noise: superficially similar but correct shapes", () => {
  it("does NOT flag `.result.error` when the NESTED result's own inner literal carries a real `error` field (the real database.query-run finding)", async () => {
    // Second calibration correction: server/domains/database.js's query-run
    // wraps its success as `{ ok: true, result: { error: sqlError, ... } }`
    // — the OUTER wrapper is nested (so a blanket per-macro verdict would
    // call the whole macro "nested" and flag every .result.* read as dead)
    // but the INNER result literal independently carries its own `error`
    // key as real domain data (the SQL execution's own error message), so
    // `.result.error` genuinely IS populated on a query failure. Only the
    // `.ok` field is truly dead here (the inner literal has no `ok` key of
    // its own) — this test pins that `.error` must NOT be flagged even
    // though `.ok` correctly would be for the same macro.
    const dir = withFixture({
      "server/domains/database.js": `export default function registerDatabase(registerLensAction) {
  registerLensAction("database", "query-run", (ctx, _a, params = {}) => {
    if (!params.sql) return { ok: false, error: "sql required" };
    let res;
    try { res = runSql(params.sql); } catch (e) { res = { error: String(e) }; }
    if (res.error) return { ok: true, result: { error: res.error, success: false } };
    return { ok: true, result: { rows: res.rows, success: true } };
  });
}
`,
      "concord-frontend/components/database/LiveDbClient.tsx": `'use client';
import { lensRun } from '@/lib/api/client';

export function LiveDbClient() {
  async function runQuery() {
    const r = await lensRun('database', 'query-run', { sql: 'SELECT 1' });
    if (r.data.ok && r.data.result) {
      if (!r.data.result.success) return r.data.result.error;
    }
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(
        realFindings(r).length, 0,
        `a nested wrapper whose inner literal carries its own real .error must not be flagged; got: ${JSON.stringify(realFindings(r))}`,
      );
    } finally { teardown(dir); }
  });

  it("STILL flags `.result.ok` on that same database.js-shaped macro (its inner literal never carries `ok`)", async () => {
    const dir = withFixture({
      "server/domains/database.js": `export default function registerDatabase(registerLensAction) {
  registerLensAction("database", "query-run", (ctx, _a, params = {}) => {
    if (!params.sql) return { ok: false, error: "sql required" };
    let res;
    try { res = runSql(params.sql); } catch (e) { res = { error: String(e) }; }
    if (res.error) return { ok: true, result: { error: res.error, success: false } };
    return { ok: true, result: { rows: res.rows, success: true } };
  });
}
`,
      "concord-frontend/components/database/OkReader.tsx": `'use client';
import { lensRun } from '@/lib/api/client';
export function OkReader() {
  async function runQuery() {
    const r = await lensRun('database', 'query-run', { sql: 'SELECT 1' });
    if (r.data?.result?.ok === false) return 'failed';
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      const hit = realFindings(r).find((f) => f.evidence.field === "ok");
      assert.ok(hit, `.ok has no path to reach r.data.result on this macro and must still be flagged; got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });

  it("does NOT flag `.result.ok` when the backend macro's success shape is FLAT (the real sessions.search/forecast.recent finding)", async () => {
    // This is the calibration case: found by spot-checking the detector's
    // first-draft output against the real repo. sessions.search returns
    // `{ ok: true, sort, query, sessions }` — flat, no nested result: key —
    // so `r.data.result.ok` really is that macro's own live success flag.
    const dir = withFixture({
      "server/domains/sessions.js": SESSIONS_BACKEND,
      "concord-frontend/app/lenses/sessions/page.tsx": `'use client';
import { lensRun } from '@/lib/api/client';

export default function SessionsPage() {
  async function fetchAll() {
    const r = await lensRun('sessions', 'search', { limit: 100 });
    if (r.data?.ok && r.data.result?.ok) {
      return r.data.result.sessions || [];
    }
    return [];
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(
        realFindings(r).length, 0,
        `a flat-shaped backend macro's own real .result.ok must never be flagged; got: ${JSON.stringify(realFindings(r))}`,
      );
    } finally { teardown(dir); }
  });

  it("does NOT flag a macro with no resolvable backend registration (unknown classification — conservative miss)", async () => {
    const dir = withFixture({
      "concord-frontend/components/x/Unregistered.tsx": `'use client';
import { lensRun } from '@/lib/api/client';
export function Unregistered() {
  async function load() {
    const r = await lensRun('nowhere', 'nothing', {});
    if (r.data?.result?.ok === false) return r.data.result.error;
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "an unresolvable backend macro must not be flagged — proof, not suspicion");
    } finally { teardown(dir); }
  });

  it("does NOT flag a deep read of a real domain field (.result.conceptArt, not .ok/.error)", async () => {
    const dir = withFixture({
      "server/domains/art.js": ART_BACKEND,
      "concord-frontend/components/art/Deep.tsx": `'use client';
import { lensRun } from '@/lib/api/client';
export function Deep() {
  async function load() {
    const r = await lensRun('art', 'concept-art-list', {});
    return r.data?.result?.conceptArt || [];
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "reading a real payload field (not .ok/.error) is legitimate");
    } finally { teardown(dir); }
  });

  it("does NOT flag `.result.ok` on a var sourced from a plain axios call (not lensRun)", async () => {
    const dir = withFixture({
      "server/domains/art.js": ART_BACKEND,
      "concord-frontend/components/x/Raw.tsx": `'use client';
import { api } from '@/lib/api/client';
export function Raw() {
  async function load() {
    const r = await api.post('/api/something', {});
    // r is NOT sourced from lensRun() — its .data.result may genuinely carry
    // a domain-shaped { ok, error } as real, non-enveloped payload data.
    if (r.data.result.ok === false) return r.data.result.error;
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "only lensRun()-traced bindings are in scope");
    } finally { teardown(dir); }
  });

  it("does NOT flag `r.data.ok` / `r.data.error` (the correct, shallow envelope fields)", async () => {
    const dir = withFixture({
      "server/domains/x.js": X_Y_BACKEND,
      "concord-frontend/components/x/Shallow.tsx": `'use client';
import { lensRun } from '@/lib/api/client';
export function Shallow() {
  async function load() {
    const r = await lensRun('x', 'y', {});
    if (!r.data.ok) return r.data.error;
    return r.data.result;
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "r.data.ok/r.data.error are the CORRECT fields, not nested under .result");
    } finally { teardown(dir); }
  });

  it("does not cross-contaminate an unrelated sibling function reusing the name `r`", async () => {
    const dir = withFixture({
      "server/domains/a.js": `export default function registerA(registerLensAction) {
  registerLensAction("a", "list", (ctx, _a, params = {}) => {
    return { ok: true, result: { items: [] } };
  });
}
`,
      "concord-frontend/components/x/Sibling.tsx": `'use client';
import { lensRun } from '@/lib/api/client';
export function Sibling() {
  async function loadA() {
    const r = await lensRun('a', 'list', {});
    return r.data?.ok ? r.data.result : null;
  }
  function loadB(r: { result: { ok: boolean } }) {
    // unrelated callback param, also named 'r', never touched lensRun
    return r.result.ok;
  }
  return null;
}
`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "loadB's 'r' is a different binding in a different scope, not lensRun-sourced");
    } finally { teardown(dir); }
  });
});

describe("DeadEnvelopeFieldAccessDetector — annotation opt-out", () => {
  it("respects @dead-envelope-ok in the file's first 5 lines", async () => {
    const dir = withFixture({
      "server/domains/art.js": ART_BACKEND,
      "concord-frontend/components/art/OptOut.tsx": `// @dead-envelope-ok: legacy, tracked in TICKET-789\n` + POSITIVE_FIXTURE,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "file-level annotation suppresses every finding");
    } finally { teardown(dir); }
  });
});

describe("DeadEnvelopeFieldAccessDetector — report shape + robustness", () => {
  it("returns canonical DetectorReport shape and never throws on an empty tree", async () => {
    const dir = withFixture({ "README.md": "no frontend here" });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });

  it("only scans concord-frontend/{app,components,lib}", async () => {
    const dir = withFixture({
      "server/domains/art.js": ART_BACKEND,
      "server/domains/foo.tsx": POSITIVE_FIXTURE,
      "random/page.tsx": POSITIVE_FIXTURE,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "files outside the scan dirs must never be flagged");
    } finally { teardown(dir); }
  });
});
