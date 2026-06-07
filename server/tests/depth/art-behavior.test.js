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
