/**
 * Weather Markov chain tests.
 * Run: node --test tests/weather.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";

import {
  ensureWeatherForWorld,
  advanceWeather,
  getWeather,
  WEATHER_CONSTANTS,
} from "../lib/weather.js";

describe("weather", () => {
  it("ensureWeatherForWorld is idempotent", () => {
    const a = ensureWeatherForWorld("fantasy");
    const b = ensureWeatherForWorld("fantasy");
    assert.strictEqual(a, b);
  });

  it("each world has a typed state", () => {
    for (const w of ["concordia", "fantasy", "superhero", "crime", "cyber"]) {
      const s = getWeather(w);
      assert.ok(WEATHER_CONSTANTS.types.includes(s.type));
      assert.ok(s.intensity >= 0 && s.intensity <= 1);
      assert.ok(typeof s.windDirection === "number");
    }
  });

  it("advanceWeather without REALTIME never throws", () => {
    advanceWeather(null);
    advanceWeather();
  });

  it("advanceWeather preserves type more often than it changes (stickiness)", () => {
    let stayed = 0, changed = 0;
    for (let i = 0; i < 200; i++) {
      const before = getWeather("concordia").type;
      advanceWeather(null);
      const after = getWeather("concordia").type;
      if (before === after) stayed++; else changed++;
    }
    // 65% stickiness target — give a wide tolerance for randomness
    assert.ok(stayed > changed, `expected stickiness, got stayed=${stayed} changed=${changed}`);
  });
});
