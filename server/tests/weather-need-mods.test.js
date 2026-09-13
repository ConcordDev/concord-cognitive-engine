import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { weatherNeedMods } from "../lib/weather.js";

describe("weatherNeedMods", () => {
  it("returns the live type and only scales needs for wet weather", () => {
    const mods = weatherNeedMods("concordia-hub");
    assert.equal(typeof mods.type, "string");
    if (mods.type === "storm") {
      assert.ok(mods.safety > 1);
      assert.ok(mods.comfort > 1);
    } else if (mods.type === "rain") {
      assert.ok(mods.safety > 1);
    } else if (mods.type === "snow") {
      assert.ok(mods.comfort > 1);
    } else {
      assert.equal(mods.safety, undefined);
    }
  });
});
