// art_draw: Concord chat and ConKay draw onto a real Art lens canvas with no
// GPU. Covers SVG path parsing, the forgiving drawing formats, conversion to
// the art lens's stored elements, the SVG preview, built-in subjects, the
// brain-composed path, saving through the real art.* actions, and the
// GPU-offline fallback in the agent loop.

import { test } from "node:test";
import assert from "node:assert/strict";
import registerArtActions from "../domains/art.js";
import {
  parsePathData, normalizeDrawing, drawingToArtLayers, shapeToElements, parseCanvasSize, artworkToSvg, normColor,
} from "../lib/art/vector-drawing.js";
import {
  runArtDraw, composeDrawing, parseComposerReply, explicitSketchPrompt, artDrawReply, drawingQuality,
} from "../lib/art/art-draw.js";
import { fallbackDrawing } from "../lib/art/draw-fallbacks.js";
import { executeToolCall, formatToolResults } from "../lib/chat-agent.js";

function artActions() {
  globalThis._concordSTATE = globalThis._concordSTATE || {};
  const map = new Map();
  registerArtActions((domain, name, fn) => map.set(`${domain}.${name}`, fn));
  return map;
}

const dims = { width: 1280, height: 800 };
const decode = (url) => Buffer.from(url.split(",")[1], "base64").toString("utf8");

test("SVG path data parses absolute, relative, curves, arcs and closes", () => {
  const [a] = parsePathData("M10 10 L100 10 L100 100 Z");
  assert.equal(a.closed, true);
  assert.deepEqual(a.points[0], [10, 10]);
  assert.deepEqual(a.points.at(-1), [100, 100]);
  const [b] = parsePathData("m10 10 h50 v50 h-50 z");
  assert.deepEqual(b.points.map((p) => p.map(Math.round)), [[10, 10], [60, 10], [60, 60], [10, 60]]);
  const [c] = parsePathData("M0 0 C 0 100 100 100 100 0");
  assert.ok(c.points.length > 10, "cubic flattened");
  assert.ok(Math.max(...c.points.map((p) => p[1])) > 60, "curve bulges");
  const [d] = parsePathData("M0 50 A50 50 0 0 1 100 50");
  assert.ok(d.points.length > 5);
  assert.ok(Math.min(...d.points.map((p) => p[1])) < 5, "arc reaches the top");
  assert.deepEqual(parsePathData("garbage"), []);
});

test("colours normalise and sizes parse with sane defaults", () => {
  assert.equal(normColor("#ABC"), "#aabbcc");
  assert.equal(normColor("rgb(255, 0, 10)"), "#ff000a");
  assert.match(normColor("red"), /^#[0-9a-f]{6}$/);
  assert.equal(normColor("javascript:alert(1)"), null);
  assert.deepEqual(parseCanvasSize(), { width: 1280, height: 800 });
  assert.deepEqual(parseCanvasSize("square"), parseCanvasSize("1024x1024"));
  const big = parseCanvasSize("99999x10");
  assert.ok(big.width <= 2048 && big.height >= 256);
});

test("every accepted drawing form normalises to layers of shapes", () => {
  const flat = normalizeDrawing([{ type: "circle", cx: 10, cy: 10, r: 5, fill: "#f00" }]);
  assert.equal(flat.layers[0].shapes.length, 1);
  const layered = normalizeDrawing({ background: "navy", layers: [{ name: "Sky", shapes: [{ type: "rect", x: 0, y: 0, w: 10, h: 10, fill: "blue" }] }] });
  assert.equal(layered.layers[0].name, "Sky");
  assert.match(layered.background, /^#[0-9a-f]{6}$/);
  const tagged = normalizeDrawing({ shapes: [{ type: "rect", x: 0, y: 0, w: 1, h: 1, fill: "#000", layer: "A" }, { type: "rect", x: 0, y: 0, w: 1, h: 1, fill: "#000", layer: "B" }] });
  assert.deepEqual(tagged.layers.map((l) => l.name), ["A", "B"]);
  const svg = normalizeDrawing('<svg viewBox="0 0 1000 625"><g fill="#00ff00"><rect x="1" y="2" width="30" height="40"/></g><path d="M0 0 L10 0 L10 10 Z" fill="#123456" stroke="#000"/><text x="5" y="9" fill="#111">Hi &amp; bye</text></svg>');
  const types = svg.layers.flatMap((l) => l.shapes.map((s) => s.type));
  assert.deepEqual(types, ["rect", "path", "text"]);
  assert.equal(svg.layers[0].shapes[0].fill, "#00ff00", "group paint is inherited");
  assert.equal(normalizeDrawing("not a drawing"), null);
  assert.equal(normalizeDrawing({ layers: [] }), null);
});

test("shapes convert to the art lens's stored element kinds, scaled to the canvas", () => {
  const [rect] = shapeToElements({ type: "rect", x: 100, y: 100, w: 100, h: 50, fill: "#ff0000", stroke: "#000000", strokeWidth: 2 }, dims);
  assert.equal(rect.kind, "rect");
  assert.equal(rect.filled, true);
  assert.equal(rect.lineColor, "#000000");
  assert.equal(rect.x, 128);
  assert.equal(rect.w, 128);
  const [circ] = shapeToElements({ type: "circle", cx: 500, cy: 312.5, r: 100, fill: "#00ff00" }, dims);
  assert.equal(circ.kind, "ellipse");
  const [poly] = shapeToElements({ type: "polygon", points: [[0, 0], [100, 0], [50, 80]], fill: "#0000ff" }, dims);
  assert.equal(poly.kind, "stroke");
  assert.equal(poly.closed, true);
  assert.equal(poly.filled, true);
  assert.equal(poly.smooth, false);
  const [line] = shapeToElements({ type: "line", x1: 0, y1: 0, x2: 10, y2: 10, stroke: "#333333", strokeWidth: 4 }, dims);
  assert.equal(line.filled, false);
  const [rot] = shapeToElements({ type: "rect", x: 0, y: 0, w: 10, h: 10, rotate: 45, fill: "#111111" }, dims);
  assert.equal(rot.kind, "stroke");
  assert.equal(rot.points.length, 4);
  const [txt] = shapeToElements({ type: "text", x: 10, y: 20, text: "Hello", size: 30, fill: "#222222" }, dims);
  assert.equal(txt.kind, "text");
  assert.equal(txt.content, "Hello");
  assert.deepEqual(shapeToElements({ type: "blob" }, dims), []);
  assert.deepEqual(shapeToElements({ type: "rect", x: 0, y: 0, w: 0, h: 5, fill: "#000000" }, dims), []);
});

test("the SVG preview mirrors the stored elements and escapes text", () => {
  const svg = artworkToSvg({
    width: 100, height: 50, background: "#ffffff",
    layers: [{ visible: true, opacity: 1, strokes: [
      { kind: "stroke", color: "#ff0000", closed: true, filled: true, points: [[0, 0], [10, 0], [5, 5]], size: 1, opacity: 1 },
      { kind: "text", color: "#000000", content: "<script>x</script>", x: 1, y: 2, fontSize: 10, opacity: 1 },
      { kind: "rect", color: "javascript:x", filled: true, x: 0, y: 0, w: 5, h: 5, opacity: 1 },
    ] }, { visible: false, opacity: 1, strokes: [{ kind: "fill", color: "#00ff00", opacity: 1 }] }],
  });
  assert.match(svg, /<path d="M0 0L10 0L5 5Z" fill="#ff0000"/);
  assert.ok(!svg.includes("<script>"));
  assert.ok(!svg.includes("javascript:"));
  assert.ok(!svg.includes("#00ff00"), "hidden layers are not drawn");
});

test("built-in subjects read as the subject and take the colour asked for", () => {
  const car = fallbackDrawing("a blue sports car");
  assert.equal(car.matched, true);
  const art = drawingToArtLayers(car.drawing, dims);
  assert.deepEqual(art.layers.map((l) => l.name), ["Background", "Body", "Wheels"]);
  assert.equal(art.layers[2].elements.filter((e) => e.kind === "ellipse").length, 8, "two wheels with tyre, rim, hub");
  const body = car.drawing.layers[1].shapes.find((s) => s.type === "path" && s.fill && s.fill !== "#a8dadc");
  assert.equal(body.fill, "#1d4ed8");
  assert.ok(drawingQuality(art, dims).ok);
  for (const s of ["a house", "a tree", "a flower", "a cat", "a dog", "a fish", "a bird", "a boat", "a rocket", "a sunset"]) {
    assert.equal(fallbackDrawing(s).matched, true, s);
  }
  const other = fallbackDrawing("a quantum entanglement diagram");
  assert.equal(other.matched, false);
  assert.ok(JSON.stringify(other.drawing).includes("quantum"), "unmatched subjects are labelled, not passed off");
});

test("a car request is drawn as a car without waiting on the brain", async () => {
  let asked = 0;
  const r = await composeDrawing({ subject: "a red car", brain: async () => { asked += 1; return ""; } });
  assert.equal(r.source, "template");
  assert.equal(asked, 0);
  const forced = await composeDrawing({ subject: "a red car", useTemplates: false, brain: async () => "" });
  assert.equal(forced.source, "fallback", "the brain path still ends on the car, not a random shape");
});

test("the brain plans, then composes; its JSON or SVG reply becomes the drawing", async () => {
  const shapes = [
    { type: "rect", x: 0, y: 0, w: 1000, h: 625, fill: "#87ceeb" },
    { type: "rect", x: 0, y: 470, w: 1000, h: 155, fill: "#2a9d55" },
    ...Array.from({ length: 10 }, (_, i) => ({ type: "circle", cx: 300 + i * 40, cy: 300, r: 30, fill: "#ff8800", stroke: "#222222" })),
  ];
  const calls = [];
  const brain = async (messages) => {
    calls.push(messages);
    return calls.length === 1 ? "View: side. Parts: body segments in a row." : "```json\n" + JSON.stringify({ title: "Caterpillar", background: "#ffffff", layers: [{ name: "Scene", shapes }] }) + "\n```";
  };
  const r = await composeDrawing({ subject: "a caterpillar", brain });
  assert.equal(r.source, "composed");
  assert.equal(r.title, "Caterpillar");
  assert.equal(calls.length, 2);
  assert.match(calls[1].at(-1).content, /layout plan/);
  assert.equal(parseComposerReply('Sure! <svg><circle cx="5" cy="5" r="4" fill="#000"/></svg>').drawing.layers[0].shapes[0].type, "circle");
  assert.equal(parseComposerReply("no drawing here"), null);
});

test("a sparse or broken composition retries once, then falls back", async () => {
  let n = 0;
  const r = await composeDrawing({ subject: "a teapot", brain: async () => { n += 1; return n === 1 ? "plan" : '{"shapes":[{"type":"circle","cx":1,"cy":1,"r":1,"fill":"#000"}]}'; } });
  assert.equal(n, 3, "plan + two draw attempts");
  assert.equal(r.source, "fallback-generic");
  const boom = await composeDrawing({ subject: "a teapot", brain: async () => { throw new Error("down"); } });
  assert.equal(boom.source, "fallback-generic");
});

test("caller-supplied shapes are drawn as given", async () => {
  const r = await composeDrawing({ subject: "x", shapes: [{ type: "circle", cx: 500, cy: 300, r: 50, fill: "#ff0000" }], brain: async () => { throw new Error("not called"); } });
  assert.equal(r.source, "provided");
  assert.equal(r.art.layers[0].elements[0].kind, "ellipse");
});

test("runArtDraw saves a real artwork the user owns, with layers, and links to it", async () => {
  const lensActions = artActions();
  const ctx = { actor: { userId: "artist-1", role: "member" } };
  const out = await runArtDraw({ ctx, lensActions, params: { subject: "draw a red car" } });
  assert.equal(out.ok, true);
  assert.equal(out.result.saved, true);
  assert.equal(out.result.title, "A red car");
  assert.match(out.result.href, /^\/lenses\/art\?artwork=/);
  const got = await lensActions.get("art.artwork-get")(ctx, {}, { id: out.result.artworkId });
  const art = got.result.artwork;
  assert.deepEqual(art.layers.map((l) => l.name), ["Background", "Body", "Wheels"]);
  const polygon = art.layers[1].strokes.find((s) => s.kind === "stroke" && s.filled);
  assert.equal(polygon.closed, true, "vector flags survive the art lens's sanitizer");
  assert.equal(polygon.smooth, false);
  assert.match(polygon.lineColor, /^#[0-9a-f]{6}$/);
  assert.match(art.thumbnail, /^data:image\/svg\+xml;base64,/);
  // Not visible to someone else.
  const other = await lensActions.get("art.artwork-get")({ actor: { userId: "someone-else" } }, {}, { id: art.id });
  assert.equal(other.ok, false);
  const [a] = out.artifacts;
  assert.equal(a.kind, "image");
  assert.equal(a.href, out.result.href);
  assert.ok(a.url.length < 56_100);
  assert.match(decode(a.url), /^<svg /);
  assert.match(artDrawReply(out), /new Art lens canvas/);
});

test("an anonymous caller still gets the preview, with a sign-in note", async () => {
  const out = await runArtDraw({ ctx: { actor: {} }, lensActions: artActions(), params: { subject: "a house" } });
  assert.equal(out.result.saved, false);
  assert.match(out.result.saveNote, /Sign in/);
  assert.equal(out.artifacts[0].href, undefined);
});

test("sketch / illustrate / doodle asks are recognised, idioms are not", () => {
  assert.equal(explicitSketchPrompt("sketch a fox in the snow"), "a fox in the snow");
  assert.equal(explicitSketchPrompt("Can you illustrate a lighthouse?"), "a lighthouse");
  assert.equal(explicitSketchPrompt("doodle me a cat"), "a cat");
  for (const q of ["sketch out a plan", "sketch a plan for the launch", "illustrate the point", "illustrate how tides work", "what is a sketch", "sketch"]) {
    assert.equal(explicitSketchPrompt(q), null, q);
  }
});

test("the agent's art_draw tool composes with the conscious brain, saves, and reports briefly", async () => {
  const lensActions = artActions();
  const slots = [];
  const ctx = { actor: { userId: "artist-2", role: "member" }, userPrompt: "sketch a lighthouse",
    brainChat: async ({ slot }) => { slots.push(slot); return { ok: false, text: "" }; } };
  const r = await executeToolCall(ctx, async () => ({}), lensActions, { tool: "art_draw", params: {} });
  assert.equal(r.ok, true);
  assert.equal(r.saved, true);
  assert.ok(slots.length >= 1 && slots.every((s) => s === "conscious"));
  assert.equal(r.artifact.kind, "image");
  const text = formatToolResults([r]);
  assert.match(text, /^\[TOOL_RESULT: art_draw\]/);
  assert.ok(!text.includes("data:image"), "the model never sees the preview bytes");
});

test("generate_image falls back to art_draw when the GPU is offline", async () => {
  const saved = process.env.CONCORD_GEN_URL;
  process.env.CONCORD_GEN_URL = "http://127.0.0.1:9";
  try {
    const lensActions = artActions();
    const ctx = { actor: { userId: "artist-3", role: "member" }, userPrompt: "draw a cat", brainChat: async () => ({ ok: true, text: "" }) };
    const r = await executeToolCall(ctx, async () => ({}), lensActions, { tool: "generate_image", params: { prompt: "a cat" } });
    assert.equal(r.ok, true);
    assert.equal(r.tool, "art_draw");
    assert.equal(r.gpuOffline, true);
    assert.equal(r.source, "template");
    assert.match(formatToolResults([r]), /GPU image tool is offline/);
  } finally {
    if (saved === undefined) delete process.env.CONCORD_GEN_URL; else process.env.CONCORD_GEN_URL = saved;
  }
});
