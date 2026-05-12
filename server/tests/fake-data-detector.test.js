/**
 * Tier-2 contract tests for FakeDataDetector.
 *
 * Pinned: 4 finding categories (high export, medium test mock, low TODO,
 * info suspicious-string + fake-ident), allow-list for runtime-mock-mode
 * identifiers, skip rules for relative imports + trivial third-party.
 *
 * Run: node --test tests/fake-data-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runFakeDataDetector } from "../lib/detectors/fake-data-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `fake-data-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("FakeDataDetector — high severity (production exports)", () => {
  it("flags `export function mockFoo` in server/lib/ as high", async () => {
    const dir = withFixture({
      "server/lib/payments.js": `export function mockChargeUser(amount) { return { ok: true, fake: true }; }\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const f = r.findings.find(x => x.id === "fake_export_in_production");
      assert.ok(f, "expected high finding");
      assert.equal(f.severity, "high");
      assert.match(f.message, /mockChargeUser/);
    } finally { teardown(dir); }
  });

  it("flags `export const fakeUsers = ...` as high", async () => {
    const dir = withFixture({
      "server/routes/users.js": `export const fakeUsers = [{ id: 1 }];\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const f = r.findings.find(x => x.id === "fake_export_in_production");
      assert.ok(f);
      assert.equal(f.severity, "high");
    } finally { teardown(dir); }
  });

  it("does NOT flag `export function mockFoo` in tests/", async () => {
    const dir = withFixture({
      "server/tests/foo.test.js": `export function mockUser() { return { id: 1 }; }\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const high = r.findings.filter(x => x.severity === "high");
      assert.equal(high.length, 0);
    } finally { teardown(dir); }
  });
});

describe("FakeDataDetector — test mocks of production modules (summary)", () => {
  // Per-PR-#347 zero-tech-debt sweep: per-mock findings are consolidated
  // into a single `fake_data_summary` finding with the aggregate count.
  // Each mock that previously emitted a per-mock finding now bumps the
  // summary's testMockCount; the assertions below check the count delta.
  const summaryCount = (r) => {
    const s = r.findings.find(x => x.id === "fake_data_summary");
    return s?.evidence?.testMockCount || 0;
  };

  it("counts `vi.mock('@/lib/lens-registry', ...)` in a test", async () => {
    const dir = withFixture({
      "concord-frontend/tests/foo.test.tsx":
        `import { vi } from 'vitest';\nvi.mock('@/lib/lens-registry', () => ({ getLenses: () => [] }));\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.ok(summaryCount(r) >= 1, "expected the @/lib mock to bump summary count");
    } finally { teardown(dir); }
  });

  it("does not count `vi.mock('next/navigation')` (trivial third-party)", async () => {
    const dir = withFixture({
      "concord-frontend/tests/foo.test.tsx":
        `import { vi } from 'vitest';\nvi.mock('next/navigation');\nvi.mock('lucide-react');\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.equal(summaryCount(r), 0);
    } finally { teardown(dir); }
  });

  it("does not count relative-path mocks (`vi.mock('./helpers')`)", async () => {
    const dir = withFixture({
      "concord-frontend/tests/foo.test.tsx":
        `import { vi } from 'vitest';\nvi.mock('./helpers');\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.equal(summaryCount(r), 0);
    } finally { teardown(dir); }
  });

  it("counts server-side test mocking ../lib/x", async () => {
    const dir = withFixture({
      "server/tests/economy.test.js":
        `import { jest } from 'vitest';\njest.mock('../lib/royalty-cascade.js', () => ({}));\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.ok(summaryCount(r) >= 1, "expected the ../lib mock to bump summary count");
    } finally { teardown(dir); }
  });
});

describe("FakeDataDetector — TODO/FIXME in production", () => {
  it("flags `// TODO: replace with real data` as MEDIUM (deferred-replace pattern)", async () => {
    const dir = withFixture({
      "server/lib/example.js": `// TODO: replace with real data\nexport const data = [];\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const f = r.findings.find(x => x.id === "todo_replace_in_production");
      assert.ok(f, "expected todo_replace_in_production finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("flags FIXME `hardcoded for now` as MEDIUM", async () => {
    const dir = withFixture({
      "server/lib/example.js": `// FIXME hardcoded for now\nexport const x = 1;\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const f = r.findings.find(x => x.id === "todo_replace_in_production");
      assert.ok(f);
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("flags plain TODO without replace-language as LOW", async () => {
    const dir = withFixture({
      "server/lib/example.js": `// TODO: optimise loop later\nexport const x = 1;\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const f = r.findings.find(x => x.id === "todo_in_production");
      assert.ok(f);
      assert.equal(f.severity, "low");
    } finally { teardown(dir); }
  });

  it("does NOT flag TODO in tests/", async () => {
    const dir = withFixture({
      "server/tests/foo.test.js": `// TODO add more cases\nexport const x = 1;\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const flagged = r.findings.filter(x => x.id === "todo_in_production");
      assert.equal(flagged.length, 0);
    } finally { teardown(dir); }
  });
});

describe("FakeDataDetector — info severity (suspicious strings + fake idents)", () => {
  it("flags lorem ipsum literal", async () => {
    const dir = withFixture({
      "server/lib/cms.js": `export const blurb = "lorem ipsum dolor sit amet";\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const f = r.findings.find(x => x.id === "suspicious_string_in_production");
      assert.ok(f);
    } finally { teardown(dir); }
  });

  it("flags fake_user_email-style literal", async () => {
    const dir = withFixture({
      "server/routes/test.js": `const x = "fake_user_email";\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const f = r.findings.find(x => x.id === "suspicious_string_in_production");
      assert.ok(f);
    } finally { teardown(dir); }
  });

  it("allow-lists runtime-mock-mode identifiers (mockLlm, mockBrain, etc)", async () => {
    const dir = withFixture({
      "server/lib/example.js": `if (mockLlm) { /* ... */ }\nconst x = mockBrain();\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const flagged = r.findings.filter(x => x.id === "fake_ident_in_production");
      assert.equal(flagged.length, 0);
    } finally { teardown(dir); }
  });

  it("does flag plain mockUser/fakeData identifiers", async () => {
    const dir = withFixture({
      "server/lib/example.js": `const mockUser = {};\nfunction fakeData() { return []; }\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      const fs = r.findings.filter(x => x.id === "fake_ident_in_production");
      assert.ok(fs.length >= 2);
    } finally { teardown(dir); }
  });
});

describe("FakeDataDetector — clean state", () => {
  it("returns 0 findings on a clean fixture", async () => {
    const dir = withFixture({
      "server/lib/clean.js": `export function realCharge(amount) { return amount; }\n`,
      "server/tests/clean.test.js": `import { realCharge } from "../lib/clean.js";\n`,
    });
    try {
      const r = await runFakeDataDetector({ root: dir });
      assert.equal(r.summary.high, 0);
      assert.equal(r.summary.medium, 0);
      assert.equal(r.summary.low, 0);
    } finally { teardown(dir); }
  });
});
