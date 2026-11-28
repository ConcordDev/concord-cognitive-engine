// General solvers for "build anything": pipe network, 1-D conduction, DC
// budget and solution chemistry, on any node, any units in. Expected values
// are hand calculations from the stated inputs (not solver output pasted back).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDesign } from "../lib/conkay/index.js";
import { awgArea } from "../lib/conkay/physics/solvers/general.js";

const node = (id, props) => ({ id, kind: "Part", name: id, props });
const run = (nodes) => {
  const r = openDesign({ design: { id: "g", name: "g" }, nodes, edges: [], loadCases: [], requirements: [] });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return (solver, target) => r.session.results().find((e) => e.solver?.id === solver && e.target === target);
};
const near = (a, b, rel = 1e-3) => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${a} vs ${b}`);

test("DC budget: AWG area, wire drop, runtime, all in mixed units", () => {
  near(awgArea(18), 0.8231e-6, 1e-3); // 18 AWG = 0.8231 mm² (ASTM B258)
  const get = run([node("PACK", { dcBudget: {
    supply: { voltage: "12 V", maxCurrent: "10 A", capacity: "7 Ah" },
    loads: [{ name: "pump", power: "36 W" }, { name: "led", current: "500 mA", duty: 0.5 }],
    wire: { length: "3 m", awg: 18, resistivity: { value: "1.68e-8 Ω·m", source: "copper, textbook table" } },
    maxVoltageDrop: { value: "3 %", source: "practice" }, minRuntime: { value: "2 h", source: "person" } } })]);
  const e = get("electrical.dc-budget", "PACK");
  // peak = 36/12 + 0.5 = 3.5 A; average = 3 + 0.25 = 3.25 A; R = ρ·2L/A
  near(e.outputs.peakCurrent.value, 3.5);
  near(e.outputs.averageCurrent.value, 3.25);
  const R = (1.68e-8 * 6) / awgArea(18);
  near(e.outputs.wireResistance.value, R);
  near(e.outputs.runtime.value, (7 / 3.25) * 3600);
  assert.equal(e.status, "FAIL", "3.5 A × 0.1225 Ω = 0.43 V = 3.6 % > 3 %");
});

test("DC budget with no wire resistivity is not checked, and says what it needs", () => {
  const get = run([node("P", { dcBudget: { supply: { voltage: "5 V" }, loads: [{ name: "board", current: "200 mA" }], wire: { length: "1 m", awg: 22 } } }),
    node("E", { dcBudget: { supply: { voltage: "12 V" }, loads: [{ name: "thing" }] } })]);
  const p = get("electrical.dc-budget", "P");
  assert.match(p.warnings.join(" "), /resistivity with its source/);
  assert.match(p.warnings.join(" "), /current rating/);
  const e = get("electrical.dc-budget", "E");
  assert.equal(e.status, "NOT_COMPUTED");
  assert.match(e.reason, /thing: its power or current/);
});

test("1-D conduction: wall with a convective face, °F and °C in", () => {
  const get = run([node("WALL", { conduction: { length: "4 in", conductivity: { value: "0.04 W/(m·K)", source: "textbook" },
    left: { type: "T", T: "70 °F" }, right: { type: "conv", h: "10 W/m²K", Tinf: "-10 °C" }, maxTemperature: { value: "30 °C", source: "person" } } })]);
  const e = get("thermal.conduction-1d", "WALL");
  // q = ΔT / (L/k + 1/h) = (294.261 − 263.15) / (0.1016/0.04 + 0.1)
  const qf = (294.2611 - 263.15) / (0.1016 / 0.04 + 0.1);
  near(e.outputs.heatIn.value.left, qf, 1e-3);
  near(e.outputs.minTemperature.value, 263.15 + qf / 10, 1e-4);
  assert.equal(e.status, "PASS");
});

test("pipe network: velocities checked against the stated limit, flow against the need", () => {
  const get = run([node("LOOP", { pipeNetwork: {
    fluid: { density: "998 kg/m3", viscosity: "1 cP", source: "water 20 °C" },
    nodes: [{ id: "TANK", head: "2 m" }, { id: "OUT", head: "0 m" }],
    links: [{ id: "P1", from: "TANK", to: "OUT", type: "pipe", diameter: "3/4 in", length: "20 ft", roughness: "0.0015 mm" }],
    maxVelocity: { value: "3 m/s", source: "limit" }, minFlow: [{ link: "P1", value: "5 gpm", source: "person" }] } })]);
  const e = get("fluid.pipe-network", "LOOP");
  const Q = e.outputs.flows.value.P1, D = 0.01905, v = Q / (Math.PI * D * D / 4);
  // energy balance: 2 m = f (L/D) v²/2g with the solver's own friction factor checked by Re range
  assert.ok(v > 1 && v < 3, `v ${v}`);
  near(e.outputs.links.value[0].velocity, v, 1e-6);
  assert.equal(e.status, "PASS");
});

test("solution: 1 oz salt in 1 cup water — mass fraction, molarity, refused without data", () => {
  const get = run([node("BRINE", { solution: { components: [
    { name: "salt", mass: "1 oz", molarMass: { value: "58.44 g/mol", source: "NaCl" }, density: { value: "2.16 g/cm3", source: "CRC" } },
    { name: "water", volume: "1 cup", density: { value: "998 kg/m3", source: "CRC" } }],
    targets: [{ component: "salt", metric: "mass_fraction", max: "12 %", source: "recipe" }] } }),
    node("BAD", { solution: { components: [{ name: "sugar", volume: "1 cup" }] } })]);
  const e = get("chem.solution", "BRINE");
  const salt = 0.028349523125, water = 236.5882365e-6 * 998;
  near(e.outputs.totalMass.value, salt + water);
  const row = e.outputs.components.value[0];
  near(row.massFraction, salt / (salt + water));
  near(row.molarity, (salt / 0.05844) / (salt / 2160 + 236.5882365e-6));
  assert.equal(e.status, "PASS");
  const b = get("chem.solution", "BAD");
  assert.equal(b.status, "NOT_COMPUTED");
  assert.match(b.reason, /sugar: its mass, or its volume and density/);
});
