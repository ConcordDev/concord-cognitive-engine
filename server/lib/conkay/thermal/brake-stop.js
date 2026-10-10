// server/lib/conkay/thermal/brake-stop.js
//
// Brake thermal screen for one stop: the car (gross mass from mass.assembly)
// stops from its top-speed requirement at a constant deceleration; the front
// axle's share of the kinetic energy goes into its two rotors.
//   bulk:    temperature rise if the rotor's whole mass absorbed it uniformly
//            (lumped energy balance, exact for the stated energy);
//   surface: transient 1D conduction (thermal/conduction.js) through the
//            friction ring, both faces heated, symmetric about the mid-plane:
//            flux q(t) = P(t) / (2 A_ring), P(t) = share/2 · m · a · v(t),
//            v(t) = v0 - a t (the flux falls linearly to zero at the stop).
// The rotor is a curved-vane (vented) part whose cheek thickness is not
// published; it is modelled as a solid plate of the rotor's sourced mass over
// the friction ring (equivalent thickness = m / (rho A_ring)), stated.
// Every input carries a state; estimates carry ranges, and the screen reruns at
// the ends of each range (one at a time) so the spread is reported, not hidden.

import { getComponent } from "../components/index.js";

export const BRAKE_SCREEN_VERSION = "1.0.0";
const IN = 0.0254, LB = 0.45359237;

// Rotor iron: Wilwood publishes "Spec-37 iron" without a composition or
// properties. Proxy: ASTM A48 Class 30 grey cast iron at room temperature.
export const ROTOR_IRON_PROXY = Object.freeze({
  id: "astm-a48-class30-grey-iron",
  densityKgM3: 7500, conductivityWmK: 46, specificHeatJkgK: 490, solidusC: 1180,
  state: "estimated",
  basis: "proxy material: Wilwood Spec-37 iron properties are not published; ASTM A48 Class 30 (ISO 200, EN-JL1030) grey cast iron, room-temperature values",
  source: { title: "MakeItFrom: ASTM Grade 30 / ISO 200 / EN-JL1030 grey cast iron (density 7.5 g/cm3, thermal conductivity 46 W/m-K, specific heat 490 J/kg-K, solidus 1180 C)", url: "https://www.makeitfrom.com/material-properties/ASTM-Grade-30-or-200-ISO-200-EN-JL-1030-F12101-Grey-Cast-Iron", retrieved: "2026-10-09" },
  referenceTempC: 20,
});

export const BRAKE_ESTIMATES = Object.freeze({
  decelerationG: { value: 1.0, range: [0.8, 1.2], state: "estimated", basis: "stop at 1.0 g; tyre-road friction not sourced for this car" },
  frontShare: { value: 0.7, range: [0.6, 0.8], state: "estimated", basis: "front axle's share of the braking energy; CG height is not known, so dynamic weight transfer is not computed" },
  padRadialHeightM: { value: 0.05, range: [0.04, 0.06], state: "estimated", basis: "pad radial height sets the friction-ring inner radius; Wilwood publishes pad area (11.1 in^2) but not its radial height" },
  initialTempC: { value: 25, range: [25, 25], state: "estimated", basis: "rotor at ambient before the stop (a single stop, not a repeated-stop fade test)" },
  rotorHeatShare: { value: 1.0, range: [1.0, 1.0], state: "design choice", basis: "all friction heat into the rotor (conservative: the pad's share is not credited)" },
});

/** Rotor data from the brake kit's library record (sourced fields only). */
export function rotorFromKit(componentId) {
  const c = getComponent(componentId);
  if (!c) throw new Error(`no component ${componentId}`);
  const rotorSrc = (c.mass?.massState?.componentSources || []).find((s) => /Rotor .*Weight ([\d.]+) lbs/.test(s.title));
  if (!rotorSrc) throw new Error(`${componentId}: no sourced rotor weight in the kit record`);
  const lb = parseFloat(rotorSrc.title.match(/Weight ([\d.]+) lbs/)[1]);
  return {
    massKg: lb * LB, massSource: rotorSrc,
    outerRadiusM: (c.dimensions.rotorDiameterIn * IN) / 2, widthM: c.dimensions.rotorWidthIn * IN, dimensionsSource: c.dimensions.source,
    construction: c.ratings?.rotor || null,
  };
}

/** Add the brake screen to a car IR (from buildCarFromLibrary). Returns a new IR. */
export function withBrakeThermal(ir, { estimates = {}, axle = "front" } = {}) {
  const out = JSON.parse(JSON.stringify(ir));
  const node = out.nodes.find((n) => n.id === `BRAKES_${axle.toUpperCase()}`);
  if (!node?.props?.component) throw new Error(`no BRAKES_${axle.toUpperCase()} component in the car IR`);
  const speedReq = out.requirements.find((r) => r.of?.solver === "vehicle.top-speed");
  if (!speedReq) throw new Error("the car has no top-speed requirement to stop from");
  node.props.brakeThermal = {
    vehicle: "VEH", stopFromRequirement: speedReq.id, rotor: rotorFromKit(node.props.component), material: ROTOR_IRON_PROXY,
    estimates: { ...BRAKE_ESTIMATES, ...estimates }, rotorsOnAxle: 2,
  };
  return out;
}
