import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { creditSparks, getSparks } from "../lib/sparks-service.js";

function openDb() {
  const db = new DatabaseSync(":memory:");
  if (typeof db.transaction !== "function") db.transaction = (fn) => () => fn();
  return db;
}
import { createBond, openBondForVoting, pledgeToBond, cancelBond, getBond } from "../lib/civic-bonds.js";
import { getProfile } from "../emergent/social-layer.js";
import registerSponsorship from "../domains/sponsorship.js";
import registerMarkets from "../domains/markets.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
function call(domain, name, params = {}, ctx = { actor: { userId: "owner" }, userId: "owner" }) {
  const fn = actions.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name}`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerSponsorship(register);
  registerMarkets(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("creator hub, bonds, profiles, and markets", () => {
  it("lets a creator publish to their own hub and still blocks NPC impersonation", () => {
    const me = { actor: { userId: "ada" }, userId: "ada" };
    const posted = call("sponsorship", "publish_post", {
      asSelf: true, title: "Field notes", body: "gold body", minTier: "gold",
    }, me);
    assert.equal(posted.ok, true);
    assert.equal(posted.result.post.creatorId, "ada");
    const feed = call("sponsorship", "feed", { creatorId: "ada" }, me);
    assert.equal(feed.ok, true);
    assert.equal(feed.result.posts[0].title, "Field notes");
    assert.equal(feed.result.posts[0].locked, false);
    assert.equal(feed.result.posts[0].body, "gold body");
    const impersonate = call("sponsorship", "publish_post", {
      creatorId: "npc_arden", title: "Not theirs",
    }, me);
    assert.equal(impersonate.ok, false);
    assert.equal(impersonate.error, "admin_only");
  });

  it("refunds escrow when the proposer cancels before funding", () => {
    const db = openDb();
    db.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 0, concordia_credits INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE sparks_ledger (id TEXT PRIMARY KEY, user_id TEXT, delta INTEGER, reason TEXT, world_id TEXT);
      CREATE TABLE civic_bonds (
        id TEXT PRIMARY KEY, world_id TEXT, realm_id TEXT, faction_id TEXT, org_id TEXT, proposer_id TEXT,
        title TEXT, description TEXT, category TEXT, scope TEXT, labor_source TEXT,
        target_amount INTEGER, denomination INTEGER, return_rate REAL, spillover_rate REAL,
        funding_gate_pct REAL, quorum INTEGER, approval_threshold REAL,
        status TEXT NOT NULL DEFAULT 'proposed', voting_status TEXT, current_pledged INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE civic_bond_pledges (
        id TEXT PRIMARY KEY, bond_id TEXT, entity_kind TEXT, entity_id TEXT, amount INTEGER, status TEXT,
        UNIQUE (bond_id, entity_kind, entity_id)
      );
      CREATE TABLE civic_bond_milestones (id TEXT PRIMARY KEY, bond_id TEXT, idx INTEGER, description TEXT, release_pct REAL);
    `);
    try {
      db.prepare(`INSERT INTO users (id, sparks) VALUES (?, 0)`).run("pledger");
      creditSparks(db, { holderKind: "player", holderId: "pledger", amount: 500, reason: "seed" });
      const made = createBond(db, {
        worldId: "w1", title: "Drive", targetAmount: 10000, denomination: 100, proposerId: "maker",
      });
      assert.equal(made.ok, true);
      openBondForVoting(db, made.bondId);
      const pledged = pledgeToBond(db, made.bondId, { entityKind: "player", entityId: "pledger", amount: 100 });
      assert.equal(pledged.ok, true, pledged.reason);
      assert.equal(getSparks(db, "player", "pledger"), 400);
      const cancelled = cancelBond(db, made.bondId);
      assert.equal(cancelled.ok, true);
      assert.equal(cancelled.refunded, 100);
      assert.equal(cancelled.status, "cancelled");
      assert.equal(getBond(db, made.bondId).bond.status, "cancelled");
      assert.equal(getSparks(db, "player", "pledger"), 500);
      assert.equal(cancelBond(db, made.bondId).reason, "terminal");

      const funded = createBond(db, {
        worldId: "w1", title: "Already funded", targetAmount: 1000, denomination: 100, proposerId: "maker",
      });
      db.prepare(`UPDATE civic_bonds SET status='active' WHERE id=?`).run(funded.bondId);
      assert.equal(cancelBond(db, funded.bondId).reason, "already_funded");
    } finally {
      db.close();
    }
  });

  it("reads a public profile stored in sqlite by id and by username", () => {
    const db = openDb();
    db.exec(`
      CREATE TABLE social_profiles (
        user_id TEXT PRIMARY KEY, display_name TEXT, bio TEXT, avatar_url TEXT,
        website TEXT, is_public INTEGER, payload_json TEXT, updated_at INTEGER
      );
      CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, is_active INTEGER NOT NULL DEFAULT 1);
    `);
    const payload = {
      userId: "user_zuko", displayName: "Zuko", username: "zukotest210101829", isPublic: true, stats: {},
    };
    db.prepare(`INSERT INTO social_profiles (user_id, display_name, bio, avatar_url, website, is_public, payload_json, updated_at)
      VALUES (?,?,?,?,?,?,?,?)`).run("user_zuko", "Zuko", "", "", "", 1, JSON.stringify(payload), 1);
    db.prepare("INSERT INTO users (id, username, is_active) VALUES (?,?,1)").run("user_zuko", "zukotest210101829");
    const STATE = {
      db,
      dtus: new Map(),
      _social: {
        profiles: new Map(),
        posts: new Map([["p1", { id: "p1" }]]),
        messages: new Map(),
        notifications: new Map(),
        follows: new Map(),
        followers: new Map(),
        publicDtus: new Set(),
        citedBy: new Map(),
        metrics: {},
      },
    };
    const byId = getProfile(STATE, "user_zuko", "stranger");
    assert.equal(byId.ok, true);
    assert.equal(byId.profile.displayName, "Zuko");
    assert.equal(byId.profile.isPublic, true);
    const byName = getProfile(STATE, "zukotest210101829", "stranger");
    assert.equal(byName.ok, true);
    assert.equal(byName.profile.userId, "user_zuko");
    db.close();
  });

  it("lets the creator edit a description and refuses a question change once a position exists", () => {
    const created = call("markets", "market-create", {
      question: "Will it rain tomorrow?",
      resolutionCriteria: "A gauge reads rain.",
      description: "First",
    });
    assert.equal(created.ok, true);
    const marketId = created.result.market.id;
    const edited = call("markets", "market-update", { marketId, description: "Second note" });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.market.description, "Second note");
    assert.equal(call("markets", "position-open", { marketId, side: "yes", stakeSparks: 5 }).ok, true);
    const question = call("markets", "market-update", { marketId, question: "A different question here" });
    assert.equal(question.ok, false);
    assert.match(question.error, /question/);
    const cancel = call("markets", "market-cancel", { marketId });
    assert.equal(cancel.ok, false);
    assert.match(cancel.error, /positions/);
    assert.equal(call("markets", "market-get", { marketId }).result.market.description, "Second note");
  });
});
