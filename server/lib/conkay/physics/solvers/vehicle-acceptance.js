// server/lib/conkay/physics/solvers/vehicle-acceptance.js
//
// mass.breakdown: a vehicle's kerb mass by mass state. Every physical part
// it contains (payload excluded) is sourced, estimated, computed or a
// placeholder; the receipt gives kg and % for each, the uncertainty band
// (estimated ranges summed) and which parts have no mass at all, which makes
// the total a lower bound.
//
// vehicle.acceptance: the gate that says whether a vehicle design is
// physically credible at screening level. It FAILS ("not physically
// credible") when any critical component (engine or motor, transmission,
// differential, wheels, tyres, brakes, suspension, steering, cooling, fuel or
// battery, exhaust for a combustion engine, wiring, interior and seats) is
// still a placeholder or missing, even when every other check passes. It also
// fails on a hard tyre speed or load failure, a failed requirement, or a
// critical part whose published variant doesn't fit the configuration. The
// top speed is reported as a model output with its unverified dependencies,
// never as a validated claim; with an electronic speed limiter (a design
// choice) the limited and the unlimited speeds are both reported.
//
// Verdicts: "not_physically_credible" (any failure); otherwise
// "credible_with_caveats" (status WARN) when anything the pass rests on is
// unverified (a lower-bound mass, a model-output top speed, an estimated
// redline, a speed limiter not yet built), the caveats listed first; and
// "screening_pass_claims_unvalidated" only when there is no caveat at all.

import { registerSolver } from "../registry.js";
import { LOGICAL_KINDS } from "../../compiler/design-ir.js";
import { summarizeMassStates } from "../../verification/mass-state.js";
import { TOP_SPEED_CLAIM_STATUS, TOP_SPEED_UNVERIFIED_DEPENDENCIES, SPEED_LIMITER_DEPENDENCY } from "./vehicle.js";

export const ACCEPTANCE_VERDICT = Object.freeze({
  NOT_CREDIBLE: "not_physically_credible",
  CREDIBLE_WITH_CAVEATS: "credible_with_caveats",
  SCREENING_PASS: "screening_pass_claims_unvalidated",
});

export const CRITICAL_VEHICLE_COMPONENTS = [
  { id: "engine_or_motor", label: "engine or motor" },
  { id: "transmission", label: "transmission" },
  { id: "differential", label: "differential" },
  { id: "wheels", label: "wheels" },
  { id: "tyres", label: "tyres" },
  { id: "brakes", label: "brakes" },
  { id: "suspension", label: "suspension" },
  { id: "steering", label: "steering" },
  { id: "cooling", label: "cooling" },
  { id: "fuel_or_battery", label: "fuel or battery system" },
  { id: "exhaust", label: "exhaust", appliesWhen: "combustion engine (fuelType is not electric)" },
  { id: "wiring", label: "wiring" },
  { id: "interior_seats", label: "interior and seats" },
];

// Categories whose parts may cover one axle only (props.axle: front | rear | both).
const AXLE_CATEGORIES = new Set(["brakes"]);

const vehicles = (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle).map((n) => n.id);

/** Physical parts under an assembly (payload and logical nodes excluded). */
function physicalLeaves(ctx, id, seen = new Set()) {
  const out = [];
  for (const c of ctx.children(id, "CONTAINS")) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (c.kind === "Assembly") out.push(...physicalLeaves(ctx, c.id, seen));
    else if (!LOGICAL_KINDS.has(c.kind) && c.kind !== "Payload") out.push(c);
  }
  return out;
}

function allContained(ctx, id, seen = new Set()) {
  const out = [];
  for (const c of ctx.children(id, "CONTAINS")) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
    if (c.kind === "Assembly") out.push(...allContained(ctx, c.id, seen));
  }
  return out;
}

export const massBreakdown = registerSolver({
  id: "mass.breakdown",
  version: "1.0.0",
  domain: "mass.states",
  fidelity: 0,
  method: "kerb mass by mass state (sourced / estimated / computed / placeholder); uncertainty band = Σ estimated ranges",
  targets: vehicles,
  run(ctx, id) {
    const parts = physicalLeaves(ctx, id);
    if (!parts.length) return { notComputed: "no physical parts in this vehicle yet" };
    const items = [];
    const mismatched = [];
    for (const p of parts) {
      const env = ctx.result("mass.part", p.id);
      const m = env?.outputs?.mass?.value;
      const declared = ctx.get(p.id, "props.massState");
      const app = ctx.get(p.id, "props.applicability");
      if (app && app.ok === false) mismatched.push({ id: p.id, componentId: declared?.componentId || null, mismatches: app.mismatches });
      if (!Number.isFinite(m)) {
        items.push({ id: p.id, massKg: null, massState: declared?.state === "placeholder" ? declared : { state: "placeholder", note: `no mass yet (${env?.reason || "no geometry and no stated mass"})` } });
        continue;
      }
      items.push({ id: p.id, massKg: m, massState: env.outputs.massState?.detail || { state: "placeholder", note: "mass with no state" } });
    }
    const sum = summarizeMassStates(items);
    const pct = (s) => sum.byState[s].pct;
    const warnings = [];
    if (sum.byState.placeholder.count) warnings.push(`${sum.byState.placeholder.count} placeholder part(s): ${sum.byState.placeholder.kg.toFixed(1)} kg (${pct("placeholder").toFixed(1)}% of the known mass) has no real source or computation.`);
    if (sum.unmassed.length) warnings.push(`No mass at all for ${sum.unmassed.join(", ")}: the kerb mass is a lower bound.`);
    for (const x of mismatched) warnings.push(`${x.id}${x.componentId ? ` (${x.componentId})` : ""}: the published variant does not fit this configuration (${x.mismatches.map((mm) => `${mm.field}: needs ${JSON.stringify(mm.required)}, is ${JSON.stringify(mm.actual)}`).join("; ")}).`);
    return {
      inputs: { parts: { value: items.map((i) => ({ id: i.id, massKg: i.massKg, state: i.massState.state, ...(i.massState.componentId ? { componentId: i.massState.componentId } : {}) })), unit: "kg" } },
      outputs: {
        totalMass: { value: sum.totalKg, unit: "kg", note: sum.unmassed.length ? "lower bound: some parts have no mass" : "kerb mass, payload excluded" },
        sourcedPct: { value: pct("sourced"), unit: "%" },
        estimatedPct: { value: pct("estimated"), unit: "%" },
        computedPct: { value: pct("computed"), unit: "%" },
        placeholderPct: { value: pct("placeholder"), unit: "%" },
        byState: { value: sum.byState },
        uncertaintyLow: { value: sum.uncertainty.lowKg, unit: "kg" },
        uncertaintyHigh: { value: sum.uncertainty.highKg, unit: "kg" },
        uncertainty: { value: sum.uncertainty },
        unmassed: { value: sum.unmassed },
        applicabilityMismatches: { value: mismatched },
      },
      warnings,
      assumptions: ["Percentages are of the known (massed) total. Placeholders are counted at face value and have no uncertainty band."],
    };
  },
});

const mph = (v) => `${(v / 0.44704).toFixed(1)} mph`;
function gearEvidence(gear) {
  const o = gear.outputs || {};
  const parts = [`computed: rev limit ${o.revLimitRpm?.value} rpm (${o.revLimitRpm?.source}), final drive ${gear.inputs?.finalDrive?.value} (${gear.inputs?.finalDrive?.source})`];
  if (Number.isFinite(o.gearLimitedTopSpeed?.value)) parts.push(`gear-limited ${mph(o.gearLimitedTopSpeed.value)}`);
  const b = o.gearLimitedTopSpeedRange?.value;
  if (b) parts.push(`${mph(b.low)}–${mph(b.high)} across ${b.rpm.low}–${b.rpm.high} rpm`);
  if (o.gearLimitStatus) parts.push(`${o.gearLimitStatus.value} (limited by ${o.limitedBy.value})`);
  return parts.join("; ");
}

const criticalOf = (ctx, n) => {
  const v = ctx.get(n.id, "props.critical");
  return v == null ? [] : Array.isArray(v) ? v : [v];
};

export const vehicleAcceptance = registerSolver({
  id: "vehicle.acceptance",
  version: "1.2.0",
  domain: "verification.acceptance",
  fidelity: 0,
  method: "gate: every critical component real (not a placeholder), no hard tyre failure, no failed requirement, no applicability mismatch on a critical part",
  targets: (g) => vehicles(g).filter((id) => g.node(id).props.vehicle.acceptance === true || [...g.nodes.values()].some((n) => n.props?.critical != null)),
  run(ctx, id) {
    const fuelType = ctx.get(id, "props.vehicle.fuelType");
    const nodes = allContained(ctx, id);
    const bd = ctx.result("mass.breakdown", id);
    const stateOf = new Map((bd?.inputs?.parts?.value || []).map((p) => [p.id, p]));
    const failures = [];
    const critical = [];
    for (const cat of CRITICAL_VEHICLE_COMPONENTS) {
      if (cat.id === "exhaust" && fuelType === "electric") { critical.push({ category: cat.id, label: cat.label, status: "not_applicable", reason: "electric: no exhaust" }); continue; }
      const tagged = nodes.filter((n) => criticalOf(ctx, n).includes(cat.id));
      if (!tagged.length) { critical.push({ category: cat.id, label: cat.label, status: "missing", reason: "not in the design yet (placeholder)", parts: [] }); continue; }
      const parts = [];
      for (const n of tagged) {
        const leaves = n.kind === "Assembly" ? physicalLeaves(ctx, n.id) : [n];
        if (!leaves.length) parts.push({ id: n.id, state: "placeholder", note: "empty assembly" });
        for (const l of leaves) {
          const p = stateOf.get(l.id);
          const app = ctx.get(l.id, "props.applicability");
          parts.push({ id: l.id, state: p?.state || "placeholder", massKg: p?.massKg ?? null, componentId: p?.componentId || null, ...(app ? { applicability: { ok: app.ok, mismatches: app.mismatches, unchecked: (app.unchecked || []).map((u) => u.field) } } : {}) });
        }
      }
      // Axle-specific parts (a front brake kit) must cover both axles.
      if (AXLE_CATEGORIES.has(cat.id)) {
        const axles = tagged.map((n) => ctx.get(n.id, "props.axle")).filter(Boolean);
        if (axles.length && !axles.includes("both")) {
          for (const axle of ["front", "rear"]) if (!axles.includes(axle)) parts.push({ id: `${axle} axle`, state: "placeholder", note: `no ${cat.label} on the ${axle} axle` });
        }
      }
      const placeholders = parts.filter((p) => p.state === "placeholder").map((p) => p.id);
      const mismatched = parts.filter((p) => p.applicability && p.applicability.ok === false);
      const status = placeholders.length ? "placeholder" : mismatched.length ? "applicability_mismatch" : "real";
      critical.push({ category: cat.id, label: cat.label, status, parts, ...(placeholders.length ? { placeholders } : {}) });
      for (const p of mismatched) failures.push(`${cat.label}: ${p.id} (${p.componentId}) does not fit the configuration: ${p.applicability.mismatches.map((m) => `${m.field} needs ${JSON.stringify(m.required)}, is ${JSON.stringify(m.actual)}`).join("; ")}`);
    }
    const notReal = critical.filter((c) => c.status === "placeholder" || c.status === "missing");
    if (notReal.length) {
      failures.unshift(`not physically credible: critical component(s) still placeholder or missing: ${notReal.map((c) => `${c.label}${c.status === "missing" ? " (missing)" : ` (${c.placeholders.join(", ")})`}`).join("; ")}`);
    }

    const tyre = ctx.result("tire.speed-rating", id);
    if (!tyre) failures.push("tyre speed rating not checked: no tyre with a speed rating");
    else if (tyre.status === "FAIL") {
      for (const f of tyre.failures || []) failures.push(`tyre speed rating (hard): ${f}`);
      for (const m of tyre.margins.filter((x) => !x.hard && !(x.utilization <= 1))) failures.push(`tyre speed rating: ${m.check} fails (${(m.capacity * 3.6).toFixed(0)} km/h established vs ${(m.demand * 3.6).toFixed(0)} km/h ${m.basis || "model output"})`);
    } else if (tyre.status === "NOT_COMPUTED") failures.push(`tyre speed rating not computed: ${tyre.reason}`);
    const load = ctx.result("tire.load-index", id);
    if (load?.status === "FAIL") for (const m of load.margins.filter((x) => !(x.utilization <= 1))) failures.push(`tyre load index: ${m.check} fails`);

    for (const r of ctx.graph.requirements.filter((x) => x.of.target === id)) {
      const e = ctx.result("requirement.check", r.id);
      if (e?.status === "FAIL") failures.push(`requirement ${r.id} (${r.label}) fails`);
    }

    const ts = ctx.result("vehicle.top-speed", id);
    const gear = ctx.result("vehicle.gearing", id);
    const evidence = {
      drag_model: `Cd ${ts?.inputs?.dragCoefficient?.value ?? "?"} (${ts?.inputs?.dragCoefficient?.source ?? "not given"}); frontal area ${ts?.inputs?.frontalArea?.source ?? "not given"}`,
      drivetrain_losses: `driveline efficiency ${ts?.inputs?.drivelineEfficiency?.value ?? "?"} (${ts?.inputs?.drivelineEfficiency?.source ?? "not given"})`,
      gearing: !gear ? "no gearing in the design (vehicle.gearing did not run)" : gear.status === "NOT_COMPUTED" ? `not computed: ${gear.reason}` : gearEvidence(gear),
      tyre_limits: `speed rating ${tyre?.status ?? "not run"}${tyre?.outputs?.demandBasis ? ` (against the ${tyre.outputs.demandBasis.value})` : ""}; load index ${load?.status ?? "not run"}`,
      stability: "no solver yet",
      thermal: "no solver yet",
      speed_limiter: "design choice: no limiter calibration, road-speed signal accuracy or overshoot test in the design",
    };
    const lim = ts?.outputs?.speedLimiter?.value || null;
    const unlimitedV = ts?.outputs?.unlimitedTopSpeed?.value;
    const deps = lim ? [...TOP_SPEED_UNVERIFIED_DEPENDENCIES, SPEED_LIMITER_DEPENDENCY] : TOP_SPEED_UNVERIFIED_DEPENDENCIES;
    // The top speed: the lower of drag-limited and gear-limited when the
    // gearing is known, else the drag-limited model output alone.
    const dragV = ts?.outputs?.dragLimitedTopSpeed?.value ?? ts?.outputs?.topSpeed?.value;
    const effV = gear?.outputs?.effectiveTopSpeed?.value;
    const v = ts?.outputs?.topSpeed?.value ?? null;
    const gl = gear?.outputs?.gearLimitedTopSpeedRange?.value;
    const performanceClaims = [{
      claim: "topSpeed",
      value: v ?? null,
      unit: "m/s",
      mph: Number.isFinite(v) ? v / 0.44704 : null,
      status: Number.isFinite(v) ? TOP_SPEED_CLAIM_STATUS : "not_computed",
      basis: lim?.binding
        ? `speed limiter set point (design choice, ${lim.setKmh} km/h); without it, ${Number.isFinite(effV) ? "the lower of the drag-limited and gear-limited top speeds" : "drag-limited"}`
        : Number.isFinite(effV) ? "lower of the drag-limited and gear-limited top speeds" : "drag-limited only (gearing not computed)",
      unlimitedMph: Number.isFinite(unlimitedV) ? unlimitedV / 0.44704 : null,
      unlimitedStatus: Number.isFinite(unlimitedV) ? TOP_SPEED_CLAIM_STATUS : "not_computed",
      speedLimiter: lim ? { setKmh: lim.setKmh, setMph: lim.setKmh / 1.609344, overshootAllowanceKmh: lim.overshootAllowanceKmh, binding: lim.binding, status: "design_choice_unverified", basis: lim.basis, sources: lim.sources } : null,
      dragLimitedMph: Number.isFinite(dragV) ? dragV / 0.44704 : null,
      gearLimitedMph: Number.isFinite(gear?.outputs?.gearLimitedTopSpeed?.value) ? gear.outputs.gearLimitedTopSpeed.value / 0.44704 : null,
      ...(gl ? { gearLimitedMphRange: { low: gl.low / 0.44704, high: gl.high / 0.44704, rpm: gl.rpm } } : {}),
      gearLimitStatus: gear?.outputs?.gearLimitStatus?.value ?? "not_computed",
      revLimit: gear?.outputs?.revLimitRpm ? { rpm: gear.outputs.revLimitRpm.value, source: gear.outputs.revLimitRpm.source } : null,
      limitedBy: ts?.outputs?.limitedBy?.value ?? null,
      source: ts?.runId ?? null,
      unverifiedDependencies: deps.map((d) => ({ ...d, evidence: evidence[d.id] })),
    }];

    // What a passing requirement does and doesn't show.
    const missingCats = critical.filter((c) => c.status === "missing").map((c) => c.label);
    const excluded = nodes.flatMap((n) => (ctx.get(n.id, "props.massExcludes") || []).map((x) => `${n.id}: ${x}`));
    const caveats = [];
    if (missingCats.length) caveats.push(`The kerb mass is a lower bound: ${missingCats.join(", ")} ${missingCats.length === 1 ? "is" : "are"} not in the design and carry no mass.`);
    if (excluded.length) caveats.push(`The kerb mass is a lower bound: ${excluded.length} item(s) the parts' published masses exclude are not in it (see massBreakdown.excluded).`);
    if (Number.isFinite(v)) {
      const dragSrc = ts.inputs?.dragCoefficient?.source || "";
      caveats.push(`The top speed is a model output (${TOP_SPEED_CLAIM_STATUS}), not a measurement: Cd ${ts.inputs?.dragCoefficient?.value} is ${/not computed|target|given/i.test(dragSrc) ? `unvalidated (${dragSrc})` : dragSrc}, frontal area ${ts.inputs?.frontalArea?.source}, driveline efficiency ${ts.inputs?.drivelineEfficiency?.value} given.`);
    }
    if (lim?.binding) {
      caveats.push(`The vehicle top speed (${(v * 3.6).toFixed(1)} km/h, ${(v / 0.44704).toFixed(1)} mph) is the set point of an electronic speed limiter that is a design choice, not built or calibrated${Number.isFinite(lim.overshootAllowanceKmh) ? `; the tyre check relies on its overshoot staying within the ${lim.overshootAllowanceKmh} km/h design allowance` : ""}. Without it the model gives ${(unlimitedV * 3.6).toFixed(1)} km/h (${(unlimitedV / 0.44704).toFixed(1)} mph, ${TOP_SPEED_CLAIM_STATUS}).`);
    }
    const redlineBasis = gear?.inputs?.redlineRpm?.basis;
    if (redlineBasis && /estimat/i.test(redlineBasis)) caveats.push(`The gear limit rests on an estimated redline (${gear.inputs.redlineRpm.value} rpm): ${redlineBasis}`);
    for (const r of ctx.graph.requirements.filter((x) => x.of.target === id)) {
      const e = ctx.result("requirement.check", r.id);
      if (e?.status !== "PASS") continue;
      if (r.of.solver === "mass.assembly" && (missingCats.length || excluded.length)) caveats.push(`${r.id} passes on a lower-bound mass.`);
      if (r.of.solver === "vehicle.top-speed") caveats.push(`${r.id} passes on a model output (${TOP_SPEED_CLAIM_STATUS}), not a validated top speed${lim?.binding ? `: the limited speed (the ${lim.setKmh} km/h set point) is reachable only if the unlimited model output holds` : ""}.`);
    }
    const breakdown = bd?.status === "NOT_COMPUTED" || !bd ? null : {
      totalMassKg: bd.outputs.totalMass.value,
      pct: { sourced: bd.outputs.sourcedPct.value, estimated: bd.outputs.estimatedPct.value, computed: bd.outputs.computedPct.value, placeholder: bd.outputs.placeholderPct.value },
      kg: Object.fromEntries(Object.entries(bd.outputs.byState.value).map(([k, v]) => [k, v.kg])),
      uncertaintyKg: [bd.outputs.uncertaintyLow.value, bd.outputs.uncertaintyHigh.value],
      unmassed: bd.outputs.unmassed.value,
      excluded,
      lowerBound: missingCats.length > 0 || bd.outputs.unmassed.value.length > 0 || excluded.length > 0,
    };
    const verdict = failures.length ? ACCEPTANCE_VERDICT.NOT_CREDIBLE : caveats.length ? ACCEPTANCE_VERDICT.CREDIBLE_WITH_CAVEATS : ACCEPTANCE_VERDICT.SCREENING_PASS;
    return {
      inputs: { fuelType: { value: fuelType ?? null, source: "props.vehicle.fuelType" }, massBreakdown: { value: bd?.runId ?? null } },
      outputs: {
        verdict: { value: verdict },
        criticalComponents: { value: critical },
        placeholders: { value: notReal.map((c) => c.category) },
        massBreakdown: { value: breakdown },
        performanceClaims: { value: performanceClaims },
        caveats: { value: caveats },
      },
      failures,
      // A pass that rests on unverified things is a WARN, its caveats the warnings.
      warnings: verdict === ACCEPTANCE_VERDICT.CREDIBLE_WITH_CAVEATS ? caveats.map((c) => `caveat: ${c}`) : [],
      assumptions: ["Screening-level acceptance, not a certification. A pass would still leave the top speed a model output until its dependencies are verified."],
    };
  },
});
