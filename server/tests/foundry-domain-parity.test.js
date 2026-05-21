/**
 * Tier-2 contract tests for Foundry Phase 8 — the seven Roblox-Studio-
 * parity builder extensions added to the `foundry` domain:
 *
 *   1. Visual scripting   — blueprint_kinds / blueprint_get / blueprint_save
 *   2. Playtest hot-reload — playtest_start / playtest_reload / playtest_end
 *   3. Asset library       — asset_kinds / asset_import / asset_list / asset_remove
 *   4. Multiplayer config  — matchmaking_modes / multiplayer_get / multiplayer_set
 *   5. Games marketplace   — marketplace / rate / ratings
 *   6. Analytics dashboard — track_play / analytics
 *   7. Collaboration       — collab_roles / collab_add / collab_remove /
 *                            collab_list / collab_ping
 *
 * Each macro is exercised against an in-memory DB; every success path
 * asserts ok === true and every guard path asserts the documented reason.
 *
 * Run: node --test server/tests/foundry-domain-parity.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate191 } from "../migrations/191_foundry_worlds.js";
import registerFoundryMacros from "../domains/foundry.js";

// ── Harness ─────────────────────────────────────────────────────────────────

function makeHarness() {
  // Foundry Phase-8 macros keep auxiliary state in globalThis._concordSTATE;
  // clear it so each test starts from a clean slate.
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.foundry;

  const db = new Database(":memory:");
  migrate191(db);
  db.exec(`
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, universe_type TEXT NOT NULL,
      description TEXT, physics_modulators TEXT DEFAULT '{}', rule_modulators TEXT DEFAULT '{}',
      created_by TEXT, status TEXT NOT NULL DEFAULT 'active', total_visits INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT 0
    )
  `);
  const macros = new Map();
  registerFoundryMacros((domain, name, handler) => macros.set(`${domain}.${name}`, handler));
  const call = (name, input, actor = { userId: "user-1" }) =>
    macros.get(name)({ db, actor }, input || {});

  // A draft world owned by user-1 with one valid system.
  const draft = call("foundry.create", {
    name: "Test Game",
    worldspec: { theme: { universeType: "fantasy" }, systems: [{ id: "combat-motor" }] },
  });
  return { db, call, draftId: draft.world.id };
}

// ── 1. Visual scripting / blueprint editor ──────────────────────────────────

describe("foundry blueprint editor", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("blueprint_kinds exposes the node vocabulary", () => {
    const r = h.call("foundry.blueprint_kinds", {});
    assert.equal(r.ok, true);
    assert.ok(r.nodeKinds.includes("event"));
    assert.ok(r.eventTypes.includes("on_start"));
    assert.ok(r.actionTypes.includes("award_points"));
  });

  it("blueprint_save persists a graph; blueprint_get reads it back", () => {
    const save = h.call("foundry.blueprint_save", {
      id: h.draftId,
      nodes: [
        { id: "n1", kind: "event", type: "on_start", label: "Start" },
        { id: "n2", kind: "action", type: "award_points", label: "Reward" },
      ],
      edges: [{ from: "n1", to: "n2" }],
    });
    assert.equal(save.ok, true);
    assert.equal(save.validation.ok, true);

    const get = h.call("foundry.blueprint_get", { id: h.draftId });
    assert.equal(get.ok, true);
    assert.equal(get.blueprint.nodes.length, 2);
    assert.equal(get.blueprint.edges.length, 1);
  });

  it("blueprint_save rejects an empty graph", () => {
    const r = h.call("foundry.blueprint_save", { id: h.draftId, nodes: [], edges: [] });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "empty_blueprint");
  });
});

// ── 2. Playtest hot-reload loop ─────────────────────────────────────────────

describe("foundry playtest hot-reload", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("start → reload → end runs the iterate loop", () => {
    const start = h.call("foundry.playtest_start", { id: h.draftId });
    assert.equal(start.ok, true);
    assert.equal(start.session.revision, 1);
    const previewId = start.session.previewWorldId;
    assert.ok(h.db.prepare(`SELECT id FROM worlds WHERE id = ? AND status = 'preview'`).get(previewId));

    const reload = h.call("foundry.playtest_reload", { sessionId: start.session.sessionId });
    assert.equal(reload.ok, true);
    assert.equal(reload.session.revision, 2);

    const end = h.call("foundry.playtest_end", { sessionId: start.session.sessionId });
    assert.equal(end.ok, true);
    assert.equal(h.db.prepare(`SELECT id FROM worlds WHERE id = ?`).get(previewId), undefined);
  });

  it("playtest_reload rejects an unknown session", () => {
    const r = h.call("foundry.playtest_reload", { sessionId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "session_not_found");
  });
});

// ── 3. Asset library ────────────────────────────────────────────────────────

describe("foundry asset library", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("asset_kinds lists the importable kinds", () => {
    const r = h.call("foundry.asset_kinds", {});
    assert.equal(r.ok, true);
    assert.ok(r.kinds.includes("model"));
    assert.ok(r.kinds.includes("audio"));
  });

  it("asset_import → asset_list → asset_remove round-trip", () => {
    const imp = h.call("foundry.asset_import", {
      id: h.draftId, kind: "model", name: "Castle", url: "https://cdn.example.com/castle.glb",
      tags: ["building", "stone"],
    });
    assert.equal(imp.ok, true);
    assert.equal(imp.asset.kind, "model");

    const list = h.call("foundry.asset_list", { id: h.draftId });
    assert.equal(list.ok, true);
    assert.equal(list.count, 1);

    const rm = h.call("foundry.asset_remove", { id: h.draftId, assetId: imp.asset.id });
    assert.equal(rm.ok, true);
    assert.equal(h.call("foundry.asset_list", { id: h.draftId }).count, 0);
  });

  it("asset_import rejects a bad payload", () => {
    const r = h.call("foundry.asset_import", { id: h.draftId, kind: "banana", name: "", url: "" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_asset");
    assert.ok(r.errors.length >= 1);
  });
});

// ── 4. Multiplayer lobby + matchmaking ──────────────────────────────────────

describe("foundry multiplayer config", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("matchmaking_modes lists the modes", () => {
    const r = h.call("foundry.matchmaking_modes", {});
    assert.equal(r.ok, true);
    assert.ok(r.modes.includes("lobby"));
    assert.ok(r.modes.includes("skill_based"));
  });

  it("multiplayer_set writes config; multiplayer_get reads it; clamps bounds", () => {
    const set = h.call("foundry.multiplayer_set", {
      id: h.draftId, enabled: true, minPlayers: 2, maxPlayers: 9999,
      matchmaking: "skill_based", lobbyCountdownSec: 45, teamCount: 2, fillBots: true,
    });
    assert.equal(set.ok, true);
    assert.equal(set.multiplayer.maxPlayers, 256); // clamped
    assert.equal(set.multiplayer.matchmaking, "skill_based");

    const get = h.call("foundry.multiplayer_get", { id: h.draftId });
    assert.equal(get.ok, true);
    assert.equal(get.multiplayer.minPlayers, 2);
    assert.equal(get.multiplayer.fillBots, true);
  });

  it("multiplayer_set rejects min > max", () => {
    const r = h.call("foundry.multiplayer_set", { id: h.draftId, minPlayers: 20, maxPlayers: 4 });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "min_exceeds_max");
  });
});

// ── 5. Games marketplace (discovery + ratings) ──────────────────────────────

describe("foundry games marketplace", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("marketplace lists published games with ratings; rate + ratings work", () => {
    // Add a publishable system + publish the draft.
    h.call("foundry.update", {
      id: h.draftId,
      worldspec: { theme: { universeType: "fantasy" }, systems: [{ id: "combat-motor" }, { id: "physics-modifiers" }] },
    });
    const pub = h.call("foundry.publish", { id: h.draftId });
    assert.equal(pub.ok, true);

    const market = h.call("foundry.marketplace", { sort: "recent" });
    assert.equal(market.ok, true);
    assert.equal(market.count, 1);
    assert.equal(market.games[0].id, h.draftId);

    // A different user rates it 5 stars.
    const rate = h.call("foundry.rate", { id: h.draftId, stars: 5, review: "great" }, { userId: "user-2" });
    assert.equal(rate.ok, true);
    assert.equal(rate.avgRating, 5);

    const ratings = h.call("foundry.ratings", { id: h.draftId });
    assert.equal(ratings.ok, true);
    assert.equal(ratings.ratingCount, 1);
    assert.equal(ratings.reviews[0].review, "great");
  });

  it("rate blocks the creator rating their own game + bad star counts", () => {
    h.call("foundry.update", {
      id: h.draftId,
      worldspec: { theme: { universeType: "fantasy" }, systems: [{ id: "combat-motor" }, { id: "physics-modifiers" }] },
    });
    h.call("foundry.publish", { id: h.draftId });
    assert.equal(h.call("foundry.rate", { id: h.draftId, stars: 5 }).reason, "cannot_rate_own_game");
    assert.equal(
      h.call("foundry.rate", { id: h.draftId, stars: 9 }, { userId: "user-2" }).reason,
      "invalid_stars",
    );
  });
});

// ── 6. Game analytics dashboard ─────────────────────────────────────────────

describe("foundry analytics dashboard", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("track_play feeds analytics; analytics summarizes them", () => {
    assert.equal(h.call("foundry.track_play", { id: h.draftId, event: "play" }, { userId: "p1" }).ok, true);
    assert.equal(h.call("foundry.track_play", { id: h.draftId, event: "play" }, { userId: "p2" }).ok, true);
    assert.equal(h.call("foundry.track_play", { id: h.draftId, event: "completion" }, { userId: "p1" }).ok, true);
    h.call("foundry.track_play", { id: h.draftId, event: "session", durationSec: 240 }, { userId: "p1" });

    const a = h.call("foundry.analytics", { id: h.draftId });
    assert.equal(a.ok, true);
    assert.equal(a.summary.totalPlays, 2);
    assert.equal(a.summary.uniquePlayers, 2);
    assert.equal(a.summary.totalCompletions, 1);
    assert.equal(a.summary.completionRate, 0.5);
    assert.equal(a.summary.avgSessionSec, 240);
    assert.equal(a.summary.playsByDay.length, 7);
  });

  it("track_play rejects an unknown event kind", () => {
    const r = h.call("foundry.track_play", { id: h.draftId, event: "explode" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_event");
  });
});

// ── 7. Collaborative multi-builder editing ──────────────────────────────────

describe("foundry collaboration", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("collab_roles lists the roles", () => {
    const r = h.call("foundry.collab_roles", {});
    assert.equal(r.ok, true);
    assert.ok(r.roles.includes("editor"));
    assert.ok(r.roles.includes("viewer"));
  });

  it("collab_add grants access; collab_list shows roster + presence; remove revokes", () => {
    const add = h.call("foundry.collab_add", { id: h.draftId, userId: "user-2", role: "editor" });
    assert.equal(add.ok, true);

    // The collaborator can now load the world + ping presence.
    const ping = h.call("foundry.collab_ping", { id: h.draftId, node: "scripting" }, { userId: "user-2" });
    assert.equal(ping.ok, true);

    const list = h.call("foundry.collab_list", { id: h.draftId });
    assert.equal(list.ok, true);
    assert.equal(list.owner, "user-1");
    assert.equal(list.collaborators.length, 1);
    assert.equal(list.online.length, 1);
    assert.equal(list.online[0].userId, "user-2");

    const rm = h.call("foundry.collab_remove", { id: h.draftId, userId: "user-2" });
    assert.equal(rm.ok, true);
    assert.equal(h.call("foundry.collab_list", { id: h.draftId }).collaborators.length, 0);
  });

  it("an editor collaborator can save a blueprint; a viewer cannot", () => {
    h.call("foundry.collab_add", { id: h.draftId, userId: "editor-u", role: "editor" });
    h.call("foundry.collab_add", { id: h.draftId, userId: "viewer-u", role: "viewer" });

    const editorSave = h.call("foundry.blueprint_save", {
      id: h.draftId, nodes: [{ id: "n1", kind: "event", type: "on_start", label: "Go" }], edges: [],
    }, { userId: "editor-u" });
    assert.equal(editorSave.ok, true);

    const viewerSave = h.call("foundry.blueprint_save", {
      id: h.draftId, nodes: [{ id: "n1", kind: "event", type: "on_start", label: "Go" }], edges: [],
    }, { userId: "viewer-u" });
    assert.equal(viewerSave.ok, false);
    assert.equal(viewerSave.reason, "viewer_cannot_edit");
  });

  it("collab_add is owner-only + rejects self-add", () => {
    assert.equal(
      h.call("foundry.collab_add", { id: h.draftId, userId: "x" }, { userId: "stranger" }).reason,
      "not_owner",
    );
    assert.equal(h.call("foundry.collab_add", { id: h.draftId, userId: "user-1" }).reason, "cannot_add_self");
  });
});
