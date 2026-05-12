/**
 * Tier-2 contract tests for LensHealthDetector.
 *
 * Pins the post-fix behavior:
 *
 *   - knownDomains is collected by parsing register() AND registerLensAction()
 *     calls across server.js, server/domains/, server/lib/, server/routes/,
 *     and server/emergent/ — NOT by reading filenames in server/domains/.
 *     (Pre-fix, filename heuristic produced 8 HIGH false-positives because
 *     filenames are kebab-case while many domains register snake_case names,
 *     and many domains register inline in server.js with no dedicated file.)
 *
 *   - When a lens calls a domain that has no register() / registerLensAction()
 *     anywhere in the tree, the finding is `info` severity (not `high`),
 *     because the /api/lens/run route falls through to a utility-brain AI
 *     catch-all — the lens still works, it just gets LLM-generated content
 *     instead of a deterministic handler.
 *
 * Run: node --test server/tests/lens-health-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runLensHealthDetector } from "../lib/detectors/lens-health-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `lens-health-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("lens-health-detector — domain discovery", () => {
  it("treats register() inline in server.js as a known domain", async () => {
    const root = withFixture({
      "server/server.js": `register("widget", "list", () => {}); register("widget", "create", () => {});`,
      "server/domains/.gitkeep": "",
      "concord-frontend/app/lenses/widget/page.tsx":
        `export default function P() { return <div onClick={() => api.post('/api/lens/run', { domain: 'widget', action: 'list' })}/>; }`,
    });
    try {
      const r = await runLensHealthDetector({ root });
      const unknown = r.findings.filter(f => f.id === "lens_unknown_domain");
      assert.equal(unknown.length, 0, "inline register() in server.js must count as a known domain");
    } finally { teardown(root); }
  });

  it("treats registerLensAction() as a known domain", async () => {
    const root = withFixture({
      "server/server.js": "",
      "server/domains/healthcare.js":
        `export default function fn(registerLensAction) { registerLensAction("healthcare", "vision", () => {}); }`,
      "concord-frontend/app/lenses/healthcare/page.tsx":
        `export default function P() { return <div onClick={() => api.post('/api/lens/run', { domain: 'healthcare', action: 'generate' })}/>; }`,
    });
    try {
      const r = await runLensHealthDetector({ root });
      const unknown = r.findings.filter(f => f.id === "lens_unknown_domain");
      // Lens calls action 'generate' which doesn't exist, but the DOMAIN
      // 'healthcare' is registered (via registerLensAction). The detector
      // checks domain existence; action-level mismatch falls through to AI
      // catch-all at runtime.
      assert.equal(unknown.length, 0, "registerLensAction must count as a known domain");
    } finally { teardown(root); }
  });

  it("handles kebab-case filename / snake_case domain mismatch", async () => {
    const root = withFixture({
      "server/server.js": "",
      "server/domains/event-timeline.js":
        `export default function fn(register) { register("event_timeline", "recent", () => {}); }`,
      "concord-frontend/app/lenses/event-timeline/page.tsx":
        `export default function P() { return <div onClick={() => api.post('/api/lens/run', { domain: 'event_timeline', action: 'recent' })}/>; }`,
    });
    try {
      const r = await runLensHealthDetector({ root });
      const unknown = r.findings.filter(f => f.id === "lens_unknown_domain");
      assert.equal(unknown.length, 0, "domain name (snake_case) is the source of truth, not filename (kebab-case)");
    } finally { teardown(root); }
  });

  it("reports unknown domains as info severity (not high), citing the AI catch-all", async () => {
    const root = withFixture({
      "server/server.js": "",
      "server/domains/.gitkeep": "",
      "concord-frontend/app/lenses/exotic/page.tsx":
        `export default function P() { return <div onClick={() => api.post('/api/lens/run', { domain: 'exotic', action: 'do_thing' })}/>; }`,
    });
    try {
      const r = await runLensHealthDetector({ root });
      const unknown = r.findings.filter(f => f.id === "lens_unknown_domain");
      assert.equal(unknown.length, 1, "unknown domain must still be reported");
      assert.equal(unknown[0].severity, "info", "unknown domains route via AI catch-all — info, not high");
      assert.match(unknown[0].message, /utility-brain|catch-all/i, "message should cite the runtime fallback");
    } finally { teardown(root); }
  });
});
