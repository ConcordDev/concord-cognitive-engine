// Brief D item 2: run_compute takes SI (or unit-tagged) input and returns SI;
// unknown keys come back with the closest real keys and their input schemas.
import test from "node:test";
import assert from "node:assert/strict";
import { executeToolCall } from "../lib/chat-agent.js";
import { toSI } from "../lib/chat/compute-si.js";

const run = (key, input) => executeToolCall({}, () => null, new Map(), { tool: "run_compute", params: { key, input } });
const near = (a, b, tol = 0.002) => Math.abs(a - b) <= tol * Math.abs(b);

test("toSI reads numbers, tagged values and strings", () => {
  assert.equal(toSI(5, "force"), 5);
  assert.equal(toSI({ value: 10, unit: "kN" }, "force"), 10000);
  assert.equal(toSI("60 mm", "length"), 0.06);
  assert.equal(toSI("200 GPa", "stress"), 200e9);
  assert.equal(toSI("2 furlong", "length"), null);
});

test("footbridge column: 60x100 A36, 2.5 m pinned-pinned, 80 kN", async () => {
  const r = await run("engineering.columnBuckling", { lengthM: 2.5, modulusPa: 200e9, widthM: 0.06, heightM: 0.1, loadN: 80000 });
  assert.equal(r.ok, true);
  const c = r.result;
  assert.ok(near(c.momentOfInertiaM4, 1.8e-6), "weak-axis I");
  assert.ok(near(c.criticalLoadKN, 568.5, 0.001), `Pcr ${c.criticalLoadKN}`);
  assert.ok(near(c.factorOfSafety, 7.11, 0.001), `FS ${c.factorOfSafety}`);
  assert.ok(near(c.slenderness, 144.3, 0.001), `L/r ${c.slenderness}`);
});

test("unit-tagged inputs give the same column", async () => {
  const r = await run("engineering.columnBuckling", { length: "2.5 m", modulus: "200 GPa", width: "60 mm", height: "100 mm", load: "80 kN" });
  assert.ok(near(r.result.criticalLoadKN, 568.5, 0.001));
});

test("beam deflection in SI: footbridge 100 mm A36 vs 125 mm", async () => {
  const d = async (h) => (await run("physics.beamDeflection", { loadN: 10000, lengthM: 4, modulusPa: 200e9, momentOfInertiaM4: (0.06 * h ** 3) / 12 })).result;
  const r100 = await d(0.1);
  assert.equal(r100.unit, "m");
  assert.ok(near(r100.deflectionMm, 13.333, 0.001));
  assert.ok(r100.deflectionMm > 4000 / 360, "100 mm fails span/360");
  assert.ok((await d(0.125)).deflectionMm <= 4000 / 360, "125 mm passes");
});

test("bending stress in SI: M = 10 kN·m, 100 mm deep, 60 mm wide = 100 MPa", async () => {
  const r = await run("physics.bendingStress", { momentNm: 10000, momentOfInertiaM4: 5e-6, distanceM: 0.05 });
  assert.ok(near(r.result.stressMPa, 100, 1e-6));
});

test("imperial keys still reach the module", async () => {
  const r = await run("physics.beamDeflection", { loadLbs: 1000, lengthFt: 10, modulusE: 29e6, momentI: 100 });
  assert.equal(r.result.unit, "in");
});

test("missing SI field names the schema", async () => {
  const r = await run("physics.beamDeflection", { loadN: 1000, lengthM: 2 });
  assert.ok(r.result.error);
  assert.ok(r.result.inputSchema.SI.required.includes("modulusPa"));
});

test("unknown function returns closest keys with input schemas", async () => {
  const r = await run("physics.beam_deflection", { loadN: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.closestKeys[0].key, "physics.beamDeflection");
  assert.ok(r.closestKeys[0].inputSchema.SI.required.includes("loadN"));
  const r2 = await run("engineering.eulerBuckling", { lengthM: 1 });
  assert.ok(r2.closestKeys.some((k) => k.key === "engineering.columnBuckling"));
});
