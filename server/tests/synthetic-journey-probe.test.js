// E6 / C-L5 contract — the synthetic-journey probe.
// Pins: the authored first-cycle journey reaches `complete`, and the SSE
// transport streams incrementally (headers + heartbeat + multiple frames).

import { test } from "node:test";
import assert from "node:assert/strict";
import { runJourneyProbe, runSsePulseCheck, runSyntheticJourneyProbe } from "../lib/synthetic-journey-probe.js";

test("journey probe completes the authored first-cycle chain", () => {
  const r = runJourneyProbe();
  assert.equal(r.ok, true, `journey probe failed: ${r.error || ""}`);
  assert.equal(r.complete, true);
  assert.equal(r.currentPhase, "complete");
  assert.ok(r.phasesTotal >= 4, "first-cycle has at least the 4 base phases");
  assert.ok(r.durationMs >= 0);
});

test("SSE pulse check (self mode) proves incremental streaming + heartbeat", async () => {
  const r = await runSsePulseCheck();
  assert.equal(r.mode, "self");
  assert.equal(r.ok, true, `sse check failed: ${r.error || ""}`);
  assert.equal(r.headersOk, true, "the four proxy-chain headers must be set + flushed");
  assert.ok(r.heartbeats >= 2, `expected >=2 heartbeats, got ${r.heartbeats}`);
  assert.ok(r.frames >= 3, `expected >=3 event frames, got ${r.frames}`);
});

test("live SSE check degrades gracefully when there's no fetch", async () => {
  const r = await runSsePulseCheck({ baseUrl: "http://127.0.0.1:0", fetchImpl: undefined });
  // With a bogus base + no reachable server the probe must report, not throw.
  assert.equal(r.mode, "live");
  assert.equal(r.ok, false);
  assert.ok(typeof r.error === "string");
});

test("combined probe returns a structured verdict", async () => {
  const r = await runSyntheticJourneyProbe();
  assert.equal(typeof r.ok, "boolean");
  assert.equal(r.journey.ok, true);
  assert.equal(r.sse.ok, true);
  assert.ok(r.at > 0);
});
