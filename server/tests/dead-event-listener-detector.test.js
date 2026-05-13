/**
 * Tier-2 contract tests for DeadEventListenerDetector.
 *
 * Pinned:
 *   - dispatched event with no listener fires the rule
 *   - dispatched event WITH a matching addEventListener does not fire
 *   - dispatched event WITH a useEventListener hook subscription does not fire
 *   - bare DOM events (no `:`) are not flagged
 *   - @dead-event-ok annotation suppresses the finding
 *   - report shape + registry wiring
 *
 * Run: node --test tests/dead-event-listener-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runDeadEventListenerDetector } from "../lib/detectors/dead-event-listener-detector.js";
import { listDetectors, getDetector } from "../lib/detectors/index.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `dead-evt-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("DeadEventListenerDetector — dead dispatch", () => {
  it("flags dispatch with no matching listener anywhere", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `'use client';\nexport function Foo() {\n  return <button onClick={() => window.dispatchEvent(new CustomEvent('foo:bar'))}>Bar</button>;\n}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      const f = r.findings.find(x => x.id === "dead_event_dispatch");
      assert.ok(f, "expected dead_event_dispatch finding");
      assert.equal(f.severity, "medium");
      assert.equal(f.subject.eventName, "foo:bar");
    } finally { teardown(dir); }
  });

  it("does NOT flag when a matching addEventListener exists in another file", async () => {
    const dir = withFixture({
      "concord-frontend/components/dispatcher.tsx":
        `export function D() { window.dispatchEvent(new CustomEvent('foo:bar')); return null; }\n`,
      "concord-frontend/components/listener.tsx":
        `import { useEffect } from 'react';\nexport function L() { useEffect(() => { const h = () => {}; window.addEventListener('foo:bar', h); return () => window.removeEventListener('foo:bar', h); }, []); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "dead_event_dispatch").length, 0);
    } finally { teardown(dir); }
  });

  it("recognises useEventListener hook as a valid subscription", async () => {
    const dir = withFixture({
      "concord-frontend/components/dispatcher.tsx":
        `export function D() { window.dispatchEvent(new CustomEvent('foo:bar')); return null; }\n`,
      "concord-frontend/lib/listener.ts":
        `import { useEventListener } from './hook';\nexport function useFoo() { useEventListener('foo:bar', () => {}); }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "dead_event_dispatch").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag bare DOM events (no colon)", async () => {
    const dir = withFixture({
      "concord-frontend/components/dispatcher.tsx":
        `export function D() { window.dispatchEvent(new CustomEvent('refresh')); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      // 'refresh' has no colon → not application-namespaced → skipped.
      assert.equal(r.findings.filter(f => f.id === "dead_event_dispatch").length, 0);
    } finally { teardown(dir); }
  });

  it("respects @dead-event-ok annotation on the same or previous line", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `// @dead-event-ok: external integration subscribes via window-level adapter\nexport function D() { window.dispatchEvent(new CustomEvent('external:ping')); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.length, 0);
    } finally { teardown(dir); }
  });

  it("reports each event-name only once (dedupes across dispatch sites)", async () => {
    const dir = withFixture({
      "concord-frontend/components/a.tsx":
        `export function A() { window.dispatchEvent(new CustomEvent('foo:bar')); return null; }\n`,
      "concord-frontend/components/b.tsx":
        `export function B() { window.dispatchEvent(new CustomEvent('foo:bar')); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "dead_event_dispatch").length, 1,
        "should fire once per unique event name, not once per dispatch site");
    } finally { teardown(dir); }
  });
});

describe("DeadEventListenerDetector — report + registry", () => {
  it("returns canonical DetectorReport shape on empty fixture", async () => {
    const dir = withFixture({ "concord-frontend/components/empty.tsx": "export default function Empty() { return null; }\n" });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.id, "dead-event-listener");
      assert.equal(r.ok, true);
      assert.ok(Array.isArray(r.findings));
      assert.equal(typeof r.listenedToCount, "number");
    } finally { teardown(dir); }
  });

  it("is registered with id 'dead-event-listener' and routes to repair-cortex", () => {
    const ids = listDetectors().map(d => d.id);
    assert.ok(ids.includes("dead-event-listener"));
    const spec = getDetector("dead-event-listener");
    assert.ok(spec.consumers.includes("repair-cortex"));
  });
});
