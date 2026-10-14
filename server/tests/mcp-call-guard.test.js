/**
 * POST /mcp/call admission guard (Option B).
 *
 * Pins: concurrency cap → busy_retry 503; under-cap / fast calls unchanged;
 * per-call duration logging (tool + durationMs). Interruption is intentionally
 * NOT claimed — macros have no AbortSignal path.
 *
 * Run: node --test server/tests/mcp-call-guard.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getMcpCallActiveCount,
  getMcpCallMaxConcurrent,
  runGuardedMcpCall,
  tryAcquireMcpCall,
  releaseMcpCall,
  _resetMcpCallGuardForTest,
  _setMcpCallLogSinkForTest,
} from "../lib/mcp-call-guard.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("mcp-call-guard (Option B admission)", () => {
  beforeEach(() => {
    _resetMcpCallGuardForTest();
  });
  afterEach(() => {
    _resetMcpCallGuardForTest();
  });

  it("defaults max concurrent to 8", () => {
    assert.equal(getMcpCallMaxConcurrent(), 8);
  });

  it("honors CONCORD_MCP_CALL_MAX_CONCURRENT", () => {
    process.env.CONCORD_MCP_CALL_MAX_CONCURRENT = "2";
    assert.equal(getMcpCallMaxConcurrent(), 2);
  });

  it("fast under-cap calls keep identical results and release the slot", async () => {
    process.env.CONCORD_MCP_CALL_MAX_CONCURRENT = "2";
    const logs = [];
    _setMcpCallLogSinkForTest((e) => logs.push(e));

    const out = await runGuardedMcpCall("lens_list", async () => ({ ok: true, tools: 3 }));
    assert.equal(out.admitted, true);
    assert.deepEqual(out.result, { ok: true, tools: 3 });
    assert.ok(typeof out.durationMs === "number" && out.durationMs >= 0);
    assert.equal(getMcpCallActiveCount(), 0);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].tool, "lens_list");
    assert.ok(logs[0].durationMs >= 0);
    assert.equal(logs[0].ok, true);
  });

  it("synthetic slow macros fill the cap; excess get busy_retry without running", async () => {
    process.env.CONCORD_MCP_CALL_MAX_CONCURRENT = "2";
    process.env.CONCORD_MCP_CALL_RETRY_AFTER_S = "3";

    let slowStarted = 0;
    let excessRan = 0;

    const slow = () => runGuardedMcpCall("incident_watch", async () => {
      slowStarted += 1;
      await sleep(80);
      return { ok: true, slow: true };
    });

    const p1 = slow();
    const p2 = slow();
    // Let both acquire before the third tries.
    await sleep(10);
    assert.equal(getMcpCallActiveCount(), 2);
    assert.equal(slowStarted, 2);

    const denied = await runGuardedMcpCall("incident_watch", async () => {
      excessRan += 1;
      return { ok: true };
    });
    assert.equal(denied.admitted, false);
    assert.equal(denied.status, 503);
    assert.equal(denied.retryAfterS, 3);
    assert.equal(denied.body.code, "busy_retry");
    assert.equal(denied.body.reason, "mcp_call_concurrency_cap");
    assert.equal(denied.body.retryAfterS, 3);
    assert.equal(excessRan, 0, "excess call must not invoke the body");

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1.admitted, true);
    assert.equal(r2.admitted, true);
    assert.deepEqual(r1.result, { ok: true, slow: true });
    assert.equal(getMcpCallActiveCount(), 0);

    // After release, a new call is admitted again.
    const again = await runGuardedMcpCall("reflect_search", async () => ({ ok: true, q: 1 }));
    assert.equal(again.admitted, true);
    assert.deepEqual(again.result, { ok: true, q: 1 });
  });

  it("logs duration even when the synthetic macro throws (slot still released)", async () => {
    process.env.CONCORD_MCP_CALL_MAX_CONCURRENT = "1";
    const logs = [];
    _setMcpCallLogSinkForTest((e) => logs.push(e));

    await assert.rejects(
      () => runGuardedMcpCall("boom_tool", async () => {
        await sleep(15);
        throw new Error("synthetic_fail");
      }),
      /synthetic_fail/,
    );
    assert.equal(getMcpCallActiveCount(), 0);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].tool, "boom_tool");
    assert.ok(logs[0].durationMs >= 10);
    assert.equal(logs[0].ok, false);
  });

  it("tryAcquire/release are symmetric at the hard cap", () => {
    process.env.CONCORD_MCP_CALL_MAX_CONCURRENT = "1";
    assert.equal(tryAcquireMcpCall().ok, true);
    const denied = tryAcquireMcpCall();
    assert.equal(denied.ok, false);
    assert.equal(denied.body.code, "busy_retry");
    releaseMcpCall();
    assert.equal(tryAcquireMcpCall().ok, true);
    releaseMcpCall();
    assert.equal(getMcpCallActiveCount(), 0);
  });
});
