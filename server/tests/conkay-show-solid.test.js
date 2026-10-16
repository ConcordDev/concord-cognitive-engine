// Visual polish (c): apertures cut into a show copy of the analysed body, with
// the re-checks. Exact benchmarks on an OpenCascade box (kernel-gated): a
// pane over a rectangle is area × depth, a door groove is the offset band's
// area × depth, volume is conserved, and an inner envelope's clearance is its
// known distance (less the groove depth where a groove passes over it). Then
// the aperture builder on the showcase solid (no kernel) and the solver's
// opt-in.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { kernelPythonPath } from "../lib/conkay/cad/body-kernel.js";
import { runPythonKernel } from "../lib/conkay/cad/kernel-queue.js";
import { SHOW_SCRIPT, SHOW_CHOICES, showApertures, sideGlassOutline } from "../lib/conkay/cad/show-solid.js";
import { readStlFile, cadSkinSolid } from "../lib/conkay/assembly/cad-skin.js";
import { shoulderLine } from "../lib/conkay/assembly/surface-overlays.js";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { designSurface, metres } from "../lib/conkay/cad/design-surface.js";
import { getComponent } from "../lib/conkay/components/index.js";
import "../lib/conkay/index.js";
import { getSolver } from "../lib/conkay/physics/registry.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const SHOWCASE_STL = new URL("../lib/conkay/showcase/snapshots/car/body-2b42882b03f0.stl", import.meta.url).pathname;
const HAVE_KERNEL = fs.existsSync(kernelPythonPath());

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

describe("show solid on an OpenCascade box (exact)", { skip: !HAVE_KERNEL && "no Python with OCP" }, () => {
  // box x 0..4, y -0.8..0.8, z 0.2..1.3
  let out, dir;
  const depth = 0.005, gapW = 0.004, gapD = 0.01;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "conkay-show-test-"));
    const step = path.join(dir, "box.step");
    const mk = spawnSync(kernelPythonPath(), ["-c", [
      "import sys",
      "from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox",
      "from OCP.gp import gp_Pnt",
      "from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs",
      "s = BRepPrimAPI_MakeBox(gp_Pnt(0, -0.8, 0.2), gp_Pnt(4, 0.8, 1.3)).Shape()",
      "w = STEPControl_Writer(); w.Transfer(s, STEPControl_AsIs); w.Write(sys.argv[1])",
    ].join("\n"), step], { encoding: "utf8" });
    assert.equal(mk.status, 0, mk.stderr);
    out = await runPythonKernel({
      python: kernelPythonPath(), script: SHOW_SCRIPT, timeoutMs: 600000,
      input: {
        command: "show", step,
        apertures: [
          // side glass L: 1.0 m × 0.25 m on the +y face
          { id: "glass-L", kind: "glazing", outline3d: [[2, 0, 0.75], [3, 0, 0.75], [3, 0, 1.0], [2, 0, 1.0]], dir: [0, 1, 0], lengthM: 3, depthM: depth },
          // a lamp on the front face x = 0: 0.2 m × 0.05 m
          { id: "lamp", kind: "lamp", outline3d: [[0.5, 0.3, 0.4], [0.5, 0.5, 0.4], [0.5, 0.5, 0.45], [0.5, 0.3, 0.45]], dir: [-1, 0, 0], lengthM: 1, depthM: depth },
          // a door gap on the −y face around a 1.0 × 0.5 m door
          { id: "gap-R", kind: "door-gap", outline3d: [[1, 0, 0.4], [2, 0, 0.4], [2, 0, 0.9], [1, 0, 0.9]], dir: [0, -1, 0], lengthM: 3, depthM: gapD, gapWidthM: gapW },
        ],
        envelopes: [
          // 0.1 m inside the −y face, under the door gap: the groove takes gapD of that
          { id: "UNDER_GAP", kind: "component", center: [1.5, -0.65, 0.65], half: [0.6, 0.05, 0.3], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], enclose: true, offsetM: 0.04 },
          // 0.2 m inside the +y face, under the glass (refilled: unchanged)
          { id: "UNDER_GLASS", kind: "component", center: [2.5, 0.55, 0.85], half: [0.4, 0.05, 0.1], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], enclose: true, offsetM: 0.04 },
        ],
        points: [{ id: "inside", p: [2, 0, 0.7] }],
        rays: [{ id: "up", origin: [2, 0, 0.7], dir: [0, 0, 1] }, { id: "side", origin: [2.5, 0, 0.85], dir: [0, 1, 0] }],
        params: { meshLinear: 0.004, meshAngular: 0.25 },
        frontalSlices: 120,
        outDir: dir,
      },
    });
    assert.equal(out.ok, true, out.error);
  });

  it("each pane is area × depth, the groove is the offset band's area × depth, and volume is conserved", () => {
    const v = Object.fromEntries(out.apertures.map((a) => [a.id, a.volumeM3]));
    assert.ok(Math.abs(v["glass-L"] - 1.0 * 0.25 * depth) < 1e-9, `${v["glass-L"]}`);
    assert.ok(Math.abs(v.lamp - 0.2 * 0.05 * depth) < 1e-9, `${v.lamp}`);
    // sharp-cornered offsets of a 1.0 × 0.5 rectangle by ±w/2: (1+w)(0.5+w) − (1−w)(0.5−w) = 3w
    assert.ok(Math.abs(v["gap-R"] - 3 * gapW * gapD) < 1e-9, `${v["gap-R"]} vs ${3 * gapW * gapD}`);
    const box = 4 * 1.6 * 1.1;
    assert.ok(Math.abs(out.volumes.bodyM3 - box) < 1e-9);
    assert.ok(Math.abs(out.volumes.conservationM3) < 1e-9, `${out.volumes.conservationM3}`);
    assert.ok(Math.abs(out.volumes.reassembledM3 - (box - 3 * gapW * gapD)) < 1e-9, "show ∪ panes = body − grooves");
    assert.equal(out.show.valid, true);
    assert.equal(out.reassembled.valid, true);
  });

  it("re-measures clearances on the reassembled body: the groove takes its depth, the refilled glass takes nothing", () => {
    const cl = Object.fromEntries(out.clearances.map((c) => [c.id, c.clearanceM]));
    assert.ok(Math.abs(cl.UNDER_GLASS - 0.2) < 1e-6, `${cl.UNDER_GLASS}`);
    assert.ok(Math.abs(cl.UNDER_GAP - (0.1 - gapD)) < 1e-6, `${cl.UNDER_GAP}`);
    assert.deepEqual(out.points, [{ id: "inside", inside: true }]);
  });

  it("rays meet the same surface, and the one through the side glass names the pane", () => {
    const rays = Object.fromEntries(out.rays.map((r) => [r.id, r.distanceM]));
    assert.ok(Math.abs(rays.up - 0.6) < 1e-6);
    assert.ok(Math.abs(rays.side - 0.8) < 1e-6);
    assert.equal(out.rayFirstGlass.side, "glass-L");
    assert.equal(out.rayFirstGlass.up, null);
  });

  it("writes the show solid and the panes", () => {
    assert.ok(fs.existsSync(out.files.show.step.path) && fs.existsSync(out.files.show.stl.path));
    assert.ok(fs.existsSync(out.files.panes.stl.path));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("apertures on the showcase solid (no kernel)", () => {
  const solid = cadSkinSolid(readStlFile(SHOWCASE_STL));
  const ds = designSurface(specFromIr(buildCarFromLibrary(BRIEF).ir));
  const { apertures, skipped } = showApertures(ds.layers, solid);

  it("one aperture per glass piece, lamp slot and door, every size a labelled design choice", () => {
    assert.deepEqual(apertures.map((a) => a.id).sort(), [
      "backlight", "gap-door-front-L", "gap-door-front-R", "gap-door-rear-L", "gap-door-rear-R",
      "headlamp-L", "headlamp-R", "side-glass-front-L", "side-glass-front-R", "side-glass-rear-L", "side-glass-rear-R", "windscreen",
    ]);
    assert.deepEqual(skipped, []);
    for (const k of Object.keys(SHOW_CHOICES)) assert.match(SHOW_CHOICES[k].basis, /design choice/);
    for (const a of apertures) {
      assert.ok(Math.abs(Math.hypot(...a.dir) - 1) < 1e-3, a.id);
      assert.ok(a.outline3d.length >= 4, a.id);
    }
  });

  it("windscreen and backlight prisms are planar and point outward (away from the cabin)", () => {
    for (const id of ["windscreen", "backlight"]) {
      const a = apertures.find((x) => x.id === id);
      const p0 = a.outline3d[0];
      for (const p of a.outline3d) {
        const d = (p[0] - p0[0]) * a.dir[0] + (p[1] - p0[1]) * a.dir[1] + (p[2] - p0[2]) * a.dir[2];
        assert.ok(Math.abs(d) < 1e-3, `${id} is planar`);
      }
      assert.ok(a.dir[2] > 0.3, `${id} faces up and out: ${a.dir}`);
    }
  });

  it("side glass is above the solid's shoulder at every column and inside its door aperture", () => {
    for (const g of ds.layers.glazing.filter((x) => x.inDoor)) {
      const o = sideGlassOutline(g.outline, solid);
      assert.ok(o && o.length >= 4, g.id);
      const half = o.length / 2;
      for (let i = 0; i < half; i++) {
        const [x, zLo] = o[i];
        const [sh] = shoulderLine(solid, [x]);
        assert.ok(zLo >= sh.z - 0.005, `${g.id} x ${x}: ${zLo} vs ${sh.z}`);
      }
      const xs = g.outline.map((p) => p[0]);
      assert.ok(o.every(([x]) => x >= Math.min(...xs) - 1e-6 && x <= Math.max(...xs) + 1e-6));
    }
  });
});

describe("cad.show-solid is opt-in", () => {
  it("targets a vehicle only when props.vehicle.showSolid is true", () => {
    const ir = buildCarFromLibrary(BRIEF).ir;
    const graph = { nodes: new Map(ir.nodes.map((n) => [n.id, n])) };
    const solver = getSolver("cad.show-solid");
    assert.deepEqual(solver.targets(graph), []);
    ir.nodes.find((n) => n.id === "VEH").props.vehicle.showSolid = true;
    assert.deepEqual(solver.targets(graph), ["VEH"]);
  });
});
