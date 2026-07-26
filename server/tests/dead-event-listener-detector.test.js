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

describe("DeadEventListenerDetector — X2: listener-side orphans", () => {
  it("flags a window.addEventListener with NO dispatcher anywhere (real historical example: achievements/page.tsx pre-fix)", async () => {
    // Simplified reproduction of the pre-385fd5a8 achievements lens: it
    // subscribed to 'achievement:unlocked' via window.addEventListener,
    // but nothing in the tree ever dispatched that CustomEvent — the
    // server only ever broadcast it over the socket. See
    // `git show 385fd5a8^:concord-frontend/app/lenses/achievements/page.tsx`.
    const dir = withFixture({
      "concord-frontend/app/lenses/achievements/page.tsx":
        `'use client';\n` +
        `import { useEffect, useCallback } from 'react';\n` +
        `export default function AchievementsLensPage() {\n` +
        `  const refresh = useCallback(() => {}, []);\n` +
        `  useEffect(() => {\n` +
        `    if (typeof window === 'undefined') return;\n` +
        `    const handler = () => refresh();\n` +
        `    window.addEventListener('achievement:unlocked', handler);\n` +
        `    return () => window.removeEventListener('achievement:unlocked', handler);\n` +
        `  }, [refresh]);\n` +
        `  return null;\n` +
        `}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.ok, true, r.x2Error);
      const f = r.findings.find(x => x.id === "dead_event_listener");
      assert.ok(f, "expected dead_event_listener finding");
      assert.equal(f.severity, "medium");
      assert.equal(f.subject.eventName, "achievement:unlocked");
    } finally { teardown(dir); }
  });

  it("does NOT flag a listener when a matching dispatcher exists elsewhere", async () => {
    const dir = withFixture({
      "concord-frontend/components/listener.tsx":
        `import { useEffect } from 'react';\nexport function L() { useEffect(() => { const h = () => {}; window.addEventListener('real:wired', h); return () => window.removeEventListener('real:wired', h); }, []); return null; }\n`,
      "concord-frontend/components/dispatcher.tsx":
        `export function D() { window.dispatchEvent(new CustomEvent('real:wired')); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "dead_event_listener").length, 0);
    } finally { teardown(dir); }
  });

  it("respects @dead-event-ok annotation on the listener line", async () => {
    const dir = withFixture({
      "concord-frontend/components/escape-hatch.tsx":
        `export function E() {\n  // @dead-event-ok: public escape-hatch API, no current caller\n  window.addEventListener('public:escape-hatch', () => {});\n  return null;\n}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "dead_event_listener").length, 0);
    } finally { teardown(dir); }
  });
});

describe("DeadEventListenerDetector — X2: socket both-directions", () => {
  it("flags a server realtimeEmit with NO frontend consumer anywhere", async () => {
    const dir = withFixture({
      "server/lib/some-emit-source.js":
        `export function fireIt() {\n` +
        `  if (typeof globalThis.realtimeEmit === "function") {\n` +
        `    globalThis.realtimeEmit("test:emitted-event", { ok: true });\n` +
        `  }\n` +
        `}\n`,
      "concord-frontend/components/unrelated.tsx":
        `export function Unrelated() { return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.ok, true, r.x2Error);
      const f = r.findings.find(x => x.id === "dead_socket_emit");
      assert.ok(f, "expected dead_socket_emit finding");
      assert.equal(f.severity, "medium");
      assert.equal(f.subject.eventName, "test:emitted-event");
      assert.equal(f.subject.direction, "server-to-frontend");
    } finally { teardown(dir); }
  });

  it("does NOT flag a server emit when the frontend subscribes via subscribe()", async () => {
    const dir = withFixture({
      "server/lib/emit-source.js":
        `export function fireIt() { realtimeEmit("test:wired-event", { ok: true }); }\n`,
      "concord-frontend/components/consumer.tsx":
        `import { subscribe } from '@/lib/realtime/socket';\nexport function C() { subscribe('test:wired-event', () => {}); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "dead_socket_emit").length, 0);
      assert.equal(r.findings.filter(f => f.id === "orphan_socket_consumer").length, 0);
    } finally { teardown(dir); }
  });

  it("flags a frontend subscribe() with NO server emit anywhere", async () => {
    const dir = withFixture({
      "concord-frontend/components/consumer-only.tsx":
        `import { subscribe } from '@/lib/realtime/socket';\nexport function C() { subscribe('test:consumer-only-event', () => {}); return null; }\n`,
      "server/lib/unrelated.js":
        `export function noop() { return 1; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.ok, true, r.x2Error);
      const f = r.findings.find(x => x.id === "orphan_socket_consumer");
      assert.ok(f, "expected orphan_socket_consumer finding");
      assert.equal(f.severity, "medium");
      assert.equal(f.subject.eventName, "test:consumer-only-event");
      assert.equal(f.subject.direction, "frontend-consumer-only");
    } finally { teardown(dir); }
  });

  it("resolves subscribe<T>(...) generic-typed call sites (would otherwise be invisible)", async () => {
    const dir = withFixture({
      "server/lib/emit-source.js":
        `export function fireIt() { realtimeEmit("test:generic-typed-event", { runId: "x" }); }\n`,
      "concord-frontend/components/generic-consumer.tsx":
        `import { subscribe } from '@/lib/realtime/socket';\n` +
        `export function C() {\n` +
        `  subscribe<{ runId?: string }>(\n    'test:generic-typed-event',\n    (d) => {},\n  );\n` +
        `  return null;\n` +
        `}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "orphan_socket_consumer").length, 0);
      assert.equal(r.findings.filter(f => f.id === "dead_socket_emit").length, 0);
    } finally { teardown(dir); }
  });

  // DET-C batch 2 (2026-07-23) — useRealtimeRefresh(['a:b', ...], refresh, opts)
  // is a real, widely-used (22 call sites) indirection the detector
  // previously missed entirely: it passes the event list INLINE as a call
  // argument (not a named constant array iterated elsewhere), and is
  // frequently a SINGLE-item array, so the pre-existing "bridge array"
  // heuristic's 2+-name threshold couldn't catch it. This produced a real
  // false positive (`climbing:route-completed` in
  // concord-frontend/components/world/ClimbingTracker.tsx flagged as a
  // dead `dead_socket_emit` when it is genuinely subscribed). Bidirectional
  // pin: the hook call now correctly suppresses the finding, AND an
  // otherwise-identical server emit with no such call anywhere still
  // fires it (the fix doesn't over-suppress).
  it("does NOT flag a server emit consumed via a single-item useRealtimeRefresh([...]) call", async () => {
    const dir = withFixture({
      "server/lib/emit-source.js":
        `export function fireIt() { realtimeEmit("test:refresh-single-event", { ok: true }); }\n`,
      "concord-frontend/components/world/SomeTracker.tsx":
        `import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';\n` +
        `export function SomeTracker() {\n` +
        `  useRealtimeRefresh(['test:refresh-single-event'], () => {}, { backstopMs: 2000 });\n` +
        `  return null;\n` +
        `}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.ok, true, r.x2Error);
      assert.equal(r.findings.filter(f => f.id === "dead_socket_emit").length, 0);
    } finally { teardown(dir); }
  });

  it("also recognises a multi-item useRealtimeRefresh([...]) call", async () => {
    const dir = withFixture({
      "server/lib/emit-source.js":
        `export function fireIt() {\n` +
        `  realtimeEmit("test:refresh-multi-a", { ok: true });\n` +
        `  realtimeEmit("test:refresh-multi-b", { ok: true });\n` +
        `}\n`,
      "concord-frontend/components/world/MultiTracker.tsx":
        `import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';\n` +
        `export function MultiTracker() {\n` +
        `  useRealtimeRefresh(['test:refresh-multi-a', 'test:refresh-multi-b'], () => {});\n` +
        `  return null;\n` +
        `}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "dead_socket_emit" && f.subject.eventName === "test:refresh-multi-a").length, 0);
      assert.equal(r.findings.filter(f => f.id === "dead_socket_emit" && f.subject.eventName === "test:refresh-multi-b").length, 0);
    } finally { teardown(dir); }
  });

  it("STILL flags a server emit when no useRealtimeRefresh call names it anywhere (no over-suppression)", async () => {
    const dir = withFixture({
      "server/lib/emit-source.js":
        `export function fireIt() { realtimeEmit("test:refresh-unrelated-event", { ok: true }); }\n`,
      "concord-frontend/components/world/OtherTracker.tsx":
        `import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';\n` +
        `export function OtherTracker() {\n` +
        `  useRealtimeRefresh(['test:completely-different-event'], () => {});\n` +
        `  return null;\n` +
        `}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      const f = r.findings.find(x => x.id === "dead_socket_emit" && x.subject.eventName === "test:refresh-unrelated-event");
      assert.ok(f, "expected dead_socket_emit finding — the hook call names a DIFFERENT event, not this one");
    } finally { teardown(dir); }
  });
});

describe("DeadEventListenerDetector — X2: constant-array indirection is NOT hard-flagged", () => {
  it("treats a listener as consumed when its name is wired only via a bridge-array + loop (SR_BRIDGE_EVENTS / FORWARDED_EVENTS shape)", async () => {
    // Reproduces the real shape of app/lenses/world/page.tsx's
    // SR_BRIDGE_EVENTS and hooks/useSocket.ts's FORWARDED_EVENTS: an
    // array of 2+ namespaced event names, iterated in a loop that
    // `.on()`s each one dynamically (never as a string literal) and
    // re-dispatches it as a window CustomEvent. A literal-only scan
    // would see zero dispatchers for 'fake:alpha' and wrongly call its
    // window.addEventListener a dead orphan.
    const dir = withFixture({
      "concord-frontend/hooks/useFakeForwarder.ts":
        `const FORWARDED_EVENTS = ['fake:alpha', 'fake:beta'];\n` +
        `export function wireForwarding(socket) {\n` +
        `  for (const event of FORWARDED_EVENTS) {\n` +
        `    socket.on(event, (data) => {\n` +
        `      window.dispatchEvent(new CustomEvent(event, { detail: data }));\n` +
        `    });\n` +
        `  }\n` +
        `}\n`,
      "concord-frontend/components/fake/AlphaListener.tsx":
        `import { useEffect } from 'react';\n` +
        `export function AlphaListener() {\n` +
        `  useEffect(() => {\n` +
        `    const h = () => {};\n` +
        `    window.addEventListener('fake:alpha', h);\n` +
        `    return () => window.removeEventListener('fake:alpha', h);\n` +
        `  }, []);\n` +
        `  return null;\n` +
        `}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.ok, true, r.x2Error);
      const orphan = r.findings.find(f => f.id === "dead_event_listener" && f.subject?.eventName === "fake:alpha");
      assert.equal(orphan, undefined, "array-bridged listener must be treated as consumed, not orphaned");
    } finally { teardown(dir); }
  });

  it("does not treat a single incidental colon-string in an unrelated array as an event-name roster", async () => {
    // Guard against over-suppression: an array with only ONE namespaced
    // string (e.g. a CSS/ICE-server-style config array) must not count
    // as a bridge array, so a genuinely dead listener sharing a
    // coincidental name still gets flagged.
    const dir = withFixture({
      "concord-frontend/components/config.tsx":
        `export const ICE_SERVERS = ['stun:stun.example.com:19302'];\n`,
      "concord-frontend/components/orphan.tsx":
        `import { useEffect } from 'react';\nexport function O() { useEffect(() => { window.addEventListener('really:orphaned', () => {}); }, []); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      const f = r.findings.find(x => x.id === "dead_event_listener" && x.subject?.eventName === "really:orphaned");
      assert.ok(f, "single-entry array must not suppress a genuine orphan");
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
