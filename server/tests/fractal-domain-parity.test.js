// Contract tests for server/domains/fractal.js — analytical macros
// (fractalDimension / selfSimilarity / complexityMeasure) plus the
// escape-time fractal renderer suite (render / orbit / paletteFor /
// presets / zoomPath / mandelbulb / render history).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFractalActions from "../domains/fractal.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`fractal.${name}`);
  if (!fn) throw new Error(`fractal.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerFractalActions(register); });

beforeEach(() => {
  // fresh in-memory STATE per test so preset/render persistence is isolated
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// --- analytical macros -------------------------------------------------------

describe("fractal.fractalDimension (box-counting)", () => {
  it("computes dimension for a 2D point set", () => {
    const points = [];
    for (let i = 0; i < 200; i++) {
      points.push({ x: Math.cos(i) * (i / 200), y: Math.sin(i) * (i / 200) });
    }
    const r = call("fractalDimension", ctxA, { data: { points } }, { method: "box-counting" });
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "box-counting");
    assert.ok(r.result.fractalDimension > 0);
  });

  it("rejects too few points", () => {
    const r = call("fractalDimension", ctxA, { data: { points: [{ x: 0, y: 0 }] } }, { method: "box-counting" });
    assert.equal(r.ok, false);
  });

  it("computes Hurst exponent for a time series", () => {
    const values = Array.from({ length: 64 }, (_, i) => Math.sin(i / 3) + i * 0.01);
    const r = call("fractalDimension", ctxA, { data: { values } }, { method: "hurst" });
    assert.equal(r.ok, true);
    assert.equal(r.result.method, "hurst-exponent");
    assert.ok(typeof r.result.hurstExponent === "number");
  });
});

describe("fractal.selfSimilarity + complexityMeasure", () => {
  it("detects self-similarity in a periodic signal", () => {
    const values = Array.from({ length: 64 }, (_, i) => Math.sin(i / 4));
    const r = call("selfSimilarity", ctxA, { data: { values } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.scalesAnalyzed >= 1);
  });

  it("measures complexity of a symbol sequence", () => {
    const r = call("complexityMeasure", ctxA, { data: { sequence: "abcabcabcabc" } }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.lempelZiv.complexity > 0);
    assert.ok(r.result.shannonEntropy.value >= 0);
  });
});

// --- renderer: paletteFor ----------------------------------------------------

describe("fractal.paletteFor", () => {
  it("samples a named palette into N RGB swatches", () => {
    const r = call("paletteFor", ctxA, {}, { palette: "fire", steps: 16 });
    assert.equal(r.ok, true);
    assert.equal(r.result.steps, 16);
    assert.equal(r.result.swatches.length, 16);
    assert.match(r.result.swatches[0].hex, /^#[0-9a-f]{6}$/);
    assert.ok(r.result.availablePalettes.includes("spectral"));
  });

  it("falls back to spectral for an unknown palette", () => {
    const r = call("paletteFor", ctxA, {}, { palette: "nope" });
    assert.equal(r.ok, true);
    assert.equal(r.result.palette, "spectral");
  });

  it("accepts custom colour stops", () => {
    const r = call("paletteFor", ctxA, {}, { stops: [[0, 0, 0], [255, 255, 255]], steps: 8 });
    assert.equal(r.ok, true);
    assert.equal(r.result.palette, "custom");
  });
});

// --- renderer: render --------------------------------------------------------

describe("fractal.render", () => {
  it("computes a Mandelbrot iteration grid", () => {
    const r = call("render", ctxA, {}, { type: "mandelbrot", width: 40, height: 40, maxIter: 80 });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "mandelbrot");
    assert.equal(r.result.grid.length, 40);
    assert.equal(r.result.grid[0].length, 40);
    assert.equal(r.result.stats.pixels, 1600);
    assert.ok(r.result.stats.insideSet > 0);
  });

  it("computes a Julia set with explicit c", () => {
    const r = call("render", ctxA, {}, {
      type: "julia", width: 32, height: 32, maxIter: 100, juliaRe: -0.8, juliaIm: 0.156,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.type, "julia");
    assert.equal(r.result.juliaRe, -0.8);
  });

  it("supports burning-ship, tricorn and multibrot", () => {
    for (const type of ["burning-ship", "tricorn", "multibrot"]) {
      const r = call("render", ctxA, {}, { type, width: 24, height: 24, maxIter: 60, power: 3 });
      assert.equal(r.ok, true, `${type} should render`);
      assert.equal(r.result.type, type);
    }
  });
});

// --- renderer: orbit ---------------------------------------------------------

describe("fractal.orbit", () => {
  it("traces an in-set orbit at the origin", () => {
    const r = call("orbit", ctxA, {}, { type: "mandelbrot", x: 0, y: 0, maxIter: 200 });
    assert.equal(r.ok, true);
    assert.equal(r.result.inSet, true);
    assert.ok(Array.isArray(r.result.orbit));
  });

  it("traces an escaping orbit far outside the set", () => {
    const r = call("orbit", ctxA, {}, { type: "mandelbrot", x: 2, y: 2, maxIter: 200 });
    assert.equal(r.ok, true);
    assert.equal(r.result.escaped, true);
    assert.ok(r.result.iterations < 200);
  });
});

// --- renderer: preset persistence -------------------------------------------

describe("fractal preset persistence", () => {
  it("saves, lists, exports, imports and deletes presets per user", () => {
    const cfg = { type: "julia", centerX: 0, centerY: 0, scale: 0.005, maxIter: 300, palette: "ice" };
    const saved = call("savePreset", ctxA, {}, { name: "My Julia", config: cfg });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.preset.name, "My Julia");
    const id = saved.result.preset.id;

    const listed = call("listPresets", ctxA, {}, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);

    const exported = call("exportPreset", ctxA, {}, { id });
    assert.equal(exported.ok, true);
    assert.equal(exported.result.payload.spec, "concord-fractal-preset/v1");
    assert.ok(typeof exported.result.json === "string");

    const imported = call("importPreset", ctxA, {}, { payload: exported.result.json });
    assert.equal(imported.ok, true);
    assert.equal(imported.result.preset.imported, true);

    const deleted = call("deletePreset", ctxA, {}, { id });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.result.count, 1); // imported copy remains
  });

  it("requires a preset name", () => {
    const r = call("savePreset", ctxA, {}, { config: {} });
    assert.equal(r.ok, false);
  });

  it("isolates presets between users", () => {
    call("savePreset", ctxA, {}, { name: "A preset", config: {} });
    const bList = call("listPresets", ctxB, {}, {});
    assert.equal(bList.ok, true);
    assert.equal(bList.result.count, 0);
  });

  it("rejects invalid import payloads", () => {
    const r = call("importPreset", ctxA, {}, { payload: "not json{" });
    assert.equal(r.ok, false);
  });
});

// --- renderer: render history -----------------------------------------------

describe("fractal render history", () => {
  it("records and lists high-resolution exports", () => {
    const rec = call("recordRender", ctxA, {}, {
      type: "mandelbrot", width: 1920, height: 1080, format: "PNG", dataUrlLength: 204800,
    });
    assert.equal(rec.ok, true);
    assert.equal(rec.result.render.width, 1920);

    const list = call("listRenders", ctxA, {}, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
  });
});

// --- renderer: zoomPath + mandelbulb ----------------------------------------

describe("fractal.zoomPath", () => {
  it("interpolates a deep-zoom animation path", () => {
    const r = call("zoomPath", ctxA, {}, {
      from: { centerX: -0.5, centerY: 0, scale: 0.01 },
      to: { centerX: -0.743, centerY: 0.126, scale: 0.0000001 },
      frames: 24,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.frames, 24);
    assert.equal(r.result.path.length, 24);
    assert.ok(r.result.totalZoom > 1);
    // scale must shrink monotonically (geometric interpolation)
    assert.ok(r.result.path[0].scale > r.result.path[23].scale);
  });
});

describe("fractal.mandelbulb", () => {
  it("samples a 3D Mandelbulb distance field as z-slices", () => {
    const r = call("mandelbulb", ctxA, {}, { power: 8, maxIter: 6, resolution: 16, slices: 6 });
    assert.equal(r.ok, true);
    assert.equal(r.result.slices, 6);
    assert.equal(r.result.field.length, 6);
    assert.equal(r.result.field[0].cells.length, 16);
    assert.ok(r.result.surfaceVoxels >= 0);
  });
});
