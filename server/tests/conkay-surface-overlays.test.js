// Visual polish (b): cad.design-surface layers drawn on the analysed solid.
// Benchmarks are exact on a box (projection along an axis and along an
// oblique direction). Then the showcase body: every panel-line point sits on
// the skin (outside it by the drawing offset, inside it 10 mm further in),
// lamps on the nose, side glass above the solid's shoulder, the solid never
// trimmed, and the assembly carrying the overlays while loft-placed details
// are labelled as not on the solid.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dirIndex, axisIndex, projectAxis, projectPoint, resample, surfaceOverlays, shoulderLine, OVERLAY_OFFSET,
} from "../lib/conkay/assembly/surface-overlays.js";
import { readStlFile, cadSkinMesh, cadSkinSolid, pointInSolid } from "../lib/conkay/assembly/cad-skin.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { designSurface, metres } from "../lib/conkay/cad/design-surface.js";
import { getComponent } from "../lib/conkay/components/index.js";
import { assemblyFromIr, compactAssembly } from "../lib/conkay/assembly/build.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const SHOWCASE_STL = new URL("../lib/conkay/showcase/snapshots/car/body-2b42882b03f0.stl", import.meta.url).pathname;

/** Triangles of the box [x0,x1]×[y0,y1]×[z0,z1]. */
function boxTris([x0, y0, z0], [x1, y1, z1]) {
  const v = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return faces.flatMap(([a, b, c, d]) => [[v(a), v(b), v(c)], [v(a), v(c), v(d)]]);
}

function specFromIr(ir) {
  const chassis = ir.nodes.find((n) => n.id === "CHASSIS");
  const g = ir.nodes.find((n) => n.id === "BODY_SHELL").geometry;
  const veh = ir.nodes.find((n) => n.id === "VEH").props.vehicle;
  const body = {
    shape: "cad-body", noseTipHeightM: metres(g.noseTipHeight), beltMinM: metres(g.beltMin), beltMaxM: metres(g.beltMax),
    archClearanceM: metres(g.archClearance), fenderCoverM: metres(g.fenderCover), noseExtensionM: metres(g.noseExtension), fastbackDeg: g.fastbackDeg,
  };
  const tyres = veh.packaging.tyres.map((t) => {
    const p = ir.nodes.find((n) => n.id === t.id).position;
    return { ...t, sectionWidthM: t.widthM, position: { x: metres(p.x), y: metres(p.y), z: metres(p.z) } };
  });
  return { openings: chassis.props.tubOpenings, nodes: chassis.props.frameModel.nodes, tyres, body, tyreRecord: getComponent(tyres[0].component) };
}

describe("projection onto a box (exact)", () => {
  const tris = boxTris([0, -0.8, 0.2], [4, 0.8, 1.3]);
  it("along y: the outermost face on each side, normal facing out; a line off the box misses", () => {
    const idx = axisIndex(tris, 1);
    const l = projectAxis(idx, 2, 0.7, 1), r = projectAxis(idx, 2, 0.7, -1);
    assert.deepEqual(l.point.map((c) => +c.toFixed(9)), [2, 0.8, 0.7]);
    assert.deepEqual(r.point.map((c) => +c.toFixed(9)), [2, -0.8, 0.7]);
    assert.ok(l.normal[1] > 0.999 && r.normal[1] < -0.999);
    assert.equal(projectAxis(idx, 2, 1.5, 1), null, "above the roof");
    assert.equal(projectAxis(idx, 5, 0.7, 1), null, "behind the tail");
  });
  it("along x from ahead: the front face", () => {
    const h = projectAxis(axisIndex(tris, 0), 0.3, 0.5, -1);
    assert.deepEqual(h.point.map((c) => +c.toFixed(9)), [0, 0.3, 0.5]);
    assert.ok(h.normal[0] < -0.999);
  });
  it("along an oblique direction: the outermost point on the line, here the roof", () => {
    const n = [-0.5, 0, Math.sqrt(3) / 2]; // 30° from vertical, leaning forward
    const h = projectPoint(dirIndex(tris, n), [2, 0, 0.7], 1);
    // the line p + t·n leaves the box through the roof z = 1.3 at t = 0.6/(√3/2)
    const t = 0.6 / (Math.sqrt(3) / 2);
    assert.ok(Math.abs(h.point[2] - 1.3) < 1e-9 && Math.abs(h.point[0] - (2 - 0.5 * t)) < 1e-9, JSON.stringify(h.point));
    assert.ok(h.normal[2] > 0.999);
  });
  it("resample keeps every vertex and no step longer than asked", () => {
    const pts = resample([[0, 0], [1, 0], [1, 0.5]], 0.1, true);
    assert.deepEqual(pts[0], pts[pts.length - 1]);
    for (let i = 1; i < pts.length; i++) assert.ok(Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) <= 0.1 + 1e-12);
  });
  it("a door outline on the box side: every point on the face, lifted by the line offset; a part off the box is counted missed, not invented", () => {
    const solid = cadSkinSolid(tris);
    const ov = surfaceOverlays({
      panelCuts: [{ id: "door-front-L", side: "L", outline: [[1, 0.4], [2, 0.4], [2, 1.0], [1, 1.0]] }, { id: "door-off-R", side: "R", outline: [[3.8, 1.0], [4.4, 1.0], [4.4, 1.2], [3.8, 1.2]] }],
      glazing: [], lamps: { state: "not placed", reason: "test" }, wheelArches: { arches: [] },
    }, solid);
    const [on, off] = ov.panelLines;
    assert.equal(on.missed, 0);
    for (let i = 0; i < on.polylines[0].length; i += 3) assert.ok(Math.abs(on.polylines[0][i + 1] - (0.8 + OVERLAY_OFFSET.lineM)) < 1e-9);
    assert.ok(off.missed > 0 && off.missed < off.samples, `${off.missed}/${off.samples}`);
    assert.equal(ov.skinTrimmed, false);
    assert.deepEqual(ov.lampsState, { state: "not placed", reason: "test" });
  });
});

describe("design-surface overlays on the showcase solid", () => {
  const tris = readStlFile(SHOWCASE_STL);
  const solid = cadSkinSolid(tris);
  const ir = buildCarFromLibrary(BRIEF).ir;
  const ds = designSurface(specFromIr(ir));
  const t0 = Date.now();
  const ov = surfaceOverlays(ds.layers, solid, { conflicts: ds.conflicts });
  const ms = Date.now() - t0;

  it("draws every layer and leaves the solid untrimmed; under 1 % of points miss it", () => {
    assert.equal(ov.skinTrimmed, false);
    assert.equal(ov.onSolid, "cad.body");
    assert.deepEqual(ov.panelLines.map((l) => l.id).sort(), ["arch-TIRE_FL", "arch-TIRE_FR", "arch-TIRE_RL", "arch-TIRE_RR", "door-front-L", "door-front-R", "door-rear-L", "door-rear-R"]);
    assert.deepEqual(ov.glass.map((g) => g.id).sort(), ["backlight", "side-glass-front-L", "side-glass-front-R", "side-glass-rear-L", "side-glass-rear-R", "windscreen"]);
    assert.deepEqual(ov.lamps.map((l) => l.id).sort(), ["headlamp-L", "headlamp-R"]);
    assert.ok(ov.coverage.missed / ov.coverage.samples < 0.01, JSON.stringify(ov.coverage));
    assert.equal(ov.conflicts.length, ds.conflicts.length);
    assert.ok(ov.conflicts.every((c) => c.copied === false));
    assert.ok(ms < 5000, `${ms} ms`);
  });

  it("door cuts sit on the skin: just outside the solid, and 10 mm further in is inside it", () => {
    for (const l of ov.panelLines.filter((x) => x.kind === "door-cut")) {
      const sign = l.side === "L" ? 1 : -1;
      const run = l.polylines[0];
      for (let i = 0; i < run.length; i += 3 * 15) {
        const p = [run[i], run[i + 1], run[i + 2]];
        assert.equal(pointInSolid(solid, p), false, `${l.id} ${p} is outside`);
        assert.equal(pointInSolid(solid, [p[0], p[1] - sign * 0.01, p[2]]), true, `${l.id} ${p} is on the skin`);
      }
    }
  });

  it("windscreen glass is on the skin above the tub's windscreen quad", () => {
    const w = ov.glass.find((g) => g.id === "windscreen");
    assert.equal(w.missed, 0);
    const quad = ds.layers.glazing.find((g) => g.id === "windscreen").outlineXYZ;
    const quadTop = Math.max(...quad.map((p) => p[2]));
    for (let i = 0; i < w.positions.length; i += 3 * 40) {
      const p = w.positions.slice(i, i + 3);
      assert.equal(pointInSolid(solid, p), false, `${p} outside`);
      assert.ok(p[2] <= solid.bounds.max[2] + 0.01 && p[2] >= Math.min(...quad.map((q) => q[2])) - 0.01, `${p}`);
    }
    assert.ok(Math.max(...w.positions.filter((_, k) => k % 3 === 2)) > quadTop - 0.05, "reaches the header");
  });

  it("side glass stays above the solid's shoulder line, and that line is where the slice stops being widest", () => {
    for (const g of ov.glass.filter((x) => x.id.startsWith("side-glass"))) {
      assert.ok(g.positions.length > 0, g.id);
      for (let i = 0; i < g.positions.length; i += 3 * 25) {
        const [x, , z] = g.positions.slice(i, i + 3);
        const [st] = shoulderLine(solid, [x]);
        // the glass is projected along y, so its z is the sample's z; 5 mm covers the 20 mm shoulder sampling
        assert.ok(z >= st.z - 0.005, `${g.id} at x ${x}: z ${z} vs shoulder ${st.z}`);
      }
    }
    // on a box the widest band is the whole side, so the shoulder is the roof edge
    assert.equal(shoulderLine(cadSkinSolid(boxTris([0, -0.8, 0.2], [4, 0.8, 1.3])), [2])[0].z, 1.3);
  });

  it("lamps sit on the nose, inside the design-surface slot's height band", () => {
    const band = ds.layers.lamps.slots[0].bounds;
    for (const l of ov.lamps) {
      assert.equal(l.missed, 0);
      for (let i = 0; i < l.positions.length; i += 3) {
        const [x, , z] = l.positions.slice(i, i + 3);
        assert.ok(x < solid.bounds.min[0] + 0.3, `${l.id} x ${x} is on the nose`);
        assert.ok(z >= band.zLowM - 1e-6 && z <= band.zHighM + 1e-6, `${l.id} z ${z}`);
      }
    }
  });

  it("the assembly carries the overlays; loft-placed details are labelled as not on the solid", () => {
    const mesh = cadSkinMesh(tris);
    const cadSkin = { mesh, solid, sha256: "t", clearances: {}, skinOffset: 0.04 };
    const doc = assemblyFromIr(ir, { bodyBBox: { min: mesh.bounds.min, max: mesh.bounds.max }, cadSkin, designSurface: { layers: ds.layers, conflicts: ds.conflicts } });
    assert.equal(doc.surface.source, "cad.body");
    assert.equal(doc.surface.overlays.panelLines.length, 8);
    assert.ok(doc.verification.geometricOnly.some((x) => /design-surface overlays/.test(x)));
    const details = doc.components.filter((c) => ["lamp", "intake", "mirror", "handle"].includes(c.role));
    assert.ok(details.length > 0);
    for (const c of details) {
      assert.equal(c.placedOn, "styling-loft", c.id);
      assert.match(c.parameters[0].provenance.source, /not on the analysed solid/);
    }
    assert.equal(compactAssembly(doc).surface.overlays.panelLines.length, 8, "compact keeps the overlays");
    const loft = assemblyFromIr(ir, { designSurface: { layers: ds.layers, conflicts: ds.conflicts } });
    assert.equal(loft.surface.source, "styling");
    assert.equal(loft.surface.overlays, undefined, "no solid, no overlays");
    assert.ok(loft.components.every((c) => c.placedOn === undefined));
  });
});
