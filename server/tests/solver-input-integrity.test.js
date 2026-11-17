// Solver input integrity: a number the user gave is the number used, or the answer stops and says why.
//   1. Load kind is never guessed: UDL (kN/m, UDL, distributed, per metre) vs point load (kN at a position) vs ambiguous -> ask
//   2. No silent substitution, for EVERY solver (registry envelope guard) and at the design-IR boundary (an unusable
//      material override is an error, not a quiet fall back to the library value)
//   3. Citations on a math / science / engineering solver result are domain-matched (or none); creative and music
//      citation behaviour is unchanged
//   4. Beam regression: simply supported UDL w = 10 kN/m, L = 4 m, E = 200 GPa, I = 1.0e-5 m^4 -> 16.67 mm and 20 kN·m
//      (not 2.68 mm), E and I used exactly as submitted, no assumed section; point case PL^3/48EI = 13.33 mm
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { extractBeamQuestion, classifyBeamLoad } from "../lib/engineering-question-extract.js";
import { routeComputeQuestion, composeRoutedReply } from "../lib/chat/compute-router.js";
import { beamUniformLoad, beamDeflection } from "../lib/compute/physics-compute.js";
import { openDesign, listSolvers } from "../lib/conkay/index.js";
import { getSolver, envelope, inputIntegrityViolation } from "../lib/conkay/physics/registry.js";
import {
  gatherSourcesForQuery, expertAnswer, citationDomainsFor, SOLVER_CITATION_DOMAINS,
} from "../lib/expert-mode.js";

const UDL_Q = "A simply supported beam 4 m long carries a uniformly distributed load of 10 kN/m. E = 200 GPa, I = 1.0e-5 m^4. What is the maximum deflection and bending moment?";
const POINT_Q = "A simply supported beam 4 m long carries a point load of 20 kN at midspan. E = 200 GPa, I = 1.0e-5 m^4. What is the maximum deflection?";
const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

describe("load parsing: UDL vs point vs ambiguous", () => {
  it("classifies each written form without guessing", () => {
    for (const t of ["10 kN/m", "a UDL of 10 kN", "uniformly distributed load of 5 kN/m", "load spread evenly", "10 kN per metre", "50 lb/ft"]) {
      assert.equal(classifyBeamLoad(`a beam carries ${t}`).kind, "udl", t);
    }
    for (const t of ["a point load of 20 kN", "a concentrated load of 20 kN", "20 kN at midspan", "a 5 kN tip load", "20 kN at the centre"]) {
      assert.equal(classifyBeamLoad(`a beam carries ${t}`).kind, "point", t);
    }
    for (const t of ["20 kN", "a load of 20 kN", "a 20 kN load on it"]) {
      assert.equal(classifyBeamLoad(`a beam carries ${t}`).kind, "ambiguous", t);
    }
    assert.equal(classifyBeamLoad("a point load of 20 kN at midspan plus 10 kN/m over the span").kind, "ambiguous", "both described");
  });

  it("extracts a UDL in exact SI, point loads stay on the imperial point-load path", () => {
    const u = extractBeamQuestion(UDL_Q);
    assert.deepEqual(
      { kind: u.loadKind, w: u.wNPerM, L: u.lengthM, E: u.modulusPa, I: u.inertiaM4, s: u.supportType },
      { kind: "udl", w: 10000, L: 4, E: 200e9, I: 1.0e-5, s: "simple" },
    );
    const p = extractBeamQuestion(POINT_Q);
    assert.equal(p.loadKind, undefined);
    assert.ok(near(p.loadLbs, 20000 * 0.22480894, 1e-6));
  });

  it("ambiguous load: stops and asks, returns no number", () => {
    for (const q of [
      "A simply supported beam 4 m long carries 20 kN. E = 200 GPa, I = 1.0e-5 m^4. What is the max deflection?",
      "A simply supported beam 4 m long carries a point load of 20 kN at midspan and 10 kN/m. E = 200 GPa, I = 1.0e-5 m^4. Deflection?",
      "A simply supported beam 4 m long carries a uniformly distributed load. E = 200 GPa, I = 1.0e-5 m^4. Deflection?",
    ]) {
      const x = extractBeamQuestion(q);
      assert.equal(x.ambiguous, true, q);
      const r = routeComputeQuestion(q);
      assert.equal(r.needsInput, true, q);
      assert.equal(r.value, null, q);
      assert.match(r.text, /point load .* or a uniformly distributed load/s);
      assert.equal(composeRoutedReply(r), r.text, "a question back is not dressed as a computed answer");
    }
  });

  it("still refuses (null) when an input is missing, unchanged", () => {
    assert.equal(extractBeamQuestion("A simply supported beam 4 m long carries 10 kN/m. E = 200 GPa. Deflection?"), null, "no I");
    assert.equal(extractBeamQuestion("A beam 4 m long carries 10 kN/m, I = 1.0e-5 m^4, E = 200 GPa. Deflection?"), null, "no support");
  });
});

describe("beam regression: the numbers", () => {
  it("simply supported UDL: 16.67 mm and 20 kN·m, E and I exactly as submitted, nothing assumed", () => {
    const r = routeComputeQuestion(UDL_Q);
    assert.equal(r.route, "beam-deflection");
    assert.ok(near(r.deflectionMm, 16.666666666666668), String(r.deflectionMm));
    assert.notEqual(Number(r.deflectionMm.toFixed(2)), 2.68);
    assert.equal(r.deflectionMm.toFixed(2), "16.67");
    assert.equal(r.maxMomentKNm, 20);
    assert.deepEqual(r.used, { wNPerM: 10000, lengthM: 4, modulusPa: 200e9, inertiaM4: 1.0e-5, supportType: "simple" });
    assert.match(r.text, /16\.67 mm/);
    assert.match(r.text, /20 kN·m/);
    assert.match(r.text, /E = 200 GPa and I = 0\.00001 m⁴ exactly as given/);
    assert.deepEqual(r.assumed, []);
    assert.doesNotMatch(JSON.stringify(r), /section|default/i, "no assumed section or default anywhere in the output");
    assert.doesNotMatch(composeRoutedReply(r), /Assumed:/);
  });

  it("point load at midspan: P L^3 / 48 E I = 13.33 mm", () => {
    const r = routeComputeQuestion(POINT_Q);
    assert.equal(r.used.modulusE > 0, true);
    assert.equal((r.value * 25.4).toFixed(2), "13.33");
    const direct = beamDeflection({ loadLbs: 20000 / 4.4482216152605, lengthFt: 4 / 0.3048, modulusE: 200e9 / 6894.757293168, momentI: 1e-5 / 0.0254 ** 4 });
    assert.equal((direct.value * 25.4).toFixed(2), "13.33");
    assert.equal(r.deflectionMm, undefined, "the point path is unchanged");
    assert.doesNotMatch(JSON.stringify(r), /section/i);
    assert.deepEqual(r.assumed, []);
  });

  it("closed forms for all three supports against hand values", () => {
    const base = { wNPerM: 10000, lengthM: 4, modulusPa: 200e9, inertiaM4: 1e-5 };
    const cases = { simple: [5 / 384, 1 / 8], cantilever: [1 / 8, 1 / 2], fixed: [1 / 384, 1 / 12] };
    for (const [support, [k, m]] of Object.entries(cases)) {
      const r = beamUniformLoad({ ...base, supportType: support });
      assert.ok(near(r.deflectionM, (k * 10000 * 256) / (200e9 * 1e-5)), support);
      assert.ok(near(r.maxMomentNm, m * 10000 * 16), support);
    }
  });

  it("bad inputs fail, never default", () => {
    for (const bad of [{ wNPerM: 10000, lengthM: 4, modulusPa: 200e9, inertiaM4: 0 }, { wNPerM: -1, lengthM: 4, modulusPa: 200e9, inertiaM4: 1e-5 },
      { wNPerM: 1, lengthM: 4, modulusPa: 200e9, inertiaM4: 1e-5, supportType: "weird" }, {}]) {
      const r = beamUniformLoad(bad);
      assert.ok(typeof r.error === "string" && r.error && r.deflectionM === undefined, JSON.stringify(bad));
    }
  });
});

describe("no silent substitution", () => {
  const rawOk = (inputs = { E: { value: 200e9, unit: "Pa" } }) => ({ inputs, outputs: { x: { value: 1 } }, assumptions: [] });

  it("guard holds for EVERY registered solver: a substitution makes it NOT_COMPUTED, never computed", () => {
    const ids = listSolvers().map((s) => s.id);
    assert.ok(ids.length > 20, `expected the full registry, got ${ids.length}`);
    for (const id of ids) {
      const s = getSolver(id);
      const sub = envelope(s, "t", { ...rawOk(), substitutions: [{ name: "E", supplied: 210e9, used: 200e9 }] }, { runtimeMs: 0, revision: 1 });
      assert.equal(sub.status, "NOT_COMPUTED", id);
      assert.match(sub.reason, /^input_substituted:E \(supplied 210000000000, used 200000000000\)/, id);
      assert.deepEqual(sub.outputs, {}, `${id}: no number rides along with a refusal`);
      const echo = envelope(s, "t", rawOk(), { runtimeMs: 0, revision: 1, supplied: { E: 210e9 } });
      assert.equal(echo.status, "NOT_COMPUTED", `${id}: echoed input differs from the supplied one`);
      const ign = envelope(s, "t", rawOk(), { runtimeMs: 0, revision: 1, ignored: ["E"] });
      assert.match(ign.reason, /^input_not_used:E/, id);
      const same = envelope(s, "t", { ...rawOk(), substitutions: [{ name: "E", supplied: 200e9, used: 200e9 }] }, { runtimeMs: 0, revision: 1, supplied: { E: { value: 200e9 } } });
      assert.equal(same.status, "PASS", `${id}: using exactly what was supplied is fine`);
    }
  });

  it("guard is conservative about what it compares: other keys and unsupplied names are ignored", () => {
    assert.equal(inputIntegrityViolation(rawOk(), { supplied: { Q: 5 } }), null);
    assert.equal(inputIntegrityViolation(rawOk(), {}), null);
    assert.equal(inputIntegrityViolation(rawOk({ E: { value: "abc" } }), { supplied: { E: 200e9 } }) !== null, true, "a non-numeric echo of a supplied number is a mismatch");
    assert.equal(inputIntegrityViolation({ substitutions: [{ name: "I", supplied: 1, used: 2 }] }, {}).startsWith("input_substituted:I"), true);
  });

  it("beam.fea specifically: the E it echoes is the library E; a supplied different E is refused", () => {
    const o = openDesign({
      design: { id: "frame" },
      nodes: [{ id: "G1", kind: "Beam", material: "steel-a992", props: { support: "simply-supported" }, geometry: { shape: "i-beam", length: "4 m", height: "300 mm", flangeWidth: "150 mm", flangeThickness: "12 mm", webThickness: "8 mm" } }],
      loadCases: [{ id: "LC1", loads: [{ target: "G1", pointLoad: "60 kN" }] }],
    });
    assert.equal(o.ok, true);
    const e = o.session.result("beam.fea@G1");
    assert.equal(e.inputs.E.value, 200e9);
    const s = getSolver("beam.fea");
    const raw = { inputs: e.inputs, outputs: e.outputs, margins: [], warnings: [], assumptions: [] };
    assert.equal(envelope(s, "G1", raw, { runtimeMs: 0, revision: 1, supplied: { E: 200e9 } }).status !== "NOT_COMPUTED", true);
    const bad = envelope(s, "G1", raw, { runtimeMs: 0, revision: 1, supplied: { E: 210e9 } });
    assert.equal(bad.status, "NOT_COMPUTED");
    assert.match(bad.reason, /input_substituted:E \(supplied 210000000000, used 200000000000\)/);
  });

  it("design IR: a material E / yield / density the engine cannot apply is an error, not a silent library value", () => {
    const ir = (mat) => ({
      design: { id: "frame" },
      materials: { "steel-a992": mat },
      nodes: [{ id: "G1", kind: "Beam", material: "steel-a992", props: { support: "simply-supported" }, geometry: { shape: "i-beam", length: "4 m", height: "300 mm", flangeWidth: "150 mm", flangeThickness: "12 mm", webThickness: "8 mm" } }],
      loadCases: [{ id: "LC1", loads: [{ target: "G1", pointLoad: "60 kN" }] }],
    });
    for (const key of ["youngsModulusPa", "E", "yieldPa", "densityKgM3"]) {
      const o = openDesign(ir({ [key]: "210 GPa" }));
      assert.equal(o.ok, false, key);
      assert.match(JSON.stringify(o.errors), new RegExp(`materials\\.steel-a992\\.${key}: not usable`), key);
      assert.match(JSON.stringify(o.errors), /silently replace yours/, key);
    }
    assert.equal(openDesign(ir({ costPerKgUsd: "1 USD/kg", source: "quote" })).ok, true, "cost override still honoured");
    assert.equal(openDesign(ir({})).ok, true);
  });
});

describe("citations: domain-matched for solver answers, creative/music unchanged", () => {
  function setup() {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT, creator_id TEXT, scope TEXT NOT NULL DEFAULT 'public', lens_id TEXT, minted_by_provider TEXT, minted_by_model TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))");
    const ins = db.prepare("INSERT INTO dtus (id, title, content, creator_id, scope, lens_id) VALUES (?, ?, ?, ?, 'public', ?)");
    ins.run("m1", "Beam deflection of simply supported beams", "Euler-Bernoulli beam deflection under a distributed load", "c1", "mechanics");
    ins.run("m2", "Moment of inertia of an I-section", "beam second moment of area deflection", "c2", "engineering");
    ins.run("u1", "Beam of light: a pop song about deflection", "song lyrics about a beam and deflection of hearts", "c3", "music");
    ins.run("u2", "The beam story", "creative writing: a beam deflection metaphor", "c4", "creative");
    ins.run("u3", "Deflection beat pattern", "drum loop: deflection of the beam", "c5", "unknown");
    return db;
  }
  const Q = "beam deflection distributed load";

  it("engineering family: only mechanics / engineering DTUs, every id in the allowed set", () => {
    const db = setup();
    const rows = gatherSourcesForQuery(db, { query: Q, userId: null, limit: 10, domains: citationDomainsFor("engineering") });
    assert.deepEqual(rows.map((r) => r.id).sort(), ["m1", "m2"]);
    for (const r of rows) assert.ok(SOLVER_CITATION_DOMAINS.engineering.includes(r.lens_id), r.lens_id);
    const mech = gatherSourcesForQuery(db, { query: Q, userId: null, limit: 10, domains: ["mechanics"] });
    assert.deepEqual(mech.map((r) => r.id), ["m1"], "every cited DTU id is in the mechanics domain");
  });

  it("creative / music behaviour is unchanged: no solverDomain -> the same rows as before, music and creative included", () => {
    const db = setup();
    assert.equal(citationDomainsFor(undefined), null);
    assert.equal(citationDomainsFor(""), null);
    const rows = gatherSourcesForQuery(db, { query: Q, userId: null, limit: 10 });
    assert.deepEqual(rows.map((r) => r.id).sort(), ["m1", "m2", "u1", "u2", "u3"]);
    assert.equal("lens_id" in rows[0], false, "the unfiltered query is byte-for-byte the old query (no new column)");
    // and the unfiltered path still works on a table that has no lens_id column at all
    const bare = new Database(":memory:");
    bare.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT, creator_id TEXT, scope TEXT NOT NULL DEFAULT 'public', minted_by_provider TEXT, minted_by_model TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))");
    bare.prepare("INSERT INTO dtus (id, title, content, creator_id) VALUES ('x', 'song about beam', 'melody', 'c')").run();
    assert.equal(gatherSourcesForQuery(bare, { query: "song beam", limit: 5 }).length, 1);
  });

  // Production shape: `dtus` has NO scope column. Scope lives in the data blob (and the visibility column).
  function setupProdShape() {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT, creator_id TEXT, data TEXT, visibility TEXT DEFAULT 'private', lens_id TEXT, minted_by_provider TEXT, minted_by_model TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))");
    const ins = db.prepare("INSERT INTO dtus (id, title, content, creator_id, data, visibility, lens_id) VALUES (?, ?, ?, ?, ?, ?, ?)");
    ins.run("m1", "Beam deflection of simply supported beams", "Euler-Bernoulli beam deflection under a distributed load", "c1", JSON.stringify({ scope: "public" }), "private", "mechanics");
    ins.run("m2", "Moment of inertia of an I-section", "beam second moment of area deflection", "c2", "{}", "public", "engineering");
    ins.run("m3", "Private beam notes", "beam deflection personal notes", "c9", JSON.stringify({ scope: "personal" }), "private", "mechanics");
    ins.run("u1", "Beam of light: a pop song about deflection", "song lyrics about a beam and deflection of hearts", "c3", JSON.stringify({ meta: { scope: "public" } }), "private", "music");
    ins.run("u2", "The beam story", "creative writing: a beam deflection metaphor", "c4", "not json {", "marketplace", "creative");
    return db;
  }

  it("no scope column (prod schema): sources are non-empty, filtered AND unfiltered; personal rows stay out", () => {
    const db = setupProdShape();
    const all = gatherSourcesForQuery(db, { query: Q, userId: null, limit: 10 });
    assert.deepEqual(all.map((r) => r.id).sort(), ["m1", "m2", "u1", "u2"], "creative/music unfiltered, personal excluded");
    assert.ok(all.every((r) => r.scope === "public"));
    const eng = gatherSourcesForQuery(db, { query: Q, userId: null, limit: 10, domains: citationDomainsFor("engineering") });
    assert.deepEqual(eng.map((r) => r.id).sort(), ["m1", "m2"], "math/science/engineering filter still applies");
    assert.deepEqual(gatherSourcesForQuery(db, { query: Q, limit: 10, domains: citationDomainsFor("math") }), []);
    // the caller's own personal DTU is visible to them only
    const own = gatherSourcesForQuery(db, { query: Q, userId: "c9", limit: 10 });
    assert.ok(own.some((r) => r.id === "m3" && r.scope === "personal"));
    assert.ok(!gatherSourcesForQuery(db, { query: Q, userId: "c1", limit: 10 }).some((r) => r.id === "m3"));
  });

  it("an unknown family, or a family nothing matches, cites nothing", () => {
    const db = setup();
    assert.deepEqual(citationDomainsFor("astrology"), []);
    assert.deepEqual(gatherSourcesForQuery(db, { query: Q, limit: 10, domains: citationDomainsFor("astrology") }), []);
    assert.deepEqual(gatherSourcesForQuery(db, { query: "drum loop melody", limit: 10, domains: citationDomainsFor("math") }), []);
  });

  it("expertAnswer: a solver answer with only music/creative candidates ends in the honest refusal with no sources", async () => {
    const db = setup();
    const music = [{ id: "u1", title: "song", lens_id: "music", scope: "public", creator_id: "c3" }];
    const r = await expertAnswer({ db, userId: "u", query: "music loop melody", opts: { solverDomain: "engineering", refuseWhenNoSources: true, extraSources: music } });
    assert.equal(r.ok, true);
    assert.deepEqual(r.sources, []);
    assert.equal(r.citationsRecorded, 0);
    assert.match(r.answer, /do not address this question/);
  });
});

describe("design-intent layer (nlp-design-intent): a distributed load is never read as a point load", () => {
  it("'10 kN/m' / UDL stops with a reason; point loads and bare forces behave as before; mixed is ambiguous", async () => {
    const { parseDesignIntent } = await import("../lib/conkay/nlp-design-intent.js").then((m) => ({ parseDesignIntent: m.parseDesignIntent || m.parseIntent || Object.values(m).find((f) => typeof f === "function" && /^parse/i.test(f.name)) }));
    assert.equal(typeof parseDesignIntent, "function");
    const udl = parseDesignIntent("a 4 m simply supported steel beam carrying 10 kN/m");
    assert.equal(udl.ok, false);
    assert.equal(udl.code, "distributed_load_unsupported");
    assert.match(udl.error, /not a point load/);
    assert.equal(parseDesignIntent("a 4 m steel beam with a uniformly distributed load of 10 kN").code, "distributed_load_unsupported");
    assert.equal(parseDesignIntent("a 4 m simply supported beam, 20 kN point load at midspan and 10 kN/m").code, "ambiguous_load");
    const point = parseDesignIntent("a 4 m simply supported steel beam with a 20 kN point load at midspan");
    assert.equal(point.ok, true);
    assert.equal(point.intent.loads[0].forceN, -20000);
    assert.equal(parseDesignIntent("a 4 m simply supported steel beam carrying 20 kN").ok, true, "a bare force keeps its documented point-load default, disclosed as before");
  });
});
