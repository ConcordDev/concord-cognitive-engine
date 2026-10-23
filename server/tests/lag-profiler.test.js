// Pins lib/lag-profiler.js against a REAL V8 profile: a deliberately blocking
// function must be named as the stall owner, an idle profile must yield no
// stall, and a GC pause must be reported by the GC logger.
import { test } from "node:test";
import assert from "node:assert/strict";
import inspector from "node:inspector";
import { findStalls, analyzeProfile, isAppFrame, startGcPauseLogger } from "../lib/lag-profiler.js";

const APP_ROOT = new URL("../", import.meta.url).href;

function post(session, method, params = {}) {
  return new Promise((res, rej) => session.post(method, params, (e, r) => (e ? rej(e) : res(r))));
}

async function profileWhile(fn) {
  const s = new inspector.Session();
  s.connect();
  await post(s, "Profiler.enable");
  await post(s, "Profiler.setSamplingInterval", { interval: 1000 });
  await post(s, "Profiler.start");
  await fn();
  const { profile } = await post(s, "Profiler.stop");
  s.disconnect();
  return profile;
}

function blockTheLoopOnPurpose(ms) {
  const end = Date.now() + ms;
  let x = 0;
  while (Date.now() < end) x += Math.sqrt(x + 1);
  return x;
}

test("names the function that held the loop", async () => {
  const profile = await profileWhile(async () => {
    await new Promise((r) => setTimeout(r, 50)); // idle gap before
    blockTheLoopOnPurpose(400);
    await new Promise((r) => setTimeout(r, 50)); // idle gap after
  });
  const stalls = findStalls(profile, { appRoot: APP_ROOT, minStallMs: 200 });
  assert.ok(stalls.length >= 1, "expected at least one stall");
  const s = stalls[0];
  assert.ok(s.stallMs >= 300 && s.stallMs < 2000, `stallMs=${s.stallMs}`);
  assert.match(s.owner, /^blockTheLoopOnPurpose tests\/lag-profiler\.test\.js:\d+$/);
  assert.ok(s.stack.some((f) => f.startsWith("blockTheLoopOnPurpose")));
  assert.deepEqual(analyzeProfile(profile, { appRoot: APP_ROOT, minStallMs: 200 }), s);
});

test("an idle profile has no stall above the threshold", async () => {
  const profile = await profileWhile(() => new Promise((r) => setTimeout(r, 300)));
  assert.deepEqual(findStalls(profile, { appRoot: APP_ROOT, minStallMs: 200 }), []);
  assert.equal(analyzeProfile(profile, { appRoot: APP_ROOT, minStallMs: 200 }), null);
});

test("malformed profiles are rejected, not thrown on", () => {
  assert.deepEqual(findStalls(null), []);
  assert.deepEqual(findStalls({ nodes: [], samples: [], timeDeltas: [] }), []);
});

test("isAppFrame excludes node internals and dependencies", () => {
  assert.equal(isAppFrame({ url: "node:internal/timers" }, APP_ROOT), false);
  assert.equal(isAppFrame({ url: APP_ROOT + "node_modules/x/index.js" }, APP_ROOT), false);
  assert.equal(isAppFrame({ url: "" }, APP_ROOT), false);
  assert.equal(isAppFrame({ url: APP_ROOT + "lib/foo.js" }, APP_ROOT), true);
});

test("GC logger reports pauses at or above the threshold", async () => {
  const seen = [];
  const h = await startGcPauseLogger({ minMs: 0, onPause: (p) => seen.push(p) });
  let junk = [];
  for (let i = 0; i < 200_000; i++) junk.push({ i, s: "x".repeat(16) });
  junk = null;
  if (global.gc) global.gc();
  await new Promise((r) => setTimeout(r, 50));
  h.stop();
  assert.ok(seen.length > 0, "expected at least one GC entry");
  assert.ok(seen.every((p) => typeof p.kind === "string" && Number.isFinite(p.ms) && !Number.isNaN(Date.parse(p.at))));
});
