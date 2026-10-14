// INC-SWEEP agents F8 — spawn-research writes one agent visible to roster
// reads (personas-with-goal + emergent get). Mirrors the operations.js contract.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  createAgent, getAgent, listAgents, destroyAgent, resumeAgent, pauseAgent,
} from "../emergent/agent-system.js";

describe("agents F8 spawn-research roster unify", () => {
  const ownerId = "u_f8_owner";
  let agentId;

  beforeEach(() => {
    // Best-effort cleanup of prior agents from this suite.
    for (const a of listAgents().agents || []) {
      if (a.metadata?.ownerId === ownerId || a.metadata?.purpose === "research-f8") {
        destroyAgent(a.agentId);
      }
    }
    globalThis._concordSTATE = globalThis._concordSTATE || {};
    if (!(globalThis._concordSTATE.personas instanceof Map)) {
      globalThis._concordSTATE.personas = new Map();
    }
  });

  it("spawn mirror is fetchable by id, listed with goal, and enable works", () => {
    const topic = "f8topic";
    const result = createAgent("synthesis", {
      territory: "*",
      metadata: {
        purpose: "research-f8",
        topic,
        ownerId,
        createdByUserId: ownerId,
        spawnedAt: new Date().toISOString(),
      },
    });
    assert.equal(result.ok, true);
    agentId = result.agent.agentId;

    // Mirror — same shape operations.js spawn-research writes.
    const goal = `Research: ${topic}`;
    const personas = globalThis._concordSTATE.personas;
    personas.set(agentId, {
      id: agentId,
      ownerId,
      name: `Research (${topic})`,
      goal,
      enabled: true,
      createdAt: result.agent.createdAt,
      emergentType: "synthesis",
    });

    const got = getAgent(agentId);
    assert.equal(got.ok, true);

    const roster = Array.from(personas.values()).filter((p) => p && p.goal && p.ownerId === ownerId);
    assert.ok(roster.some((p) => p.id === agentId));

    const en = pauseAgent(agentId);
    assert.equal(en.ok, true);
    assert.equal(getAgent(agentId).agent.status, "paused");
    assert.equal(resumeAgent(agentId).ok, true);
    assert.equal(getAgent(agentId).agent.status, "active");

    // Persistence stand-in: re-read by id from both stores.
    assert.equal(personas.get(agentId).goal, goal);
    assert.equal(getAgent(agentId).ok, true);
  });
});
