// INC-100c: event_loop_lag_spike must name the heartbeat module that was running
// when the loop stalled. Before this, a sync stall after an await inside an async
// heartbeat (corpus-ingest-cycle et al.) was logged culprit "unattributed" with no
// heartbeat context, so ~hourly / ~30-min 3.6–5 s spikes could not be pinned.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as P from "../lib/presence-idle.js";
import { registerHeartbeat, runHeartbeatModuleNow, _resetHeartbeatRegistry } from "../emergent/heartbeat-registry.js";

const spin = (ms) => { const t = Date.now(); while (Date.now() - t < ms) { /* block the loop */ } };

beforeEach(() => { P._resetLagAttributionForTest(); _resetHeartbeatRegistry(); });

describe("INC-100c heartbeat lag attribution", () => {
  it("lists a heartbeat whose post-await sync work blocked the loop", async () => {
    registerHeartbeat("fake-ingest", { frequency: 1, scope: "global", handler: async () => {
      await new Promise((r) => setTimeout(r, 5)); // like a fetch resolving
      spin(120);                                  // sync DB loop after the await
    } });
    registerHeartbeat("fast-one", { frequency: 1, scope: "global", handler: () => 1 });
    await runHeartbeatModuleNow("fast-one", { state: {}, db: null });
    await runHeartbeatModuleNow("fake-ingest", { state: {}, db: null });
    const a = P.getLagCulprit({ windowMs: 30_000, stallMs: 120 });
    assert.ok(Array.isArray(a.heartbeats));
    assert.equal(a.heartbeats.length, 1, JSON.stringify(a.heartbeats));
    assert.match(a.heartbeats[0], /^fake-ingest \(\d+ms\)$/);
    // existing contract unchanged
    assert.ok("culprit" in a && "candidates" in a);
  });

  it("reports a still-running heartbeat as running", async () => {
    P.noteHeartbeatStart("slow-cycle", Date.now() - 4000);
    const a = P.getLagCulprit({ windowMs: 30_000, stallMs: 4000 });
    assert.match(a.heartbeats[0], /^slow-cycle \(running \d+ms\)$/);
    P.noteHeartbeatEnd("slow-cycle");
    const b = P.getLagCulprit({ windowMs: 30_000, stallMs: 4000 });
    assert.match(b.heartbeats[0], /^slow-cycle \(\d+ms\)$/);
  });

  it("drops spans that ended before the window and sub-50ms spans", () => {
    const now = Date.now();
    P.noteHeartbeatStart("old", now - 200_000); P.noteHeartbeatEnd("old", now - 120_000);
    P.noteHeartbeatStart("tiny", now - 10); P.noteHeartbeatEnd("tiny", now);
    assert.deepEqual(P.getLagCulprit({ windowMs: 30_000, stallMs: 3000, now }).heartbeats, []);
  });

  it("records a span even when the handler throws", async () => {
    registerHeartbeat("boom", { frequency: 1, scope: "global", handler: async () => { spin(80); throw new Error("x"); } });
    const r = await runHeartbeatModuleNow("boom", { state: {}, db: null });
    assert.equal(r.ok, true);
    assert.match(P.getLagCulprit({ windowMs: 30_000, stallMs: 80 }).heartbeats[0] || "", /^boom \(/);
  });
});
