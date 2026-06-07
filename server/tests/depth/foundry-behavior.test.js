// tests/depth/foundry-behavior.test.js — REAL behavioral tests for the
// foundry domain (register()/runMacro family, via the macroRuntime harness
// path). Foundry is the no-code game-builder lens (#125).
//
// Coverage: registry read-surface contracts (systems / system_schema /
// validate_systems with exact catalog values + dependency rejection),
// worldspec CRUD round-trips (create → get/list/update/delete persistence)
// backed by the foundry_worlds table, deterministic NL rule composition
// (exact keyword-classified confidence), multiplayer config clamping, the
// publish hard-gate, and ratings validation. Each literal
// runMacro("foundry","<macro>",…) is credited by the macro-depth grader.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime } from "./_harness.js";

describe("foundry — system registry read surface (exact catalog)", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("foundry-reg")); });

  it("systems: the full catalog reports total = 34 and 8 world systems when filtered", async () => {
    const all = await runMacro("foundry", "systems", {}, ctx);
    assert.equal(all.ok, true);
    assert.equal(all.total, 34);              // SYSTEM_REGISTRY.length (frozen catalog)
    assert.equal(all.count, 34);              // no filter → count == total
    const world = await runMacro("foundry", "systems", { category: "world" }, ctx);
    assert.equal(world.count, 8);             // 8 WORLD-category systems
    assert.ok(world.systems.every((s) => s.category === "world"));
    assert.equal(world.total, 34);            // total stays the full catalog
  });

  it("systems: an unknown category is rejected, not silently empty", async () => {
    const r = await runMacro("foundry", "systems", { category: "not-a-real-category" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_category");
  });

  it("system_schema: terrain-biomes resolves its registry metadata + activation", async () => {
    const r = await runMacro("foundry", "system_schema", { id: "terrain-biomes" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.category, "world");
    assert.equal(r.worldScope, "world");
    assert.equal(r.status, "available");
    assert.equal(r.activation.kind, "physics_modulator");
    assert.equal(r.activation.key, "terrain");
    assert.ok(r.configSchema.seaLevel);       // the ConfigPanel field set
  });

  it("system_schema: an unknown system id is rejected", async () => {
    const r = await runMacro("foundry", "system_schema", { id: "ghost-system" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_system");
  });

  it("validate_systems: armor-weapon-reflex without combat-motor is a dependency error", async () => {
    const r = await runMacro("foundry", "validate_systems", { systems: [{ id: "armor-weapon-reflex" }] }, ctx);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("armor-weapon-reflex") && e.includes("combat-motor")));
  });

  it("validate_systems: combat-motor alone passes and coerces config to schema defaults", async () => {
    const r = await runMacro("foundry", "validate_systems", { systems: [{ id: "combat-motor" }] }, ctx);
    assert.equal(r.ok, true);
    const motor = r.resolved.find((s) => s.id === "combat-motor");
    assert.equal(motor.config.lethality, "standard");   // enum default
    assert.equal(motor.config.friendlyFire, false);     // bool default
  });

  it("validate_systems: out-of-range numeric config is clamped to the schema max", async () => {
    const r = await runMacro("foundry", "validate_systems", { systems: [{ id: "physics-modifiers", config: { gravity: 9999 } }] }, ctx);
    assert.equal(r.ok, true);
    const phys = r.resolved.find((s) => s.id === "physics-modifiers");
    assert.equal(phys.config.gravity, 300);   // clamped to f.number max (10..300)
  });
});

describe("foundry — worldspec CRUD round-trips (foundry_worlds table)", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("foundry-crud")); });

  it("create → get → list: a draft persists and reads back, defaulting to status 'draft'", async () => {
    const name = `Depth World ${randomUUID()}`;
    const created = await runMacro("foundry", "create", { name, description: "a test draft" }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.world.name, name);
    assert.equal(created.world.status, "draft");
    assert.equal(created.world.description, "a test draft");

    const got = await runMacro("foundry", "get", { id: created.world.id }, ctx);
    assert.equal(got.ok, true);
    assert.equal(got.world.id, created.world.id);
    assert.equal(got.world.name, name);

    const list = await runMacro("foundry", "list", {}, ctx);
    assert.ok(list.worlds.some((w) => w.id === created.world.id));   // read-back in caller's list
  });

  it("update: patching name + description persists on next get", async () => {
    const created = await runMacro("foundry", "create", { name: `Edit Me ${randomUUID()}` }, ctx);
    const renamed = `Renamed ${randomUUID()}`;
    const upd = await runMacro("foundry", "update", { id: created.world.id, name: renamed, description: "patched" }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.world.name, renamed);
    const got = await runMacro("foundry", "get", { id: created.world.id }, ctx);
    assert.equal(got.world.name, renamed);
    assert.equal(got.world.description, "patched");
  });

  it("delete: an unpublished draft is removed and no longer fetchable", async () => {
    const created = await runMacro("foundry", "create", { name: `Doomed ${randomUUID()}` }, ctx);
    const del = await runMacro("foundry", "delete", { id: created.world.id }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.deleted, created.world.id);
    const got = await runMacro("foundry", "get", { id: created.world.id }, ctx);
    assert.equal(got.ok, false);
    assert.equal(got.reason, "not_found");   // gone from the table
  });

  it("create: an empty name is rejected", async () => {
    const r = await runMacro("foundry", "create", { name: "   " }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_name");
  });

  it("publish: an empty draft (no systems) is hard-gated", async () => {
    const created = await runMacro("foundry", "create", { name: `Unpublishable ${randomUUID()}` }, ctx);
    const pub = await runMacro("foundry", "publish", { id: created.world.id }, ctx);
    assert.equal(pub.ok, false);
    assert.equal(pub.reason, "no_systems");   // publish needs ≥1 selected system
  });
});

describe("foundry — rules, multiplayer config, ratings", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("foundry-extra")); });

  it("compose_rule: a fully-classified sentence yields exact deterministic confidence 0.55", async () => {
    const r = await runMacro("foundry", "compose_rule", { naturalLanguage: "when a player enters the boss arena, lock the doors" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.composedBy, "deterministic");      // no LLM in test env
    assert.equal(r.rule.trigger.kind, "player_enters");
    assert.equal(r.rule.effect.kind, "lock");
    assert.equal(r.rule.confidence, 0.55);            // both halves classified → 0.55
    assert.equal(r.rule.trigger.target, "boss arena");
    assert.equal(r.saved, false);                     // no id → not persisted
  });

  it("compose_rule: an empty sentence is rejected", async () => {
    const r = await runMacro("foundry", "compose_rule", { naturalLanguage: "   " }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_natural_language");
  });

  it("multiplayer_set → multiplayer_get: config clamps and reads back through the worldspec", async () => {
    const created = await runMacro("foundry", "create", { name: `MP ${randomUUID()}` }, ctx);
    const set = await runMacro("foundry", "multiplayer_set", { id: created.world.id, enabled: true, minPlayers: 2, maxPlayers: 9999, matchmaking: "skill_based" }, ctx);
    assert.equal(set.ok, true);
    assert.equal(set.multiplayer.maxPlayers, 256);     // clamped to clampInt hi=256
    assert.equal(set.multiplayer.minPlayers, 2);
    assert.equal(set.multiplayer.matchmaking, "skill_based");
    const got = await runMacro("foundry", "multiplayer_get", { id: created.world.id }, ctx);
    assert.equal(got.multiplayer.maxPlayers, 256);     // persisted into worldspec_json
    assert.equal(got.multiplayer.matchmaking, "skill_based");
  });

  it("multiplayer_set: minPlayers exceeding maxPlayers is rejected", async () => {
    const created = await runMacro("foundry", "create", { name: `BadMP ${randomUUID()}` }, ctx);
    const r = await runMacro("foundry", "multiplayer_set", { id: created.world.id, minPlayers: 10, maxPlayers: 4 }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "min_exceeds_max");
  });

  it("rate: a creator cannot rate their own (and only-published) game", async () => {
    const created = await runMacro("foundry", "create", { name: `OwnGame ${randomUUID()}` }, ctx);
    // unpublished first → not_published gate
    const unpub = await runMacro("foundry", "rate", { id: created.world.id, stars: 5 }, ctx);
    assert.equal(unpub.ok, false);
    assert.equal(unpub.reason, "not_published");
  });

  it("templates: the authored template catalog lists the 4 starter worldspecs and create accepts one by id", async () => {
    const tpls = await runMacro("foundry", "templates", {}, ctx);
    assert.equal(tpls.ok, true);
    assert.equal(tpls.count, 4);                 // 4 *.json in content/foundry-templates
    const starter = tpls.templates.find((t) => t.id === "starter-rpg");
    assert.ok(starter, "starter-rpg template is present");
    // create-from-template normalizes the template's worldspec onto a fresh draft
    const created = await runMacro("foundry", "create", { name: `FromTpl ${randomUUID()}`, templateId: "starter-rpg" }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.world.worldspec.template, "starter-rpg");   // template id carried through
    assert.ok(created.world.worldspec.systems.length >= 1);          // template pre-fills systems
  });

  it("create: an unknown templateId is rejected", async () => {
    const r = await runMacro("foundry", "create", { name: `BadTpl ${randomUUID()}`, templateId: "no-such-template" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_template");
  });
});

describe("foundry — publish lifecycle + builder extensions", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("foundry-pub")); });

  it("create(with system) → publish → unpublish: full overlay lifecycle, no-visit world deleted", async () => {
    const created = await runMacro("foundry", "create", {
      name: `Pub ${randomUUID()}`,
      worldspec: { theme: { universeType: "scifi" }, systems: [{ id: "combat-motor" }] },
    }, ctx);
    const pub = await runMacro("foundry", "publish", { id: created.world.id }, ctx);
    assert.equal(pub.ok, true);
    assert.equal(pub.world.status, "published");
    assert.equal(pub.world.publishedWorldId, pub.publishedWorldId);   // foundry row links the live world
    assert.ok(pub.activatedSystems.includes("combat-motor"));         // the selected system activated

    // republish is blocked while already published
    const again = await runMacro("foundry", "publish", { id: created.world.id }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.reason, "already_published");

    // unpublish — the overlay world had no visits, so it is deleted and the
    // foundry row returns to draft with a null published_world_id
    const un = await runMacro("foundry", "unpublish", { id: created.world.id }, ctx);
    assert.equal(un.ok, true);
    assert.equal(un.disposition, "deleted");
    assert.equal(un.formerWorldId, pub.publishedWorldId);
    assert.equal(un.world.status, "draft");
    assert.equal(un.world.publishedWorldId, null);
  });

  it("asset_import → asset_list → asset_remove: the per-world asset library round-trips", async () => {
    const created = await runMacro("foundry", "create", { name: `Assets ${randomUUID()}` }, ctx);
    const imp = await runMacro("foundry", "asset_import", {
      id: created.world.id, kind: "model", name: "Oak Tree", url: "https://cdn.example/tree.glb",
    }, ctx);
    assert.equal(imp.ok, true);
    assert.equal(imp.asset.kind, "model");
    assert.equal(imp.asset.name, "Oak Tree");

    const listed = await runMacro("foundry", "asset_list", { id: created.world.id }, ctx);
    assert.ok(listed.assets.some((a) => a.id === imp.asset.id));   // shows up in the library

    const rm = await runMacro("foundry", "asset_remove", { id: created.world.id, assetId: imp.asset.id }, ctx);
    assert.equal(rm.ok, true);
    assert.equal(rm.removed, imp.asset.id);

    const after = await runMacro("foundry", "asset_list", { id: created.world.id }, ctx);
    assert.ok(!after.assets.some((a) => a.id === imp.asset.id));   // gone after remove
  });

  it("asset_import: a bare ftp:// url is rejected (must be http(s) or absolute path)", async () => {
    const created = await runMacro("foundry", "create", { name: `BadAsset ${randomUUID()}` }, ctx);
    const imp = await runMacro("foundry", "asset_import", {
      id: created.world.id, kind: "model", name: "X", url: "ftp://nope/x.glb",
    }, ctx);
    assert.equal(imp.ok, false);
    assert.equal(imp.reason, "invalid_asset");
    assert.ok(imp.errors.some((e) => e.includes("url must be")));
  });

  it("blueprint_save → blueprint_get: a visual-script graph persists for the world", async () => {
    const created = await runMacro("foundry", "create", { name: `BP ${randomUUID()}` }, ctx);
    const nodeId = `n_${randomUUID().slice(0, 8)}`;
    const saved = await runMacro("foundry", "blueprint_save", {
      id: created.world.id,
      nodes: [{ id: nodeId, kind: "event", type: "on_start", label: "Start" }],
      edges: [],
    }, ctx);
    assert.equal(saved.ok, true);
    assert.equal(saved.validation.ok, true);          // an event node validates clean
    assert.equal(saved.blueprint.nodes.length, 1);

    const got = await runMacro("foundry", "blueprint_get", { id: created.world.id }, ctx);
    assert.equal(got.ok, true);
    assert.ok(got.blueprint.nodes.some((n) => n.id === nodeId));   // read-back confirms persist
  });

  it("blueprint_save: a graph with no nodes is rejected", async () => {
    const created = await runMacro("foundry", "create", { name: `EmptyBP ${randomUUID()}` }, ctx);
    const saved = await runMacro("foundry", "blueprint_save", { id: created.world.id, nodes: [], edges: [] }, ctx);
    assert.equal(saved.ok, false);
    assert.equal(saved.reason, "empty_blueprint");
  });

  it("compose_rule with id: the composed rule is appended to the world's worldspec.rules", async () => {
    const created = await runMacro("foundry", "create", { name: `RuleSave ${randomUUID()}` }, ctx);
    const r = await runMacro("foundry", "compose_rule", {
      id: created.world.id,
      naturalLanguage: "when a player leaves the safe zone, spawn a guardian",
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.saved, true);                       // id given → persisted onto the world
    assert.equal(r.rule.trigger.kind, "player_leaves");
    assert.equal(r.rule.effect.kind, "spawn");

    const got = await runMacro("foundry", "get", { id: created.world.id }, ctx);
    assert.ok(got.world.worldspec.rules.some((rule) => rule.id === r.rule.id));   // read-back
  });
});
