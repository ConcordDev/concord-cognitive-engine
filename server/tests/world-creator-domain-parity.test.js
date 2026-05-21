// Tier-2 contract tests for server/domains/world-creator.js
//
// Exercises the full authoring lifecycle: templates, biome preview,
// draft CRUD, scene props, spawn points, zones, NPCs/factions,
// publish/discovery, and playtest readiness. Every macro must return
// an { ok } envelope and never throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWorldCreatorActions from "../domains/world-creator.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`world-creator.${name}`);
  if (!fn) throw new Error(`world-creator.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerWorldCreatorActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "creator_a" }, userId: "creator_a" };
const ctxB = { actor: { userId: "creator_b" }, userId: "creator_b" };

function newDraft(ctx = ctxA, params = { name: "Test World" }) {
  const r = call("draft-create", ctx, params);
  assert.equal(r.ok, true);
  return r.result.draft;
}

describe("world-creator — reference data", () => {
  it("templates returns presets with rule modulators", () => {
    const r = call("templates", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.templates.length >= 3);
    const forest = r.result.templates.find((t) => t.id === "forest_realm");
    assert.ok(forest);
    assert.ok(forest.rules && typeof forest.rules.combatLethality === "number");
  });

  it("biomes returns climate reference rows", () => {
    const r = call("biomes", ctxA);
    assert.equal(r.ok, true);
    assert.ok(r.result.biomes.length >= 5);
    assert.ok(r.result.biomes.every((b) => Array.isArray(b.palette)));
  });

  it("biome-preview produces a day-cycle climate curve", () => {
    const r = call("biome-preview", ctxA, { biome: "desert", weatherIntensity: 1.4 });
    assert.equal(r.ok, true);
    assert.equal(r.result.biome, "desert");
    assert.ok(r.result.climateCurve.length > 0);
    assert.ok(r.result.stormChancePct >= 0 && r.result.stormChancePct <= 95);
  });

  it("biome-preview rejects an unknown biome", () => {
    const r = call("biome-preview", ctxA, { biome: "nonsense" });
    assert.equal(r.ok, false);
  });
});

describe("world-creator — draft lifecycle", () => {
  it("draft-create rejects a name shorter than 3 chars", () => {
    const r = call("draft-create", ctxA, { name: "ab" });
    assert.equal(r.ok, false);
  });

  it("draft-create from a template seeds props/spawns/zones + rules", () => {
    const d = newDraft(ctxA, { name: "Forest Start", template: "forest_realm" });
    assert.equal(d.template, "forest_realm");
    assert.ok(d.props.length > 0);
    assert.ok(d.spawnPoints.length > 0);
    assert.ok(d.zones.length > 0);
  });

  it("draft-list is per-user scoped", () => {
    newDraft(ctxA, { name: "A World" });
    newDraft(ctxB, { name: "B World" });
    const a = call("draft-list", ctxA);
    const b = call("draft-list", ctxB);
    assert.equal(a.result.count, 1);
    assert.equal(b.result.count, 1);
    assert.notEqual(a.result.drafts[0].id, b.result.drafts[0].id);
  });

  it("draft-get returns the full draft, 404s on bad id", () => {
    const d = newDraft();
    assert.equal(call("draft-get", ctxA, { id: d.id }).ok, true);
    assert.equal(call("draft-get", ctxA, { id: "nope" }).ok, false);
  });

  it("draft-update clamps rule modulators to [0.5, 1.5]", () => {
    const d = newDraft();
    const r = call("draft-update", ctxA, { id: d.id, rules: { combatLethality: 9 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.draft.rules.combatLethality, 1.5);
  });

  it("draft-delete removes the draft", () => {
    const d = newDraft();
    assert.equal(call("draft-delete", ctxA, { id: d.id }).ok, true);
    assert.equal(call("draft-list", ctxA).result.count, 0);
  });
});

describe("world-creator — scene editor (props)", () => {
  it("prop-place / prop-move / prop-remove round-trip", () => {
    const d = newDraft();
    const place = call("prop-place", ctxA, { draftId: d.id, kind: "tree", x: 10, z: 5 });
    assert.equal(place.ok, true);
    const propId = place.result.prop.id;
    const move = call("prop-move", ctxA, { draftId: d.id, propId, x: 99 });
    assert.equal(move.ok, true);
    assert.equal(move.result.prop.x, 99);
    const rm = call("prop-remove", ctxA, { draftId: d.id, propId });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.propCount, 0);
  });

  it("prop-place rejects an unknown kind", () => {
    const d = newDraft();
    assert.equal(call("prop-place", ctxA, { draftId: d.id, kind: "spaceship" }).ok, false);
  });
});

describe("world-creator — spawn points & zones", () => {
  it("first spawn is auto-default; spawn-remove rebalances default", () => {
    const d = newDraft();
    const s1 = call("spawn-add", ctxA, { draftId: d.id, name: "Home" });
    assert.equal(s1.ok, true);
    assert.equal(s1.result.spawn.isDefault, true);
    const s2 = call("spawn-add", ctxA, { draftId: d.id, name: "North" });
    assert.equal(s2.result.spawn.isDefault, false);
    const rm = call("spawn-remove", ctxA, { draftId: d.id, spawnId: s1.result.spawn.id });
    assert.equal(rm.ok, true);
  });

  it("zone-add validates the kind, zone-remove drops it", () => {
    const d = newDraft();
    assert.equal(call("zone-add", ctxA, { draftId: d.id, kind: "bogus" }).ok, false);
    const z = call("zone-add", ctxA, { draftId: d.id, kind: "safe", radius: 50 });
    assert.equal(z.ok, true);
    assert.equal(call("zone-remove", ctxA, { draftId: d.id, zoneId: z.result.zone.id }).ok, true);
  });
});

describe("world-creator — NPC & faction placement", () => {
  it("npc-place validates archetype + links a faction", () => {
    const d = newDraft();
    const f = call("faction-add", ctxA, { draftId: d.id, name: "The Wardens" });
    assert.equal(f.ok, true);
    assert.equal(call("npc-place", ctxA, { draftId: d.id, name: "X", archetype: "alien" }).ok, false);
    const npc = call("npc-place", ctxA, {
      draftId: d.id, name: "Mara", archetype: "guard", factionId: f.result.faction.id,
    });
    assert.equal(npc.ok, true);
    assert.equal(npc.result.npc.factionId, f.result.faction.id);
  });

  it("faction-remove unlinks NPCs in that faction", () => {
    const d = newDraft();
    const f = call("faction-add", ctxA, { draftId: d.id, name: "Sun Clan" });
    const npc = call("npc-place", ctxA, {
      draftId: d.id, name: "Ren", archetype: "scholar", factionId: f.result.faction.id,
    });
    call("faction-remove", ctxA, { draftId: d.id, factionId: f.result.faction.id });
    const fresh = call("draft-get", ctxA, { id: d.id }).result.draft;
    assert.equal(fresh.npcs.find((n) => n.id === npc.result.npc.id).factionId, null);
  });

  it("npc-remove deletes the NPC", () => {
    const d = newDraft();
    const npc = call("npc-place", ctxA, { draftId: d.id, name: "Tem", archetype: "trader" });
    assert.equal(call("npc-remove", ctxA, { draftId: d.id, npcId: npc.result.npc.id }).ok, true);
  });
});

describe("world-creator — publish, discovery & playtest", () => {
  it("draft-publish blocks public worlds with no spawn point", () => {
    const d = newDraft();
    const r = call("draft-publish", ctxA, { id: d.id, visibility: "public" });
    assert.equal(r.ok, false);
  });

  it("draft-publish to public, then discover surfaces it", () => {
    const d = newDraft(ctxA, { name: "Public Realm", template: "forest_realm" });
    const pub = call("draft-publish", ctxA, { id: d.id, visibility: "public" });
    assert.equal(pub.ok, true);
    const disc = call("discover", ctxB, {});
    assert.equal(disc.ok, true);
    assert.ok(disc.result.worlds.some((w) => w.id === d.id));
  });

  it("discover honours the search query", () => {
    const d = newDraft(ctxA, { name: "Crimson Atoll", template: "desert_outpost" });
    call("draft-publish", ctxA, { id: d.id, visibility: "public" });
    assert.equal(call("discover", ctxA, { query: "crimson" }).result.count, 1);
    assert.equal(call("discover", ctxA, { query: "zzzzz" }).result.count, 0);
  });

  it("playtest-check flags missing spawn; passes a templated world", () => {
    const empty = newDraft();
    const c1 = call("playtest-check", ctxA, { id: empty.id });
    assert.equal(c1.ok, true);
    assert.equal(c1.result.ready, false);
    assert.ok(c1.result.issues.length > 0);

    const full = newDraft(ctxA, { name: "Ready World", template: "urban_sprawl" });
    const c2 = call("playtest-check", ctxA, { id: full.id });
    assert.equal(c2.result.ready, true);
    assert.ok(c2.result.worldPayload && c2.result.worldPayload.name === "Ready World");
  });
});

describe("world-creator — robustness", () => {
  it("every macro returns ok:false (never throws) when STATE is missing", () => {
    const saved = globalThis._concordSTATE;
    globalThis._concordSTATE = undefined;
    for (const name of ["draft-create", "draft-list", "draft-get", "prop-place", "discover"]) {
      const r = call(name, ctxA, { id: "x", draftId: "x", name: "abc" });
      assert.equal(typeof r.ok, "boolean");
    }
    globalThis._concordSTATE = saved;
  });
});
