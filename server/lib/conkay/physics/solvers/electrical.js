// server/lib/conkay/physics/solvers/electrical.js
//
// electrical.budget — rails kept separate (actuators, compute, sensors,
// thermal, experimental; spec 4.4). Peak = the simultaneous peaks the
// control policy can command (props.electrical.policy.maxSimultaneousPeak
// actuators at datasheet peak current, the rest at rated); average = the
// duty-cycle sum (mission profile); low-voltage rails divided by the DC-DC
// efficiency. Battery: nominal Wh from the cell datasheet × cell count,
// mission energy = nominal × (usable fraction − reserve), duration = mission
// energy / average power. An undersized battery is a failed check, never a
// prompt to assume regeneration (spec 4.4).
//
// energy.solar-yield — daily array energy from plane-of-array irradiance
// (estimated unless measured), panel area and nameplate efficiency from the
// datasheet, system losses, a temperature derate from the datasheet
// coefficient at NOCT, and charge-controller efficiency.

import { registerSolver } from "../registry.js";

function bodies(ctx, id, out = []) {
  for (const child of ctx.children(id, "CONTAINS")) {
    if (child.kind === "Assembly") bodies(ctx, child.id, out);
    else out.push(child);
  }
  return out;
}

const val = (q) => (q && typeof q === "object" ? q.value : q);
const est = (q, name) => (q?.state === "estimated" ? [`${name} = ${q.value} is an estimate${q.range ? ` (range ${q.range.join("–")})` : ""}${q.basis ? `: ${q.basis}` : ""}`] : []);

export const electricalBudget = registerSolver({
  id: "electrical.budget",
  version: "1.0.0",
  domain: "electrical.power",
  domains: ["electrical.power", "electrical.battery"],
  fidelity: 0,
  method: "peak = policy-limited simultaneous peaks; average = duty-cycle sum; t = E_batt·(usable − reserve)/P_avg",
  regime: "DC steady averages over a mission profile; no thermal or ageing derating of cells",
  units: { inputs: "V, A, W, Wh", outputs: "W, Wh, h, A" },
  tolerance: "exact arithmetic",
  screening: true,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.electrical).map((n) => n.id),
  run(ctx, id) {
    const el = ctx.get(id, "props.electrical");
    const eta = val(el.dcdcEfficiency);
    const prof = el.profile || {};
    const duty = val(prof.walkFraction) * val(prof.walkLoadFactor) + (1 - val(prof.walkFraction)) * val(prof.standLoadFactor);
    const nPeak = val(el.policy?.maxSimultaneousPeak);
    if (![eta, duty, nPeak].every(Number.isFinite)) return { notComputed: "props.electrical needs dcdcEfficiency, profile (walkFraction, walkLoadFactor, standLoadFactor) and policy.maxSimultaneousPeak" };
    const rails = {};
    const act = [];
    const lv = [];
    const unknownLoads = [];
    for (const n of bodies(ctx, id)) {
      const l = ctx.get(n.id, "props.load");
      if (!l) continue;
      if (l.rail === "actuators") {
        if (![l.voltageV, l.ratedCurrentA, l.peakCurrentA].every(Number.isFinite)) { unknownLoads.push(n.id); continue; }
        act.push({ id: n.id, rated: l.voltageV * l.ratedCurrentA, peak: l.voltageV * l.peakCurrentA, source: l.source });
      } else {
        const typ = val(l.typicalW); const pk = val(l.peakW) ?? typ;
        if (!Number.isFinite(typ)) { unknownLoads.push(n.id); continue; }
        lv.push({ id: n.id, rail: l.rail, typical: typ, peak: pk, state: l.typicalW?.state, source: l.typicalW?.source });
      }
    }
    const byPeak = [...act].sort((a, b) => b.peak - a.peak || a.id.localeCompare(b.id));
    const actPeak = byPeak.reduce((s, a, i) => s + (i < nPeak ? a.peak : a.rated), 0);
    const actAvg = act.reduce((s, a) => s + a.rated * duty, 0);
    rails.actuators = { peakW: actPeak, averageW: actAvg };
    for (const l of lv) {
      rails[l.rail] = rails[l.rail] || { peakW: 0, averageW: 0 };
      rails[l.rail].peakW += l.peak / eta;
      rails[l.rail].averageW += l.typical / eta;
    }
    const peak = Object.values(rails).reduce((s, r) => s + r.peakW, 0);
    const avg = Object.values(rails).reduce((s, r) => s + r.averageW, 0);

    const batId = el.battery;
    const bat = batId ? ctx.get(batId, "props.battery") : null;
    if (!bat) return { notComputed: "no battery node (props.electrical.battery)" };
    const c = bat.cell;
    const cells = bat.series * bat.parallel;
    const nominalWh = cells * c.energyWh;
    const usable = val(bat.usableFraction); const reserve = val(bat.reserveFraction);
    const missionWh = nominalWh * (usable - reserve);
    const hours = missionWh / avg;
    const vMin = bat.series * c.minV; const vNom = bat.series * c.nominalV; const vMax = bat.series * c.maxV;
    const peakCurrent = peak / vMin;
    const contCurrent = bat.parallel * c.maxContinuousA;
    const warnings = [
      ...est(prof.walkFraction, "walk fraction"), ...est(prof.walkLoadFactor, "walking load factor"), ...est(prof.standLoadFactor, "standing load factor"),
      ...est(el.policy?.maxSimultaneousPeak, "simultaneous peak actuators"), ...est(el.dcdcEfficiency, "DC-DC efficiency"), ...est(bat.usableFraction, "usable fraction"),
      ...lv.filter((l) => l.state === "estimated").map((l) => `${l.id} load ${l.typical} W is an estimate`),
      ...(unknownLoads.length ? [`loads with no stated power (not counted): ${unknownLoads.join(", ")}`] : []),
      ...(el.actuatorMaxInputV == null ? [`pack max voltage ${vMax.toFixed(1)} V vs actuator maximum input: not in the datasheet read (unknown)`] : []),
    ];
    return {
      inputs: {
        actuators: { value: act.map(({ id: i, rated, peak: p }) => ({ id: i, ratedW: rated, peakW: p })), source: act[0]?.source },
        lowVoltageLoads: { value: lv },
        duty: { value: duty, status: "estimated" },
        battery: { value: { node: batId, series: bat.series, parallel: bat.parallel, cell: c.model, cellWh: c.energyWh, cellMinV: c.minV, cellMaxA: c.maxContinuousA }, source: c.source },
        usableFraction: { value: usable, status: bat.usableFraction?.state }, reserveFraction: { value: reserve, status: bat.reserveFraction?.state },
      },
      outputs: {
        peakPower: { value: peak, unit: "W" }, averagePower: { value: avg, unit: "W" }, rails: { value: rails, unit: "W" },
        batteryNominalEnergy: { value: nominalWh, unit: "Wh" }, missionEnergy: { value: missionWh, unit: "Wh" },
        operatingDuration: { value: hours * 3600, unit: "s" },
        operatingDurationHours: { value: hours, unit: "h" },
        packVoltage: { value: { min: vMin, nominal: vNom, max: vMax }, unit: "V" },
        peakCurrentAtMinV: { value: peakCurrent, unit: "A" }, continuousCurrentRating: { value: contCurrent, unit: "A" },
      },
      margins: [{ check: "peak current at end-of-discharge voltage ≤ cells' continuous rating", demand: peakCurrent, capacity: contCurrent, unit: "A" }],
      warnings,
      assumptions: ["Experimental rail (QCL) is excluded: not part of Milestone 1 (spec 3.1, 6).", "No regeneration credited (spec 4.4).", "Reserve energy is not available to the mission."],
    };
  },
});

export const solarYield = registerSolver({
  id: "energy.solar-yield",
  version: "1.0.0",
  domain: "energy.solar",
  fidelity: 0,
  method: "E_day = H_poa · A · η_STC · (1 − losses) · (1 + γ·(T_NOCT − 25)) · η_controller",
  reference: "PVWatts v5 manual default losses (14 %); datasheet γ and NOCT",
  regime: "daily average over a typical year; NOCT cell temperature",
  units: { inputs: "kWh/m²/day, m², 1", outputs: "Wh/day" },
  tolerance: "exact arithmetic; inputs are estimates",
  screening: true,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.electrical?.solarPanel).map((n) => n.id),
  run(ctx, id) {
    const pid = ctx.get(id, "props.electrical.solarPanel");
    const p = ctx.get(pid, "props.solar");
    if (!p) return { notComputed: `${pid} has no props.solar` };
    const A = p.panel.lengthM * p.panel.widthM;
    const H = val(p.irradianceDaily);
    const derateT = 1 + (p.panel.tempCoeffPctPerC / 100) * (p.panel.noctC - 25);
    const dcDay = H * 1000 * A * p.panel.efficiency * (1 - val(p.systemLosses)) * derateT;
    const day = dcDay * val(p.controllerEfficiency);
    const stc = A * p.panel.efficiency * 1000;
    const warnings = [
      ...(p.irradianceDaily.state !== "measured" ? [`irradiance ${H} kWh/m²/day is ${p.irradianceDaily.state} (${p.irradianceDaily.basis}), not measured at the site`] : []),
      ...est(p.controllerEfficiency, "charge-controller efficiency"),
      ...(Math.abs(stc - p.panel.nameplateW) / p.panel.nameplateW > 0.02 ? [`area × efficiency × 1000 W/m² = ${stc.toFixed(1)} W differs from the ${p.panel.nameplateW} W nameplate by more than 2 %`] : []),
    ];
    return {
      inputs: {
        area: { value: A, unit: "m2", source: p.panel.source }, efficiency: { value: p.panel.efficiency, source: p.panel.source },
        irradianceDaily: { value: H, unit: "kWh/m2/day", status: p.irradianceDaily.state, source: p.irradianceDaily.source },
        systemLosses: { value: val(p.systemLosses), source: p.systemLosses.source }, temperatureDerate: { value: derateT, status: "estimated" },
        controllerEfficiency: { value: val(p.controllerEfficiency), status: p.controllerEfficiency.state },
      },
      outputs: { dailyEnergy: { value: day, unit: "Wh" }, dailyDcEnergy: { value: dcDay, unit: "Wh" }, stcPower: { value: stc, unit: "W" } },
      warnings,
      assumptions: ["Temperature derate at NOCT (47 °C cell) from the datasheet coefficient: a typical-day estimate.", "Solar is external intake, not recovered energy; it is not added to battery endurance."],
    };
  },
});
