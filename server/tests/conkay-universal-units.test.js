// Any unit in, SI to the solvers, the person's unit back (owner, 2026-11-26:
// "it's hard to even input inputs like mm feet inches, oz for chemicals").
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmount, parseNumber, parseUnit, convert, formatAmount, scanAmounts } from "../lib/conkay/units/universal.js";

const near = (a, b, rel = 1e-6) => assert.ok(Math.abs(a - b) <= Math.abs(b) * rel + 1e-12, `${a} ≈ ${b}`);
const si = (t, dim) => { const r = parseAmount(t); assert.equal(r.ok, true, `${t}: ${r.error}`); if (dim) assert.equal(r.dim, dim, t); return r.si; };

test("numbers people actually write", () => {
  assert.equal(parseNumber("1,250.5"), 1250.5);
  assert.equal(parseNumber("3/8"), 0.375);
  assert.equal(parseNumber("1 1/2"), 1.5);
  assert.equal(parseNumber("1-1/2"), 1.5);
  assert.equal(parseNumber("½"), 0.5);
  assert.equal(parseNumber("2½"), 2.5);
  assert.equal(parseNumber("2.5e3"), 2500);
  assert.equal(parseNumber("abc"), null);
  assert.equal(parseNumber("1/0"), null);
});

test("lengths: metric, imperial, feet-and-inches, fractions", () => {
  near(si("25 mm", "length"), 0.025);
  near(si("3/8 in", "length"), 0.009525);
  near(si("1 1/2 inches", "length"), 0.0381);
  near(si(`5'6"`, "length"), 1.6764);
  near(si("5′6″", "length"), 1.6764);
  near(si("5 ft 6 in", "length"), 1.6764);
  near(si("6 feet 2 inches", "length"), 1.8796);
  near(si("12 ft", "length"), 3.6576);
  near(si("2 mi", "length"), 3218.688);
});

test("kitchen and lab volumes, and the oz that is a mass", () => {
  near(si("2 fl oz", "volume"), 59.147059125e-6);
  near(si("1.5 cups", "volume"), 354.88235475e-6);
  near(si("250 mL", "volume"), 250e-6);
  near(si("1 gal", "volume"), 3.785411784e-3);
  near(si("3 tbsp", "volume"), 44.36029434375e-6);
  const oz = parseAmount("12 oz");
  assert.equal(oz.dim, "mass");
  near(oz.si, 0.3401942775);
  assert.match(oz.note, /fl oz/);
});

test("chemistry: moles, molarity, fractions, ppm", () => {
  near(si("0.5 M", "molar_concentration"), 500);
  near(si("25 mM", "molar_concentration"), 25);
  near(si("2 mol", "amount"), 2);
  near(si("5 wt%", "mass_fraction"), 0.05);
  near(si("30 ppm", "ratio"), 30e-6);
  near(si("12 g/L", "mass_concentration"), 12);
  near(si("58.44 g/mol", "molar_mass"), 0.05844);
});

test("temperatures convert with their offsets; C and F alone are temperatures, with a note", () => {
  near(si("350 °F", "temperature"), 449.8166666666667);
  near(si("100 °C", "temperature"), 373.15);
  near(si("20 C", "temperature"), 293.15);
  assert.match(parseAmount("350 F").note, /°F/);
  near(si("300 K", "temperature"), 300);
  near(convert(100, "°C", "°F"), 212);
  near(convert(32, "°F", "°C"), 0);
});

test("mechanical, thermal and electrical units, composed or named", () => {
  near(si("40 BTU/h", "power"), 11.7228428068);
  near(si("2000 rpm", "angular_velocity"), 209.43951023931953);
  near(si("12 V", "voltage"), 12);
  near(si("2.5 A", "current"), 2.5);
  near(si("5000 mAh", "charge"), 18000);
  near(si("50 lbf·ft", "torque"), 67.79089741657);
  near(si("50 nm", "torque"), 50);
  near(si("150 psi", "pressure"), 1034213.5939752);
  near(si("2 bar", "pressure"), 200000);
  near(si("0.6 W/m·K", "thermal_conductivity"), 0.6);
  near(si("10 L/min", "volume_flow"), 1 / 6000);
  near(si("60 mph", "velocity"), 26.8224);
  near(si("7850 kg/m³", "density"), 7850);
  near(si("9.81 m/s²", "acceleration"), 9.81);
  near(si("5 kN", "force"), 5000);
  near(si("5 kn", "force"), 5000);
  assert.equal(parseUnit("J").dim, "energy");
});

test("ambiguity is refused or explained, never guessed", () => {
  assert.equal(parseAmount("3 tons").ok, false);
  assert.match(parseAmount("3 tons").error, /short|metric/);
  assert.equal(parseAmount("4 blorps").ok, false);
  const wrong = parseAmount("5 kg", { expectDim: "length" });
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /expected a length/);
  assert.equal(parseAmount(2, { expectDim: "length" }).si, 2);
});

test("results come back in the person's unit with SI alongside", () => {
  assert.equal(formatAmount(1.6764, "length", "ft"), "5.5 ft (1.676 m)");
  assert.equal(formatAmount(0.0254, "length", "m"), "0.0254 m");
  assert.equal(formatAmount(373.15, "temperature", "°F"), "212 °F (373.1 K)");
  // SI is shown with the prefix engineers read it in
  assert.equal(formatAmount(5000, "force"), "5 kN");
  assert.equal(formatAmount(23.21e6, "pressure", "psi"), "3366 psi (23.21 MPa)");
  assert.equal(formatAmount(0.75, "current"), "0.75 A");
});

test("scanning a brief finds every amount and leaves words alone", () => {
  const s = scanAmounts(`a 3 ft shelf, 5'6" tall, that holds 50 lb, made of 3/4 in plywood; mix 12 oz water with 2 fl oz vinegar at 120 °F; make a 3d model and put 5 in the box`);
  const raws = s.amounts.map((a) => a.raw);
  for (const r of ["3 ft", `5'6"`, "50 lb", "3/4 in", "12 oz", "2 fl oz", "120 °F"]) assert.ok(raws.includes(r), `${r} in ${JSON.stringify(raws)}`);
  assert.ok(!raws.some((r) => /^3d/.test(r)), "3d is not three days");
  assert.ok(!raws.includes("5 in"), "5 in the box is not five inches");
  const amps = scanAmounts("a 12 V pump drawing 2 A");
  assert.deepEqual(amps.amounts.map((a) => a.dim), ["voltage", "current"]);
  assert.equal(scanAmounts("about 3 tons of gravel").errors.length, 1);
});
