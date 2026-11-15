// FIX-goddess-001 — a stream that heartbeats but never answers must
// still end: the turn has to reach a return or a visible error.
//
// Pristine, the send path's only watchdog was idle-stall (45s without
// bytes). The proxy's 15s SSE heartbeats are bytes, so they re-armed
// it forever: no done event, no error, the fallback POST and the
// saved-reply recovery unreachable — "Working on it" without end.
//
// Pins: createStreamDeadline's two clocks (behavioural, short real
// timers) + the panel wiring (source). Run:
// node --experimental-strip-types --test
// concord-frontend/tests/chat-stream-deadline-goddess-001.test.ts
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createStreamDeadline } from "../lib/chat/stream-deadline.ts";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("createStreamDeadline", () => {
  it("a silent stream expires on the idle clock", async () => {
    let fired = 0;
    const d = createStreamDeadline({ idleMs: 30, totalMs: 5000, onExpire: () => { fired += 1; } });
    d.start();
    await sleep(90);
    assert.equal(fired, 1);
    d.stop();
  });

  it("heartbeat beats reset idle but never the total: the turn still expires", async () => {
    let fired = 0;
    const d = createStreamDeadline({ idleMs: 40, totalMs: 110, onExpire: () => { fired += 1; } });
    d.start();
    const beater = setInterval(() => d.beat(), 10); // heartbeat bytes every 10ms
    await sleep(70);
    assert.equal(fired, 0, "heartbeats hold the idle clock off");
    await sleep(90); // past the 110ms total
    assert.equal(fired, 1, "the total deadline ends the turn anyway");
    clearInterval(beater);
    d.stop();
  });

  it("expiry fires exactly once; stop() disarms both clocks", async () => {
    let fired = 0;
    const d = createStreamDeadline({ idleMs: 20, totalMs: 30, onExpire: () => { fired += 1; } });
    d.start();
    await sleep(80);
    assert.equal(fired, 1);

    let fired2 = 0;
    const d2 = createStreamDeadline({ idleMs: 20, totalMs: 30, onExpire: () => { fired2 += 1; } });
    d2.start();
    d2.stop();
    await sleep(80);
    assert.equal(fired2, 0);
  });
});

describe("panel wiring", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../components/chat/ChatWorkspacePanel.tsx"), "utf8");
  it("the stream leg runs under a total deadline treated as a stall", () => {
    assert.ok(src.includes("const STREAM_TOTAL_MS = 120000;"));
    assert.ok(src.includes("createStreamDeadline({"));
    assert.ok(src.includes("totalMs: STREAM_TOTAL_MS"));
    assert.ok(src.includes("deadline.beat();"));
    assert.ok(src.includes("deadline.stop();"));
  });
});
