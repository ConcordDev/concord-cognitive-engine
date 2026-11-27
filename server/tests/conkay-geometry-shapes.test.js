// Real shapes (extrude / revolve / loft) with verifiable math. Expected values
// are closed-form hand calculations, not solver output pasted back; the display
// mesh is checked independently by the divergence theorem.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compileProfileShape, profileMesh } from "../lib/conkay/geometry/shapes.js";
import { nacaPoints, signedArea, triangulate, filletPolygon } from "../lib/conkay/geometry/profiles.js";
import { openDesign } from "../lib/conkay/index.js";

const near = (a, b, rel = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= rel * Math.abs(b), `${msg} ${a} vs ${b}`);
const ok = (g) => { const r = compileProfileShape(g); assert.ok(!r.errors, JSON.stringify(r.errors)); return r.geometry; };
const meshVol = ({ positions: P, indices: I }) => { let v = 0; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6; } return v; };

test("revolve: a cup holds π r² h of its inside, its wall volume by Pappus, in any units", () => {
  const g = ok({ shape: "revolve", outline: [[0, 0], ["40 mm", 0], ["40 mm", "100 mm"]], wall: "3 mm" });
  near(g.derived.capacity, Math.PI * 0.037 ** 2 * 0.097, 1e-12, "capacity");
  // wall = outer cylinder − inner cylinder
  near(g.derived.volume, Math.PI * 0.04 ** 2 * 0.1 - Math.PI * 0.037 ** 2 * 0.097, 1e-12, "wall");
  const cone = ok({ shape: "revolve", profile: [[0, 0], ["2 in", 0], [0, "4 in"]] });
  near(cone.derived.volume, (Math.PI * 0.0508 ** 2 * 0.1016) / 3, 1e-12, "cone");
  const half = ok({ shape: "revolve", profile: [["30 mm", 0], ["40 mm", 0], ["40 mm", "10 mm"], ["30 mm", "10 mm"]], angle: 180 });
  near(half.derived.volume, (Math.PI * (0.04 ** 2 - 0.03 ** 2) * 0.01) / 2, 1e-12, "half ring");
});

test("extrude: section properties are exact (angle, plate with holes, filleted rectangle)", () => {
  const L = ok({ shape: "extrude", length: "1 m", profile: [[0, 0], ["50 mm", 0], ["50 mm", "5 mm"], ["5 mm", "5 mm"], ["5 mm", "50 mm"], [0, "50 mm"]] });
  near(L.derived.A, 475e-6, 1e-12, "angle area");
  const cb = (50 * 5 * 2.5 + 45 * 5 * 27.5) / 475; // mm
  near(L.derived.centroid[1], cb / 1000, 1e-12, "angle centroid");
  const I = (50 * 5 ** 3) / 12 + 250 * (cb - 2.5) ** 2 + (5 * 45 ** 3) / 12 + 225 * (27.5 - cb) ** 2; // mm⁴, parallel axes
  near(L.derived.Iaa, I * 1e-12, 1e-9, "angle I");
  const P = ok({ shape: "extrude", length: "10 mm", profile: [["-50 mm", "-30 mm"], ["50 mm", "-30 mm"], ["50 mm", "30 mm"], ["-50 mm", "30 mm"]], holes: [{ circle: { at: [0, 0], diameter: "20 mm" } }] });
  near(P.derived.A, (6000 - Math.PI * 100) * 1e-6, 1e-12, "plate with a hole");
  near(P.derived.Iaa, ((100 * 60 ** 3) / 12 - (Math.PI * 20 ** 4) / 64) * 1e-12, 1e-12, "plate I");
  const F = ok({ shape: "extrude", length: "10 mm", profile: [[0, 0], ["100 mm", 0], ["100 mm", "60 mm"], [0, "60 mm"]], fillet: "10 mm" });
  // four 90° fillets remove (4 − π) r²; the 2° arc segments leave it low by < 2.1e-4 of the fillet sectors
  const exact = 6000 - (4 - Math.PI) * 100, sectors = Math.PI * 100;
  assert.ok(exact - F.derived.A * 1e6 >= 0 && exact - F.derived.A * 1e6 < 2.1e-4 * sectors, `${F.derived.A * 1e6} vs ${exact}`);
});

test("loft: a frustum is exact; NACA thickness area matches its integral", () => {
  const f = ok({ shape: "loft", sections: [{ at: 0, shape: "rect", width: "100 mm", height: "100 mm" }, { at: "200 mm", shape: "rect", width: "50 mm", height: "50 mm" }] });
  near(f.derived.volume, (0.2 / 3) * (0.01 + 0.0025 + Math.sqrt(0.01 * 0.0025)), 1e-9, "frustum");
  // NACA 0012 (closed trailing edge): area = 10 t ∫(0.2969√x − 0.126x − 0.3516x² + 0.2843x³ − 0.1036x⁴) dx
  const t = 0.12, integral = 0.2969 * (2 / 3) - 0.126 / 2 - 0.3516 / 3 + 0.2843 / 4 - 0.1036 / 5;
  near(Math.abs(signedArea(nacaPoints("0012", 1, 2000))), 10 * t * integral, 2e-5, "naca0012");
});

test("the 3D mesh encloses the computed volume and faces outward on every axis", () => {
  const cases = [
    [{ shape: "extrude", length: "100 mm", profile: [[0, 0], ["50 mm", 0], ["50 mm", "5 mm"], ["5 mm", "5 mm"], ["5 mm", "50 mm"], [0, "50 mm"]], fillet: "2 mm" }, 1e-9],
    [{ shape: "extrude", length: "10 mm", profile: [["-50 mm", "-30 mm"], ["50 mm", "-30 mm"], ["50 mm", "30 mm"], ["-50 mm", "30 mm"]], holes: [{ circle: { at: ["-25 mm", 0], diameter: "20 mm" } }, [["15 mm", "-10 mm"], ["35 mm", "-10 mm"], ["35 mm", "10 mm"], ["15 mm", "10 mm"]]] }, 2e-4],
    [{ shape: "loft", sections: [{ at: 0, shape: "naca", chord: "300 mm", naca: "2412" }, { at: "1 m", shape: "naca", chord: "150 mm", naca: "2412" }] }, 1e-9],
  ];
  for (const [g, tol] of cases) {for (const axis of ["x", "y", "z"]) {
    const c = ok(g);
    const v = meshVol(profileMesh(c, axis));
    assert.ok(v > 0, `${g.shape} on ${axis} is inside out`);
    near(v, c.derived.volume, tol, `${g.shape} ${axis}`);
  }}
  // a 64-segment revolve encloses sin(2π/64)/(2π/64) of the true solid
  const cup = ok({ shape: "revolve", outline: [[0, 0], ["40 mm", 0], ["40 mm", "100 mm"]], wall: "3 mm" });
  const th = (2 * Math.PI) / 64;
  near(meshVol(profileMesh(cup)), cup.derived.volume * (Math.sin(th) / th), 1e-9, "revolve mesh");
});

test("bad shapes are refused with the reason", () => {
  const bad = [
    [{ shape: "extrude", length: "1 m", profile: [[0, 0], ["1 m", "1 m"], ["1 m", 0], [0, "1 m"]] }, /crosses itself/],
    [{ shape: "extrude", length: "1 m", profile: [[0, 0], ["10 mm", 0], ["10 mm", "10 mm"], [0, "10 mm"]], fillet: "8 mm" }, /too large/],
    [{ shape: "revolve", outline: [[0, 0], ["10 mm", 0], ["10 mm", "50 mm"]], wall: "12 mm" }, /cross the axis|thicker/],
    [{ shape: "revolve", profile: [["-5 mm", 0], ["5 mm", 0], ["5 mm", "5 mm"]] }, /negative/],
    [{ shape: "loft", sections: [{ at: 0, shape: "naca", chord: "1 m", naca: "24A2" }, { at: "1 m", shape: "rect", width: "1 m", height: "1 m" }] }, /4-digit/],
    [{ shape: "extrude", length: "5 kg", profile: [[0, 0], ["1 m", 0], [0, "1 m"]] }, /expected a length/],
  ];
  for (const [g, re] of bad) { const r = compileProfileShape(g); assert.ok(r.errors, JSON.stringify(g)); assert.match(r.errors.join(" "), re); }
});

test("an extruded part is a frame member: same stress as the equivalent built-in section", () => {
  const frame = (part) => ({
    design: { id: "f", name: "f" },
    nodes: [
      { id: "A1", kind: "Assembly", name: "cantilever", props: { frameModel: {
        nodes: [{ id: "A", x: 0, y: 0, z: 0 }, { id: "B", x: 0.5, y: 0, z: 0 }], members: [{ id: "M1", i: "A", j: "B", part: "P" }],
        supports: [{ node: "A", fix: "fixed" }], loadCases: [{ id: "tip", nodal: [{ node: "B", F: [0, 0, -500] }] }], factorOfSafety: { value: 1, basis: "test" } } } },
      { id: "P", kind: "Part", name: "bar", material: "steel-a36", geometry: part },
    ],
    edges: [{ from: "A1", to: "P", type: "CONTAINS" }], loadCases: [], requirements: [],
  });
  const stress = (part) => {
    const r = openDesign(frame(part));
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    const e = r.session.results().find((x) => x.solver.id === "structure.frame");
    return { s: e.margins.find((m) => /von Mises/.test(m.check)).demand, w: e.warnings };
  };
  // a 20 × 40 mm solid bar (40 deep, b axis = up): σ = M c / I = 250 N·m × 0.02 / (0.02 × 0.04³ / 12)
  const hand = (250 * 0.02) / ((0.02 * 0.04 ** 3) / 12);
  const asExtrude = stress({ shape: "extrude", length: "500 mm", profile: [["-10 mm", "-20 mm"], ["10 mm", "-20 mm"], ["10 mm", "20 mm"], ["-10 mm", "20 mm"]] });
  const asBox = stress({ shape: "box", length: "500 mm", width: "20 mm", height: "40 mm" });
  near(asExtrude.s, asBox.s, 1e-3, "extrude vs box");
  near(asExtrude.s, hand, 0.02, "extrude vs hand");
  assert.ok(asExtrude.w.some((w) => /Saint-Venant/.test(w)), "the torsion estimate is said");
  // a hollow square extrusion vs the built-in rect-tube
  const tube = stress({ shape: "extrude", length: "500 mm", profile: [["-20 mm", "-20 mm"], ["20 mm", "-20 mm"], ["20 mm", "20 mm"], ["-20 mm", "20 mm"]], holes: [[["-17 mm", "-17 mm"], ["17 mm", "-17 mm"], ["17 mm", "17 mm"], ["-17 mm", "17 mm"]]] });
  const rt = stress({ shape: "rect-tube", length: "500 mm", width: "40 mm", height: "40 mm", wall: "3 mm" });
  near(tube.s, rt.s, 0.02, "hollow extrude vs rect-tube");
  assert.ok(tube.w.some((w) => /hollow/.test(w)), "hollow section torsion caveat");
});

test("a mug's capacity is checked against what it should hold, in fl oz", () => {
  const ir = (min) => ({ design: { id: "m", name: "mug" }, edges: [], loadCases: [], requirements: [],
    materials: { stoneware: { density: { value: "2.3 g/cm3", source: "CRC" } } },
    nodes: [{ id: "B", kind: "Part", name: "body", material: "stoneware", geometry: { shape: "revolve", outline: [[0, 0], ["40 mm", 0], ["40 mm", "100 mm"]], wall: "3 mm" }, props: { capacity: { min, source: "person" } } }] });
  const run = (min) => openDesign(ir(min)).session.results().find((e) => e.solver.id === "geometry.capacity");
  const cap = Math.PI * 0.037 ** 2 * 0.097; // 417.2 mL = 14.11 US fl oz
  assert.equal(run("12 fl oz").status, "PASS");
  assert.equal(run("16 fl oz").status, "FAIL");
  near(run("12 fl oz").outputs.capacity.value, cap, 1e-12);
  const mass = openDesign(ir("12 fl oz")).session.results().find((e) => e.solver.id === "mass.part");
  near(mass.outputs.mass.value, 2300 * (Math.PI * 0.04 ** 2 * 0.1 - cap), 1e-9, "mug mass");
});

test("triangulation covers a polygon with holes exactly once", () => {
  const sq = [[-50, -30], [50, -30], [50, 30], [-50, 30]], hole = [[15, -10], [35, -10], [35, 10], [15, 10]];
  const { points: p, triangles } = triangulate(sq, [hole]);
  const area = triangles.reduce((s, [i, j, k]) => s + ((p[j][0] - p[i][0]) * (p[k][1] - p[i][1]) - (p[j][1] - p[i][1]) * (p[k][0] - p[i][0])) / 2, 0);
  near(area, 5600, 1e-12);
  assert.ok(filletPolygon(sq, 5).length > 4);
});

// ── the B-rep kernel (OpenCascade) ───────────────────────────────────────────
import { buildStep } from "../lib/conkay/geometry/solids.js";
import { resolveKernelPython } from "../lib/conkay/cad/body-kernel.js";
import { clearKernelResults } from "../lib/conkay/cad/kernel-queue.js";

const kernelIR = () => ({ design: { id: "k", name: "k" }, edges: [], loadCases: [], requirements: [], nodes: [
  { id: "CUP", kind: "Part", name: "cup", material: "steel-a36", geometry: { shape: "revolve", outline: [[0, 0], ["40 mm", 0], ["40 mm", "100 mm"]], wall: "3 mm" } },
  { id: "PL", kind: "Part", name: "plate", material: "steel-a36", position: { x: "200 mm", y: 0, z: 0 }, geometry: { shape: "extrude", length: "10 mm", profile: [["-50 mm", "-30 mm"], ["50 mm", "-30 mm"], ["50 mm", "30 mm"], ["-50 mm", "30 mm"]], holes: [{ circle: { at: [0, 0], diameter: "20 mm" } }], fillet: "5 mm" } },
  { id: "W", kind: "Part", name: "wing", material: "aluminum-6061-t6", props: { axis: "y" }, geometry: { shape: "loft", sections: [{ at: 0, shape: "naca", chord: "300 mm", naca: "2412" }, { at: "1 m", shape: "naca", chord: "150 mm", naca: "2412", twist: -3 }] } },
] });

test("the B-rep kernel builds every shape and agrees with ConKay's exact volume; STEP holds real solids", async (t) => {
  clearKernelResults();
  const o = openDesign(kernelIR());
  assert.equal(o.ok, true);
  await o.session.settle();
  const checks = o.session.results().filter((e) => e.solver.id === "cad.solid-check");
  assert.equal(checks.length, 3);
  if (!(await resolveKernelPython())) {
    // no kernel here: said so, never a pass
    for (const c of checks) { assert.equal(c.status, "NOT_COMPUTED"); assert.match(c.reason, /OCP|CONKAY_OCC_PYTHON/); }
    t.diagnostic("OpenCascade not installed: the kernel half of this test checked the honest refusal only");
    return;
  }
  for (const c of checks) {
    assert.equal(c.status, "PASS", `${c.target}: ${c.reason || JSON.stringify(c.outputs)}`);
    assert.ok(c.outputs.relativeDifference.value < 1e-9, `${c.target} differs by ${c.outputs.relativeDifference.value}`);
  }
  // the kernel's surface area of the cup, by hand: outer wall + base + inner wall + inner floor + rim annulus
  const cupArea = 2 * Math.PI * 0.04 * 0.1 + Math.PI * 0.04 ** 2 + 2 * Math.PI * 0.037 * 0.097 + Math.PI * 0.037 ** 2 + Math.PI * (0.04 ** 2 - 0.037 ** 2);
  near(checks.find((c) => c.target === "CUP").outputs.surfaceArea.value, cupArea, 1e-6, "cup area");
  const s = await buildStep(o.session.graph);
  assert.equal(s.ok, true, s.error);
  assert.match(s.step, /^ISO-10303-21;/);
  assert.match(s.step, /MANIFOLD_SOLID_BREP/);
  assert.match(s.step, /CYLINDRICAL_SURFACE/, "the cup and the hole are true cylinders, not facets");
  assert.equal(s.parts.filter((p) => p.ok).length, 3);
});

test("a skinned loft is cross-checked on its outer solid, and its thin-wall mass is labelled", async () => {
  clearKernelResults();
  const ir = { design: { id: "w", name: "w" }, edges: [], loadCases: [], requirements: [], nodes: [{ id: "W", kind: "Part", name: "wing", material: "aluminum-6061-t6", props: { axis: "y" },
    geometry: { shape: "loft", skin: "1 mm", sections: [{ at: 0, shape: "naca", chord: "320 mm", naca: "2412" }, { at: "1200 mm", shape: "naca", chord: "180 mm", naca: "2412", twist: -3 }] } }] };
  const o = openDesign(ir); await o.session.settle();
  const c = o.session.results().find((e) => e.solver.id === "cad.solid-check");
  const g = o.session.graph.node("W").geometry;
  assert.ok(g.derived.volume < g.derived.solidVolume / 5, "the skin is far less than the solid");
  if (c.status === "NOT_COMPUTED") return; // no kernel here
  // the outer solid agrees; the thin-wall caveat keeps it a WARN, never a plain PASS
  assert.equal(c.status, "WARN", JSON.stringify(c.outputs));
  assert.ok(c.outputs.relativeDifference.value < 1e-9);
  near(c.outputs.exactVolume.value, g.derived.solidVolume, 1e-12, "compared on the outer solid");
  assert.match(c.warnings.join(" "), /thin-wall estimate/);
});
