// server/lib/conkay/physics/solvers/general.js
//
// General-purpose solvers for "build anything" (owner, 2026-11-26): ConKay's
// pipe-network and conduction cores exposed on any node, plus a DC electrical
// budget and a solution/mixture calculator. Each reads one props object; any
// quantity may be an SI number or a unit string ("3/4 in", "12 V", "2 fl oz",
// "120 °F"), converted by lib/conkay/units/universal.js.
//
// No constant is built in. Wire resistivity, a liquid's density, a solute's
// molar mass and the like come from the props with their source (a textbook
// section, a datasheet, the person), or the check is NOT_COMPUTED and says
// which value it needs. PASS/FAIL comes only from limits the node states.
//
//   props.pipeNetwork = { fluid: { density, viscosity, source }, nodes: [{ id, head? (m, fixed), demand? }],
//     links: [{ id, from, to, type: "pipe", diameter, length, roughness?, K?: [{ name, K }] }
//           | { id, from, to, type: "pump", points: [{ flow, pressureRise }] }
//           | { id, from, to, type: "component", K, refDiameter } ],
//     maxVelocity?: { value, source }, minFlow?: [{ link, value, source }] }
//   props.conduction = { length, conductivity: { value, source }, area?, left: BC, right: BC,
//     generation?, maxTemperature?: { value, source } }
//     BC: { type: "T", T } | { type: "q", q } | { type: "conv", h, Tinf } | { type: "adiabatic" }
//   props.dcBudget = { supply: { voltage, maxCurrent?, capacity? (Ah or Wh), source? },
//     loads: [{ name, power? | current?, duty? (0..1, default 1) }],
//     wire?: { length (one way), crossSection | awg, resistivity: { value, source } },
//     maxVoltageDrop?: { value (fraction or %), source }, minRuntime?: { value (time), source } }
//   props.solution = { components: [{ name, mass? | volume? | amount? (mol), density?: { value, source },
//     molarMass?: { value, source } }], solvent?, targets?: [{ component, metric: "mass_fraction" |
//     "molarity" | "mass_concentration", min?, max?, source }] }

import { registerSolver } from "../registry.js";
import { parseAmount } from "../../units/universal.js";
import { solveNetwork, pumpCurve } from "../../fluids/pipe-flow.js";
import { solve1D } from "../../thermal/conduction.js";

/** A value (number in SI, unit string, or { value, source }) → { si, source } or { error }. */
function q(v, dim, what) {
  if (v == null) return { missing: what };
  const raw = typeof v === "object" && !Array.isArray(v) && "value" in v ? v.value : v;
  const source = typeof v === "object" && v?.source ? String(v.source) : null;
  const r = parseAmount(raw, { expectDim: dim });
  if (!r.ok) return { error: `${what}: ${r.error}` };
  return { si: r.si, source };
}
const take = (out, key, v, dim, what) => {
  const r = q(v, dim, what);
  if (r.missing) out.missing.push(r.missing);
  else if (r.error) out.errors.push(r.error);
  else { out[key] = r.si; if (r.source) out.sources[key] = r.source; }
  return r;
};
const fresh = () => ({ missing: [], errors: [], sources: {} });
const notComputedFrom = (o) => (o.errors.length ? o.errors.join("; ") : o.missing.length ? `needs ${o.missing.join(", ")}` : null);

// ── fluid.pipe-network ───────────────────────────────────────────────────────
export const pipeNetwork = registerSolver({
  id: "fluid.pipe-network",
  version: "1.0.0",
  domain: "fluid.flow",
  domains: ["fluid.flow", "fluid.pressure-drop"],
  fidelity: 1,
  method: "Incompressible pipe network: Darcy-Weisbach with Colebrook / laminar friction and minor losses, pumps by their datasheet curves, Newton-Raphson global gradient (fluids/pipe-flow.js, Todini & Pilati 1988)",
  reference: "server/lib/conkay/fluids/pipe-flow.js; benchmarks in tests/conkay-pipe-flow.test.js",
  regime: "incompressible, single phase, fully developed, isothermal; pump curves interpolated only; cavitation not checked",
  units: { inputs: "m, m^3/s, Pa, kg/m^3, Pa·s", outputs: "m^3/s, m/s, m, Pa" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.pipeNetwork && typeof n.props.pipeNetwork === "object").map((n) => n.id),
  run(ctx, id) {
    const spec = ctx.get(id, "props.pipeNetwork");
    const o = fresh();
    take(o, "rho", spec.fluid?.density, "density", "fluid.density");
    take(o, "mu", spec.fluid?.viscosity, "dynamic_viscosity", "fluid.viscosity");
    const nodes = []; const links = [];
    for (const n of spec.nodes || []) {
      const node = { id: String(n.id) };
      if (n.head != null) { const r = q(n.head, "length", `node ${n.id} head`); if (r.error) o.errors.push(r.error); else node.head = r.si; }
      if (n.demand != null) { const r = q(n.demand, "volume_flow", `node ${n.id} demand`); if (r.error) o.errors.push(r.error); else node.demand = r.si; }
      nodes.push(node);
    }
    for (const l of spec.links || []) {
      const base = { id: String(l.id), from: String(l.from), to: String(l.to), type: l.type };
      if (l.type === "pipe") {
        const D = q(l.diameter, "length", `${l.id} diameter`); const L = q(l.length, "length", `${l.id} length`);
        const e = l.roughness != null ? q(l.roughness, "length", `${l.id} roughness`) : { si: 0 };
        for (const r of [D, L, e]) { if (r.missing) o.missing.push(r.missing); if (r.error) o.errors.push(r.error); }
        links.push({ ...base, D: D.si, L: L.si, eps: e.si ?? 0, K: (l.K || []).map((k) => ({ name: k.name, K: Number(k.K) })) });
      } else if (l.type === "pump") {
        const pts = (l.points || []).map((p) => ({ Q: q(p.flow, "volume_flow", `${l.id} flow`).si, dp: q(p.pressureRise, "pressure", `${l.id} pressure rise`).si }));
        if (pts.length < 2 || pts.some((p) => !Number.isFinite(p.Q) || !Number.isFinite(p.dp))) { o.missing.push(`${l.id}: at least two pump-curve points (flow, pressureRise) from its datasheet`); continue; }
        links.push({ ...base, curve: pumpCurve(pts), range: [Math.min(...pts.map((p) => p.Q)), Math.max(...pts.map((p) => p.Q))] });
      } else if (l.type === "component") {
        const Dref = l.refDiameter != null ? q(l.refDiameter, "length", `${l.id} refDiameter`).si : undefined;
        links.push({ ...base, K: Number.isFinite(Number(l.K)) ? Number(l.K) : undefined, Dref, c: Number.isFinite(Number(l.c)) ? Number(l.c) : undefined });
      } else o.errors.push(`${l.id}: type is pipe, pump or component`);
    }
    const nc = notComputedFrom(o);
    if (nc) return { notComputed: nc };
    const r = solveNetwork({ fluid: { rho: o.rho, mu: o.mu }, nodes, links });
    if (!r.ok) return { notComputed: r.error };
    const detail = (r.links || []);
    const margins = []; const warnings = [...(r.flags || [])].map(String);
    const vmax = spec.maxVelocity ? q(spec.maxVelocity, "velocity", "maxVelocity") : null;
    for (const d of detail) {
      if (vmax?.si > 0 && Number.isFinite(d.v)) margins.push({ check: `${d.id}: velocity ≤ ${vmax.si.toFixed(3)} m/s`, demand: d.v, capacity: vmax.si, unit: "m/s", basis: vmax.source || "stated" });
    }
    for (const mf of spec.minFlow || []) {
      const need = q(mf, "volume_flow", `minFlow ${mf.link}`);
      const got = Math.abs(r.Q?.[mf.link] ?? NaN);
      if (Number.isFinite(need.si) && Number.isFinite(got)) margins.push({ check: `${mf.link}: flow ≥ required`, demand: need.si, capacity: got, unit: "m^3/s", basis: need.source || "stated" });
    }
    for (const l of links.filter((x) => x.type === "pump")) {
      const Q = Math.abs(r.Q[l.id]);
      if (Q < l.range[0] || Q > l.range[1]) warnings.push(`${l.id}: operating flow ${Q.toExponential(3)} m^3/s is outside its datasheet points: the pump's rise there is extrapolated`);
    }
    if (!margins.length) warnings.push("no velocity or flow limit was stated, so the flows are computed but not checked");
    return {
      inputs: { fluid: { value: { density: o.rho, viscosity: o.mu }, source: spec.fluid?.source || o.sources.rho || null } },
      outputs: { flows: { value: r.Q, unit: "m^3/s" }, heads: { value: r.H, unit: "m" }, links: { value: detail.map((d) => ({ id: d.id, velocity: d.v, Re: d.Re, regime: d.regime })) } },
      margins, warnings,
      assumptions: ["incompressible, isothermal, fully developed flow; minor losses as K on the pipe velocity"],
    };
  },
});

// ── thermal.conduction-1d ────────────────────────────────────────────────────
function bc(raw, where, o) {
  if (!raw || typeof raw !== "object") { o.missing.push(`${where} boundary ({ type: T | q | conv | adiabatic })`); return null; }
  if (raw.type === "adiabatic") return { type: "adiabatic" };
  if (raw.type === "T") { const t = q(raw.T, "temperature", `${where}.T`); if (t.error || t.missing) { o.errors.push(t.error || `${where}.T missing`); return null; } return { type: "T", T: t.si }; }
  if (raw.type === "q") { const f = q(raw.q, "heat_flux", `${where}.q`); if (f.error || f.missing) { o.errors.push(f.error || `${where}.q missing`); return null; } return { type: "q", q: f.si }; }
  if (raw.type === "conv") {
    const h = q(raw.h, "heat_transfer_coefficient", `${where}.h`); const t = q(raw.Tinf, "temperature", `${where}.Tinf`);
    if (h.error || h.missing || t.error || t.missing) { o.errors.push(h.error || t.error || `${where}: h and Tinf`); return null; }
    return { type: "conv", h: h.si, Tinf: t.si };
  }
  o.errors.push(`${where}: type is T, q, conv or adiabatic`);
  return null;
}
export const conduction1d = registerSolver({
  id: "thermal.conduction-1d",
  version: "1.0.0",
  domain: "thermal.conduction",
  domains: ["thermal.conduction", "thermal.temperature"],
  fidelity: 2,
  method: "Steady 1-D conduction, finite volume (thermal/conduction.js solve1D), fixed-temperature, flux, convective or adiabatic ends, optional uniform generation",
  reference: "server/lib/conkay/thermal/conduction.js",
  regime: "one-dimensional, constant conductivity, steady state",
  units: { inputs: "m, W/(m·K), K, W/m^2", outputs: "K, W" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.conduction && typeof n.props.conduction === "object").map((n) => n.id),
  run(ctx, id) {
    const c = ctx.get(id, "props.conduction");
    const o = fresh();
    take(o, "L", c.length, "length", "length");
    let k = c.conductivity != null ? q(c.conductivity, "thermal_conductivity", "conductivity") : null;
    if (!k) {
      const mat = ctx.material(id);
      if (mat?.conductivityWmK > 0) k = { si: mat.conductivityWmK, source: mat.sources?.conductivityWmK || mat.source };
      else o.missing.push("conductivity (with its source)");
    }
    if (k?.error) o.errors.push(k.error);
    const area = c.area != null ? q(c.area, "area", "area") : { si: 1 };
    const gen = c.generation != null ? q(c.generation, "power_per_volume", "generation") : null;
    const left = bc(c.left, "left", o); const right = bc(c.right, "right", o);
    const nc = notComputedFrom(o);
    if (nc) return { notComputed: nc };
    const res = solve1D({ L: o.L, n: 100, k: k.si, area: area.si, left, right, steady: true, ...(gen?.si ? { generation: gen.si } : {}) });
    const T = Array.from(res.T);
    const Tmax = Math.max(...T), Tmin = Math.min(...T);
    const margins = [];
    const lim = c.maxTemperature ? q(c.maxTemperature, "temperature", "maxTemperature") : null;
    if (lim?.si > 0) margins.push({ check: "peak temperature ≤ limit", demand: Tmax, capacity: lim.si, unit: "K", basis: lim.source || "stated" });
    return {
      inputs: { conductivity: { value: k.si, unit: "W/(m·K)", source: k.source || null }, length: { value: o.L, unit: "m" } },
      outputs: { maxTemperature: { value: Tmax, unit: "K" }, minTemperature: { value: Tmin, unit: "K" }, heatIn: { value: res.heatIn, unit: "W" } },
      margins, warnings: margins.length ? [] : ["no temperature limit was stated, so the temperatures are computed but not checked"],
      assumptions: ["steady 1-D conduction with constant conductivity"],
    };
  },
});

// ── electrical.dc-budget ─────────────────────────────────────────────────────
/** AWG gauge → cross-section (m²): d = 0.127 mm · 92^((36 − n)/39) (ASTM B258 definition). */
export const awgArea = (n) => { const d = 0.127e-3 * 92 ** ((36 - n) / 39); return (Math.PI * d * d) / 4; };
export const dcBudget = registerSolver({
  id: "electrical.dc-budget",
  version: "1.0.0",
  domain: "electrical.power",
  domains: ["electrical.power", "electrical.runtime", "electrical.voltage-drop"],
  fidelity: 1,
  method: "DC budget: load currents from power / voltage (or stated current) × duty; round-trip wire resistance ρ·2L/A and its voltage drop; runtime = capacity / average draw",
  reference: "server/lib/conkay/physics/solvers/general.js",
  regime: "DC, steady loads, resistive wire at the stated resistivity (no temperature rise), battery capacity at its rated discharge",
  units: { inputs: "V, A, W, m, m^2, Ω·m, A·h", outputs: "A, W, V, s" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.dcBudget && typeof n.props.dcBudget === "object").map((n) => n.id),
  run(ctx, id) {
    const b = ctx.get(id, "props.dcBudget");
    const o = fresh();
    take(o, "V", b.supply?.voltage, "voltage", "supply.voltage");
    const loads = [];
    for (const [i, l] of (b.loads || []).entries()) {
      const name = String(l.name || `load ${i + 1}`);
      const duty = l.duty == null ? 1 : Number(parseAmount(l.duty).si);
      if (!(duty >= 0 && duty <= 1)) { o.errors.push(`${name}: duty is a fraction 0..1`); continue; }
      if (l.current != null) { const c = q(l.current, "current", `${name} current`); if (c.error) o.errors.push(c.error); else loads.push({ name, I: c.si, duty }); }
      else if (l.power != null) { const p = q(l.power, "power", `${name} power`); if (p.error) o.errors.push(p.error); else loads.push({ name, P: p.si, duty }); }
      else o.missing.push(`${name}: its power or current (from its label or datasheet)`);
    }
    if (!(b.loads || []).length) o.missing.push("at least one load");
    const nc = notComputedFrom(o);
    if (nc) return { notComputed: nc };
    const withI = loads.map((l) => ({ ...l, I: l.I ?? l.P / o.V }));
    const peakI = withI.reduce((s, l) => s + l.I, 0);
    const avgI = withI.reduce((s, l) => s + l.I * l.duty, 0);
    const margins = []; const warnings = []; const outputs = { peakCurrent: { value: peakI, unit: "A" }, averageCurrent: { value: avgI, unit: "A" }, averagePower: { value: avgI * o.V, unit: "W" } };
    const notChecked = [];
    if (b.supply?.maxCurrent != null) {
      const m = q(b.supply.maxCurrent, "current", "supply.maxCurrent");
      if (m.si > 0) margins.push({ check: "peak current ≤ supply rating", demand: peakI, capacity: m.si, unit: "A", basis: m.source || b.supply.source || "stated" });
    } else notChecked.push("the supply's current rating (give supply.maxCurrent from its label)");
    if (b.wire) {
      const L = q(b.wire.length, "length", "wire.length");
      const A = b.wire.crossSection != null ? q(b.wire.crossSection, "area", "wire.crossSection") : Number.isFinite(Number(b.wire.awg)) ? { si: awgArea(Number(b.wire.awg)), source: "ASTM B258 gauge definition" } : null;
      const rho = b.wire.resistivity != null ? q(b.wire.resistivity, "resistivity", "wire.resistivity") : null;
      if (!(L?.si > 0) || !(A?.si > 0)) notChecked.push("voltage drop (needs wire length and cross-section or AWG)");
      else if (!(rho?.si > 0)) notChecked.push("voltage drop (needs the wire's resistivity with its source, e.g. a textbook table)");
      else {
        const R = (rho.si * 2 * L.si) / A.si;
        const drop = peakI * R;
        outputs.wireResistance = { value: R, unit: "Ω" };
        outputs.voltageDrop = { value: drop, unit: "V" };
        if (b.maxVoltageDrop != null) {
          const lim = parseAmount(typeof b.maxVoltageDrop === "object" ? b.maxVoltageDrop.value : b.maxVoltageDrop);
          const frac = lim.ok && lim.dim === "ratio" ? lim.si : lim.ok && lim.dim === "voltage" ? lim.si / o.V : NaN;
          if (frac > 0) margins.push({ check: "wire voltage drop ≤ limit", demand: drop / o.V, capacity: frac, unit: "fraction of supply", basis: b.maxVoltageDrop?.source || "stated" });
        } else notChecked.push("voltage drop against a limit (give maxVoltageDrop, e.g. 3 %)");
      }
    }
    if (b.supply?.capacity != null) {
      const cap = parseAmount(typeof b.supply.capacity === "object" ? b.supply.capacity.value : b.supply.capacity);
      const ah = cap.ok && cap.dim === "charge" ? cap.si / 3600 : cap.ok && cap.dim === "energy" ? cap.si / 3600 / o.V : NaN;
      if (Number.isFinite(ah) && avgI > 0) {
        const runtime = (ah / avgI) * 3600;
        outputs.runtime = { value: runtime, unit: "s" };
        if (b.minRuntime != null) {
          const need = q(b.minRuntime, "time", "minRuntime");
          if (need.si > 0) margins.push({ check: "runtime ≥ required", demand: need.si, capacity: runtime, unit: "s", basis: need.source || "stated" });
        }
      } else if (!cap.ok) warnings.push(`supply.capacity: ${cap.error}`);
    }
    if (notChecked.length) warnings.push(`not checked: ${notChecked.join("; ")}`);
    return { inputs: { voltage: { value: o.V, unit: "V" } }, outputs, margins, warnings, assumptions: ["DC; loads steady at the stated power or current; wire resistance at the stated resistivity (no heating)"] };
  },
});

// ── chem.solution ────────────────────────────────────────────────────────────
export const solution = registerSolver({
  id: "chem.solution",
  version: "1.0.0",
  domain: "chemistry.mixture",
  domains: ["chemistry.mixture", "chemistry.concentration"],
  fidelity: 1,
  method: "Mixture accounting: each component's mass (stated, or volume × its density, or moles × its molar mass), mass fractions, ideal-mixing total volume (volumes additive), molarity = moles / total volume, mass concentration = mass / total volume",
  reference: "server/lib/conkay/physics/solvers/general.js",
  regime: "ideal mixing (volumes additive; real mixtures can shrink or swell a few %), no reaction",
  units: { inputs: "kg, m^3, mol, kg/m^3, kg/mol", outputs: "1, mol/m^3, kg/m^3, m^3" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.props?.solution && typeof n.props.solution === "object").map((n) => n.id),
  run(ctx, id) {
    const s = ctx.get(id, "props.solution");
    const comps = []; const missing = []; const errors = [];
    for (const [i, c] of (s.components || []).entries()) {
      const name = String(c.name || `component ${i + 1}`);
      const rho = c.density != null ? q(c.density, "density", `${name} density`) : null;
      const M = c.molarMass != null ? q(c.molarMass, "molar_mass", `${name} molar mass`) : null;
      for (const r of [rho, M]) if (r?.error) errors.push(r.error);
      let mass = null, volume = null, mol = null;
      if (c.mass != null) { const r = q(c.mass, "mass", `${name} mass`); if (r.error) errors.push(r.error); else mass = r.si; }
      if (c.volume != null) { const r = q(c.volume, "volume", `${name} volume`); if (r.error) errors.push(r.error); else volume = r.si; }
      if (c.amount != null) { const r = q(c.amount, "amount", `${name} amount`); if (r.error) errors.push(r.error); else mol = r.si; }
      if (mass == null && volume != null && rho?.si > 0) mass = volume * rho.si;
      if (mass == null && mol != null && M?.si > 0) mass = mol * M.si;
      if (volume == null && mass != null && rho?.si > 0) volume = mass / rho.si;
      if (mol == null && mass != null && M?.si > 0) mol = mass / M.si;
      if (mass == null) missing.push(`${name}: its mass, or its volume and density, or its moles and molar mass`);
      comps.push({ name, mass, volume, mol, densitySource: rho?.source || null, molarMassSource: M?.source || null });
    }
    if (errors.length) return { notComputed: errors.join("; ") };
    if (missing.length) return { notComputed: `needs ${missing.join("; ")}` };
    const total = comps.reduce((a, c) => a + c.mass, 0);
    const volKnown = comps.every((c) => c.volume != null);
    const totalV = volKnown ? comps.reduce((a, c) => a + c.volume, 0) : null;
    const rows = comps.map((c) => ({
      name: c.name, mass: c.mass, massFraction: c.mass / total,
      ...(totalV ? { massConcentration: c.mass / totalV } : {}),
      ...(totalV && c.mol != null ? { molarity: c.mol / totalV } : {}),
    }));
    const margins = []; const warnings = [];
    if (!volKnown) warnings.push(`total volume not computed: needs the density of ${comps.filter((c) => c.volume == null).map((c) => c.name).join(", ")}`);
    for (const t of s.targets || []) {
      const row = rows.find((r) => r.name === t.component);
      const key = t.metric === "molarity" ? "molarity" : t.metric === "mass_concentration" ? "massConcentration" : "massFraction";
      const dim = key === "molarity" ? "molar_concentration" : key === "massConcentration" ? "mass_concentration" : "ratio";
      if (!row || row[key] == null) { warnings.push(`target on ${t.component} ${t.metric}: not computed (missing data)`); continue; }
      if (t.max != null) { const m = q(t.max, dim, "max"); if (m.si > 0) margins.push({ check: `${t.component} ${t.metric} ≤ max`, demand: row[key], capacity: m.si, unit: dim, basis: t.source || "stated" }); }
      if (t.min != null) { const m = q(t.min, dim, "min"); if (m.si > 0) margins.push({ check: `${t.component} ${t.metric} ≥ min`, demand: m.si, capacity: row[key], unit: dim, basis: t.source || "stated" }); }
    }
    return {
      inputs: { components: { value: comps.map((c) => ({ name: c.name, densitySource: c.densitySource, molarMassSource: c.molarMassSource })) } },
      outputs: { totalMass: { value: total, unit: "kg" }, ...(totalV ? { totalVolume: { value: totalV, unit: "m^3" } } : {}), components: { value: rows } },
      margins, warnings,
      assumptions: ["ideal mixing: volumes add (real mixtures can differ by a few %)", "no reaction between the components"],
    };
  },
});

// ── geometry.capacity ────────────────────────────────────────────────────────
// What a revolved vessel (a cup, a bowl, a bottle) holds up to its rim, from
// its own profile (Pappus, exact), checked against props.capacity { min?, max?, source }.
export const capacity = registerSolver({
  id: "geometry.capacity",
  version: "1.0.0",
  domain: "geometry.capacity",
  domains: ["geometry.capacity"],
  fidelity: 2,
  method: "Volume enclosed by the inner surface of a revolved outline up to its rim (Pappus's theorem: 2π × area × centroid radius), exact for the profile",
  reference: "server/lib/conkay/geometry/shapes.js (revolve)",
  regime: "brim-full to the rim; no meniscus, no lid, no fill line",
  units: { inputs: "m", outputs: "m^3" },
  targets: (g) => [...g.nodes.values()].filter((n) => n.geometry?.shape === "revolve" && n.geometry.derived?.capacity > 0).map((n) => n.id),
  run(ctx, id) {
    const g = ctx.get(id, "geometry");
    const V = g.derived.capacity;
    const want = ctx.get(id, "props.capacity");
    const margins = []; const warnings = [];
    if (want && typeof want === "object") {
      const lo = want.min != null ? q(want.min, "volume", "capacity.min") : null;
      const hi = want.max != null ? q(want.max, "volume", "capacity.max") : null;
      if (lo?.si > 0) margins.push({ check: "holds at least the required volume (to the rim)", demand: lo.si, capacity: V, unit: "m^3", basis: want.source || "stated" });
      if (hi?.si > 0) margins.push({ check: "holds no more than the limit (to the rim)", demand: V, capacity: hi.si, unit: "m^3", basis: want.source || "stated" });
      for (const r of [lo, hi]) if (r?.error) warnings.push(r.error);
    } else warnings.push("no capacity was asked for, so it is computed but not checked");
    return { inputs: { wall: { value: g.wall, unit: "m" } }, outputs: { capacity: { value: V, unit: "m^3" } }, margins, warnings, assumptions: ["filled to the rim"] };
  },
});
