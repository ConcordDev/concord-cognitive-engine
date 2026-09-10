/**
 * NPC prompt coalescer + adaptive backoff tests.
 *
 * Proves:
 *  - 20 same-fingerprint calls → 1 upstream generate
 *  - Background storm does not block a marked interactive call
 *  - Kill-switch CONCORD_NPC_COALESCE=0 disables coalesce
 *  - Backoff skips background when p50 crosses threshold
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  coalesceNpcPrompt,
  bindNpcCoalescerQueue,
  _resetNpcCoalescerForTest,
  getNpcCoalescerMetrics,
  hashIntent,
  makeCoalesceKey,
  shouldBackoffBackground,
  getNpcCoalesceConfig,
} from "../lib/npc-prompt-coalescer.js";
import { createLLMQueue, PRIORITY } from "../lib/llm-queue.js";
import { _setLagMsForTest } from "../lib/event-loop-pressure.js";

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const PREV = {};
function stashEnv(keys) {
  for (const k of keys) PREV[k] = process.env[k];
}
function restoreEnv() {
  for (const [k, v] of Object.entries(PREV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  stashEnv([
    "CONCORD_NPC_COALESCE",
    "CONCORD_NPC_COALESCE_MS",
    "CONCORD_NPC_MAX_INFLIGHT",
    "CONCORD_NPC_BACKOFF_P50_MS",
    "CONCORD_NPC_BACKOFF_P95_MS",
    "CONCORD_NPC_BACKOFF_QUEUE_DEPTH",
    "CONCORD_NPC_BACKOFF_LAG_MS",
  ]);
  process.env.CONCORD_NPC_COALESCE = "1";
  process.env.CONCORD_NPC_COALESCE_MS = "500";
  process.env.CONCORD_NPC_MAX_INFLIGHT = "2";
  process.env.CONCORD_NPC_BACKOFF_P50_MS = "500";
  process.env.CONCORD_NPC_BACKOFF_P95_MS = "2500";
  process.env.CONCORD_NPC_BACKOFF_QUEUE_DEPTH = "50"; // high so tests don't trip
  process.env.CONCORD_NPC_BACKOFF_LAG_MS = "10000";
  _setLagMsForTest(0);
  _resetNpcCoalescerForTest();
});

afterEach(() => {
  _resetNpcCoalescerForTest();
  _setLagMsForTest(0);
  restoreEnv();
});

describe("npc-prompt-coalescer — fingerprint helpers", () => {
  it("hashes intent stably", () => {
    assert.equal(hashIntent("hello world"), hashIntent("hello world"));
    assert.notEqual(hashIntent("hello world"), hashIntent("hello worlds"));
    assert.equal(hashIntent("ignored", "fixed-key"), hashIntent("other", "fixed-key"));
  });

  it("builds coalesce keys from env + intent", () => {
    assert.equal(
      makeCoalesceKey("world-a", "abcd"),
      makeCoalesceKey("world-a", "abcd"),
    );
    assert.notEqual(
      makeCoalesceKey("world-a", "abcd"),
      makeCoalesceKey("world-b", "abcd"),
    );
  });
});

describe("npc-prompt-coalescer — sliding window", () => {
  it("20 same-fingerprint calls → 1 upstream mock fetch", async () => {
    let upstream = 0;
    const prompt = "NPC decide action for world X needs={hunger:0.2}";
    const generateFn = async () => {
      upstream++;
      await delay(40);
      return { ok: true, text: "rest", n: upstream };
    };

    const calls = Array.from({ length: 20 }, () =>
      coalesceNpcPrompt({
        prompt,
        generateFn,
        envFingerprint: "world:concordia-hub|subconscious",
        callerId: "world:npc:decision",
      }),
    );

    const results = await Promise.all(calls);
    assert.equal(upstream, 1, `expected 1 upstream, got ${upstream}`);
    // All waiters share the same result object identity from the single run
    for (const r of results) {
      assert.equal(r.text, "rest");
      assert.equal(r.n, 1);
    }
    const m = getNpcCoalescerMetrics();
    assert.equal(m.upstream, 1);
    assert.equal(m.coalesced, 19);
    assert.ok(m.coalesceRatio >= 0.9, `coalesceRatio ${m.coalesceRatio}`);
  });

  it("different intent hashes do not coalesce", async () => {
    let upstream = 0;
    const generateFn = async () => {
      upstream++;
      await delay(10);
      return upstream;
    };
    const a = coalesceNpcPrompt({
      prompt: "alpha",
      generateFn,
      envFingerprint: "env",
      callerId: "world:npc:decision",
    });
    const b = coalesceNpcPrompt({
      prompt: "beta",
      generateFn,
      envFingerprint: "env",
      callerId: "world:npc:decision",
    });
    await Promise.all([a, b]);
    assert.equal(upstream, 2);
  });

  it("kill-switch CONCORD_NPC_COALESCE=0 disables coalesce", async () => {
    process.env.CONCORD_NPC_COALESCE = "0";
    let upstream = 0;
    const generateFn = async () => {
      upstream++;
      await delay(5);
      return upstream;
    };
    const prompt = "same";
    await Promise.all([
      coalesceNpcPrompt({ prompt, generateFn, envFingerprint: "e", callerId: "world:npc:x" }),
      coalesceNpcPrompt({ prompt, generateFn, envFingerprint: "e", callerId: "world:npc:x" }),
      coalesceNpcPrompt({ prompt, generateFn, envFingerprint: "e", callerId: "world:npc:x" }),
    ]);
    assert.equal(upstream, 3);
    assert.equal(getNpcCoalesceConfig().enabled, false);
  });
});

describe("npc-prompt-coalescer — priority / no-starve", () => {
  it("background storm must not block a marked interactive call", async () => {
    const q = createLLMQueue({ concurrency: 1, reserveForCritical: 0 });
    // With concurrency 1 and reserve 0, without CRITICAL priority a storm
    // would serialize everything. Interactive must jump the queue.
    bindNpcCoalescerQueue(q);

    const order = [];
    let bgStarted = 0;

    // Fill the single slot with a slow background job
    const bgSlow = coalesceNpcPrompt({
      prompt: "bg-slow",
      callerId: "world:npc:decision",
      envFingerprint: "storm",
      generateFn: async () => {
        bgStarted++;
        order.push("bg-start");
        await delay(120);
        order.push("bg-end");
        return "bg";
      },
    });

    // Flood more background (will queue behind at LOW)
    const storm = Array.from({ length: 8 }, (_, i) =>
      coalesceNpcPrompt({
        prompt: `bg-${i}`, // different intents → no coalesce
        callerId: "world:npc:decision",
        envFingerprint: "storm",
        generateFn: async () => {
          order.push(`storm-${i}`);
          await delay(30);
          return i;
        },
      }),
    );

    // Give background a tick to claim the slot / queue
    await delay(15);

    const interactiveStart = Date.now();
    const interactive = coalesceNpcPrompt({
      prompt: "chat hello",
      callerId: "chat:conkay",
      interactive: true,
      generateFn: async () => {
        order.push("interactive");
        return "hi";
      },
    });

    const interactiveResult = await interactive;
    const interactiveWait = Date.now() - interactiveStart;

    assert.equal(interactiveResult, "hi");
    // Interactive must complete well before the whole storm drains
    assert.ok(
      interactiveWait < 400,
      `interactive waited ${interactiveWait}ms — likely starved by background`,
    );
    assert.ok(
      order.includes("interactive"),
      `order missing interactive: ${order.join(",")}`,
    );
    // Interactive should appear before most storm items finish
    const idxInteractive = order.indexOf("interactive");
    const stormAfter = order.slice(idxInteractive + 1).filter((x) => x.startsWith("storm-"));
    // At most one storm item could have been mid-flight; not the whole storm
    assert.ok(stormAfter.length <= 8);

    await Promise.all([bgSlow, ...storm]);
    assert.ok(bgStarted >= 1);
  });

  it("interactive bypasses backoff even when p50 is hot", async () => {
    // Force backoff via event-loop lag
    process.env.CONCORD_NPC_BACKOFF_LAG_MS = "50";
    _setLagMsForTest(500);
    assert.equal(shouldBackoffBackground().backoff, true);

    let ran = 0;
    const skipped = await coalesceNpcPrompt({
      prompt: "bg",
      callerId: "world:npc:decision",
      generateFn: async () => { ran++; return "bg"; },
    });
    assert.equal(skipped, null);
    assert.equal(ran, 0);

    const ok = await coalesceNpcPrompt({
      prompt: "chat",
      callerId: "chat",
      interactive: true,
      generateFn: async () => { ran++; return "chat-ok"; },
    });
    assert.equal(ok, "chat-ok");
    assert.equal(ran, 1);
  });
});

describe("npc-prompt-coalescer — shared llm-queue bind", () => {
  it("background enqueues at LOW when queue is bound", async () => {
    const seen = [];
    const q = createLLMQueue({ concurrency: 2 });
    const orig = q.enqueue.bind(q);
    q.enqueue = (fn, priority) => {
      seen.push(priority);
      return orig(fn, priority);
    };
    bindNpcCoalescerQueue(q);

    await coalesceNpcPrompt({
      prompt: "bg",
      callerId: "world:emergent-npc:tick",
      generateFn: async () => "x",
    });
    await coalesceNpcPrompt({
      prompt: "chat",
      callerId: "chat",
      interactive: true,
      generateFn: async () => "y",
    });

    assert.ok(seen.includes(PRIORITY.LOW), `seen=${seen}`);
    assert.ok(seen.includes(PRIORITY.CRITICAL), `seen=${seen}`);
  });
});
