// SL5 — social gathering composer. Pins the attendee/beat composition per kind:
// a wedding seats a grudge-holder for tension, a funeral assembles the bereaved
// + rivals and triggers grief, a festival gathers the community; attendees
// de-dupe by name.
//
// Run: node --test tests/social-gatherings.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { composeGathering, gatherAttendees, GATHERING_KINDS } from "../lib/social-gatherings.js";

describe("composeGathering — wedding", () => {
  it("seats the couple + family + a single grudge-holder for tension", () => {
    const g = composeGathering({
      kind: "wedding", focalName: "Iyenn",
      partners: ["Sand-Mother Vesh"], family: ["Old Seam"], friends: ["Brackish"],
      grudgeHolders: ["Kel the Spurned", "Another Rival"],
    });
    const roles = g.attendees.map((a) => a.role);
    assert.ok(roles.includes("celebrant") && roles.includes("partner"));
    assert.equal(g.attendees.filter((a) => a.role === "uninvited").length, 1); // ONE grudge-holder
    assert.ok(g.beats.some((b) => b.includes("vows")));
    assert.ok(g.beats.some((b) => b.includes("unsmiling")));
    assert.equal(g.triggersGrief, false);
  });

  it("a wedding with no grudge-holder reads as pure celebration", () => {
    const g = composeGathering({ kind: "wedding", focalName: "A", partners: ["B"] });
    assert.ok(g.beats.some((b) => b.includes("celebration")));
    assert.equal(g.attendees.some((a) => a.role === "uninvited"), false);
  });
});

describe("composeGathering — funeral", () => {
  it("assembles the bereaved + rivals and triggers the grief path", () => {
    const g = composeGathering({
      kind: "funeral", focalName: "Asbir",
      family: ["Heir"], friends: ["Comrade"], grudgeHolders: ["The Usurper"],
    });
    assert.equal(g.triggersGrief, true);
    assert.ok(g.attendees.some((a) => a.role === "bereaved"));
    assert.ok(g.attendees.some((a) => a.role === "rival"));
    assert.ok(g.beats.some((b) => b.includes("eulogy")));
  });
});

describe("composeGathering — general", () => {
  it("festival gathers the community; unknown kind falls back to festival", () => {
    const g = composeGathering({ kind: "harvest_dance", focalName: "Mayor", friends: ["X", "Y"] });
    assert.equal(g.kind, "festival");
    assert.ok(g.attendees.some((a) => a.role === "host"));
  });

  it("de-dupes an attendee who fills two relations", () => {
    const g = composeGathering({ kind: "wedding", focalName: "A", partners: ["Bo"], family: ["Bo"] });
    assert.equal(g.attendees.filter((a) => a.name === "Bo").length, 1);
  });

  it("exposes the kind set", () => {
    assert.deepEqual(GATHERING_KINDS, ["wedding", "funeral", "festival"]);
  });
});

describe("gatherAttendees — db-reader (SL5 caller)", () => {
  let db;
  beforeEach(async () => { db = new Database(":memory:"); await runMigrations(db); });
  afterEach(() => { try { db.close(); } catch { /* noop */ } });

  it("resolves an NPC funeral from the live relationship + grudge web", () => {
    db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, state) VALUES ('n_focal','w','generic',?)").run(JSON.stringify({ name: "Old Seam" }));
    db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, state) VALUES ('n_kid','w','generic',?)").run(JSON.stringify({ name: "Sprout" }));
    db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, state) VALUES ('n_rival','w','generic',?)").run(JSON.stringify({ name: "Kel the Spurned" }));
    db.prepare("INSERT INTO npc_relationships (id, npc_id, related_id, rel_type, strength) VALUES ('r1','n_focal','n_kid','child',1.0)").run();
    db.prepare("INSERT INTO npc_grudges (id, npc_id, target_kind, target_id, narrative, severity) VALUES ('g1','n_rival','npc','n_focal','old debt',8)").run();

    const g = gatherAttendees(db, { kind: "funeral", focalKind: "npc", focalId: "n_focal" });
    assert.equal(g.kind, "funeral");
    assert.equal(g.triggersGrief, true);
    const names = g.attendees.map((a) => a.name);
    assert.ok(names.includes("Sprout"), "bereaved kin attends");
    assert.ok(names.includes("Kel the Spurned"), "rival attends a funeral");
    assert.ok(g.beats.some((b) => b.includes("Old Seam")), "eulogy names the deceased");
  });

  it("degrades to a sparse-but-valid gathering with no relations", () => {
    db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, state) VALUES ('lonely','w','generic','{}')").run();
    const g = gatherAttendees(db, { kind: "festival", focalKind: "npc", focalId: "lonely" });
    assert.equal(g.kind, "festival");
    assert.ok(Array.isArray(g.attendees) && g.attendees.length >= 1); // at least the host
    assert.ok(Array.isArray(g.beats) && g.beats.length >= 1);
  });

  it("resolves a player wedding from active courtship", () => {
    db.prepare("INSERT INTO users (id, username, email, password_hash, created_at) VALUES ('u1','Iyenn','i@local','x',unixepoch())").run();
    db.prepare("INSERT INTO world_npcs (id, world_id, npc_type, state) VALUES ('beloved','w','generic',?)").run(JSON.stringify({ name: "Sand-Mother Vesh" }));
    db.prepare("INSERT INTO player_courtship (player_user_id, partner_kind, partner_id, affinity, status) VALUES ('u1','npc','beloved',0.9,'engaged')").run();
    const g = gatherAttendees(db, { kind: "wedding", focalKind: "player", focalId: "u1" });
    const names = g.attendees.map((a) => a.name);
    assert.ok(names.includes("Iyenn"), "celebrant is the player's username");
    assert.ok(names.includes("Sand-Mother Vesh"), "the courtship partner attends");
  });
});
