// server/lib/conkay/physics/solvers/energy-balance.js
//
// Conservation of energy as a generic check (Sentinel/RAM spec section 2):
//
//   net = Σ external inputs + Σ recovered(measured) − Σ outputs/loads
//
// Recovered energy is credited only when it is measured; an unverified
// recovery is listed and rejected, never assumed. A claim of perpetual /
// self-sustaining operation is contradicted whenever the balance is
// negative or rests on unverified recovery.
//
// energyBalance() is the pure function (used by the spec re-checks on the
// hydrogen loop). The registered solver "conservation.energy" applies it to
// a design's electrical budget and solar intake.

import { registerSolver } from "../registry.js";

export function energyBalance({ inputs = [], outputs = [], recovered = [], claim = null }) {
  const units = new Set([...inputs, ...outputs, ...recovered].map((x) => x.unit));
  if (units.size > 1) throw new Error(`energyBalance: mixed units ${[...units].join(", ")}`);
  const sum = (xs) => xs.reduce((s, x) => s + x.energy, 0);
  const credited = recovered.filter((r) => r.measured === true);
  const rejected = recovered.filter((r) => r.measured !== true).map((r) => ({ id: r.id, reason: "recovered energy is credited only when measured" }));
  const totalIn = sum(inputs) + sum(credited);
  const totalOut = sum(outputs);
  const net = totalIn - totalOut;
  const ratio = totalOut && sum(inputs) ? totalOut / sum(inputs) : null;
  const perpetualClaim = claim === "self-sustaining" || claim === "perpetual";
  return {
    unit: [...units][0] || null,
    totalIn, totalOut, net, ratio,
    credited: credited.map((r) => r.id),
    rejected,
    verdict: net >= 0 ? "closes" : "deficit",
    claimVerdict: perpetualClaim ? (ratio != null && ratio < 1 ? "contradicted" : rejected.length ? "contradicted" : "not shown") : null,
  };
}

export const conservationEnergy = registerSolver({
  id: "conservation.energy",
  version: "1.0.0",
  domain: "conservation.energy",
  fidelity: 0,
  method: "daily energy balance: solar intake (estimated) + measured recovery vs average load × operating hours",
  regime: "steady daily average; no storage losses beyond the usable fraction",
  units: { inputs: "W, Wh/day", outputs: "Wh/day, h/day" },
  tolerance: "exact arithmetic",
  screening: true,
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.electrical).map((n) => n.id),
  run(ctx, id) {
    const el = ctx.result("electrical.budget", id);
    const sol = ctx.result("energy.solar-yield", id);
    if (!el || el.status === "NOT_COMPUTED") return { notComputed: `no electrical budget (${el?.reason || "missing"})` };
    const pAvg = el.outputs.averagePower.value;
    const solarDay = sol && sol.status !== "NOT_COMPUTED" ? sol.outputs.dailyEnergy.value : 0;
    const recovered = (ctx.get(id, "props.electrical.recovered") || []).map((r) => ({ ...r, unit: "Wh" }));
    const claim = ctx.get(id, "props.electrical.claim") || null;
    const hoursPerDay = ctx.get(id, "props.electrical.operatingHoursPerDay");
    const bal = energyBalance({
      inputs: [{ id: "solar", energy: solarDay, unit: "Wh", status: "estimated" }],
      outputs: Number.isFinite(hoursPerDay) ? [{ id: "load", energy: pAvg * hoursPerDay, unit: "Wh" }] : [],
      recovered,
      claim,
    });
    const margins = [];
    if (claim === "self-sustaining" || claim === "perpetual") {
      margins.push({ check: "daily load ≤ daily intake (claimed self-sustaining)", demand: pAvg * 24, capacity: bal.totalIn, unit: "Wh" });
    }
    return {
      inputs: {
        averagePower: { value: pAvg, unit: "W", source: el.runId },
        solarDailyEnergy: { value: solarDay, unit: "Wh", source: sol?.runId || "none", status: "estimated" },
        ...(Number.isFinite(hoursPerDay) ? { operatingHoursPerDay: { value: hoursPerDay, unit: "h" } } : {}),
      },
      outputs: {
        solarOnlyHoursPerDay: { value: pAvg > 0 ? solarDay / pAvg : null, unit: "h" },
        ...(Number.isFinite(hoursPerDay) ? { dailyNet: { value: bal.net, unit: "Wh" } } : {}),
        recoveredRejected: { value: bal.rejected.map((r) => r.id) },
      },
      margins,
      warnings: bal.rejected.length ? [`unmeasured recovery not credited: ${bal.rejected.map((r) => r.id).join(", ")}`] : [],
      assumptions: ["Solar intake is an estimate (typical-year irradiance), not a measured credit.", "Recovered energy counts only when measured (spec section 2)."],
    };
  },
});
