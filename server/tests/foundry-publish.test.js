/**
 * Tier-2 contract tests for Foundry Phase 3 — compiler + publish pipeline.
 *
 * Pins:
 *   - compiler.js: activation routing (physics_modulator /
 *     rule_modulator / heartbeat_optin / content_seed / always_on),
 *     stub-skip, provenance marker, concordLinkAnchor extraction,
 *     buildConcordLinkAnchor shape
 *   - foundry.publish: validation hard-gate (invalid spec / no systems
 *     blocked), creates a real `worlds` row with compiled modulators,
 *     flips foundry_worlds to published, blocks re-publish,
 *     creator-scoped
 *   - foundry.unpublish: deletes an unvisited overlay world, archives a
 *     visited one, resets the foundry_worlds row to draft, blocks
 *     not-published, creator-scoped
 *
 * Run: node --test server/tests/foundry-publish.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { compileWorldspec, buildConcordLinkAnchor } from "../lib/foundry/compiler.js";
import { normalizeWorldspec } from "../lib/foundry/worldspec.js";
import { up as migrate191 } from "../migrations/191_foundry_worlds.js";
import registerFoundryMacros from "../domains/foundry.js";

// ── compiler.js ─────────────────────────────────────────────────────────────

describe("worldspec compiler", () => {
  it("routes each activation kind to the right artifact", () => {
    const spec = normalizeWorldspec({
      systems: [
        { id: "physics-modifiers", config: { gravity: 50 } },   // physics_modulator
        { id: "combat-motor", config: { lethality: "hardcore" } }, // rule_modulator
        { id: "fauna-flocks", config: { density: "abundant" } }, // heartbeat_optin
        { id: "concord-link", config: { travelMode: "open" } },  // content_seed
        { id: "llm-npcs", config: { npcCount: 12 } },            // content_seed
        { id: "royalty-cascade" },                                // always_on
      ],
    });
    const c = compileWorldspec(spec);
    assert.deepEqual(Object.keys(c.physics_modulators), ["movement"]);
    assert.equal(c.physics_modulators.movement.gravity, 50);
    assert.equal(c.rule_modulators.combat.lethality, "hardcore");
    assert.equal(c.rule_modulators.fauna.density, "abundant");
    assert.equal(c.rule_modulators.foundry_heartbeats.fauna, true);
    assert.equal(c.contentSeeds.length, 2); // concord-link + llm-npcs
    assert.ok(c.concordLinkAnchor);
    assert.equal(c.concordLinkAnchor.travelMode, "open");
    // royalty-cascade is always_on — writes no per-world modulator
    assert.ok(!("royalty-cascade" in c.rule_modulators));
  });

  it("activates the Phase 7 systems (no longer stubs)", () => {
    // size-scaling + status-window were built in Phase 7 — the compiler
    // now activates them instead of skipping. (The stub-skip code path
    // still exists for any future status:'stub' system.)
    const spec = normalizeWorldspec({
      systems: [{ id: "combat-motor" }, { id: "physics-modifiers" }, { id: "size-scaling" }, { id: "status-window" }],
    });
    const c = compileWorldspec(spec);
    assert.deepEqual(c.skippedStubs, []);
    assert.deepEqual(c.activatedSystems.sort(), ["combat-motor", "physics-modifiers", "size-scaling", "status-window"]);
    assert.equal(typeof c.rule_modulators.size_scaling, "object"); // size-scaling activated
    assert.equal(typeof c.rule_modulators.status_window, "object"); // status-window activated
    assert.deepEqual(c.rule_modulators.foundry.stubs, []);
  });

  it("writes a provenance marker", () => {
    const c = compileWorldspec(normalizeWorldspec({ template: "starter", systems: [{ id: "combat-motor" }] }));
    assert.equal(c.rule_modulators.foundry.template, "starter");
    assert.equal(c.rule_modulators.foundry.worldspecVersion, 1);
  });

  it("buildConcordLinkAnchor produces the anchor row shape", () => {
    const a = buildConcordLinkAnchor("world-xyz", "Test Realm", { travelMode: "walker-escort" });
    assert.equal(a.id, "anchor-world-xyz");
    assert.equal(a.world_id, "world-xyz");
    assert.equal(a.access_method, "walker-escort");
    assert.equal(a.stability, 1.0);
  });

  it("buildConcordLinkAnchor returns null when concord-link wasn't selected", () => {
    assert.equal(buildConcordLinkAnchor("w", "n", null), null);
  });
});

// ── publish / unpublish macros ──────────────────────────────────────────────

function makeHarness() {
  const db = new Database(":memory:");
  migrate191(db);
  // Minimal `worlds` table — just the columns the publish path touches.
  db.exec(`
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, universe_type TEXT NOT NULL,
      description TEXT, physics_modulators TEXT DEFAULT '{}', rule_modulators TEXT DEFAULT '{}',
      created_by TEXT, status TEXT NOT NULL DEFAULT 'active', total_visits INTEGER NOT NULL DEFAULT 0
    )
  `);
  const macros = new Map();
  registerFoundryMacros((domain, name, handler) => macros.set(`${domain}.${name}`, handler));
  const call = (name, input, actor = { userId: "user-1" }) =>
    macros.get(name)({ db, actor }, input || {});
  return { db, call };
}

describe("foundry.publish", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("publishes a valid worldspec into a real worlds row", () => {
    const id = h.call("foundry.create", {
      name: "Skyforge",
      worldspec: {
        theme: { universeType: "scifi" },
        systems: [
          { id: "physics-modifiers", config: { gravity: 60 } },
          { id: "combat-motor" },
          { id: "concord-link" },
        ],
      },
    }).world.id;

    const pub = h.call("foundry.publish", { id });
    assert.equal(pub.ok, true);
    assert.ok(pub.publishedWorldId.startsWith("world-"));
    assert.equal(pub.world.status, "published");
    assert.equal(pub.world.publishedWorldId, pub.publishedWorldId);

    const w = h.db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(pub.publishedWorldId);
    assert.ok(w, "worlds row created");
    assert.equal(w.universe_type, "scifi");
    assert.equal(w.created_by, "user-1");
    const phys = JSON.parse(w.physics_modulators);
    const rules = JSON.parse(w.rule_modulators);
    assert.equal(phys.movement.gravity, 60);
    assert.ok(rules.combat);
    assert.deepEqual(rules.foundry.systems.sort(), ["combat-motor", "concord-link", "physics-modifiers"]);
  });

  it("blocks publishing a worldspec with an unsatisfied dependency", () => {
    const id = h.call("foundry.create", {
      name: "Broken", worldspec: { systems: [{ id: "boss-phases" }] }, // needs combat-motor
    }).world.id;
    const pub = h.call("foundry.publish", { id });
    assert.equal(pub.ok, false);
    assert.equal(pub.reason, "worldspec_invalid");
    assert.ok(pub.errors.some((e) => e.includes("combat-motor")));
  });

  it("blocks publishing an empty worldspec", () => {
    const id = h.call("foundry.create", { name: "Empty" }).world.id;
    const pub = h.call("foundry.publish", { id });
    assert.equal(pub.ok, false);
    assert.equal(pub.reason, "no_systems");
  });

  it("blocks re-publishing an already-published world", () => {
    const id = h.call("foundry.create", { name: "Once", worldspec: { systems: [{ id: "combat-motor" }] } }).world.id;
    assert.equal(h.call("foundry.publish", { id }).ok, true);
    const again = h.call("foundry.publish", { id });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "already_published");
  });

  it("is creator-scoped", () => {
    const id = h.call("foundry.create", { name: "Mine", worldspec: { systems: [{ id: "combat-motor" }] } }).world.id;
    const pub = h.call("foundry.publish", { id }, { userId: "intruder" });
    assert.equal(pub.reason, "not_owner");
  });

  it("publishes a worldspec including a Phase 7 system — it activates", () => {
    // status-window was built in Phase 7; publishing now activates it.
    const id = h.call("foundry.create", {
      name: "Future", worldspec: { systems: [{ id: "combat-motor" }, { id: "status-window" }] },
    }).world.id;
    const pub = h.call("foundry.publish", { id });
    assert.equal(pub.ok, true);
    assert.deepEqual(pub.skippedStubs, []);
    assert.deepEqual(pub.activatedSystems.sort(), ["combat-motor", "status-window"]);
  });
});

describe("foundry.unpublish", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  function publishOne(name = "W") {
    const id = h.call("foundry.create", { name, worldspec: { systems: [{ id: "combat-motor" }] } }).world.id;
    const pub = h.call("foundry.publish", { id });
    return { id, worldId: pub.publishedWorldId };
  }

  it("deletes the overlay world when nobody has visited it", () => {
    const { id, worldId } = publishOne();
    const un = h.call("foundry.unpublish", { id });
    assert.equal(un.ok, true);
    assert.equal(un.disposition, "deleted");
    assert.equal(h.db.prepare(`SELECT * FROM worlds WHERE id = ?`).get(worldId), undefined);
    assert.equal(h.call("foundry.get", { id }).world.status, "draft");
    assert.equal(h.call("foundry.get", { id }).world.publishedWorldId, null);
  });

  it("archives the overlay world when it has visits", () => {
    const { id, worldId } = publishOne();
    h.db.prepare(`UPDATE worlds SET total_visits = 5 WHERE id = ?`).run(worldId);
    const un = h.call("foundry.unpublish", { id });
    assert.equal(un.ok, true);
    assert.equal(un.disposition, "archived");
    assert.equal(h.db.prepare(`SELECT status FROM worlds WHERE id = ?`).get(worldId).status, "archived");
  });

  it("blocks unpublishing a draft", () => {
    const id = h.call("foundry.create", { name: "Draft" }).world.id;
    const un = h.call("foundry.unpublish", { id });
    assert.equal(un.ok, false);
    assert.equal(un.reason, "not_published");
  });

  it("is creator-scoped", () => {
    const { id } = publishOne();
    assert.equal(h.call("foundry.unpublish", { id }, { userId: "intruder" }).reason, "not_owner");
  });

  it("unpublish then delete works (the delete-guard lifts)", () => {
    const { id } = publishOne();
    assert.equal(h.call("foundry.delete", { id }).reason, "world_published");
    assert.equal(h.call("foundry.unpublish", { id }).ok, true);
    assert.equal(h.call("foundry.delete", { id }).ok, true);
  });
});
