// Pins that the live drift probe reports the block's CPU/page-fault/GC detail.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../server.js"), "utf8");

describe("event_loop_block carries its attribution", () => {
  it("imports the sampler and ticks it on every drift tick before the early returns", () => {
    assert.ok(src.includes('import { createLoopBlockSampler } from "./lib/loop-block-attribution.js";'));
    const tick = src.indexOf("_blockSampler.tick();");
    const early = src.indexOf("if (!Number.isFinite(blockedMs) || blockedMs < _DRIFT_THRESHOLD_MS) return;");
    assert.ok(tick > 0 && early > tick, "tick() must run on every probe tick, not only on blocks");
  });
  it("describeBlock is read before tick() overwrites the previous sample, and spread into the log", () => {
    const desc = src.indexOf("_blockSampler.describeBlock(blockedMs)");
    assert.ok(desc > 0 && desc < src.indexOf("_blockSampler.tick();"));
    assert.ok(src.includes("...(_blockDetail || {}),"));
  });
  it("slow sync fs calls are wrapped before any other import and reach the block log", () => {
    const first = src.search(/^import /m);
    assert.ok(src.slice(first).startsWith('import { installSlowSyncIoOnce'), "slow-sync-io wraps node:fs before later modules bind it");
    const imp = src.indexOf('import { installSlowSyncIoOnce, installSlowNativeOnce, setSlowSyncIoReporter, slowSyncIoSince } from "./lib/slow-sync-io.js";');
    assert.ok(imp > 0 && imp < src.indexOf('import expressRateLimit'));
    assert.ok(src.includes('structuredLog("warn", "slow_sync_io"'));
    const blk = src.indexOf('structuredLog("warn", "event_loop_block"');
    assert.ok(src.indexOf("slowSyncIoSince(now - blockedMs", 0) > 0 && src.indexOf("slowSyncIoSince(now - blockedMs") < blk);
    assert.ok(src.includes("syncIo: _syncIo"));
  });
});
