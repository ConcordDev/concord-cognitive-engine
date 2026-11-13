// server/tests/home-improvement-palette-contract.test.js
//
// FIX-home-improvement-001: Suggest palette crashed the lens 2/2 with the
// lens error boundary ("Something broke while rendering this surface").
// The colorPalette action returned `palette` as the raw hex OBJECT while
// the lens renders it as a string child ({d.palette}) — React throws
// "Objects are not valid as a React child". The FE contract
// (hi-shared.ts ColorPaletteResult) declares palette: string. The action
// now returns the summary string, with the hex set on paletteHexes.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerHomeImprovementActions from "../domains/homeimprovement.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function callPalette(data) {
  const fn = ACTIONS.get("home-improvement.colorPalette");
  if (!fn) throw new Error("colorPalette not registered");
  return fn({ actor: { userId: "u1" }, userId: "u1" }, { id: null, data, meta: {} }, {});
}

before(() => { registerHomeImprovementActions(register); });

describe("home-improvement colorPalette contract (FIX-home-improvement-001)", () => {
  it("palette is a renderable string naming all four hexes (audit case: living room / modern)", () => {
    const r = callPalette({ room: "living room", style: "modern" });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.palette, "string", `palette must be a string, got ${typeof r.result.palette}`);
    for (const hex of ["#FFFFFF", "#2C2C2C", "#E8D4B8", "#4A90D9"]) {
      assert.ok(r.result.palette.includes(hex), `palette string names ${hex}: ${r.result.palette}`);
    }
    assert.deepEqual(r.result.paletteHexes, { primary: "#FFFFFF", accent: "#2C2C2C", warm: "#E8D4B8", pop: "#4A90D9" });
    assert.equal(r.result.wallColor, "#FFFFFF");
    assert.equal(r.result.accent, "#2C2C2C");
    assert.equal(r.result.furniture, "#E8D4B8");
    assert.equal(r.result.decor, "#4A90D9");
  });

  it("unknown style falls back to modern and stays a string", () => {
    const r = callPalette({ room: "kitchen", style: "industrial" });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.palette, "string");
    assert.ok(r.result.palette.includes("#4A90D9"));
  });
});
