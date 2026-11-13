// FIX-social-019 — sidebar Search social finds the people Find people finds.
//
// searchSocial's people leg scanned only the social-profiles map, so a
// person with an account but no social profile yet — findable in
// Explore's Find people, which also matches the users table — was
// invisible to the sidebar search. The people leg now unions both
// sources, deduped, with the profile's display name winning and the
// blocked filter intact.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up } from "../migrations/482_social_canonical_store.js";
import { upsertProfile } from "../emergent/social-layer.js";
import { searchSocial } from "../lib/social-feeds.js";

function fresh() {
  const db = new Database(":memory:");
  up(db);
  db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, is_active INTEGER DEFAULT 1)");
  const STATE = { db, dtus: new Map(), socialLens: { moderation: new Map() } };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  return STATE;
}

describe("searchSocial people union (FIX-social-019)", { concurrency: 1 }, () => {
  beforeEach(() => { fresh(); });

  it("finds an account-only person, and dedupes a person present in both sources", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    upsertProfile(STATE, "bea", { displayName: "Bea Quartz", isPublic: true });
    // bea has an account too; rhea has ONLY an account (no social profile).
    STATE.db.prepare("INSERT INTO users (id, username, is_active) VALUES (?, ?, 1)").run("bea", "bea");
    STATE.db.prepare("INSERT INTO users (id, username, is_active) VALUES (?, ?, 1)").run("u-rhea", "rhea");

    const byAccount = searchSocial(STATE, "ana", "rhea");
    assert.equal(byAccount.people.length, 1);
    assert.equal(byAccount.people[0].id, "u-rhea");
    assert.equal(byAccount.people[0].username, "rhea");

    const byProfile = searchSocial(STATE, "ana", "bea");
    assert.equal(byProfile.people.length, 1);
    assert.equal(byProfile.people[0].id, "bea");
    assert.equal(byProfile.people[0].displayName, "Bea Quartz");
  });

  it("keeps an inactive account and a blocked person out", () => {
    const STATE = globalThis._concordSTATE;
    upsertProfile(STATE, "ana", { displayName: "Ana", isPublic: true });
    STATE.db.prepare("INSERT INTO users (id, username, is_active) VALUES (?, ?, 0)").run("u-ghost", "ghostie");
    STATE.db.prepare("INSERT INTO users (id, username, is_active) VALUES (?, ?, 1)").run("u-blocked", "blockie");
    STATE.socialLens.moderation.set("ana", { muted: new Set(), blocked: new Set(["u-blocked"]) });

    assert.equal(searchSocial(STATE, "ana", "ghostie").people.length, 0);
    assert.equal(searchSocial(STATE, "ana", "blockie").people.length, 0);
  });
});
