// The roof's peak sits over the front heads (2026-10-17).
//
// Cause found by instrumenting the OpenCascade body kernel (CONKAY_BODY_ROOF_DEBUG, cad/conkay_body_occ.py roof_debug):
// behind the front heads the roof was NOT held up by the occupants but by the structural tub's roof rails and bow. They were
// fixed at z 1.15 m at the B-hoop (x 3.30) and 1.06 m at the C-post (rear axle) whatever the car, so after the rear seat moved
// forward (#1299) the greenhouse apex stayed at ~1.29 m from x 3.2 to 3.4 (rail outer face + skin offset, lifted by the
// superellipse), 0.35 m behind the M95 head (1.184 m at x <= 3.09), and the rear slant was 14.15 deg.
// The rails are now derived: they crest over the front seat backs' top (the rail passes beside it and must clear it) and fall
// from there at roofFallDeg through the B-hoop to the C-post. The 2+2 only (rear heads lower than the front ones); a car whose
// rear occupants are as tall as the front ones keeps the earlier fixed rails.
// A passing test here is not a physical validation of the car.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildCarFromLibrary } from "../lib/conkay/compiler/car-from-library.js";
import { tubLandmarks, tubEnvelopeFit, derivedRoofRail, TUB_DESIGN_CHOICES } from "../lib/conkay/structural/car-tub.js";
import { kernelPythonPath, BODY_SCRIPT } from "../lib/conkay/cad/body-kernel.js";
import { openDesign } from "../lib/conkay/index.js";
import { bodyProfile } from "../lib/conkay/physics/solvers/aero-drag.js";
import { cachedStlTriangles } from "../lib/conkay/aero/stl-sections.js";
import { rearSlantDeg } from "../lib/conkay/aero/drag-buildup.js";

const BRIEF = "Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.";
const c = Object.fromEntries(Object.entries(TUB_DESIGN_CHOICES).map(([k, v]) => [k, v.value]));
const ev = buildCarFromLibrary(BRIEF, { config: { fuelType: "electric", motorId: "motor.cascadia.im-375-dz" }, cadBody: false });
const fe = buildCarFromLibrary(BRIEF, { config: { fuelType: "gasoline" }, cadBody: false, rearSeating: "full" });
const node = (b, id) => b.ir.nodes.find((n) => n.id === id);
const box = (b, id) => node(b, id).props.tubBox;
const topOf = (b, id) => { const x = box(b, id); return x.center[2] + x.half[2]; }; // the bow is level

describe("the roof rails follow the occupants (2+2)", () => {
  const L = tubLandmarks(ev.ir);
  const rf = derivedRoofRail(L, c, 3.3, L.rearAxle);

  it("the landmarks carry the front seat backs' top and the head planes", () => {
    for (const k of ["frontHeadTopZ", "rearHeadTopZ", "frontSeatBackTopX", "frontSeatBackTopZ"]) assert.ok(Number.isFinite(L[k]), k);
    assert.ok(L.rearHeadTopZ < L.frontHeadTopZ - 0.1, "the rear heads are well below the front ones");
  });

  it("the rail crests just over the seat back's top and falls at roofFallDeg to the B-hoop and the C-post", () => {
    assert.ok(rf, "derived for the 2+2");
    const k = Math.tan((c.roofFallDeg * Math.PI) / 180);
    assert.ok(Math.abs(rf.s[1] - (L.frontSeatBackTopZ + c.roofSection.height / 2 + c.roofRailSeatGapM)) < 1e-3);
    assert.ok(Math.abs(rf.b - (rf.s[1] - k * (3.3 - rf.s[0]))) < 1e-3);
    assert.ok(Math.abs(rf.c - (rf.s[1] - k * (L.rearAxle - rf.s[0]))) < 1e-3);
    assert.ok(rf.b < 1.15 && rf.c < 1.06, "lower than the earlier fixed 1.15 / 1.06 m rails");
  });

  it("the built tub has those rails: the bow and the rear rails stay under the front heads' top plane (the earlier 1.15 m bow's top face was above it)", () => {
    const bowTop = topOf(ev, "TUB_ROOF_BOW");
    assert.ok(bowTop < L.frontHeadTopZ, `bow top ${bowTop} < front head top ${L.frontHeadTopZ}`);
    assert.ok(Math.abs(box(ev, "TUB_ROOF_BOW").center[2] - rf.b) < 1e-3);
    // the old fixed bow: centre 1.15 + half section 0.035 = 1.185 > 1.1835 (the front heads' top): it, not the occupants, set the peak
    assert.ok(1.15 + c.roofSection.height / 2 > L.frontHeadTopZ);
    assert.ok(node(ev, "TUB_ROOF_RAIL_S_L") && node(ev, "TUB_ROOF_RAIL_S_R"), "crest-to-B-hoop rail members");
  });

  it("every rail still clears the seat backs, heads and egress lines (package.tub-fit's test, >= 0)", () => {
    const rows = tubEnvelopeFit(ev.ir);
    const rails = rows.filter((r) => /ROOF|C_POST|B_POST/.test(r.part));
    assert.ok(rails.length >= 8);
    for (const r of rails) assert.ok(r.minClearanceM >= 0, `${r.part} vs ${r.against}: ${r.minClearanceM}`);
    // the rail passes over the seat back's top with a real gap (the choice names 12 mm under the rail; the rail's tilt and the seat back's slope cost some)
    const rs = rows.find((r) => r.part === "TUB_ROOF_RAIL_L");
    assert.ok(rs.minClearanceM >= 0.003, `${rs.minClearanceM}`);
  });

  it("the crest follows the seat back's top (30 mm lower seat back, 30 mm lower crest)", () => {
    const low = derivedRoofRail({ ...L, frontSeatBackTopZ: L.frontSeatBackTopZ - 0.03 - c.roofRailSeatGapM }, c, 3.3, L.rearAxle);
    assert.ok(low.s[1] < rf.s[1] - 0.03);
  });
});

describe("a car whose rear occupants are as tall as the front ones keeps the earlier rails", () => {
  it("the front-engine car (rearSeating full) is not derived: B-hoop 1.15 m, C-post 1.06 m", () => {
    const L = tubLandmarks(fe.ir);
    assert.equal(derivedRoofRail(L, c, 3.3, L.rearAxle), null);
    assert.equal(box(fe, "TUB_ROOF_BOW").center[2], 1.15);
    assert.equal(node(fe, "TUB_ROOF_RAIL_S_L"), undefined);
  });
  it("no landmarks, no derivation", () => {
    assert.equal(derivedRoofRail(null, c, 3.3, 4), null);
    assert.equal(derivedRoofRail({ frontHeadTopZ: 1.18, rearHeadTopZ: 1.0 }, c, 3.3, 4), null);
  });
});

// The kernel's roof diagnostics: which envelope sets the greenhouse roof requirement at each station.
const HAVE_PY = fs.existsSync(kernelPythonPath());
describe("the body kernel names what sets the roof (CONKAY_BODY_ROOF_DEBUG)", { skip: !HAVE_PY && "no Python with OCP" }, () => {
  it("a tall head box and a lower rail box behind it: each station reports the source holding the roof up", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "roofdbg-"));
    const out = path.join(dir, "roof.json");
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const boxes = [
      { id: "FLOOR", center: [1.5, 0, 0.3], half: [1.6, 0.6, 0.1], axes, enclose: true },
      { id: "HEAD", center: [0.6, 0, 1.0], half: [0.15, 0.15, 0.2], axes, enclose: true },
      { id: "RAIL", center: [2.6, 0.5, 0.95], half: [0.2, 0.04, 0.04], axes, enclose: true },
    ];
    const py = `
import sys, json, os
sys.path.insert(0, ${JSON.stringify(path.dirname(BODY_SCRIPT))})
import conkay_body_occ as K
req = {"envelopes": json.loads(${JSON.stringify(JSON.stringify(boxes))}), "points": [], "wheels": [], "params": {**K.DEFAULTS}}
req["params"]["stationCount"] = 40
try:
    K.solve_sections(req, {})
except Exception as e:
    pass
`;
    const r = spawnSync(kernelPythonPath(), ["-c", py], { env: { ...process.env, CONKAY_BODY_ROOF_DEBUG: out }, encoding: "utf8" });
    assert.ok(fs.existsSync(out), r.stderr);
    const rows = JSON.parse(fs.readFileSync(out, "utf8"));
    const at = (x) => rows.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
    const h = at(0.6), rr = at(2.6);
    assert.equal(h.setBy, "HEAD");
    assert.equal(rr.setBy, "RAIL");
    for (const k of ["zt_req", "closed", "slopeLimited", "smoothed"]) assert.ok(Number.isFinite(h[k]), k);
    assert.ok(h.smoothed >= h.zt_req - 1e-6 && rr.smoothed >= rr.zt_req - 1e-6, "the finished roof bounds the requirement");
    assert.ok(h.solo[0][1] === "HEAD" && rr.solo[0][1] === "RAIL", "solo: each source's own apex, highest first");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// The finished solid (about a minute of kernel time; set CONKAY_CAD_BODY_FULL=1 with a kernel available).
describe("the finished roof peaks over the front heads (full kernel run)", { skip: !(process.env.CONKAY_CAD_BODY_FULL && HAVE_PY) && "set CONKAY_CAD_BODY_FULL=1 with a kernel available" }, () => {
  it("peak x <= 3.07 m (the front heads end at 3.09 m), rear slant <= 12.5 deg at 4.90 m, no failing check", async () => {
    const b = buildCarFromLibrary(BRIEF, { config: { fuelType: "electric", motorId: "motor.cascadia.im-375-dz" } });
    const s = openDesign(b.ir).session;
    await s.settle();
    const co = s.result("cad.body@BODY_SHELL").outputs;
    const top = bodyProfile(cachedStlTriangles(co.files.value.stl)).profile.map((p) => ({ x: p.x, z: p.top }));
    const pk = top.reduce((a, q) => (q.z > a.z ? q : a));
    assert.ok(pk.x <= 3.07, `peak at ${pk.x}`);
    assert.ok(rearSlantDeg(top) <= 12.5, `slant ${rearSlantDeg(top)}`);
    assert.ok(Math.abs(co.dimensions.value.lengthM - 4.9) < 1e-6);
    assert.notEqual(s.result("vehicle.acceptance@VEH").outputs.verdict.value, "not_physically_credible");
  });
});
