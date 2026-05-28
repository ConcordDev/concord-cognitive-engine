// Phase DA2 — station / workbench interaction router tests.
//
// Validates:
//   1. building-interiors.js exports 11 new station-typed room templates
//      (one per ROUTER_TABLE entry in StationInteractionRouter.tsx).
//   2. Each template has capacity / typical_furniture / dimensions.
//
// Frontend wiring (router → overlays) is static-asserted in the
// companion vitest file station-router-wired.test.tsx.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ROOM_TEMPLATES } from "../lib/building-interiors.js";

const EXPECTED_STATION_TYPES = [
  "farm_plot",
  "restaurant",
  "karaoke_booth",
  "mahjong_table",
  "trivia_kiosk",
  "hacking_terminal",
  "programming_console",
  "factory_workbench",
  "attraction_booth",
  "creature_pen",
  "glyph_altar",
];

describe("Phase DA2 — station room templates", () => {
  for (const type of EXPECTED_STATION_TYPES) {
    it(`ROOM_TEMPLATES has '${type}'`, () => {
      assert.ok(ROOM_TEMPLATES[type], `expected ROOM_TEMPLATES.${type}`);
    });

    it(`'${type}' has capacity + typical_furniture + dimensions`, () => {
      const t = ROOM_TEMPLATES[type];
      assert.equal(typeof t.capacity, "number");
      assert.ok(Array.isArray(t.typical_furniture));
      assert.equal(typeof t.width, "number");
      assert.equal(typeof t.depth, "number");
      assert.equal(typeof t.height, "number");
    });
  }
});
