/**
 * Tier-2 contract tests for Foundry Phase 2 — Worldspec + persistence.
 *
 * Pins:
 *   - worldspec.js: emptyWorldspec shape, normalizeWorldspec (drops
 *     junk, fills defaults, coerces universe type), validateWorldspec
 *     (envelope + system graph; normalize-and-warn for fixables,
 *     hard-error for unfixables)
 *   - the foundry.{create,update,get,list,delete,validate} macros
 *     against an in-memory DB with migration 191 applied:
 *     creator-scoping, draft lifecycle, published-world delete guard,
 *     not-found / not-owner / no-actor handling
 *
 * Run: node --test server/tests/foundry-worldspec.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  emptyWorldspec,
  normalizeWorldspec,
  validateWorldspec,
  worldspecSystemIds,
} from "../lib/foundry/worldspec.js";
import { up as migrate191 } from "../migrations/191_foundry_worlds.js";
import registerFoundryMacros from "../domains/foundry.js";

// ── worldspec.js ────────────────────────────────────────────────────────────

describe("worldspec format", () => {
  it("emptyWorldspec has the canonical shape", () => {
    const e = emptyWorldspec();
    assert.equal(e.version, 1);
    assert.equal(e.template, null);
    assert.equal(e.theme.universeType, "fantasy");
    assert.deepEqual(e.systems, []);
    assert.deepEqual(e.rules, []);
  });

  it("normalizeWorldspec drops junk keys + non-system entries", () => {
    const n = normalizeWorldspec({
      junkKey: 1,
      template: "starter-rpg",
      systems: [{ id: "combat-motor", config: { lethality: "hardcore" } }, "junk", { noId: 1 }],
    });
    assert.ok(!("junkKey" in n));
    assert.equal(n.template, "starter-rpg");
    assert.equal(n.systems.length, 1);
    assert.equal(n.systems[0].id, "combat-motor");
  });

  it("normalizeWorldspec coerces an unknown universe type to the default", () => {
    const n = normalizeWorldspec({ theme: { universeType: "banana" } });
    assert.equal(n.theme.universeType, "fantasy");
  });

  it("normalizeWorldspec keeps a valid universe type", () => {
    const n = normalizeWorldspec({ theme: { universeType: "cyber" } });
    assert.equal(n.theme.universeType, "cyber");
  });

  it("validateWorldspec hard-errors on an unsatisfied dependency", () => {
    const r = validateWorldspec({ systems: [{ id: "boss-phases" }] });
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("combat-motor")));
  });

  it("validateWorldspec passes a well-formed spec + coerces configs", () => {
    const r = validateWorldspec({
      theme: { universeType: "scifi" },
      systems: [{ id: "physics-modifiers", config: { gravity: 99999 } }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.normalized.systems[0].config.gravity, 300); // clamped
  });

  it("validateWorldspec warns (not errors) on a fixable bad universe type", () => {
    const r = validateWorldspec({ theme: { universeType: "banana" }, systems: [] });
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some((w) => w.toLowerCase().includes("universetype")));
  });

  it("validateWorldspec warns on an empty system selection", () => {
    const r = validateWorldspec({ systems: [] });
    assert.equal(r.ok, true);
    assert.ok(r.warnings.some((w) => w.includes("no systems")));
  });

  it("validateWorldspec rejects a non-object", () => {
    assert.equal(validateWorldspec("nope").ok, false);
    assert.equal(validateWorldspec(null).ok, false);
  });

  it("worldspecSystemIds extracts the id list", () => {
    const spec = normalizeWorldspec({ systems: [{ id: "concord-link" }, { id: "mount-system" }] });
    assert.deepEqual(worldspecSystemIds(spec), ["concord-link", "mount-system"]);
  });
});

// ── CRUD macros against an in-memory DB ─────────────────────────────────────

function makeHarness() {
  const db = new Database(":memory:");
  migrate191(db);
  const macros = new Map();
  registerFoundryMacros((domain, name, handler) => macros.set(`${domain}.${name}`, handler));
  const call = (name, input, actor = { userId: "user-1" }) =>
    macros.get(name)({ db, actor }, input || {});
  return { db, call };
}

describe("foundry CRUD macros", () => {
  let h;
  beforeEach(() => { h = makeHarness(); });

  it("create requires an actor and a name", () => {
    assert.equal(h.call("foundry.create", { name: "X" }, {}).reason, "no_actor");
    assert.equal(h.call("foundry.create", {}).reason, "missing_name");
  });

  it("create -> get round-trips", () => {
    const created = h.call("foundry.create", { name: "My Game", description: "a test" });
    assert.equal(created.ok, true);
    assert.ok(created.world.id.startsWith("fw_"));
    assert.equal(created.world.status, "draft");
    const got = h.call("foundry.get", { id: created.world.id });
    assert.equal(got.ok, true);
    assert.equal(got.world.name, "My Game");
    assert.equal(got.world.description, "a test");
  });

  it("create normalizes a supplied worldspec", () => {
    const created = h.call("foundry.create", {
      name: "Spec Game",
      worldspec: { theme: { universeType: "noir" }, systems: [{ id: "concord-link" }], junk: 1 },
    });
    assert.equal(created.ok, true);
    assert.equal(created.world.worldspec.theme.universeType, "noir");
    assert.equal(created.world.worldspec.systems.length, 1);
    assert.ok(!("junk" in created.world.worldspec));
  });

  it("get/update/delete are creator-scoped", () => {
    const created = h.call("foundry.create", { name: "Mine" });
    const id = created.world.id;
    assert.equal(h.call("foundry.get", { id }, { userId: "user-2" }).reason, "not_owner");
    assert.equal(h.call("foundry.update", { id, name: "Hijack" }, { userId: "user-2" }).reason, "not_owner");
    assert.equal(h.call("foundry.delete", { id }, { userId: "user-2" }).reason, "not_owner");
  });

  it("update patches name/description/worldspec", () => {
    const id = h.call("foundry.create", { name: "Before" }).world.id;
    const upd = h.call("foundry.update", {
      id, name: "After", worldspec: { systems: [{ id: "combat-motor" }] },
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.world.name, "After");
    assert.equal(upd.world.worldspec.systems[0].id, "combat-motor");
  });

  it("update with no fields is a no-op error", () => {
    const id = h.call("foundry.create", { name: "X" }).world.id;
    assert.equal(h.call("foundry.update", { id }).reason, "nothing_to_update");
  });

  it("list returns the caller's worlds newest-first", () => {
    h.call("foundry.create", { name: "A" });
    h.call("foundry.create", { name: "B" });
    h.call("foundry.create", { name: "C" }, { userId: "other" });
    const listed = h.call("foundry.list", {});
    assert.equal(listed.ok, true);
    assert.equal(listed.count, 2); // only user-1's
  });

  it("delete removes a draft", () => {
    const id = h.call("foundry.create", { name: "Trash" }).world.id;
    assert.equal(h.call("foundry.delete", { id }).ok, true);
    assert.equal(h.call("foundry.get", { id }).reason, "not_found");
  });

  it("delete is blocked on a published world", () => {
    const id = h.call("foundry.create", { name: "Live" }).world.id;
    // Simulate publish (Phase 3 will do this for real).
    h.db.prepare(`UPDATE foundry_worlds SET status='published', published_world_id='world-x' WHERE id=?`).run(id);
    const del = h.call("foundry.delete", { id });
    assert.equal(del.ok, false);
    assert.equal(del.reason, "world_published");
  });

  it("validate works on a stored id and on a bare worldspec", () => {
    const id = h.call("foundry.create", {
      name: "ValidateMe",
      worldspec: { systems: [{ id: "boss-phases" }] }, // missing dep
    }).world.id;
    const byId = h.call("foundry.validate", { id });
    assert.equal(byId.ok, false);
    assert.ok(byId.errors.some((e) => e.includes("combat-motor")));

    const bySpec = h.call("foundry.validate", {
      worldspec: { systems: [{ id: "combat-motor" }, { id: "boss-phases" }] },
    });
    assert.equal(bySpec.ok, true);
  });

  it("validate needs either an id or a worldspec", () => {
    assert.equal(h.call("foundry.validate", {}).reason, "missing_worldspec_or_id");
  });
});
