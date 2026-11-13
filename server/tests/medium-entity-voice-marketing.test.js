import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerEntity from "../domains/entity.js";
import registerVoice from "../domains/voice.js";
import registerMarketing from "../domains/marketing.js";

const actions = new Map();
function register(domain, name, fn) { actions.set(`${domain}.${name}`, fn); }
const ctx = { actor: { userId: "ada" }, userId: "ada" };
function call(domain, name, params) {
  return actions.get(`${domain}.${name}`)(ctx, { id: null, data: params, meta: {} }, params);
}

before(() => {
  registerEntity(register);
  registerVoice(register);
  registerMarketing(register);
});
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

describe("entity, voice, and marketing mediums", () => {
  it("refuses a second entity with the same name", () => {
    assert.equal(call("entity", "node-create", { name: "Ada" }).ok, true);
    const again = call("entity", "node-create", { name: "ada" });
    assert.equal(again.ok, false);
    assert.match(again.message, /already exists/);
  });

  it("refuses a meeting duration that is not a positive number", () => {
    const startAt = "2026-11-10T15:00:00.000Z";
    const bad = call("voice", "meeting-schedule", { title: "Sync", startAt, durationMin: -5 });
    assert.equal(bad.ok, false);
    assert.match(bad.message, /Duration/);
    const abc = call("voice", "meeting-schedule", { title: "Sync", startAt, durationMin: "abc" });
    assert.equal(abc.ok, false);
    const ok = call("voice", "meeting-schedule", { title: "Sync", startAt });
    assert.equal(ok.result.meeting.durationMin, 30);
  });

  it("creates a campaign as a draft", () => {
    const r = call("marketing", "campaign-create", { name: "Spring", channel: "email", budget: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.campaign.status, "draft");
  });
});
