// Contract tests for the art Procreate + Krita 2026-parity drawing
// studio (layered stroke artworks, blend modes, brush presets,
// palettes + color harmony, reference boards, prompts).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerArtActions from "../domains/art.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`art.${name}`);
  assert.ok(fn, `art.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerArtActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
const STROKE = { tool: "ink", color: "#112233", size: 8, opacity: 0.9, points: [[10, 10], [20, 20], [30, 25]] };

function newArtwork(ctx = ctxA) {
  const r = call("artwork-create", ctx, { title: "Study", width: 800, height: 600 });
  assert.equal(r.ok, true);
  return r.result.artwork;
}

describe("art.artwork-*", () => {
  it("creates with a default layer, lists, renames and deletes", () => {
    const art = newArtwork();
    assert.equal(art.layers.length, 1);
    const list = call("artwork-list", ctxA, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.artworks[0].layerCount, 1);
    call("artwork-rename", ctxA, { id: art.id, title: "Final" });
    assert.equal(call("artwork-get", ctxA, { id: art.id }).result.artwork.title, "Final");
    call("artwork-delete", ctxA, { id: art.id });
    assert.equal(call("artwork-list", ctxA, {}).result.count, 0);
  });

  it("isolates artworks per user", () => {
    newArtwork(ctxA);
    assert.equal(call("artwork-list", ctxB, {}).result.count, 0);
  });

  it("rejects an oversized thumbnail and a non-data URL", () => {
    const art = newArtwork();
    assert.equal(call("artwork-save-thumbnail", ctxA, { id: art.id, thumbnail: "http://x/y.png" }).ok, false);
    const ok = call("artwork-save-thumbnail", ctxA, { id: art.id, thumbnail: "data:image/png;base64,AAAA" });
    assert.equal(ok.ok, true);
  });
});

describe("art.layer-*", () => {
  it("adds, updates blend mode/opacity, reorders and deletes layers", () => {
    const art = newArtwork();
    const l2 = call("layer-add", ctxA, { artworkId: art.id, name: "Ink" }).result.layer;
    const upd = call("layer-update", ctxA, { artworkId: art.id, layerId: l2.id, blendMode: "multiply", opacity: 0.5 });
    assert.equal(upd.result.layer.blendMode, "multiply");
    assert.equal(upd.result.layer.opacity, 0.5);
    const order = call("layer-reorder", ctxA, { artworkId: art.id, layerId: l2.id, direction: "down" });
    assert.equal(order.result.order[0], l2.id);
    call("layer-delete", ctxA, { artworkId: art.id, layerId: l2.id });
    assert.equal(call("artwork-get", ctxA, { id: art.id }).result.artwork.layers.length, 1);
  });

  it("refuses to delete the last layer", () => {
    const art = newArtwork();
    const r = call("layer-delete", ctxA, { artworkId: art.id, layerId: art.layers[0].id });
    assert.equal(r.ok, false);
  });

  it("rejects an invalid blend mode silently keeping the prior value", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("layer-update", ctxA, { artworkId: art.id, layerId: lid, blendMode: "not-real" });
    const layer = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0];
    assert.equal(layer.blendMode, "normal");
  });
});

describe("art strokes — the drawing loop", () => {
  it("commits a stroke and persists it on the layer", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const r = call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: STROKE });
    assert.equal(r.result.strokeCount, 1);
    const saved = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0];
    assert.equal(saved.tool, "ink");
    assert.equal(saved.points.length, 3);
  });

  it("rejects a stroke with no points", () => {
    const art = newArtwork();
    const r = call("stroke-commit", ctxA, { artworkId: art.id, layerId: art.layers[0].id, stroke: { tool: "ink", points: [] } });
    assert.equal(r.ok, false);
  });

  it("batch-commits, undoes the last stroke, and clears the layer", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const batch = call("stroke-batch", ctxA, { artworkId: art.id, layerId: lid, strokes: [STROKE, STROKE, STROKE] });
    assert.equal(batch.result.added, 3);
    const undo = call("stroke-undo", ctxA, { artworkId: art.id, layerId: lid });
    assert.equal(undo.result.strokeCount, 2);
    call("layer-clear", ctxA, { artworkId: art.id, layerId: lid });
    assert.equal(call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes.length, 0);
  });

  it("clamps an out-of-range tool to a safe default", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { ...STROKE, tool: "laser" } });
    const saved = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0];
    assert.equal(saved.tool, "ink");
  });
});

describe("art.brush-presets", () => {
  it("returns the brush library and blend modes", () => {
    const r = call("brush-presets", ctxA, {});
    assert.ok(r.result.brushes.length >= 6);
    assert.ok(r.result.blendModes.includes("multiply"));
  });
});

describe("art palettes & color theory", () => {
  it("creates and lists palettes, rejecting bad hex", () => {
    call("palette-create", ctxA, { name: "Sunset", colors: ["#ff8800", "#cc2244", "#221133"] });
    assert.equal(call("palette-list", ctxA, {}).result.count, 1);
    assert.equal(call("palette-create", ctxA, { name: "Bad", colors: ["red", "blue"] }).ok, false);
  });

  it("palette-harmony computes a complementary hue", () => {
    const r = call("palette-harmony", ctxA, { baseColor: "#ff0000", scheme: "complementary" });
    assert.equal(r.result.colors.length, 2);
    assert.equal(r.result.colors[0], "#ff0000");
    // complement of pure red is cyan
    assert.equal(r.result.colors[1], "#00ffff");
  });

  it("palette-harmony triadic returns three colors", () => {
    const r = call("palette-harmony", ctxA, { baseColor: "#3366cc", scheme: "triadic" });
    assert.equal(r.result.colors.length, 3);
  });

  it("color-mix lerps two colors at a ratio", () => {
    const r = call("color-mix", ctxA, { colorA: "#000000", colorB: "#ffffff", ratio: 0.5 });
    assert.equal(r.result.mixed, "#808080");
  });
});

describe("art reference boards", () => {
  it("creates a board, adds and removes references", () => {
    const board = call("reference-board-create", ctxA, { name: "Lighting" }).result.board;
    const ref = call("reference-add", ctxA, { boardId: board.id, imageUrl: "https://example.com/a.jpg", note: "rim light" }).result.ref;
    assert.equal(call("reference-board-list", ctxA, {}).result.boards[0].refs.length, 1);
    call("reference-remove", ctxA, { boardId: board.id, refId: ref.id });
    assert.equal(call("reference-board-list", ctxA, {}).result.boards[0].refs.length, 0);
  });

  it("rejects a non-http reference URL", () => {
    const board = call("reference-board-create", ctxA, { name: "X" }).result.board;
    assert.equal(call("reference-add", ctxA, { boardId: board.id, imageUrl: "ftp://x/y" }).ok, false);
  });
});

describe("art.art-prompt & dashboard", () => {
  it("returns a deterministic daily prompt", () => {
    const a = call("art-prompt", ctxA, {});
    const b = call("art-prompt", ctxA, {});
    assert.equal(a.result.prompt.text, b.result.prompt.text);
  });

  it("dashboard rolls up artworks, strokes and palettes", () => {
    const art = newArtwork();
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: art.layers[0].id, stroke: STROKE });
    call("palette-create", ctxA, { name: "P", colors: ["#123456"] });
    const d = call("art-dashboard", ctxA, {});
    assert.equal(d.result.artworks, 1);
    assert.equal(d.result.totalStrokes, 1);
    assert.equal(d.result.palettes, 1);
    assert.ok(d.result.promptOfTheDay.text);
  });
});

describe("art — generalised elements (fill, shapes, text)", () => {
  it("commits a fill, a rect and a text element", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { kind: "fill", color: "#ff0000", opacity: 1 } });
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { kind: "rect", color: "#00ff00", x: 10, y: 10, w: 100, h: 50, filled: true } });
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { kind: "text", color: "#0000ff", x: 20, y: 30, content: "Hello", fontSize: 40 } });
    const layer = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0];
    assert.equal(layer.strokes.length, 3);
    assert.equal(layer.strokes[0].kind, "fill");
    assert.equal(layer.strokes[1].kind, "rect");
    assert.equal(layer.strokes[2].content, "Hello");
  });

  it("rejects a text element with no content", () => {
    const art = newArtwork();
    const r = call("stroke-commit", ctxA, { artworkId: art.id, layerId: art.layers[0].id, stroke: { kind: "text", x: 1, y: 1 } });
    assert.equal(r.ok, false);
  });
});

describe("art — layer operations", () => {
  it("duplicates and merges layers", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: STROKE });
    const dup = call("layer-duplicate", ctxA, { artworkId: art.id, layerId: lid });
    assert.equal(dup.result.layer.strokeCount, 1);
    let aw = call("artwork-get", ctxA, { id: art.id }).result.artwork;
    assert.equal(aw.layers.length, 2);
    call("layer-merge-down", ctxA, { artworkId: art.id, layerId: aw.layers[1].id });
    aw = call("artwork-get", ctxA, { id: art.id }).result.artwork;
    assert.equal(aw.layers.length, 1);
    assert.equal(aw.layers[0].strokes.length, 2);
  });

  it("locks a layer and blocks edits", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("layer-update", ctxA, { artworkId: art.id, layerId: lid, locked: true });
    assert.equal(call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: STROKE }).ok, false);
  });

  it("transforms, flips and rotates a layer", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { tool: "ink", color: "#111111", size: 4, opacity: 1, points: [[100, 100], [200, 200]] } });
    call("layer-transform", ctxA, { artworkId: art.id, layerId: lid, dx: 50, dy: 0, scale: 1 });
    let pts = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0].points;
    assert.equal(pts[0][0], 150);
    call("layer-flip", ctxA, { artworkId: art.id, layerId: lid, axis: "horizontal" });
    call("layer-rotate90", ctxA, { artworkId: art.id, layerId: lid, direction: "cw" });
    pts = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0].points;
    assert.equal(pts.length, 2);
  });

  it("adjusts layer colours by hue/saturation/lightness", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { ...STROKE, color: "#ff0000" } });
    call("layer-adjust-color", ctxA, { artworkId: art.id, layerId: lid, hueShift: 180, satScale: 1, lightScale: 1 });
    const color = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0].color;
    assert.notEqual(color, "#ff0000");
  });
});

describe("art — selection delete, redo, canvas", () => {
  it("deletes selected elements by id", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const a = call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: STROKE }).result.strokeId;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: STROKE });
    call("element-delete", ctxA, { artworkId: art.id, layerId: lid, ids: [a] });
    assert.equal(call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes.length, 1);
  });

  it("undo then redo restores a stroke", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: STROKE });
    call("stroke-undo", ctxA, { artworkId: art.id, layerId: lid });
    assert.equal(call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes.length, 0);
    call("stroke-redo", ctxA, { artworkId: art.id, layerId: lid });
    assert.equal(call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes.length, 1);
  });

  it("resizes and flips the canvas", () => {
    const art = newArtwork();
    call("artwork-resize", ctxA, { id: art.id, width: 500, height: 400 });
    assert.equal(call("artwork-get", ctxA, { id: art.id }).result.artwork.width, 500);
    const r = call("artwork-flip", ctxA, { id: art.id, axis: "horizontal" });
    assert.equal(r.result.axis, "horizontal");
  });
});

describe("art — custom brush presets", () => {
  it("saves and lists a custom brush", () => {
    call("brush-preset-save", ctxA, { name: "My Inker", tool: "ink", size: 12, opacity: 0.8 });
    const r = call("brush-presets", ctxA, {});
    assert.ok(r.result.brushes.some((b) => b.name === "My Inker" && b.custom));
  });
});

// ─── Procreate / Krita parity backlog ───────────────────────────────

describe("art — raster filters", () => {
  it("applies a gaussian blur filter to a layer", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const r = call("layer-apply-filter", ctxA, { artworkId: art.id, layerId: lid, kind: "gaussian-blur", amount: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.result.filter.kind, "gaussian-blur");
    assert.equal(r.result.filter.amount, 12);
    assert.equal(r.result.filterCount, 1);
  });

  it("applies a liquify filter with a push vector", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const r = call("layer-apply-filter", ctxA, { artworkId: art.id, layerId: lid, kind: "liquify", cx: 100, cy: 100, dx: 30, dy: -10, radius: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.filter.dx, 30);
    assert.equal(r.result.filter.radius, 60);
  });

  it("rejects an unknown filter kind and clears filters", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    assert.equal(call("layer-apply-filter", ctxA, { artworkId: art.id, layerId: lid, kind: "warp" }).ok, false);
    call("layer-apply-filter", ctxA, { artworkId: art.id, layerId: lid, kind: "sharpen", amount: 2 });
    const cleared = call("layer-clear-filters", ctxA, { artworkId: art.id, layerId: lid });
    assert.equal(cleared.result.cleared, 1);
  });
});

describe("art — pressure dynamics", () => {
  it("sets and reads a dynamics profile", () => {
    const art = newArtwork();
    const set = call("dynamics-set", ctxA, { artworkId: art.id, pressureSize: true, pressureOpacity: true, sizeFloor: 0.1, smoothing: 0.5 });
    assert.equal(set.result.dynamics.pressureSize, true);
    const got = call("dynamics-get", ctxA, { artworkId: art.id });
    assert.equal(got.result.dynamics.sizeFloor, 0.1);
    assert.equal(got.result.dynamics.smoothing, 0.5);
  });

  it("commits a pressure stroke keeping per-point pressure triplets", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const r = call("stroke-commit-pressure", ctxA, {
      artworkId: art.id, layerId: lid,
      stroke: { tool: "ink", color: "#223344", size: 10, points: [[10, 10, 0.2], [20, 20, 0.8], [30, 30, 1]] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pointsKept, 3);
    const saved = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0];
    assert.equal(saved.pressure, true);
    assert.equal(saved.points[0][2], 0.2);
  });

  it("rejects a pressure stroke with no points", () => {
    const art = newArtwork();
    const r = call("stroke-commit-pressure", ctxA, { artworkId: art.id, layerId: art.layers[0].id, stroke: { points: [] } });
    assert.equal(r.ok, false);
  });
});

describe("art — free-angle layer rotation", () => {
  it("rotates a layer by an arbitrary angle about a pivot", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { tool: "ink", color: "#111111", size: 4, opacity: 1, points: [[400, 300]] } });
    const r = call("layer-rotate", ctxA, { artworkId: art.id, layerId: lid, degrees: 90, pivotX: 400, pivotY: 300 });
    assert.equal(r.ok, true);
    assert.equal(r.result.degrees, 90);
    // a point at the pivot stays at the pivot
    const pt = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0].points[0];
    assert.equal(pt[0], 400);
    assert.equal(pt[1], 300);
  });

  it("carries cumulative rotation on a rect element", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { kind: "rect", color: "#00ff00", x: 50, y: 50, w: 100, h: 60 } });
    call("layer-rotate", ctxA, { artworkId: art.id, layerId: lid, degrees: 45 });
    const el = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0];
    assert.equal(el.rotation, 45);
  });
});

describe("art — selection refinement", () => {
  it("lasso-selects elements inside a polygon", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const inId = call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { tool: "ink", color: "#111", size: 4, opacity: 1, points: [[100, 100]] } }).result.strokeId;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { tool: "ink", color: "#111", size: 4, opacity: 1, points: [[700, 500]] } });
    const r = call("selection-lasso", ctxA, { artworkId: art.id, layerId: lid, polygon: [[50, 50], [200, 50], [200, 200], [50, 200]] });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, 1);
    assert.deepEqual(r.result.selection.ids, [inId]);
  });

  it("magic-wand selects elements by color tolerance", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { tool: "ink", color: "#ff0000", size: 4, opacity: 1, points: [[10, 10]] } });
    call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { tool: "ink", color: "#0000ff", size: 4, opacity: 1, points: [[20, 20]] } });
    const r = call("selection-magic-wand", ctxA, { artworkId: art.id, layerId: lid, targetColor: "#fe0202", tolerance: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, 1);
  });

  it("feathers and clears the active selection", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("selection-lasso", ctxA, { artworkId: art.id, layerId: lid, polygon: [[0, 0], [100, 0], [100, 100]] });
    const f = call("selection-feather", ctxA, { artworkId: art.id, feather: 12 });
    assert.equal(f.result.selection.feather, 12);
    const c = call("selection-clear", ctxA, { artworkId: art.id });
    assert.equal(c.result.cleared, true);
  });

  it("rejects a lasso with fewer than 3 points", () => {
    const art = newArtwork();
    const r = call("selection-lasso", ctxA, { artworkId: art.id, layerId: art.layers[0].id, polygon: [[0, 0], [10, 10]] });
    assert.equal(r.ok, false);
  });
});

describe("art — symmetry & perspective guides", () => {
  it("sets a vertical symmetry guide and reads it back", () => {
    const art = newArtwork();
    const set = call("guides-set", ctxA, { artworkId: art.id, kind: "vertical" });
    assert.equal(set.result.guides.kind, "vertical");
    const got = call("guides-get", ctxA, { artworkId: art.id });
    assert.equal(got.result.guides.kind, "vertical");
    assert.ok(got.result.kinds.includes("radial"));
  });

  it("sets a 2-point perspective guide with vanishing points", () => {
    const art = newArtwork();
    const r = call("guides-set", ctxA, { artworkId: art.id, kind: "perspective-2pt", vp1x: 100, vp1y: 300, vp2x: 700, vp2y: 300 });
    assert.equal(r.result.guides.vp1.x, 100);
    assert.equal(r.result.guides.vp2.x, 700);
  });

  it("mirrors a stroke across a vertical symmetry guide", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("guides-set", ctxA, { artworkId: art.id, kind: "vertical", cx: 400 });
    const sid = call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { tool: "ink", color: "#111", size: 4, opacity: 1, points: [[100, 100], [150, 200]] } }).result.strokeId;
    const r = call("symmetry-mirror-stroke", ctxA, { artworkId: art.id, layerId: lid, strokeId: sid });
    assert.equal(r.result.mirrored, 1);
    const layer = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0];
    assert.equal(layer.strokes.length, 2);
    // mirror of x=100 about cx=400 is x=700
    assert.equal(layer.strokes[1].points[0][0], 700);
  });

  it("radial guide mirrors into multiple sectors", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("guides-set", ctxA, { artworkId: art.id, kind: "radial", sectors: 6 });
    const sid = call("stroke-commit", ctxA, { artworkId: art.id, layerId: lid, stroke: { tool: "ink", color: "#111", size: 4, opacity: 1, points: [[500, 400]] } }).result.strokeId;
    const r = call("symmetry-mirror-stroke", ctxA, { artworkId: art.id, layerId: lid, strokeId: sid });
    assert.equal(r.result.mirrored, 5);
  });
});

describe("art — timelapse recording", () => {
  it("records, scrubs and stops a timelapse", () => {
    const art = newArtwork();
    const start = call("timelapse-start", ctxA, { artworkId: art.id });
    assert.equal(start.result.recording, true);
    call("timelapse-frame", ctxA, { artworkId: art.id, snapshot: "data:image/png;base64,AAAA" });
    call("timelapse-frame", ctxA, { artworkId: art.id, snapshot: "data:image/png;base64,BBBB" });
    const got = call("timelapse-get", ctxA, { artworkId: art.id });
    assert.equal(got.result.frameCount, 2);
    const stop = call("timelapse-stop", ctxA, { artworkId: art.id });
    assert.equal(stop.result.recording, false);
    assert.equal(stop.result.frameCount, 2);
  });

  it("rejects a frame when not recording and clears frames", () => {
    const art = newArtwork();
    assert.equal(call("timelapse-frame", ctxA, { artworkId: art.id, snapshot: "data:image/png;base64,AAAA" }).ok, false);
    call("timelapse-start", ctxA, { artworkId: art.id });
    call("timelapse-frame", ctxA, { artworkId: art.id, snapshot: "data:image/png;base64,AAAA" });
    const cleared = call("timelapse-clear", ctxA, { artworkId: art.id });
    assert.equal(cleared.result.cleared, 1);
  });
});

describe("art — gradient & pattern fills", () => {
  it("commits a linear gradient with sorted color stops", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const r = call("gradient-commit", ctxA, {
      artworkId: art.id, layerId: lid, gradientKind: "linear",
      stops: [{ color: "#ffffff", offset: 1 }, { color: "#000000", offset: 0 }],
      x1: 0, y1: 0, x2: 800, y2: 0,
    });
    assert.equal(r.ok, true);
    const el = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0];
    assert.equal(el.kind, "gradient");
    assert.equal(el.stops[0].offset, 0);
    assert.equal(el.stops[0].color, "#000000");
  });

  it("rejects a gradient with fewer than 2 valid stops", () => {
    const art = newArtwork();
    const r = call("gradient-commit", ctxA, { artworkId: art.id, layerId: art.layers[0].id, stops: [{ color: "#fff", offset: 0 }] });
    assert.equal(r.ok, false);
  });

  it("commits a pattern fill element", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const r = call("pattern-fill-commit", ctxA, {
      artworkId: art.id, layerId: lid, patternKind: "checker",
      foreground: "#222222", background: "#eeeeee", scale: 24,
    });
    assert.equal(r.ok, true);
    const el = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[0];
    assert.equal(el.kind, "pattern");
    assert.equal(el.patternKind, "checker");
    assert.equal(el.scale, 24);
  });

  it("pattern-kinds lists all available fill/filter/guide kinds", () => {
    const r = call("pattern-kinds", ctxA, {});
    assert.ok(r.result.patternKinds.includes("dots"));
    assert.ok(r.result.gradientKinds.includes("radial"));
    assert.ok(r.result.filterKinds.includes("liquify"));
    assert.ok(r.result.guideKinds.includes("perspective-2pt"));
  });

  it("commits a radial gradient and a bounded pattern fill", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    const g = call("gradient-commit", ctxA, {
      artworkId: art.id, layerId: lid, gradientKind: "radial",
      stops: [{ color: "#ff0000", offset: 0 }, { color: "#0000ff", offset: 1 }],
    });
    assert.equal(g.ok, true);
    const p = call("pattern-fill-commit", ctxA, {
      artworkId: art.id, layerId: lid, patternKind: "crosshatch",
      foreground: "#101010", scale: 8, x: 10, y: 10, w: 100, h: 80,
    });
    assert.equal(p.ok, true);
    const el = call("artwork-get", ctxA, { id: art.id }).result.artwork.layers[0].strokes[1];
    assert.equal(el.kind, "pattern");
    assert.equal(el.w, 100);
  });
});

describe("art — pro tools cross-cutting invariants", () => {
  it("rejects pro-tool macros against an unknown artwork", () => {
    assert.equal(call("layer-apply-filter", ctxA, { artworkId: "nope", layerId: "x", kind: "sharpen" }).ok, false);
    assert.equal(call("layer-rotate", ctxA, { artworkId: "nope", layerId: "x", degrees: 30 }).ok, false);
    assert.equal(call("guides-set", ctxA, { artworkId: "nope", kind: "vertical" }).ok, false);
    assert.equal(call("timelapse-start", ctxA, { artworkId: "nope" }).ok, false);
  });

  it("blocks pro edits on a locked layer", () => {
    const art = newArtwork();
    const lid = art.layers[0].id;
    call("layer-update", ctxA, { artworkId: art.id, layerId: lid, locked: true });
    assert.equal(call("layer-apply-filter", ctxA, { artworkId: art.id, layerId: lid, kind: "sharpen" }).ok, false);
    assert.equal(call("layer-rotate", ctxA, { artworkId: art.id, layerId: lid, degrees: 30 }).ok, false);
    assert.equal(call("gradient-commit", ctxA, {
      artworkId: art.id, layerId: lid,
      stops: [{ color: "#000000", offset: 0 }, { color: "#ffffff", offset: 1 }],
    }).ok, false);
  });

  it("isolates pro state per user", () => {
    const artA = newArtwork(ctxA);
    call("guides-set", ctxA, { artworkId: artA.id, kind: "radial", sectors: 6 });
    // user B cannot see or mutate user A's artwork
    assert.equal(call("guides-get", ctxB, { artworkId: artA.id }).ok, false);
  });
});
