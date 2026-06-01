/**
 * Contract test for the SSE hardening helper (SSE Streaming Hardening spec).
 * Pins the four proxy-chain-critical headers + the heartbeat + close cleanup.
 *
 * Run: node --test server/tests/sse.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { startSSE } from "../lib/sse.js";

// Minimal Express-response stub.
function mockRes() {
  const headers = {};
  const writes = [];
  const listeners = {};
  return {
    headers, writes,
    setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
    flushHeaders: () => { mockRes._flushed = true; },
    write: (s) => { writes.push(s); return true; },
    on: (ev, fn) => { listeners[ev] = fn; },
    _fire: (ev) => listeners[ev]?.(),
  };
}

describe("startSSE", () => {
  it("sets the four proxy-chain-critical headers", () => {
    const res = mockRes();
    const stop = startSSE(res);
    assert.equal(res.headers["content-type"], "text/event-stream");
    assert.equal(res.headers["cache-control"], "no-cache, no-transform"); // CF: no-transform
    assert.equal(res.headers["connection"], "keep-alive");
    assert.equal(res.headers["x-accel-buffering"], "no");                 // nginx: no buffer
    stop();
  });

  it("emits a heartbeat comment on the configured interval, then stops on close", async () => {
    const res = mockRes();
    startSSE(res, { heartbeatMs: 10 });
    await new Promise((r) => { setTimeout(r, 35); });
    const beats = res.writes.filter((w) => w === ":keepalive\n\n").length;
    assert.ok(beats >= 2, `expected heartbeats, got ${beats}`);
    res._fire("close"); // client disconnects → heartbeat must stop
    const after = res.writes.length;
    await new Promise((r) => { setTimeout(r, 25); });
    assert.equal(res.writes.length, after, "heartbeat kept firing after close");
  });

  it("returned stop() halts the heartbeat", async () => {
    const res = mockRes();
    const stop = startSSE(res, { heartbeatMs: 10 });
    stop();
    const n = res.writes.length;
    await new Promise((r) => { setTimeout(r, 30); });
    assert.equal(res.writes.length, n);
  });

  it("never throws when write fails (connection already closed)", () => {
    const res = mockRes();
    res.write = () => { throw new Error("EPIPE"); };
    assert.doesNotThrow(() => {
      const stop = startSSE(res, { heartbeatMs: 1 });
      stop();
    });
  });
});
