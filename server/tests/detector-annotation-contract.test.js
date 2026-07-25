/**
 * Meta-verification: does every documented detector opt-out annotation
 * ACTUALLY suppress the finding it claims to?
 *
 * Motivation: `dead-event-listener-detector.js`'s header advertises
 * `@dead-event-ok` as a general opt-out ("Operator opt-out: `@dead-event-ok`
 * annotation on the dispatch line"), but the socket-broadcast pass
 * (`dead_socket_emit` / `orphan_socket_consumer`, added later as "Extension
 * X2") never tests `ANNOTATION_OK_RE` — only the original dispatch/listener
 * passes do. Annotating a `dead_socket_emit` finding is therefore inert: a
 * reviewer who sees the annotation and moves on has been silently misled.
 * The bug is invisible from source alone because a working annotation and a
 * decorative one read identically — only running the detector both ways
 * (unannotated vs annotated) proves the difference. This file is that check,
 * generalised to every `@…-ok` token this repo's detector suite documents.
 *
 * Method (per the pattern in `stale-code-staging-suffix.test.js`): for each
 * (detector, rule, token), build a synthetic fixture in a temp dir that (a)
 * triggers the finding with NO annotation, then (b) triggers the same shape
 * WITH the annotation, and assert the annotation removes it. Where a
 * documented token does NOT wire into a rule, the test asserts the CURRENT
 * real (broken) behavior — annotation present, finding still fires — with a
 * comment naming the unimplemented rule and the exact line where the fix
 * belongs. No detector source is edited here (server/lib/detectors/** is
 * PROTECTED by scripts/autoloop/guard.mjs); an unwired token is reported,
 * not silently patched or silently skipped.
 *
 * Run: node --test server/tests/detector-annotation-contract.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { runAgentBudgetDetector } from "../lib/detectors/agent-budget-detector.js";
import { runAsymmetricStatusUpdateDetector } from "../lib/detectors/asymmetric-status-update-detector.js";
import { runDeadEnvelopeFieldAccessDetector } from "../lib/detectors/dead-envelope-field-access-detector.js";
import { runDeadEventListenerDetector } from "../lib/detectors/dead-event-listener-detector.js";
import { runDuplicateHandlerRaceDetector } from "../lib/detectors/duplicate-handler-race-detector.js";
import { runEnvConfigDriftDetector } from "../lib/detectors/env-config-drift-detector.js";
import { runFakeDataDetector } from "../lib/detectors/fake-data-detector.js";
import { runFalseEmptyOnErrorDetector } from "../lib/detectors/false-empty-on-error-detector.js";
import { runFrontendFakeDataDetector } from "../lib/detectors/frontend-fake-data-detector.js";
import { runFrontendGhostClickDetector } from "../lib/detectors/frontend-ghost-click-detector.js";
import { runFrontendUnsafeChainDetector } from "../lib/detectors/frontend-unsafe-chain-detector.js";
import { runHttpErrorDetector } from "../lib/detectors/http-error-detector.js";
import { runLensDecorativeStateDetector } from "../lib/detectors/lens-decorative-state-detector.js";
import { runObservabilityGapDetector } from "../lib/detectors/observability-gap-detector.js";
import { runPerformanceHotspotDetector } from "../lib/detectors/performance-hotspot-detector.js";
import { runResourceLeakDetector } from "../lib/detectors/resource-leak-detector.js";
import { runUnusedDestructuredParamDetector } from "../lib/detectors/unused-destructured-param-detector.js";
import { runUxBrokenLinkDetector } from "../lib/detectors/ux-broken-link-detector.js";
import { runUxFormErrorDisplayDetector } from "../lib/detectors/ux-form-error-display-detector.js";
import { runUxLoadingStateMissingDetector } from "../lib/detectors/ux-loading-state-missing-detector.js";
import { runUxModalNoEscapeDetector } from "../lib/detectors/ux-modal-no-escape-detector.js";
import { runUxRouteEmptyRenderDetector } from "../lib/detectors/ux-route-empty-render-detector.js";

function withFixture(layout) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "det-annotation-contract-"));
  for (const [rel, content] of Object.entries(layout)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}
function teardown(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } }
function ids(report) { return report.findings.map((f) => f.id); }

// ─────────────────────────────────────────────────────────────────────────
// @agent-budget-ok — server/lib/detectors/agent-budget-detector.js
// Whole-file opt-out: annotation ANYWHERE in file content suppresses the
// entire file (checked before any rule runs). HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@agent-budget-ok — agent-budget-detector", () => {
  const trigger = `export async function spin(ctx) { while (true) { await ctx.llm.chat({}); } }\n`;

  it("direction 1: while(true) with an LLM call fires without the annotation", async () => {
    const dir = withFixture({ "server/lib/spin.js": trigger });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      assert.ok(ids(r).includes("while_true_with_llm_call"));
    } finally { teardown(dir); }
  });

  it("direction 2: the same shape with @agent-budget-ok anywhere in the file is suppressed", async () => {
    const dir = withFixture({
      "server/lib/spin.js": `// @agent-budget-ok: bounded by external scheduler\n${trigger}`,
    });
    try {
      const r = await runAgentBudgetDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.file === "server/lib/spin.js").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @asymmetric-status-update-ok-file — asymmetric-status-update-detector.js
// File-level only (no per-line variant is documented for this token).
// HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@asymmetric-status-update-ok-file — asymmetric-status-update-detector", () => {
  const panel = (annotate) => [
    ...(annotate ? ["// @asymmetric-status-update-ok-file: legacy, tracked in TICKET-1"] : []),
    "export function DemoPanel() {",
    "  const [runCount, setRunCount] = useState(0);",
    "  const [status, setStatus] = useState('idle');",
    "",
    "  async function runDemo() {",
    "    setStatus('loading');",
    "    const res = await runFrontierMacro('sim', 'demo', {});",
    "    if (!res.ok || !res.result) {",
    "      setStatus('refused');",
    "      return;",
    "    }",
    "    setRunCount((n) => n + 1);",
    "    setStatus('ok');",
    "  }",
    "",
    "  return <VerifyCell status={runCount === 0 ? 'idle' : status} />;",
    "}",
    "",
  ].join("\n");

  it("direction 1: the asymmetric early-return shape fires without the annotation", async () => {
    const dir = withFixture({
      "concord-frontend/components/frontier/panels/DemoPanel.tsx": panel(false),
    });
    try {
      const r = await runAsymmetricStatusUpdateDetector({ root: dir });
      assert.ok(ids(r).includes("asymmetric_status_update"));
    } finally { teardown(dir); }
  });

  it("direction 2: the same shape with @asymmetric-status-update-ok-file is suppressed", async () => {
    const dir = withFixture({
      "concord-frontend/components/frontier/panels/DemoPanel.tsx": panel(true),
    });
    try {
      const r = await runAsymmetricStatusUpdateDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.severity !== "info").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @dead-envelope-ok — dead-envelope-field-access-detector.js
// File-level: annotation in the FIRST 5 LINES suppresses the whole file.
// HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@dead-envelope-ok — dead-envelope-field-access-detector", () => {
  const ART_BACKEND = `export default function registerArt(registerLensAction) {
  registerLensAction("art", "concept-art-list", (ctx, _a, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "db unavailable" };
    return { ok: true, result: { conceptArt: [], count: 0 } };
  });
}
`;
  const POSITIVE_FIXTURE = `'use client';
import { lensRun } from '@/lib/api/client';

export function ConceptArtBoard() {
  async function refresh() {
    const r = await lensRun('art', 'concept-art-list', {});
    if (r.data?.result?.ok === false) {
      setError(r.data.result.error || 'failed to load concept board');
    }
  }
  return null;
}
`;

  it("direction 1: reading r.data.result.ok on a nested-shape macro fires without the annotation", async () => {
    const dir = withFixture({
      "server/domains/art.js": ART_BACKEND,
      "concord-frontend/components/art/ConceptArtBoard.tsx": POSITIVE_FIXTURE,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      const real = r.findings.filter((f) => f.severity !== "info");
      assert.ok(real.length >= 1, `expected dead_envelope_field_access, got: ${JSON.stringify(real)}`);
      assert.equal(real[0].id, "dead_envelope_field_access");
    } finally { teardown(dir); }
  });

  it("direction 2: @dead-envelope-ok in the file's first 5 lines suppresses the whole file", async () => {
    const dir = withFixture({
      "server/domains/art.js": ART_BACKEND,
      "concord-frontend/components/art/OptOut.tsx": `// @dead-envelope-ok: legacy, tracked in TICKET-2\n${POSITIVE_FIXTURE}`,
    });
    try {
      const r = await runDeadEnvelopeFieldAccessDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.severity !== "info").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @dead-event-ok — dead-event-listener-detector.js — THE FLAGSHIP CASE.
//
// This token is honored on the ORIGINAL dispatch/listener passes (Pass 2 /
// Pass 3, `dead_event_dispatch` / `dead_event_listener`) but is NEVER
// wired into the socket-broadcast Extension X2 passes (Pass 4 / Pass 5,
// `dead_socket_emit` / `orphan_socket_consumer`) added later. Both halves
// are proven below: the honored half suppresses cleanly; the unhonored
// half is pinned as a KNOWN GAP — the test documents the real current
// behavior (annotation present, finding still fires) rather than
// pretending it works.
// ─────────────────────────────────────────────────────────────────────────
describe("@dead-event-ok — HONORED half (dead_event_dispatch, dead_event_listener)", () => {
  it("direction 1: a dispatch with no listener anywhere fires dead_event_dispatch", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `export function Foo() { window.dispatchEvent(new CustomEvent('contract:dispatch-test')); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.ok(ids(r).includes("dead_event_dispatch"));
    } finally { teardown(dir); }
  });

  it("direction 2: @dead-event-ok on the dispatch line suppresses dead_event_dispatch", async () => {
    const dir = withFixture({
      "concord-frontend/components/foo.tsx":
        `// @dead-event-ok: external integration subscribes via a window-level adapter\n` +
        `export function Foo() { window.dispatchEvent(new CustomEvent('contract:dispatch-test')); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.id === "dead_event_dispatch").length, 0);
    } finally { teardown(dir); }
  });

  it("direction 1: an orphan addEventListener with no dispatcher anywhere fires dead_event_listener", async () => {
    const dir = withFixture({
      "concord-frontend/components/bar.tsx":
        `export function Bar() { window.addEventListener('contract:listener-test', () => {}); return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.ok(ids(r).includes("dead_event_listener"));
    } finally { teardown(dir); }
  });

  it("direction 2: @dead-event-ok on the listener line suppresses dead_event_listener", async () => {
    const dir = withFixture({
      "concord-frontend/components/bar.tsx":
        `export function Bar() {\n  // @dead-event-ok: public escape-hatch API, no current caller\n  window.addEventListener('contract:listener-test', () => {});\n  return null;\n}\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.id === "dead_event_listener").length, 0);
    } finally { teardown(dir); }
  });
});

describe("@dead-event-ok — KNOWN GAP: NOT wired into the socket-broadcast pass (Extension X2)", () => {
  // dead-event-listener-detector.js's header (line ~18) advertises
  // "@dead-event-ok annotation on the dispatch line" as the general
  // opt-out mechanism, with no carve-out mentioned for the socket
  // direction. But `ANNOTATION_OK_RE` is only referenced at lines ~494
  // (Pass 2, ends up gating `dead_event_dispatch`) and ~689 (Pass 3,
  // gating `dead_event_listener`) — never inside `runExtensionX2()`
  // (defined ~line 549), which produces `dead_socket_emit` (Pass 4,
  // ~line 767-788) and `orphan_socket_consumer` (Pass 5, ~line 790-810).
  // Fix belongs at two call sites inside runExtensionX2: a check before
  // `findings.push({ id: "dead_socket_emit", ... })` (~line 776, using
  // the same fileLines-lookup shape Pass 2/3 already use) and before
  // `findings.push({ id: "orphan_socket_consumer", ... })` (~line 797).
  // NOT fixed here — server/lib/detectors/** is PROTECTED; reported for
  // human authorization.

  it("dead_socket_emit STILL fires even with @dead-event-ok on the emit line (documents the real gap)", async () => {
    const dir = withFixture({
      "server/lib/some-emit-source.js":
        `export function fireIt() {\n` +
        `  // @dead-event-ok: reviewed, no current frontend consumer needed\n` +
        `  globalThis.realtimeEmit("contract:socket-emit-test", { ok: true });\n` +
        `}\n`,
      "concord-frontend/components/unrelated.tsx":
        `export function Unrelated() { return null; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.ok, true, r.x2Error);
      const f = r.findings.find((x) => x.id === "dead_socket_emit" && x.subject?.eventName === "contract:socket-emit-test");
      assert.ok(f, "KNOWN GAP: dead_socket_emit is not annotation-suppressible — " +
        "if this assertion ever fails, the gap has been fixed and this test should be inverted");
    } finally { teardown(dir); }
  });

  it("orphan_socket_consumer STILL fires even with @dead-event-ok on the subscribe line (documents the real gap)", async () => {
    const dir = withFixture({
      "concord-frontend/components/consumer-only.tsx":
        `import { subscribe } from '@/lib/realtime/socket';\n` +
        `// @dead-event-ok: reviewed, server emit intentionally deferred\n` +
        `export function C() { subscribe('contract:orphan-consumer-test', () => {}); return null; }\n`,
      "server/lib/unrelated.js": `export function noop() { return 1; }\n`,
    });
    try {
      const r = await runDeadEventListenerDetector({ root: dir });
      assert.equal(r.ok, true, r.x2Error);
      const f = r.findings.find((x) => x.id === "orphan_socket_consumer" && x.subject?.eventName === "contract:orphan-consumer-test");
      assert.ok(f, "KNOWN GAP: orphan_socket_consumer is not annotation-suppressible — " +
        "if this assertion ever fails, the gap has been fixed and this test should be inverted");
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @resource-leak-ok — TWO independent consumers.
//   (a) resource-leak-detector.js itself — whole-file, annotation anywhere.
//   (b) duplicate-handler-race-detector.js's anonymous_listener_leak rule
//       explicitly re-honors the SIBLING detector's token (its own header
//       says so) via `isAllowedNear` — up to 2 lines above, or the same
//       line.
// Both HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@resource-leak-ok — consumer (a): resource-leak-detector", () => {
  it("direction 1: setInterval with no clearInterval fires unbounded_interval / interval rule", async () => {
    const dir = withFixture({ "server/lib/tick.js": `setInterval(() => 1, 1000);\n` });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.file === "server/lib/tick.js").length > 0, true);
    } finally { teardown(dir); }
  });

  it("direction 2: @resource-leak-ok anywhere in the file suppresses it", async () => {
    const dir = withFixture({
      "server/lib/tick.js": `// @resource-leak-ok: bounded by process lifetime\nsetInterval(() => 1, 1000);\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.file === "server/lib/tick.js").length, 0);
    } finally { teardown(dir); }
  });
});

describe("@resource-leak-ok — consumer (b): duplicate-handler-race-detector (cross-detector reuse)", () => {
  const scene = (annotation) => [
    `import { useEffect } from 'react';`,
    ``,
    `export default function ProbeScene({ canvasRef }) {`,
    `  useEffect(() => {`,
    `    const canvas = canvasRef.current;`,
    `    if (!canvas) return;`,
    `    canvas.addEventListener('contextmenu', (e) => e.preventDefault());${annotation}`,
    `    return undefined;`,
    `  }, [canvasRef]);`,
    `  return null;`,
    `}`,
    ``,
  ].join("\n");

  it("direction 1: an anonymous listener with no cleanup fires anonymous_listener_leak", async () => {
    const dir = withFixture({
      "concord-frontend/components/world-lens/ProbeScene.tsx": scene(""),
    });
    try {
      const r = await runDuplicateHandlerRaceDetector({ root: dir });
      assert.ok(ids(r).includes("anonymous_listener_leak"));
    } finally { teardown(dir); }
  });

  it("direction 2: @resource-leak-ok on the same line suppresses anonymous_listener_leak", async () => {
    const dir = withFixture({
      "concord-frontend/components/world-lens/ProbeScene.tsx":
        scene(" // @resource-leak-ok: reviewed, effect never re-runs"),
    });
    try {
      const r = await runDuplicateHandlerRaceDetector({ root: dir });
      assert.equal(ids(r).includes("anonymous_listener_leak"), false);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @env-config-ok — env-config-drift-detector.js
// Whole-file opt-out, annotation anywhere. HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@env-config-ok — env-config-drift-detector", () => {
  it("direction 1: a hardcoded prod URL fires without the annotation", async () => {
    const dir = withFixture({
      "server/lib/probe.js": `export const HOST = "https://api.production-service.com";\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.ok(r.findings.filter((f) => f.subject?.file === "server/lib/probe.js").length > 0);
    } finally { teardown(dir); }
  });

  it("direction 2: @env-config-ok anywhere in the file suppresses it", async () => {
    const dir = withFixture({
      "server/lib/probe.js": `// @env-config-ok: vendored client\nexport const HOST = "https://api.production-service.com";\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.file === "server/lib/probe.js").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @fake-data-ok-file (whole-file) and @fake-data-ok (inline, up to 6 lines
// above or same line) — fake-data-detector.js. Both apply to the
// TODO/FIXME-marker rule (`todo_replace_in_production`). Both HONORED.
// Note: the HIGH `fake_export_in_production` rule only documents the
// FILE-level opt-out, not an inline one — consistent with the source
// (no `hasAnnotationNear` check in that block) so this is not a gap.
// ─────────────────────────────────────────────────────────────────────────
describe("@fake-data-ok-file — fake-data-detector (whole file)", () => {
  it("direction 1: a TODO REPLACE marker in a production path fires", async () => {
    const dir = withFixture({
      "server/lib/probe.js": `// TODO REPLACE: wire real data source\nexport const x = 1;\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.ok(ids(r).includes("todo_replace_in_production"));
    } finally { teardown(dir); }
  });

  it("direction 2: @fake-data-ok-file anywhere suppresses every rule in the file", async () => {
    const dir = withFixture({
      "server/lib/probe.js": `// @fake-data-ok-file: legacy, tracked\n// TODO REPLACE: wire real data source\nexport const x = 1;\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.file === "server/lib/probe.js").length, 0);
    } finally { teardown(dir); }
  });
});

describe("@fake-data-ok — fake-data-detector (inline, same line or up to 6 lines above)", () => {
  it("direction 1: a TODO REPLACE marker fires without an inline annotation", async () => {
    const dir = withFixture({
      "server/lib/probe2.js": `// TODO REPLACE: wire real data source\nexport const x = 1;\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.ok(ids(r).includes("todo_replace_in_production"));
    } finally { teardown(dir); }
  });

  it("direction 2: @fake-data-ok appended to the TODO line suppresses just that marker", async () => {
    const dir = withFixture({
      "server/lib/probe2.js": `// TODO REPLACE: wire real data source @fake-data-ok: tracked in TICKET-3\nexport const x = 1;\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.id === "todo_replace_in_production").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @false-empty-on-error-ok-file — false-empty-on-error-detector.js
// Whole-file, annotation anywhere. HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@false-empty-on-error-ok-file — false-empty-on-error-detector", () => {
  const POSITIVE_FIXTURE = `'use client';

import { useCallback, useState } from 'react';
import { lensRun } from '@/lib/api/client';

export function PjPortfolioPanel() {
  const [projects, setProjects] = useState([]);

  const refresh = useCallback(async () => {
    const r = await lensRun('projects', 'portfolio', {});
    setProjects(r.data?.result?.projects || []);
  }, []);

  return <div>{projects.length}</div>;
}
`;

  it("direction 1: the false-empty-on-error shape fires without the annotation", async () => {
    const dir = withFixture({
      "concord-frontend/components/projects/Panel.tsx": POSITIVE_FIXTURE,
    });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      const real = r.findings.filter((f) => f.severity !== "info");
      assert.ok(real.length >= 1, `expected a finding, got: ${JSON.stringify(real)}`);
    } finally { teardown(dir); }
  });

  it("direction 2: @false-empty-on-error-ok-file anywhere suppresses the whole file", async () => {
    const dir = withFixture({
      "concord-frontend/components/projects/OptOutPanel.tsx":
        `// @false-empty-on-error-ok-file: legacy panel, tracked in TICKET-4\n${POSITIVE_FIXTURE}`,
    });
    try {
      const r = await runFalseEmptyOnErrorDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.severity !== "info").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @frontend-fake-data-ok-file — frontend-fake-data-detector.js
// Whole-file, annotation anywhere. HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@frontend-fake-data-ok-file — frontend-fake-data-detector", () => {
  const page = (annotate) => [
    ...(annotate ? ["// @frontend-fake-data-ok-file: style-guide showcase, intentional sample content"] : []),
    "export default function StyleGuidePage() {",
    "  const episodes = [",
    "    { title: 'Sample Episode', description: 'Sample text' },",
    "    { title: 'Sample Episode 2', description: 'Sample text' },",
    "  ];",
    "  return <div>{episodes.map((e) => <p key={e.title}>Lorem ipsum {e.title}</p>)}</div>;",
    "}",
    "",
  ].join("\n");

  it("direction 1: hardcoded lorem-ipsum sample content fires without the annotation", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/styleguide/page.tsx": page(false) });
    try {
      const r = await runFrontendFakeDataDetector({ root: dir });
      assert.ok(r.findings.filter((f) => f.severity !== "info").length > 0);
    } finally { teardown(dir); }
  });

  it("direction 2: @frontend-fake-data-ok-file suppresses the whole file", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/styleguide/page.tsx": page(true) });
    try {
      const r = await runFrontendFakeDataDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.severity !== "info").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @ghost-click-ok — frontend-ghost-click-detector.js
// File-level: annotation in the first 5 lines. HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@ghost-click-ok — frontend-ghost-click-detector", () => {
  const page = (annotate) =>
    (annotate ? `// @ghost-click-ok: design system test file\n` : ``) +
    `'use client';\nexport default function Foo() {\n  return <button>Save</button>;\n}\n`;

  it("direction 1: a button with no onClick handler fires without the annotation", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/foo/page.tsx": page(false) });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.ok(r.findings.length > 0);
    } finally { teardown(dir); }
  });

  it("direction 2: @ghost-click-ok in the first 5 lines suppresses every finding", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/foo/page.tsx": page(true) });
    try {
      const r = await runFrontendGhostClickDetector({ root: dir });
      assert.equal(r.findings.length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @unsafe-chain-ok — frontend-unsafe-chain-detector.js
// File-level: annotation in the first 5 lines. HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@unsafe-chain-ok — frontend-unsafe-chain-detector", () => {
  const POSITIVE_FIXTURE = `'use client';

async function macro(domain, name, input = {}) {
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
    return items.map((item) => item.id);
  }
  return null;
}
`;

  it("direction 1: an unguarded chain off a possibly-null macro result fires", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/music/page.tsx": POSITIVE_FIXTURE });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.ok(r.findings.filter((f) => f.severity !== "info").length > 0);
    } finally { teardown(dir); }
  });

  it("direction 2: @unsafe-chain-ok in the first 5 lines suppresses every finding", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/optout/page.tsx":
        `// @unsafe-chain-ok: legacy page, tracked in TICKET-5\n${POSITIVE_FIXTURE}`,
    });
    try {
      const r = await runFrontendUnsafeChainDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.severity !== "info").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @http-error-ok — http-error-detector.js
// File-level: annotation must be in the first 5 lines (source requires
// BOTH `ANNOTATION_OK_RE.test(content)` AND a match within the first 5
// lines — a bare "@http-error-ok" placed after line 5 does NOT trip the
// file-level exemption, though it may still satisfy a per-finding
// same-line/prev-line check). HONORED for the documented placement.
// ─────────────────────────────────────────────────────────────────────────
describe("@http-error-ok — http-error-detector", () => {
  const route = (annotate) =>
    (annotate ? `// @http-error-ok: intentional in this admin tool\n` : ``) +
    `import { Router } from "express";\nconst router = Router();\nrouter.post('/x', async (req, res) => {\n  const name = req.body.name;\n  res.json({ name });\n});\nexport default router;\n`;

  it("direction 1: the route fires at least one rule without the annotation", async () => {
    const dir = withFixture({ "server/routes/foo.js": route(false) });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.ok(r.findings.length > 0);
    } finally { teardown(dir); }
  });

  it("direction 2: @http-error-ok in the first 5 lines suppresses every rule for the file", async () => {
    const dir = withFixture({ "server/routes/foo.js": route(true) });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @decorative-ok — lens-decorative-state-detector.js (via _framework.js's
// decorativeOkExempt). PLACEMENT CONSTRAINT: only the line DIRECTLY ABOVE
// the useState declaration is checked (`lines[d.declLine - 2]`) — there is
// no same-line ("here") fallback like most other detectors in this suite.
// Both call sites (rule 1 "discarded value" and rule 2 "never read") only
// ever pass the single line above. HONORED, but same-line placement is
// INERT — proven below.
// ─────────────────────────────────────────────────────────────────────────
describe("@decorative-ok — lens-decorative-state-detector (line-above only, no same-line)", () => {
  const LENS_PATH = "concord-frontend/app/lenses/probe/page.tsx";
  const base = (annotationLine) => `'use client';
import { useState } from 'react';
export default function P() {
${annotationLine}
  const [panelOpen, setPanelOpen] = useState(false);
  return <button onClick={() => setPanelOpen(true)}>+</button>;
}
`;

  it("direction 1: a set-but-never-read state variable fires lens_decorative_state", async () => {
    const dir = withFixture({ [LENS_PATH]: base("  // no annotation here") });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.ok(ids(r).includes("lens_decorative_state"));
    } finally { teardown(dir); }
  });

  it("direction 2 (documented placement): @decorative-ok on the line directly above suppresses it", async () => {
    const dir = withFixture({ [LENS_PATH]: base("  // @decorative-ok: held for future panel-link wiring") });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.equal(ids(r).includes("lens_decorative_state"), false);
    } finally { teardown(dir); }
  });

  it("placement quirk: @decorative-ok on the SAME line as the declaration does NOT suppress (no here-check exists)", async () => {
    const dir = withFixture({
      [LENS_PATH]: `'use client';
import { useState } from 'react';
export default function P() {
  const [panelOpen, setPanelOpen] = useState(false); // @decorative-ok: same-line placement
  return <button onClick={() => setPanelOpen(true)}>+</button>;
}
`,
    });
    try {
      const r = await runLensDecorativeStateDetector({ root: dir });
      assert.ok(ids(r).includes("lens_decorative_state"),
        "same-line placement is inert for @decorative-ok — decorativeOkExempt() is only ever " +
        "called with the line ABOVE the declaration (lens-decorative-state-detector.js lines ~218, ~306); " +
        "if this assertion fails, a same-line check has been added and this test should be inverted");
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @observability-ok — observability-gap-detector.js
// Whole-file, annotation anywhere. HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@observability-ok — observability-gap-detector", () => {
  const route = (annotate) =>
    (annotate ? `// @observability-ok: handler is wrapped one level up\n` : ``) +
    `import { Router } from "express";\nconst router = Router();\nrouter.get('/x', async (req, res) => { res.json({}); });\nexport default router;\n`;

  it("direction 1: a route handler without try/catch fires", async () => {
    const dir = withFixture({ "server/routes/probe.js": route(false) });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      assert.ok(r.findings.filter((f) => f.subject?.file === "server/routes/probe.js").length > 0);
    } finally { teardown(dir); }
  });

  it("direction 2: @observability-ok anywhere in the file suppresses it", async () => {
    const dir = withFixture({ "server/routes/probe.js": route(true) });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.file === "server/routes/probe.js").length, 0);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// performance-hotspot-detector.js — FOUR tokens, all routed through
// _framework.js helpers (syncFsExempt / sqlLoopExempt / selectStarExempt)
// except @bounded-cache-ok which is checked inline in the detector itself.
// All four HONORED, with @bounded-cache-ok carrying a real placement
// constraint (proven below).
// ─────────────────────────────────────────────────────────────────────────
describe("@sync-fs-ok — performance-hotspot-detector (whole file, via _framework.syncFsExempt)", () => {
  const handler = (annotate) =>
    (annotate ? `// @sync-fs-ok: detector runs in CI/audit context only\n` : ``) +
    `const fs = require('fs');\nasync function handler(req, res) {\n  const data = fs.readFileSync('/tmp/x.json', 'utf8');\n  res.json({ data });\n}\nmodule.exports = { handler };\n`;

  it("direction 1: fs.readFileSync inside a handler body fires sync_fs_in_handler", async () => {
    const dir = withFixture({ "server/lib/probe-syncfs.js": handler(false) });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.ok(ids(r).includes("perf_sync_fs_in_handler"));
    } finally { teardown(dir); }
  });

  it("direction 2: @sync-fs-ok anywhere in the file suppresses sync_fs_in_handler", async () => {
    const dir = withFixture({ "server/lib/probe-syncfs.js": handler(true) });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.path === "server/lib/probe-syncfs.js").length, 0);
    } finally { teardown(dir); }
  });
});

describe("@sql-loop-ok — performance-hotspot-detector (whole file, via _framework.sqlLoopExempt)", () => {
  const loop = (annotate) =>
    (annotate ? `// @sql-loop-ok: bounded by a small fixed id list\n` : ``) +
    `function loadAll(ids, db) {\n  for (const id of ids) {\n    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id);\n  }\n}\nmodule.exports = { loadAll };\n`;

  it("direction 1: db.prepare(...).get() inside a for-loop fires uncaught_sql_loop", async () => {
    const dir = withFixture({ "server/lib/probe-sqlloop.js": loop(false) });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.ok(ids(r).includes("perf_uncaught_sql_loop"));
    } finally { teardown(dir); }
  });

  it("direction 2: @sql-loop-ok anywhere in the file suppresses uncaught_sql_loop", async () => {
    const dir = withFixture({ "server/lib/probe-sqlloop.js": loop(true) });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.path === "server/lib/probe-sqlloop.js").length, 0);
    } finally { teardown(dir); }
  });
});

describe("@select-star-ok — performance-hotspot-detector (per-call, same line or up to 3 above)", () => {
  it("direction 1: SELECT * FROM with no WHERE/LIMIT fires select_star_hot", async () => {
    const dir = withFixture({
      "server/lib/probe-selectstar.js": `function listAll(db) {\n  return db.prepare("SELECT * FROM widgets").all();\n}\n`,
    });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.ok(ids(r).includes("perf_select_star_hot"));
    } finally { teardown(dir); }
  });

  it("direction 2: @select-star-ok on the query line suppresses select_star_hot", async () => {
    const dir = withFixture({
      "server/lib/probe-selectstar.js":
        `function listAll(db) {\n  return db.prepare("SELECT * FROM widgets").all(); // @select-star-ok: admin export, full row needed\n}\n`,
    });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.path === "server/lib/probe-selectstar.js").length, 0);
    } finally { teardown(dir); }
  });
});

describe("@bounded-cache-ok — performance-hotspot-detector (PLACEMENT: same line as the variable name)", () => {
  // unbounded_cache_growth's exemption check is `\b<name>\b[^\n]*@bounded-cache-ok`
  // tested against the WHOLE file — `[^\n]*` cannot cross a newline, so the
  // annotation must share a LINE with the cache variable's own identifier,
  // not merely exist somewhere else in the file (unlike @sync-fs-ok /
  // @sql-loop-ok / @env-config-ok / @agent-budget-ok above, which are
  // genuinely whole-file, no co-location required).
  it("direction 1: a growing module-scope Map with no eviction fires unbounded_cache_growth", async () => {
    const dir = withFixture({
      "server/lib/probe-cache.js":
        `const registry = new Map();\nfunction remember(id, val) { registry.set(id, val); }\nmodule.exports = { remember };\n`,
    });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.ok(r.findings.some((f) => f.subject?.path === "server/lib/probe-cache.js"));
    } finally { teardown(dir); }
  });

  it("direction 2: @bounded-cache-ok CO-LOCATED with the variable name suppresses it", async () => {
    const dir = withFixture({
      "server/lib/probe-cache.js":
        `const registry = new Map(); // @bounded-cache-ok: never evicted, deliberate design choice\n` +
        `function remember(id, val) { registry.set(id, val); }\nmodule.exports = { remember };\n`,
    });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.equal(r.findings.filter((f) => f.subject?.path === "server/lib/probe-cache.js").length, 0);
    } finally { teardown(dir); }
  });

  it("placement quirk: @bounded-cache-ok present in the file but NOT on the variable's own line does NOT suppress", async () => {
    const dir = withFixture({
      "server/lib/probe-cache.js":
        `// @bounded-cache-ok: never evicted, deliberate design choice, size bounded externally\n` +
        `const registry = new Map();\n` +
        `function remember(id, val) { registry.set(id, val); }\nmodule.exports = { remember };\n`,
    });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.ok(r.findings.some((f) => f.subject?.path === "server/lib/probe-cache.js"),
        "the annotation exists in the file but never shares a line with the variable name 'registry' — " +
        "the co-location regex requires that, so the finding must still fire; if this assertion fails, " +
        "the co-location requirement has been relaxed and this test should be inverted");
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// @unused-param-ok — unused-destructured-param-detector.js
// File-level (first 5 lines) AND per-finding (same line as the function's
// body-open `{`, OR the single line immediately above it — `lineOf` is
// computed from the BODY-OPEN brace, not the `function` keyword).
// PLACEMENT QUIRK reproduced here exactly as found operationally: inside a
// JSDoc block, only a line that is LITERALLY the one immediately preceding
// the function signature counts — an annotation on the JSDoc's first or
// middle line, with a `*/` intervening before the function, is INERT.
// HONORED, with the quirk proven via three placements (2 fail, 1 works).
// ─────────────────────────────────────────────────────────────────────────
describe("@unused-param-ok — unused-destructured-param-detector", () => {
  const BUGGY = `function processItem({ id, label }) {\n  return id;\n}\n`;
  // The file-level exemption checks the RAW first 5 lines for the token,
  // independent of the per-finding placement logic — so a placement-quirk
  // fixture must push its JSDoc block PAST line 5, otherwise a pass would
  // be ambiguous (file-level opt-out vs. the per-line mechanism being
  // tested). This preamble exists purely to isolate the two mechanisms.
  const PAD = `// padding line 1\n// padding line 2\n// padding line 3\n// padding line 4\n// padding line 5\n`;

  it("direction 1: an unused destructured param fires unused_destructured_param", async () => {
    const dir = withFixture({ "server/lib/simulation/probe.js": BUGGY });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.ok(ids(r).includes("unused_destructured_param"));
    } finally { teardown(dir); }
  });

  it("direction 2: @unused-param-ok in the file's first 5 lines suppresses the whole file", async () => {
    const dir = withFixture({
      "server/lib/simulation/probe.js": `// @unused-param-ok: legacy, tracked in TICKET-6\n${BUGGY}`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(ids(r).includes("unused_destructured_param"), false);
    } finally { teardown(dir); }
  });

  it("placement try 1 (FAILS): annotation on the FIRST line of a multi-line JSDoc block above the function", async () => {
    const dir = withFixture({
      "server/lib/simulation/probeA.js":
        PAD + `/** @unused-param-ok: try 1 — first line of the JSDoc block\n * some other doc text\n */\n${BUGGY}`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.ok(ids(r).includes("unused_destructured_param"),
        "the line immediately above the function is ' */', not the annotation line — inert placement");
    } finally { teardown(dir); }
  });

  it("placement try 2 (FAILS): annotation on a MIDDLE line of the JSDoc block (still not the last line)", async () => {
    const dir = withFixture({
      "server/lib/simulation/probeB.js":
        PAD + `/**\n * @unused-param-ok: try 2 — middle line, not the line directly above the function\n */\n${BUGGY}`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.ok(ids(r).includes("unused_destructured_param"),
        "the line immediately above the function is ' */', not the annotation line — inert placement");
    } finally { teardown(dir); }
  });

  it("placement try 3 (WORKS): annotation as its own line directly above the function, no JSDoc wrapper", async () => {
    const dir = withFixture({
      "server/lib/simulation/probeC.js":
        PAD + `// @unused-param-ok: try 3 — directly on the line immediately above\n${BUGGY}`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(ids(r).includes("unused_destructured_param"), false,
        "the annotation IS the line immediately above the function signature — this placement works");
    } finally { teardown(dir); }
  });

  it("placement (WORKS): annotation as a same-line trailing comment on the function signature also works", async () => {
    const dir = withFixture({
      "server/lib/simulation/probeD.js":
        PAD + `function processItem({ id, label }) { // @unused-param-ok: same-line placement\n  return id;\n}\n`,
    });
    try {
      const r = await runUnusedDestructuredParamDetector({ root: dir });
      assert.equal(ids(r).includes("unused_destructured_param"), false);
    } finally { teardown(dir); }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The five ux-*-detector.js opt-outs. All share the exact same shape in
// source: `content.split("\n").slice(0, 5).some(l => ANNOTATION_OK_RE.test(l))`
// for the whole-file exemption, and `ANNOTATION_OK_RE.test(here) ||
// ANNOTATION_OK_RE.test(prev)` per finding. None of these five had ANY
// annotation test anywhere in the repo before this file (verified: neither
// ux-detectors-suite.test.js nor ux-suite-domain-parity.test.js mentions
// any of the five tokens, and none of the five detectors has its own
// dedicated test file). All five HONORED.
// ─────────────────────────────────────────────────────────────────────────
describe("@broken-link-ok — ux-broken-link-detector", () => {
  const page = (annotate) =>
    (annotate ? `// @broken-link-ok: intentionally points at a route added in a later phase\n` : ``) +
    `import Link from 'next/link';\nexport function Nav() {\n  return <Link href="/this-route-does-not-exist">Go</Link>;\n}\n`;

  it("direction 1: a Link to a non-existent app route fires broken_link", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/home/page.tsx": `export default function Home() { return null; }\n`,
      "concord-frontend/components/nav/Nav.tsx": page(false),
    });
    try {
      const r = await runUxBrokenLinkDetector({ root: dir });
      assert.ok(ids(r).includes("broken_link"));
    } finally { teardown(dir); }
  });

  it("direction 2: @broken-link-ok in the first 5 lines suppresses broken_link", async () => {
    const dir = withFixture({
      "concord-frontend/app/lenses/home/page.tsx": `export default function Home() { return null; }\n`,
      "concord-frontend/components/nav/Nav.tsx": page(true),
    });
    try {
      const r = await runUxBrokenLinkDetector({ root: dir });
      assert.equal(ids(r).includes("broken_link"), false);
    } finally { teardown(dir); }
  });
});

describe("@form-error-ok — ux-form-error-display-detector", () => {
  const page = (annotate) =>
    (annotate ? `// @form-error-ok: legacy form, tracked in TICKET-7\n` : ``) +
    `export default function ContactForm() {\n  return (\n    <form onSubmit={async (e) => {\n      e.preventDefault();\n      try {\n        await submit();\n      } catch (err) {\n        // swallowed — nothing surfaced to the user\n      }\n    }}>\n      <button type="submit">Send</button>\n    </form>\n  );\n}\n`;

  it("direction 1: a catch block with no error-surface call fires form_error_display_missing", async () => {
    const dir = withFixture({ "concord-frontend/components/contact/ContactForm.tsx": page(false) });
    try {
      const r = await runUxFormErrorDisplayDetector({ root: dir });
      assert.ok(ids(r).includes("form_error_display_missing"));
    } finally { teardown(dir); }
  });

  it("direction 2: @form-error-ok in the first 5 lines suppresses form_error_display_missing", async () => {
    const dir = withFixture({ "concord-frontend/components/contact/ContactForm.tsx": page(true) });
    try {
      const r = await runUxFormErrorDisplayDetector({ root: dir });
      assert.equal(ids(r).includes("form_error_display_missing"), false);
    } finally { teardown(dir); }
  });
});

describe("@loading-ok — ux-loading-state-missing-detector", () => {
  const page = (annotate) =>
    (annotate ? `// @loading-ok: legacy button, tracked in TICKET-8\n` : ``) +
    `export default function SaveButton() {\n  return (\n    <button onClick={async () => {\n      await fetch('/api/save', { method: 'POST' });\n    }}>Save</button>\n  );\n}\n`;

  it("direction 1: an async onClick issuing fetch with no loading state fires loading_state_missing", async () => {
    const dir = withFixture({ "concord-frontend/components/save/SaveButton.tsx": page(false) });
    try {
      const r = await runUxLoadingStateMissingDetector({ root: dir });
      assert.ok(ids(r).includes("loading_state_missing"));
    } finally { teardown(dir); }
  });

  it("direction 2: @loading-ok in the first 5 lines suppresses loading_state_missing", async () => {
    const dir = withFixture({ "concord-frontend/components/save/SaveButton.tsx": page(true) });
    try {
      const r = await runUxLoadingStateMissingDetector({ root: dir });
      assert.equal(ids(r).includes("loading_state_missing"), false);
    } finally { teardown(dir); }
  });
});

describe("@modal-escape-ok — ux-modal-no-escape-detector", () => {
  const page = (annotate) =>
    (annotate ? `// @modal-escape-ok: legacy modal, tracked in TICKET-9\n` : ``) +
    `export function InfoModal({ open }) {\n  if (!open) return null;\n  return <ConfirmModal>Details here</ConfirmModal>;\n}\n`;

  it("direction 1: a modal-suffixed component with no close prop and no Esc handler fires modal_no_escape", async () => {
    const dir = withFixture({ "concord-frontend/components/info/InfoModal.tsx": page(false) });
    try {
      const r = await runUxModalNoEscapeDetector({ root: dir });
      assert.ok(ids(r).includes("modal_no_escape"));
    } finally { teardown(dir); }
  });

  it("direction 2: @modal-escape-ok in the first 5 lines suppresses modal_no_escape", async () => {
    const dir = withFixture({ "concord-frontend/components/info/InfoModal.tsx": page(true) });
    try {
      const r = await runUxModalNoEscapeDetector({ root: dir });
      assert.equal(ids(r).includes("modal_no_escape"), false);
    } finally { teardown(dir); }
  });
});

describe("@route-empty-ok — ux-route-empty-render-detector", () => {
  const page = (annotate) =>
    (annotate ? `// @route-empty-ok: legacy lens, tracked in TICKET-10\n` : ``) +
    `export default function ProbeLensPage() {\n  const data = useSomeData();\n  if (!data) return null;\n  return <div>{data.length}</div>;\n}\n`;

  it("direction 1: a lens page's `return null` with no empty-state / loading guard fires route_empty_render", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/probelens/page.tsx": page(false) });
    try {
      const r = await runUxRouteEmptyRenderDetector({ root: dir });
      assert.ok(ids(r).includes("route_empty_render"));
    } finally { teardown(dir); }
  });

  it("direction 2: @route-empty-ok in the first 5 lines suppresses route_empty_render", async () => {
    const dir = withFixture({ "concord-frontend/app/lenses/probelens/page.tsx": page(true) });
    try {
      const r = await runUxRouteEmptyRenderDetector({ root: dir });
      assert.equal(ids(r).includes("route_empty_render"), false);
    } finally { teardown(dir); }
  });
});
