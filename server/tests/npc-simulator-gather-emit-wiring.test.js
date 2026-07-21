// server/tests/npc-simulator-gather-emit-wiring.test.js
//
// npc-simulator.js has no existing test coverage for its class (verified:
// no test file imports it, even for the sibling _emitBark/_callForHelp
// socket-emit helpers this new _emitGather mirrors) — instantiating
// NPCSimulator requires heavy world-state setup out of scope for this
// specific fix. This is a source-pinning regression test (same pattern
// this session already used for large, hard-to-render frontend files)
// confirming the wiring: an NPC's gather_resource action previously wrote
// only to the DB, completely silently — no socket event existed for the
// world lens to react to. _emitGather closes that gap.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(HERE, "../lib/npc-simulator.js"), "utf8");

describe("npc-simulator.js — world:npc-gather emit wiring", () => {
  it("_emitGather follows the same globalThis._concordREALTIME?.io pattern as the existing _emitBark/_callForHelp helpers", () => {
    const idx = src.indexOf("function _emitGather(");
    assert.ok(idx > -1, "_emitGather should be defined");
    const body = src.slice(idx, idx + 700);
    assert.ok(body.includes("globalThis._concordREALTIME?.io"));
    assert.ok(body.includes("emit('world:npc-gather'"));
  });

  it("broadcasts x/y/z/nodeType/nodeId/resourceId/amount — enough for the frontend to pick the right tool-swing and locate the node", () => {
    const idx = src.indexOf("function _emitGather(");
    const body = src.slice(idx, idx + 900);
    for (const field of ["x", "y", "z", "nodeId", "nodeType", "resourceId", "resourceName", "amount"]) {
      assert.ok(body.includes(`${field}:`), `emit payload should carry ${field}`);
    }
  });

  it("uses the node's real position (gathered.x/y/z), not npc.location — a node can be up to 30m from the NPC", () => {
    const idx = src.indexOf("function _emitGather(");
    const body = src.slice(idx, idx + 900);
    assert.ok(body.includes("gathered.x") || body.includes("x:            gathered.x"));
    assert.ok(!body.includes("position:     npc.location"), "must not fall back to the old npc.location shape");
  });

  it("gather_resource calls _emitGather only when a real node was hit, not on the always-succeeds abstract fallback", () => {
    const caseIdx = src.indexOf('case "gather_resource"');
    assert.ok(caseIdx > -1);
    const caseBody = src.slice(caseIdx, caseIdx + 1800);
    assert.ok(caseBody.includes("if (gathered) _emitGather(this, this.worldId, gathered);"));
  });
});
