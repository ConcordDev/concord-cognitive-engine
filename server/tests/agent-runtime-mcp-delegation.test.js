// AGENT-RUNTIME MCP DELEGATION regression test (FIX-ALL Q32, audit row B#20).
//
// Pins the fix for: callMcpSafe() in lib/agent-runtime.js returned a
// { status: "not_implemented_inline" } placeholder for the two read
// tools the runtime snapshot needs. Callers read the placeholder as
// real data — memory reported `sample_count: null` under status
// "available", and perception reported 0 federation peers as fact.
//
// callMcpSafe now delegates in-process: dtu_list reads the real
// STATE.dtus substrate (the store routes/dtus.js serves), and
// federation_peers reads the real peer table via lib/federation's
// listPeers(STATE.db). Unavailable sources THROW, so the layers report
// status "error" instead of fabricated numbers. No MCP server is
// involved — these are the runtime's own exported layer readers driven
// against a fake STATE.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import { readMemory, readPerception } from "../lib/agent-runtime.js";

const PEER_ROWS = [
  { id: "fpeer_1", peer_type: "regional_sibling", from_id: "cri-a", to_id: "cri-b", sharing_policy: "pull_on_demand", economic_isolation: 1, compliance_layer: 0, created_at: "2026-10-01T00:00:00.000Z" },
  { id: "fpeer_2", peer_type: "national_peer", from_id: "cri-b", to_id: "cri-c", sharing_policy: "push", economic_isolation: 0, compliance_layer: 1, created_at: "2026-10-02T00:00:00.000Z" },
];

function fakeDb() {
  return {
    prepare(sql) {
      assert.match(sql, /FROM federation_peers/);
      return { all: (..._params) => PEER_ROWS };
    },
  };
}

function fullState() {
  return {
    dtus: new Map([
      ["dtu_1", { id: "dtu_1", title: "First", creator_id: "user-1", created_at: "2026-10-01T00:00:00.000Z" }],
      ["dtu_2", { id: "dtu_2", title: "Second", creatorId: "user-2", createdAt: "2026-10-02T00:00:00.000Z" }],
      ["dtu_3", { id: "dtu_3", title: "Third", creator_id: "user-1", created_at: "2026-10-03T00:00:00.000Z" }],
    ]),
    db: fakeDb(),
  };
}

const savedState = globalThis.STATE;
beforeEach(() => { globalThis.STATE = fullState(); });
after(() => { globalThis.STATE = savedState; });

describe("agent-runtime callMcpSafe delegation (Q32)", () => {
  it("memory: dtu_substrate reports the REAL substrate count as available", async () => {
    const mem = await readMemory("entity-1");
    assert.equal(mem.dtu_substrate.status, "available");
    assert.equal(mem.dtu_substrate.sample_count, 3);
  });

  it("perception: atlas reports the REAL federation peer count and sample", async () => {
    const per = await readPerception("entity-1");
    assert.equal(per.atlas.status, "available");
    assert.equal(per.atlas.value.peers_count, 2);
    assert.equal(per.atlas.value.sample.length, 2);
    assert.equal(per.atlas.value.sample[0].peerType, "regional_sibling");
  });

  it("memory: missing DTU substrate is an honest error, never a null count", async () => {
    globalThis.STATE = { db: fakeDb() };
    const mem = await readMemory("entity-1");
    assert.equal(mem.dtu_substrate.status, "error");
    assert.match(mem.dtu_substrate.error, /substrate unavailable/);
  });

  it("perception: missing db is an honest error, never 0 peers", async () => {
    globalThis.STATE = { dtus: new Map() };
    const per = await readPerception("entity-1");
    assert.equal(per.atlas.status, "error");
    assert.match(per.atlas.error, /peer store unavailable/);
  });
});
