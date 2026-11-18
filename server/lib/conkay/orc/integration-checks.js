// server/lib/conkay/orc/integration-checks.js
//
// SX-ORC-06 — orc.integration-checks: cross-subsystem integration
// checks (catalogue wave 0, PRG-17). Engine: JS — the checks are
// closures and compatibilities over DECLARED subsystem values; no
// engine tier exists on this ticket. The solver computes nothing
// about the subsystems themselves: it verifies that what the
// subsystem solvers and the architecture declare is mutually
// consistent, and it says so check by check.
//
// The checks (the ticket's own list):
//
//   - power closure: supplied = consumed + losses, residual
//     reported in watts;
//   - heat closure, per loop: generated = rejected at steady
//     state, residual per loop;
//   - mass within target: actual <= target;
//   - CG within target: per-axis |actual - target| <= tolerance;
//   - interface compatibility over a declared vocabulary —
//     voltage (both sides equal), connector (type strings equal),
//     flow (source capacity >= sink demand), thread (designation
//     strings equal). A FAIL names BOTH sides and their values:
//     the reference case is a deliberately broken interface, and a
//     check that cannot say which two things disagree is useless;
//   - clearances: gap >= required, margin reported;
//   - load paths: segment chains continuous — every segment's end
//     is the next segment's start; a break names its index and the
//     two nodes that fail to meet.
//
// Honesty rules: a section the input does not declare is listed
// NOT_RUN with its reason — never silently passed, and the overall
// verdict is computed only over checks that ran. If nothing ran,
// the run is NOT_COMPUTED. Closure tolerances: a declared
// toleranceW is used as given; otherwise the check falls back to a
// relative 1e-9 of the largest term, and the tolerance used plus
// its source ("declared" / "default-relative-1e-9") is REPORTED in
// the check row — a fallback that is printed, not silent.
//
// The closure rows are the per-link evidence the chain receipt
// (SX-CHAIN-RECEIPT) consumes: each row names its quantities, its
// residual, and its verdict in a stable shape.

import { registerSolver } from "../physics/registry.js";

const NS = "orc.integrationChecks";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) < 1e300 ? n : null;
}

function closureCheck(name, lhs, rhs, toleranceW, fields) {
  const scale = Math.max(Math.abs(lhs), Math.abs(rhs), 1e-300);
  const tol = toleranceW != null ? toleranceW : 1e-9 * scale;
  const residual = lhs - rhs;
  return {
    check: name,
    status: Math.abs(residual) <= tol ? "PASS" : "FAIL",
    residual,
    tolerance: tol,
    toleranceSource: toleranceW != null ? "declared" : "default-relative-1e-9",
    ...fields,
  };
}

/** The pure solver function. Exported for direct testing. */
export function integrationChecks(props = {}) {
  const p = props && typeof props === "object" ? props : {};
  const checks = [];
  const notRun = [];
  const bad = (msg) => ({ notComputed: `INVALID_INPUT: ${msg}`, inputs: {} });

  // --- power closure -------------------------------------------------
  if (p.power != null) {
    const { suppliedW, consumedW, lossesW } = p.power;
    const s = num(suppliedW), c = num(consumedW), l = num(lossesW);
    if (s == null || c == null || l == null) return bad("power requires finite suppliedW, consumedW and lossesW");
    if (s < 0 || c < 0 || l < 0) return bad("power values must be non-negative (suppliedW, consumedW, lossesW)");
    const tol = p.power.toleranceW != null ? num(p.power.toleranceW) : null;
    if (p.power.toleranceW != null && (tol == null || tol < 0)) return bad("power.toleranceW must be a non-negative finite number");
    checks.push(closureCheck("power-closure", s, c + l, tol, { suppliedW: s, consumedW: c, lossesW: l, unit: "W" }));
  } else notRun.push({ check: "power-closure", reason: "power not declared in the input" });

  // --- heat loops ----------------------------------------------------
  if (p.heatLoops != null) {
    if (!Array.isArray(p.heatLoops)) return bad("heatLoops must be an array");
    for (let i = 0; i < p.heatLoops.length; i++) {
      const loop = p.heatLoops[i];
      const g = num(loop?.generatedW), r = num(loop?.rejectedW);
      if (g == null || r == null) return bad(`heatLoops[${i}] requires finite generatedW and rejectedW`);
      if (g < 0 || r < 0) return bad(`heatLoops[${i}] values must be non-negative`);
      const tol = loop.toleranceW != null ? num(loop.toleranceW) : null;
      if (loop.toleranceW != null && (tol == null || tol < 0)) return bad(`heatLoops[${i}].toleranceW must be a non-negative finite number`);
      checks.push(closureCheck(`heat-closure:${loop.id ?? i}`, g, r, tol, { loop: loop.id ?? i, generatedW: g, rejectedW: r, unit: "W" }));
    }
  } else notRun.push({ check: "heat-closure", reason: "heatLoops not declared in the input" });

  // --- mass within target ---------------------------------------------
  if (p.mass != null) {
    const a = num(p.mass.actualKg), t = num(p.mass.targetKg);
    if (a == null || t == null) return bad("mass requires finite actualKg and targetKg");
    if (a < 0 || t <= 0) return bad("mass.actualKg must be non-negative and mass.targetKg positive");
    checks.push({
      check: "mass-target",
      status: a <= t ? "PASS" : "FAIL",
      actualKg: a, targetKg: t, marginKg: t - a,
      detail: a <= t ? `actual ${a} kg within target ${t} kg` : `actual ${a} kg EXCEEDS target ${t} kg by ${a - t} kg`,
    });
  } else notRun.push({ check: "mass-target", reason: "mass not declared in the input" });

  // --- CG within target -----------------------------------------------
  if (p.cg != null) {
    const { actualM, targetM, toleranceM } = p.cg;
    if (!Array.isArray(actualM) || actualM.length !== 3 || !actualM.every((v) => num(v) != null)) return bad("cg.actualM must be [x, y, z] of finite numbers");
    if (!Array.isArray(targetM) || targetM.length !== 3 || !targetM.every((v) => num(v) != null)) return bad("cg.targetM must be [x, y, z] of finite numbers");
    const tol = num(toleranceM);
    if (tol == null || tol <= 0) return bad("cg.toleranceM must be a positive finite number (the CG check has no default tolerance — it is a design target)");
    const dev = actualM.map((v, i) => Math.abs(Number(v) - Number(targetM[i])));
    const worst = Math.max(...dev);
    checks.push({
      check: "cg-target",
      status: worst <= tol ? "PASS" : "FAIL",
      deviationM: dev, worstDeviationM: worst, toleranceM: tol,
      detail: worst <= tol ? `worst axis deviation ${worst} m within ${tol} m` : `worst axis deviation ${worst} m EXCEEDS tolerance ${tol} m`,
    });
  } else notRun.push({ check: "cg-target", reason: "cg not declared in the input" });

  // --- interfaces -------------------------------------------------------
  if (p.interfaces != null) {
    if (!Array.isArray(p.interfaces)) return bad("interfaces must be an array");
    for (let i = 0; i < p.interfaces.length; i++) {
      const itf = p.interfaces[i];
      const name = `interface:${itf?.id ?? i}`;
      const { a, b } = itf || {};
      if (!a || !b) return bad(`interfaces[${i}] requires both sides (a and b)`);
      if (itf.kind === "voltage") {
        const va = num(a.volts), vb = num(b.volts);
        if (va == null || vb == null) return bad(`interfaces[${i}] (voltage) requires finite volts on both sides`);
        checks.push({
          check: name, kind: "voltage",
          status: va === vb ? "PASS" : "FAIL",
          a: { volts: va }, b: { volts: vb },
          detail: va === vb ? `both sides ${va} V` : `MISMATCH: side a declares ${va} V, side b declares ${vb} V`,
        });
      } else if (itf.kind === "connector" || itf.kind === "thread") {
        const key = itf.kind === "connector" ? "type" : "designation";
        const va = a[key], vb = b[key];
        if (typeof va !== "string" || !va || typeof vb !== "string" || !vb) return bad(`interfaces[${i}] (${itf.kind}) requires a non-empty ${key} string on both sides`);
        checks.push({
          check: name, kind: itf.kind,
          status: va === vb ? "PASS" : "FAIL",
          a: { [key]: va }, b: { [key]: vb },
          detail: va === vb ? `both sides "${va}"` : `MISMATCH: side a declares "${va}", side b declares "${vb}"`,
        });
      } else if (itf.kind === "flow") {
        const cap = num(a.capacityKgS), dem = num(b.demandKgS);
        if (cap == null || dem == null) return bad(`interfaces[${i}] (flow) requires finite a.capacityKgS and b.demandKgS`);
        if (cap < 0 || dem < 0) return bad(`interfaces[${i}] (flow) values must be non-negative`);
        checks.push({
          check: name, kind: "flow",
          status: cap >= dem ? "PASS" : "FAIL",
          a: { capacityKgS: cap }, b: { demandKgS: dem }, marginKgS: cap - dem,
          detail: cap >= dem ? `capacity ${cap} kg/s covers demand ${dem} kg/s` : `UNDERSIZED: side a capacity ${cap} kg/s is below side b demand ${dem} kg/s by ${dem - cap} kg/s`,
        });
      } else {
        return bad(`interfaces[${i}].kind "${itf.kind}" is not in the vocabulary (voltage, connector, flow, thread)`);
      }
    }
  } else notRun.push({ check: "interface-compatibility", reason: "interfaces not declared in the input" });

  // --- clearances -------------------------------------------------------
  if (p.clearances != null) {
    if (!Array.isArray(p.clearances)) return bad("clearances must be an array");
    for (let i = 0; i < p.clearances.length; i++) {
      const c = p.clearances[i];
      const gap = num(c?.gapMm), req = num(c?.requiredMm);
      if (gap == null || req == null) return bad(`clearances[${i}] requires finite gapMm and requiredMm`);
      if (gap < 0 || req < 0) return bad(`clearances[${i}] values must be non-negative`);
      checks.push({
        check: `clearance:${c.id ?? i}`,
        status: gap >= req ? "PASS" : "FAIL",
        gapMm: gap, requiredMm: req, marginMm: gap - req,
        detail: gap >= req ? `gap ${gap} mm meets required ${req} mm` : `INTERFERENCE: gap ${gap} mm is below required ${req} mm by ${req - gap} mm`,
      });
    }
  } else notRun.push({ check: "clearances", reason: "clearances not declared in the input" });

  // --- load paths ---------------------------------------------------------
  if (p.loadPaths != null) {
    if (!Array.isArray(p.loadPaths)) return bad("loadPaths must be an array");
    for (let i = 0; i < p.loadPaths.length; i++) {
      const lp = p.loadPaths[i];
      const segs = lp?.segments;
      if (!Array.isArray(segs) || segs.length === 0) return bad(`loadPaths[${i}] requires a non-empty segments array of [from, to] pairs`);
      let breakAt = -1;
      for (let k = 0; k < segs.length; k++) {
        const s = segs[k];
        if (!Array.isArray(s) || s.length !== 2 || typeof s[0] !== "string" || typeof s[1] !== "string") {
          return bad(`loadPaths[${i}].segments[${k}] must be a [from, to] pair of node names`);
        }
        if (k > 0 && segs[k - 1][1] !== s[0]) { breakAt = k; break; }
      }
      checks.push({
        check: `load-path:${lp.id ?? i}`,
        status: breakAt < 0 ? "PASS" : "FAIL",
        segments: segs.length,
        ...(breakAt >= 0
          ? { breakAt, detail: `BROKEN at segment ${breakAt}: segment ${breakAt - 1} ends at "${segs[breakAt - 1][1]}" but segment ${breakAt} starts at "${segs[breakAt][0]}" — the load path is not continuous` }
          : { detail: `continuous over ${segs.length} segment(s), "${segs[0][0]}" to "${segs[segs.length - 1][1]}"` }),
      });
    }
  } else notRun.push({ check: "load-paths", reason: "loadPaths not declared in the input" });

  if (checks.length === 0) {
    return { notComputed: "no_checks_declared: the input declares none of power, heatLoops, mass, cg, interfaces, clearances, loadPaths", inputs: {} };
  }
  const failed = checks.filter((c) => c.status === "FAIL");
  const warnings = [];
  if (notRun.length) warnings.push(`${notRun.length} check section(s) NOT_RUN (named in notRun) — the verdict covers only the checks that ran`);
  if (failed.length) warnings.push(`${failed.length} check(s) FAILED: ${failed.map((c) => c.check).join(", ")}`);
  return {
    inputs: props,
    outputs: {
      verdict: failed.length ? "FAIL" : "PASS",
      checks,
      notRun,
      counts: { run: checks.length, passed: checks.length - failed.length, failed: failed.length, notRun: notRun.length },
    },
    assumptions: [],
    warnings,
  };
}

// Local targets/run pair (literal-key discipline; graph-adapter finding
// filed under SX-ORC-01).
function icTargets(graph) {
  if (!graph || !graph.nodes) return [];
  const out = [];
  for (const [id, node] of graph.nodes) {
    if (node && node.props && node.props[NS]) out.push(id);
  }
  return out;
}

function icRun(ctx, id) {
  let all = null;
  try {
    all = ctx.get(id, "props");
  } catch {
    all = null;
  }
  const props = all ? all[NS] : null;
  if (!props || (typeof props === "object" && !Array.isArray(props) && Object.keys(props).length === 0)) {
    return { notComputed: `props.${NS} is empty or absent on node ${id}`, inputs: {} };
  }
  return integrationChecks(props);
}

registerSolver({
  id: "orc.integration-checks",
  version: "1.0.0",
  domain: "orchestration",
  domains: ["orchestration"],
  method: "integration-checks.closures+compatibility",
  fidelity: 3,
  engineDependent: [],
  regime: "declared subsystem values at steady state (power and heat closures); interface vocabulary voltage/connector/flow/thread; load paths as named-node segment chains",
  units: "power and heat in watts; mass in kilograms; CG in metres with a declared tolerance; clearances in millimetres; flow in kilograms per second",
  tolerance: "closure checks use a declared toleranceW when given, else a relative 1e-9 of the largest term — the tolerance used and its source are reported per check; CG tolerance is always declared (no default)",
  screening: false,
  reference: "reference case (a deliberately broken interface FAILs naming both sides) in server/tests/conkay-orc-integration-checks.test.js",
  graphProp: NS,
  targets: icTargets,
  run: icRun,
});

export default { integrationChecks };
