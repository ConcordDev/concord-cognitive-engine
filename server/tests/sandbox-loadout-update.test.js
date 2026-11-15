// FIX-sandbox-006 — Editing a saved preset created a second preset.
//
// Diagnosis pinned by this suite: `saveLoadout` always minted a fresh id
// and pushed a new entry — there was no update path at all, and the
// frontend never told the server which preset was loaded in the editor.
// The macro now honours `loadoutId`: a save carrying the id of an existing
// preset updates it in place (name kept when the submitted name is blank,
// createdAt preserved, updatedAt stamped); a save without one creates, as
// before.
//
// Hermetic harness mirroring automotive-vehicle-delete-cascade.test.js:
// the macros are registered through registerSandboxMacros into a local
// registry and invoked as handler(ctx, input) against a fresh
// _concordSTATE per test.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSandboxMacros from "../domains/sandbox.js";

const ACTIONS = new Map();
registerSandboxMacros((domain, name, fn) => {
  assert.equal(domain, "sandbox", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
});
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`sandbox.${name} not registered`);
  return fn(ctx, input || {});
}

const ctx = { actor: { userId: "u1" }, userId: "u1" };
const baseSave = { weaponId: "blade", skillId: "none", lightDamage: 12, heavyDamage: 26, name: "Duelist" };

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("FIX-sandbox-006 — saveLoadout update-in-place", () => {
  it("a save carrying loadoutId updates the same preset instead of creating a second", () => {
    const created = call("saveLoadout", ctx, baseSave);
    assert.equal(created.ok, true);
    const id = created.result.loadout.id;

    const updated = call("saveLoadout", ctx, { ...baseSave, heavyDamage: 40, loadoutId: id });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.updated, true);
    assert.equal(updated.result.total, 1);
    assert.equal(updated.result.loadout.id, id);
    assert.equal(updated.result.loadout.heavyDamage, 40);
    assert.equal(updated.result.loadout.createdAt, created.result.loadout.createdAt);
    assert.ok(updated.result.loadout.updatedAt, "update stamps updatedAt");

    const list = call("listLoadouts", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.loadouts[0].heavyDamage, 40);
  });

  it("a save without loadoutId still creates a new preset (explicit Save as new)", () => {
    call("saveLoadout", ctx, baseSave);
    const second = call("saveLoadout", ctx, { ...baseSave, name: "Duelist copy" });
    assert.equal(second.ok, true);
    assert.equal(second.result.total, 2);
    assert.notEqual(second.result.loadout.id, call("listLoadouts", ctx, {}).result.loadouts[1].id);
  });

  it("an unknown loadoutId is refused, not silently turned into a create", () => {
    call("saveLoadout", ctx, baseSave);
    const r = call("saveLoadout", ctx, { ...baseSave, loadoutId: "ld_missing" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "loadout_not_found");
    assert.equal(call("listLoadouts", ctx, {}).result.count, 1);
  });

  it("a blank name on update keeps the preset's existing name; a new name renames in place", () => {
    const created = call("saveLoadout", ctx, baseSave);
    const id = created.result.loadout.id;
    const kept = call("saveLoadout", ctx, { ...baseSave, name: "", heavyDamage: 30, loadoutId: id });
    assert.equal(kept.ok, true);
    assert.equal(kept.result.loadout.name, "Duelist");
    const renamed = call("saveLoadout", ctx, { ...baseSave, name: "Duelist v2", loadoutId: id });
    assert.equal(renamed.result.loadout.name, "Duelist v2");
    assert.equal(call("listLoadouts", ctx, {}).result.count, 1);
  });

  it("another user's preset cannot be updated by id", () => {
    const created = call("saveLoadout", ctx, baseSave);
    const id = created.result.loadout.id;
    const other = { actor: { userId: "u2" }, userId: "u2" };
    const r = call("saveLoadout", other, { ...baseSave, heavyDamage: 99, loadoutId: id });
    assert.equal(r.ok, false);
    assert.equal(r.error, "loadout_not_found");
    assert.equal(call("listLoadouts", ctx, {}).result.loadouts[0].heavyDamage, 26);
  });
});
