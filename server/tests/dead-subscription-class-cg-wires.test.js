// server/tests/dead-subscription-class-cg-wires.test.js
//
// Contract tests for the three Class-C / Class-G dead socket subscriptions
// that resolved to WIRE per docs/DEAD_SUBSCRIPTION_AUDIT.md — events whose
// backend substrate was fully real and only the realtime push was missing:
//
//   • chat:tool_result   <- lib/chat/tool-result-events.js, emitted by the
//                           chat socket handler after chat.respond returns
//   • promotion:rejected <- emergent/promotion-pipeline.js#rejectPromotion
//   • boss:phase-enter   <- lib/combat/boss-hud.js#bossPhaseEnterPayload,
//                           emitted by routes/worlds.js /combat/attack
//
// Unlike the Class-A pair (tests/dead-subscription-wires.test.js), where the
// listeners use useRealtimeRefresh and DISCARD the payload, all three of these
// listeners READ SPECIFIC FIELDS. So the load-bearing assertions here are about
// PAYLOAD SHAPE: a wired emit with the wrong field names is a new contract bug,
// not a fix. Each describe block names the exact frontend line it pins.
//
// Run: node --test server/tests/dead-subscription-class-cg-wires.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildChatToolResultEvents,
  formatChatToolResultText,
} from "../lib/chat/tool-result-events.js";
import { computeBossState, bossPhaseEnterPayload } from "../lib/combat/boss-hud.js";
import { createBossPhases } from "../lib/combat/boss-phases.js";
import { requestPromotion, rejectPromotion, approvePromotion } from "../emergent/promotion-pipeline.js";

// ── chat:tool_result ─────────────────────────────────────────────────────
//
// Listener: concord-frontend/components/chat/PersistentChatRail.tsx#handleToolResult
//   const d = data as { tool: string; result: string; ok: boolean; sessionId: string };
//   if (d.sessionId !== sessionId) return;
//   content: `🔧 ${d.tool}: ${d.ok ? d.result : `Error: ${d.result}`}`

describe("chat:tool_result — payload matches what the chat rail reads", () => {
  it("emits exactly the four fields the rail destructures, one per tool call", () => {
    const events = buildChatToolResultEvents(
      { toolCalls: [
        { tool: "web_search", ok: true, result: "3 results for foo" },
        { tool: "run_compute", ok: true, key: "math", result: { value: 42 } },
      ] },
      "sess-1",
    );
    assert.equal(events.length, 2, "one event per executed tool call");
    for (const ev of events) {
      assert.deepEqual(
        Object.keys(ev).sort(),
        ["ok", "result", "sessionId", "tool"],
        "payload keys must be exactly what the rail destructures",
      );
      assert.equal(ev.sessionId, "sess-1", "the rail drops any event whose sessionId differs");
      assert.equal(typeof ev.tool, "string");
      assert.equal(typeof ev.ok, "boolean");
      assert.equal(typeof ev.result, "string", "the rail string-interpolates `result`");
    }
    assert.equal(events[0].tool, "web_search");
    assert.equal(events[0].result, "3 results for foo");
  });

  it("emits nothing when the turn ran no tools", () => {
    assert.deepEqual(buildChatToolResultEvents({ reply: "hi" }, "s"), []);
    assert.deepEqual(buildChatToolResultEvents({ toolCalls: [] }, "s"), []);
    assert.deepEqual(buildChatToolResultEvents(undefined, "s"), []);
  });

  it("never emits a non-string `result` — an object would render as [object Object]", () => {
    // run_compute / run_lens_action return structured results.
    const [ev] = buildChatToolResultEvents(
      { toolCalls: [{ tool: "run_lens_action", ok: true, result: { ok: true, rows: [1, 2] } }] },
      "s",
    );
    assert.equal(typeof ev.result, "string");
    assert.equal(ev.result, '{"ok":true,"rows":[1,2]}');
    assert.ok(!ev.result.includes("[object Object]"));
  });

  it("puts the error message in `result` on failure — the rail renders that field as the error", () => {
    const [ev] = buildChatToolResultEvents(
      { toolCalls: [{ tool: "browse_url", ok: false, error: "404 Not Found" }] },
      "s",
    );
    assert.equal(ev.ok, false);
    assert.equal(ev.result, "404 Not Found", "rail prints `Error: ${d.result}`");
  });

  it("falls back to sibling fields for tools whose result is null", () => {
    // browse_url / create_dtu carry their payload in title/url/key, not result.
    assert.equal(
      formatChatToolResultText({ tool: "browse_url", ok: true, result: null, title: "Example Page" }),
      "Example Page",
    );
    assert.equal(
      formatChatToolResultText({ tool: "create_dtu", ok: true, result: null, key: "dtu_9" }),
      "dtu_9",
    );
    assert.equal(formatChatToolResultText({ tool: "x", ok: true, result: null }), "ok");
  });

  it("truncates a huge tool result so one call can't flood the rail", () => {
    const big = { blob: "x".repeat(50_000) };
    const [ev] = buildChatToolResultEvents({ toolCalls: [{ tool: "t", ok: true, result: big }] }, "s");
    assert.ok(ev.result.length <= 2000, `expected <=2000 chars, got ${ev.result.length}`);
  });
});

// ── promotion:rejected ───────────────────────────────────────────────────
//
// Listener: concord-frontend/hooks/useSocket.ts
//   case 'promotion:approved':
//   case 'promotion:rejected':
//     if (d.id) { useSovereignStore.getState().updatePromotion(d.id, data); }
//
// The `id` gate is the whole reason this block exists: an emit without `id`
// is silently a no-op on the client.

describe("promotion:rejected — fires on a real rejection with the field the store keys on", () => {
  let emits;
  let priorEmit;
  let priorState;

  beforeEach(() => {
    emits = [];
    priorEmit = globalThis.realtimeEmit;
    globalThis.realtimeEmit = (event, payload) => { emits.push({ event, payload }); };
    // The pipeline resolves items out of the shared STATE the server stashes
    // on globalThis; seed a minimal one rather than booting the server.
    priorState = globalThis._concordSTATE;
    globalThis._concordSTATE = { dtus: new Map() };
  });

  afterEach(() => {
    if (priorEmit === undefined) delete globalThis.realtimeEmit;
    else globalThis.realtimeEmit = priorEmit;
    if (priorState === undefined) delete globalThis._concordSTATE;
    else globalThis._concordSTATE = priorState;
  });

  function openProposal(itemId) {
    // Stage `regional` gates on regional_council, so the proposal stays
    // PENDING instead of taking requestPromotion's author_only auto-approve
    // branch — which is what makes the rejection path genuinely reachable.
    globalThis._concordSTATE.dtus.set(itemId, {
      id: itemId,
      title: `Test DTU ${itemId}`,
      _promotionStage: "regional",
      _useCount: 10,
      _lastValidation: { valid: true, violations: [] },
    });
    const r = requestPromotion(itemId, "dtu", "u1");
    assert.equal(r.ok, true, `requestPromotion failed: ${JSON.stringify(r)}`);
    // Status is gate-qualified ("pending_regional_council"); what matters is
    // that it did NOT take the author_only auto-approve branch.
    assert.match(r.proposal.status, /^pending/, "must not have auto-approved");
    return r.proposal;
  }

  it("emits promotion:rejected carrying `id` (the field the listener gates on)", () => {
    const proposal = openProposal("dtu-rej-1");
    emits = []; // ignore anything the request path emitted

    const r = rejectPromotion(proposal.id, "insufficient sourcing", "sovereign");
    assert.equal(r.ok, true);

    const evs = emits.filter((e) => e.event === "promotion:rejected");
    assert.equal(evs.length, 1, "exactly one promotion:rejected emit");
    const p = evs[0].payload;
    assert.equal(p.id, proposal.id, "`id` must be present — the client no-ops without it");
    assert.equal(p.proposalId, proposal.id, "and stays consistent with the approved sibling");
    assert.equal(p.itemId, "dtu-rej-1");
    assert.equal(p.itemType, "dtu");
    assert.equal(p.status, "rejected");
    assert.equal(p.reason, "insufficient sourcing");
  });

  it("supplies a reason string even when the caller passed none", () => {
    const proposal = openProposal("dtu-rej-2");
    emits = [];
    rejectPromotion(proposal.id);
    const p = emits.find((e) => e.event === "promotion:rejected").payload;
    assert.equal(typeof p.reason, "string");
    assert.ok(p.reason.length > 0);
  });

  it("does NOT emit for an unknown or already-resolved proposal", () => {
    assert.equal(rejectPromotion("promo-does-not-exist", "x").ok, false);
    assert.equal(emits.filter((e) => e.event === "promotion:rejected").length, 0);

    const proposal = openProposal("dtu-rej-3");
    assert.equal(rejectPromotion(proposal.id, "first").ok, true);
    emits = [];
    assert.equal(rejectPromotion(proposal.id, "second").ok, false, "already rejected");
    assert.equal(
      emits.filter((e) => e.event === "promotion:rejected").length, 0,
      "a rejected double-reject must not re-emit",
    );
  });

  it("an approved proposal emits only the approved half, never the rejected one", () => {
    const proposal = openProposal("dtu-rej-4");
    emits = [];
    approvePromotion(proposal.id, "sovereign");
    assert.equal(emits.filter((e) => e.event === "promotion:rejected").length, 0);
  });

  it("a realtime failure does not fail the rejection itself", () => {
    const proposal = openProposal("dtu-rej-5");
    globalThis.realtimeEmit = () => { throw new Error("socket down"); };
    const r = rejectPromotion(proposal.id, "still rejected");
    assert.equal(r.ok, true, "the rejection must land even if the push throws");
    assert.equal(r.rejected, true);
  });
});

// ── boss:phase-enter ─────────────────────────────────────────────────────
//
// Listener: concord-frontend/components/world/EmergentEventFeed.tsx TRACKED_EVENTS
//   { name: 'boss:phase-enter', channel: 'crisis', label: 'World boss phase' }
// whose detail extractor reads, in order:
//   text | message, then npcName | entityName | title | kind | eventType |
//   weather | condition, then worldId | districtId | cityId.
// There is NO `name` case — so the boss's display name must ship as `npcName`.

describe("boss:phase-enter — fires once per real phase transition", () => {
  // The exact pack domains/spawn.js installs, most-restrictive-first.
  const spawnPhases = () => createBossPhases({
    bossId: "boss_1",
    phases: [
      { name: "death-throes", when: (m) => m.hpPct <= 0.25, scaling: { damage: 1.6 } },
      { name: "enraged-2", when: (m) => m.hpPct <= 0.50, scaling: { damage: 1.4 } },
      { name: "enraged-1", when: (m) => m.hpPct <= 0.75, scaling: { damage: 1.2 } },
    ],
  });

  const hit = (phases, hp) => computeBossState({
    npcId: "boss_1", worldId: "concordia-hub", name: "The Warden",
    currentHp: hp, maxHp: 1000, phases,
  });

  it("returns null while the boss stays in the same phase", () => {
    const phases = spawnPhases();
    assert.equal(bossPhaseEnterPayload(hit(phases, 800)), null, "above every threshold");
    hit(phases, 700); // enter enraged-1
    assert.equal(bossPhaseEnterPayload(hit(phases, 690)), null, "still enraged-1 — no new beat");
  });

  it("emits exactly one beat per threshold crossed, in order", () => {
    const phases = spawnPhases();
    const seen = [];
    for (const hp of [900, 800, 740, 700, 600, 480, 300, 240, 100]) {
      const p = bossPhaseEnterPayload(hit(phases, hp));
      if (p) seen.push(p.phase);
    }
    assert.deepEqual(seen, ["enraged-1", "enraged-2", "death-throes"]);
  });

  it("carries the boss name as `npcName` — the field the feed's detail extractor reads", () => {
    const phases = spawnPhases();
    const p = bossPhaseEnterPayload(hit(phases, 700));
    assert.ok(p, "70% hp must cross into enraged-1");
    assert.deepEqual(
      Object.keys(p).sort(),
      ["hpPct", "npcId", "npcName", "phase", "worldId"],
    );
    assert.equal(p.npcName, "The Warden");
    assert.equal(p.worldId, "concordia-hub", "world-room scoped, not a global broadcast");
    assert.equal(p.npcId, "boss_1");
    assert.equal(p.phase, "enraged-1");
    assert.equal(p.hpPct, 0.7);
    assert.equal(p.name, undefined, "the feed has no `name` case — it must be npcName");
  });

  it("falls back to the archetype for the name, like the HUD payload does", () => {
    const phases = spawnPhases();
    const state = computeBossState({
      npcId: "b", worldId: "w", archetype: "ruin_warden",
      currentHp: 100, maxHp: 1000, phases,
    });
    assert.equal(bossPhaseEnterPayload(state).npcName, "ruin_warden");
  });

  it("returns null for a non-boss hit (no phase machine at all)", () => {
    const state = computeBossState({ npcId: "grunt", worldId: "w", currentHp: 10, maxHp: 100 });
    assert.equal(bossPhaseEnterPayload(state), null);
    assert.equal(bossPhaseEnterPayload(null), null);
  });
});
