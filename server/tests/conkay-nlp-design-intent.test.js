// Bracket screening, mass→newton loads, and honest "assumed" flags.
// The engine is the spec: expected stress and deflection are the textbook
// formulas, and FEA has to land on them.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import zlib from "node:zlib";
import express from "express";
import "../lib/conkay/physics/solvers/bracket-plate.js";
import { openDesign } from "../lib/conkay/index.js";
import { compileBrief } from "../lib/conkay/compiler/architectures.js";
import {
  G_N_PER_KG,
  parseDesignIntent,
  solveDesignText,
  intentToFeaModel,
} from "../lib/conkay/nlp-design-intent.js";
import createConkayDesignRouter from "../routes/conkay-design.js";
import { renderDtuAsFile, dtuToMarkdown } from "../lib/dtu-document-export.js";

const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

function inflatePdfText(buf) {
  const chunks = [];
  let i = 0;
  while (i < buf.length) {
    const key = buf.indexOf("/Length ", i);
    if (key < 0) break;
    const len = Number.parseInt(buf.toString("ascii", key + 8, key + 24), 10);
    const streamAt = buf.indexOf("stream", key);
    if (!Number.isFinite(len) || streamAt < 0) break;
    let dataAt = streamAt + "stream".length;
    if (buf[dataAt] === 0x0d && buf[dataAt + 1] === 0x0a) dataAt += 2;
    else if (buf[dataAt] === 0x0a) dataAt += 1;
    const data = buf.subarray(dataAt, dataAt + len);
    try { chunks.push(zlib.inflateSync(data).toString("utf8")); }
    catch { chunks.push(data.toString("latin1")); }
    i = dataAt + len;
  }
  const raw = chunks.join("\n");
  return raw.replace(/<([0-9a-fA-F]+)>/g, (_, hex) => {
    let s = "";
    for (let n = 0; n + 1 < hex.length; n += 2) s += String.fromCharCode(Number.parseInt(hex.slice(n, n + 2), 16));
    return s;
  });
}

describe("conkay design intent — loads, supports, sections", () => {
  it("converts 200 kg to weight and does not keep the 5 kN default", () => {
    const r = parseDesignIntent("design a steel bracket that holds 200 kg");
    assert.equal(r.ok, true);
    const P = 200 * G_N_PER_KG;
    assert.ok(Math.abs(r.intent.loads[0].forceN + P) < 1e-6);
    assert.notEqual(r.intent.loads[0].forceN, -5000);
    assert.equal(r.intent.part, "bracket");
    assert.equal(r.intent.support, "cantilever");
    assert.equal(r.intent.loads[0].location, "end");
    assert.equal(r.intent.assumed.load, false);
    assert.equal(r.intent.assumed.span, true);
    assert.equal(r.intent.assumed.section, true);
    assert.equal(r.intent.assumed.material, false);
    assert.equal(r.intent.assumed.support, false);
    assert.equal(r.intent.spans[0], 0.12);
    assert.match(r.intent.assumptions.join(" "), /0\.12 m/);
    assert.match(r.intent.assumptions.join(" "), /Section assumed/);
  });

  it("converts lb and tonnes to newtons", () => {
    const lb = parseDesignIntent("steel i-beam 4 m span carrying 200 lb");
    assert.equal(lb.ok, true);
    assert.ok(Math.abs(lb.intent.loads[0].forceN + 200 * 0.45359237 * G_N_PER_KG) < 1e-4);
    const tonne = parseDesignIntent("steel beam 3 m, 1.5 t midspan");
    assert.equal(tonne.ok, true);
    assert.ok(Math.abs(tonne.intent.loads[0].forceN + 1.5 * 1000 * G_N_PER_KG) < 1e-3);
    assert.equal(tonne.intent.loads[0].location, "midspan");
  });

  it("flags a missing load instead of pretending 5 kN was given", () => {
    const r = parseDesignIntent("simply supported steel I-beam 6m");
    assert.equal(r.ok, true);
    assert.equal(r.intent.loads.length, 0);
    assert.equal(r.intent.assumed.load, true);
    assert.equal(r.intent.support, "simply-supported");
    assert.equal(r.intent.assumed.support, false);
    const model = intentToFeaModel(r.intent);
    assert.equal(model.loads[0].Fy, -5000);
    assert.equal(model.loads[0].nodeId, "N4");
    assert.deepEqual(model.supports[0].fixedDOF.includes("rz"), false);
    assert.deepEqual(model.supports[1].fixedDOF.includes("x"), false);
    assert.equal(model.nodes.at(-1).x, 6);
    assert.equal(model.nodes.length, 9);
  });

  it("uses a parsed support and a section derived from the geometry", () => {
    const r = parseDesignIntent("cantilever steel I-beam 6m, 5kN at the tip, depth 200 mm, flange width 100 mm, flange thickness 12 mm, web thickness 8 mm");
    assert.equal(r.ok, true);
    assert.equal(r.intent.support, "cantilever");
    assert.equal(r.intent.assumed.support, false);
    assert.equal(r.intent.assumed.section, false);
    const bf = 0.1, h = 0.2, tf = 0.012, tw = 0.008;
    const area = 2 * bf * tf + (h - 2 * tf) * tw;
    const Ix = (bf * h ** 3) / 12 - ((bf - tw) * (h - 2 * tf) ** 3) / 12;
    assert.ok(rel(r.intent.section.area, area) < 1e-9);
    assert.ok(rel(r.intent.section.momentI, Ix) < 1e-9);
    const model = intentToFeaModel(r.intent);
    assert.equal(model.supports.length, 1);
    assert.equal(model.loads[0].nodeId, "N8");
    assert.equal(model.loads[0].Fy, -5000);
    assert.ok(rel(model.members[0].area, area) < 1e-9);
    assert.ok(rel(model.members[0].momentI, Ix) < 1e-9);
    assert.equal(model.members[0].depthIn, 0.2);

    const adjacent = parseDesignIntent("aluminum cylinder diameter 80 mm length 1.5 m, 500 N at the tip");
    assert.equal(adjacent.ok, true);
    assert.equal(adjacent.intent.section.radius, 0.04);
    assert.equal(adjacent.intent.spans[0], 1.5);
    assert.equal(adjacent.intent.assumed.section, false);
    const plate = parseDesignIntent("steel bracket arm 150 mm, 80 mm wide, 10 mm thick, leg 100 mm, holds 50 kg");
    assert.equal(plate.ok, true);
    assert.equal(plate.intent.spans[0], 0.15);
    assert.equal(plate.intent.section.thickness, 0.01);
    assert.equal(plate.intent.section.width, 0.08);
    assert.equal(plate.intent.section.legHeight, 0.1);
    assert.equal(plate.intent.assumed.section, false);
  });

  it("still fails closed when a beam has no span, and names the parts it can build", () => {
    const missing = parseDesignIntent("steel I-beam please");
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "no_span");
    const unknown = parseDesignIntent("make me a spaceship");
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, "unsupported_part");
    assert.ok(unknown.supportedParts.includes("bracket"));
    assert.match(unknown.error, /bracket/);
  });
});

describe("bracket solve", () => {
  it("stress, deflection and utilization match the plate formulas and the FEA", () => {
    const solved = solveDesignText("design a steel bracket that holds 200 kg");
    assert.equal(solved.ok, true);
    const P = 200 * G_N_PER_KG;
    const L = 0.12, b = 0.08, t = 0.008;
    const I = (b * t ** 3) / 12;
    const c = t / 2;
    const stress = (P * L * c) / I;
    const delta = (P * L ** 3) / (3 * 200e9 * I);
    const util = stress / 250e6;
    assert.ok(util > 1, "the default plate does not carry 200 kg");
    assert.ok(rel(solved.hand.maxStressPa, stress) < 1e-9);
    assert.ok(rel(solved.hand.maxDeflectionM, delta) < 1e-9);
    assert.ok(rel(solved.hand.utilization, util) < 1e-9);
    assert.equal(solved.hand.allPass, false);
    assert.equal(solved.fea.ok, true);
    assert.equal(solved.fea.allPass, false);
    assert.ok(rel(solved.fea.maxStressPa, stress) < 0.05, `FEA stress ${solved.fea.maxStressPa} vs ${stress}`);
    assert.ok(rel(solved.fea.maxDeflectionM, delta) < 0.05, `FEA defl ${solved.fea.maxDeflectionM} vs ${delta}`);
    assert.ok(rel(solved.fea.maxUtilization, util) < 0.05);
    assert.equal(solved.mesh.kind, "bracket");
    assert.ok(solved.mesh.triangleCount > 10);
    const xs = [];
    const ys = [];
    for (let i = 0; i < solved.mesh.positions.length; i += 3) {
      xs.push(solved.mesh.positions[i]);
      ys.push(solved.mesh.positions[i + 1]);
    }
    assert.ok(Math.max(...xs) >= L - 1e-6);
    assert.ok(Math.max(...ys) >= 0.08 - 1e-6);
  });

  it("a 6 m simply-supported 5 kN beam agrees with PL/4 and PL^3/48EI", () => {
    const solved = solveDesignText("simply supported steel I-beam 6m, 5kN midspan");
    assert.equal(solved.ok, true);
    assert.equal(solved.intent.assumed.load, false);
    assert.equal(solved.intent.assumed.section, true);
    const bf = 0.1, h = 0.2, tf = 0.012, tw = 0.008;
    const Ix = (bf * h ** 3) / 12 - ((bf - tw) * (h - 2 * tf) ** 3) / 12;
    const P = 5000, L = 6, c = h / 2, E = 200e9;
    const stress = ((P * L) / 4 * c) / Ix;
    const delta = (P * L ** 3) / (48 * E * Ix);
    assert.ok(rel(solved.hand.maxStressPa, stress) < 1e-9);
    assert.ok(rel(solved.hand.maxDeflectionM, delta) < 1e-9);
    assert.ok(rel(solved.fea.maxStressPa, stress) < 0.05);
    assert.ok(rel(solved.fea.maxDeflectionM, delta) < 0.05);
    assert.equal(solved.model.supports[0].fixedDOF.includes("rz"), false);
    assert.equal(solved.model.loads[0].Fy, -5000);
  });
});

describe("from-brief bracket", () => {
  it("opens an L-bracket design and leaves cars on the road-vehicle path", () => {
    const car = compileBrief("a car that weighs 2,500 lb, does 180 mph, seats 4");
    assert.equal(car.architecture, "road-vehicle");
    assert.equal(car.ir.nodes.some((n) => n.id === "VEH"), true);

    const brief = compileBrief("design a steel bracket that holds 200 kg");
    assert.equal(brief.architecture, "l-bracket");
    assert.equal(brief.assumed.load, false);
    assert.equal(brief.assumed.span, true);
    assert.ok(brief.mesh.triangleCount > 0);
    const opened = openDesign(brief.ir);
    assert.equal(opened.ok, true);
    const plate = opened.session.result("bracket.plate@ARM");
    assert.ok(plate, "bracket.plate ran on the arm");
    assert.equal(plate.status, "FAIL");
    assert.ok(plate.outputs.utilization.value > 1);
    assert.ok(plate.outputs.maxStress.value > 0);
    assert.ok(plate.outputs.maxDeflection.value > 0);
    const unknown = compileBrief("greenhouse for 500 plants, under $40k");
    assert.match(unknown.error, /no architecture/);
    assert.match(unknown.error, /bracket/);
  });
});

describe("POST /api/conkay/design", () => {
  let server;
  let port;
  it("returns the bracket solve, and 400 with the part list for a spaceship", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/conkay", createConkayDesignRouter({
      requireAuth: (_req, _res, next) => next(),
      db: null,
    }));
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;

    const post = (text) => fetch(`http://127.0.0.1:${port}/api/conkay/design`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const okRes = await post("design a steel bracket that holds 200 kg");
    assert.equal(okRes.status, 200);
    const body = await okRes.json();
    assert.equal(body.ok, true);
    assert.equal(body.mesh.kind, "bracket");
    assert.equal(body.assumed.load, false);
    assert.equal(body.assumed.span, true);
    assert.equal(body.hand.allPass, false);
    assert.equal(body.fea.summary.allPass, false);
    assert.ok(Math.abs(body.intent.loads[0].forceN + 200 * G_N_PER_KG) < 1e-6);
    assert.notEqual(body.intent.loads[0].forceN, -5000);

    const bad = await post("make me a spaceship");
    assert.equal(bad.status, 400);
    const err = await bad.json();
    assert.equal(err.ok, false);
    assert.ok(err.supportedParts.includes("bracket"));
    assert.match(err.error, /bracket/);
  });
  after(() => new Promise((resolve) => server ? server.close(resolve) : resolve()));
});

describe("beam study PDF uses the solved span", () => {
  it("does not print a 4 m prompt span over a 1200 mm solve", async () => {
    const dtu = {
      id: "dtu_beam1",
      title: "4 m span: 300×150 I-beam, 1200 mm simply supported",
      domain: "engineering",
      tags: ["conkay", "beam-study"],
      createdAt: "2026-10-10T00:00:00.000Z",
      human: { summary: "Prompt said 4 m span. The study that was solved is below." },
      core: { claims: ["4 m span carrying 10 kN"], definitions: [], invariants: [], examples: [], nextActions: [] },
      machine: {
        kind: "conkay_beam_study",
        dims: { length: 1200, height: 300, flangeWidth: 150, flangeThickness: 15, webThickness: 9 },
        support: "simply-supported",
        loadN: 10000,
        maxStressMPa: 12.5,
        maxDeflectionMm: 0.4,
        utilization: 0.05,
        pass: true,
      },
    };
    const pdf = await renderDtuAsFile(dtu, "pdf");
    assert.equal(pdf.ok, true);
    assert.equal(pdf.buffer.slice(0, 4).toString(), "%PDF");
    const text = inflatePdfText(pdf.buffer);
    assert.match(text, /1200 mm/);
    assert.equal(/\b4\s*m\b/.test(text), false);
    const md = dtuToMarkdown(dtu);
    assert.match(md, /Solved span 1200 mm/);
    assert.equal(/\b4\s*m\b/.test(md), false);
    assert.match(md, /10000 N/);
  });
});
