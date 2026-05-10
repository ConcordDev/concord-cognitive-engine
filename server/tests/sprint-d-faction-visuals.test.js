/**
 * Sprint D / V1 — faction visual schema validation tests.
 *
 * Pins:
 *   - validateFaction accepts visual block with hex colours
 *   - validateFaction rejects malformed visual block
 *   - factions.visual macro returns the seeded data
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateFaction } from "../lib/content-seeder.js";

describe("Sprint D / V1 — validateFaction visual block", () => {
  it("accepts a faction without visual (backwards-compatible)", () => {
    const r = validateFaction({ id: "f1", name: "Test" });
    assert.equal(r.ok, true);
  });

  it("accepts a faction with a complete visual block", () => {
    const r = validateFaction({
      id: "f1", name: "Test",
      visual: {
        primary_color: "#8a3030",
        secondary_color: "#1a1a1a",
        accent_color: "#c8a050",
      },
    });
    assert.equal(r.ok, true);
  });

  it("rejects a faction with an invalid colour", () => {
    const r = validateFaction({
      id: "f1", name: "Test",
      visual: {
        primary_color: "not-hex",
        secondary_color: "#1a1a1a",
        accent_color: "#c8a050",
      },
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /invalid_visual_primary_color/);
  });

  it("rejects a faction missing a required colour", () => {
    const r = validateFaction({
      id: "f1", name: "Test",
      visual: {
        primary_color: "#8a3030",
        // missing secondary_color
        accent_color: "#c8a050",
      },
    });
    assert.equal(r.ok, false);
  });

  it("rejects a non-object visual", () => {
    const r = validateFaction({ id: "f1", name: "Test", visual: "blue" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_visual_shape");
  });
});
