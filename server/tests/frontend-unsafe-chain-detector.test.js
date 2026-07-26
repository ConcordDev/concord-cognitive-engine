/**
 * Tier-2 contract tests for FrontendUnsafeChainDetector.
 *
 * Seeded from a real verification-audit finding (2026-07-05, commits
 * db1a0a75 + 61122eef on claude/wave-abc-ci-fixes-debt-434jn3): 48+
 * frontend call sites read a macro-computed field straight off the raw
 * `/api/lens/run` response (or off a `.data`/`.result` envelope field)
 * with no guard — `POST /api/lens/run` always answers
 * `{ ok: true, result: PAYLOAD }`, so an unguarded `res.data.listings`
 * throws (or silently no-ops) whenever `res` doesn't carry the shape the
 * reader assumed.
 *
 * Pinned behavior:
 *   - FIRES on a raw macro/fetch source used in a 2+-deep chain (or
 *     `.map`/`.length`) with ZERO guard anywhere in the file (high).
 *   - Does NOT fire when the chain is guarded by an `if (x?.field)` check
 *     that textually precedes the risky access (the house idiom).
 *   - Does NOT fire on a truly clean file (no fetch/macro sources at all).
 *
 * Run: node --test tests/frontend-unsafe-chain-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runFrontendUnsafeChainDetector } from "../lib/detectors/frontend-unsafe-chain-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `unsafe-chain-test-${Math.random().toString(36).slice(2)}`);
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

// The exact historical bug shape: a macro()-sourced response read via
// `res.data?.listings || res.data || []` — the `?.` is one link too late
// (it guards `.listings`, not `res` itself), so `res.data` still throws
// if `res` is null/undefined, which the file's own `macro()` helper can
// return on a fetch failure.
const POSITIVE_FIXTURE = `'use client';

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function MusicPage() {
  async function loadListings() {
    const res = await macro('music', 'listings');
    const items = res.data?.listings || res.data || [];
    return items.map((item: any) => item.id);
  }
  return null;
}
`;

// The house fix idiom: unwrap the envelope with an optional-chained
// fallback, then guard the specific field with an if-check BEFORE using
// it in a risky chain.
const NEGATIVE_FIXTURE = `'use client';

async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, name, input }),
  }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}

export default function SafePage() {
  async function loadItems() {
    const j = await macro('music', 'listings');
    const payload = j?.result ?? j;
    if (payload?.items) {
      return payload.items.map((item: any) => item.id);
    }
    return [];
  }
  return null;
}
`;

const CLEAN_FIXTURE = `'use client';

export default function EmptyPage() {
  return <div>Nothing fetched here.</div>;
}
`;

describe("FrontendUnsafeChainDetector — positive: zero-guard chain on macro response", () => {
  it("flags `res.data?.listings || res.data || []` then `.map()` as unsafe_chain_no_guard (high)", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/music/page.tsx": POSITIVE_FIXTURE });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(r.ok, true);
      const findings = realFindings(r);
      const hit = findings.find((f) => f.id === "unsafe_chain_no_guard");
      assert.ok(hit, `expected an unsafe_chain_no_guard finding, got: ${JSON.stringify(findings)}`);
      assert.equal(hit.severity, "high");
      assert.match(hit.location, /music\/page\.tsx/);
      assert.match(hit.evidence.chain, /res\.data/);
    } finally { teardown(dir); }
  });

  it("flags a direct .map() call on the raw macro return with zero guard", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx": `'use client';
async function macro(domain: string, name: string, input: Record<string, unknown> = {}) {
  const r = await fetch('/api/lens/run', { method: 'POST', body: JSON.stringify({ domain, name, input }) }).catch(() => null);
  return r ? r.json().catch(() => null) : null;
}
export default function Foo() {
  async function load() {
    const j = await macro('foo', 'list');
    return j.map((x: any) => x.id);
  }
  return null;
}
`,
    });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      const hit = realFindings(r).find((f) => f.id === "unsafe_chain_no_guard" && f.evidence.reason === "array_method");
      assert.ok(hit, "expected a high-severity array_method finding on the raw source var");
    } finally { teardown(dir); }
  });
});

describe("FrontendUnsafeChainDetector — negative: properly guarded chain", () => {
  it("does NOT flag `const payload = j?.result ?? j; if (payload?.items) payload.items.map(...)`", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/safe/page.tsx": NEGATIVE_FIXTURE });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0, `expected zero findings, got: ${JSON.stringify(realFindings(r))}`);
    } finally { teardown(dir); }
  });

  it("does NOT flag a fully optional-chained access (`res?.data.listings.map(...)`)", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/bar/page.tsx": `'use client';
export default function Bar() {
  async function load() {
    const res = await lensRun('bar', 'list', {});
    return res?.data.listings.map((x: any) => x.id);
  }
  return null;
}
`,
    });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "the base identifier's own `?.` short-circuits the whole chain — fully safe");
    } finally { teardown(dir); }
  });

  it("does NOT flag a shallow single-property read (res.ok) — that's the guard shape, not the bug", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/baz/page.tsx": `'use client';
export default function Baz() {
  async function load() {
    const res = await lensRun('baz', 'list', {});
    if (!res.ok) return null;
    return res.ok;
  }
  return null;
}
`,
    });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });
});

describe("FrontendUnsafeChainDetector — medium: partial guard elsewhere in file", () => {
  it("grades medium when a guard exists in the same scope but doesn't precede this occurrence", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/partial/page.tsx": `'use client';
export default function Partial() {
  async function loadB() {
    const res = await lensRun('partial', 'b', {});
    // Unguarded usage comes FIRST — no guard precedes it yet, so it's
    // not fully safe. But the same block DOES contain a guard for 'res'
    // later on, so this grades medium (partial guard in scope) rather
    // than high (zero guard anywhere in scope).
    const ids = res.items.map((x: any) => x.id);
    if (!res?.ok) return null;
    return ids;
  }
  return null;
}
`,
    });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      const hit = realFindings(r).find((f) => f.id === "unsafe_chain_partial_guard");
      assert.ok(hit, `expected a medium partial-guard finding, got: ${JSON.stringify(realFindings(r))}`);
      assert.equal(hit.severity, "medium");
    } finally { teardown(dir); }
  });
});

describe("FrontendUnsafeChainDetector — clean file", () => {
  it("returns zero real findings on a file with no fetch/macro sources at all", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/empty/page.tsx": CLEAN_FIXTURE });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.id, "frontend-unsafe-chain");
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });
});

describe("FrontendUnsafeChainDetector — annotation opt-out", () => {
  it("respects @unsafe-chain-ok in the file's first 5 lines", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/optout/page.tsx":
        `// @unsafe-chain-ok: legacy page, tracked in TICKET-123\n` + POSITIVE_FIXTURE,
    });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "file-level annotation suppresses every finding");
    } finally { teardown(dir); }
  });
});

describe("FrontendUnsafeChainDetector — report shape + robustness", () => {
  it("returns canonical DetectorReport shape and never throws on an empty tree", async () => {
    const dir = withFixture({ "README.md": "no frontend here" });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.ok, true);
      assert.equal(realFindings(r).length, 0);
    } finally { teardown(dir); }
  });

  it("only scans concord-frontend/{app,components,lib} — ignores server/ or root-level tsx", async () => {
    const dir = withFixture({
      "server/domains/foo.tsx": POSITIVE_FIXTURE,
      "random/page.tsx": POSITIVE_FIXTURE,
    });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(realFindings(r).length, 0, "files outside the scan dirs must never be flagged");
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Optional-chained guard recognition (2026-07-24 correctness fix)
//
// `hasPrecedingPrefixGuard` used to build its prefix pattern with literal
// dots, so the canonical house idiom
//     if (r.data?.result?.session) { …r.data.result.session… }
// never matched a prefix recorded as `r.data.result.session`. 26 of the
// detector's 27 live findings were that single blind spot — correctly
// guarded code reported as unguarded.
//
// These tests are deliberately BIDIRECTIONAL: the fix is only a correctness
// fix if the guarded shapes go quiet AND the genuinely unguarded shape they
// differ from still trips. A detector that stopped flagging the second case
// would be a softened checker, which is the thing this repo forbids.
// ─────────────────────────────────────────────────────────────────────────

const OPTIONAL_GUARD_IF_FIXTURE = `'use client';
import { lensRun } from '@/lib/api/client';

export default function Sessions() {
  async function load() {
    const r = await lensRun('mentorship', 'session-list', {});
    if (r.data?.result?.sessions) {
      return r.data.result.sessions.map((s: any) => s.id);
    }
    return [];
  }
  return null;
}
`;

const OPTIONAL_GUARD_TERNARY_FIXTURE = `'use client';
import { lensRun } from '@/lib/api/client';

export default function ZoneBadge() {
  async function load() {
    const envelope = await lensRun('world', 'zone-at', {});
    const data = envelope?.result ?? envelope;
    return data?.zone ? { name: data.zone.name, kind: data.zone.kind } : null;
  }
  return null;
}
`;

// The control: same depth, same shape, but the ONLY `?.` sits one link too
// late — `r.data` is a plain access evaluated before any optional link, and
// nothing guards `.result` before `.sessions` is read off it. This is the
// real historical bug shape and MUST still be flagged.
const UNGUARDED_CONTROL_FIXTURE = `'use client';
import { lensRun } from '@/lib/api/client';

export default function Unguarded() {
  async function load() {
    const r = await lensRun('mentorship', 'session-list', {});
    return r.data.result.sessions.map((s: any) => s.id);
  }
  return null;
}
`;

describe("FrontendUnsafeChainDetector — optional-chained guards are real guards", () => {
  it("does NOT flag `if (r.data?.result?.sessions) r.data.result.sessions.map(...)`", async () => {
    const dir = withFixture({ "concord-frontend/components/mentorship/Sessions.tsx": OPTIONAL_GUARD_IF_FIXTURE });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(r.ok, true);
      assert.equal(
        realFindings(r).length, 0,
        `an optional-chained if-guard proves the path; got: ${JSON.stringify(realFindings(r))}`,
      );
    } finally { teardown(dir); }
  });

  it("does NOT flag the ternary form `data?.zone ? { ...data.zone.name } : null`", async () => {
    const dir = withFixture({ "concord-frontend/components/world/ZoneBadge.tsx": OPTIONAL_GUARD_TERNARY_FIXTURE });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(r.ok, true);
      assert.equal(
        realFindings(r).length, 0,
        `a ternary guard on the same path is still a guard; got: ${JSON.stringify(realFindings(r))}`,
      );
    } finally { teardown(dir); }
  });

  it("STILL flags the genuinely unguarded control (`r.data.result.sessions.map(...)`, no guard anywhere)", async () => {
    const dir = withFixture({ "concord-frontend/components/mentorship/Unguarded.tsx": UNGUARDED_CONTROL_FIXTURE });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      const hit = realFindings(r).find((f) => f.id === "unsafe_chain_no_guard");
      assert.ok(
        hit,
        "the guard-recognition fix must not blind the detector to a real unguarded deep chain",
      );
    } finally { teardown(dir); }
  });

  it("does not treat a CONTINUING optional chain (`x?.a?.b?.c`) as a ternary guard for itself", async () => {
    // Regression guard for the `\\?(?!\\.)` lookahead: without it, the `?` in
    // `r.data?.result` would read as a ternary test and mark the chain safe.
    const dir = withFixture({
      "concord-frontend/components/x/Chain.tsx": `'use client';
import { lensRun } from '@/lib/api/client';
export default function Chain() {
  async function load() {
    const r = await lensRun('x', 'y', {});
    return r.data.result.items.map((i: any) => i.id);
  }
  return null;
}
`,
    });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.ok(
        realFindings(r).some((f) => f.id === "unsafe_chain_no_guard"),
        "an unguarded chain must not be silenced by the ternary-guard branch",
      );
    } finally { teardown(dir); }
  });
});
