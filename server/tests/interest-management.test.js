// Speedster S3 contract — speed-scaled interest radius, predictive preload,
// departing-vector. Pure functions; the networking half that makes fast movers
// coherent without transmitting "Flash speed" literally.

import { test } from "node:test";
import assert from "node:assert/strict";
import { speedScaledRadius, predictiveChunks, departingVector } from "../lib/movement/interest-management.js";

test("speed-scaled radius: grows with speed, clamped [base, max]", () => {
  assert.equal(speedScaledRadius(0), 500, "idle = base");
  assert.equal(speedScaledRadius(16, { k: 10 }), 660, "16 m/s runner sees farther");
  assert.equal(speedScaledRadius(1000), 1500, "extreme speed clamps at R_MAX");
  assert.ok(speedScaledRadius(60) > speedScaledRadius(16), "monotonic in speed");
});

test("predictive preload: chunks along the heading, out to speed×lookahead", () => {
  // moving +x at 50 m/s, 2s lookahead = 100m ahead = 1 chunk (CS=100) past current
  const chunks = predictiveChunks({ x: 0, z: 0 }, { vx: 50, vz: 0 }, { lookaheadS: 2, chunkSize: 100 });
  const keys = chunks.map((c) => `${c.cx}:${c.cz}`);
  assert.ok(keys.includes("0:0"), "includes current chunk");
  assert.ok(keys.includes("1:0"), "preloads the chunk ahead in +x");
  assert.ok(!keys.includes("0:1"), "does not preload off-heading");
});

test("predictive preload: faster → reaches more chunks (capped)", () => {
  const slow = predictiveChunks({ x: 0, z: 0 }, { vx: 20, vz: 0 }, { lookaheadS: 2, chunkSize: 100 }).length;
  const fast = predictiveChunks({ x: 0, z: 0 }, { vx: 300, vz: 0 }, { lookaheadS: 2, chunkSize: 100, maxChunks: 8 }).length;
  assert.ok(fast > slow, "a speedster preloads more chunks ahead");
  assert.ok(fast <= 9, "but capped (maxChunks + current)");
});

test("predictive preload: idle → only the current chunk", () => {
  const chunks = predictiveChunks({ x: 250, z: 0 }, { vx: 0, vz: 0 }, { chunkSize: 100 });
  assert.equal(chunks.length, 1);
  assert.deepEqual(chunks[0], { cx: 2, cz: 0 });
});

test("departing-vector: ships position + dead-reckon velocity for off-screen extrapolation", () => {
  const d = departingVector({ x: 0, y: 0, z: 0 }, { x: 20, y: 0, z: 0 }, 1000);
  assert.deepEqual(d.position, { x: 20, y: 0, z: 0 });
  assert.equal(d.velocity.vx, 20, "20m in 1s = 20 m/s");
  assert.equal(d.extrapolate, true, "fast mover → extrapolate off-screen");
  // a near-stationary exit isn't worth extrapolating
  const still = departingVector({ x: 0, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 }, 1000);
  assert.equal(still.extrapolate, false);
});
