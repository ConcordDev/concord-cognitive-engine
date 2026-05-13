/**
 * Tier-2 contract tests for HttpErrorDetector.
 *
 * Pinned rules (one positive + one negative fixture each):
 *   - req_body_used_without_validation (400, medium)
 *   - req_param_used_as_number_without_parse (400, low)
 *   - db_get_used_without_null_check (404→500, medium)
 *   - insert_without_conflict_guard (409, low)
 *   - expensive_route_without_rate_limit (429, medium)
 *   - external_call_without_timeout (504, medium)
 *
 * Plus: report-shape contract, file-level @http-error-ok opt-out,
 * registry wiring (detector is registered under id "http-error").
 *
 * Run: node --test server/tests/http-error-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { runHttpErrorDetector } from "../lib/detectors/http-error-detector.js";
import { listDetectors, getDetector } from "../lib/detectors/index.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `http-err-test-${Math.random().toString(36).slice(2)}`);
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
  assert.ok(typeof r === "object" && r !== null, "must return an object");
  for (const k of REPORT_SHAPE) assert.ok(k in r, `report missing key: ${k}`);
  assert.equal(typeof r.ok, "boolean");
  assert.ok(Array.isArray(r.findings));
  for (const k of ["total", "critical", "high", "medium", "low", "info"]) {
    assert.equal(typeof r.summary[k], "number", `summary missing ${k}`);
  }
  assert.equal(r.summary.total, r.findings.length);
}

describe("HttpErrorDetector — req.body without validation (400)", () => {
  it("does NOT flag when validate(\"schema\") middleware is in the route declaration", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/x', validate("createUser"), async (req, res) => {\n  const name = req.body.name;\n  res.json({ name });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "req_body_used_without_validation").length, 0,
        "validate() middleware in declaration should suppress every req.body finding in this handler");
    } finally { teardown(dir); }
  });

  it("does NOT flag req.body.X || default fallback pattern", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/x', async (req, res) => {\n  const itemId = req.body.itemId || req.body.id || 'default';\n  const slot = req.body.slot || null;\n  res.json({ itemId, slot });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "req_body_used_without_validation").length, 0,
        "`req.body.X || default` defensive coalesce should suppress the finding");
    } finally { teardown(dir); }
  });

  it("does NOT flag Number(req.body.X) coercion", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/x', async (req, res) => {\n  const quantity = Number(req.body.quantity) || 1;\n  res.json({ quantity });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "req_body_used_without_validation").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag when enforceRequestInvariants is called in body", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/x', async (req, res) => {\n  req.body = enforceRequestInvariants(req, req.body || {});\n  const mode = req.body.mode;\n  res.json({ mode });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "req_body_used_without_validation").length, 0);
    } finally { teardown(dir); }
  });

  it("flags req.body.field access in a handler with no Zod / Joi / explicit guard", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/x', async (req, res) => {\n  const name = req.body.name;\n  res.json({ name });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      const f = r.findings.find(x => x.id === "req_body_used_without_validation");
      assert.ok(f, "expected req_body_used_without_validation finding");
      assert.equal(f.severity, "medium");
      assert.match(f.location, /server\/routes\/foo\.js:\d+/);
    } finally { teardown(dir); }
  });

  it("does NOT flag when handler uses zod safeParse", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nimport { z } from "zod";\nconst router = Router();\nrouter.post('/x', async (req, res) => {\n  const parsed = z.object({ name: z.string() }).safeParse(req.body);\n  if (!parsed.success) return res.status(400).json({ err: parsed.error });\n  res.json({ name: req.body.name });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "req_body_used_without_validation").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag when handler destructures req.body (treated as validation seam)", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/x', async (req, res) => {\n  const { name } = req.body;\n  if (!name) return res.status(400).json({ err: 'name required' });\n  res.json({ name });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "req_body_used_without_validation").length, 0);
    } finally { teardown(dir); }
  });
});

describe("HttpErrorDetector — req.params/.query used as number (400)", () => {
  it("flags req.params.id used in arithmetic with no parseInt", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/x/:id', async (req, res) => {\n  const next = req.params.id + 1;\n  res.json({ next });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      const f = r.findings.find(x => x.id === "req_param_used_as_number_without_parse");
      assert.ok(f, "expected req_param_used_as_number_without_parse finding");
      assert.equal(f.severity, "low");
    } finally { teardown(dir); }
  });

  it("does NOT flag when parseInt wraps the value on the previous line", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/x/:id', async (req, res) => {\n  const id = parseInt(req.params.id, 10);\n  if (!Number.isFinite(id)) return res.status(400).json({ err: 'bad id' });\n  res.json({ next: id + 1 });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "req_param_used_as_number_without_parse").length, 0);
    } finally { teardown(dir); }
  });
});

describe("HttpErrorDetector — DB .get() result without null check (404)", () => {
  it("does NOT flag .get() on a Map (only db.prepare().get() chains are checked)", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst cache = new Map();\nconst router = Router();\nrouter.get('/x', async (req, res) => {\n  const entry = cache.get(req.params.id);\n  res.json({ count: entry.count });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "db_get_used_without_null_check").length, 0,
        "Map.get / Cache.get must not be flagged — only db.prepare().get()");
    } finally { teardown(dir); }
  });

  it("does NOT flag the `pop && pop.x` short-circuit pattern", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/x', async (req, res) => {\n  const pop = db.prepare('SELECT count FROM populations WHERE id = ?').get(req.params.id);\n  const overflow = pop && pop.count > 1000;\n  res.json({ overflow });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "db_get_used_without_null_check").length, 0,
        "`pop && pop.x` short-circuit is a valid guard");
    } finally { teardown(dir); }
  });

  it("does NOT flag a different statement's .get() chain after another const X = db.prepare(...).all() assignment", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/x', async (req, res) => {\n  const rows = db.prepare('SELECT * FROM t').all(req.params.id);\n  const avg = db.prepare('SELECT AVG(x) FROM t').get()?.x || 0;\n  res.json({ count: rows.length, avg });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      // Both `rows` (.all → array) and `avg` (uses ?. optional chaining) are safe.
      assert.equal(r.findings.filter(f => f.id === "db_get_used_without_null_check").length, 0,
        "single-statement regex must not span across `;` boundaries");
    } finally { teardown(dir); }
  });

  it("does NOT flag when the truthy `if (row)` pattern wraps the property access", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/users/:id', async (req, res) => {\n  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);\n  if (row) {\n    return res.json({ name: row.name });\n  }\n  res.status(404).json({ err: 'not_found' });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "db_get_used_without_null_check").length, 0,
        "`if (row) { row.x }` is a valid truthy null-check pattern");
    } finally { teardown(dir); }
  });

  it("flags a .get() result property-accessed within 5 lines and no null guard", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/users/:id', async (req, res) => {\n  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);\n  res.json({ name: user.name, email: user.email });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      const f = r.findings.find(x => x.id === "db_get_used_without_null_check");
      assert.ok(f, "expected db_get_used_without_null_check finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag when an `if (!user) return 404` short-circuit is present", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/users/:id', async (req, res) => {\n  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);\n  if (!user) return res.status(404).json({ err: 'not_found' });\n  res.json({ name: user.name });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "db_get_used_without_null_check").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag when optional chaining is used", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/users/:id', async (req, res) => {\n  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);\n  res.json({ name: user?.name });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "db_get_used_without_null_check").length, 0);
    } finally { teardown(dir); }
  });
});

describe("HttpErrorDetector — INSERT without conflict guard (409)", () => {
  it("does NOT flag when handler is wrapped by asyncHandler (throws routed to express error chain)", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/users', asyncHandler(async (req, res) => {\n  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(req.body.id, req.body.name);\n  res.json({ ok: true });\n}));\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "insert_without_conflict_guard").length, 0,
        "asyncHandler wrapper should suppress the conflict-guard rule");
    } finally { teardown(dir); }
  });

  it("flags INSERT INTO inside a handler with no try and no ON CONFLICT", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/users', async (req, res) => {\n  db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(req.body.id, req.body.name);\n  res.json({ ok: true });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      const f = r.findings.find(x => x.id === "insert_without_conflict_guard");
      assert.ok(f, "expected insert_without_conflict_guard finding");
      assert.equal(f.severity, "low");
    } finally { teardown(dir); }
  });

  it("does NOT flag when the INSERT has ON CONFLICT", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/users', async (req, res) => {\n  db.prepare('INSERT INTO users (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').run(req.body.id, req.body.name);\n  res.json({ ok: true });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "insert_without_conflict_guard").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag when the handler is wrapped in try/catch", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/users', async (req, res) => {\n  try {\n    db.prepare('INSERT INTO users (id, name) VALUES (?, ?)').run(req.body.id, req.body.name);\n    res.json({ ok: true });\n  } catch (err) {\n    res.status(409).json({ err: 'conflict' });\n  }\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "insert_without_conflict_guard").length, 0);
    } finally { teardown(dir); }
  });
});

describe("HttpErrorDetector — expensive route without rate limit (429)", () => {
  it("flags a route that calls sendMail without a per-route limiter middleware", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/invite', async (req, res) => {\n  await transporter.sendMail({ to: req.body.email, subject: 'hi' });\n  res.json({ ok: true });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      const f = r.findings.find(x => x.id === "expensive_route_without_rate_limit");
      assert.ok(f, "expected expensive_route_without_rate_limit finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag when authRateLimiter is in the route declaration", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/invite', authRateLimiter, async (req, res) => {\n  await transporter.sendMail({ to: req.body.email, subject: 'hi' });\n  res.json({ ok: true });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "expensive_route_without_rate_limit").length, 0);
    } finally { teardown(dir); }
  });
});

describe("HttpErrorDetector — external call without timeout (504)", () => {
  it("flags a fetch() with no signal/timeout option", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/proxy', async (req, res) => {\n  try {\n    const r = await fetch('https://api.example.com/data');\n    res.json(await r.json());\n  } catch (e) { res.status(502).end(); }\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      const f = r.findings.find(x => x.id === "external_call_without_timeout");
      assert.ok(f, "expected external_call_without_timeout finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag when AbortSignal.timeout is wired", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.get('/proxy', async (req, res) => {\n  try {\n    const r = await fetch('https://api.example.com/data', { signal: AbortSignal.timeout(5000) });\n    res.json(await r.json());\n  } catch (e) { res.status(502).end(); }\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "external_call_without_timeout").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag Ollama brain port fetches (routed through llm-router with its own timeout)", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `import { Router } from "express";\nconst router = Router();\nrouter.post('/chat', async (req, res) => {\n  try {\n    const r = await fetch('http://localhost:11434/api/generate', { method: 'POST' });\n    res.json(await r.json());\n  } catch (e) { res.status(502).end(); }\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "external_call_without_timeout").length, 0);
    } finally { teardown(dir); }
  });
});

describe("HttpErrorDetector — file-level opt-out", () => {
  it("respects `@http-error-ok` near the top of the file", async () => {
    const dir = withFixture({
      "server/routes/foo.js":
        `// @http-error-ok: intentional in this admin tool\nimport { Router } from "express";\nconst router = Router();\nrouter.post('/x', async (req, res) => {\n  const name = req.body.name;\n  res.json({ name });\n});\nexport default router;\n`,
    });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assert.equal(r.findings.length, 0, "annotation should suppress every rule");
    } finally { teardown(dir); }
  });
});

describe("HttpErrorDetector — report shape", () => {
  it("returns the canonical DetectorReport shape on an empty fixture", async () => {
    const dir = withFixture({ "server/routes/empty.js": "// no routes here\nexport default {};\n" });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.id, "http-error");
      assert.equal(r.ok, true);
    } finally { teardown(dir); }
  });

  it("returns ok=true even when SCAN_DIRS don't exist (degrades gracefully)", async () => {
    const dir = withFixture({ "README.md": "no server dir here" });
    try {
      const r = await runHttpErrorDetector({ root: dir });
      assertReportShape(r);
      assert.equal(r.ok, true);
      assert.equal(r.findings.length, 0);
    } finally { teardown(dir); }
  });
});

describe("HttpErrorDetector — registry wiring", () => {
  it("is registered with id 'http-error' and consumers include repair-cortex", () => {
    const ids = listDetectors().map(d => d.id);
    assert.ok(ids.includes("http-error"), "http-error detector must be registered");
    const spec = getDetector("http-error");
    assert.ok(spec, "getDetector('http-error') must return the spec");
    assert.ok(spec.consumers.includes("repair-cortex"), "must route to repair-cortex consumer");
    assert.ok(spec.dataNeeds.includes("fs"), "must declare 'fs' data need");
  });
});
