// server/lib/conkay/physics/solvers/coolant-loop.js
//
// fluid.coolant-loop: the engine coolant-loop screen (fluids/coolant-loop.js)
// on the pipe-flow core (fluids/pipe-flow.js, benchmarked in
// tests/conkay-pipe-flow.test.js). See the module header for what is and is
// not claimed. Checks:
//   - the flow each pump must deliver lies inside its published curve points
//     (outside them the pump's pressure rise is not known: FAIL, not a guess);
//   - the pump's pressure rise at the required flow exceeds the hose losses
//     (else no radiator / block pressure budget is left: FAIL).
// The radiator and engine block pressure drops are unknown, so the run is never
// a PASS: at best it reports the budget they must fit within.

import { registerSolver } from "../registry.js";
import { getComponent } from "../../components/index.js";
import { pipeHeadLoss, pumpCurve, solveNetwork, G, PIPE_FLOW_VERSION } from "../../fluids/pipe-flow.js";
import { COOLANT_LOOP_VERSION } from "../../fluids/coolant-loop.js";

/** The screen at one set of choices (SI). */
export function coolantScreen({ powerW, water, pump, c }) {
  const fluid = { rho: water.rho.value, mu: water.mu.value };
  const cp = water.cp.value;
  const heat = powerW * c.heatToCoolantFraction.value;
  const Qreq = heat / (fluid.rho * cp * c.radiatorDeltaT.value);
  const n = c.pumpsInParallel.value;
  const curve = pumpCurve(pump.points);
  const hose = { id: "hoses", type: "pipe", D: c.hoseId.value, L: c.hoseLength.value, eps: c.hoseRoughness.value, K: [{ label: `${c.bends.value} bends`, K: c.bends.value * c.bendK.value }] };
  const hl = pipeHeadLoss(hose, Qreq, fluid);
  const dpHose = hl.h * fluid.rho * G;
  const perPump = Qreq / n;
  const inRange = perPump >= curve.range[0] && perPump <= curve.range[1];
  const dpPump = inRange ? curve.dp(perPump) : null;
  // hoses-only loop: pumps (parallel, identical: one pump at Q/n) + hoses, closed through a tank node at head 0
  const parallelCurve = { ...curve, dp: (Q) => curve.dp(Q / n), range: [curve.range[0] * n, curve.range[1] * n] };
  const bound = solveNetwork({ fluid, nodes: [{ id: "tank", head: 0 }, { id: "pump-out" }], links: [{ id: "pump", from: "tank", to: "pump-out", type: "pump", curve: parallelCurve }, { ...hose, from: "pump-out", to: "tank" }] }, { Q0: Qreq });
  return { heat, Qreq, perPump, curve, inRange, dpPump, dpHose, budget: dpPump == null ? null : dpPump - dpHose, hose: hl, bound };
}

export const coolantLoop = registerSolver({
  id: "fluid.coolant-loop",
  version: "1.0.0",
  domain: "fluid.internal",
  domains: ["fluid.internal", "fluid.pump", "thermal.cooling"],
  fidelity: 1,
  method: "required coolant flow from the engine heat rejection; Darcy-Weisbach + Colebrook hose losses with bend K; pump pressure rise from its published points (interpolation only); pressure budget left for the engine block and radiator; hoses-only operating point (Newton network solve) as an upper bound on flow",
  reference: "server/lib/conkay/fluids/coolant-loop.js; benchmarks in tests/conkay-pipe-flow.test.js",
  regime: "incompressible single-phase water at one state (NIST WebBook, 343-363 K at 1 atm), fully developed turbulent hose flow, pump curve interpolated only, no cavitation check",
  units: { inputs: "W, m, kg/m^3, Pa s, J/kg K", outputs: "m^3/s, Pa" },
  tolerance: "network residual < 1e-10 m; friction factor = Colebrook to 1e-10 (tests)",
  screening: true,
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.coolantLoop).map((n) => n.id),
  run(ctx, id) {
    const cl = ctx.get(id, "props.coolantLoop");
    const engine = getComponent(ctx.get(cl.engine, "props.component"));
    const powerW = engine?.ratings?.peakPowerW?.value;
    if (!Number.isFinite(powerW)) return { notComputed: `engine ${cl.engine} has no sourced peak power` };
    const c = cl.choices;
    if (c.designTempK.value < cl.water.validRangeK[0] || c.designTempK.value > cl.water.validRangeK[1]) return { notComputed: "design temperature outside the NIST rows read" };
    const s = coolantScreen({ powerW, water: cl.water, pump: cl.pump, c });
    const L = 60000;
    const margins = [{ check: "flow per pump within the pump's published curve (max published flow)", demand: s.perPump, capacity: s.curve.range[1], unit: "m^3/s" }];
    const failures = [];
    if (s.perPump < s.curve.range[0]) failures.push(`flow per pump ${(s.perPump * L).toFixed(0)} L/min is below the pump's lowest published point: pressure rise not known`);
    if (s.dpPump != null) margins.push({ check: "hose and bend losses ≤ pump pressure rise at the required flow", demand: s.dpHose, capacity: s.dpPump, unit: "Pa" });
    // spread over the estimated heat-to-coolant fraction
    const spread = c.heatToCoolantFraction.range.map((f) => {
      const r = coolantScreen({ powerW, water: cl.water, pump: cl.pump, c: { ...c, heatToCoolantFraction: { ...c.heatToCoolantFraction, value: f } } });
      return { fraction: f, requiredLpm: r.Qreq * L, perPumpLpm: r.perPump * L, inRange: r.inRange, budgetPa: r.budget };
    });
    const warnings = [
      "engine block and radiator pressure drops are not published: the loop operating point is not claimed; the budget is what they may use together at the required flow",
      `pump curve: ${cl.pump.sourceQuality}; ${cl.pump.testConditions.note}`,
      "cavitation (NPSH) is not checked: no pump NPSH data",
      ...(s.hose.flags || []).map((f) => `hoses: ${f}`),
      ...(s.bound.ok ? s.bound.flags.filter((f) => !/outside the pump curve/.test(f) || !s.inRange) : [`hoses-only operating point not solved: ${s.bound.error}`]),
      ...(cl.water.reviews || []).map((r) => `NIST: ${r.reason}`),
    ];
    return {
      inputs: {
        enginePeakPower: { value: powerW, unit: "W", state: "sourced", source: engine.ratings.peakPowerW.published },
        density: { value: cl.water.rho.value, unit: "kg/m^3", state: "sourced", source: cl.water.rho.evidence[0]?.url, claim: cl.water.rho.id, uncertainty: cl.water.rho.uncertainty },
        viscosity: { value: cl.water.mu.value, unit: "Pa s", state: "sourced", source: cl.water.mu.evidence[0]?.url, claim: cl.water.mu.id, uncertainty: cl.water.mu.uncertainty },
        specificHeat: { value: cl.water.cp.value, unit: "J/kg K", state: "sourced", source: cl.water.cp.evidence[0]?.url, claim: cl.water.cp.id, uncertainty: cl.water.cp.uncertainty },
        pump: { value: cl.pump.points.map((p) => ({ lpm: p.Q * L, bar: p.dp / 1e5 })), state: cl.pump.state, source: cl.pump.source.url, excerpt: cl.pump.excerpt },
        ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, { value: v.value, ...(v.range ? { range: v.range } : {}), state: v.state, basis: v.basis }])),
      },
      outputs: {
        heatToCoolant: { value: s.heat, unit: "W" },
        requiredFlow: { value: s.Qreq, unit: "m^3/s", lpm: s.Qreq * L },
        flowPerPump: { value: s.perPump, unit: "m^3/s", lpm: s.perPump * L },
        pumpRiseAtRequiredFlow: { value: s.dpPump, unit: "Pa", note: s.inRange ? "interpolated between the published points" : "not known: the required flow per pump is outside the published points" },
        hoseLoss: { value: s.dpHose, unit: "Pa", Re: s.hose.Re, f: s.hose.f, velocity: s.hose.v },
        blockAndRadiatorBudget: { value: s.budget, unit: "Pa", note: "pressure the engine block and radiator may consume together at the required flow (their drops are not published)" },
        hosesOnlyFlowUpperBound: { value: s.bound.ok ? s.bound.Q.pump : null, unit: "m^3/s", lpm: s.bound.ok ? s.bound.Q.pump * L : null, note: "operating point with zero-loss block and radiator: an upper bound on loop flow, not the operating point" },
        spread: { value: spread },
      },
      margins, failures, warnings,
      assumptions: [
        `Pipe-flow core ${PIPE_FLOW_VERSION}, coolant screen ${COOLANT_LOOP_VERSION}.`,
        "Steady full-load running at the design coolant temperature; water properties (no glycol: the NIST fluid service has no water-glycol mixture).",
        "Identical pumps in parallel share the flow equally.",
      ],
    };
  },
});
