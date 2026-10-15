// server/tests/conkay-one-body.test.js
//
// One body: Studio draws the OpenCascade solid cad.body analysed (assembly/cad-skin.js), not its styled loft.
// Benchmarks are exact on a unit cube (a closed binary STL written here): 8 welded vertices, 12 triangles,
// ray-parity containment of interior / exterior / face-grazing points, the box test, and a slice at x = 0.5.
// Then the real showcase body STL and the assembly: the drawn surface, its stations, containment against the
// solid (kernel-enclosed, tub-fit, point-in-solid), storage volumes inside the solid, and compact/hydrate never
// swapping the solid for the styled loft.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readBinaryStl, readStlFile, cadSkinMesh, cadSkinSolid, pointInSolid, boxInSolid, cadStations } from "../lib/conkay/assembly/cad-skin.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { assemblyFromIr, compactAssembly, hydrateAssembly } from "../lib/conkay/assembly/build.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const SHOWCASE_STL = new URL("../lib/conkay/showcase/snapshots/car/body-2b42882b03f0.stl", import.meta.url).pathname;

/** Binary STL of the unit cube [0,1]^3, outward triangles. */
function cubeStl() {
  const v = (x, y, z) => [x, y, z];
  const quads = [
    [v(0, 0, 0), v(0, 1, 0), v(1, 1, 0), v(1, 0, 0)], [v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)],
    [v(0, 0, 0), v(1, 0, 0), v(1, 0, 1), v(0, 0, 1)], [v(0, 1, 0), v(0, 1, 1), v(1, 1, 1), v(1, 1, 0)],
    [v(0, 0, 0), v(0, 0, 1), v(0, 1, 1), v(0, 1, 0)], [v(1, 0, 0), v(1, 1, 0), v(1, 1, 1), v(1, 0, 1)],
  ];
  const tris = quads.flatMap(([a, b, c, d]) => [[a, b, c], [a, c, d]]);
  const buf = Buffer.alloc(84 + tris.length * 50);
  buf.write("cube", 0);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => t.forEach((p, k) => p.forEach((c, j) => buf.writeFloatLE(c, 84 + i * 50 + 12 + k * 12 + j * 4))));
  return buf;
}

describe("cad-skin on the unit cube", () => {
  const tris = readBinaryStl(cubeStl());
  const solid = cadSkinSolid(tris);
  it("reads 12 triangles and welds them to 8 vertices with unit outward normals", () => {
    assert.equal(tris.length, 12);
    const m = cadSkinMesh(tris);
    assert.equal(m.positions.length / 3, 8);
    assert.equal(m.triangles, 12);
    assert.deepEqual(m.bounds, { min: [0, 0, 0], max: [1, 1, 1] });
    for (let i = 0; i < m.normals.length; i += 3) {
      assert.ok(Math.abs(Math.hypot(m.normals[i], m.normals[i + 1], m.normals[i + 2]) - 1) < 1e-4);
      // a corner's area-weighted normal points away from the centre
      const out = (m.positions[i] - 0.5) * m.normals[i] + (m.positions[i + 1] - 0.5) * m.normals[i + 1] + (m.positions[i + 2] - 0.5) * m.normals[i + 2];
      assert.ok(out > 0);
    }
  });
  it("rejects an ASCII or truncated file instead of guessing", () => {
    assert.throws(() => readBinaryStl(Buffer.from("solid x\nendsolid x\n")), /binary STL/);
    assert.throws(() => readBinaryStl(cubeStl().subarray(0, 200)), /binary STL/);
  });
  it("ray parity: inside, outside, and points on the cube's diagonals and mid-planes", () => {
    for (const p of [[0.5, 0.5, 0.5], [0.01, 0.01, 0.01], [0.99, 0.5, 0.01], [0.5, 0.5, 0.999]]) assert.equal(pointInSolid(solid, p), true, `${p}`);
    for (const p of [[1.5, 0.5, 0.5], [-0.01, 0.5, 0.5], [0.5, 0.5, 1.01], [2, 2, 2]]) assert.equal(pointInSolid(solid, p), false, `${p}`);
  });
  it("box test: all 8 corners and the centre", () => {
    assert.equal(boxInSolid(solid, { x: 0.5, y: 0.5, z: 0.5 }, [0.4, 0.4, 0.4]), true);
    assert.equal(boxInSolid(solid, { x: 0.5, y: 0.5, z: 0.5 }, [0.6, 0.4, 0.4]), false);
    // yawed 45 deg: half-diagonal 0.4 × √2 = 0.566 > 0.5 in x and y
    assert.equal(boxInSolid(solid, { x: 0.5, y: 0.5, z: 0.5, yawDeg: 45 }, [0.4, 0.4, 0.1]), false);
    assert.equal(boxInSolid(solid, { x: 0.5, y: 0.5, z: 0.5, yawDeg: 45 }, [0.3, 0.3, 0.1]), true);
  });
  it("slice at x = 0.5: roof 1, floor 0, half width 1 (|y| of the far face)", () => {
    const [st] = cadStations(solid, [{ role: "mid", x: 0.5 }]);
    assert.equal(st.roofZ, 1);
    assert.equal(st.floorZ, 0);
    assert.equal(st.halfWidth, 1);
  });
});

describe("the showcase body solid", () => {
  const tris = readStlFile(SHOWCASE_STL);
  const solid = cadSkinSolid(tris);
  it("the cabin is inside; above the roof, off the side and the wheel well are outside", () => {
    assert.equal(pointInSolid(solid, [2.5, 0, 0.8]), true);
    assert.equal(pointInSolid(solid, [2.5, 0, 1.6]), false);
    assert.equal(pointInSolid(solid, [2.5, 1.2, 0.6]), false);
    assert.equal(pointInSolid(solid, [1.0, 0.8, 0.33]), false, "the front wheel well is cut");
  });
});

describe("Studio draws the analysed solid", () => {
  const b = buildCarFromLibrary(BRIEF);
  const tris = readStlFile(SHOWCASE_STL);
  const mesh = cadSkinMesh(tris);
  const bbox = { min: mesh.bounds.min, max: mesh.bounds.max };
  const tubIds = b.ir.nodes.filter((n) => n.props?.role === "tub").map((n) => n.id);
  // cad.body's clearance rows as the kernel names them: components by id, occupants as SEAT_n:KEY:part, seats as
  // SEAT_n:cushion@KEY / back@KEY (here each a passing 50 mm, the shape of a real run, not its values)
  const clearances = Object.fromEntries(["RADIATOR", "ENGINE", "TRANSMISSION", "DIFFERENTIAL", "FUEL_CELL", "STEERING_WHEEL"].map((id) => [id, 0.05]));
  for (const seat of ["SEAT_1", "SEAT_2", "SEAT_3", "SEAT_4"]) for (const key of ["F5", "F95", "M95"]) {
    for (const part of ["head", "torso", "pelvis"]) clearances[`${seat}:${key}:${part}`] = 0.05;
    clearances[`${seat}:cushion@${key}`] = 0.05; clearances[`${seat}:back@${key}`] = 0.05;
  }
  const cadSkin = { mesh, solid: cadSkinSolid(tris), sha256: "test", clearances, skinOffset: 0.04 };
  const doc = assemblyFromIr(b.ir, { bodyBBox: bbox, cadSkin, verifiedInside: new Set(tubIds) });

  it("the surface is the solid; the styled loft is kept only as a styling reference", () => {
    assert.equal(doc.surface.source, "cad.body");
    assert.equal(doc.surface.mesh.positions.length, mesh.positions.length);
    assert.deepEqual(doc.surface.mesh.glass, []);
    assert.ok(doc.surface.styling.stations.length >= 16);
    assert.match(doc.verification.statement, /The body drawn is the OpenCascade solid/);
    assert.equal(doc.verification.geometricOnly.includes("viewer body loft"), false);
  });
  it("the packaging sheet's stations are slices of the solid at the styling stations' x", () => {
    const st = doc.surface.mesh.stations;
    assert.equal(st.length, doc.surface.styling.stations.length);
    const mid = st.find((s) => s.role === "b-pillar");
    const [direct] = cadStations(cadSkin.solid, [{ role: "b-pillar", x: mid.x }]);
    assert.deepEqual(mid, direct);
  });
  it("containment is decided on the solid: kernel rows, tub-fit, then point-in-solid; a kernel row short of the skin offset fails", () => {
    const c = doc.checks.find((x) => x.id === "containment");
    assert.equal(c.status, "pass", c.detail);
    assert.match(c.detail, /inside the analysed body \(cad\.body solid\)/);
    assert.ok(c.proof.kernel > 0 && c.proof.tubFit === tubIds.filter((id) => doc.components.some((x) => x.id === id)).length && c.proof.solid > 0, JSON.stringify(c.proof));
    // without the kernel's rows an occupant falls to the box test, and Studio's manikin box (it hangs below the
    // floor by design) is not inside the solid: the kernel's enclosure is what proves the occupant fits
    const noRows = assemblyFromIr(b.ir, { bodyBBox: bbox, cadSkin: { ...cadSkin, clearances: {} }, verifiedInside: new Set(tubIds) });
    assert.ok(noRows.checks.find((x) => x.id === "containment").outside.some((id) => /^OCC_/.test(id)));
    const short = assemblyFromIr(b.ir, { bodyBBox: bbox, cadSkin: { ...cadSkin, clearances: { ...clearances, ENGINE: 0.01 } }, verifiedInside: new Set(tubIds) });
    const s = short.checks.find((x) => x.id === "containment");
    assert.equal(s.status, "fail");
    assert.ok(s.outside.includes("ENGINE"), JSON.stringify(s.outside));
  });
  it("storage volumes are boxes inside the solid, clear of the powertrain and the tub, or none is claimed", () => {
    for (const id of ["TRUNK", "FRUNK"]) {
      const t = doc.components.find((c) => c.id === id);
      const v = t.parameters[0].value;
      if (v > 0) assert.equal(boxInSolid(cadSkin.solid, t.placement, t.half), true, id);
      else assert.ok(t.half.every((h) => h === 0), `${id}: no volume, no box`);
      assert.match(t.parameters[0].provenance?.source || JSON.stringify(t.parameters[0]), /boxInSolid/);
    }
  });
  it("compact keeps the solid's reference; hydrate rebuilds from the STL, never from the styled loft", () => {
    const compact = compactAssembly(doc);
    assert.equal(compact.surface.source, "cad.body");
    assert.equal(compact.surface.mesh.positions, undefined);
    const noFile = hydrateAssembly(compact);
    assert.equal(noFile.surface.mesh.positions, undefined, "no STL: the body stays undrawn");
    assert.match(noFile.surface.mesh.generated, /not available/);
    const back = hydrateAssembly(compact, { readStl: (sha) => (sha === "test" ? tris : null) });
    assert.equal(back.surface.source, "cad.body");
    assert.equal(back.surface.mesh.positions.length, mesh.positions.length);
  });
  it("without a CAD solid the styled loft is drawn and labelled as such", () => {
    const loft = assemblyFromIr(b.ir);
    assert.equal(loft.surface.source, "styling");
  });
});
