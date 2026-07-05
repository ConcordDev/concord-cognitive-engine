/**
 * Tier-2 contract test for PerformanceHotspotDetector's `unbounded_cache_growth`
 * rule — pins the module-scope-vs-function-scope depth-tracking fix.
 *
 * The rule's brace-depth counter has no string/regex-literal awareness (only
 * `//` and `/* *​/` comments are stripped), so a brace character sitting
 * inside a regex literal or string can spuriously decrement `depth` below
 * the true nesting level. Left unclamped, that drift never recovers for the
 * rest of the file, so a genuinely function-local `Map`/`Set` declared after
 * the drift point gets misread as module-scope and false-flagged — this is
 * exactly how command-injection-detector.js's own `parseChildProcessBindings`
 * (a regex-literal-heavy helper) was misflagged before the depth clamp.
 *
 * Run: node --test tests/performance-hotspot-detector.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runPerformanceHotspotDetector } from "../lib/detectors/performance-hotspot-detector.js";

function withFixture(layout) {
  const dir = path.join(tmpdir(), `perf-hotspot-test-${Math.random().toString(36).slice(2)}`);
  for (const [relPath, content] of Object.entries(layout)) {
    const full = path.join(dir, relPath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}
function teardown(d) { try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

describe("PerformanceHotspotDetector — unbounded_cache_growth depth tracking", () => {
  it("does NOT flag a function-local Map/Set declared after an earlier regex literal contains an unstripped brace", async () => {
    // The regex on the first line contains a `}` inside a character-class-ish
    // shape that the naive comment/string stripper does not understand,
    // driving the char-by-char brace counter negative before the real
    // function below is ever reached.
    const dir = withFixture({
      "server/lib/weird-regex-helper.js": [
        "const RE = /\\{2,4\\}/;",
        "}",
        "",
        "export function parseThing(content) {",
        "  const named = new Set();",
        "  const namespaces = new Set();",
        "  named.add('x');",
        "  namespaces.add('y');",
        "  return { named, namespaces };",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      const hits = r.findings.filter(f => f.id === "perf_unbounded_cache_growth");
      assert.equal(hits.length, 0,
        "function-local Map/Set must not be flagged even after an earlier stray brace corrupts the naive depth counter");
    } finally { teardown(dir); }
  });

  it("STILL flags a genuine module-scope growing Map with no eviction path", async () => {
    const dir = withFixture({
      "server/lib/real-cache.js": [
        "const cache = new Map();",
        "export function remember(key, value) {",
        "  cache.set(key, value);",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      const hit = r.findings.find(f => f.id === "perf_unbounded_cache_growth");
      assert.ok(hit, "a genuine module-scope unbounded cache must still be flagged");
      assert.equal(hit.severity, "low");
    } finally { teardown(dir); }
  });

  it("does NOT flag a module-scope Map that has an eviction path (.delete/.clear)", async () => {
    const dir = withFixture({
      "server/lib/bounded-cache.js": [
        "const cache = new Map();",
        "export function remember(key, value) {",
        "  cache.set(key, value);",
        "  if (cache.size > 100) cache.clear();",
        "}",
        "",
      ].join("\n"),
    });
    try {
      const r = await runPerformanceHotspotDetector({ root: dir });
      assert.equal(r.findings.filter(f => f.id === "perf_unbounded_cache_growth").length, 0);
    } finally { teardown(dir); }
  });
});
