// Phase O — per-world voice injection into the system prompt.
//
// Pins: (1) ctx.worldId='crime' injects noir tone fragment,
// (2) ctx.worldId='fantasy' injects archaic tone, (3) missing worldId
// returns the legacy prompt with no voice block, (4) the brain's
// persona / Modelfile path is preserved (useModelfileSystem still true
// for conscious).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeSystemPrompt } from "../lib/prompt-registry.js";

describe("Phase O — world voice injection", () => {
  it("worldId='crime' injects noir tone", () => {
    const r = composeSystemPrompt("subconscious", { worldId: "crime", mode: "chat" });
    assert.ok(r.system.includes("noir") || r.system.includes("World voice for crime"), r.system);
    // Should contain at least one crime vocabulary item.
    assert.ok(/wise guy|racket|shamus|heater/.test(r.system), "noir vocabulary not present");
  });

  it("worldId='fantasy' injects archaic tone", () => {
    const r = composeSystemPrompt("subconscious", { worldId: "fantasy", mode: "chat" });
    assert.ok(r.system.includes("archaic") || r.system.includes("World voice for fantasy"));
    assert.ok(/thee|thou|Realm/.test(r.system), "fantasy vocabulary not present");
  });

  it("no worldId returns a prompt without voice block", () => {
    const r = composeSystemPrompt("subconscious", { mode: "chat" });
    assert.ok(!r.system.includes("World voice for"), "voice block should be absent");
  });

  it("conscious brain keeps useModelfileSystem=true", () => {
    const r = composeSystemPrompt("conscious", { worldId: "fantasy", mode: "chat" });
    assert.equal(r.useModelfileSystem, true);
    // World voice is still appended to the functional layer.
    assert.ok(r.system.includes("World voice for fantasy"));
  });

  it("unknown world returns prompt with no voice block (graceful fallback)", () => {
    const r = composeSystemPrompt("subconscious", { worldId: "nonexistent-world", mode: "chat" });
    assert.ok(!r.system.includes("World voice for nonexistent-world"));
  });
});
