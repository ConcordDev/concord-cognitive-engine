// server/tests/conkay-chat-student.test.js
//
// Class problems from chat (conversational-loop item 6). The expected values are derived by hand in this file,
// from the textbook methods cited, so the solvers are checked against an independent calculation, not against
// their own output:
//   - cantilever: σ = M c / I with M = P L, I = b h³ / 12, c = h / 2; δ = P L³ / (3 E I)
//     (R. C. Hibbeler, Mechanics of Materials, flexure formula; deflection by integration, cantilever end load);
//   - simply supported beam, midspan point + UDL: M_max = P L / 4 + w L² / 8, δ = P L³ / (48 E I) + 5 w L⁴ / (384 E I)
//     (J. M. Gere & B. J. Goodno, Mechanics of Materials, beam deflection tables, superposition);
//   - trusses: the method of joints and the method of sections (Hibbeler, Engineering Mechanics: Statics, ch. 6).
// The sizing steps up ISO 3 R10 preferred numbers. Every session closes in at most five turns.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChatSession } from "../lib/conkay/chat/session.js";
import { solveTruss, trussGeometry } from "../lib/conkay/structural/truss2d.js";
import { r10Between, FE_TOLERANCE } from "../lib/conkay/chat/structures.js";

const near = (a, b, rel = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= rel * Math.abs(b) + 1e-12, `${msg} ${a} vs ${b}`);
const play = (turns) => { const s = new ChatSession(); let r; for (const t of turns) r = s.ask(t); return r; };
const force = (r, id) => r.answer.forces.find((f) => f.id === id).N;

describe("a cantilever bracket for 500 N (three turns)", () => {
  const turns = ["Design a cantilever bracket for 500 N", "200 mm long, 40 mm wide", "steel"];
  it("asks for the arm length and width, then the material; sizes the depth; σ and δ match the hand calculation", () => {
    const s = new ChatSession();
    assert.deepEqual(s.ask(turns[0]).questions.map((q) => q.field), ["length", "width"]);
    assert.deepEqual(s.ask(turns[1]).questions.map((q) => q.field), ["material", "safetyFactor"]);
    const r = s.ask(turns[2]);
    assert.equal(r.kind, "answer");
    assert.ok(r.turn <= 5);
    const a = r.answer;
    // A36: F_y 250 MPa; AISC Ω = 1.67 (cited default) -> allowable 149.70 MPa
    const P = 500, L = 0.2, b = 0.04, E = 200e9, allow = 250e6 / 1.67;
    const sigma = (h) => (6 * P * L) / (b * h * h); // M c / I with M = P L, I = b h³/12, c = h/2
    // the R10 depths: 10 mm gives 150 MPa (over 149.70), 12.5 mm gives 96 MPa: the first that holds
    assert.ok(sigma(0.01) > allow && sigma(0.0125) <= allow);
    assert.equal(a.depthM, 0.0125);
    near(a.hand.sigmaPa, 96e6, 1e-9, "σ");
    const I = (b * 0.0125 ** 3) / 12;
    near(a.hand.deltaM, (P * L ** 3) / (3 * E * I), 1e-9, "δ");
    near(a.hand.deltaM, 1.024e-3, 1e-9, "δ = 1.024 mm");
    // the frame FE agrees within the declared tolerance
    assert.equal(a.fe.agrees.sigma, true);
    assert.equal(a.fe.agrees.delta, true);
    assert.ok(Math.abs(a.fe.sigma - 96e6) <= FE_TOLERANCE * 96e6);
    // the steps show the substituted numbers
    assert.ok(a.steps.some((t) => /σ = M c \/ I = 100 N·m × 0\.00625 m \/ 6\.51e-9 m⁴ = 96 MPa/.test(t)), a.steps.join("\n"));
    assert.ok(a.steps.some((t) => /δ = P L³ \/ \(3 E I\) = .* = 1\.024 mm/.test(t)));
    assert.match(a.depthSource, /ISO 3/);
  });
  it("aluminium has no cited safety factor: it is asked, then used", () => {
    const s = new ChatSession();
    s.ask(turns[0]);
    assert.deepEqual(s.ask("200 mm long, 40 mm wide, 6061 aluminium").questions.map((q) => q.field), ["safetyFactor"]);
    const r = s.ask("safety factor 2");
    near(r.answer.hand.allowablePa, 276e6 / 2, 1e-12, "F_y / SF");
    assert.equal(r.answer.depthM, 0.0125); // 10 mm: 150 MPa > 138 MPa; 12.5 mm: 96 MPa
  });
  it("the R10 series between 1 mm and 20 mm", () => {
    assert.deepEqual(r10Between(0.001, 0.02).map((v) => +(v * 1000).toFixed(2)), [1, 1.25, 1.6, 2, 2.5, 3.15, 4, 5, 6.3, 8, 10, 12.5, 16, 20]);
  });
});

describe("a simply supported beam, point load + UDL (two turns)", () => {
  it("statics on the first turn; with a width, the depth is sized and σ, δ match the superposition formulas", () => {
    const s = new ChatSession();
    const first = s.ask("a 6 m simply supported steel beam with 10 kN at midspan and 2 kN/m");
    assert.equal(first.kind, "answer");
    const P = 10000, w = 2000, L = 6;
    assert.deepEqual(first.answer.reactions, { RA: P / 2 + (w * L) / 2, RB: P / 2 + (w * L) / 2 });
    near(first.answer.maxMoment.value, (P * L) / 4 + (w * L * L) / 8, 1e-12, "M_max = PL/4 + wL²/8");
    assert.equal(first.answer.maxMoment.atM, 3);
    assert.ok(first.followUps.some((x) => /width/.test(x)));
    const r = s.ask("100 mm wide");
    assert.ok(r.turn <= 5);
    const a = r.answer;
    const b = 0.1, E = 200e9, allow = 250e6 / 1.67, M = 24000;
    const sigma = (h) => (M * (h / 2)) / ((b * h ** 3) / 12);
    // R10 depths: 80 mm -> 225 MPa, 100 mm -> 144 MPa (the first under 149.70)
    assert.ok(sigma(0.08) > allow && sigma(0.1) <= allow);
    assert.equal(a.section.depthM, 0.1);
    const I = (b * 0.1 ** 3) / 12;
    near(a.hand.sigmaPa, 144e6, 1e-9, "σ");
    near(a.hand.deltaM, (P * L ** 3) / (48 * E * I) + (5 * w * L ** 4) / (384 * E * I), 1e-9, "δ");
    near(a.hand.deltaM, 0.04725, 1e-9, "δ = 47.25 mm");
    assert.deepEqual(a.fe.agrees, { sigma: true, delta: true });
  });
  it("a point load off midspan: the reactions by moments", () => {
    const r = play(["a 5 m simply supported steel beam with 8 kN at 2 m from the left"]);
    // R_A = P (L - a) / L = 8000 × 3 / 5 = 4800 N; R_B = 3200 N; M_max = R_A a = 9600 N·m at 2 m
    assert.deepEqual(r.answer.reactions, { RA: 4800, RB: 3200 });
    assert.deepEqual(r.answer.maxMoment, { value: 9600, atM: 2 });
  });
});

describe("trusses (method of joints / sections, by hand)", () => {
  it("a 4-panel Pratt, 12 m by 3 m, 10 kN at each top joint (three turns)", () => {
    const s = new ChatSession();
    assert.deepEqual(s.ask("a Pratt truss").questions.map((q) => q.field), ["loads", "span", "height"]);
    s.ask("4 panels, 12 m span, 3 m tall");
    const r = s.ask("10 kN at each top joint");
    assert.ok(r.turn <= 5);
    // reactions: 30 kN / 2 = 15 kN each
    assert.deepEqual(r.answer.reactions.map((x) => [x.joint, +x.Ry.toFixed(6)]), [["L0", 15000], ["L4", 15000]]);
    // joint L0: F_post sin 45° + 15 = 0 -> -21.213 kN (C); F_L0L1 + F_post cos 45° = 0 -> 15 kN (T)
    near(force(r, "L0-U1"), -15000 / Math.sin(Math.PI / 4), 1e-9, "end post");
    near(force(r, "L0-L1"), 15000, 1e-9);
    // section through panel 2, moments about L2: F_top × 3 = -(15 × 6 - 10 × 3) -> -20 kN (C)
    near(force(r, "U1-U2"), -20000, 1e-9);
    // shear in panel 2: 15 - 10 = 5 kN = F_diag sin 45° -> 7.071 kN (T, the Pratt diagonal)
    near(force(r, "U1-L2"), 5000 / Math.sin(Math.PI / 4), 1e-9);
    // joint L1 (no load): the vertical carries nothing; joint U2: the vertical carries the 10 kN (C)
    near(force(r, "L1-U1"), 0, 1, "zero-force member");
    near(force(r, "L2-U2"), -10000, 1e-9);
    assert.match(r.answer.note, /statically determinate/);
  });
  it("a 3-panel Warren, 9 m by 2 m, 6 kN at each top joint (one turn)", () => {
    const r = play(["a Warren truss with 3 panels spanning 9 m, 2 m tall, 6 kN at each top joint"]);
    // diagonal geometry: 1.5 m across, 2 m up: sin 0.8, cos 0.6; reactions 9 kN
    near(force(r, "L0-U0"), -9000 / 0.8, 1e-9, "end diagonal -11.25 kN");
    near(force(r, "L0-L1"), 11250 * 0.6, 1e-9, "6.75 kN");
    // moments about L1 (x = 3): F_top × 2 = -(9 × 3 - 6 × 1.5) -> -9 kN
    near(force(r, "U0-U1"), -9000, 1e-9);
    // moments about U1 (x = 4.5, y = 2): F_bottom × 2 = 9 × 4.5 - 6 × 3 -> 11.25 kN
    near(force(r, "L1-L2"), 11250, 1e-9);
    // shear in panel 2: 9 - 6 = 3 kN -> |F_diag| = 3 / 0.8 = 3.75 kN
    near(Math.abs(force(r, "U0-L1")), 3750, 1e-9);
  });
});

describe("the truss solver refuses what it cannot answer", () => {
  const tri = { joints: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 2, y: 0 }, { id: "C", x: 0, y: 2 }], supports: [{ joint: "A", fix: ["x", "y"] }, { joint: "B", fix: ["y"] }] };
  it("a three-bar triangle: the method of joints", () => {
    const r = solveTruss({ ...tri, bars: [{ id: "AB", i: "A", j: "B", EA: 1e8 }, { id: "AC", i: "A", j: "C", EA: 1e8 }, { id: "BC", i: "B", j: "C", EA: 1e8 }], loads: [{ joint: "C", Fx: 1000, Fy: 0 }] });
    // joint C (tension positive, pulling the joint toward the bar's other end): ΣFx: 1000 + F_BC / √2 = 0 -> F_BC = -1414.2 N (C);
    // ΣFy: -F_AC - F_BC / √2 = 0 -> F_AC = 1000 N (T); joint B: ΣFx: -F_AB - F_BC / √2 = 0 -> F_AB = 1000 N (T)
    near(r.forces.find((f) => f.id === "BC").N, -1000 * Math.SQRT2, 1e-9, "BC");
    near(r.forces.find((f) => f.id === "AC").N, 1000, 1e-9, "AC");
    near(r.forces.find((f) => f.id === "AB").N, 1000, 1e-9, "AB");
  });
  it("a mechanism, a bad EA, an unknown joint, a bad geometry", () => {
    // without BC, C hangs on the one vertical bar AC: free to move across it, a mechanism
    const m = solveTruss({ ...tri, bars: [{ id: "AB", i: "A", j: "B", EA: 1e8 }, { id: "AC", i: "A", j: "C", EA: 1e8 }], loads: [{ joint: "C", Fx: 1000 }] });
    assert.equal(m.ok, false);
    assert.match(m.errors[0], /mechanism: no stiffness at joint C in x/);
    const mech = solveTruss({ joints: tri.joints, supports: [{ joint: "A", fix: ["x", "y"] }], bars: [{ id: "AB", i: "A", j: "B", EA: 1e8 }, { id: "AC", i: "A", j: "C", EA: 1e8 }, { id: "BC", i: "B", j: "C", EA: 1e8 }], loads: [] });
    assert.equal(mech.ok, false);
    assert.equal(mech.mechanism, true);
    assert.equal(solveTruss({ ...tri, bars: [{ id: "AB", i: "A", j: "B", EA: 0 }] }).ok, false);
    assert.equal(solveTruss({ ...tri, bars: [{ id: "AX", i: "A", j: "X", EA: 1 }] }).ok, false);
    assert.equal(trussGeometry({ type: "pratt", panels: 3, span: 9, height: 3 }).ok, false, "odd Pratt panels");
    assert.equal(trussGeometry({ type: "k-truss", panels: 4, span: 9, height: 3 }).ok, false);
  });
  it("indeterminate: says so; a large displacement is flagged, never passed", () => {
    const four = { joints: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 2, y: 0 }, { id: "C", x: 2, y: 2 }, { id: "D", x: 0, y: 2 }], supports: [{ joint: "A", fix: ["x", "y"] }, { joint: "B", fix: ["y"] }] };
    const bars = [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"], ["A", "C"], ["B", "D"]].map(([i, j]) => ({ id: `${i}${j}`, i, j, EA: 1e8 }));
    const r = solveTruss({ ...four, bars, loads: [{ joint: "C", Fx: 1000 }] });
    assert.equal(r.determinacy.staticallyDeterminate, false);
    assert.equal(r.determinacy.degree, 1);
    const soft = solveTruss({ ...four, bars: bars.map((b) => ({ ...b, EA: 1e3 })), loads: [{ joint: "C", Fx: 1000 }] });
    assert.ok(soft.flags.some((f) => /small-displacement theory is not a model/.test(f)));
  });
});
