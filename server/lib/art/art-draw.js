// server/lib/art/art-draw.js
//
// The art_draw chat tool: Concord chat and ConKay draw a picture onto a real
// Art-lens canvas — layers of vector strokes and shapes the user can open and
// keep painting on. No GPU and no outside image service: the conscious brain
// composes the picture from SVG-like primitives (or the caller passes shapes
// / SVG directly), this module validates and converts them to the art lens's
// stored element format, saves an artwork the user owns through the art lens's
// own actions, and returns an inline SVG preview plus a link that opens it.
//
// If composition fails (no reply, bad JSON, or too sparse to be a picture)
// a hand-built drawing for the subject is used instead, and the result says so.

import {
  VIEW_W, VIEW_H, normalizeDrawing, parseCanvasSize, drawingToArtLayers, artworkToSvg,
} from "./vector-drawing.js";
import { fallbackDrawing } from "./draw-fallbacks.js";

const PREVIEW_MAX_CHARS = 56_000; // chat artifacts over ~60KB of JSON are dropped
const MIN_ELEMENTS = 8;
const MIN_SUBJECT_COVERAGE = 0.04;

// "sketch a fox", "illustrate a lighthouse", "doodle a cat" — picture asks the
// image router's make/draw patterns do not cover. Not "sketch out a plan".
const SKETCH_ASK = /^(?:(?:please|hey|ok|okay|now|just)\s+|(?:can|could|would)\s+you\s+)*(?:sketch|illustrate|doodle)\s+(?:me\s+|us\s+)?(.+)$/i;
const SKETCH_IDIOM = /^(?:out\b|up\b|an?\s+(?:plan|outline|idea|strategy|roadmap|proposal|overview)\b|the\s+(?:plan|idea|outline|point|concept)\b|how\b|what\b|why\b)/i;

/** Subject of an explicit sketch/illustrate/doodle ask, or null. */
export function explicitSketchPrompt(message) {
  const text = String(message || "").trim().replace(/[.!?]+$/, "").replace(/\s+(?:please|thanks|thank you)$/i, "");
  if (!text || text.length > 800) return null;
  const m = text.match(SKETCH_ASK);
  if (!m) return null;
  const subject = m[1].trim();
  if (subject.length < 3 || SKETCH_IDIOM.test(subject)) return null;
  return subject;
}

/** The user-facing line for a finished drawing (used when no model turn follows). */
export function artDrawReply(result, { gpuOffline = false } = {}) {
  const r = result?.result || {};
  const lead = gpuOffline ? "Concord's image GPU is offline right now, so I drew this as an editable sketch instead. " : "";
  if (r.saved) return `${lead}I drew "${r.title}" on a new Art lens canvas (${r.layers} layer${r.layers === 1 ? "" : "s"}, ${r.elements} shapes). Open it in the Art lens to keep painting on it.`;
  return `${lead}Here's a sketch of "${r.title}". ${r.saveNote || "It could not be saved to your Art lens this time."}`;
}

export const ART_DRAW_INTENT_RE = /\b(?:draw|sketch|paint|illustrate|doodle)\b/i;

function cleanSubject(s) {
  return String(s || "")
    .replace(/^\s*(?:please\s+)?(?:can you\s+|could you\s+)?(?:draw|sketch|paint|illustrate|doodle|make|generate|create)\s+(?:me\s+)?(?:a\s+(?:picture|drawing|image|sketch|painting)\s+of\s+)?/i, "")
    .replace(/[?.!\s]+$/, "")
    .trim()
    .slice(0, 300);
}

// A short worked example: teaches structure (layers, back-to-front, real
// silhouettes from curved paths, soft shadow) without biasing the subject.
const EXAMPLE = JSON.stringify({
  title: "Lighthouse at dusk",
  background: "#2b3a67",
  layers: [
    { name: "Background", shapes: [
      { type: "rect", x: 0, y: 0, w: 1000, h: 625, fill: "#f6a96b" },
      { type: "rect", x: 0, y: 0, w: 1000, h: 300, fill: "#e5737a", opacity: 0.6 },
      { type: "circle", cx: 760, cy: 360, r: 70, fill: "#ffd27f" },
      { type: "path", d: "M0 430 C200 410 420 445 620 425 C800 410 900 430 1000 420 L1000 625 L0 625 Z", fill: "#3d5a80" },
    ] },
    { name: "Subject", shapes: [
      { type: "path", d: "M330 470 C360 430 470 425 520 470 Z", fill: "#4a4e69" },
      { type: "polygon", points: [[395, 450], [410, 190], [460, 190], [475, 450]], fill: "#f1faee", stroke: "#22223b", strokeWidth: 3 },
      { type: "polygon", points: [[400, 370], [404, 320], [466, 320], [470, 370]], fill: "#c1121f" },
      { type: "polygon", points: [[406, 270], [409, 230], [461, 230], [464, 270]], fill: "#c1121f" },
      { type: "rect", x: 398, y: 150, w: 74, h: 42, fill: "#ffe8a3", stroke: "#22223b", strokeWidth: 3 },
      { type: "polygon", points: [[390, 152], [435, 112], [480, 152]], fill: "#22223b" },
    ] },
    { name: "Details", shapes: [
      { type: "polygon", points: [[472, 160], [1000, 90], [1000, 230]], fill: "#fff3c4", opacity: 0.35 },
      { type: "rect", x: 425, y: 400, w: 20, h: 50, rx: 8, fill: "#22223b" },
      { type: "path", d: "M560 470 C600 460 640 480 680 470", stroke: "#e0fbfc", strokeWidth: 3 },
    ] },
  ],
});

/** Step 1: a short layout plan — parts, where they sit, colours. Spatial
 * reasoning written out first makes the drawing step far more faithful. */
export function planMessages(subject, style) {
  return [
    { role: "system", content: [
      `You are an illustrator planning a flat vector drawing on a ${VIEW_W} x ${VIEW_H} board (x right, y down).`,
      "Write a compact plan, no JSON, under 220 words:",
      "1. View: the clearest angle for the subject and its overall bounding box (x1,y1,x2,y2), large and centred.",
      "2. Parts: 5–10 parts that make it unmistakable, each with its own bounding box and how its outline curves (e.g. a horse: barrel body, long neck rising forward, head angled down, four thin legs to the ground, tail; a dragon: serpentine body, bat wings with finger spars, horned head, clawed legs, spiked tail).",
      "3. Scene: backdrop and ground line.",
      `4. Palette: 5–8 hex colours. Style: ${style || "clean, colourful flat illustration"}.`,
    ].join("\n") },
    { role: "user", content: `Plan a drawing of: ${subject}` },
  ];
}

export function composerMessages(subject, style, plan = "") {
  const sys = [
    `You are Concord's illustrator. You draw pictures as vector shapes on a ${VIEW_W} x ${VIEW_H} board (x to the right, y down, origin top-left).`,
    "Reply with ONE JSON object and nothing else — no prose, no code fences.",
    "Shape types: rect {x,y,w,h,rx?,rotate?}, circle {cx,cy,r}, ellipse {cx,cy,rx,ry}, polygon {points:[[x,y],…]}, polyline {points}, line {x1,y1,x2,y2}, path {d} (SVG path data: M L H V C S Q T A Z), text {x,y,text,size}.",
    'Paint on any shape: "fill":"#rrggbb", "stroke":"#rrggbb", "strokeWidth":n, "opacity":0..1. Shapes paint in order, later on top.',
    "Before writing, picture the subject the way an illustrator would: its real outline seen from the clearest angle (a car from the side, a face from the front), its proportions, and the 4–8 parts that make it unmistakable.",
    "Then draw it well:",
    "- The subject is big and centred: about 40–70% of the board. Build its silhouette from one or two closed paths with C curves — never a stack of plain rectangles.",
    "- Add the identifying parts on top, each where it really sits (a car: wheels touching the ground at both ends of the body, glass in the cabin, head and tail lights, door line; an animal: head, ears, eyes, body, legs, tail; a building: walls, roof, door, windows).",
    "- Back to front: sky/backdrop and ground, then the subject's soft shadow (opacity 0.2), the subject, then details and highlights.",
    "- 5–8 harmonious colours; darker outlines (strokeWidth 2–4) on the subject.",
    "- 30 to 150 shapes. Every coordinate is a plain number inside the board.",
    `- Style: ${style || "clean, colourful flat illustration"}.`,
    "Example of the format and the level of care (a different subject):",
    EXAMPLE,
  ].join("\n");
  return [
    { role: "system", content: sys },
    { role: "user", content: plan ? `Draw: ${subject}\n\nFollow this layout plan exactly:\n${plan}` : `Draw: ${subject}` },
  ];
}

/** Pull a drawing out of a model reply: JSON first, then SVG markup. */
export function parseComposerReply(text) {
  const raw = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  if (!raw) return null;
  const unfenced = raw.replace(/```(?:json|svg|xml)?/gi, "");
  const a = unfenced.indexOf("{"), b = unfenced.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      const obj = JSON.parse(unfenced.slice(a, b + 1));
      const d = normalizeDrawing(obj);
      if (d) return { drawing: d, title: typeof obj.title === "string" ? obj.title.slice(0, 120) : null };
    } catch { /* fall through to SVG */ }
  }
  const svg = unfenced.match(/<svg[\s\S]*?<\/svg>/i)?.[0];
  if (svg) {
    const d = normalizeDrawing(svg);
    if (d) return { drawing: d, title: null };
  }
  return null;
}

/** Is this converted drawing substantial enough to call a picture? */
export function drawingQuality(artLayers, { width, height }) {
  let elements = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of artLayers.layers) {
    for (const e of l.elements) {
      elements += 1;
      const pts = e.points || [[e.x, e.y], [e.x + (e.w || 0), e.y + (e.h || 0)]];
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
      if (bw * bh >= 0.9 * width * height) continue; // full-canvas backdrop, not subject
      minX = Math.min(minX, ...xs); minY = Math.min(minY, ...ys);
      maxX = Math.max(maxX, ...xs); maxY = Math.max(maxY, ...ys);
    }
  }
  const cov = Number.isFinite(minX)
    ? (Math.max(0, Math.min(maxX, width) - Math.max(minX, 0)) * Math.max(0, Math.min(maxY, height) - Math.max(minY, 0))) / (width * height)
    : 0;
  return { elements, coverage: cov, ok: elements >= MIN_ELEMENTS && cov >= MIN_SUBJECT_COVERAGE };
}

/**
 * Compose a drawing: caller-supplied shapes/SVG win, else ask the brain
 * (one retry), else the deterministic fallback. Never throws.
 */
/**
 * Compose a drawing. Order: caller-supplied shapes/SVG; Concord's built-in
 * illustration for common subjects (car, house, cat, …), recoloured to the
 * request, because those must read correctly every time; otherwise the
 * brain plans the layout then draws it (one retry); and if that fails, the
 * built-in fallback. Never throws.
 */
export async function composeDrawing({ subject, style, shapes, svg, size, brain, useTemplates = templatesEnabled(), deadlineAt = 0 }) {
  const dims = parseCanvasSize(size);
  const timeLeft = () => (deadlineAt ? deadlineAt - Date.now() : Infinity);
  const attempts = [];
  const accept = (drawing, source, title = null) => {
    const art = drawingToArtLayers(drawing, dims);
    const q = drawingQuality(art, dims);
    attempts.push({ source, ...q });
    return q.ok ? { art, source, title, quality: q } : null;
  };
  const given = shapes ?? svg;
  if (given != null) {
    const d = normalizeDrawing(given);
    const r = d && accept(d, "provided");
    if (r) return { ...r, dims, attempts };
    // Explicit shapes are honoured even when sparse — the caller drew them on purpose.
    if (d) {
      const art = drawingToArtLayers(d, dims);
      if (art.layers.length) return { art, source: "provided", title: null, quality: drawingQuality(art, dims), dims, attempts };
    }
  }
  const tpl = fallbackDrawing(subject);
  if (useTemplates && tpl.matched) {
    const r = accept(tpl.drawing, "template");
    if (r) return { ...r, dims, attempts };
  }
  if (typeof brain === "function") {
    let plan = "";
    if (timeLeft() > 25_000) {try {
      plan = replyText(await brain(planMessages(subject, style), { maxTokens: 1500 }))
        .replace(/<think>[\s\S]*?<\/think>/gi, "").trim().slice(0, 2500);
    } catch { /* the plan is optional */ }}
    for (let i = 0; i < 2; i++) {
      if (timeLeft() < 8_000) { attempts.push({ source: "composed", error: "out_of_time" }); break; }
      try {
        const msgs = composerMessages(subject, style, plan);
        if (i === 1) msgs.push({ role: "user", content: "That was not a usable drawing. Reply with only the JSON object, at least 25 shapes, the subject large and clearly recognisable." });
        const text = replyText(await brain(msgs, { maxTokens: 7000 }));
        const parsed = parseComposerReply(text);
        const r = parsed && accept(parsed.drawing, "composed", parsed.title);
        if (r) return { ...r, dims, attempts };
        if (!parsed) attempts.push({ source: "composed", error: text ? "unparseable" : "empty" });
      } catch (e) {
        attempts.push({ source: "composed", error: String(e?.message || e).slice(0, 160) });
      }
    }
  }
  const art = drawingToArtLayers(tpl.drawing, dims);
  return { art, source: tpl.matched ? "fallback" : "fallback-generic", title: null, quality: drawingQuality(art, dims), dims, attempts };
}

/** CONCORD_ART_DRAW_TEMPLATES=0 makes the brain compose even common subjects. */
export function templatesEnabled() {
  return !/^(?:0|false|off|no)$/i.test(String(process.env.CONCORD_ART_DRAW_TEMPLATES ?? "1").trim());
}

function replyText(reply) {
  if (typeof reply === "string") return reply;
  return String(reply?.text ?? reply?.content ?? reply?.message?.content ?? "");
}

function toDataUrl(svgText) {
  return `data:image/svg+xml;base64,${Buffer.from(svgText, "utf8").toString("base64")}`;
}

/** SVG preview data URL kept under the chat artifact budget (drops trailing detail if it must). */
export function previewDataUrl(artwork) {
  let svg = artworkToSvg(artwork);
  if (toDataUrl(svg).length <= PREVIEW_MAX_CHARS) return toDataUrl(svg);
  const trimmed = structuredClone(artwork);
  // Thin the busiest layers until it fits; the saved artwork keeps everything.
  for (let guard = 0; guard < 40; guard++) {
    const busiest = [...trimmed.layers].sort((a, b) => (b.strokes?.length || 0) - (a.strokes?.length || 0))[0];
    if (!busiest || (busiest.strokes?.length || 0) <= 1) break;
    busiest.strokes = busiest.strokes.slice(0, Math.floor(busiest.strokes.length * 0.8));
    svg = artworkToSvg(trimmed);
    if (toDataUrl(svg).length <= PREVIEW_MAX_CHARS) return toDataUrl(svg);
  }
  return null;
}

function getHandler(lensActions, key) {
  const h = lensActions?.get?.(key) ?? globalThis.__concordLensActions?.get?.(key);
  return typeof h === "function" ? h : (typeof h?.handler === "function" ? h.handler : null);
}

async function act(lensActions, key, ctx, params) {
  const h = getHandler(lensActions, key);
  if (!h) throw new Error(`${key} unavailable`);
  const r = await h(ctx, {}, params);
  if (!r || r.ok === false) throw new Error(r?.error || `${key} failed`);
  return r.result ?? r;
}

/**
 * Run the tool. ctx needs actor.userId (a signed-in user) to save; anonymous
 * callers still get the preview. Returns a chat-agent style tool result.
 */
export async function runArtDraw({ ctx, lensActions, params = {}, brain, deadlineAt = 0 }) {
  const subject = cleanSubject(params.subject ?? params.prompt ?? params.description ?? params.text ?? params.what) || "a simple landscape";
  const style = params.style ? String(params.style).slice(0, 120) : "";
  const composed = await composeDrawing({ subject, style, shapes: params.shapes, svg: params.svg, size: params.size, brain, deadlineAt });
  const { art, dims, source } = composed;
  const title = (String(params.title || composed.title || subject).trim().replace(/^./, (c) => c.toUpperCase())).slice(0, 120);
  const background = art.background || "#ffffff";

  // What we will store, mirrored for the preview if we cannot save.
  const localArtwork = {
    width: dims.width, height: dims.height, background,
    layers: art.layers.map((l) => ({ name: l.name, visible: true, opacity: 1, strokes: l.elements })),
  };

  const userId = ctx?.actor?.userId;
  const anon = !userId || userId === "anon" || ctx?.actor?.role === "anon";
  let saved = null, saveError = null;
  if (!anon) {
    const actx = { ...ctx, actor: ctx.actor, userId };
    try {
      const created = await act(lensActions, "art.artwork-create", actx, { title, width: dims.width, height: dims.height, background });
      const artwork = created.artwork;
      for (let i = 0; i < art.layers.length; i++) {
        const l = art.layers[i];
        let layerId;
        if (i === 0) {
          layerId = artwork.layers?.[0]?.id;
          await act(lensActions, "art.layer-update", actx, { artworkId: artwork.id, layerId, name: l.name }).catch(() => {});
        } else {
          layerId = (await act(lensActions, "art.layer-add", actx, { artworkId: artwork.id, name: l.name })).layer.id;
        }
        await act(lensActions, "art.stroke-batch", actx, { artworkId: artwork.id, layerId, strokes: l.elements });
      }
      saved = (await act(lensActions, "art.artwork-get", actx, { id: artwork.id })).artwork;
    } catch (e) {
      saveError = String(e?.message || e).slice(0, 200);
    }
  }

  const shown = saved || localArtwork;
  const url = previewDataUrl(shown);
  if (saved && url) {
    await act(lensActions, "art.artwork-save-thumbnail", { ...ctx, userId }, { id: saved.id, thumbnail: url }).catch(() => {});
  }
  const href = saved ? `/lenses/art?artwork=${encodeURIComponent(saved.id)}` : null;
  const layerCount = shown.layers.length;
  const elementCount = shown.layers.reduce((n, l) => n + (l.strokes?.length || 0), 0);
  const artifacts = url ? [{
    kind: "image", url, title, prompt: subject, source: "art_draw",
    ...(saved ? { artworkId: saved.id, href } : {}),
  }] : [];

  const note = source.startsWith("fallback")
    ? (source === "fallback" ? "Drawn from Concord's built-in sketch for this subject (the custom composition did not come through)." : "A placeholder scene — the custom composition did not come through; ask again or describe it in more detail.")
    : null;
  return {
    ok: true,
    result: {
      title, subject, style: style || null, source,
      artworkId: saved?.id || null, href, saved: !!saved,
      width: dims.width, height: dims.height, layers: layerCount, elements: elementCount,
      layerNames: shown.layers.map((l) => l.name),
      ...(note ? { note } : {}),
      ...(anon ? { saveNote: "Sign in to save drawings to your Art lens; this preview is not saved." } : {}),
      ...(saveError ? { saveError } : {}),
    },
    artifacts,
  };
}
