// server/tests/smoking-gun-sprint-2.test.js
//
// Sprint 2 cleanup: gameProfiles + customPersonas + councilProposals
// durable persistence (migration 231 + lib/state-map-persistence.js).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  getGameProfileRow, upsertGameProfile, allGameProfiles, hydrateGameProfilesMap,
  getCustomPersonaRow, upsertCustomPersona, deleteCustomPersona, allCustomPersonas, hydrateCustomPersonasMap,
  getCouncilProposalRow, upsertCouncilProposal, allCouncilProposals, hydrateCouncilProposalsMap, expireOverdueProposals,
} from "../lib/state-map-persistence.js";

let db;

before(async () => {
  db = new Database(":memory:");
  const m = await import("../migrations/231_state_map_persistence.js");
  m.up(db);
});
after(() => { try { db.close(); } catch { /* ok */ } });

// ─── C2 game_profiles ──────────────────────────────────────────

describe("C2 — game_profiles round-trip", () => {
  it("upsert + get returns identical shape", () => {
    const profile = {
      userId: "u_gp1", xp: 250, level: 3,
      badges: ["first_dtu", "council_voter"],
      streak: 5, lastActivityAt: "2026-05-18T12:00:00.000Z",
      questsCompleted: 7, concordCoin: 42.5,
    };
    upsertGameProfile(db, profile);
    const got = getGameProfileRow(db, "u_gp1");
    assert.deepEqual(got.badges, ["first_dtu", "council_voter"]);
    assert.equal(got.xp, 250);
    assert.equal(got.level, 3);
    assert.equal(got.questsCompleted, 7);
    assert.equal(got.concordCoin, 42.5);
  });

  it("upsert is idempotent — second call updates", () => {
    upsertGameProfile(db, { userId: "u_gp2", xp: 100, level: 1, badges: [] });
    upsertGameProfile(db, { userId: "u_gp2", xp: 500, level: 5, badges: ["a"] });
    const got = getGameProfileRow(db, "u_gp2");
    assert.equal(got.xp, 500);
    assert.equal(got.level, 5);
  });

  it("hydrateGameProfilesMap warms the shim", () => {
    upsertGameProfile(db, { userId: "u_hyd1", xp: 1, level: 1, badges: [] });
    upsertGameProfile(db, { userId: "u_hyd2", xp: 2, level: 1, badges: [] });
    const map = new Map();
    const n = hydrateGameProfilesMap(db, map);
    assert.ok(n >= 2);
    assert.ok(map.has("u_hyd1"));
    assert.ok(map.has("u_hyd2"));
  });

  it("allGameProfiles returns all rows", () => {
    const all = allGameProfiles(db);
    assert.ok(all.length >= 2);
    assert.ok(all.every((p) => p.userId && typeof p.xp === "number"));
  });
});

// ─── C3 custom_personas ────────────────────────────────────────

describe("C3 — custom_personas round-trip", () => {
  it("upsert + get preserves 5-axis style + traits", () => {
    const persona = {
      id: "persona:test1",
      name: "Critic",
      description: "Skeptical reviewer",
      style: { verbosity: 0.3, formality: 0.8, skepticism: 0.95, creativity: 0.4, empathy: 0.5 },
      traits: ["pedantic", "thorough"],
      systemPrompt: "You are a critic.",
      usageCount: 0,
      createdAt: "2026-05-18T12:00:00.000Z",
      updatedAt: "2026-05-18T12:00:00.000Z",
    };
    upsertCustomPersona(db, persona);
    const got = getCustomPersonaRow(db, "persona:test1");
    assert.equal(got.name, "Critic");
    assert.equal(got.style.skepticism, 0.95);
    assert.deepEqual(got.traits, ["pedantic", "thorough"]);
    assert.equal(got.systemPrompt, "You are a critic.");
  });

  it("deleteCustomPersona removes the row", () => {
    upsertCustomPersona(db, {
      id: "persona:del", name: "Doomed", description: "", style: {}, traits: [], systemPrompt: "",
      createdAt: "2026-05-18T12:00:00.000Z", updatedAt: "2026-05-18T12:00:00.000Z",
    });
    assert.ok(getCustomPersonaRow(db, "persona:del"));
    deleteCustomPersona(db, "persona:del");
    assert.equal(getCustomPersonaRow(db, "persona:del"), null);
  });

  it("hydrateCustomPersonasMap warms shim", () => {
    const map = new Map();
    const n = hydrateCustomPersonasMap(db, map);
    assert.ok(n >= 1);
    assert.ok(map.has("persona:test1"));
  });
});

// ─── C4 council_proposals ──────────────────────────────────────

describe("C4 — council_proposals durable + expiry", () => {
  it("upsert + get round-trip preserves votes dict", () => {
    const proposal = {
      id: "prop:test1",
      type: "promotion_to_global",
      dtuId: "dtu:xyz",
      proposedBy: "u_proposer",
      reason: "high quality",
      status: "pending",
      votes: { "u_voter1": "approve", "u_voter2": "approve" },
      globalDtuId: null,
      createdAt: "2026-05-18T12:00:00.000Z",
      expiresAt: "2026-05-25T12:00:00.000Z",
    };
    upsertCouncilProposal(db, proposal);
    const got = getCouncilProposalRow(db, "prop:test1");
    assert.equal(got.proposedBy, "u_proposer");
    assert.deepEqual(got.votes, { u_voter1: "approve", u_voter2: "approve" });
    assert.equal(got.status, "pending");
  });

  it("CHECK constraint rejects invalid status", () => {
    assert.throws(() => {
      db.prepare(`
        INSERT INTO council_proposals (id, type, dtu_id, proposed_by, status, created_at, expires_at)
        VALUES ('prop:bad', 'x', 'dtu:y', 'u', 'WEIRD_STATUS', '2026-05-18T12:00:00Z', '2026-05-25T12:00:00Z')
      `).run();
    }, /CHECK/);
  });

  it("expireOverdueProposals flips pending → expired", () => {
    upsertCouncilProposal(db, {
      id: "prop:expired",
      type: "promotion_to_global",
      dtuId: "dtu:x",
      proposedBy: "u_p",
      reason: "",
      status: "pending",
      votes: {},
      createdAt: "2026-05-01T12:00:00.000Z",
      expiresAt: "2026-05-02T12:00:00.000Z", // way past
    });
    const n = expireOverdueProposals(db);
    assert.ok(n >= 1);
    const got = getCouncilProposalRow(db, "prop:expired");
    assert.equal(got.status, "expired");
  });

  it("allCouncilProposals + status filter", () => {
    const pending = allCouncilProposals(db, { status: "pending" });
    const expired = allCouncilProposals(db, { status: "expired" });
    assert.ok(pending.find((p) => p.id === "prop:test1"));
    assert.ok(expired.find((p) => p.id === "prop:expired"));
  });

  it("hydrateCouncilProposalsMap warms shim", () => {
    const map = new Map();
    const n = hydrateCouncilProposalsMap(db, map);
    assert.ok(n >= 2);
  });
});
