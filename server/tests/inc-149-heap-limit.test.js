// INC-149 — the watchdog and /health must use the REAL V8 heap ceiling.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import v8 from "node:v8";
import { getHeapLimitMB, getMemorySnapshot } from "../lib/heap-limit.js";

const realMB = Math.round(v8.getHeapStatistics().heap_size_limit / 1048576);

describe("INC-149 heap limit", () => {
  it("defaults to V8 heap_size_limit when MAX_OLD_SPACE_SIZE is unset", () => {
    assert.equal(getHeapLimitMB({}), realMB);
  });
  it("ignores an env value ABOVE the real ceiling (would hide pressure)", () => {
    assert.equal(getHeapLimitMB({ MAX_OLD_SPACE_SIZE: String(realMB * 10) }), realMB);
  });
  it("honours an env value BELOW the real ceiling (earlier shedding)", () => {
    const lower = Math.max(1, Math.floor(realMB / 2));
    assert.equal(getHeapLimitMB({ MAX_OLD_SPACE_SIZE: String(lower) }), lower);
  });
  it("ignores junk env values", () => {
    assert.equal(getHeapLimitMB({ MAX_OLD_SPACE_SIZE: "lots" }), realMB);
  });
  it("snapshot reports rss/heap/limit/pct", () => {
    const m = getMemorySnapshot();
    for (const k of ["rssMB", "heapUsedMB", "heapTotalMB", "externalMB", "arrayBuffersMB", "heapLimitMB", "heapUsedPct"]) {
      assert.equal(typeof m[k], "number", k);
    }
    assert.ok(m.heapUsedPct > 0 && m.heapUsedPct < 100);
    assert.ok(m.rssMB >= m.heapUsedMB / 2);
  });
});

describe("INC-149 memory census", () => {
  it("reports the biggest STATE collections and real memory", async () => {
    const { memoryCensus } = await import("../lib/memory-pressure.js");
    const STATE = { dtus: new Map([[1, 1], [2, 2], [3, 3]]), logs: [1, 2], ingestLens: { webhooks: new Map([[1, 1]]) }, n: 5 };
    const c = memoryCensus(STATE, 5);
    assert.equal(c.top.dtus, 3);
    assert.equal(c.top.logs, 2);
    assert.equal(c.top["ingestLens.webhooks"], 1);
    assert.equal(typeof c.heapLimitMB, "number");
  });
});
