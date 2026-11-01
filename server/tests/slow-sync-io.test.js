import test from "node:test";
import assert from "node:assert/strict";
import { installSlowSyncIo, slowSyncIoSince, setSlowSyncIoReporter, _resetSlowSyncIoForTest } from "../lib/slow-sync-io.js";

function fakeFs() {
  return {
    readFileSync(p) { fakeFs.cost = fakeFs.cost; return `data:${p}`; },
    statSync(p) { if (p === "boom") throw new Error("ENOENT"); return { size: 1 }; },
    notAFunction: 1,
  };
}
// Injected clock: each call advances by `step`, so durations are deterministic.
function clock() { let t = 0; return { hr: () => t, advance: (ms) => { t += ms; } }; }

test("a call over the threshold is recorded with fn, target and caller frames", () => {
  _resetSlowSyncIoForTest();
  const fs = fakeFs(); const c = clock();
  const orig = fs.readFileSync;
  fs.readFileSync = (p) => { c.advance(400); return orig(p); };
  installSlowSyncIo(fs, { thresholdMs: 150, hr: c.hr, now: () => 1000 });
  assert.equal(fs.readFileSync("/data/big.db"), "data:/data/big.db");
  const got = slowSyncIoSince(0);
  assert.equal(got.length, 1);
  assert.equal(got[0].fn, "readFileSync");
  assert.equal(got[0].target, "/data/big.db");
  assert.equal(got[0].ms, 400);
  assert.ok(got[0].frames.length > 0, "caller frames captured");
});

test("fast calls and non-functions are left alone; results and throws pass through", () => {
  _resetSlowSyncIoForTest();
  const fs = fakeFs(); const c = clock();
  installSlowSyncIo(fs, { thresholdMs: 150, hr: c.hr });
  fs.readFileSync("/x");
  assert.equal(slowSyncIoSince(0).length, 0);
  assert.equal(fs.notAFunction, 1);
  assert.throws(() => fs.statSync("boom"), /ENOENT/);
});

test("a slow call that throws is still recorded", () => {
  _resetSlowSyncIoForTest();
  const fs = fakeFs(); const c = clock();
  const orig = fs.statSync;
  fs.statSync = (p) => { c.advance(500); return orig(p); };
  installSlowSyncIo(fs, { thresholdMs: 150, hr: c.hr });
  assert.throws(() => fs.statSync("boom"));
  assert.equal(slowSyncIoSince(0)[0].fn, "statSync");
});

test("install is idempotent, uninstall restores, since() windows, reporter replays + streams", () => {
  _resetSlowSyncIoForTest();
  const fs = fakeFs(); const c = clock(); let n = 0;
  const orig = fs.readFileSync;
  fs.readFileSync = (p) => { c.advance(300); return orig(p); };
  const base = fs.readFileSync;
  const h = installSlowSyncIo(fs, { thresholdMs: 150, hr: c.hr, now: () => (n += 1000) });
  const wrapped = fs.readFileSync;
  installSlowSyncIo(fs, { thresholdMs: 150, hr: c.hr });
  assert.equal(fs.readFileSync, wrapped, "second install does not double-wrap");
  fs.readFileSync("/a"); fs.readFileSync("/b");
  assert.deepEqual(slowSyncIoSince(2000).map((e) => e.target), ["/b"]);
  const seen = [];
  setSlowSyncIoReporter((e) => seen.push(e.target));
  assert.deepEqual(seen, ["/a", "/b"], "buffered entries replay");
  fs.readFileSync("/c");
  assert.deepEqual(seen, ["/a", "/b", "/c"]);
  h.uninstall();
  assert.equal(fs.readFileSync, base);
});

test("real node:fs: wrapper installs without changing results", async () => {
  const nodeFs = (await import("node:fs")).default;
  const before = nodeFs.readFileSync;
  const h = installSlowSyncIo(nodeFs, { thresholdMs: 10_000 });
  assert.notEqual(nodeFs.readFileSync, before);
  assert.ok(nodeFs.readFileSync(new URL(import.meta.url), "utf8").includes("real node:fs"));
  h.uninstall();
  assert.equal(nodeFs.readFileSync, before);
});
