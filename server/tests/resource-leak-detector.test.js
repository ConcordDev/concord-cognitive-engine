/**
 * Tier-2 contract tests for ResourceLeakDetector.
 *
 * Pinned: setInterval-without-clear, addEventListener without remove,
 * db.prepare in loop, streams without close, fs.open without close,
 * timeout-density info finding, @resource-leak-ok annotation opt-out.
 *
 * Run: node --test tests/resource-leak-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runResourceLeakDetector } from "../lib/detectors/resource-leak-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `resource-leak-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("ResourceLeakDetector — setInterval without clear", () => {
  it("flags setInterval in server/lib without any clearInterval", async () => {
    const dir = withFixture({
      "server/lib/poller.js": `export function start() { setInterval(() => doWork(), 1000); }\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      const f = r.findings.find(x => x.id === "setinterval_without_clear");
      assert.ok(f, "expected setinterval_without_clear finding");
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });

  it("does NOT flag setInterval when clearInterval is in same file", async () => {
    const dir = withFixture({
      "server/lib/poller.js": `let h; export function start() { h = setInterval(() => 1, 100); }\nexport function stop() { clearInterval(h); }\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "setinterval_without_clear").length, 0);
    } finally { teardown(dir); }
  });

  it("skips heartbeat-pattern modules (registerHeartbeat present)", async () => {
    const dir = withFixture({
      "server/lib/heart.js": `import { registerHeartbeat } from "./hb.js";\nsetInterval(() => 1, 100);\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "setinterval_without_clear").length, 0);
    } finally { teardown(dir); }
  });
});

describe("ResourceLeakDetector — listener without remove", () => {
  it("flags addEventListener with no matching removeEventListener", async () => {
    const dir = withFixture({
      "concord-frontend/hooks/useFoo.ts": `export function useFoo() { window.addEventListener('resize', onResize); }\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      const f = r.findings.find(x => x.id === "listener_without_remove");
      assert.ok(f);
      assert.equal(f.severity, "medium");
      assert.equal(f.subject.event, "resize");
    } finally { teardown(dir); }
  });

  it("does NOT flag when matching removeEventListener exists", async () => {
    const dir = withFixture({
      "concord-frontend/hooks/useFoo.ts":
        `export function useFoo() { window.addEventListener('resize', onResize); window.removeEventListener('resize', onResize); }\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "listener_without_remove").length, 0);
    } finally { teardown(dir); }
  });
});

describe("ResourceLeakDetector — db.prepare inside a loop", () => {
  it("flags db.prepare inside a for loop", async () => {
    const dir = withFixture({
      "server/lib/batch.js": `for (let i = 0; i < 100; i++) { const stmt = db.prepare("SELECT * FROM x WHERE id = " + i); }\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      const f = r.findings.find(x => x.id === "db_prepare_in_loop");
      assert.ok(f);
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });
});

describe("ResourceLeakDetector — streams without close", () => {
  it("flags createReadStream with no close/finish/end handler", async () => {
    const dir = withFixture({
      "server/lib/io.js": `import fs from "fs"; const s = fs.createReadStream("/tmp/x"); s.on('data', () => {});\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      const f = r.findings.find(x => x.id === "stream_without_close");
      assert.ok(f);
      assert.equal(f.severity, "low");
    } finally { teardown(dir); }
  });
});

describe("ResourceLeakDetector — fs.open without close", () => {
  it("flags fs.open with no fs.close in same file", async () => {
    const dir = withFixture({
      "server/lib/files.js": `import fs from "fs"; export async function read() { const fh = await fs.promises.open("/tmp/x", "r"); }\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      const f = r.findings.find(x => x.id === "fs_open_without_close");
      assert.ok(f);
      assert.equal(f.severity, "medium");
    } finally { teardown(dir); }
  });
});

describe("ResourceLeakDetector — high setTimeout density (info)", () => {
  it("emits info finding when setTimeout count >= 8", async () => {
    const lines = Array.from({ length: 9 }, () => "setTimeout(() => 1, 1000);").join("\n");
    const dir = withFixture({ "server/lib/timers.js": lines + "\n" });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      const f = r.findings.find(x => x.id === "high_settimeout_density");
      assert.ok(f);
      assert.equal(f.severity, "info");
      assert.equal(f.subject.count, 9);
    } finally { teardown(dir); }
  });
});

describe("ResourceLeakDetector — annotation opt-out", () => {
  it("skips a file with @resource-leak-ok at file scope", async () => {
    const dir = withFixture({
      "server/lib/ok.js": `// @resource-leak-ok: bounded by process lifetime\nsetInterval(() => 1, 1000);\n`,
    });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.subject?.file === "server/lib/ok.js").length, 0);
    } finally { teardown(dir); }
  });
});

describe("ResourceLeakDetector — report shape", () => {
  it("returns a normalized report with scanned count", async () => {
    const dir = withFixture({ "server/lib/empty.js": "// nothing here\n" });
    try {
      const r = await runResourceLeakDetector({ root: dir });
      assert.equal(typeof r.ok, "boolean");
      assert.ok(Array.isArray(r.findings));
      assert.equal(typeof r.scanned, "number");
      for (const k of ["total", "critical", "high", "medium", "low", "info"]) {
        assert.equal(typeof r.summary[k], "number");
      }
    } finally { teardown(dir); }
  });
});
