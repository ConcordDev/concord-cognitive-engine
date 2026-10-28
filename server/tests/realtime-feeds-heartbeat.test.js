// Realtime feeds (finance, crypto, weather, WHO health, ...) must refresh from the heartbeat
// registry, which is dispatched on the idle, low-memory and normal governor paths, not from the
// governorTick body (skipped while idle / memory-paused, so WHO health stayed "not_fetched_yet").
// Cadence must match the old REALTIME_DATA slot so upstream request rates do not go up.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../server.js", import.meta.url), "utf8");
const reg = src.match(/registerHeartbeat\("realtime-feeds",\s*\{([\s\S]*?)\}\);/);

describe("realtime feeds on the heartbeat registry", () => {
  it("is registered every 5th tick (old REALTIME_DATA cadence), not cpu-class", () => {
    assert.ok(reg, "realtime-feeds heartbeat registered");
    assert.match(reg[1], /frequency:\s*5\b/);
    assert.match(src, /REALTIME_DATA:\s*5,/, "old slot was every 5th tick");
    assert.match(reg[1], /_runRealtimeFeeds\(/);
    assert.doesNotMatch(reg[1], /cost:\s*"cpu"/, "cpu-class entries are skipped on the idle path");
  });

  it("one tickRealTimeFeeds call site, outside governorTick", () => {
    assert.equal((src.match(/tickRealTimeFeeds\(STATE/g) || []).length, 1);
    const g = src.indexOf("async function governorTick(");
    assert.ok(g > 0);
    const fnEnd = src.indexOf("\nasync function ", g + 10);
    const body = src.slice(g, fnEnd > g ? fnEnd : g + 80000);
    assert.ok(!body.includes("tickRealTimeFeeds("), "not inside governorTick");
    assert.ok(!/_tick % TICK_FREQUENCIES\.REALTIME_DATA/.test(body), "old busy-only slot removed");
  });

  it("re-entrancy guard and a single boot run at tick 0", () => {
    const fn = src.slice(src.indexOf("function _runRealtimeFeeds("), src.indexOf('registerHeartbeat("realtime-feeds"'));
    assert.match(fn, /if \(_realtimeFeedsRunning\) return;/);
    assert.match(fn, /\.finally\(\(\) => \{ _realtimeFeedsRunning = false; \}\)/);
    assert.match(fn, /const tick = _realtimeFeedsFirstRunDone \? tickCount : 0;/);
    assert.match(fn, /_realtimeFeedsFirstRunDone = true;/);
  });

  it("schedule: same per-feed fire count as the old busy path over 1000 ticks (+1 boot run)", () => {
    // Old: governorTick ran tickRealTimeFeeds(_tick) when _tick % 5 === 0 (only when busy).
    // New: registry runs it when tickCount % 5 === 0 on every path; first run passes 0.
    const everyTicks = { finance: 5, news: 10, weather: 20, research: 100, health: 100, economy: 200 };
    for (const [feed, every] of Object.entries(everyTicks)) {
      let oldFires = 0, newFires = 0, first = true;
      for (let t = 1; t <= 1000; t++) {
        if (t % 5 !== 0) continue;
        if (t % every === 0) oldFires++;
        const tick = first ? 0 : t; first = false;
        if (tick % every === 0) newFires++;
      }
      assert.ok(newFires <= oldFires + 1, `${feed}: ${newFires} vs ${oldFires}`);
      assert.ok(newFires >= oldFires, `${feed}: no fewer refreshes`);
    }
  });
});
