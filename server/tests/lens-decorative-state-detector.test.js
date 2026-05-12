/**
 * Tier-2 contract tests for LensDecorativeStateDetector.
 *
 * Pins five rules:
 *
 *   lens_discarded_state    (critical) — `const [, setX] = useState`
 *   lens_decorative_state   (high)     — `setX` called but `x` never read
 *   lens_view_mode_unbranched (high)   — N-literal union with >= 2 missing branches
 *   lens_empty_handler      (low)      — `onClick={() => {}}` empty arrow
 *
 * Plus the operator escape hatch:
 *
 *   @decorative-ok  comment on the line above suppresses findings for that
 *                   useState declaration
 *
 * Plus the indirect-consumption exemption — variables passed to function
 * calls / used as object indices / compared against object properties /
 * used in template-literal interpolation are not flagged even when their
 * literal-equality JSX comparisons are incomplete.
 *
 * Run: node --test server/tests/lens-decorative-state-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runLensDecorativeStateDetector } from "../lib/detectors/lens-decorative-state-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `lens-dec-state-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

const LENS_PATH = "concord-frontend/app/lenses/probe/page.tsx";

describe("LensDecorativeStateDetector — rule 1: discarded state (critical)", () => {
  it("flags const [, setX] = useState when setX is called", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
export default function P() {
  const [, setView] = useState<'a' | 'b'>('a');
  return <button onClick={() => setView('b')}>X</button>;
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.ok, true);
      const f = r.findings.find(x => x.id === "lens_discarded_state");
      assert.ok(f, "expected lens_discarded_state finding");
      assert.equal(f.severity, "critical");
      assert.match(f.message, /setView/);
    } finally { teardown(dir); }
  });

  it("does NOT flag discarded state when the setter is never called (untouched declaration)", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
export default function P() {
  const [,] = useState(false);
  return <div>hello</div>;
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.findings.filter(x => x.id === "lens_discarded_state").length, 0);
    } finally { teardown(dir); }
  });
});

describe("LensDecorativeStateDetector — rule 2: decorative state (high)", () => {
  it("flags state that is set but never read", async () => {
    // Button label deliberately doesn't match the variable name — a JSX
    // text node `>panelOpen<` would match the regex word boundary and
    // suppress the finding (a known limitation; the detector errs on
    // the side of false negatives when a button label happens to match
    // a state-variable name).
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
export default function P() {
  const [panelOpen, setPanelOpen] = useState(false);
  return <button onClick={() => setPanelOpen(true)}>+</button>;
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      const f = r.findings.find(x => x.id === "lens_decorative_state");
      assert.ok(f, "expected lens_decorative_state finding");
      assert.equal(f.severity, "high");
      assert.match(f.message, /'panelOpen'/);
    } finally { teardown(dir); }
  });

  it("does NOT flag state that is read in a render branch", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
export default function P() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      {open && <div>panel</div>}
    </>
  );
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.findings.filter(x => x.id === "lens_decorative_state").length, 0);
    } finally { teardown(dir); }
  });

  it("auto-exempts variables prefixed with _ (TS unused convention)", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
export default function P() {
  const [_unused, setUnused] = useState(0);
  return <button onClick={() => setUnused(n => n + 1)}>X</button>;
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.findings.filter(x => x.severity !== "info").length, 0);
    } finally { teardown(dir); }
  });
});

describe("LensDecorativeStateDetector — rule 3: view-mode unbranched (high)", () => {
  it("flags a 4-literal union with only 1 render branch", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
type Tab = 'a' | 'b' | 'c' | 'd';
export default function P() {
  const [activeTab, setActiveTab] = useState<Tab>('a');
  return (
    <>
      <button onClick={() => setActiveTab('b')}>B</button>
      {activeTab === 'a' && <div>A content</div>}
    </>
  );
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      const f = r.findings.find(x => x.id === "lens_view_mode_unbranched");
      assert.ok(f, "expected lens_view_mode_unbranched finding");
      assert.equal(f.severity, "high");
      // Should report the missing literals
      assert.deepEqual([...new Set(f.evidence.missing)].sort(), ["b", "c", "d"]);
    } finally { teardown(dir); }
  });

  it("does NOT flag a 2-literal binary toggle (idiomatic if/else)", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
export default function P() {
  const [viewMode, setViewMode] = useState<'before' | 'after'>('before');
  return (
    <button onClick={() => setViewMode(v => v === 'before' ? 'after' : 'before')}>
      {viewMode === 'before' ? 'B' : 'A'}
    </button>
  );
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.findings.filter(x => x.id === "lens_view_mode_unbranched").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag when variable is consumed via array-find property comparison", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
type Mode = 'a' | 'b' | 'c' | 'd';
const TABS = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }];
export default function P() {
  const [activeMode, setActiveMode] = useState<Mode>('a');
  const cur = TABS.find(t => t.id === activeMode);
  return (
    <>
      <button onClick={() => setActiveMode('b')}>B</button>
      {activeMode === 'a' && <div>{cur?.label}</div>}
    </>
  );
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.findings.filter(x => x.id === "lens_view_mode_unbranched").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag filter / sort / search states (not view-mode names)", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
type StatusFilter = 'all' | 'open' | 'closed' | 'archived';
export default function P() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const items = [{ status: 'open' }, { status: 'closed' }];
  const visible = items.filter(i => statusFilter === 'all' || i.status === statusFilter);
  return (
    <>
      <button onClick={() => setStatusFilter('open')}>Open</button>
      <div>{visible.length} items</div>
    </>
  );
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.findings.filter(x => x.id === "lens_view_mode_unbranched").length, 0);
    } finally { teardown(dir); }
  });
});

describe("LensDecorativeStateDetector — rule 5: empty event handler (low)", () => {
  it("flags onClick={() => {}}", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
export default function P() { return <button onClick={() => {}}>x</button>; }
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      const f = r.findings.find(x => x.id === "lens_empty_handler");
      assert.ok(f);
      assert.equal(f.severity, "low");
    } finally { teardown(dir); }
  });
});

describe("LensDecorativeStateDetector — @decorative-ok annotation", () => {
  it("suppresses findings on the annotated useState declaration", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
export default function P() {
  // @decorative-ok: held for future panel-link wiring
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(true)}>open</button>;
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.findings.filter(x => x.severity !== "info").length, 0);
    } finally { teardown(dir); }
  });
});

describe("LensDecorativeStateDetector — report contract", () => {
  it("returns ok:true with empty findings for a clean lens", async () => {
    const dir = withFixture({
      [LENS_PATH]:
        `'use client';
import { useState } from 'react';
export default function P() {
  const [count, setCount] = useState(0);
  return (
    <>
      <button onClick={() => setCount(n => n + 1)}>+</button>
      <div>count: {count}</div>
    </>
  );
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(r.ok, true);
      // Only the info-severity summary header should be present.
      assert.equal(r.findings.filter(x => x.severity !== "info").length, 0);
      assert.ok(r.summary);
      assert.equal(typeof r.durationMs, "number");
    } finally { teardown(dir); }
  });

  it("returns makeError envelope when root is missing", async () => {
    const r = await runLensDecorativeStateDetector({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_root");
  });

  it("skips Next.js [bracket] dynamic and (group) route dirs", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/[id]/page.tsx":
        `'use client';
import { useState } from 'react';
export default function P() {
  const [open, setOpen] = useState(false);
  return <button onClick={() => setOpen(true)}>x</button>;
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      // Bracket dirs are skipped; the bracket-dir lens shouldn't show up.
      const allLocs = r.findings.map(f => f.location || "").join(" ");
      assert.equal(allLocs.includes("[id]"), false);
    } finally { teardown(dir); }
  });
});
