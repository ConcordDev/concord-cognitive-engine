// Phase BC2 — NPC mentor registry tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  registerMentorProfile,
  listMentorsInWorld,
  getMentorProfile,
  setMentorAvailability,
  maybePromoteToMentor,
} from "../lib/mentorship.js";
import { up as upMentor } from "../migrations/239_npc_mentor_profiles.js";

function freshDb() { const db = new Database(":memory:"); upMentor(db); return db; }

describe("Phase BC2 — mentor registry", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("registerMentorProfile is idempotent on PK", () => {
    const a = registerMentorProfile(db, {
      npcId: "npc-1", worldId: "tunya", skillCategory: "sword", depth: 3,
    });
    assert.equal(a.ok, true);
    const b = registerMentorProfile(db, {
      npcId: "npc-1", worldId: "tunya", skillCategory: "sword", depth: 7,
    });
    assert.equal(b.ok, true);
    const profile = getMentorProfile(db, "npc-1");
    assert.equal(profile.depth, 7, "PK upsert raised depth");
  });

  it("listMentorsInWorld filters by world + availability + skill category", () => {
    registerMentorProfile(db, { npcId: "n1", worldId: "tunya", skillCategory: "sword", depth: 3 });
    registerMentorProfile(db, { npcId: "n2", worldId: "tunya", skillCategory: "alchemy", depth: 5 });
    registerMentorProfile(db, { npcId: "n3", worldId: "cyber", skillCategory: "sword", depth: 2 });
    setMentorAvailability(db, "n1", false);

    const tunyaSword = listMentorsInWorld(db, "tunya", { skillCategory: "sword" });
    assert.equal(tunyaSword.length, 0, "n1 was set unavailable; n3 is cyber");
    const tunyaAll = listMentorsInWorld(db, "tunya");
    assert.equal(tunyaAll.length, 1, "only n2 available in tunya");
    assert.equal(tunyaAll[0].npc_id, "n2");
  });

  it("listMentorsInWorld sorts by depth DESC", () => {
    registerMentorProfile(db, { npcId: "low", worldId: "tunya", skillCategory: "sword", depth: 2 });
    registerMentorProfile(db, { npcId: "hi", worldId: "tunya", skillCategory: "sword", depth: 9 });
    const list = listMentorsInWorld(db, "tunya");
    assert.equal(list[0].npc_id, "hi");
  });

  it("missing fields are rejected", () => {
    assert.equal(registerMentorProfile(db, { worldId: "tunya", skillCategory: "sword" }).ok, false);
    assert.equal(registerMentorProfile(db, { npcId: "x", skillCategory: "sword" }).ok, false);
    assert.equal(registerMentorProfile(db, { npcId: "x", worldId: "tunya" }).ok, false);
  });

  it("maybePromoteToMentor promotes at revision >= 5", () => {
    const a = maybePromoteToMentor(db, {
      npcId: "p1", worldId: "tunya", skillCategory: "sword", revisionNum: 3,
    });
    assert.equal(a.promoted, false);
    const b = maybePromoteToMentor(db, {
      npcId: "p1", worldId: "tunya", skillCategory: "sword", revisionNum: 5,
    });
    assert.equal(b.promoted, true);
    assert.equal(getMentorProfile(db, "p1").promoted_from, "skill_evolution");
  });

  it("maybePromoteToMentor is idempotent (no-op on already-registered)", () => {
    maybePromoteToMentor(db, {
      npcId: "p1", worldId: "tunya", skillCategory: "sword", revisionNum: 5,
    });
    const r = maybePromoteToMentor(db, {
      npcId: "p1", worldId: "tunya", skillCategory: "sword", revisionNum: 7,
    });
    assert.equal(r.promoted, false);
    assert.equal(r.reason, "already_registered");
  });

  it("missing inputs in promote are guarded", () => {
    const r = maybePromoteToMentor(db, { revisionNum: 5 });
    assert.equal(r.ok, false);
  });
});
