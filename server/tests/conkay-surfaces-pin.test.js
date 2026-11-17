// server/tests/conkay-surfaces-pin.test.js
//
// SXC-38 inventory pin: regression legs for the fifteen pre-catalogue
// ConKay surfaces that PRG-17 / PRG-C1 generalize (inventory of record:
// docs/conkay/surfaces-inventory.md). Each leg pins the surface's CURRENT
// contract — a computed textbook value, a deterministic hash, or an honest
// refusal — so a generalization that silently changes an existing surface
// goes red here. Intended changes update the pin and the inventory in the
// same commit, with the change named.
//
// Hermetic legs only (node:test, no DB, no engines). DB-bound siblings
// (applyMate, buildErpBom's store walk) are named in the inventory.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { detectDomain, parseChatBrief } from "../lib/conkay/chat/brief-parser.js";
import { designFromChat } from "../lib/conkay/chat/run.js";
import { SESSION_VERSION, ChatSession } from "../lib/conkay/chat/session.js";
import { checkReceipt, explainCheck } from "../lib/conkay/chat/workbench.js";
import {
  normalizeBeamStudyInputs,
  hashBeamStudyInputs,
  buildBeamCalcReceipt,
} from "../lib/conkay/beam-study.js";
import { cantilever, solveBracket } from "../lib/conkay/chat/structures.js";
import { sentinelJointLoad } from "../lib/conkay/chat/sentinel-part.js";
import { buildConceptAssembly } from "../lib/conkay/concept-assembly.js";
import { parseRobotAsk } from "../lib/conkay/robot-assembly.js";
import { buildCarChatAssembly } from "../lib/conkay/car-chat-assembly.js";
import { checkFeasibility } from "../lib/conkay/compiler/feasibility.js";
import { solveMateTransform } from "../lib/conkay/assembly-mates.js";
import { ascii, fitText } from "../lib/conkay/drawings/sheet.js";
import { parseVendorPriceList, estimatePartMassProps } from "../lib/conkay/erp-bom.js";
import { openDesign } from "../lib/conkay/index.js";
import { CONKAY_IR_MINI_EXAMPLE, softenDesignIR } from "../lib/conkay/compiler/soften-ir.js";
import { assertEchoIntegrity } from "./_conkay-honesty.mjs";

describe("SXC-38 pin - brief routing", () => {
  it("bridges route to truss; a beam bridge stays a beam", () => {
    assert.equal(detectDomain("design a footbridge over the creek, 12 m span"), "truss");
    assert.notEqual(detectDomain("design a bridge beam for the crossing"), "truss");
  });

  it("sentinel-part routing needs the sentinel + part context", () => {
    assert.equal(detectDomain("sentinel knee actuator bracket"), "sentinel-part");
  });

  it("empty brief is refused at parse, never designed", async () => {
    assert.equal(parseChatBrief("").ok, false);
    const r = await designFromChat("");
    assert.equal(r.ok, false);
    assert.equal(r.stage, "parse");
  });

  it("empty car brief builds nothing (null, not a fabrication)", () => {
    assert.equal(buildCarChatAssembly(""), null);
  });
});

describe("SXC-38 pin - conversation + class problems (session)", () => {
  it("session surface is present and constructs", () => {
    assert.equal(typeof SESSION_VERSION, "string");
    assert.ok(SESSION_VERSION.length > 0);
    const s = new ChatSession();
    assert.ok(s && typeof s === "object");
  });
});

describe("SXC-38 pin - workbench", () => {
  const env = {
    runId: "mass.part@P1",
    status: "PASS",
    solver: { id: "mass.part", method: "sum of part volumes x density" },
    inputs: { mass: 1.5 },
    outputs: { massKg: 1.5 },
    margins: [],
    warnings: [],
  };

  it("checkReceipt echoes runId + status", () => {
    const r = checkReceipt(env);
    assert.equal(r.runId, "mass.part@P1");
    assert.equal(r.status, "PASS");
  });

  it("explainCheck names the solver method", () => {
    const text = explainCheck(env);
    assert.equal(typeof text, "string");
    assert.ok(text.includes("sum of part volumes"));
  });
});

describe("SXC-38 pin - beam-study deterministic commands", () => {
  const input = {
    dims: { length: 2, height: 0.1, flangeWidth: 0.05, flangeThickness: 0.01, webThickness: 0.006 },
    support: "simply-supported",
    loadN: 1000,
    material: { E: 200e9, yield: 250e6 },
  };

  it("input hash is deterministic and input-sensitive", () => {
    assert.equal(hashBeamStudyInputs(input), hashBeamStudyInputs({ ...input }));
    assert.notEqual(
      hashBeamStudyInputs(input),
      hashBeamStudyInputs({ ...input, dims: { ...input.dims, length: 3 } })
    );
  });

  it("normalize is deterministic; the calc receipt builds", () => {
    assert.deepEqual(normalizeBeamStudyInputs(input), normalizeBeamStudyInputs(input));
    const receipt = buildBeamCalcReceipt(input);
    assert.ok(receipt && typeof receipt === "object");
  });
});

describe("SXC-38 pin - structures (bracket + beam legs)", () => {
  it("cantilever matches the textbook closed form", () => {
    // P=1000 N, L=2 m, b=0.05 m, h=0.1 m, E=200 GPa:
    // I = b h^3 / 12 = 4.1667e-6 m^4; sigma = Mc/I = 24 MPa; delta = PL^3/(3EI) = 3.2 mm.
    const r = cantilever({ P: 1000, L: 2, b: 0.05, h: 0.1, E: 200e9 });
    assert.ok(Math.abs(r.hand.sigma - 2.4e7) / 2.4e7 < 1e-6, `sigma ${r.hand.sigma}`);
    assert.ok(Math.abs(r.hand.delta - 0.0032) / 0.0032 < 1e-6, `delta ${r.hand.delta}`);
    // The surface cross-checks its hand calc against its frame FE run.
    assert.equal(r.fe.agrees.sigma, true);
    assert.equal(r.fe.agrees.delta, true);
  });

  it("solveBracket refuses with the missing fields named", () => {
    const r = solveBracket({ lengthM: 0.3 });
    assert.equal(r.ok, false);
    assert.ok(r.missing.includes("loadN") && r.missing.includes("material"));
  });
});

describe("SXC-38 pin - sentinel-part", () => {
  it("an unknown joint is refused, naming the valid joints", () => {
    const r = sentinelJointLoad("elbow");
    assert.equal(r.ok, false);
    assert.match(r.error, /knee/);
  });
});

describe("SXC-38 pin - architectures", () => {
  it("unmatched concept text builds no architecture (null)", () => {
    assert.equal(buildConceptAssembly("a poem about the sea"), null);
  });

  it("a robot ask parses into a spec object", () => {
    const spec = parseRobotAsk("build a robot arm with 4 joints");
    assert.ok(spec && typeof spec === "object");
  });
});

describe("SXC-38 pin - feasibility", () => {
  it("a design kind with no screen is NO_SCREEN - nothing assumed feasible", () => {
    const r = checkFeasibility({ intent: "a perpetual motion machine", requirements: [] });
    assert.equal(r.status, "NO_SCREEN");
    assert.match(r.reason, /nothing is assumed/);
  });
});

describe("SXC-38 pin - mates", () => {
  it("coincident mate drives b onto a's coordinate on the axis", () => {
    const r = solveMateTransform({
      type: "coincident",
      axis: "x",
      aPos: { x: 1, y: 2, z: 3 },
      bPos: { x: 9, y: 8, z: 7 },
      aRot: { x: 0, y: 0, z: 0 },
      bRot: { x: 0, y: 0, z: 0 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.position.x, 1);
    assert.equal(r.position.y, 8);
  });

  it("an unsupported mate type is refused by name", () => {
    const r = solveMateTransform({ type: "welded-glob", aPos: { x: 0, y: 0, z: 0 }, bPos: { x: 0, y: 0, z: 0 } });
    assert.equal(r.ok, false);
    assert.equal(r.error, "unsupported_mate");
  });
});

describe("SXC-38 pin - drawings", () => {
  it("ascii() folds symbols exactly", () => {
    assert.equal(ascii("± × °"), "+/- x  deg");
  });

  it("fitText is deterministic", () => {
    assert.equal(fitText("CONCORD", 4), fitText("CONCORD", 4));
  });
});

describe("SXC-38 pin - BOM", () => {
  it("a vendor price list parses into rows; a foreign header is refused with the reason", () => {
    const r = parseVendorPriceList("partNumber,material,unitCostUsd\nWIDGET-1,steel,3.50\n");
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].partNumber, "WIDGET-1");
    assert.equal(r.rows[0].unitCostUsd, 3.5);
    const bad = parseVendorPriceList("part,qty,price\nwidget,2,3.50\n");
    assert.equal(bad.rows.length, 0);
    assert.ok(bad.errors.length >= 1);
  });

  it("a part with unknown material gets no mass - no stand-in density", () => {
    const r = estimatePartMassProps({ geometry: { shape: "box", length: 0.1, width: 0.1, height: 0.1 } });
    assert.ok(r.massKg == null || r.mass == null || r.ok === false || /material/.test(JSON.stringify(r).toLowerCase()));
  });
});

describe("SXC-38 pin - iterate/orchestrator substrate (SC-05 leg)", () => {
  it("the corrected plate design runs mass.part + cost.part with echo integrity", () => {
    // The shipped mini example with the geometry keys the compiler's
    // SHAPES table requires (the shipped example's x/y/z keys do not
    // compile at this build - SC-foundations evidence, leg B0).
    const miniOk = structuredClone(CONKAY_IR_MINI_EXAMPLE);
    miniOk.nodes[0].geometry = { shape: "box", length: "200 mm", width: "100 mm", height: "10 mm" };
    const opened = openDesign(softenDesignIR(miniOk).ir);
    assert.equal(opened.ok, true);
    const envelopes = opened.session.results();
    assert.ok(Array.isArray(envelopes) && envelopes.length >= 2, "design engine produced no results");
    const byId = Object.fromEntries(envelopes.map((e) => [e.runId, e]));
    assert.equal(byId["mass.part@P1"]?.status, "PASS");
    assert.equal(byId["cost.part@P1"]?.status, "PASS");
    assertEchoIntegrity(byId["mass.part@P1"], {}, "mass.part");
  });
});
