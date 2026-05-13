/**
 * Tier-2 contract tests for the UX-quality detector suite — one
 * positive fixture + one negative fixture per detector, plus
 * registry wiring.
 *
 * Detectors:
 *   - ux-broken-link
 *   - ux-a11y-button-no-label
 *   - ux-loading-state-missing
 *   - ux-form-error-display
 *   - ux-route-empty-render
 *   - ux-modal-no-escape
 *
 * Run: node --test tests/ux-detectors-suite.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runUxBrokenLinkDetector } from "../lib/detectors/ux-broken-link-detector.js";
import { runUxA11yButtonNoLabelDetector } from "../lib/detectors/ux-a11y-button-no-label-detector.js";
import { runUxLoadingStateMissingDetector } from "../lib/detectors/ux-loading-state-missing-detector.js";
import { runUxFormErrorDisplayDetector } from "../lib/detectors/ux-form-error-display-detector.js";
import { runUxRouteEmptyRenderDetector } from "../lib/detectors/ux-route-empty-render-detector.js";
import { runUxModalNoEscapeDetector } from "../lib/detectors/ux-modal-no-escape-detector.js";
import { listDetectors, getDetector } from "../lib/detectors/index.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `ux-suite-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("UxBrokenLinkDetector", () => {
  it("flags <Link href> to a non-existent route", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx": "export default function Foo() { return <div />; }\n",
      "concord-frontend/app/lenses/bar/page.tsx":
        `export default function Bar() { return <Link href="/lenses/ghost">go</Link>; }\n`,
    });
    try {
      const r = await runUxBrokenLinkDetector({ root: dir });
      const f = r.findings.find(x => x.id === "broken_link");
      assert.ok(f, "expected broken_link finding");
      assert.equal(f.severity, "high");
      assert.equal(f.subject.href, "/lenses/ghost");
    } finally { teardown(dir); }
  });

  it("does NOT flag a Link to an existing route", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx": "export default function Foo() { return <div />; }\n",
      "concord-frontend/app/lenses/bar/page.tsx":
        `export default function Bar() { return <Link href="/lenses/foo">go</Link>; }\n`,
    });
    try {
      const r = await runUxBrokenLinkDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "broken_link").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag external URLs / mailto / anchors / template-interpolated", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `export default function Foo() {\n  return <div>\n    <Link href="https://example.com">ext</Link>\n    <Link href="mailto:x@y">mail</Link>\n    <Link href="#section">anchor</Link>\n    <Link href={\`/lenses/\${dyn}\`}>dyn</Link>\n  </div>;\n}\n`,
    });
    try {
      const r = await runUxBrokenLinkDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "broken_link").length, 0);
    } finally { teardown(dir); }
  });

  it("respects dynamic route segments (e.g. [id])", async () => {
    const dir = withFixture({
      "concord-frontend/app/users/[id]/page.tsx": "export default function U() { return <div />; }\n",
      "concord-frontend/app/lenses/foo/page.tsx":
        `export default function Foo() { return <Link href="/users/abc-123">u</Link>; }\n`,
    });
    try {
      const r = await runUxBrokenLinkDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "broken_link").length, 0);
    } finally { teardown(dir); }
  });
});

describe("UxA11yButtonNoLabelDetector", () => {
  it("flags icon-only button with no aria-label / text", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function F() { return <button onClick={() => {}}><X className="w-4" /></button>; }\n`,
    });
    try {
      const r = await runUxA11yButtonNoLabelDetector({ root: dir });
      const f = r.findings.find(x => x.id === "a11y_button_no_label");
      assert.ok(f, "expected a11y_button_no_label finding");
    } finally { teardown(dir); }
  });

  it("does NOT flag button with aria-label", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function F() { return <button aria-label="Close" onClick={() => {}}><X /></button>; }\n`,
    });
    try {
      const r = await runUxA11yButtonNoLabelDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "a11y_button_no_label").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag button with text content", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function F() { return <button onClick={() => {}}><X /> Save</button>; }\n`,
    });
    try {
      const r = await runUxA11yButtonNoLabelDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "a11y_button_no_label").length, 0);
    } finally { teardown(dir); }
  });
});

describe("UxLoadingStateMissingDetector", () => {
  it("flags async onClick with fetch and no loading state in file", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function F() { return <button onClick={async () => { await fetch('/api/x'); }}>Save</button>; }\n`,
    });
    try {
      const r = await runUxLoadingStateMissingDetector({ root: dir });
      const f = r.findings.find(x => x.id === "loading_state_missing");
      assert.ok(f, "expected loading_state_missing finding");
    } finally { teardown(dir); }
  });

  it("does NOT flag when the file uses setLoading anywhere", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `import { useState } from 'react';\nexport function F() {\n  const [loading, setLoading] = useState(false);\n  return <button disabled={loading} onClick={async () => { setLoading(true); await fetch('/api/x'); setLoading(false); }}>Save</button>;\n}\n`,
    });
    try {
      const r = await runUxLoadingStateMissingDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "loading_state_missing").length, 0);
    } finally { teardown(dir); }
  });
});

describe("UxFormErrorDisplayDetector", () => {
  it("flags form onSubmit with silent catch", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function F() { return <form onSubmit={async (e) => { e.preventDefault(); try { await fetch('/api/x'); } catch (err) { /* nothing */ } }}><input /></form>; }\n`,
    });
    try {
      const r = await runUxFormErrorDisplayDetector({ root: dir });
      const f = r.findings.find(x => x.id === "form_error_display_missing");
      assert.ok(f, "expected form_error_display_missing finding");
    } finally { teardown(dir); }
  });

  it("does NOT flag when catch calls addToast", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function F() { return <form onSubmit={async (e) => { e.preventDefault(); try { await fetch('/api/x'); } catch (err) { addToast({ type: 'error', message: 'failed' }); } }}><input /></form>; }\n`,
    });
    try {
      const r = await runUxFormErrorDisplayDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "form_error_display_missing").length, 0);
    } finally { teardown(dir); }
  });
});

describe("UxRouteEmptyRenderDetector", () => {
  it("flags lens page that returns null with no empty-state", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `export default function Foo() { return null; }\n`,
    });
    try {
      const r = await runUxRouteEmptyRenderDetector({ root: dir });
      const f = r.findings.find(x => x.id === "route_empty_render");
      assert.ok(f, "expected route_empty_render finding");
    } finally { teardown(dir); }
  });

  it("does NOT flag when file uses Skeleton / EmptyState", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/foo/page.tsx":
        `export default function Foo() { if (loading) return <Skeleton />; return null; }\n`,
    });
    try {
      const r = await runUxRouteEmptyRenderDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "route_empty_render").length, 0);
    } finally { teardown(dir); }
  });
});

describe("UxModalNoEscapeDetector", () => {
  it("flags <Modal> opened with no onClose / onOpenChange / Esc handler", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function F() { return <Modal open={true}><div>content</div></Modal>; }\n`,
    });
    try {
      const r = await runUxModalNoEscapeDetector({ root: dir });
      const f = r.findings.find(x => x.id === "modal_no_escape");
      assert.ok(f, "expected modal_no_escape finding");
    } finally { teardown(dir); }
  });

  it("does NOT flag <Dialog> with onOpenChange", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function F() { return <Dialog open={true} onOpenChange={() => {}}><div /></Dialog>; }\n`,
    });
    try {
      const r = await runUxModalNoEscapeDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "modal_no_escape").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag when file has an Esc keydown handler", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `import { useEffect } from 'react';\nexport function F() {\n  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === 'Escape') {} }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);\n  return <Modal open={true}><div /></Modal>;\n}\n`,
    });
    try {
      const r = await runUxModalNoEscapeDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "modal_no_escape").length, 0);
    } finally { teardown(dir); }
  });
});

describe("UX suite — registry wiring", () => {
  it("registers all 6 UX detectors", () => {
    const ids = listDetectors().map(d => d.id);
    for (const id of [
      "ux-broken-link",
      "ux-a11y-button-no-label",
      "ux-loading-state-missing",
      "ux-form-error-display",
      "ux-route-empty-render",
      "ux-modal-no-escape",
    ]) {
      assert.ok(ids.includes(id), `expected ${id} to be registered`);
      const spec = getDetector(id);
      assert.ok(spec.consumers.includes("repair-cortex"));
    }
  });
});
