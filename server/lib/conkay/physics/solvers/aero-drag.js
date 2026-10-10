// server/lib/conkay/physics/solvers/aero-drag.js
//
// aero.drag-buildup: a screening-level drag coefficient RANGE for a vehicle
// whose body is the CAD solid (cad.body), from the body itself:
//   - wetted area and frontal area: cad.body (kernel GProp / projection);
//   - length, base area and the centreline roof / floor lines: slices of the
//     kernel's STL (aero/stl-sections.js; base area = the cut just ahead of
//     the tail face);
//   - Cd range: aero/calibrated-drag.js (1.1). Flat-plate friction, Ahmed's
//     25 deg nose, Ahmed base pressure (Gant and Lienhart) times Ab/A, a
//     slant bound from those readings, cooling 0.003..0.017, wheel share
//     0.20..0.30. The 1.0 Hoerner envelope (aero/drag-buildup.js) is computed
//     on the same geometry and stored as previousEnvelope. It is not the Cd.
//   - lift sign: 2D panel method (aero/panel2d.js) on the centreline section
//     in ground effect, with the Kutta condition at the upper and at the lower
//     tail corner; the sign is reported only when both agree.
// Out of the build-up's validity range (rear slant > 25 deg, Mach > 0.3, Re
// outside 1e6..1e9) it reports NOT_COMPUTED with the reason: no Cd is given.
// This is not CFD and not a wind-tunnel value.
//
// Targets: vehicles with props.vehicle.dragCoefficientFrom = "aero.drag-buildup"
// and props.vehicle.frontalAreaFrom naming a cad-body node.

import { registerSolver } from "../registry.js";
import { readStlFile, sectionAreas, meshExtent } from "../../aero/stl-sections.js";
import { dragBuildup, rearSlantDeg, ISA_SEA_LEVEL, AERO_SOURCES } from "../../aero/drag-buildup.js";
import { calibratedDrag, ahmedBenchmark, CALIBRATED_DRAG_VERSION } from "../../aero/calibrated-drag.js";
import { solvePanels, PANEL2D_VERSION } from "../../aero/panel2d.js";

export const AERO_FROM = "aero.drag-buildup";
const STL_CACHE = new Map(); // sha256 -> triangles
const STATIONS = 80;

function trianglesOf(stl) {
  if (stl.sha256 && STL_CACHE.has(stl.sha256)) return STL_CACHE.get(stl.sha256);
  const t = readStlFile(stl.path);
  if (stl.sha256) { STL_CACHE.set(stl.sha256, t); while (STL_CACHE.size > 4) STL_CACHE.delete(STL_CACHE.keys().next().value); }
  return t;
}

/** Top and bottom z of the cut x = c, from triangle-edge intersections (the section's vertical extent). */
function sectionZ(tris, c) {
  let top = -Infinity, bot = Infinity;
  for (const t of tris) {
    for (let i = 0; i < 3; i++) {
      const p = t[i], q = t[(i + 1) % 3];
      if ((p[0] - c) * (q[0] - c) > 0 || p[0] === q[0]) continue;
      const s = (c - p[0]) / (q[0] - p[0]);
      const z = p[2] + s * (q[2] - p[2]);
      if (z > top) top = z;
      if (z < bot) bot = z;
    }
  }
  return Number.isFinite(top) ? { top, bot } : null;
}

/** Centreline profile and areas of the body mesh. */
export function bodyProfile(tris) {
  const [x0, x1] = meshExtent(tris, 0);
  const L = x1 - x0;
  const eps = 1e-4 * L;
  const cuts = Array.from({ length: STATIONS }, (_, i) => x0 + eps + ((L - 2 * eps) * i) / (STATIONS - 1));
  const z = cuts.map((c) => ({ x: c, ...sectionZ(tris, c) })).filter((p) => Number.isFinite(p.top));
  const base = sectionAreas(tris, [x1 - eps])[0].area;
  return { x0, x1, L, baseArea: base, profile: z };
}

/** Clockwise centreline polygon (x, z) starting at the upper (startAt "upper") or lower tail corner. */
export function profilePolygon(profile, startAt = "upper") {
  const end = profile.at(-1);
  const top = profile.map((p) => [p.x, p.top]);
  const bot = profile.map((p) => [p.x, p.bot]);
  // clockwise: tail upper -> tail lower (base) -> floor forward -> nose -> roof aft -> tail upper
  const raw = [[end.x, end.top], [end.x, end.bot], ...bot.slice(0, -1).reverse(), ...top.slice(0, -1)];
  const ring = raw.filter((p, i) => { const q = raw[(i + 1) % raw.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-9; });
  if (startAt === "lower") ring.push(ring.shift());
  return [...ring, ring[0]];
}

export const aeroDragBuildup = registerSolver({
  id: AERO_FROM,
  version: CALIBRATED_DRAG_VERSION,
  domain: "aero.drag",
  fidelity: 1,
  screening: true,
  regime: "incompressible (M < 0.3), turbulent, attached flow ahead of a blunt base; rear slant <= 25 deg",
  method: "calibrated component drag build-up (1.1) on the CAD solid: flat-plate friction, Ahmed 25 deg nose, Ahmed base pressure (Gant and Lienhart) times Ab/A, slant bound from those 25 deg readings, cooling 0.003..0.017, wheel share 0.20..0.30. The 1.0 Hoerner/reentry envelope is computed on the same geometry and reported beside it, not used as the Cd. 2D Hess-Smith panel method in ground effect for the section lift sign only. Not CFD, not a wind-tunnel value.",
  reference: "Ahmed, Ramm & Faltin SAE 840300 via Gant Tables 7.3-7.4 and Lienhart as tabulated there; Guilmineau SAE 2018-01-0720 Table 4 (Ahmed rows only); ERCOFTAC case 082 and Minguez et al. JWEIA 2008 for the 222 mm slant; Brandt et al. SAE 2019-01-0662; Hobeika et al. 2017; Schlichting; Hess & Smith 1967. Hoerner/Saltzman is a residual check, not the base term.",
  targets: (g) => g.nodesOfKind("Assembly").filter((n) => n.props?.vehicle?.dragCoefficientFrom === AERO_FROM).map((n) => n.id),
  run(ctx, id) {
    const from = ctx.get(id, "props.vehicle.frontalAreaFrom");
    if (!from || ctx.get(from, "geometry")?.shape !== "cad-body") return { notComputed: "aero.drag-buildup needs props.vehicle.frontalAreaFrom naming a cad-body node" };
    const cad = ctx.result("cad.body", from);
    if (!cad || cad.status === "NOT_COMPUTED" || cad.status === "ERROR") return { notComputed: `the CAD body ${from} is not computed (${cad?.reason || cad?.error || "no run"})` };
    const stl = cad.outputs.files?.value?.stl;
    if (!stl?.path) return { notComputed: `cad.body@${from} has no STL file` };
    let tris;
    try { tris = trianglesOf(stl); } catch (e) { return { notComputed: `cannot read the body STL (${e.message})` }; }
    const prof = bodyProfile(tris);
    const S = cad.outputs.surfaceArea.value, A = cad.outputs.frontalArea.value;
    const slant = rearSlantDeg(prof.profile.map((p) => ({ x: p.x, z: p.top })));
    const req = ctx.graph.requirements.find((r) => r.of.solver === "vehicle.top-speed" && r.of.target === id && r.min);
    const vReq = req ? ctx.requirement(req.id)?.min?.si : null;
    const speed = Number.isFinite(vReq) ? vReq : 40;
    const rhoGiven = ctx.get(id, "props.vehicle.airDensity");
    const flow = { speedMs: speed, rho: Number.isFinite(rhoGiven) ? rhoGiven : ISA_SEA_LEVEL.rho, mu: ISA_SEA_LEVEL.mu };
    const geom = { lengthM: prof.L, wettedAreaM2: S, frontalAreaM2: A, baseAreaM2: prof.baseArea, rearSlantDeg: slant };
    const b = calibratedDrag(geom, flow);
    const v1 = dragBuildup(geom, flow);
    const ahmed = ahmedBenchmark();
    const geometryOut = {
      lengthM: { value: prof.L, unit: "m", basis: "computed: STL extent along x" },
      wettedAreaM2: { value: S, unit: "m2", basis: "computed: cad.body surface area (includes the wheel-well surfaces: the friction term is high by their share)" },
      frontalAreaM2: { value: A, unit: "m2", basis: "computed: cad.body projected frontal area" },
      baseAreaM2: { value: prof.baseArea, unit: "m2", basis: "computed: STL cross-section just ahead of the tail face (divergence theorem on the clipped mesh)" },
      rearSlantDeg: { value: slant, unit: "deg", basis: "computed: centreline roof line from its highest point to the tail" },
    };
    if (!b.inRange || b.flags.some((f) => /Mach|Re_L/.test(f))) {
      return { notComputed: `outside the build-up's validity range: ${b.flags.join("; ")}`, inputs: geometryOut };
    }
    // 2D section lift sign in ground effect (z = 0 is the road)
    const lift = {};
    for (const k of ["upper", "lower"]) {
      try {
        const s = solvePanels(profilePolygon(prof.profile, k), { ground: { y: 0 }, refLength: prof.L });
        lift[k] = { cl2d: s.cl, clPressure: s.clPressure };
      } catch (e) { lift[k] = { error: e.message }; }
    }
    const signs = ["upper", "lower"].map((k) => Math.sign(lift[k].cl2d ?? NaN));
    const liftSign = signs.every((s) => s === 1) ? "lift" : signs.every((s) => s === -1) ? "downforce" : "indeterminate";
    const term = (side) => ({ friction: side.friction, nose: side.nose, base: side.base, slant: side.slant, cooling: side.cooling, wheelsShare: side.wheelsShare, cd: side.cd });
    return {
      inputs: {
        cadBody: { value: cad.runId, source: cad.runId },
        stl: { value: stl.sha256 || stl.path, note: `${tris.length} triangles` },
        referenceSpeed: { value: speed, unit: "m/s", basis: Number.isFinite(vReq) ? "the top-speed requirement (Reynolds number)" : "40 m/s (no top-speed requirement)" },
        air: { value: flow, basis: Number.isFinite(rhoGiven) ? "density given in the design; viscosity ISA" : "ISA sea level (ISO 2533)" },
        coefficients: { value: b.terms, note: "1.1 terms. The 1.0 envelope is previousEnvelope, not these." },
        ...geometryOut,
      },
      outputs: {
        dragCoefficient: {
          value: { low: b.low.cd, high: b.high.cd, centre: b.centre }, status: "computed_screening_range",
          note: `${b.centreNote}; calibrated build-up ${CALIBRATED_DRAG_VERSION}; not CFD, not a wind-tunnel value`,
        },
        previousEnvelope: {
          value: { low: v1.low.cd, high: v1.high.cd, centre: v1.centre }, status: "superseded",
          note: "drag build-up 1.0 on the same geometry (Hoerner K up to 0.10, cooling high 0.05). Not the reported Cd.",
        },
        ahmedBenchmark: {
          value: { low: ahmed.low.cd, high: ahmed.high.cd, centre: ahmed.centre, target: ahmed.target.total, containsTarget: ahmed.low.cd <= ahmed.target.total && ahmed.high.cd >= ahmed.target.total },
          note: "the same build-up on the Ahmed 25 deg body (no wheels, no cooling). target is Gant's 0.285. Contains the target; it does not validate the car.",
        },
        terms: { value: { low: term(b.low), high: term(b.high) }, note: "Cd contributions on the frontal area (wheels as a share of the total)" },
        reynolds: { value: b.Re }, mach: { value: b.mach }, skinFriction: { value: b.cf, basis: "Prandtl-Schlichting turbulent flat plate" },
        sectionLift: { value: { sign: liftSign, kuttaUpperCorner: lift.upper, kuttaLowerCorner: lift.lower }, note: `2D centreline section in ground effect (panel method ${PANEL2D_VERSION}, inviscid): a sign indication only, not the 3D lift of the car` },
        flags: { value: b.flags },
        notModelled: { value: b.notModelled },
        sources: { value: AERO_SOURCES },
      },
      warnings: ["screening estimate: a bounded drag build-up, not CFD or wind-tunnel validation", ...b.flags],
      assumptions: [
        "Turbulent flat-plate friction over the whole wetted area, scaled up by the factor by which Ahmed's residual friction exceeds that correlation.",
        "Base pressure is the 25 deg Ahmed vertical-base pressure (Gant and Lienhart), transferred by Ab/A. Hoerner's relation is evaluated on Ahmed and not used here.",
        "A rear slant between 12.5 and 24 deg takes Lienhart's 25 deg slant Cd as an upper bound, not as this angle's value. At 24..25 deg the bound is the Gant-to-Lienhart pair.",
        "Cooling 0.003..0.017 and a wheel share of 0.20..0.30 are fleet figures, not this car's ducts or wheels. The +/- 0.05 on the wheel share is an estimate.",
      ],
    };
  },
});
