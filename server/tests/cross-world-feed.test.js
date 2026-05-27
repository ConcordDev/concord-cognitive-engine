// Phase P — cross-world feed shape contract.
//
// Uses a stubbed DB (only the `prepare(...).all(...)` interface we touch)
// to verify the feed merges events from multiple worlds and sorts them
// by recency × notability. Real-DB integration is covered by the boot
// smoke; this is the unit contract.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getCrossWorldFeed, getCrossWorldRoyaltyFlow } from "../lib/cross-world-feed.js";

function stubDb(tableRows = {}) {
  return {
    prepare(sql) {
      let pick = "default";
      if (sql.includes("FROM dtus")) pick = "dtus";
      else if (sql.includes("FROM faction_strategy_log")) pick = "faction_strategy_log";
      else if (sql.includes("FROM npc_legacies")) pick = "npc_legacies";
      else if (sql.includes("FROM world_events")) pick = "world_events";
      else if (sql.includes("FROM dtu_citations")) pick = "dtu_citations";
      return { all: () => tableRows[pick] || [] };
    },
  };
}

describe("Phase P — cross-world feed", () => {
  it("returns empty events for a stub with no rows", () => {
    const r = getCrossWorldFeed(stubDb({}));
    assert.deepEqual(r.events, []);
    assert.equal(r.worlds, 0);
  });

  it("merges events from multiple tables and worlds", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      dtus: [
        { id: "d1", world_id: "cyber", title: "Neon Cascade", kind: "mega_dtu", created_by: "u1", created_at: now - 60 },
      ],
      faction_strategy_log: [
        { faction_id: "iron-band", action: "DECLARE_WAR", target_id: "scribes", world_id: "fantasy", ts: now - 120 },
      ],
      npc_legacies: [
        { npc_id: "elder-vesh", world_id: "fantasy", died_at: now - 30, cause: "old_age", last_words: "remember the old names" },
      ],
      world_events: [],
    }));
    assert.equal(r.events.length, 3);
    const worlds = new Set(r.events.map(e => e.worldId));
    assert.ok(worlds.has("cyber"));
    assert.ok(worlds.has("fantasy"));
  });

  it("more recent + more notable events rank higher", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      dtus: [
        { id: "old", world_id: "cyber", title: "old", kind: "mega_dtu", created_by: "u", created_at: now - 3600 * 2 },
      ],
      faction_strategy_log: [
        { faction_id: "f", action: "DECLARE_WAR", target_id: "g", world_id: "fantasy", ts: now - 60 },
      ],
    }));
    // DECLARE_WAR (notability 4) and recent should beat dtu:promoted (notability 3) that's 2h old.
    assert.equal(r.events[0].kind, "faction-war:started");
  });

  it("kindFilter narrows results", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      dtus: [{ id: "d", world_id: "cyber", title: "t", kind: "mega_dtu", created_by: "u", created_at: now - 60 }],
      faction_strategy_log: [{ faction_id: "f", action: "DECLARE_WAR", target_id: "g", world_id: "fantasy", ts: now - 60 }],
    }), { kindFilter: "dtu" });
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].kind, "dtu:promoted");
  });

  it("royalty flow returns empty when no cross-world citations exist", () => {
    const r = getCrossWorldRoyaltyFlow(stubDb({ dtu_citations: [] }));
    assert.deepEqual(r.flows, []);
    assert.equal(r.totalRoyaltyCC, 0);
  });
});
