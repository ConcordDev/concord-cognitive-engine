/**
 * Tier-2 contract tests for EnvConfigDriftDetector.
 *
 * Pinned: hardcoded prod URL (medium), localhost without env fallback (medium),
 * known service port (low), magic timeout (info), placeholder URL skip,
 * env-fallback skip, @env-config-ok annotation opt-out.
 *
 * Run: node --test tests/env-config-drift-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runEnvConfigDriftDetector } from "../lib/detectors/env-config-drift-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `env-drift-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("EnvConfigDriftDetector — hardcoded production URL", () => {
  it("flags a real prod URL with no env fallback", async () => {
    const dir = withFixture({
      "server/lib/api.js": `export const HOST = "https://api.production-service.com/v1";\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      const f = r.findings.find(x => x.id === "hardcoded_prod_url");
      assert.ok(f);
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag when process.env.X || URL fallback is on the same line", async () => {
    const dir = withFixture({
      "server/lib/api.js": `export const HOST = process.env.API_URL || "https://api.production-service.com";\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "hardcoded_prod_url").length, 0);
    } finally { teardown(dir); }
  });

  it("skips RFC 6761 reserved + standards URLs (example.com / w3.org)", async () => {
    const dir = withFixture({
      "server/lib/docs.js": `const ex = "https://example.com/page"; const w3 = "https://www.w3.org/2001/XMLSchema";\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "hardcoded_prod_url").length, 0);
    } finally { teardown(dir); }
  });

  it("skips comment lines starting with //", async () => {
    const dir = withFixture({
      "server/lib/notes.js": `// fetched from https://api.production-service.com\nexport const x = 1;\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "hardcoded_prod_url").length, 0);
    } finally { teardown(dir); }
  });
});

describe("EnvConfigDriftDetector — hardcoded localhost", () => {
  it("flags localhost URL when file has no process.env reference at all", async () => {
    const dir = withFixture({
      "server/lib/local.js": `export const URL = "http://localhost:5050/api";\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      const f = r.findings.find(x => x.id === "hardcoded_localhost");
      assert.ok(f);
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag localhost when file uses process.env elsewhere", async () => {
    const dir = withFixture({
      "server/lib/local.js": `export const URL = "http://localhost:5050/api";\nexport const KEY = process.env.SECRET;\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "hardcoded_localhost").length, 0);
    } finally { teardown(dir); }
  });
});

describe("EnvConfigDriftDetector — magic ports", () => {
  it("flags known service port hardcoded in port: 5050 form", async () => {
    const dir = withFixture({
      "server/lib/conf.js": `export const opts = { port: 5050 };\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      const f = r.findings.find(x => x.id === "magic_port");
      assert.ok(f);
      assert.equal(f.severity, "low");
      assert.equal(f.subject.port, 5050);
    } finally { teardown(dir); }
  });

  it("does NOT flag a port behind a CONST export", async () => {
    const dir = withFixture({
      "server/lib/conf.js": `export const PORT = 5050;\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "magic_port").length, 0);
    } finally { teardown(dir); }
  });

  it("does NOT flag an unknown port number", async () => {
    const dir = withFixture({
      "server/lib/conf.js": `const opts = { port: 4242 };\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "magic_port").length, 0);
    } finally { teardown(dir); }
  });
});

describe("EnvConfigDriftDetector — magic timeouts", () => {
  it("flags timeout literal >= 10000ms", async () => {
    const dir = withFixture({
      "server/lib/t.js": `export const opts = { timeout: 30000 };\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      const f = r.findings.find(x => x.id === "magic_timeout");
      assert.ok(f);
      assert.equal(f.severity, "info");
      assert.equal(f.subject.ms, 30000);
    } finally { teardown(dir); }
  });

  it("does NOT flag a small timeout (< 10000)", async () => {
    const dir = withFixture({
      "server/lib/t.js": `const opts = { timeout: 5000 };\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "magic_timeout").length, 0);
    } finally { teardown(dir); }
  });
});

describe("EnvConfigDriftDetector — annotation + report shape", () => {
  it("skips file with @env-config-ok annotation", async () => {
    const dir = withFixture({
      "server/lib/ok.js": `// @env-config-ok: vendored client\nexport const HOST = "https://api.production-service.com";\n`,
    });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.subject?.file === "server/lib/ok.js").length, 0);
    } finally { teardown(dir); }
  });

  it("returns a normalized report shape", async () => {
    const dir = withFixture({ "server/lib/empty.js": "export const x = 1;\n" });
    try {
      const r = await runEnvConfigDriftDetector({ root: dir });
      assert.equal(typeof r.ok, "boolean");
      assert.ok(Array.isArray(r.findings));
      assert.equal(typeof r.scanned, "number");
      for (const k of ["total", "critical", "high", "medium", "low", "info"]) {
        assert.equal(typeof r.summary[k], "number");
      }
    } finally { teardown(dir); }
  });
});
