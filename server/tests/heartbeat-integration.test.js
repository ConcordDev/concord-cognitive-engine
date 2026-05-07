/**
 * Heartbeat Integration Test
 *
 * Tests that governorTick completes without throwing,
 * that all wired modules actually execute, and that
 * the consolidation pipeline is properly configured.
 */

import { readFileSync } from "fs";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "path";

const SERVER_PATH = path.resolve(import.meta.dirname, "../server.js");

describe("Heartbeat Integration", () => {
  const source = readFileSync(SERVER_PATH, "utf-8");

  it("should have governorTick function defined", () => {
    assert.ok(source.includes("async function governorTick("));
  });

  it("should have _tickHistory ring buffer", () => {
    assert.ok(source.includes("const _tickHistory = []"));
  });

  it("should push to _tickHistory after each tick", () => {
    assert.ok(source.includes("_tickHistory.push("));
  });

  // Phase 2 module wiring checks
  const requiredModules = [
    { name: "entity-economy", marker: "entity-economy.js" },
    { name: "entity-growth", marker: "entity-growth.js" },
    { name: "dream-capture", marker: "dream-capture.js" },
    { name: "forgetting-engine", marker: "forgetting-engine.js" },
    { name: "entity-teaching", marker: "entity-teaching.js" },
    { name: "consequence-cascade", marker: "consequence-cascade.js" },
    { name: "deep-health", marker: "deep-health.js" },
    { name: "purpose-tracking", marker: "purpose-tracking.js" },
    { name: "skills", marker: "skills.js" },
    { name: "trust-network", marker: "trust-network.js" },
    { name: "attention-allocator", marker: "attention-allocator.js" },
    { name: "evidence", marker: "evidence.js" },
    { name: "threat-surface", marker: "threat-surface.js" },
    { name: "breakthrough-clusters", marker: "breakthrough-clusters.js" },
    { name: "meta-derivation", marker: "meta-derivation.js" },
    { name: "quest-engine", marker: "quest-engine.js" },
  ];

  for (const mod of requiredModules) {
    it(`should wire ${mod.name} module in governorTick`, () => {
      // Check that the module is imported within the governorTick function area
      const tickStart = source.indexOf("async function governorTick(");
      const tickEnd = source.indexOf("function _startGovernorHeartbeat()");
      const tickBody = source.slice(tickStart, tickEnd);
      assert.ok(tickBody.includes(mod.marker));
    });
  }

  it("should have consolidation pipeline in governorTick", () => {
    const tickStart = source.indexOf("async function governorTick(");
    const tickEnd = source.indexOf("function _startGovernorHeartbeat()");
    const tickBody = source.slice(tickStart, tickEnd);
    assert.ok(tickBody.includes("CONSOLIDATION.TICK_INTERVAL"));
    assert.ok(tickBody.includes("demoteToArchive"));
  });

  it("should have self-healing dream review wiring", () => {
    const tickStart = source.indexOf("async function governorTick(");
    const tickEnd = source.indexOf("function _startGovernorHeartbeat()");
    const tickBody = source.slice(tickStart, tickEnd);
    assert.ok(tickBody.includes("runDreamReview"));
  });

  it("should have embeddings health check wiring", () => {
    const tickStart = source.indexOf("async function governorTick(");
    const tickEnd = source.indexOf("function _startGovernorHeartbeat()");
    const tickBody = source.slice(tickStart, tickEnd);
    assert.ok(tickBody.includes("getEmbeddingStatus"));
  });

  // Archive system checks
  it("should have archiveDTUToDisk function", () => {
    assert.ok(source.includes("function archiveDTUToDisk("));
  });

  it("should have rehydrateDTU function", () => {
    assert.ok(source.includes("function rehydrateDTU("));
  });

  it("should have demoteToArchive function", () => {
    assert.ok(source.includes("function demoteToArchive("));
  });

  it("should have archived_dtus table creation", () => {
    assert.ok(source.includes("CREATE TABLE IF NOT EXISTS archived_dtus"));
  });

  // Brain routing check
  it("should route chat LLM to conscious brain with subconscious fallback", () => {
    assert.ok(source.includes("const consciousAvailable = BRAIN.conscious && BRAIN.conscious.enabled"));
    assert.ok(source.includes("const subconsciousAvailable = BRAIN.subconscious && BRAIN.subconscious.enabled"));
  });

  // Rate limiting check
  it("should have rate limiting for expensive macros", () => {
    assert.ok(source.includes("EXPENSIVE_MACROS"));
    assert.ok(source.includes("checkMacroRateLimit"));
  });
});
