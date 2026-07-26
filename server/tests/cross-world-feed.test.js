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
      else if (sql.includes("FROM cross_world_scheme_consequences")) pick = "cross_world_scheme_consequences";
      else if (sql.includes("FROM population_flow_events")) pick = "population_flow_events";
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

  it("includes cross-world scheme consequence events, keyed by the affected world", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      cross_world_scheme_consequences: [
        {
          consequence_id: "xcon_1", scheme_id: "xsch_1", affected_world_id: "sovereign-ruins",
          consequence_kind: "death", affected_entity_kind: "npc", affected_entity_id: "target-npc",
          detail: "assassinated by cross-world plot from fantasy", applied_at: now - 90,
          scheme_kind: "assassinate", scheme_phase: "complete",
        },
        {
          consequence_id: "xcon_2", scheme_id: "xsch_1", affected_world_id: "fantasy",
          consequence_kind: "opinion_shift", affected_entity_kind: "npc", affected_entity_id: "plotter-npc",
          detail: "successful cross-world assassination of target-npc in sovereign-ruins", applied_at: now - 90,
          scheme_kind: "assassinate", scheme_phase: "complete",
        },
      ],
    }));
    assert.equal(r.events.length, 2);
    const death = r.events.find(e => e.kind === "cross-world-scheme:death");
    const shift = r.events.find(e => e.kind === "cross-world-scheme:consequence");
    assert.ok(death, "death consequence should surface as cross-world-scheme:death");
    assert.equal(death.worldId, "sovereign-ruins");
    assert.equal(death.ref.schemeId, "xsch_1");
    assert.ok(shift, "opinion_shift consequence should surface as cross-world-scheme:consequence");
    assert.equal(shift.worldId, "fantasy");
    const worlds = new Set(r.events.map(e => e.worldId));
    assert.ok(worlds.has("sovereign-ruins"));
    assert.ok(worlds.has("fantasy"));
  });

  it("surfaces an exposed scheme consequence under its own kind", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      cross_world_scheme_consequences: [
        {
          consequence_id: "xcon_3", scheme_id: "xsch_2", affected_world_id: "cyber",
          consequence_kind: "plot_exposed", affected_entity_kind: "npc", affected_entity_id: "plotter-npc",
          detail: "scheme failed and was exposed", applied_at: now - 30,
          scheme_kind: "blackmail", scheme_phase: "exposed",
        },
      ],
    }));
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].kind, "cross-world-scheme:exposed");
  });

  it("includes population migration arrival events, keyed by destination world", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      population_flow_events: [
        { id: 1, npc_id: "npc-iyatte", from_world_id: "tunya", to_world_id: "crime", arrived_at: now - 45, reason: "voluntary" },
      ],
    }));
    assert.equal(r.events.length, 1);
    const e = r.events[0];
    assert.equal(e.kind, "population:migration-arrived");
    assert.equal(e.worldId, "crime");
    assert.ok(e.summary.includes("npc-iyatte"));
    assert.ok(e.summary.includes("tunya"));
    assert.equal(e.ref.npcId, "npc-iyatte");
  });

  it("sorts a fresh, more notable cross-world-scheme death above an older dtu promotion", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      dtus: [
        { id: "old", world_id: "cyber", title: "old", kind: "mega_dtu", created_by: "u", created_at: now - 3600 * 2 },
      ],
      cross_world_scheme_consequences: [
        {
          consequence_id: "xcon_4", scheme_id: "xsch_3", affected_world_id: "fantasy",
          consequence_kind: "death", affected_entity_kind: "npc", affected_entity_id: "n",
          detail: "assassinated", applied_at: now - 60, scheme_kind: "assassinate", scheme_phase: "complete",
        },
      ],
    }));
    assert.equal(r.events[0].kind, "cross-world-scheme:death");
  });

  it("sorts a recent population arrival above an older, less notable dtu promotion", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      dtus: [
        { id: "old", world_id: "cyber", title: "old", kind: "mega_dtu", created_by: "u", created_at: now - 3600 * 5 },
      ],
      population_flow_events: [
        { id: 2, npc_id: "n", from_world_id: "a", to_world_id: "b", arrived_at: now - 30, reason: null },
      ],
    }));
    assert.equal(r.events[0].kind, "population:migration-arrived");
  });

  it("cross-world-scheme kindFilter matches all its sub-kinds", () => {
    const now = Math.floor(Date.now() / 1000);
    const r = getCrossWorldFeed(stubDb({
      cross_world_scheme_consequences: [
        { consequence_id: "xcon_5", scheme_id: "xsch_4", affected_world_id: "fantasy", consequence_kind: "death", affected_entity_kind: "npc", affected_entity_id: "n1", detail: "d1", applied_at: now - 10, scheme_kind: "assassinate", scheme_phase: "complete" },
        { consequence_id: "xcon_6", scheme_id: "xsch_5", affected_world_id: "cyber", consequence_kind: "opinion_shift", affected_entity_kind: "npc", affected_entity_id: "n2", detail: "d2", applied_at: now - 20, scheme_kind: "seduce", scheme_phase: "complete" },
      ],
      dtus: [{ id: "d", world_id: "cyber", title: "t", kind: "mega_dtu", created_by: "u", created_at: now - 5 }],
    }), { kindFilter: "cross-world-scheme" });
    assert.equal(r.events.length, 2);
    assert.ok(r.events.every(e => e.kind.startsWith("cross-world-scheme:")));
  });

  it("a DB with zero rows in the new cross-world tables still returns a clean, empty-safe feed", () => {
    const r = getCrossWorldFeed(stubDb({
      cross_world_scheme_consequences: [],
      population_flow_events: [],
    }));
    assert.deepEqual(r.events, []);
    assert.equal(r.worlds, 0);
    // Also verify the DB-absent path (no stub rows configured at all) never
    // throws and never fabricates a placeholder event for the new sources.
    const bare = getCrossWorldFeed(stubDb({}));
    assert.deepEqual(bare.events, []);
    assert.equal(bare.worlds, 0);
  });
});
