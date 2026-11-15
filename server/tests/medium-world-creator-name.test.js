import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerWorldCreator from "../domains/world-creator.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, params) {
  return ACTIONS.get(`world-creator.${name}`)(
    { actor: { userId: "user_a" } },
    { id: null, data: {}, meta: {} },
    params,
  );
}
before(() => { registerWorldCreator(register); });
beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
  globalThis._concordSaveStateSync = () => { globalThis._syncSaves = (globalThis._syncSaves || 0) + 1; };
});

describe("world creator name, description, and delete", () => {
  it("refuses a world name longer than 64 characters", () => {
    const made = call("draft-create", { name: "Aurora Vale" });
    assert.equal(made.ok, true);
    const id = made.result.draft.id;
    const tooLong = call("draft-update", { id, name: "A".repeat(65) });
    assert.equal(tooLong.ok, false);
    assert.match(tooLong.message, /64/);
    const kept = call("draft-get", { id });
    assert.equal(kept.result.draft.name, "Aurora Vale");
  });

  it("keeps the leading characters of a description", () => {
    const made = call("draft-create", { name: "Aurora Vale" });
    const id = made.result.draft.id;
    const updated = call("draft-update", { id, description: "  A vale that starts with a space." });
    assert.equal(updated.ok, true);
    assert.equal(updated.result.draft.description, "  A vale that starts with a space.");
  });

  it("deletes a draft and asks for a durable save", () => {
    const made = call("draft-create", { name: "Aurora Vale" });
    const id = made.result.draft.id;
    globalThis._syncSaves = 0;
    const removed = call("draft-delete", { id });
    assert.equal(removed.ok, true);
    assert.equal(globalThis._syncSaves, 1);
    assert.equal(call("draft-get", { id }).ok, false);
  });
});
