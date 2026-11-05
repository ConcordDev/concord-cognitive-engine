// server/lib/art/vector-drawing.js
//
// SVG-like drawing primitives -> the art lens canvas's stored elements, and
// back to an SVG preview. Pure functions, no I/O.
//
// Input shapes live on a VIEW_W x VIEW_H board (y down) so the model never
// has to know the canvas size. Accepted forms (forgiving on purpose):
//   [{ type, ... }]                          a flat shape list
//   { background, layers: [{ name, shapes }] }
//   { background, shapes: [...] }
//   "<svg ...>...</svg>"                     plain SVG markup (rect, circle,
//                                            ellipse, line, polyline, polygon,
//                                            path, text; fill/stroke/style)
// Shape types: rect {x,y,w|width,h|height}, circle {cx,cy,r},
// ellipse {cx,cy,rx,ry}, polygon/polyline {points}, line {x1,y1,x2,y2},
// path {d} (M L H V C S Q T A Z, absolute and relative), text {x,y,text,size}.
// Paint: fill, stroke, strokeWidth (or stroke-width), opacity. A rect with
// `rotate` (degrees) becomes a polygon.
//
// Output elements are what art.js#sanitizeStroke stores and
// components/art/ArtCanvas.tsx#drawElement replays: rect / ellipse / text,
// and polyline "stroke" elements with points, plus `closed`, `filled`,
// `smooth: false` and `lineColor` for filled outlined polygons.

export const VIEW_W = 1000;
export const VIEW_H = 625;
export const MAX_SHAPES = 400;
export const MAX_POINTS_PER_SHAPE = 1500;
export const MAX_LAYERS = 8;
const CURVE_SEGMENTS = 14;

const NAMED = Object.freeze({
  black: "#000000", white: "#ffffff", red: "#e63946", darkred: "#8b0000", green: "#2a9d55", darkgreen: "#1b5e20",
  lime: "#7cd636", blue: "#1d4ed8", navy: "#1e2a5a", lightblue: "#9fd3f2", skyblue: "#87ceeb", cyan: "#22d3ee",
  teal: "#0f766e", yellow: "#ffd60a", gold: "#d4a017", orange: "#f77f00", brown: "#7b4a2a", tan: "#d2b48c",
  beige: "#f5f0dc", pink: "#f4a7c0", purple: "#7b2cbf", violet: "#8f5cf7", magenta: "#d0006f", gray: "#808080",
  grey: "#808080", lightgray: "#d3d3d3", lightgrey: "#d3d3d3", darkgray: "#404040", darkgrey: "#404040",
  silver: "#c0c0c0", olive: "#6b8e23", maroon: "#800000", coral: "#ff7f50", salmon: "#fa8072", ivory: "#fffff0",
  cream: "#fff8e1", khaki: "#c3b091", indigo: "#3f2d8f", crimson: "#c1121f", turquoise: "#40e0d0",
});

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** "#abc" | "#aabbcc" | "red" | "rgb(1,2,3)" -> "#rrggbb"; "none"/"transparent"/missing -> null. */
export function normColor(c) {
  if (c == null) return null;
  const s = String(c).trim().toLowerCase();
  if (!s || s === "none" || s === "transparent") return null;
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const rgb = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((x) => clamp(Number(x), 0, 255).toString(16).padStart(2, "0")).join("")}`;
  return NAMED[s.replace(/\s+/g, "")] || null;
}

/** "1280x800" | {width,height} | "square" | "portrait" | "landscape" -> {width,height}. */
export function parseCanvasSize(size) {
  if (size && typeof size === "object") {
    return { width: Math.round(clamp(num(size.width, 1280), 256, 2048)), height: Math.round(clamp(num(size.height, 800), 256, 2048)) };
  }
  const s = String(size || "").toLowerCase();
  const m = s.match(/(\d{3,4})\s*[x×*]\s*(\d{3,4})/);
  if (m) return { width: Math.round(clamp(Number(m[1]), 256, 2048)), height: Math.round(clamp(Number(m[2]), 256, 2048)) };
  if (/square/.test(s)) return { width: 1024, height: 1024 };
  if (/portrait|tall|vertical/.test(s)) return { width: 800, height: 1200 };
  return { width: 1280, height: 800 };
}

function parsePointList(p) {
  if (Array.isArray(p)) {
    const out = [];
    for (const q of p) {
      if (Array.isArray(q) && q.length >= 2) out.push([num(q[0]), num(q[1])]);
      else if (q && typeof q === "object" && "x" in q) out.push([num(q.x), num(q.y)]);
    }
    if (!out.length && p.length >= 4 && p.every((x) => typeof x === "number")) {
      for (let i = 0; i + 1 < p.length; i += 2) out.push([p[i], p[i + 1]]);
    }
    return out;
  }
  const nums = String(p || "").match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const out = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([Number(nums[i]), Number(nums[i + 1])]);
  return out;
}

/** SVG path data -> [{ points: [[x,y]...], closed }] with curves flattened. */
export function parsePathData(d) {
  const src = String(d || "");
  const tokens = src.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const subpaths = [];
  let cur = null;
  let x = 0, y = 0, sx = 0, sy = 0;
  let lastCtrl = null;
  let lastCmd = "";
  let i = 0;
  const isCmd = (t) => /^[a-zA-Z]$/.test(t);
  const next = () => Number(tokens[i++]);
  const has = () => i < tokens.length && !isCmd(tokens[i]);
  const start = (nx, ny) => { cur = { points: [[nx, ny]], closed: false }; subpaths.push(cur); x = nx; y = ny; sx = nx; sy = ny; };
  const line = (nx, ny) => { if (!cur) start(x, y); cur.points.push([nx, ny]); x = nx; y = ny; };
  const cubic = (x1, y1, x2, y2, ex, ey) => {
    if (!cur) start(x, y);
    const x0 = x, y0 = y;
    for (let k = 1; k <= CURVE_SEGMENTS; k++) {
      const t = k / CURVE_SEGMENTS, u = 1 - t;
      cur.points.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey,
      ]);
    }
    x = ex; y = ey;
  };
  const quad = (x1, y1, ex, ey) => {
    if (!cur) start(x, y);
    const x0 = x, y0 = y;
    for (let k = 1; k <= CURVE_SEGMENTS; k++) {
      const t = k / CURVE_SEGMENTS, u = 1 - t;
      cur.points.push([u * u * x0 + 2 * u * t * x1 + t * t * ex, u * u * y0 + 2 * u * t * y1 + t * t * ey]);
    }
    x = ex; y = ey;
  };
  const arc = (rx, ry, rot, large, sweep, ex, ey) => {
    // Endpoint arc -> centre parameterisation (SVG spec F.6.5), then sampled.
    if (!cur) start(x, y);
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (!rx || !ry) { line(ex, ey); return; }
    const phi = (rot * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x - ex) / 2, dy = (y - ey) / 2;
    const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
    const lam = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const sign = large === sweep ? -1 : 1;
    const numr = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const co = sign * Math.sqrt(Math.max(0, numr / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
    const cxp = (co * rx * y1p) / ry, cyp = (-co * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x + ex) / 2, cy = sin * cxp + cos * cyp + (y + ey) / 2;
    const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && dt > 0) dt -= 2 * Math.PI;
    if (sweep && dt < 0) dt += 2 * Math.PI;
    const n = Math.max(4, Math.ceil((Math.abs(dt) / (Math.PI / 2)) * (CURVE_SEGMENTS / 2)));
    for (let k = 1; k <= n; k++) {
      const t = t1 + (dt * k) / n;
      cur.points.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
    }
    x = ex; y = ey;
  };
  let cmd = "";
  let guard = 0;
  while (i < tokens.length && guard++ < 20000) {
    if (isCmd(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === "Z") {
      if (cur) { cur.closed = true; x = sx; y = sy; cur = null; }
      lastCtrl = null; lastCmd = "Z";
      continue;
    }
    if (!has()) { lastCmd = C; continue; }
    switch (C) {
      case "M": { start(ox + next(), oy + next()); cmd = rel ? "l" : "L"; lastCtrl = null; break; }
      case "L": line(ox + next(), oy + next()); lastCtrl = null; break;
      case "H": line(ox + next(), y); lastCtrl = null; break;
      case "V": line(x, (rel ? y : 0) + next()); lastCtrl = null; break;
      case "C": {
        const x1 = ox + next(), y1 = oy + next(), x2 = ox + next(), y2 = oy + next(), ex = ox + next(), ey = oy + next();
        cubic(x1, y1, x2, y2, ex, ey); lastCtrl = [x2, y2]; break;
      }
      case "S": {
        const r = lastCtrl && /[CS]/.test(lastCmd) ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const x2 = ox + next(), y2 = oy + next(), ex = ox + next(), ey = oy + next();
        cubic(r[0], r[1], x2, y2, ex, ey); lastCtrl = [x2, y2]; break;
      }
      case "Q": {
        const x1 = ox + next(), y1 = oy + next(), ex = ox + next(), ey = oy + next();
        quad(x1, y1, ex, ey); lastCtrl = [x1, y1]; break;
      }
      case "T": {
        const r = lastCtrl && /[QT]/.test(lastCmd) ? [2 * x - lastCtrl[0], 2 * y - lastCtrl[1]] : [x, y];
        const ex = ox + next(), ey = oy + next();
        quad(r[0], r[1], ex, ey); lastCtrl = r; break;
      }
      case "A": {
        const rx = next(), ry = next(), rot = next(), large = next() ? 1 : 0, sweep = next() ? 1 : 0;
        arc(rx, ry, rot, large, sweep, ox + next(), oy + next()); lastCtrl = null; break;
      }
      default: i++; break;
    }
    lastCmd = C;
  }
  return subpaths.filter((s) => s.points.length >= 2 && s.points.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])));
}

function attrsOf(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[m[1]] = m[3] ?? m[4] ?? "";
  if (out.style) {
    for (const part of String(out.style).split(";")) {
      const [k, v] = part.split(":").map((x) => String(x || "").trim());
      if (k && v && out[k] == null) out[k] = v;
    }
  }
  return out;
}

/** Plain SVG markup -> shape list. Fill/stroke on a <g> are inherited by its children. */
export function shapesFromSvg(svg) {
  const text = String(svg || "");
  const shapes = [];
  const stack = [{}];
  const re = /<\s*(\/?)\s*(g|rect|circle|ellipse|line|polyline|polygon|path|text)\b([^>]*?)(\/?)>(?:([^<]*)<\/text>)?/gi;
  for (const m of text.matchAll(re)) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    if (tag === "g") {
      if (closing) { if (stack.length > 1) stack.pop(); }
      else if (m[4] !== "/") {
        const a = attrsOf(m[3]);
        const top = stack[stack.length - 1];
        stack.push({ ...top, ...pick(a, ["fill", "stroke", "stroke-width", "opacity"]) });
      }
      continue;
    }
    if (closing) continue;
    const a = { ...stack[stack.length - 1], ...attrsOf(m[3]) };
    const paint = { fill: a.fill ?? null, stroke: a.stroke ?? null, strokeWidth: a["stroke-width"], opacity: a.opacity ?? a["fill-opacity"] };
    if (tag === "rect") shapes.push({ type: "rect", x: a.x, y: a.y, w: a.width, h: a.height, rx: a.rx, ...paint });
    else if (tag === "circle") shapes.push({ type: "circle", cx: a.cx, cy: a.cy, r: a.r, ...paint });
    else if (tag === "ellipse") shapes.push({ type: "ellipse", cx: a.cx, cy: a.cy, rx: a.rx, ry: a.ry, ...paint });
    else if (tag === "line") shapes.push({ type: "line", x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...paint });
    else if (tag === "polyline" || tag === "polygon") shapes.push({ type: tag, points: a.points, ...paint });
    else if (tag === "path") shapes.push({ type: "path", d: a.d, ...paint });
    else if (tag === "text") shapes.push({ type: "text", x: a.x, y: a.y, text: (m[5] || "").trim(), size: a["font-size"], ...paint });
  }
  return shapes;
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] != null) out[k] = o[k];
  return out;
}

/**
 * Any accepted drawing form -> { background, layers: [{ name, shapes }] }.
 * Returns null when nothing drawable came in.
 */
export function normalizeDrawing(input) {
  let src = input;
  if (typeof src === "string") {
    const s = src.trim();
    if (/<\s*svg\b|<\s*(?:path|rect|circle|polygon)\b/i.test(s)) {
      const bg = s.match(/<svg[^>]*\bstyle\s*=\s*"[^"]*background(?:-color)?\s*:\s*([^;"]+)/i);
      src = { background: bg ? bg[1] : null, shapes: shapesFromSvg(s) };
    } else {
      try { src = JSON.parse(s); } catch { return null; }
    }
  }
  if (Array.isArray(src)) src = { shapes: src };
  if (!src || typeof src !== "object") return null;
  if (typeof src.svg === "string") {
    const fromSvg = normalizeDrawing(src.svg);
    if (fromSvg) return { ...fromSvg, background: normColor(src.background) || fromSvg.background };
  }
  const layers = [];
  const rawLayers = Array.isArray(src.layers) ? src.layers : [];
  for (const l of rawLayers.slice(0, MAX_LAYERS)) {
    const shapes = Array.isArray(l?.shapes) ? l.shapes : Array.isArray(l?.elements) ? l.elements : [];
    if (shapes.length) layers.push({ name: String(l.name || `Layer ${layers.length + 1}`).slice(0, 60), shapes });
  }
  const flat = Array.isArray(src.shapes) ? src.shapes : Array.isArray(src.elements) ? src.elements : [];
  if (flat.length) {
    // A flat list may still say which layer each shape belongs to.
    const byName = new Map();
    for (const sh of flat) {
      const name = String(sh?.layer || "Drawing").slice(0, 60);
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(sh);
    }
    for (const [name, shapes] of byName) if (layers.length < MAX_LAYERS) layers.push({ name, shapes });
  }
  let total = 0;
  for (const l of layers) {
    l.shapes = l.shapes.filter((s) => s && typeof s === "object").slice(0, Math.max(0, MAX_SHAPES - total));
    total += l.shapes.length;
  }
  const kept = layers.filter((l) => l.shapes.length);
  if (!kept.length) return null;
  return { background: normColor(src.background), layers: kept };
}

function polyOfRotatedRect(x, y, w, h, deg) {
  const cx = x + w / 2, cy = y + h / 2, t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => [cx + (px - cx) * c - (py - cy) * s, cy + (px - cx) * s + (py - cy) * c]);
}

function roundedRectPoints(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  const pts = [];
  const corner = (cx, cy, a0) => { for (let k = 0; k <= 6; k++) { const a = a0 + (k / 6) * (Math.PI / 2); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } };
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  return pts;
}

function thin(points, max) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let k = 0; k < max; k++) out.push(points[Math.floor(k * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/**
 * One shape -> zero or more art elements, scaled from the VIEW board to the
 * canvas. Unknown or degenerate shapes return [].
 */
export function shapeToElements(shape, { width, height }) {
  const sx = width / VIEW_W, sy = height / VIEW_H, sAvg = (sx + sy) / 2;
  const X = (v) => Math.round(num(v) * sx);
  const Y = (v) => Math.round(num(v) * sy);
  const type = String(shape.type || shape.kind || shape.shape || "").toLowerCase();
  const fill = normColor(shape.fill ?? shape.color);
  const stroke = normColor(shape.stroke ?? shape.outline ?? shape.lineColor);
  const sw = clamp(num(shape.strokeWidth ?? shape["stroke-width"] ?? shape.lineWidth, stroke ? 3 : 0), 0, 60) * sAvg;
  const opacity = clamp(num(shape.opacity, 1), 0.02, 1);
  const lineSize = Math.max(0.5, Math.round(sw * 10) / 10 || (fill ? 0.5 : 3 * sAvg));
  const poly = (points, closed) => {
    const pts = thin(points.map(([px, py]) => [X(px), Y(py)]), MAX_POINTS_PER_SHAPE);
    if (pts.length < 2) return [];
    const filled = closed && !!fill;
    if (!filled && !stroke && !fill) return [];
    return [{
      kind: "stroke", tool: "ink", smooth: false, closed: !!closed, filled,
      color: filled ? fill : (stroke || fill), ...(filled && stroke ? { lineColor: stroke } : {}),
      size: filled ? (stroke ? lineSize : 0.5) : lineSize, opacity, points: pts,
    }];
  };
  const box = (kind, x, y, w, h) => {
    if (!(w > 0) || !(h > 0)) return [];
    if (!fill && !stroke) return [];
    return [{
      kind, filled: !!fill, color: fill || stroke, ...(fill && stroke ? { lineColor: stroke } : {}),
      size: lineSize, opacity, x: X(x), y: Y(y), w: Math.round(w * sx), h: Math.round(h * sy),
    }];
  };
  switch (type) {
    case "rect": case "rectangle": case "square": {
      const x = num(shape.x), y = num(shape.y);
      const w = num(shape.w ?? shape.width), h = num(shape.h ?? shape.height ?? (type === "square" ? shape.w ?? shape.width : 0));
      const rot = num(shape.rotate ?? shape.rotation, 0);
      const rx = num(shape.rx ?? shape.radius, 0);
      if (!(w > 0) || !(h > 0)) return [];
      if (rot) return poly(polyOfRotatedRect(x, y, w, h, rot), true);
      if (rx > 0) return poly(roundedRectPoints(x, y, w, h, rx), true);
      return box("rect", x, y, w, h);
    }
    case "circle": case "dot": {
      const r = num(shape.r ?? shape.radius);
      return box("ellipse", num(shape.cx ?? shape.x) - r, num(shape.cy ?? shape.y) - r, 2 * r, 2 * r);
    }
    case "ellipse": case "oval": {
      const rx = num(shape.rx), ry = num(shape.ry ?? shape.rx);
      return box("ellipse", num(shape.cx ?? shape.x) - rx, num(shape.cy ?? shape.y) - ry, 2 * rx, 2 * ry);
    }
    case "line": {
      const pts = shape.points ? parsePointList(shape.points) : [[num(shape.x1), num(shape.y1)], [num(shape.x2), num(shape.y2)]];
      return stroke || fill ? poly(pts, false) : [];
    }
    case "polyline": return poly(parsePointList(shape.points), false);
    case "polygon": case "triangle": case "shape": return poly(parsePointList(shape.points), true);
    case "path": {
      const out = [];
      for (const sp of parsePathData(shape.d ?? shape.path)) {
        // An unclosed path with a fill still fills (SVG closes it implicitly).
        out.push(...poly(sp.points, sp.closed || (!!fill && sp.points.length >= 3)));
      }
      return out;
    }
    case "text": case "label": {
      const content = String(shape.text ?? shape.content ?? "").trim().slice(0, 200);
      if (!content) return [];
      return [{ kind: "text", color: fill || stroke || "#222222", opacity, content, x: X(shape.x), y: Y(shape.y), fontSize: Math.round(clamp(num(shape.size ?? shape.fontSize ?? shape["font-size"], 28), 6, 200) * sAvg) }];
    }
    default: return [];
  }
}

/** A normalized drawing -> { background, layers: [{ name, elements }] } on a width x height canvas. */
export function drawingToArtLayers(drawing, { width, height }) {
  const layers = [];
  for (const l of drawing?.layers || []) {
    const elements = [];
    for (const sh of l.shapes) elements.push(...shapeToElements(sh, { width, height }));
    if (elements.length) layers.push({ name: l.name, elements });
  }
  return { background: drawing?.background || "#ffffff", layers };
}

/** How much of the board a drawing covers, 0..1, from its elements' bounding box. */
export function coverage(artLayers, { width, height }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of artLayers.layers) {
    for (const e of l.elements) {
      const pts = e.points || [[e.x, e.y], [e.x + (e.w || 0), e.y + (e.h || 0)]];
      for (const [px, py] of pts) { minX = Math.min(minX, px); minY = Math.min(minY, py); maxX = Math.max(maxX, px); maxY = Math.max(maxY, py); }
    }
  }
  if (!Number.isFinite(minX)) return 0;
  const w = clamp(maxX, 0, width) - clamp(minX, 0, width), h = clamp(maxY, 0, height) - clamp(minY, 0, height);
  return Math.max(0, (w * h) / (width * height));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeColor = (c, d = "#222222") => (/^#[0-9a-f]{6}$/i.test(String(c || "")) ? c : d);

/** Stored art elements -> one SVG element string, mirroring ArtCanvas#drawElement. */
export function elementToSvg(el, { width, height }) {
  const op = clamp(num(el.opacity, 1), 0, 1);
  const color = safeColor(el.color);
  const line = el.lineColor ? safeColor(el.lineColor) : null;
  const sw = Math.max(0.5, num(el.size, 4));
  if (el.kind === "fill") return `<rect x="0" y="0" width="${width}" height="${height}" fill="${color}" opacity="${op}"/>`;
  if (el.kind === "rect") {
    const paint = el.filled ? `fill="${color}"${line ? ` stroke="${line}" stroke-width="${sw}"` : ""}` : `fill="none" stroke="${color}" stroke-width="${sw}"`;
    return `<rect x="${num(el.x)}" y="${num(el.y)}" width="${Math.abs(num(el.w))}" height="${Math.abs(num(el.h))}" ${paint} opacity="${op}"/>`;
  }
  if (el.kind === "ellipse") {
    const paint = el.filled ? `fill="${color}"${line ? ` stroke="${line}" stroke-width="${sw}"` : ""}` : `fill="none" stroke="${color}" stroke-width="${sw}"`;
    return `<ellipse cx="${num(el.x) + num(el.w) / 2}" cy="${num(el.y) + num(el.h) / 2}" rx="${Math.abs(num(el.w)) / 2}" ry="${Math.abs(num(el.h)) / 2}" ${paint} opacity="${op}"/>`;
  }
  if (el.kind === "text") {
    return `<text x="${num(el.x)}" y="${num(el.y)}" font-family="sans-serif" font-size="${num(el.fontSize, 32)}" fill="${color}" opacity="${op}">${esc(el.content || "")}</text>`;
  }
  const pts = Array.isArray(el.points) ? el.points : [];
  if (!pts.length) return "";
  if (pts.length === 1) return `<circle cx="${pts[0][0]}" cy="${pts[0][1]}" r="${sw / 2}" fill="${color}" opacity="${op}"/>`;
  const d = `M${pts.map((p) => `${num(p[0])} ${num(p[1])}`).join("L")}${el.closed ? "Z" : ""}`;
  if (el.filled) {
    return `<path d="${d}" fill="${color}"${line ? ` stroke="${line}" stroke-width="${sw}" stroke-linejoin="round"` : ""} opacity="${op}"/>`;
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" opacity="${op}"/>`;
}

/** A stored artwork ({width,height,background,layers:[{visible,opacity,strokes}]}) -> SVG markup. */
export function artworkToSvg(artwork) {
  const width = num(artwork?.width, 1280), height = num(artwork?.height, 800);
  const body = [];
  for (const l of artwork?.layers || []) {
    if (l.visible === false) continue;
    body.push(`<g opacity="${clamp(num(l.opacity, 1), 0, 1)}">${(l.strokes || []).map((e) => elementToSvg(e, { width, height })).join("")}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${safeColor(artwork?.background, "#ffffff")}"/>${body.join("")}</svg>`;
}
