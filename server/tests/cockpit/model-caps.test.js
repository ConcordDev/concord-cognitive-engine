import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_PROFILES, profileForModel, defaultProfile } from "../../lib/cockpit/model-caps.js";

const cases = [
  [{ model: "qwen3.5:2b" }, "local-2b"],
  [{ model: "concord-utility-2b:latest" }, "local-2b"],
  [{ model: "concord-core-v6" }, "local-2b"],
  [{ model: "concord-conscious-9b:latest" }, "local-9b"],
  [{ model: "qwen3:30b-a3b-instruct-2507-q4_K_M" }, "local-30b"],
  [{ model: "gpt-oss:20b-cloud" }, "gpt-oss-cloud"],
  [{ provider: "openai" }, "byo-openai"],
  [{ provider: "anthropic" }, "byo-anthropic"],
  [{ provider: "weird", model: "x" }, "marker-only"],
];
for (const [input, want] of cases) {
  test(`profileForModel ${JSON.stringify(input)} -> ${want}`, () => {
    assert.equal(profileForModel(input), want);
  });
}

test("every profile has maxMenu <= 8", () => {
  for (const p of Object.values(MODEL_PROFILES)) assert.ok(p.maxMenu <= 8);
});

test("defaultProfile is the 2B floor unless a valid override is set", () => {
  assert.equal(defaultProfile({}), "local-2b");
  assert.equal(defaultProfile({ CONCORD_COCKPIT_MODEL_PROFILE: "local-9b" }), "local-9b");
  assert.equal(defaultProfile({ CONCORD_COCKPIT_MODEL_PROFILE: "bogus" }), "local-2b");
});
