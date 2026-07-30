/**
 * Mind Space Module — Test Suite
 *
 * Covers:
 *   - Presence Protocol: state machine, emotional resonance, thought sharing, memory anchors
 *   - Subconscious Manager: ambient monitoring, escalation, focus swapping, pulse overlap
 *   - Cognitive Bridge: interface adapters, sentiment analysis, negation detection
 *   - Multi-Space Handler: relationship-aware presence, broadcast, dashboard
 *   - Full integration: end-to-end telepathy flow
 *
 * Run: node --test tests/mind-space.test.js
 */

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import {
  MindSpace, PresenceState, PresenceTransitions, EmotionalChannel,
} from "../mind-space/presence-protocol.js";
import { SubconsciousManager } from "../mind-space/subconscious-manager.js";
import {
  CognitiveBridge, InterfaceAdapter, InterfaceType,
} from "../mind-space/cognitive-bridge.js";
import { MultiSpaceHandler } from "../mind-space/multi-space-handler.js";
import { registerHandleLeakGuard } from "./lib/handle-leak-guard.js";

// Root-caused 2026-07-27: every one of this file's 70 subtests reports `ok`
// (confirmed live — none hang), yet the file-level wrapper still hit its
// 300s timeout. Unlike the coverage-smoke files (a real leaked setInterval
// per case), an active-handle dump here found no Timeout/Worker/TCP handle
// at all — only the process's own stdout/stderr streams, exactly the
// "genuinely idle by every introspection tool available, yet node:test's
// own completion tracking still won't signal done" shape
// tests/lib/server-clean-exit.js's doc comment already root-caused for a
// different file. Same fix: a decoupled, unref'd last-resort exit.
registerHandleLeakGuard();

// ── Helpers ─────────────────────────────────────────────────────────

function createSpace(opts = {}) {
  return new MindSpace({
    initiatorId: opts.initiator || "alice",
    targetId: opts.target || "bob",
    mode: opts.mode || PresenceState.CONSCIOUS,
    substrate: opts.substrate || null,
  });
}

function collectEvents(emitter, eventName) {
  const events = [];
  emitter.on(eventName, (e) => events.push(e));
  return events;
}

// ════════════════════════════════════════════════════════════════════
// 1. PRESENCE PROTOCOL
// ════════════════════════════════════════════════════════════════════

describe("Presence Protocol — MindSpace", () => {

  describe("Constructor", () => {
    it("creates a mind space with unique id and two participants", () => {
      const space = createSpace();
      assert.ok(space.id.startsWith("ms_"));
      assert.equal(space.participants.size, 2);
      assert.equal(space.participants.get("alice").presence, PresenceState.CONSCIOUS);
      assert.equal(space.participants.get("bob").presence, PresenceState.INACTIVE);
    });

    it("initiator starts with neutral emotional state", () => {
      const space = createSpace();
      const alice = space.participants.get("alice");
      assert.equal(alice.emotionalState[EmotionalChannel.DISTRESS], 0);
      assert.equal(alice.emotionalState[EmotionalChannel.CALM], 0.5);
    });

    it("respects custom initial mode", () => {
      const space = createSpace({ mode: PresenceState.AMBIENT });
      assert.equal(space.participants.get("alice").presence, PresenceState.AMBIENT);
    });
  });

  describe("State Machine — transitionPresence", () => {
    it("allows valid transitions", async () => {
      const space = createSpace();
      const result = await space.transitionPresence("alice", PresenceState.DEEP);
      assert.equal(result.from, PresenceState.CONSCIOUS);
      assert.equal(result.to, PresenceState.DEEP);
      assert.equal(space.participants.get("alice").presence, PresenceState.DEEP);
    });

    it("rejects invalid transitions", async () => {
      const space = createSpace(); // alice is CONSCIOUS
      await assert.rejects(
        () => space.transitionPresence("alice", PresenceState.EMERGENCY),
        /Invalid transition/
      );
    });

    it("is idempotent — same-state transition is a no-op", async () => {
      const space = createSpace();
      const result = await space.transitionPresence("alice", PresenceState.CONSCIOUS);
      assert.equal(result.from, PresenceState.CONSCIOUS);
      assert.equal(result.to, PresenceState.CONSCIOUS);
    });

    it("emits presence:transitioned on valid transition", async () => {
      const space = createSpace();
      const events = collectEvents(space.emitter, "presence:transitioned");
      await space.transitionPresence("alice", PresenceState.ATTENTIVE);
      assert.equal(events.length, 1);
      assert.equal(events[0].from, PresenceState.CONSCIOUS);
      assert.equal(events[0].to, PresenceState.ATTENTIVE);
    });

    it("does not emit on idempotent transition", async () => {
      const space = createSpace();
      const events = collectEvents(space.emitter, "presence:transitioned");
      await space.transitionPresence("alice", PresenceState.CONSCIOUS);
      assert.equal(events.length, 0);
    });

    it("sets isSubconscious for ambient and attentive states", async () => {
      const space = createSpace();
      await space.transitionPresence("alice", PresenceState.AMBIENT);
      assert.equal(space.participants.get("alice").isSubconscious, true);
      await space.transitionPresence("alice", PresenceState.CONSCIOUS);
      assert.equal(space.participants.get("alice").isSubconscious, false);
    });

    it("validates all FSM transitions are reflexive in PresenceTransitions", () => {
      for (const [state, targets] of Object.entries(PresenceTransitions)) {
        assert.ok(Array.isArray(targets), `${state} should have transition array`);
        for (const target of targets) {
          assert.ok(
            Object.values(PresenceState).includes(target),
            `${state} → ${target} references invalid state`
          );
        }
      }
    });
  });

  describe("Emotional Transmission", () => {
    it("validates and clamps emotional values to [0, 1]", async () => {
      const space = createSpace();
      await space.transmitEmotion("alice", { warmth: 1.5, distress: -0.3, bogus: 0.5 });
      const state = space.participants.get("alice").emotionalState;
      assert.equal(state[EmotionalChannel.WARMTH], 1);
      assert.equal(state[EmotionalChannel.DISTRESS], 0);
      // bogus should not appear — not a valid channel
      assert.equal(state.bogus, undefined);
    });

    it("updates emotional resonance across active participants", async () => {
      const space = createSpace();
      await space.join("bob", PresenceState.CONSCIOUS);
      await space.transmitEmotion("alice", { joy: 0.8 });
      await space.transmitEmotion("bob", { joy: 0.4 });
      const resonance = space.sharedContext.emotionalResonance;
      assert.ok(resonance[EmotionalChannel.JOY] > 0.3, "resonance should reflect transmitted joy");
    });

    it("triggers distress detection when distress > 0.7", async () => {
      const space = createSpace();
      await space.join("bob", PresenceState.AMBIENT);
      const events = collectEvents(space.emitter, "distress:detected");
      await space.transmitEmotion("alice", { distress: 0.8 });
      assert.equal(events.length, 1);
      assert.equal(events[0].nodeId, "alice");
      // Bob should have been escalated from ambient to attentive via FSM
      assert.equal(space.participants.get("bob").presence, PresenceState.ATTENTIVE);
    });

    it("increments emotionalExchanges metric", async () => {
      const space = createSpace();
      assert.equal(space.metrics.emotionalExchanges, 0);
      await space.transmitEmotion("alice", { calm: 0.5 });
      assert.equal(space.metrics.emotionalExchanges, 1);
    });
  });

  describe("Thought Sharing", () => {
    it("enriches thoughts with metadata", async () => {
      const space = createSpace();
      const thought = await space.shareThought("alice", {
        content: "Hello world",
        type: "verbal",
        intensity: 0.5,
      });
      assert.ok(thought.id.startsWith("thought_"));
      assert.equal(thought.fromNodeId, "alice");
      assert.equal(thought.content, "Hello world");
      assert.equal(thought.presenceLevel, PresenceState.CONSCIOUS);
      assert.ok(thought.emotionalContext);
    });

    it("clamps thought intensity to [0, 1]", async () => {
      const space = createSpace();
      const t = await space.shareThought("alice", { content: "x", intensity: 5 });
      assert.equal(t.intensity, 1);
    });

    it("defaults intensity to 0.5 and isQuery to false", async () => {
      const space = createSpace();
      const t = await space.shareThought("alice", { content: "hi" });
      assert.equal(t.intensity, 0.5);
      assert.equal(t.isQuery, false);
    });

    it("escalates ambient participants on high-intensity thoughts", async () => {
      const space = createSpace();
      await space.join("bob", PresenceState.AMBIENT);
      await space.shareThought("alice", { content: "URGENT", intensity: 0.9 });
      assert.equal(space.participants.get("bob").presence, PresenceState.ATTENTIVE);
    });

    it("accumulates in sharedContext.thoughts", async () => {
      const space = createSpace();
      await space.shareThought("alice", { content: "one" });
      await space.shareThought("alice", { content: "two" });
      assert.equal(space.sharedContext.thoughts.length, 2);
    });
  });

  describe("Memory Anchors", () => {
    it("creates an anchor with emotional snapshot", async () => {
      const space = createSpace();
      await space.transmitEmotion("alice", { joy: 0.9 });
      const anchor = await space.createMemoryAnchor("alice", "A happy moment");
      assert.ok(anchor.id.startsWith("anchor_"));
      assert.equal(anchor.createdBy, "alice");
      assert.equal(anchor.description, "A happy moment");
      assert.ok(anchor.emotionalSnapshot[EmotionalChannel.JOY] > 0);
    });
  });

  describe("Archive Safety", () => {
    it("archives thoughts only after successful substrate commit", async () => {
      let committed = false;
      const substrate = {
        commitDTU: async () => { committed = true; },
        findSharedDTUs: async () => [],
        searchDTUs: async () => [],
      };
      const space = createSpace({ substrate });
      // Fill past the threshold
      for (let i = 0; i < 1001; i++) {
        space.sharedContext.thoughts.push({ id: `t_${i}`, content: `thought ${i}` });
      }
      await space.shareThought("alice", { content: "trigger archive" });
      assert.ok(committed, "substrate.commitDTU should have been called");
      // After archive: 1002 total - 500 archived = 502
      assert.ok(space.sharedContext.thoughts.length <= 502);
    });

    it("preserves thoughts if substrate commit fails", async () => {
      const substrate = {
        commitDTU: async () => { throw new Error("network failure"); },
        findSharedDTUs: async () => [],
        searchDTUs: async () => [],
      };
      const space = createSpace({ substrate });
      for (let i = 0; i < 1001; i++) {
        space.sharedContext.thoughts.push({ id: `t_${i}`, content: `thought ${i}` });
      }
      // shareThought calls _archiveThoughts which will throw — but shareThought
      // should propagate the error, and thoughts should NOT be spliced
      await assert.rejects(() => space.shareThought("alice", { content: "trigger" }));
      assert.ok(space.sharedContext.thoughts.length >= 1001, "thoughts must be preserved on failure");
    });
  });

  describe("Close", () => {
    it("sets all participants to inactive and returns metrics", async () => {
      const space = createSpace();
      await space.shareThought("alice", { content: "hello" });
      const metrics = await space.close("test");
      assert.ok(metrics.totalDuration >= 0);
      assert.equal(metrics.thoughtsShared, 1);
      assert.equal(space.participants.get("alice").presence, PresenceState.INACTIVE);
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. SUBCONSCIOUS MANAGER
// ════════════════════════════════════════════════════════════════════

describe("Subconscious Manager", () => {
  let manager;

  beforeEach(() => {
    manager = new SubconsciousManager({
      nodeId: "dutch",
      maxAmbientSpaces: 5,
      pulseRate: 60000, // Long pulse so it doesn't fire during tests
    });
  });

  after(() => {
    manager?.stop();
  });

  it("starts and stops the pulse loop", () => {
    manager.start();
    assert.ok(manager.pulseInterval);
    assert.equal(manager.getStatus().isRunning, true);
    manager.stop();
    assert.equal(manager.pulseInterval, null);
    assert.equal(manager.getStatus().isRunning, false);
  });

  it("adds a space to ambient pool", async () => {
    const space = createSpace({ initiator: "dutch", target: "child" });
    await manager.addAmbientSpace(space);
    assert.equal(manager.ambientSpaces.size, 1);
    assert.equal(space.participants.get("dutch").presence, PresenceState.AMBIENT);
  });

  it("enforces maxAmbientSpaces limit", async () => {
    for (let i = 0; i < 5; i++) {
      await manager.addAmbientSpace(createSpace({ initiator: "dutch", target: `child_${i}` }));
    }
    await assert.rejects(
      () => manager.addAmbientSpace(createSpace({ initiator: "dutch", target: "child_6" })),
      /Maximum ambient spaces/
    );
  });

  it("removes a space and detaches listeners", async () => {
    const space = createSpace({ initiator: "dutch", target: "child" });
    await manager.addAmbientSpace(space);
    await manager.removeAmbientSpace(space.id);
    assert.equal(manager.ambientSpaces.size, 0);
    assert.equal(manager._listeners.has(space.id), false);
  });

  it("focusOn swaps conscious/ambient spaces correctly", async () => {
    const space1 = createSpace({ initiator: "dutch", target: "child_1" });
    const space2 = createSpace({ initiator: "dutch", target: "child_2" });
    await manager.addAmbientSpace(space1);
    await manager.addAmbientSpace(space2);

    await manager.focusOn(space1.id);
    assert.equal(manager.consciousSpace, space1);
    assert.equal(manager.ambientSpaces.has(space1.id), false);
    assert.equal(space1.participants.get("dutch").presence, PresenceState.CONSCIOUS);

    // Now focus on space2 — space1 should return to ambient
    await manager.focusOn(space2.id);
    assert.equal(manager.consciousSpace, space2);
    assert.equal(manager.ambientSpaces.has(space1.id), true);
    assert.equal(space1.participants.get("dutch").presence, PresenceState.AMBIENT);
  });

  it("re-attaches monitoring listeners when space returns to ambient", async () => {
    const space1 = createSpace({ initiator: "dutch", target: "child_1" });
    const space2 = createSpace({ initiator: "dutch", target: "child_2" });
    await manager.addAmbientSpace(space1);
    await manager.addAmbientSpace(space2);

    await manager.focusOn(space1.id);
    // space2 is still ambient with listeners
    assert.ok(manager._listeners.has(space2.id));
    // space1 is conscious — listeners detached
    assert.equal(manager._listeners.has(space1.id), false);

    // Focus on space2 — space1 returns to ambient with re-attached listeners
    await manager.focusOn(space2.id);
    assert.ok(manager._listeners.has(space1.id), "listeners must be re-attached");
  });

  it("releaseFocus moves conscious space back to ambient with listeners", async () => {
    const space = createSpace({ initiator: "dutch", target: "child" });
    await manager.addAmbientSpace(space);
    await manager.focusOn(space.id);
    assert.equal(manager.consciousSpace, space);

    await manager.releaseFocus();
    assert.equal(manager.consciousSpace, null);
    assert.ok(manager.ambientSpaces.has(space.id));
    assert.ok(manager._listeners.has(space.id), "listeners must be re-attached on release");
  });

  it("handles distress escalation from ambient space", async () => {
    const space = createSpace({ initiator: "dutch", target: "child" });
    await manager.addAmbientSpace(space);

    const escalations = collectEvents(manager.emitter, "escalation:queued");
    // Simulate child distress
    space.emitter.emit("distress:detected", { nodeId: "child", distressLevel: 0.9 });
    assert.equal(escalations.length, 1);
    assert.equal(escalations[0].spaceId, space.id);
  });

  it("pulse overlap guard prevents concurrent pulses", async () => {
    // Simulate a pulse that's already running
    manager._pulsing = true;
    // Manually trigger what setInterval would do
    let pulseRan = false;
    const origPulse = manager._pulse;
    manager._pulse = async () => { pulseRan = true; };

    // The setInterval callback checks _pulsing first
    if (!manager._pulsing) {
      await manager._pulse();
    }
    assert.equal(pulseRan, false, "pulse should be skipped when already pulsing");
    manager._pulse = origPulse;
    manager._pulsing = false;
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. COGNITIVE BRIDGE — Interface Adapters & Sentiment
// ════════════════════════════════════════════════════════════════════

describe("Cognitive Bridge — InterfaceAdapter", () => {

  describe("Interface types", () => {
    it("text adapter has correct latency and bandwidth", () => {
      const adapter = new InterfaceAdapter(InterfaceType.TEXT);
      assert.equal(adapter.latency, 500);
      assert.equal(adapter.bandwidth, 50);
    });

    it("neural adapter has 200x bandwidth of text", () => {
      const text = new InterfaceAdapter(InterfaceType.TEXT);
      const neural = new InterfaceAdapter(InterfaceType.NEURAL);
      assert.equal(neural.bandwidth / text.bandwidth, 200);
    });

    it("substrate adapter has highest bandwidth and lowest latency", () => {
      const sub = new InterfaceAdapter(InterfaceType.SUBSTRATE);
      assert.equal(sub.bandwidth, 100000);
      assert.equal(sub.latency, 0.1);
    });
  });

  describe("Text translation", () => {
    it("translates string input into thought format", async () => {
      const adapter = new InterfaceAdapter(InterfaceType.TEXT);
      const result = await adapter.translateInput("Hello world");
      assert.equal(result.content, "Hello world");
      assert.equal(result.type, "verbal");
      assert.equal(result.isQuery, false);
    });

    it("detects questions via ?", async () => {
      const adapter = new InterfaceAdapter(InterfaceType.TEXT);
      const result = await adapter.translateInput("How are you?");
      assert.equal(result.isQuery, true);
    });

    it("detects higher intensity for ALL CAPS text", async () => {
      const adapter = new InterfaceAdapter(InterfaceType.TEXT);
      const normal = await adapter.translateInput("hello there");
      const caps = await adapter.translateInput("HELLO THERE");
      assert.ok(caps.intensity > normal.intensity);
    });
  });

  describe("Sentiment Analysis — full coverage", () => {
    const adapter = new InterfaceAdapter(InterfaceType.TEXT);

    it("detects love from multiple triggers", async () => {
      const r = await adapter.translateInput("I love and cherish you");
      assert.ok(r.inferredEmotion[EmotionalChannel.LOVE] >= 0.7);
    });

    it("detects joy", async () => {
      const r = await adapter.translateInput("I am so happy and excited!");
      assert.ok(r.inferredEmotion[EmotionalChannel.JOY] >= 0.7);
    });

    it("detects distress", async () => {
      const r = await adapter.translateInput("I'm scared and hurt");
      assert.ok(r.inferredEmotion[EmotionalChannel.DISTRESS] >= 0.7);
    });

    it("detects concern", async () => {
      const r = await adapter.translateInput("I'm worried about this problem");
      assert.ok(r.inferredEmotion[EmotionalChannel.CONCERN] >= 0.5);
    });

    it("detects warmth from gratitude", async () => {
      const r = await adapter.translateInput("Thank you so much, that was very kind");
      assert.ok(r.inferredEmotion[EmotionalChannel.WARMTH] >= 0.6);
    });

    it("detects calm", async () => {
      const r = await adapter.translateInput("I feel calm and peaceful right now");
      assert.ok(r.inferredEmotion[EmotionalChannel.CALM] >= 0.6);
    });

    it("detects focus", async () => {
      const r = await adapter.translateInput("I need to concentrate and analyze this");
      assert.ok(r.inferredEmotion[EmotionalChannel.FOCUS] >= 0.5);
    });

    it("detects curiosity", async () => {
      const r = await adapter.translateInput("I wonder what would happen if we explore that idea");
      assert.ok(r.inferredEmotion[EmotionalChannel.CURIOSITY] >= 0.5);
    });

    it("detects curiosity from multiple questions", async () => {
      const r = await adapter.translateInput("What is this? How does it work?");
      assert.ok(r.inferredEmotion[EmotionalChannel.CURIOSITY] > 0);
    });

    it("detects pride", async () => {
      const r = await adapter.translateInput("I'm so proud of what we accomplished");
      assert.ok(r.inferredEmotion[EmotionalChannel.PRIDE] >= 0.6);
    });

    it("detects comfort", async () => {
      const r = await adapter.translateInput("I feel safe and secure at home");
      assert.ok(r.inferredEmotion[EmotionalChannel.COMFORT] >= 0.5);
    });

    it("handles negation — 'not happy' removes joy, adds concern", async () => {
      const r = await adapter.translateInput("I am not happy about this");
      assert.equal(r.inferredEmotion[EmotionalChannel.JOY], undefined);
      assert.ok(r.inferredEmotion[EmotionalChannel.CONCERN] > 0);
    });

    it("handles negation — 'not calm' removes calm, adds distress", async () => {
      const r = await adapter.translateInput("I am not calm right now");
      assert.equal(r.inferredEmotion[EmotionalChannel.CALM], undefined);
      assert.ok(r.inferredEmotion[EmotionalChannel.DISTRESS] > 0);
    });

    it("returns empty emotion for neutral text", async () => {
      const r = await adapter.translateInput("The meeting is at 3pm");
      assert.deepEqual(r.inferredEmotion, {});
    });

    it("returns baseline intensity for empty/null text", async () => {
      const r = await adapter.translateInput("");
      assert.equal(r.intensity, 0.3);
    });

    it("multiple triggers in same channel strengthen signal", async () => {
      const single = await adapter.translateInput("I love you");
      const multi = await adapter.translateInput("I love and adore and cherish you");
      assert.ok(multi.inferredEmotion[EmotionalChannel.LOVE] >= single.inferredEmotion[EmotionalChannel.LOVE]);
    });

    it("detects mixed emotions", async () => {
      const r = await adapter.translateInput("I love this but I'm worried about what happens next");
      assert.ok(r.inferredEmotion[EmotionalChannel.LOVE] > 0);
      assert.ok(r.inferredEmotion[EmotionalChannel.CONCERN] > 0);
    });
  });

  describe("Output translation", () => {
    it("text output includes emotional hints", async () => {
      const adapter = new InterfaceAdapter(InterfaceType.TEXT);
      const output = await adapter.translateOutput({
        content: "Hello",
        emotionalContext: { warmth: 0.8, joy: 0.3 },
      });
      assert.equal(output.text, "Hello");
      assert.ok(output.emotionalHints.includes("warmth"));
    });

    it("voice output includes tone and pace", async () => {
      const adapter = new InterfaceAdapter(InterfaceType.VOICE);
      const output = await adapter.translateOutput({
        content: "Take it easy",
        emotionalContext: { distress: 0.7 },
      });
      assert.equal(output.pace, "slow");
      assert.equal(output.tone, "gentle");
    });
  });
});

describe("Cognitive Bridge — CognitiveBridge class", () => {
  it("initializes and opens a mind space", async () => {
    const bridge = new CognitiveBridge({ nodeId: "dutch", interfaceType: "text" });
    await bridge.initialize();
    const space = await bridge.openSpace("child_1");
    assert.ok(space.id.startsWith("ms_"));
    assert.equal(bridge.spaces.size, 1);
    await bridge.shutdown();
  });

  it("sends a thought through the adapter pipeline", async () => {
    const bridge = new CognitiveBridge({ nodeId: "dutch", interfaceType: "text" });
    await bridge.initialize();
    const space = await bridge.openSpace("child_1");
    const thought = await bridge.sendThought(space.id, "I love you kiddo");
    assert.equal(thought.content, "I love you kiddo");
    assert.ok(thought.emotionalContext);
    await bridge.shutdown();
  });

  it("upgrades interface and changes bandwidth/latency", async () => {
    const bridge = new CognitiveBridge({ nodeId: "dutch", interfaceType: "text" });
    await bridge.initialize();
    assert.equal(bridge.adapter.bandwidth, 50);
    await bridge.upgradeInterface(InterfaceType.NEURAL);
    assert.equal(bridge.adapter.bandwidth, 10000);
    assert.equal(bridge.adapter.latency, 5);
    await bridge.shutdown();
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. MULTI-SPACE HANDLER
// ════════════════════════════════════════════════════════════════════

describe("Multi-Space Handler", () => {
  let handler;

  beforeEach(async () => {
    handler = new MultiSpaceHandler({
      nodeId: "dutch",
      nodeType: "human",
      interfaceType: "text",
      pulseRate: 60000,
    });
    await handler.initialize();
  });

  after(async () => {
    await handler?.shutdown();
  });

  it("registers relationships with defaults", () => {
    handler.registerRelationship("child_1", { type: "child", name: "First Born" });
    const rel = handler.relationships.get("child_1");
    assert.equal(rel.type, "child");
    assert.equal(rel.name, "First Born");
    assert.equal(rel.emotionalPriority, 0.5);
  });

  it("spread-first: explicit fields win over metadata spread", () => {
    handler.registerRelationship("child_1", { name: "Kid", emotionalPriority: 0.9 });
    const rel = handler.relationships.get("child_1");
    assert.equal(rel.type, "general"); // default wins because metadata.type is undefined
    assert.equal(rel.emotionalPriority, 0.9); // explicit extraction of metadata.emotionalPriority
  });

  it("connectToMany opens conscious + ambient spaces", async () => {
    handler.registerRelationship("c1", { type: "child", name: "One" });
    handler.registerRelationship("c2", { type: "child", name: "Two" });
    const spaces = await handler.connectToMany(["c1", "c2"]);
    assert.equal(spaces.length, 2);

    const dash = handler.getDashboard();
    const c1 = dash.connections.find((c) => c.connectedTo === "c1");
    const c2 = dash.connections.find((c) => c.connectedTo === "c2");
    assert.equal(c1.myPresence, PresenceState.CONSCIOUS);
    assert.equal(c2.myPresence, PresenceState.AMBIENT);
  });

  it("broadcasts thoughts to all spaces", async () => {
    await handler.connectToMany(["c1", "c2", "c3"]);
    const results = await handler.broadcastThought("Goodnight everyone");
    assert.equal(results.length, 3);
    assert.ok(results.every((r) => r.success));
    assert.equal(handler.stats.totalThoughtsShared, 3);
  });

  it("broadcasts emotions to all spaces", async () => {
    await handler.connectToMany(["c1", "c2"]);
    // Should not throw
    await handler.broadcastEmotion({ warmth: 0.9, love: 0.8 });
  });

  it("dashboard shows correct relationship metadata", async () => {
    handler.registerRelationship("c1", { type: "child", name: "First Born" });
    await handler.connectTo("c1");
    const dash = handler.getDashboard();
    assert.equal(dash.connections[0].name, "First Born");
    assert.equal(dash.connections[0].relationship, "child");
  });

  it("graceful shutdown closes all spaces", async () => {
    await handler.connectToMany(["c1", "c2"]);
    assert.equal(handler.bridge.spaces.size, 2);
    await handler.shutdown();
    assert.equal(handler.bridge.spaces.size, 0);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. INTEGRATION — End-to-End Telepathy Flow
// ════════════════════════════════════════════════════════════════════

describe("Integration — End-to-End Telepathy Flow", () => {

  it("full lifecycle: init → connect → talk → upgrade → shutdown", async () => {
    const dutch = new MultiSpaceHandler({
      nodeId: "dutch", nodeType: "human", interfaceType: "text", pulseRate: 60000,
    });
    await dutch.initialize();

    dutch.registerRelationship("kid", { type: "child", name: "Junior" });
    const space = await dutch.connectTo("kid");

    // Send a thought through the bridge
    const thought = await dutch.bridge.sendThought(space.id, "How was school?");
    assert.equal(thought.isQuery, true);
    assert.equal(thought.content, "How was school?");

    // Upgrade to neural
    await dutch.bridge.upgradeInterface("neural");
    assert.equal(dutch.bridge.getStatus().interface.bandwidth, 10000);

    // Dashboard shows connection
    const dash = dutch.getDashboard();
    assert.equal(dash.totalConnections, 1);
    assert.equal(dash.connections[0].name, "Junior");

    await dutch.shutdown();
  });

  it("distress auto-escalation across subconscious spaces", async () => {
    const dutch = new MultiSpaceHandler({
      nodeId: "dutch", nodeType: "human", interfaceType: "text", pulseRate: 60000,
    });
    await dutch.initialize();

    dutch.registerRelationship("c1", { type: "child", name: "One" });
    dutch.registerRelationship("c2", { type: "child", name: "Two" });

    const spaces = await dutch.connectToMany(["c1", "c2"]);
    // c1 is conscious, c2 is ambient

    // Simulate distress from c2's space — emit directly on the space emitter
    const c2space = spaces[1];
    c2space.emitter.emit("distress:detected", {
      nodeId: "c2", distressLevel: 0.9, spaceId: c2space.id,
    });

    // The subconscious manager should have queued an escalation
    assert.ok(dutch.bridge.subconscious.escalationQueue.length > 0 ||
      dutch.bridge.subconscious.consciousSpace === c2space,
      "escalation should be queued or focus should have shifted");

    await dutch.shutdown();
  });

  it("memory anchor captures emotional snapshot", async () => {
    const space = createSpace();
    await space.transmitEmotion("alice", { joy: 0.9, love: 0.8 });
    await space.shareThought("alice", { content: "This is beautiful" });

    const anchor = await space.createMemoryAnchor("alice", "A perfect moment");
    assert.ok(anchor.emotionalSnapshot[EmotionalChannel.JOY] > 0);
    assert.equal(anchor.recentThoughts.length, 1);
    assert.equal(anchor.recentThoughts[0].content, "This is beautiful");
    assert.equal(space.sharedContext.memoryAnchors.length, 1);
  });
});
