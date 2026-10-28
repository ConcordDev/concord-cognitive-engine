// The news feed-cache warm must run from the heartbeat registry (dispatched on the idle,
// low-memory and normal paths), not from the kernel-tick body, which returns early when
// the host is idle or memory-paused and so left news warmed only once at boot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");

test("news warm is registered as a heartbeat, not a cpu-class one", () => {
  const m = src.match(/registerHeartbeat\("news-feed-warm",\s*\{([\s\S]*?)\}\);/);
  assert.ok(m, "news-feed-warm heartbeat registered");
  assert.match(m[1], /_runNewsFeedWarm\(/);
  assert.doesNotMatch(m[1], /cost:\s*"cpu"/, "cpu-class heartbeats are skipped while idle");
});

test("warm body lives in one module-level function with a re-entrancy guard", () => {
  assert.equal((src.match(/fc\.warmTick\(/g) || []).length, 1, "exactly one warmTick call site");
  const fn = src.slice(src.indexOf("function _runNewsFeedWarm("));
  assert.match(fn.slice(0, 200), /if \(_newsWarmRunning\) return;/);
  assert.match(fn.slice(0, 4000), /\.finally\(\(\) => \{ _newsWarmRunning = false; \}\)/);
});

test("governorTick body no longer carries the warm block", () => {
  const start = src.indexOf("async function governorTick(");
  assert.ok(start > 0);
  const body = src.slice(start, start + 60000);
  assert.ok(!body.includes("fc.warmTick("), "warm not inside governorTick");
});
