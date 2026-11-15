/**
 * Caller-scoped export rows for staking positions, the species codex,
 * telecom outages, quests, and civic bonds.
 * Run: node --test server/tests/medium-export-positions.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stakingExportRows } from "../domains/staking.js";
import { creaturesCodexExportRows } from "../domains/creatures.js";
import { questExportRows } from "../domains/quests.js";
import { civicBondExportRows } from "../domains/civic-bonds.js";
import { exportCallerLensState } from "../lib/lens-export.js";
import { speciesCatalog } from "../lib/species-taxonomy.js";

function dbFrom(tables) {
  return {
    prepare(sql) {
      return {
        get() {
          if (String(sql).includes("sqlite_master")) return { name: "staking_positions" };
          return undefined;
        },
        all(...args) {
          const hit = tables.find((t) => String(sql).includes(t.match));
          return hit ? hit.rows(args) : [];
        },
      };
    },
  };
}

describe("medium export positions", () => {
  it("exports the caller's staking positions, yield, and receipts", () => {
    const pos = {
      id: "pos1", pool_id: "flex", pool_name: "Flex", principal_cc: 25, stake_months: 3,
      locked_at: 10, unlocks_at: 9_000_000_000, yield_rate_bps: 500, final_yield_cc: 2,
      auto_compound: 0, status: "redeemed", receipt_token_id: null, compound_count: 0,
      redeemed_at: 20, penalty_cc: 0,
    };
    const receipt = { id: "rc1", stake_id: "pos1", symbol: "sCC", face_value_cc: 25, minted_at: 11, unlocks_at: 30, status: "open" };
    const db = dbFrom([
      { match: "staking_positions", rows: (args) => (args[0] === "u1" ? [pos] : []) },
      { match: "staking_receipts", rows: (args) => (args[0] === "u1" ? [receipt] : []) },
    ]);
    const rows = stakingExportRows({ db, actor: { userId: "u1" } });
    assert.ok(rows.some((r) => r.type === "staking-position" && r.id === "pos1"));
    assert.ok(rows.some((r) => r.type === "staking-earning" && r.data.yieldCc === 2));
    assert.ok(rows.some((r) => r.type === "staking-receipt" && r.id === "rc1"));
    assert.equal(stakingExportRows({ db, actor: { userId: "u2" } }).length, 0);
  });

  it("exports the authored species codex", () => {
    const catalog = speciesCatalog();
    const rows = creaturesCodexExportRows();
    assert.equal(rows.length, catalog.length);
    if (rows.length) {
      assert.equal(rows[0].type, "species");
      assert.equal(rows[0].id, catalog[0].species_id);
      assert.equal(rows[0].data.clade, catalog[0].clade);
    }
  });

  it("exports telecom outages through the telecom state bag", () => {
    const state = {
      telecom: {
        seq: 3,
        outages: new Map([["u1", [{ id: "out1", name: "Tower 4 down", status: "open" }]]]),
        towers: new Map(),
      },
    };
    const rows = exportCallerLensState(state, "telecommunications", { actor: { userId: "u1" } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "out1");
    assert.equal(exportCallerLensState(state, "telecommunications", { actor: { userId: "u2" } }).length, 0);
  });

  it("exports the caller's quests and civic bonds", () => {
    const db = dbFrom([
      { match: "player_quests", rows: (args) => (args[0] === "u1" ? [{ id: "q1", title: "Find the gate", description: "Go", status: "active", world_id: "w2", completed_at: null }] : []) },
      { match: "civic_bonds", rows: (args) => (args[0] === "u1" ? [{ id: "b1", title: "Bridge", proposer_id: "u1", created_at: 1 }] : []) },
      { match: "civic_bond_pledges", rows: (args) => (args[0] === "u1" ? [{ id: "p1", amount: 5, entity_id: "u1", pledged_at: 2 }] : []) },
    ]);
    const quests = questExportRows({ db, actor: { userId: "u1" } });
    assert.equal(quests.length, 1);
    assert.equal(quests[0].data.worldId, "w2");
    assert.equal(questExportRows({ db, actor: { userId: "other" } }).length, 0);
    const bonds = civicBondExportRows({ db, actor: { userId: "u1" } });
    assert.ok(bonds.some((r) => r.type === "civic-bond" && r.id === "b1"));
    assert.ok(bonds.some((r) => r.type === "civic-pledge"));
  });
});
