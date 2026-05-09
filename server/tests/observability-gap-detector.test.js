/**
 * Tier-2 contract tests for ObservabilityGapDetector.
 *
 * Pinned: route handler without try/catch (medium), heartbeat without try
 * (medium), brain/LLM call without latency capture (low), forge-template
 * skip rule, @observability-ok annotation opt-out, report shape.
 *
 * Run: node --test tests/observability-gap-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runObservabilityGapDetector } from "../lib/detectors/observability-gap-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `obs-gap-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("ObservabilityGapDetector — route without try/catch", () => {
  it("flags an Express route handler with no try block in body", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/foo', async (req, res) => {\n  const data = await db.fetch();\n  res.json(data);\n});\nexport default router;\n`,
    });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      const f = r.findings.find(x => x.id === "route_without_try_catch");
      assert.ok(f, "expected route_without_try_catch finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag when handler body has try/catch within 30 lines", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/foo', async (req, res) => {\n  try {\n    const data = await db.fetch();\n    res.json(data);\n  } catch (err) {\n    res.status(500).json({ err: err.message });\n  }\n});\nexport default router;\n`,
    });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "route_without_try_catch").length, 0);
    } finally { teardown(dir); }
  });
});

describe("ObservabilityGapDetector — heartbeat without try", () => {
  it("flags an exported run*Cycle handler with no try block in first 80 lines", async () => {
    const dir = withFixture({
      "server/emergent/foo-cycle.js":
        `export async function runFooCycle({ db }) {\n  const rows = db.prepare('SELECT 1').all();\n  return { ok: true, rows };\n}\n`,
    });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      const f = r.findings.find(x => x.id === "heartbeat_without_try");
      assert.ok(f, "expected heartbeat_without_try finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag heartbeat when body has try/catch", async () => {
    const dir = withFixture({
      "server/emergent/foo-cycle.js":
        `export async function runFooCycle({ db }) {\n  try {\n    const rows = db.prepare('SELECT 1').all();\n    return { ok: true, rows };\n  } catch (err) {\n    return { ok: false, reason: err.message };\n  }\n}\n`,
    });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "heartbeat_without_try").length, 0);
    } finally { teardown(dir); }
  });
});

describe("ObservabilityGapDetector — LLM call without latency capture", () => {
  it("flags ollama fetch with no Date.now / performance.now nearby", async () => {
    const dir = withFixture({
      "server/routes/brain.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/chat', async (req, res) => {\n  try {\n    const r = await fetch('http://localhost:11434/api/generate', { method: 'POST' });\n    res.json(await r.json());\n  } catch (err) { res.status(500).end(); }\n});\nexport default router;\n`,
    });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      const f = r.findings.find(x => x.id === "llm_call_without_telemetry");
      assert.ok(f);
      assert.equal(f.severity, "low");
    } finally { teardown(dir); }
  });

  it("does NOT flag LLM call wrapped with Date.now timing", async () => {
    const dir = withFixture({
      "server/routes/brain.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/chat', async (req, res) => {\n  try {\n    const t0 = Date.now();\n    const r = await fetch('http://localhost:11434/api/generate', { method: 'POST' });\n    res.json({ ms: Date.now() - t0, body: await r.json() });\n  } catch (err) { res.status(500).end(); }\n});\nexport default router;\n`,
    });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "llm_call_without_telemetry").length, 0);
    } finally { teardown(dir); }
  });
});

describe("ObservabilityGapDetector — skip rules + annotations", () => {
  it("skips files under server/lib/forge-template-* (templates emit fake routes)", async () => {
    const dir = withFixture({
      "server/emergent/forge-template-engine.js":
        `export const sample = "router.get('/foo', async (req, res) => { res.json({}); });";\n`,
    });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.subject?.file === "server/emergent/forge-template-engine.js").length, 0);
    } finally { teardown(dir); }
  });

  it("skips file with @observability-ok annotation", async () => {
    const dir = withFixture({
      "server/routes/ok.js":
        `// @observability-ok: handler is wrapped one level up\nimport { Router } from "express";\nconst router = Router();\nrouter.get('/x', async (req, res) => { res.json({}); });\nexport default router;\n`,
    });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.subject?.file === "server/routes/ok.js").length, 0);
    } finally { teardown(dir); }
  });
});

describe("ObservabilityGapDetector — report shape", () => {
  it("returns a normalized report with scanned count", async () => {
    const dir = withFixture({ "server/routes/empty.js": "export default {};\n" });
    try {
      const r = await runObservabilityGapDetector({ root: dir });
      assert.equal(typeof r.ok, "boolean");
      assert.ok(Array.isArray(r.findings));
      assert.equal(typeof r.scanned, "number");
      for (const k of ["total", "critical", "high", "medium", "low", "info"]) {
        assert.equal(typeof r.summary[k], "number");
      }
    } finally { teardown(dir); }
  });
});
