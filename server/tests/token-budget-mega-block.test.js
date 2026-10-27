import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatDTUBlock } from "../lib/token-budget-assembler.js";

describe("formatDTUBlock renders consolidated DTUs", () => {
  it("a mega with no summary or claims shows its definition", () => {
    const b = formatDTUBlock({
      tier: "mega", title: "MEGA — Pier",
      cretiHuman: "**What this MEGA represents**: 10 related regular DTUs clustered around **Pier**.",
      core: { definitions: ["A compressed synthesis of 10 regular DTUs around: Pier."], claims: [], invariants: [] },
    });
    assert.match(b, /^\[MEGA\] MEGA — Pier/);
    assert.match(b, /A compressed synthesis of 10 regular DTUs around: Pier\./);
  });
  it("falls back to cretiHuman without markdown", () => {
    const b = formatDTUBlock({ tier: "hyper", title: "HYPER — X", cretiHuman: "**What this** represents: 4 megas." });
    assert.match(b, /What this represents: 4 megas\./);
  });
  it("a regular with a summary is unchanged", () => {
    const b = formatDTUBlock({ tier: "regular", title: "R", human: { summary: "Gate opens 04:10" } });
    assert.match(b, /\n {2}Gate opens 04:10/);
    assert.doesNotMatch(b, /Definition:/);
  });
});
