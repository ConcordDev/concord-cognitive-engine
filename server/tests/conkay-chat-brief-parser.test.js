// server/tests/conkay-chat-brief-parser.test.js
//
// Golden tests for the chat brief parser (lib/conkay/chat/brief-parser.js): text -> Design IR, claims with
// provenance, clarifying questions (deterministic policy, at most 3, ordered by checks unblocked), cited defaults
// only, unit-aware reading (unknown or ambiguous unit = error), and the optional language-model mapping that may
// only point words at fields.
// Unit factors: lbf 4.4482216152605 N (exact by definition of the pound and gn); lb 0.45359237 kg; mph 0.44704 m/s;
// standard gravity 9.80665 m/s² (3rd CGPM, 1901).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseChatBrief, detectDomain } from "../lib/conkay/chat/brief-parser.js";
import { scanQuantities } from "../lib/conkay/chat/quantities.js";
import { STATUS, MAX_QUESTIONS, FIELDS } from "../lib/conkay/chat/question-policy.js";
import { parseDesignIntent, DEFAULT_LOAD_N } from "../lib/conkay/nlp-design-intent.js";

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const C = (r, field) => r.claims.find((c) => c.field === field);
const Q = (r) => r.questions.map((q) => q.field);

describe("policy invariants (every prompt)", () => {
  const prompts = [
    "Design a car", "a four-seat electric car that holds 180 mph", "cantilever bracket for 500 N", "a beam", "a Warren truss",
    "steel bracket 150 mm long carrying 50 lbf at the tip", "6 m simply supported steel beam, 10 kN at midspan", "design the knee actuator bracket for M1 at the gait-cycle peak torque",
  ];
  for (const p of prompts) {
    it(`"${p}": at most ${MAX_QUESTIONS} questions, every default cited, every input traced to the text, unknowns valueless`, () => {
      const r = parseChatBrief(p);
      assert.equal(r.ok, true);
      assert.ok(r.questions.length <= MAX_QUESTIONS);
      for (const c of r.claims) {
        if (c.status === STATUS.DEFAULT) assert.ok(typeof c.source === "string" && c.source.length > 20, `${c.field}: a default needs a cited source`);
        if (c.status === STATUS.INPUT) assert.ok(/"/.test(c.source), `${c.field}: a design input quotes the user's words`);
        if (c.status === STATUS.UNKNOWN) assert.equal(c.value, null);
      }
      // ordered by checks unblocked
      for (let i = 1; i < r.questions.length; i++) assert.ok(r.questions[i - 1].unblocks.length >= r.questions[i].unblocks.length);
      // no question for a field that has a value
      for (const q of r.questions) assert.equal(C(r, q.field).status, STATUS.UNKNOWN);
    });
  }
});

describe("cars", () => {
  it("'a car' asks for the top speed, the seats and the powertrain; nothing is assumed", () => {
    const r = parseChatBrief("Design a car");
    assert.equal(r.domain, "car");
    assert.deepEqual(Q(r), ["topSpeed", "seats", "fuelType"]);
    assert.deepEqual(r.assumptions, []);
    assert.equal(r.ir.brief, null);
    assert.deepEqual(r.unknowns.map((u) => u.field).sort(), ["budget", "mass", "range"]);
  });
  it("the orchestrator's prompt: four seats (a number word), electric, 180 mph -> 80.4672 m/s, no questions", () => {
    const r = parseChatBrief("Design a four-seat electric car that holds 180 mph");
    near(r.ir.requirements.topSpeedMs, 180 * 0.44704);
    assert.equal(r.ir.requirements.seats, 4);
    assert.deepEqual(r.ir.config, { fuelType: "electric" });
    assert.deepEqual(Q(r), []);
    assert.equal(r.ir.brief, "Design a car that can go 180 mph, seats 4 people.");
  });
  it("the showcase brief: 2,500 lb -> 1133.98 kg mass limit; asks only the powertrain", () => {
    const r = parseChatBrief("Design a car that weighs 2,500 lb, can go 180 mph, seats 4 people, and has a futuristic aerodynamic look.");
    near(r.ir.requirements.massMaxKg, 2500 * 0.45359237);
    assert.deepEqual(Q(r), ["fuelType"]);
  });
  it("km/h, range in miles, a budget and a gasoline V8", () => {
    const r = parseChatBrief("a gasoline V8 sedan for 5 people, 250 km/h, 300 miles of range, under $60k");
    near(r.ir.requirements.topSpeedMs, 250 / 3.6);
    near(r.ir.requirements.rangeM, 300 * 1609.344);
    assert.equal(r.ir.requirements.budgetUsd, 60000);
    assert.equal(r.ir.requirements.seats, 5);
    assert.equal(r.ir.config.fuelType, "gasoline");
  });
  it("an ambiguous 'ton' is an error, not a guess", () => {
    const r = parseChatBrief("a car that weighs 2 tons");
    assert.equal(r.ok, false);
    assert.match(r.errors[0].error, /ambiguous unit "tons"/);
  });
});

describe("brackets", () => {
  it("'cantilever bracket for 500 N': 500 N is a design input; the arm length is asked, not defaulted", () => {
    const r = parseChatBrief("cantilever bracket for 500 N");
    assert.equal(r.domain, "bracket");
    assert.equal(C(r, "load").value, 500);
    assert.equal(C(r, "load").status, STATUS.INPUT);
    // the arm length and the plate width define the section to size (item 6); both are asked
    assert.deepEqual(Q(r), ["length", "width"]);
    assert.equal(r.ir.lengthM, null);
    assert.equal(r.ir.loadAt, "tip");
    assert.match(C(r, "load").note, /checked at the tip/);
  });
  it("50 lbf -> 222.4 N; 150 mm -> 0.15 m; 'steel' -> A36 and Ωb 1.67, both defaults with their sources", () => {
    const r = parseChatBrief("steel bracket 150 mm long carrying 50 lbf at the tip");
    near(r.ir.loadN, 50 * 4.4482216152605, 1e-5);
    assert.equal(Math.round(r.ir.loadN * 10) / 10, 222.4);
    assert.equal(r.ir.lengthM, 0.15);
    assert.equal(C(r, "material").value, "steel-a36");
    assert.equal(C(r, "material").status, STATUS.DEFAULT);
    assert.match(C(r, "material").source, /material library/);
    assert.equal(C(r, "safetyFactor").value, 1.67);
    assert.match(C(r, "safetyFactor").source, /AISC 360-16/);
    assert.deepEqual(Q(r), ["width"]);
  });
  it("a named grade is a design input; no safety-factor default without a cited one (aluminium)", () => {
    const r = parseChatBrief("6061-T6 aluminium bracket, 200 mm arm, 1 kN at the end");
    assert.equal(C(r, "material").value, "aluminum-6061-t6");
    assert.equal(C(r, "material").status, STATUS.INPUT);
    assert.equal(C(r, "safetyFactor").status, STATUS.UNKNOWN);
    assert.ok(r.unknowns.some((u) => u.field === "safetyFactor"));
  });
  it("a load given as a mass is its weight at gn, and says so", () => {
    const r = parseChatBrief("a bracket that holds 20 kg, 100 mm long");
    near(r.ir.loadN, 20 * 9.80665, 1e-6);
    assert.match(C(r, "load").note, /9\.80665/);
  });
  it("a stated safety factor and plate thickness are read", () => {
    const r = parseChatBrief("steel bracket 120 mm long, 8 mm thick, 300 N at the tip, safety factor 2");
    assert.equal(r.ir.safetyFactor, 2);
    assert.equal(C(r, "safetyFactor").status, STATUS.INPUT);
    assert.equal(r.ir.thicknessM, 0.008);
    assert.equal(r.ir.lengthM, 0.12);
  });
  it("a garbage unit is an error, not a guess", () => {
    const r = parseChatBrief("bracket for 500 zorks");
    assert.equal(r.ok, false);
    assert.match(r.errors[0].error, /unknown unit "zorks"/);
  });
});

describe("beams", () => {
  it("'a beam' asks span, loads and supports (ordered by what they unblock); material stays unknown", () => {
    const r = parseChatBrief("a beam");
    assert.deepEqual(Q(r), ["span", "loads", "support"]);
    assert.ok(r.unknowns.some((u) => u.field === "material" && u.blocks.includes("beam.allowable-stress")));
  });
  it("simply supported, point load at midspan + UDL in kN/m", () => {
    const r = parseChatBrief("a 6 m simply supported steel beam with 10 kN at midspan and 2 kN/m");
    assert.equal(r.ir.spanM, 6);
    assert.equal(r.ir.support, "simply-supported");
    assert.deepEqual(r.ir.loads.map((l) => [l.type, l.N ?? l.Npm, l.at ?? null]), [["point", 10000, "midspan"], ["udl", 2000, null]]);
  });
  it("a point load placed by distance, and a UDL in lbf/ft", () => {
    const r = parseChatBrief("cantilever beam 4 m long, 5 kN at 3 m from the wall and 100 lbf/ft");
    assert.equal(r.ir.support, "cantilever");
    assert.equal(r.ir.spanM, 4);
    assert.deepEqual(r.ir.loads[0].at, { xM: 3, from: "left", source: '"3 m"' });
    near(r.ir.loads[1].Npm, (100 * 4.4482216152605) / 0.3048, 1e-6);
  });
  it("two unlabelled lengths: neither is taken as the span; the span is asked", () => {
    const r = parseChatBrief("a beam, 3 m and 5 m, 10 kN at midspan, simply supported");
    assert.equal(r.ir.spanM, null);
    assert.ok(Q(r).includes("span"));
    assert.ok(r.assumptions.some((a) => /without saying which is the span/.test(a)));
  });
});

describe("trusses", () => {
  it("a 4-panel Pratt truss: geometry and joint loads read; supports default pin + roller (cited)", () => {
    const r = parseChatBrief("a 4-panel Pratt truss spanning 12 m, 3 m tall, 10 kN at each top joint");
    assert.deepEqual([r.ir.type, r.ir.panels, r.ir.spanM, r.ir.heightM], ["pratt", 4, 12, 3]);
    assert.deepEqual(r.ir.loads.map((l) => [l.N, l.at]), [[10000, "each top joint"]]);
    assert.equal(C(r, "support").status, STATUS.DEFAULT);
    assert.match(C(r, "support").source, /Hibbeler/);
  });
  it("'a Warren truss' asks for what defines it (max 3), the rest waits", () => {
    const r = parseChatBrief("a Warren truss");
    assert.equal(r.questions.length, 3);
    assert.ok(r.later.length >= 1);
    assert.equal(C(r, "type").value, "warren");
  });
  it("stated pin and roller supports are a design input", () => {
    const r = parseChatBrief("Howe truss, three panels, 9 m span, 2 m high, pin and roller, 5 kN at each joint");
    assert.equal(C(r, "support").status, STATUS.INPUT);
    assert.equal(r.ir.panels, 3);
    assert.equal(r.ir.heightM, 2);
  });
});

describe("Sentinel parts", () => {
  it("the knee actuator bracket at the gait peak: the load is the motion check's output, never a typed number; armor off", () => {
    const r = parseChatBrief("design the knee actuator bracket for M1 at the gait-cycle peak torque");
    assert.equal(r.domain, "sentinel-part");
    assert.equal(C(r, "loadCase").status, STATUS.COMPUTED);
    assert.deepEqual(r.ir.loadCase, { solver: "sentinel/gait.js quasiStaticGait", output: "peaks.conservativeNm.knee" });
    assert.equal(r.ir.armor, "off");
    assert.deepEqual(Q(r), []);
  });
  it("no joint and no load case: both asked", () => {
    const r = parseChatBrief("a bracket for Sentinel M1");
    assert.equal(r.domain, "sentinel-part");
    assert.ok(Q(r).includes("joint") && Q(r).includes("loadCase"));
  });
});

describe("unsupported input", () => {
  it("empty text and an unknown kind of design are errors", () => {
    assert.equal(parseChatBrief("").ok, false);
    const r = parseChatBrief("design a toaster");
    assert.equal(r.ok, false);
    assert.match(r.errors[0].error, /reads car, bracket, beam, truss, sentinel-part/);
    assert.equal(detectDomain("design a toaster"), null);
  });
  it("numbers inside grades and names are not quantities", () => {
    const s = scanQuantities("6061-T6 bracket for M1, A36 plate");
    assert.deepEqual(s.quantities, []);
    assert.deepEqual(s.errors, []);
  });
});

describe("the optional language-model mapping only points words at fields", () => {
  const text = "cantilever bracket, the arm reaching out about 250 mm, holding 800 N";
  it("off by default: the mapper is never called", () => {
    let called = false;
    parseChatBrief(text, { mapPhrases: () => { called = true; return []; } });
    assert.equal(called, false);
  });
  it("a valid mapping fills an unread field with the parser's reading of the phrase", () => {
    const plain = parseChatBrief("cantilever bracket, holding 800 N, it reaches 250 mm");
    assert.equal(plain.ir.lengthM, 0.25, "the only length is read as the arm anyway");
    // two lengths, neither labelled: the parser takes neither as the arm; the mapper points at one
    const amb = "bracket holding 800 N, plate 250 mm by 40 mm";
    assert.equal(parseChatBrief(amb).ir.lengthM, null);
    const r = parseChatBrief(amb, { llm: true, mapPhrases: () => [{ phrase: "250 mm", field: "length" }] });
    assert.equal(r.ir.lengthM, 0.25);
    assert.match(C(r, "length").source, /mapped to length by the language model; the value read by the parser/);
  });
  it("rejected: an invented field, a phrase not in the text, a number the text never said, two numbers in one phrase", () => {
    const r = parseChatBrief("bracket holding 800 N, plate 250 mm by 40 mm", {
      llm: true,
      mapPhrases: () => [
        { phrase: "800 N", field: "colour" },
        { phrase: "300 mm", field: "length" },
        { phrase: "250 mm by 40 mm", field: "length" },
      ],
    });
    assert.deepEqual(r.rejectedMappings.map((m) => m.reason), ["not a field of this design", "the phrase is not in the message", "the phrase must hold exactly one length (found 2)"]);
    assert.equal(r.ir.lengthM, null);
  });
});

describe("the policy table", () => {
  it("every domain's asked fields carry a question and the checks they unblock", () => {
    for (const [d, fields] of Object.entries(FIELDS)) {
      for (const f of fields) if (f.ask) assert.ok(f.question && f.blocks.length > 0, `${d}.${f.field}`);
    }
  });
});

describe("the lens parser's fallbacks are labelled, not silent", () => {
  it("parseDesignIntent lists the 5 kN load it assumed as an uncited default, with the question the chat asks instead", () => {
    const r = parseDesignIntent("a 3 m steel beam");
    const load = r.intent.uncitedDefaults.find((d) => d.field === "load");
    assert.equal(load.value, -DEFAULT_LOAD_N);
    assert.equal(load.status, "uncited default");
    assert.match(load.ask, /load/);
    const chat = parseChatBrief("a 3 m steel beam");
    assert.equal(chat.ir.loads.length, 0, "the chat parser does not apply it");
    assert.ok(Q(chat).includes("loads"));
  });
});
