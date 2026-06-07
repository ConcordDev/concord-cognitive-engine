// tests/depth/art-behavior.test.js — REAL behavioral tests for the `art`
// domain (visual-art studio lens; registerLensAction family, via lensRun).
// Exact-value assertions on the deterministic color-theory + composition math
// (colorHarmony harmony detection, color-mix interpolation, palette-harmony
// scheme generation, generatePalette, compositionScore golden/thirds/balance,
// styleClassify nearest-profile match) + the in-memory studio CRUD round-trips
// (artwork create→list→rename→delete, layer add/duplicate/merge, stroke
// commit→undo→redo, palette + reference-board CRUD) + validation rejections.
//
// SKIPPED (need network/LLM, fail under no-egress): `vision` (LLaVA),
// `met-search` / `met-object` (Metropolitan Museum API), `aic-search`
// (Art Institute of Chicago API). All deterministic compute/CRUD below.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("art — color theory & composition math (exact values)", () => {
  it("colorHarmony: red+cyan (hue dist 180) is detected as complementary", async () => {
    const r = await lensRun("art", "colorHarmony", { data: { palette: ["#ff0000", "#00ffff"] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.paletteSize, 2);
    const comp = r.result.harmonies.find((h) => h.type === "complementary");
    assert.ok(comp, "expected a complementary harmony");
    assert.equal(comp.hueDistance, 180);
    assert.deepEqual(comp.colors, ["#ff0000", "#00ffff"]);
  });

  it("colorHarmony: two near hues (#ff0000, #ff1900) register as analogous, temperature warm", async () => {
    const r = await lensRun("art", "colorHarmony", { data: { palette: ["#ff0000", "#ff1900"] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.harmonies.some((h) => h.type === "analogous"));
    assert.equal(r.result.temperature, "warm");
  });

  it("color-mix: 50% between black and white interpolates to #808080", async () => {
    const r = await lensRun("art", "color-mix", { params: { colorA: "#000000", colorB: "#ffffff", ratio: 0.5 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.mixed, "#808080");
    assert.equal(r.result.ratio, 0.5);
  });

  it("color-mix: ratio 0 returns colorA exactly (#112233)", async () => {
    const r = await lensRun("art", "color-mix", { params: { colorA: "#112233", colorB: "#ffffff", ratio: 0 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.mixed, "#112233");
  });

  it("palette-harmony: complementary of pure red yields [#ff0000, #00ffff]", async () => {
    const r = await lensRun("art", "palette-harmony", { params: { baseColor: "#ff0000", scheme: "complementary" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.scheme, "complementary");
    assert.deepEqual(r.result.colors, ["#ff0000", "#00ffff"]);
  });

  it("palette-harmony: triadic of red produces 3 colors incl. green & blue primaries", async () => {
    const r = await lensRun("art", "palette-harmony", { params: { baseColor: "#ff0000", scheme: "triadic" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.colors.length, 3);
    assert.equal(r.result.colors[0], "#ff0000");
    assert.ok(r.result.colors.includes("#00ff00"));
    assert.ok(r.result.colors.includes("#0000ff"));
  });

  it("generatePalette: complementary palette starts with the base + its complement", async () => {
    const r = await lensRun("art", "generatePalette", { params: { baseColor: "#3498db", harmony: "complementary", count: 5 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.palette.length, 5);
    assert.equal(r.result.palette[0].role, "base");
    assert.equal(r.result.palette[1].role, "complement");
    // base hue ~204, complement is 180° around
    assert.equal(r.result.palette[1].hsl.h, (204 + 180) % 360);
  });

  it("compositionScore: a dead-centered element scores balance 100 with center-of-mass at canvas centre", async () => {
    const r = await lensRun("art", "compositionScore", {
      data: {
        canvas: { width: 1000, height: 1000 },
        elements: [{ x: 475, y: 475, width: 50, height: 50 }],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.scores.balance, 100);
    assert.deepEqual(r.result.centerOfMass, { x: 500, y: 500 });
    assert.equal(r.result.elementCount, 1);
  });

  it("styleClassify: input matching the Realism profile exactly yields 100% similarity / high confidence", async () => {
    const r = await lensRun("art", "styleClassify", {
      data: {
        attributes: {
          brushwork: 30, colorSaturation: 50, contrast: 60, perspective: 80,
          detail: 90, abstraction: 10, lineWeight: 40, texture: 50,
        },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.topMatch.style, "Realism");
    assert.equal(r.result.topMatch.similarity, 100);
    assert.equal(r.result.confidence, "high");
  });
});

describe("art — studio CRUD round-trips", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`art-crud-${randomUUID()}`); });

  it("artwork-create → artwork-list → artwork-rename → artwork-delete round-trip", async () => {
    const created = await lensRun("art", "artwork-create", { params: { title: "Sketch", width: 800, height: 600 } }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.artwork.id;
    assert.equal(created.result.artwork.width, 800);
    assert.equal(created.result.artwork.layers.length, 1);

    const list = await lensRun("art", "artwork-list", {}, ctx);
    assert.ok(list.result.artworks.some((a) => a.id === id && a.title === "Sketch"));

    const renamed = await lensRun("art", "artwork-rename", { params: { id, title: "Final" } }, ctx);
    assert.equal(renamed.result.title, "Final");

    const after = await lensRun("art", "artwork-list", {}, ctx);
    assert.ok(after.result.artworks.find((a) => a.id === id).title === "Final");

    const del = await lensRun("art", "artwork-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const gone = await lensRun("art", "artwork-list", {}, ctx);
    assert.ok(!gone.result.artworks.some((a) => a.id === id));
  });

  it("layer-add → layer-duplicate → layer-merge-down keeps a consistent layer count", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Layers" } }, ctx);
    const artworkId = art.result.artwork.id;
    const baseLayerId = art.result.artwork.layers[0].id;

    const added = await lensRun("art", "layer-add", { params: { artworkId, name: "Top" } }, ctx);
    assert.equal(added.ok, true);
    const newLayerId = added.result.layer.id;

    // put a stroke on the new layer so merge has something to fold
    const sc = await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId: newLayerId, stroke: { tool: "ink", color: "#123456", points: [[1, 1], [2, 2]] } },
    }, ctx);
    assert.equal(sc.result.strokeCount, 1);

    const dup = await lensRun("art", "layer-duplicate", { params: { artworkId, layerId: newLayerId } }, ctx);
    assert.equal(dup.result.layer.strokeCount, 1);

    // artwork now has 3 layers: base, Top, "Top copy"
    const got = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    assert.equal(got.result.artwork.layers.length, 3);

    const merge = await lensRun("art", "layer-merge-down", { params: { artworkId, layerId: newLayerId } }, ctx);
    assert.equal(merge.ok, true);
    // base layer absorbed Top's stroke
    assert.ok(merge.result.mergedInto === baseLayerId);
    assert.equal(merge.result.strokeCount, 1);
  });

  it("stroke-commit → stroke-undo → stroke-redo restores the same stroke id", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Undo" } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;

    const committed = await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "pencil", color: "#abcdef", points: [[10, 10], [20, 20]] } },
    }, ctx);
    const strokeId = committed.result.strokeId;
    assert.equal(committed.result.strokeCount, 1);

    const undone = await lensRun("art", "stroke-undo", { params: { artworkId, layerId } }, ctx);
    assert.equal(undone.result.removed, strokeId);
    assert.equal(undone.result.strokeCount, 0);

    const redone = await lensRun("art", "stroke-redo", { params: { artworkId, layerId } }, ctx);
    assert.equal(redone.result.restored, strokeId);
    assert.equal(redone.result.strokeCount, 1);
  });

  it("palette-create filters to valid hex colors → palette-list reads it back → palette-delete", async () => {
    const created = await lensRun("art", "palette-create", {
      params: { name: "Sunset", colors: ["#ff8800", "not-a-hex", "#aa0044"] },
    }, ctx);
    assert.equal(created.ok, true);
    // invalid color stripped → only the 2 valid hexes survive
    assert.deepEqual(created.result.palette.colors, ["#ff8800", "#aa0044"]);
    const palId = created.result.palette.id;

    const list = await lensRun("art", "palette-list", {}, ctx);
    assert.ok(list.result.palettes.some((p) => p.id === palId && p.name === "Sunset"));

    const del = await lensRun("art", "palette-delete", { params: { id: palId } }, ctx);
    assert.equal(del.result.deleted, palId);
  });

  it("reference-board-create → reference-add → reference-board-list shows the added ref", async () => {
    const board = await lensRun("art", "reference-board-create", { params: { name: "Mood" } }, ctx);
    assert.equal(board.ok, true);
    const boardId = board.result.board.id;

    const add = await lensRun("art", "reference-add", {
      params: { boardId, imageUrl: "https://example.com/ref.jpg", note: "lighting" },
    }, ctx);
    assert.equal(add.ok, true);
    const refId = add.result.ref.id;

    const list = await lensRun("art", "reference-board-list", {}, ctx);
    const found = list.result.boards.find((b) => b.id === boardId);
    assert.ok(found.refs.some((r) => r.id === refId && r.imageUrl === "https://example.com/ref.jpg"));
  });
});

describe("art — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`art-reject-${randomUUID()}`); });

  it("palette-create with no valid hex colors is rejected", async () => {
    const bad = await lensRun("art", "palette-create", { params: { name: "Bad", colors: ["nope", "#xyz"] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /valid hex color required/);
  });

  it("palette-harmony with a non-hex baseColor is rejected", async () => {
    const bad = await lensRun("art", "palette-harmony", { params: { baseColor: "blue", scheme: "triadic" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /baseColor must be a #rrggbb hex/);
  });

  it("reference-add with a non-http imageUrl is rejected", async () => {
    const board = await lensRun("art", "reference-board-create", { params: { name: "Board" } }, ctx);
    const boardId = board.result.board.id;
    const bad = await lensRun("art", "reference-add", { params: { boardId, imageUrl: "ftp://nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /imageUrl must be an http\(s\) URL/);
  });
});

// ── Wave 10 top-up ──────────────────────────────────────────────────────
// 15 NEW behavioral tests for deterministic art macros NOT covered above:
// more color/geometry math (color-mix interpolation, palette-harmony
// tetradic, pattern-kinds catalog) + geometric layer transforms with EXACT
// resulting coordinates (layer-flip, layer-rotate90, layer-rotate free-angle,
// layer-adjust-color, stroke-batch, element-delete, layer-reorder) +
// selection math (lasso point-in-polygon, magic-wand ΔE) + symmetry mirror
// + CRUD round-trips (brush presets, art prompts, dynamics, timelapse, gradient).
// SKIPPED still: vision (LLaVA), met-search/met-object/aic-search (museum APIs).
describe("art — color & geometry math (wave 10 top-up)", () => {
  it("color-mix: ratio 0.25 between red and blue lands at #bf0040 (exact channel interp)", async () => {
    const r = await lensRun("art", "color-mix", { params: { colorA: "#ff0000", colorB: "#0000ff", ratio: 0.25 } });
    assert.equal(r.ok, true);
    // r: 255 + (0-255)*0.25 = 191.25 → 191 = bf ; b: 0 + 255*0.25 = 63.75 → 64 = 40
    assert.equal(r.result.mixed, "#bf0040");
    assert.equal(r.result.ratio, 0.25);
  });

  it("palette-harmony: tetradic of pure red yields the 4 90°-stepped hues", async () => {
    const r = await lensRun("art", "palette-harmony", { params: { baseColor: "#ff0000", scheme: "tetradic" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.scheme, "tetradic");
    assert.deepEqual(r.result.colors, ["#ff0000", "#80ff00", "#00ffff", "#8000ff"]);
  });

  it("palette-harmony: monochromatic of red produces 5 same-hue lightness steps (all reds)", async () => {
    const r = await lensRun("art", "palette-harmony", { params: { baseColor: "#ff0000", scheme: "monochromatic" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.colors.length, 5);
    // every step is a pure-hue red (g === b, r dominant); lightness ascends so darkest < lightest
    assert.ok(r.result.colors.every((c) => c.slice(3, 5) === c.slice(5, 7)));
    assert.notEqual(r.result.colors[0], r.result.colors[4]);
  });

  it("pattern-kinds: returns the four canonical catalog arrays", async () => {
    const r = await lensRun("art", "pattern-kinds", {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.patternKinds, ["dots", "grid", "diagonal", "checker", "crosshatch"]);
    assert.deepEqual(r.result.gradientKinds, ["linear", "radial"]);
    assert.ok(r.result.filterKinds.includes("gaussian-blur"));
    assert.ok(r.result.guideKinds.includes("perspective-2pt"));
  });
});

describe("art — geometric layer transforms (exact coords, wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`art-t10-geo-${randomUUID()}`); });

  // Helper: fresh 1000×1000 artwork with one stroke at known coords.
  async function freshArt(points) {
    const art = await lensRun("art", "artwork-create", { params: { title: "Geo", width: 1000, height: 1000 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "ink", color: "#102030", points } },
    }, ctx);
    return { artworkId, layerId };
  }

  it("layer-flip horizontal mirrors x about the canvas width (200,300 → 800,300)", async () => {
    const { artworkId, layerId } = await freshArt([[200, 300], [200, 700]]);
    const r = await lensRun("art", "layer-flip", { params: { artworkId, layerId, axis: "horizontal" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.axis, "horizontal");
    const got = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    const stroke = got.result.artwork.layers[0].strokes[0];
    // x' = width - x = 1000 - 200 = 800 ; y unchanged
    assert.deepEqual(stroke.points, [[800, 300], [800, 700]]);
  });

  it("layer-rotate90 cw maps (x,y) about centre: (200,300) → (700,200)", async () => {
    const { artworkId, layerId } = await freshArt([[200, 300]]);
    const r = await lensRun("art", "layer-rotate90", { params: { artworkId, layerId, direction: "cw" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.direction, "cw");
    const got = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    // cw: [cx-(y-cy), cy+(x-cx)] = [500-(300-500), 500+(200-500)] = [700, 200]
    assert.deepEqual(got.result.artwork.layers[0].strokes[0].points, [[700, 200]]);
  });

  it("layer-rotate free-angle 180° about centre negates the offset: (300,400) → (700,600)", async () => {
    const { artworkId, layerId } = await freshArt([[300, 400]]);
    const r = await lensRun("art", "layer-rotate", { params: { artworkId, layerId, degrees: 180 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.degrees, 180);
    assert.equal(r.result.rotated, 1);
    const got = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    // 180° about (500,500): (300,400) → (1000-300, 1000-400) = (700,600)
    assert.deepEqual(got.result.artwork.layers[0].strokes[0].points, [[700, 600]]);
  });

  it("layer-adjust-color: lightScale 2 on #404040 doubles lightness toward grey (#808080)", async () => {
    // clean artwork with ONLY a mid-grey stroke so we control the sole input color
    const art = await lensRun("art", "artwork-create", { params: { title: "Adjust", width: 1000, height: 1000 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "ink", color: "#404040", points: [[5, 5]] } },
    }, ctx);
    const r = await lensRun("art", "layer-adjust-color", { params: { artworkId, layerId, lightScale: 2 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.adjusted, 1);
    const got = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    // #404040 → hsl l = 0x40/255 ≈ 0.2510 ; ×2 = 0.502 ; grey (sat 0) → round(0.502*255)=128 = 0x80
    assert.equal(got.result.artwork.layers[0].strokes[0].color, "#808080");
  });
});

describe("art — strokes, selections, symmetry (wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`art-t10-stroke-${randomUUID()}`); });

  it("stroke-batch commits multiple strokes; element-delete removes a chosen one by id", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Batch", width: 500, height: 500 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    const batch = await lensRun("art", "stroke-batch", {
      params: {
        artworkId, layerId, strokes: [
          { tool: "ink", color: "#111111", points: [[1, 1], [2, 2]] },
          { tool: "ink", color: "#222222", points: [[3, 3], [4, 4]] },
          { kind: "text", color: "#333333", content: "hi", x: 10, y: 10 },
        ],
      },
    }, ctx);
    assert.equal(batch.result.added, 3);
    assert.equal(batch.result.strokeCount, 3);

    const got = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    const victimId = got.result.artwork.layers[0].strokes[1].id;
    const del = await lensRun("art", "element-delete", { params: { artworkId, layerId, ids: [victimId] } }, ctx);
    assert.equal(del.result.deleted, 1);
    const after = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    assert.ok(!after.result.artwork.layers[0].strokes.some((st) => st.id === victimId));
    assert.equal(after.result.artwork.layers[0].strokes.length, 2);
  });

  it("layer-reorder up swaps the layer toward the top of the stack", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Order" } }, ctx);
    const artworkId = art.result.artwork.id;
    const baseId = art.result.artwork.layers[0].id;
    const added = await lensRun("art", "layer-add", { params: { artworkId, name: "Top" } }, ctx);
    const topId = added.result.layer.id;
    // base is index 0, Top is index 1. Move base "up" → it should land at index 1.
    const r = await lensRun("art", "layer-reorder", { params: { artworkId, layerId: baseId, direction: "up" } }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.order, [topId, baseId]);
  });

  it("selection-lasso selects only the stroke whose point falls inside the polygon", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Lasso", width: 1000, height: 1000 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    const inside = await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "ink", color: "#abcdef", points: [[50, 50]] } },
    }, ctx);
    await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "ink", color: "#abcdef", points: [[900, 900]] } },
    }, ctx);
    // polygon is a small square around (50,50)
    const r = await lensRun("art", "selection-lasso", {
      params: { artworkId, layerId, polygon: [[0, 0], [100, 0], [100, 100], [0, 100]] },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, 1);
    assert.deepEqual(r.result.selection.ids, [inside.result.strokeId]);
  });

  it("selection-magic-wand matches strokes within the ΔE tolerance and excludes far colors", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Wand", width: 400, height: 400 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    const near = await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "ink", color: "#ff0000", points: [[10, 10]] } },
    }, ctx);
    await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "ink", color: "#00ff00", points: [[20, 20]] } },
    }, ctx);
    // target pure red, tight tolerance → only the red stroke matches
    const r = await lensRun("art", "selection-magic-wand", {
      params: { artworkId, layerId, targetColor: "#ff0000", tolerance: 5 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.matched, 1);
    assert.deepEqual(r.result.selection.ids, [near.result.strokeId]);
  });

  it("symmetry-mirror-stroke (vertical guide) adds one mirrored copy reflected across cx", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Sym", width: 1000, height: 1000 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    await lensRun("art", "guides-set", { params: { artworkId, kind: "vertical" } }, ctx);
    const committed = await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "ink", color: "#123456", points: [[200, 300]] } },
    }, ctx);
    const r = await lensRun("art", "symmetry-mirror-stroke", {
      params: { artworkId, layerId, strokeId: committed.result.strokeId },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.mirrored, 1);
    assert.equal(r.result.strokeCount, 2);
    const got = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    // cx defaulted to width/2 = 500 ; mirror x' = 2*500 - 200 = 800
    const mirrored = got.result.artwork.layers[0].strokes.find((st) => st.id !== committed.result.strokeId);
    assert.deepEqual(mirrored.points, [[800, 300]]);
  });
});

describe("art — studio meta CRUD round-trips (wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`art-t10-meta-${randomUUID()}`); });

  it("brush-preset-save → brush-presets lists the custom brush → brush-preset-delete removes it", async () => {
    const saved = await lensRun("art", "brush-preset-save", {
      params: { name: "My Liner", tool: "ink", size: 9, opacity: 0.8 },
    }, ctx);
    assert.equal(saved.ok, true);
    const brushId = saved.result.brush.id;
    assert.equal(saved.result.brush.size, 9);

    const list = await lensRun("art", "brush-presets", {}, ctx);
    assert.ok(list.result.brushes.some((b) => b.id === brushId && b.name === "My Liner"));

    const del = await lensRun("art", "brush-preset-delete", { params: { id: brushId } }, ctx);
    assert.equal(del.result.deleted, brushId);
    const after = await lensRun("art", "brush-presets", {}, ctx);
    assert.ok(!after.result.brushes.some((b) => b.id === brushId));
  });

  it("art-prompt (random, category=color) returns a prompt drawn from the color category", async () => {
    const r = await lensRun("art", "art-prompt", { params: { random: true, category: "color" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.prompt.category, "color");
    assert.ok(r.result.categories.includes("imagination"));
  });

  it("dynamics-set persists pressure profile → dynamics-get reads back the same floors", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Dyn" } }, ctx);
    const artworkId = art.result.artwork.id;
    const set = await lensRun("art", "dynamics-set", {
      params: { artworkId, pressureSize: true, pressureOpacity: true, sizeFloor: 0.5, smoothing: 0.7 },
    }, ctx);
    assert.equal(set.result.dynamics.pressureSize, true);
    assert.equal(set.result.dynamics.sizeFloor, 0.5);
    const got = await lensRun("art", "dynamics-get", { params: { artworkId } }, ctx);
    assert.equal(got.result.dynamics.smoothing, 0.7);
    assert.equal(got.result.dynamics.pressureOpacity, true);
  });

  it("timelapse-start → stroke commits → timelapse-stop reports the captured frame count", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "TL", width: 200, height: 200 } }, ctx);
    const artworkId = art.result.artwork.id;
    const start = await lensRun("art", "timelapse-start", { params: { artworkId } }, ctx);
    assert.equal(start.result.recording, true);
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    await lensRun("art", "timelapse-frame", { params: { artworkId, snapshot: tinyPng } }, ctx);
    await lensRun("art", "timelapse-frame", { params: { artworkId, snapshot: tinyPng } }, ctx);
    const stop = await lensRun("art", "timelapse-stop", { params: { artworkId } }, ctx);
    assert.equal(stop.result.recording, false);
    assert.equal(stop.result.frameCount, 2);
  });

  it("gradient-commit persists a 2-stop linear gradient element sorted by offset", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "Grad", width: 400, height: 400 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    const r = await lensRun("art", "gradient-commit", {
      params: {
        artworkId, layerId, gradientKind: "linear",
        stops: [{ color: "#0000ff", offset: 1 }, { color: "#ff0000", offset: 0 }],
        x1: 0, y1: 0, x2: 400, y2: 0,
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.strokeCount, 1);
    const got = await lensRun("art", "artwork-get", { params: { id: artworkId } }, ctx);
    const el = got.result.artwork.layers[0].strokes.find((st) => st.id === r.result.elementId);
    assert.equal(el.kind, "gradient");
    // stops sorted ascending by offset → red (0) first, blue (1) last
    assert.deepEqual(el.stops.map((st) => st.color), ["#ff0000", "#0000ff"]);
  });

  it("gradient-commit with a single valid stop is rejected (needs ≥2)", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "GradBad", width: 400, height: 400 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    const bad = await lensRun("art", "gradient-commit", {
      params: { artworkId, layerId, stops: [{ color: "#ff0000", offset: 0 }] },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /at least 2 valid color stops/);
  });

  it("symmetry-mirror-stroke with no active guide is rejected", async () => {
    const art = await lensRun("art", "artwork-create", { params: { title: "NoGuide", width: 300, height: 300 } }, ctx);
    const artworkId = art.result.artwork.id;
    const layerId = art.result.artwork.layers[0].id;
    const committed = await lensRun("art", "stroke-commit", {
      params: { artworkId, layerId, stroke: { tool: "ink", color: "#222222", points: [[10, 10]] } },
    }, ctx);
    const bad = await lensRun("art", "symmetry-mirror-stroke", {
      params: { artworkId, layerId, strokeId: committed.result.strokeId },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /no active symmetry guide/);
  });
});
