// Robotics full build (GB-1021) — R-S2: the bench's pathPlan contract.
//
// Review 2's F3: the bench accepts the pasted waypoint JSON in array form
// ([[0,0],[100,0],[100,100]]) and the card renders "0 mm" with a success
// strip. The verb summed over {x,y,z} objects only, reading .x/.y off
// arrays and defaulting every coordinate to 0. The verb now normalizes
// both shapes; these tests pin the filed example at 200 mm in the bench's
// own format, the object form the studio uses, and the 3D array form.
import { test } from "node:test";
import assert from "node:assert/strict";

const actions = new Map();
const registerLensAction = (domain, name, fn) => actions.set(`${domain}.${name}`, fn);
const { default: registerRobotics } = await import("../domains/robotics.js");
registerRobotics(registerLensAction);

const ctx = { actor: { userId: "robo-build" }, userId: "robo-build" };
const plan = (waypoints) => actions.get("robotics.pathPlan")(ctx, { data: { waypoints } }, {});

test("pathPlan: the filed array-form example sums to 200 mm (was 0)", () => {
  const r = plan([[0, 0], [100, 0], [100, 100]]);
  assert.equal(r.ok, true);
  assert.equal(r.result.waypoints, 3);
  assert.equal(r.result.totalDistance, 200);
  assert.deepEqual(r.result.segments.map((s) => s.distance), [100, 100]);
  assert.equal(r.result.estimatedTime, "2s at 100mm/s");
});

test("pathPlan: the object form sums identically", () => {
  const r = plan([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
  assert.equal(r.result.totalDistance, 200);
  assert.deepEqual(r.result.segments.map((s) => s.distance), [100, 100]);
});

test("pathPlan: 3D array waypoints use the z leg", () => {
  const r = plan([[0, 0, 0], [0, 0, 50], [30, 40, 50]]);
  assert.equal(r.result.totalDistance, 100); // 50 up + 50 across (3-4-5)
});

test("pathPlan: fewer than 2 waypoints still asks for more", () => {
  const r = plan([[0, 0]]);
  assert.equal(r.ok, true);
  assert.match(r.result.message, /at least 2 waypoints/);
});
