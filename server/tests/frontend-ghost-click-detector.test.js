/**
 * Tier-2 contract tests for FrontendGhostClickDetector.
 *
 * Pinned rules:
 *   - button_without_handler (high)
 *   - click_handler_no_error_path (medium)
 *   - loading_state_no_finally (medium)
 *   - form_submit_no_preventDefault (medium)
 *
 * Plus: file-level @ghost-click-ok opt-out, registry wiring, report shape.
 *
 * Run: node --test tests/frontend-ghost-click-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runFrontendGhostClickDetector } from "../lib/detectors/frontend-ghost-click-detector.js";
import { listDetectors, getDetector } from "../lib/detectors/index.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `ghost-click-test-${Math.random().toString(36).slice(2)}`);
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

describe("FrontendGhostClickDetector — button without handler", () => {
  it("flags <button>Save</button> with no onClick, no type, no disabled", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <button>Save</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      const f = r.findings.find(x => x.id === "button_without_handler");
      assert.ok(f, "expected button_without_handler finding");
      assert.equal(f.severity, "high");
    } finally { teardown(dir); }
  });

  it("does NOT flag <button onClick={fn}>", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <button onClick={() => console.log('hi')}>Save</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "button_without_handler").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag <button type=\"submit\"> inside a form", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <form onSubmit={(e) => { e.preventDefault(); }}><button type="submit">Go</button></form>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "button_without_handler").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag <button disabled>", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <button disabled>Loading...</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "button_without_handler").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag <button {...props}> (handler is in the spread)", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo({ props }: any) {\n  return <button {...props}>Save</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "button_without_handler").length, 0);
    } finally { teardown(dir); }
  });
});

describe("FrontendGhostClickDetector — click handler without error path", () => {
  it("flags async onClick with fetch but no try/catch or .catch()", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <button onClick={async () => { const r = await fetch('/api/x'); console.log(await r.json()); }}>Save</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      const f = r.findings.find(x => x.id === "click_handler_no_error_path");
      assert.ok(f, "expected click_handler_no_error_path finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag when the handler has try/catch", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <button onClick={async () => { try { await fetch('/api/x'); } catch (e) { console.error(e); } }}>Save</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "click_handler_no_error_path").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag a non-async onClick (no awaited fetch path)", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <button onClick={() => setView('b')}>Switch</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "click_handler_no_error_path").length, 0);
    } finally { teardown(dir); }
  });
});

describe("FrontendGhostClickDetector — loading state without finally", () => {
  it("flags setLoading(true) with no finally block", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <button onClick={async () => { setLoading(true); await fetch('/api/x'); setLoading(false); }}>Save</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      const f = r.findings.find(x => x.id === "loading_state_no_finally");
      assert.ok(f, "expected loading_state_no_finally finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag setLoading(true) when reset is in finally", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <button onClick={async () => { setLoading(true); try { await fetch('/api/x'); } finally { setLoading(false); } }}>Save</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "loading_state_no_finally").length, 0);
    } finally { teardown(dir); }
  });
});

describe("FrontendGhostClickDetector — form submit without preventDefault", () => {
  it("flags <form onSubmit={inline}> handler without preventDefault", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <form onSubmit={(e) => { console.log('submit'); }}><input /></form>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      const f = r.findings.find(x => x.id === "form_submit_no_preventDefault");
      assert.ok(f, "expected form_submit_no_preventDefault finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag when preventDefault is called", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  return <form onSubmit={(e) => { e.preventDefault(); console.log('submit'); }}><input /></form>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "form_submit_no_preventDefault").length, 0);
    } finally { teardown(dir); }
  });

  it("resolves named handler reference and checks its body", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `'use client';\nexport default function Foo() {\n  const handleSubmit = (e: any) => {\n    e.preventDefault();\n    console.log('ok');\n  };\n  return <form onSubmit={handleSubmit}><input /></form>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "form_submit_no_preventDefault").length, 0,
        "should resolve named handler and recognise preventDefault");
    } finally { teardown(dir); }
  });
});

describe("FrontendGhostClickDetector — file-level opt-out", () => {
  it("respects @ghost-click-ok in the first 5 lines", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `// @ghost-click-ok: design system test file\n'use client';\nexport default function Foo() {\n  return <button>Save</button>;\n}\n`,
    });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.length, 0, "annotation suppresses every finding");
    } finally { teardown(dir); }
  });
});

describe("FrontendGhostClickDetector — report shape + registry", () => {
  it("returns canonical DetectorReport on empty fixture", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/empty/page.tsx": "export default function Empty() { return null; }\n" });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.id, "frontend-ghost-click");
      assert.equal(r.ok, true);
    } finally { teardown(dir); }
  });

  it("degrades gracefully when SCAN_DIRS don't exist", async () => {
    const dir = withFixture({ "README.md": "no frontend here" });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.ok, true);
      assert.equal(r.findings.length, 0);
    } finally { teardown(dir); }
  });

  it("is registered with id 'frontend-ghost-click' and routes to repair-cortex", () => {
    const ids = listDetectors().map(d => d.id);
    assert.ok(ids.includes("frontend-ghost-click"));
    const spec = getDetector("frontend-ghost-click");
    assert.ok(spec.consumers.includes("repair-cortex"));
    assert.ok(spec.dataNeeds.includes("fs"));
  });
});
