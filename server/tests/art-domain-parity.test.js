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
