// server/tests/conkay-orc-intent-parse.test.js
//
// SX-ORC-01 — orc.intent-parse acceptance tests.
// Reference case: the catalogue's 20-brief corpus (robot, car, drone,
// kettle, footbridge, house, rocket, prosthetic hand, PCB, reactor — two
// briefs each). The invariant asserted for EVERY brief: the parse is not a
// refusal, and every admitted number is traced to the brief's text by
// literal re-find (the test re-finds it independently) or the field is
// marked missing. Expected values come from the briefs themselves (the
// cited source is the user's text), never from the solver's output alone.
//
// Adversarial + honesty legs per the ticket: proposed numbers enter only
// by literal re-find; INVALID_INPUT for non-finite/unphysical proposals;
// bare numbers are surfaced, never read as SI; missing text is
// NOT_COMPUTED naming the field (SC-05 helper); ambiguous units are
// excluded and named, never guessed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseIntentBrief, literallyInText } from "../lib/conkay/orc/intent-parse.js";
import { listSolvers, getSolver, envelope } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

// [brief, expected domain (null = open text, quantities-only brief)]
const CORPUS = [
  ["sentinel knee actuator bracket for a 90 kg robot", "sentinel-part"],
  ["design a prosthetic hand with 5 fingers and 40 N grip force", null],
  ["design a car with a top speed of 180 km/h and a mass of 1200 kg", "car"],
  ["a lightweight car frame, wheelbase 2.7 m, 300 kg", "car"],
  ["a quadcopter drone with 1.2 kg mass and 30 min endurance", null],
  ["a delivery drone carrying a 2 kg payload 10 km", null],
  ["an electric kettle holding 1.7 L, 2200 W", null],
  ["a stovetop kettle, 2 L capacity, base diameter 180 mm", null],
  ["design a footbridge over the creek, 12 m span, 3 m wide", "truss"],
  ["a pedestrian bridge 25 m long carrying 5 kN per metre", "truss"],
  ["a house wall panel 3 m high, 150 mm thick", null],
  ["a garden shed 4 m by 3 m, roof load 0.8 kN", null],
  ["a model rocket 0.9 m long, 120 g mass, 20 N thrust", null],
  ["a sounding rocket reaching 3000 m altitude, 8 kg mass", null],
  ["a wall bracket holding 250 N at 0.4 m from the wall", "bracket"],
  ["a shelf bracket, 300 mm deep, load 150 N", "bracket"],
  ["a PCB 100 mm by 80 mm with a 5 V rail and 2 A draw", null],
  ["a sensor board 50 mm square, 3.3 V, 200 mA", null],
  ["a reactor coolant loop at 300 C and 15 MPa", null],
  ["a heat exchanger 1.5 m long, flow 2 kg/s", null],
];

describe("SX-ORC-01 — 20-brief corpus (reference case)", () => {
  for (const [brief, domain] of CORPUS) {
    it(`traces every number in: ${brief.slice(0, 44)}...`, () => {
      const r = parseIntentBrief({ text: brief });
      assert.ok(!r.notComputed, `refused: ${r.notComputed}`);
      assert.equal(r.outputs.domain, domain);
      assert.ok(r.outputs.quantities.length >= 1, "no quantity traced");
      for (const q of r.outputs.quantities) {
        if (q.raw) assert.ok(brief.includes(q.raw), `quantity "${q.raw}" not literally in the brief`);
        assert.equal(q.traced, true);
      }
      if (domain) {
        assert.equal(r.outputs.readDomain, true);
        assert.ok(r.outputs.claims.length >= 1, "read domain produced no claims");
        assert.deepEqual(r.outputs.missing, []);
      } else {
        assert.ok(r.outputs.missing.includes("domain"), "open brief must mark domain missing, not invent one");
      }
      assert.equal(r.inputs.text, brief);
    });
  }
});

describe("SX-ORC-01 — literal re-find gate for proposed numbers", () => {
  const text = "a wall bracket holding 250 N at 0.4 m from the wall";

  it("admits a proposal found literally in the text", () => {
    const r = parseIntentBrief({ text, proposed: [{ name: "load", value: 250, unit: "N" }] });
    assert.equal(r.outputs.admittedProposals.length, 1);
    assert.equal(r.outputs.rejectedProposals.length, 0);
  });

  it("rejects a proposal that is not in the text, naming the failure", () => {
    const r = parseIntentBrief({ text, proposed: [{ name: "load", value: 900, unit: "N" }] });
    assert.equal(r.outputs.admittedProposals.length, 0);
    assert.match(r.outputs.rejectedProposals[0].reason, /literal re-find/);
  });

  it("rejects non-finite and negative proposals as INVALID_INPUT", () => {
    const r = parseIntentBrief({
      text,
      proposed: [
        { name: "huge", value: 1e300, unit: "N" },
        { name: "neg", value: -5, unit: "N" },
        { name: "nan", value: NaN, unit: "N" },
      ],
    });
    assert.equal(r.outputs.admittedProposals.length, 0);
    assert.ok(r.outputs.rejectedProposals.every((x) => /INVALID_INPUT/.test(x.reason)));
  });

  it("literallyInText is exact about value + unit adjacency", () => {
    assert.equal(literallyInText(text, 250, "N"), true);
    assert.equal(literallyInText(text, 250, "kg"), false);
    assert.equal(literallyInText(text, 25, "N"), false);
  });
});

describe("SX-ORC-01 — honesty legs", () => {
  it("missing text is NOT_COMPUTED naming the field (SC-05 helper)", async () => {
    await assertNothingAssumed((props) => parseIntentBrief(props), { text: "a bracket, 250 N" }, ["text"], "orc.intent-parse");
    const r = parseIntentBrief({});
    assert.equal(r.notComputed, "missing_input:text");
  });

  it("an ambiguous unit is excluded and named, never guessed", () => {
    const r = parseIntentBrief({ text: "a hoist lifting 5 tons" });
    assert.ok(!r.outputs.quantities.some((q) => q.value === 5), "the ambiguous 5 tons was admitted");
    assert.ok(r.warnings.some((w) => /tons/.test(w)), "the exclusion was not named in warnings");
  });

  it("a bare number is surfaced as bare, not admitted as a quantity", () => {
    const r = parseIntentBrief({ text: "a sensor board with 2 A draw" });
    assert.ok(r.outputs.bareNumbers.some((b) => b.value === 2));
    assert.ok(!r.outputs.quantities.some((q) => q.value === 2 && q.dim === "current"));
  });

  it("content-free text is NOT_COMPUTED, not a fabricated brief", () => {
    const r = parseIntentBrief({ text: "hello there, nice day" });
    assert.match(r.notComputed || "", /no_parseable_design_content/);
  });

  it("citations leg: the brief cites nothing out-of-domain (SC-05 helper)", () => {
    const r = parseIntentBrief({ text: CORPUS[0][0] });
    assertCitationsDomain(r, getSolver("orc.intent-parse"), "orc.intent-parse");
  });
});

describe("SX-ORC-01 — registry + IR reachability", () => {
  it("is registered with its declarations (SXC-20's data source)", () => {
    const s = listSolvers().find((x) => x.id === "orc.intent-parse");
    assert.ok(s, "orc.intent-parse not in the registry");
    assert.ok(s.regime && s.units && s.tolerance && s.screening === true);
    assert.equal(s.fidelity, 1); // registry stores the numeric tier; envelopes render it "L1"
  });

  it("runs on the IR path against a brief-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "brief-1", name: "Brief 1" },
      nodes: [
        {
          id: "B1",
          kind: "Part",
          name: "request",
          props: { "orc.intent": { text: "design a footbridge over the creek, 12 m span, 3 m wide" } },
        },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.intent-parse@B1");
    assert.ok(env, "no orc.intent-parse envelope in the session results");
    assert.equal(env.outputs.domain, "truss");
    assert.equal(env.inputs.text, "design a footbridge over the creek, 12 m span, 3 m wide");
  });

  it("envelope wraps the raw parse (WARN when the domain is open)", () => {
    const s = getSolver("orc.intent-parse");
    const raw = parseIntentBrief({ text: "an electric kettle holding 1.7 L, 2200 W" });
    const env = envelope(s, "B1", raw, { runtimeMs: 1, revision: 0 });
    assert.equal(env.status, "WARN");
    assert.equal(env.outputs.domain, null);
  });
});
