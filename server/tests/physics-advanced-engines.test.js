import { test } from "node:test";
import assert from "node:assert/strict";

const { default: registerPhysics } = await import("../domains/physics.js");
const H = new Map();
registerPhysics((_d, n, fn) => H.set(n, fn));
const call = (n, p) => H.get(n)({}, { data: p }, p);

test("kinematicsSimAdvanced: drag-free range matches the closed form; drag shortens it", () => {
  const a = (35 * Math.PI) / 180, v = 40, g = 9.81, h = 1;
  const body = (name, cd, area) => ({ name, mass: 0.145, position: { x: 0, y: h, z: 0 }, velocity: { x: v * Math.cos(a), y: v * Math.sin(a), z: 0 }, dragCoefficient: cd, crossSection: area });
  const r = call("kinematicsSimAdvanced", { bodies: [body("vac", 0, 0), body("ball", 0.35, 0.0042)], dt: 0.005, steps: 6000 });
  assert.equal(r.ok, true);
  const vy = v * Math.sin(a);
  const t = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
  const range = v * Math.cos(a) * t; // 154.68 m
  const [vac, ball] = r.result.bodies;
  assert.ok(Math.abs(vac.range - range) < 0.5, `vacuum range ${vac.range} vs ${range}`);
  assert.ok(Math.abs(vac.maxHeight - (h + (vy * vy) / (2 * g))) < 0.1);
  assert.ok(ball.range < vac.range * 0.75, "drag must cut range substantially");
});

test("waveInterferenceAdvanced: a source on a grid node stays finite; symmetric pair is mirror-symmetric", () => {
  const p = { sources: [{ x: -0.4, y: 0, frequency: 1000 }, { x: 0.4, y: 0, frequency: 1000 }], gridSize: 30, resolution: 0.1, time: 0, waveSpeed: 343 };
  const r = call("waveInterferenceAdvanced", p);
  assert.equal(r.ok, true);
  const m = r.result.amplitudeMap;
  assert.equal(m.length, 30);
  // two unit sources at r >= resolution/2 can never exceed 2/sqrt(0.05)
  assert.ok(r.result.statistics.maxAmplitude <= 2 / Math.sqrt(0.05) + 1e-9);
  assert.ok(r.result.statistics.nodalPercent < 60, "the field is not dominated by a singular spike");
  // x -> -x symmetry about the column at x=0 (ix=15): px = ix*0.1 - 1.5
  for (const row of m) for (let k = 1; k < 15; k++) assert.ok(Math.abs(row[15 + k] - row[15 - k]) < 1e-6);
  assert.equal(r.result.sources[0].wavelength, 0.343);
  assert.equal(r.result.beatFrequency, 0);
});
