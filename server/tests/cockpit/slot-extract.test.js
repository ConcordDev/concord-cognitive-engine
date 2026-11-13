import test from "node:test";
import assert from "node:assert/strict";
import { extractSlots } from "../../lib/cockpit/slot-extract.js";
import { createMockModel } from "../../lib/cockpit/mock-model.js";

const SENTENCE = "what's the weather like in Lisbon this weekend, should I pack a coat";
const slots = [{ name: "place", description: "city or region the person wants weather for", required: true }];
const ask = (reply) => extractSlots({ text: SENTENCE, slots, profile: "local-2b", deps: { mock: createMockModel({ steps: { "*": [reply] } }) } });

test("a short place is taken", async () => {
  const r = await ask({ tool: "extract_slots", args: { place: "Lisbon" } });
  assert.equal(r.ok, true);
  assert.equal(r.values.place, "Lisbon");
});

test("the whole sentence is not a place", async () => {
  const r = await ask({ tool: "extract_slots", args: { place: SENTENCE } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "slot_missing");
});

test("null for a required slot fails", async () => {
  const r = await ask({ tool: "extract_slots", args: { place: null } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "slot_missing");
});

test("a model that gives nothing fails plainly", async () => {
  const r = await ask({ empty: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "model_failed");
});

test("a value over 80 characters is refused", async () => {
  const r = await ask({ tool: "extract_slots", args: { place: "x".repeat(81) } });
  assert.equal(r.reason, "slot_missing");
});
