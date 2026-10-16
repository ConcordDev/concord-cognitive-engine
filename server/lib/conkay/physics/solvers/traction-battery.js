// server/lib/conkay/physics/solvers/traction-battery.js
//
// vehicle.traction-battery: the electric car's pack against its motor and its
// brief (powertrain/ev-pack.js for the pack, the motor module's data sheet for
// the motor, vehicle.required-power for the road load).
//
//   voltage     pack at full charge (series × 4.2 V) ≤ the motor module's
//               maximum DC voltage
//   power       pack continuous power at its discharge limit (parallel × 45 A ×
//               series × 2.5 V) ≥ the motor's continuous rating, and ≥ the
//               electrical power to hold the required top speed at both ends of
//               the drag build-up's Cd range: P_elec = road load / (driveline η ×
//               motor η), motor η = the module's PEAK combined efficiency (a best
//               case: the electrical power is a lower bound, so this check errs
//               toward passing; stated)
//   heat        pack conduction loss I² R at that power, R = series × R_dc /
//               parallel (data sheet DC impedance at 50 % SOC): the heat a pack
//               cooling system would have to remove. No pack cooling is designed,
//               so any sustained loss is a WARN, never a pass.
//   range       usable energy (estimated window 0.7–0.9) / P_elec at steady speeds
//               on the same road-load model: an upper bound (best-case η, no
//               accessories, no acceleration, no regeneration, flat road)
//   charge      cell-limited charge power (parallel × 13.5 A × nominal V); the
//               on-board charger is not designed.

import { registerSolver } from "../registry.js";
import { getComponent } from "../../components/index.js";

const G = 9.80665;
const vehicles = (g) => [...g.nodes.values()].filter((n) => n.props?.vehicle?.fuelType === "electric").map((n) => n.id);

export const tractionBattery = registerSolver({
  id: "vehicle.traction-battery",
  version: "1.0.0",
  domain: "electrical.traction",
  domains: ["electrical.traction", "thermal.battery"],
  fidelity: 1,
  method: "pack voltage window vs the motor's DC limit; pack continuous power at the discharge limit vs the motor's continuous rating and the electrical power to hold the required speed (road load / (driveline η × peak motor η), both ends of the Cd range); I²R conduction loss; range at steady speeds = usable energy / electrical power (upper bound)",
  reference: "server/lib/conkay/powertrain/ev-pack.js; Molicel P45B and Cascadia iM data sheets",
  regime: "steady state, flat road, no accessories, no regeneration, cell properties at 25 °C / 50 % SOC as on the data sheet",
  targets: (g) => vehicles(g).filter((id) => [...g.nodes.values()].some((n) => n.props?.battery)),
  run(ctx, veh) {
    const cellsNode = [...ctx.graph.nodes.values()].find((n) => n.props?.battery);
    const bat = ctx.get(cellsNode.id, "props.battery");
    const motor = [...ctx.graph.nodes.values()].find((n) => n.kind === "Actuator" && n.props?.component);
    if (!motor) return { notComputed: "no motor in the design" };
    const m = getComponent(ctx.get(motor.id, "props.component"));
    const c = bat.cell, S = bat.series, P = bat.parallel;
    const vMax = S * c.maxV, vNom = S * c.nominalV, vMin = S * c.minV;
    const iCont = P * c.maxContinuousA, rPack = (S * c.dcResistanceOhm) / P;
    const pContMin = iCont * vMin, pContNom = iCont * vNom;
    const req = ctx.result("vehicle.required-power", veh);
    if (!req || req.status === "NOT_COMPUTED") return { notComputed: `needs vehicle.required-power (${req?.reason || "missing"})` };
    const inp = req.inputs;
    const rho = inp.airDensity.value, A = inp.frontalArea.value, crr = inp.rollingResistance.value, eta = inp.drivelineEfficiency.value, mass = inp.mass.value, vReq = inp.requiredTopSpeed.value;
    const aero = ctx.result("aero.drag-buildup", veh);
    const band = aero?.outputs?.dragCoefficient?.value;
    const cds = band && Number.isFinite(band.low) ? { low: band.low, centre: band.centre, high: band.high } : { centre: inp.dragCoefficient.value };
    const etaMotor = m.ratings.combinedEfficiency?.value ?? null;
    if (!Number.isFinite(etaMotor)) return { notComputed: `${m.id} publishes no efficiency` };
    const pElec = (v, cd) => (0.5 * rho * cd * A * v ** 3 + crr * mass * G * v) / (eta * etaMotor);
    const atReq = Object.fromEntries(Object.entries(cds).map(([k, cd]) => [k, pElec(vReq, cd)]));
    const worst = Math.max(...Object.values(atReq));
    const lossAt = (p, v = vNom) => { const i = p / v; return i * i * rPack; };
    const usable = bat.choices?.usableFraction?.value ?? 0.8;
    const uRange = bat.choices?.usableFraction?.range || [usable, usable];
    const eNom = S * P * c.energyWh, eMin = S * P * c.energyMinWh;
    const speeds = [50, 100, 130, 200, vReq * 3.6].map((k) => Math.round(k));
    const range = speeds.map((kmh) => {
      const v = kmh / 3.6, p = pElec(v, cds.centre);
      const hours = (wh) => wh / p;
      return { kmh, electricalKw: +(p / 1000).toFixed(2), rangeKm: { low: +(hours(eMin * uRange[0]) * kmh).toFixed(1), high: +(hours(eNom * uRange[1]) * kmh).toFixed(1) } };
    });
    const maxDcV = m.ratings.maxDcVoltageV?.value;
    const contMotor = m.ratings.continuousPowerW?.value;
    const margins = [];
    if (Number.isFinite(maxDcV)) margins.push({ check: `pack at full charge (${S} × ${c.maxV} V) ≤ ${m.model} maximum DC voltage`, demand: vMax, capacity: maxDcV, unit: "V" });
    if (Number.isFinite(contMotor)) margins.push({ check: `pack continuous power at its discharge limit (${P} × ${c.maxContinuousA} A × ${vMin} V) ≥ the motor's continuous rating`, demand: contMotor, capacity: pContMin, unit: "W" });
    margins.push({ check: `pack continuous power at its discharge limit ≥ electrical power to hold the required ${(vReq * 3.6).toFixed(0)} km/h (Cd ${cds.high ? "high end" : "centre"}; motor at its peak efficiency, a lower bound on the power)`, demand: worst, capacity: pContMin, unit: "W" });
    const heat = lossAt(worst);
    const warnings = [`pack conduction loss holding ${(vReq * 3.6).toFixed(0)} km/h: ${(heat / 1000).toFixed(1)} kW (I² R, R = ${rPack.toFixed(3)} Ω at the data sheet's 50 % SOC DC impedance); no pack cooling is designed, so sustained top speed is not shown to be thermally possible`];
    const peakPack = iCont * vNom;
    return {
      inputs: {
        pack: { value: { series: S, parallel: P, cells: S * P, cell: c.model }, source: c.source.url },
        motor: { value: { id: m.id, maxDcVoltageV: maxDcV ?? null, continuousW: contMotor ?? null, peakW: m.ratings.peakPowerW.value, peakEfficiency: etaMotor }, source: m.mass.massState.source.url },
        roadLoad: { value: { mass, frontalArea: A, dragCoefficient: cds, rollingResistance: crr, drivelineEfficiency: eta, airDensity: rho }, source: req.runId },
      },
      outputs: {
        voltage: { value: { max: vMax, nominal: vNom, min: vMin }, unit: "V" },
        energy: { value: { nominalWh: eNom, minimumWh: eMin, usableWh: { low: eMin * uRange[0], high: eNom * uRange[1] } }, unit: "Wh", note: `usable window ${uRange.join("–")} estimated (not on the data sheet)` },
        continuousPower: { value: { atMinV: pContMin, atNominalV: pContNom }, unit: "W" },
        peakPowerAvailable: { value: Math.min(m.ratings.peakPowerW.value, peakPack), unit: "W", note: `the lower of the motor's peak (${m.ratings.peakPowerW.published}) and the pack at nominal voltage on its continuous cell current (no pulse rating published)` },
        electricalPowerAtRequiredSpeed: { value: atReq, unit: "W", note: "road load / (driveline η × motor peak η) at each Cd of the build-up range" },
        packLossAtRequiredSpeed: { value: heat, unit: "W" },
        packResistance: { value: rPack, unit: "ohm" },
        range: { value: range, note: "steady speed, flat road, Cd centre, usable energy over the estimated window; an upper bound: peak motor efficiency, no accessories, no acceleration" },
        chargePowerCellLimit: { value: P * c.maxChargeA * vNom, unit: "W", note: `${P} × ${c.maxChargeA} A (data sheet maximum charge) × nominal V; the charger is not designed` },
      },
      margins, warnings,
      covers: [veh, cellsNode.id],
      assumptions: [
        "Motor efficiency is the module's published peak (95 %); part-load efficiency is lower, so the electrical power is a lower bound and the range an upper bound.",
        "Pack resistance from the cell's DC impedance at 50 % SOC; it rises at low SOC and low temperature (not modelled).",
        "No pack cooling, BMS, contactors or HV junction box are designed (ev-pack.js NOT_INCLUDED).",
      ],
    };
  },
});
