// The Darkroom's develop pipeline: one pure module, no imports, no I/O.
//
// The SAME file runs in two places — the browser (a Web Worker renders the
// live preview from a proxy of the photo) and the server (the export renders
// the full-resolution original). A byte-identical copy lives at
// concord-frontend/lib/photos/develop.js and a server test fails if the two
// ever differ, so what you see while editing is what the export computes.
//
// Coordinates. Spots (heal/clone) and masks are stored in SOURCE-normalized
// coordinates: x in [0,1] across the original's width, y in [0,1] down its
// height, radii as a fraction of min(width, height). They survive a crop,
// a rotation or a re-render at any size. Geometry is one affine map from an
// output pixel back to a source pixel (sourceToOutput is its inverse, for a
// UI that has to turn a click on the shown photo into stored coordinates).
//
// Order of operations (the Lightroom order): spots on the source → geometry
// (orientation, flip, straighten, crop) → white balance and exposure in
// linear light → tone (shadows/highlights, whites/blacks, contrast) and
// clarity on luminance → dehaze → tone curve → HSL bands, vibrance and
// saturation → local masks → noise reduction and sharpening → vignette.

export const EDIT_VERSION = 1;

export const HSL_BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];
const BAND_HUES = [0, 30, 60, 120, 180, 240, 280, 320];

const BASIC_RANGES = {
  temperature: [-100, 100], tint: [-100, 100], exposure: [-5, 5],
  contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100],
  whites: [-100, 100], blacks: [-100, 100], clarity: [-100, 100],
  dehaze: [-100, 100], vibrance: [-100, 100], saturation: [-100, 100],
};
const MASK_ADJ_RANGES = {
  exposure: [-4, 4], contrast: [-100, 100], highlights: [-100, 100], shadows: [-100, 100],
  temperature: [-100, 100], tint: [-100, 100], saturation: [-100, 100], clarity: [-100, 100],
};
export const LIMITS = { masks: 24, spots: 200, strokes: 400, strokePoints: 4000, curvePoints: 16 };

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export function defaultEdit() {
  const hsl = {};
  for (const b of HSL_BANDS) hsl[b] = { h: 0, s: 0, l: 0 };
  return {
    v: EDIT_VERSION,
    basic: Object.fromEntries(Object.keys(BASIC_RANGES).map((k) => [k, 0])),
    curve: { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] },
    hsl,
    detail: { sharpen: 0, radius: 1, noise: 0 },
    effects: { vignette: 0 },
    geometry: { orient: 0, flipH: false, angle: 0, crop: { x: 0, y: 0, w: 1, h: 1 } },
    masks: [],
    spots: [],
  };
}

function cleanCurve(pts) {
  if (!Array.isArray(pts)) return [[0, 0], [1, 1]];
  const out = [];
  for (const p of pts.slice(0, LIMITS.curvePoints)) {
    if (!Array.isArray(p)) continue;
    const x = clamp(num(p[0], NaN), 0, 1), y = clamp(num(p[1], NaN), 0, 1);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
  }
  out.sort((a, b) => a[0] - b[0]);
  const dedup = [];
  for (const p of out) if (!dedup.length || p[0] - dedup[dedup.length - 1][0] > 1e-4) dedup.push(p);
  if (dedup.length < 2) return [[0, 0], [1, 1]];
  return dedup;
}

function cleanAdj(raw, ranges) {
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(ranges)) out[k] = clamp(num(raw?.[k]), lo, hi);
  return out;
}

const pt01 = (v) => clamp(num(v, 0.5), -0.5, 1.5);

/** A clean, clamped copy of any edit — the only shape the pipeline trusts. */
export function normalizeEdit(raw) {
  const e = defaultEdit();
  if (!raw || typeof raw !== "object") return e;
  e.basic = cleanAdj(raw.basic, BASIC_RANGES);
  if (raw.curve && typeof raw.curve === "object") for (const c of ["rgb", "r", "g", "b"]) e.curve[c] = cleanCurve(raw.curve[c]);
  if (raw.hsl && typeof raw.hsl === "object") {
    for (const b of HSL_BANDS) {
      const v = raw.hsl[b] || {};
      e.hsl[b] = { h: clamp(num(v.h), -100, 100), s: clamp(num(v.s), -100, 100), l: clamp(num(v.l), -100, 100) };
    }
  }
  const d = raw.detail || {};
  e.detail = { sharpen: clamp(num(d.sharpen), 0, 150), radius: clamp(num(d.radius, 1), 0.5, 3), noise: clamp(num(d.noise), 0, 100) };
  e.effects = { vignette: clamp(num(raw.effects?.vignette), -100, 100) };
  const g = raw.geometry || {};
  const orient = [0, 90, 180, 270].includes(num(g.orient)) ? num(g.orient) : 0;
  const c = g.crop || {};
  let cx = clamp(num(c.x, 0), 0, 1), cy = clamp(num(c.y, 0), 0, 1);
  let cw = clamp(num(c.w, 1), 0.02, 1), ch = clamp(num(c.h, 1), 0.02, 1);
  if (cx + cw > 1) cx = 1 - cw;
  if (cy + ch > 1) cy = 1 - ch;
  e.geometry = { orient, flipH: !!g.flipH, angle: clamp(num(g.angle), -45, 45), crop: { x: cx, y: cy, w: cw, h: ch } };

  if (Array.isArray(raw.masks)) {
    for (const m of raw.masks.slice(0, LIMITS.masks)) {
      if (!m || typeof m !== "object") continue;
      const kind = ["linear", "radial", "brush"].includes(m.kind) ? m.kind : null;
      if (!kind) continue;
      const mask = {
        id: String(m.id || "").slice(0, 40) || `m${e.masks.length + 1}`,
        name: String(m.name || "").slice(0, 60),
        kind, invert: !!m.invert, amount: clamp(num(m.amount, 1), 0, 1),
        adj: cleanAdj(m.adj, MASK_ADJ_RANGES),
      };
      if (kind === "linear") {
        const l = m.linear || {};
        mask.linear = { x1: pt01(l.x1), y1: pt01(l.y1 ?? 0.3), x2: pt01(l.x2), y2: pt01(l.y2 ?? 0.6) };
      } else if (kind === "radial") {
        const r = m.radial || {};
        mask.radial = { cx: pt01(r.cx), cy: pt01(r.cy), rx: clamp(num(r.rx, 0.25), 0.005, 2), ry: clamp(num(r.ry, 0.25), 0.005, 2), angle: clamp(num(r.angle), -180, 180), feather: clamp(num(r.feather, 0.5), 0, 1) };
      } else {
        const strokes = [];
        let budget = LIMITS.strokePoints;
        for (const s of (Array.isArray(m.brush?.strokes) ? m.brush.strokes : []).slice(0, LIMITS.strokes)) {
          const pts = [];
          for (const p of (Array.isArray(s?.pts) ? s.pts : [])) {
            if (budget <= 0) break;
            if (!Array.isArray(p)) continue;
            const x = num(p[0], NaN), y = num(p[1], NaN);
            if (Number.isFinite(x) && Number.isFinite(y)) { pts.push([clamp(x, -0.5, 1.5), clamp(y, -0.5, 1.5)]); budget--; }
          }
          if (pts.length) strokes.push({ pts, size: clamp(num(s.size, 0.05), 0.002, 0.5), feather: clamp(num(s.feather, 0.5), 0, 1), flow: clamp(num(s.flow, 1), 0.05, 1), erase: !!s.erase });
        }
        mask.brush = { strokes };
      }
      e.masks.push(mask);
    }
  }
  if (Array.isArray(raw.spots)) {
    for (const s of raw.spots.slice(0, LIMITS.spots)) {
      if (!s || typeof s !== "object") continue;
      e.spots.push({
        x: clamp(num(s.x, 0.5), 0, 1), y: clamp(num(s.y, 0.5), 0, 1),
        r: clamp(num(s.r, 0.02), 0.002, 0.25),
        sx: clamp(num(s.sx, 0.5), 0, 1), sy: clamp(num(s.sy, 0.5), 0, 1),
        mode: s.mode === "clone" ? "clone" : "heal", feather: clamp(num(s.feather, 0.5), 0, 1),
      });
    }
  }
  return e;
}

/** True when an edit leaves the photo exactly as it was. */
export function isDefaultEdit(raw) {
  const e = normalizeEdit(raw);
  const d = defaultEdit();
  return JSON.stringify({ ...e, masks: [], spots: [] }) === JSON.stringify({ ...d, masks: [], spots: [] }) && !e.masks.length && !e.spots.length;
}

// ── Geometry ──────────────────────────────────────────────────────────

function orientedSize(w, h, orient) { return orient === 90 || orient === 270 ? [h, w] : [w, h]; }

/** The zoom that keeps a straightened photo covering its whole frame. */
function coverScale(w, h, angleDeg) {
  const t = Math.abs(angleDeg) * Math.PI / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return Math.max((w * c + h * s) / w, (w * s + h * c) / h);
}

/** Output size in pixels for a source of srcW×srcH. */
export function outputSize(srcW, srcH, rawEdit) {
  const g = normalizeEdit(rawEdit).geometry;
  const [ow, oh] = orientedSize(srcW, srcH, g.orient);
  return { width: Math.max(1, Math.round(g.crop.w * ow)), height: Math.max(1, Math.round(g.crop.h * oh)) };
}

/**
 * The affine map output-pixel-centre → source pixel (both in pixels).
 * Returns [a, b, c, d, e, f]: sx = a*ox + b*oy + c, sy = d*ox + e*oy + f.
 */
export function outputToSourceMatrix(srcW, srcH, rawEdit) {
  const g = normalizeEdit(rawEdit).geometry;
  const [W, H] = orientedSize(srcW, srcH, g.orient);
  const s = coverScale(W, H, g.angle);
  const th = -g.angle * Math.PI / 180;
  const cos = Math.cos(th) / s, sin = Math.sin(th) / s;
  // frame coords: fx = ox + crop.x*W, fy = oy + crop.y*H (ox, oy at pixel centres)
  const ox0 = g.crop.x * W - W / 2, oy0 = g.crop.y * H - H / 2;
  // oriented coords: p = R(th)/s · (f - c) + c
  //   px = cos*(ox+ox0) - sin*(oy+oy0) + W/2 ; py = sin*(ox+ox0) + cos*(oy+oy0) + H/2
  let A = [cos, -sin, cos * ox0 - sin * oy0 + W / 2, sin, cos, sin * ox0 + cos * oy0 + H / 2];
  // oriented → source (undo flip then rotation by orient)
  const apply = (M, m) => [ // m ∘ M, m = [a,b,c,d,e,f]
    m[0] * M[0] + m[1] * M[3], m[0] * M[1] + m[1] * M[4], m[0] * M[2] + m[1] * M[5] + m[2],
    m[3] * M[0] + m[4] * M[3], m[3] * M[1] + m[4] * M[4], m[3] * M[2] + m[4] * M[5] + m[5],
  ];
  if (g.flipH) A = apply(A, [-1, 0, W, 0, 1, 0]);
  // oriented (W×H) was produced by rotating the source clockwise by orient.
  if (g.orient === 90) A = apply(A, [0, 1, 0, -1, 0, srcH]);       // sx = py, sy = srcH - px
  else if (g.orient === 180) A = apply(A, [-1, 0, srcW, 0, -1, srcH]);
  else if (g.orient === 270) A = apply(A, [0, -1, srcW, 1, 0, 0]);  // sx = srcW - py, sy = px
  // pixel centres: output (i + 0.5), source sample at (sx - 0.5)
  return [A[0], A[1], A[0] * 0.5 + A[1] * 0.5 + A[2] - 0.5, A[3], A[4], A[3] * 0.5 + A[4] * 0.5 + A[5] - 0.5];
}

/** Source-normalized [x, y] for a point on the shown (output) photo given as [0..1, 0..1]. */
export function outputToSourceNorm(srcW, srcH, rawEdit, u, v) {
  const { width, height } = outputSize(srcW, srcH, rawEdit);
  const M = outputToSourceMatrix(srcW, srcH, rawEdit);
  const ox = u * width - 0.5, oy = v * height - 0.5;
  return [(M[0] * ox + M[1] * oy + M[2] + 0.5) / srcW, (M[3] * ox + M[4] * oy + M[5] + 0.5) / srcH];
}

/** The inverse: where a source-normalized point lands on the shown photo, as [0..1, 0..1]. */
export function sourceNormToOutput(srcW, srcH, rawEdit, x, y) {
  const { width, height } = outputSize(srcW, srcH, rawEdit);
  const M = outputToSourceMatrix(srcW, srcH, rawEdit);
  const det = M[0] * M[4] - M[1] * M[3];
  const sx = x * srcW - 0.5 - M[2], sy = y * srcH - 0.5 - M[5];
  const ox = (M[4] * sx - M[1] * sy) / det, oy = (-M[3] * sx + M[0] * sy) / det;
  return [(ox + 0.5) / width, (oy + 0.5) / height];
}

// ── Building blocks ───────────────────────────────────────────────────

const TO_LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
const ENC_N = 4096;
const ENC = new Float32Array(ENC_N + 1);
for (let i = 0; i <= ENC_N; i++) { const c = i / ENC_N; ENC[i] = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
/** In-place gaussian-ish blur: three separable box passes. */
function blurPlane(src, w, h, radius) {
  const r = Math.max(1, Math.round(radius));
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) { // horizontal a → b
      const row = y * w; let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[row + clamp(k, 0, w - 1)];
      for (let x = 0; x < w; x++) {
        b[row + x] = acc / (2 * r + 1);
        acc += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) { // vertical b → a
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += b[clamp(k, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

/** A monotone cubic (Fritsch–Carlson) curve as a 1024-entry lookup over [0,1]. */
export function curveLUT(points, n = 1024) {
  const p = cleanCurve(points);
  const lut = new Float32Array(n);
  const k = p.length;
  const dx = [], dy = [], m = [];
  for (let i = 0; i < k - 1; i++) { dx.push(p[i + 1][0] - p[i][0]); dy.push((p[i + 1][1] - p[i][1]) / dx[i]); }
  m.push(dy[0]);
  for (let i = 1; i < k - 1; i++) m.push(dy[i - 1] * dy[i] <= 0 ? 0 : (dy[i - 1] + dy[i]) / 2);
  m.push(dy[k - 2]);
  for (let i = 0; i < k - 1; i++) {
    if (dy[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / dy[i], b = m[i + 1] / dy[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dy[i]; m[i + 1] = t * b * dy[i]; }
  }
  let seg = 0;
  for (let j = 0; j < n; j++) {
    const x = j / (n - 1);
    if (x <= p[0][0]) { lut[j] = p[0][1]; continue; }
    if (x >= p[k - 1][0]) { lut[j] = p[k - 1][1]; continue; }
    while (seg < k - 2 && x > p[seg + 1][0]) seg++;
    const h = dx[seg], t = (x - p[seg][0]) / h;
    const t2 = t * t, t3 = t2 * t;
    lut[j] = clamp((2 * t3 - 3 * t2 + 1) * p[seg][1] + (t3 - 2 * t2 + t) * h * m[seg] + (-2 * t3 + 3 * t2) * p[seg + 1][1] + (t3 - t2) * h * m[seg + 1], 0, 1);
  }
  return lut;
}
const isIdentityCurve = (pts) => pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;

/** White balance as channel gains, normalized so mid-grey keeps its luminance. */
export function whiteBalanceGains(temperature, tint) {
  const t = clamp(temperature, -100, 100) / 100, g = clamp(tint, -100, 100) / 100;
  let r = Math.pow(2, 0.45 * t), b = Math.pow(2, -0.45 * t), gg = Math.pow(2, -0.3 * g);
  const y = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
  return [r / y, gg / y, b / y];
}

const lumOf = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const sCurve = (L, k) => { const c = clamp(L, 0, 1); return L + k * c * (1 - c) * (2 * c - 1); };

/** Move a pixel's luminance from L0 to L1 keeping its colour. */
function retone(rgb, L0, L1) {
  const t = clamp(L0 / 0.05, 0, 1);
  const ratio = L0 > 1e-5 ? L1 / L0 : 1, add = L1 - L0;
  for (let c = 0; c < 3; c++) rgb[c] = t * rgb[c] * ratio + (1 - t) * (rgb[c] + add);
}

function rgbToHsl(r, g, b, out) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  out[0] = h; out[1] = s; out[2] = l;
}
function hue2c(p, q, t) {
  if (t < 0) t += 1; if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
function hslToRgb(h, s, l, out) {
  if (s <= 1e-6) { out[0] = out[1] = out[2] = l; return; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q, hh = (((h % 360) + 360) % 360) / 360;
  out[0] = hue2c(p, q, hh + 1 / 3); out[1] = hue2c(p, q, hh); out[2] = hue2c(p, q, hh - 1 / 3);
}
/** The two HSL bands a hue falls between and how far along: [i, j, t]. */
function bandsOf(h) {
  const x = ((h % 360) + 360) % 360;
  for (let i = 0; i < BAND_HUES.length; i++) {
    const a = BAND_HUES[i], b = i === BAND_HUES.length - 1 ? 360 : BAND_HUES[i + 1];
    if (x >= a && x < b) return [i, (i + 1) % BAND_HUES.length, (x - a) / (b - a)];
  }
  return [0, 1, 0];
}

// ── Spot healing / cloning (on the source) ────────────────────────────

const RING = 48;
function ringStats(img, w, h, cx, cy, r) {
  const sectors = new Float32Array(8 * 3), counts = new Float32Array(8), mean = [0, 0, 0];
  let n = 0;
  for (let k = 0; k < RING; k++) {
    const a = (k / RING) * Math.PI * 2;
    for (const rr of [1.05, 1.2]) {
      const x = clamp(Math.round(cx + Math.cos(a) * r * rr), 0, w - 1), y = clamp(Math.round(cy + Math.sin(a) * r * rr), 0, h - 1);
      const i = (y * w + x) * 4, sec = Math.floor((k / RING) * 8) % 8;
      for (let c = 0; c < 3; c++) { sectors[sec * 3 + c] += img[i + c]; mean[c] += img[i + c]; }
      counts[sec]++; n++;
    }
  }
  for (let s = 0; s < 8; s++) for (let c = 0; c < 3; c++) sectors[s * 3 + c] /= Math.max(1, counts[s]);
  for (let c = 0; c < 3; c++) mean[c] /= Math.max(1, n);
  return { sectors, mean };
}

function applySpots(img, w, h, spots) {
  if (!spots.length) return img;
  const out = new Uint8ClampedArray(img);
  const md = Math.min(w, h);
  for (const s of spots) {
    const cx = s.x * w, cy = s.y * h, sx = s.sx * w, sy = s.sy * h, r = Math.max(1, s.r * md);
    const inner = 1 - s.feather * 0.9;
    let off = null;
    if (s.mode === "heal") {
      const dst = ringStats(out, w, h, cx, cy, r), src = ringStats(out, w, h, sx, sy, r);
      off = { mean: [0, 1, 2].map((c) => dst.mean[c] - src.mean[c]), sec: new Float32Array(24) };
      for (let i = 0; i < 24; i++) off.sec[i] = dst.sectors[i] - src.sectors[i];
    }
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    const patch = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d >= 1) continue;
        const alpha = d <= inner ? 1 : 1 - smooth((d - inner) / Math.max(1e-3, 1 - inner));
        const px = clamp(Math.round(sx + dx - 0.5), 0, w - 1), py = clamp(Math.round(sy + dy - 0.5), 0, h - 1);
        const si = (py * w + px) * 4, di = (y * w + x) * 4;
        const rgb = [out[si], out[si + 1], out[si + 2]];
        if (off) {
          const ang = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
          const f = (ang / (Math.PI * 2)) * 8, s0 = Math.floor(f) % 8, s1 = (s0 + 1) % 8, t = f - Math.floor(f);
          for (let c = 0; c < 3; c++) {
            const sectorOff = off.sec[s0 * 3 + c] * (1 - t) + off.sec[s1 * 3 + c] * t;
            rgb[c] += off.mean[c] * (1 - d) + sectorOff * d;
          }
        }
        patch.push(di, alpha, rgb[0], rgb[1], rgb[2]);
      }
    }
    // Write after reading so a spot never samples its own new pixels.
    for (let k = 0; k < patch.length; k += 5) {
      const di = patch[k], a = patch[k + 1];
      for (let c = 0; c < 3; c++) out[di + c] = out[di + c] * (1 - a) + patch[k + 2 + c] * a;
    }
  }
  return out;
}

/**
 * Pick where a heal should borrow texture from: the nearby circle whose
 * surroundings best match the spot's own surroundings. Returns {sx, sy}
 * in source-normalized coordinates.
 */
export function findHealSource(img, spot) {
  const { data, width: w, height: h } = img;
  const md = Math.min(w, h), r = Math.max(1, spot.r * md), cx = spot.x * w, cy = spot.y * h;
  const ring = (x0, y0) => {
    const v = [];
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      const x = clamp(Math.round(x0 + Math.cos(a) * r * 1.1), 0, w - 1), y = clamp(Math.round(y0 + Math.sin(a) * r * 1.1), 0, h - 1);
      const i = (y * w + x) * 4; v.push(data[i], data[i + 1], data[i + 2]);
    }
    return v;
  };
  const target = ring(cx, cy);
  let best = null;
  for (const dist of [2.4, 3.2, 4.2]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = cx + Math.cos(a) * r * dist, y = cy + Math.sin(a) * r * dist;
      if (x - r < 0 || y - r < 0 || x + r >= w || y + r >= h) continue;
      const v = ring(x, y);
      let ssd = 0;
      for (let i = 0; i < v.length; i++) { const d = v[i] - target[i]; ssd += d * d; }
      ssd *= 1 + 0.05 * dist; // prefer closer texture on a tie
      if (!best || ssd < best.ssd) best = { ssd, x, y };
    }
  }
  if (!best) return { sx: clamp(spot.x + spot.r * 3, 0, 1), sy: spot.y };
  return { sx: best.x / w, sy: best.y / h };
}

// ── Masks ─────────────────────────────────────────────────────────────

const BRUSH_RES = 768;
function rasterBrush(mask, srcW, srcH) {
  const scale = Math.min(1, BRUSH_RES / Math.max(srcW, srcH));
  const bw = Math.max(1, Math.round(srcW * scale)), bh = Math.max(1, Math.round(srcH * scale));
  const plane = new Float32Array(bw * bh);
  const md = Math.min(bw, bh);
  for (const s of mask.brush.strokes) {
    const r = Math.max(0.75, s.size * md), inner = 1 - s.feather * 0.95;
    const stamp = (cx, cy) => {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(bw - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(bh - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.sqrt(dx * dx + dy * dy) / r;
        if (d >= 1) continue;
        const a = s.flow * (d <= inner ? 1 : 1 - smooth((d - inner) / Math.max(1e-3, 1 - inner)));
        const i = y * bw + x;
        plane[i] = s.erase ? plane[i] * (1 - a) : Math.max(plane[i], a);
      }
    };
    const pts = s.pts.map(([x, y]) => [x * bw, y * bh]);
    stamp(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.25)));
      for (let k = 1; k <= steps; k++) stamp(ax + (bx - ax) * (k / steps), ay + (by - ay) * (k / steps));
    }
  }
  return { plane, bw, bh };
}

/** A weight function (source-normalized x, y) → [0,1] for one mask. */
export function maskWeigher(mask, srcW, srcH) {
  let f;
  if (mask.kind === "linear") {
    const { x1, y1, x2, y2 } = mask.linear;
    // Work in pixel space so the gradient is straight on a non-square photo.
    const ax = x1 * srcW, ay = y1 * srcH, vx = (x2 - x1) * srcW, vy = (y2 - y1) * srcH, L2 = vx * vx + vy * vy || 1;
    f = (x, y) => 1 - smooth(((x * srcW - ax) * vx + (y * srcH - ay) * vy) / L2);
  } else if (mask.kind === "radial") {
    const { cx, cy, rx, ry, angle, feather } = mask.radial;
    const t = angle * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
    const RX = rx * srcW, RY = ry * srcH, inner = 1 - feather;
    f = (x, y) => {
      const dx = (x - cx) * srcW, dy = (y - cy) * srcH;
      const u = (dx * c + dy * s) / RX, v = (-dx * s + dy * c) / RY, d = Math.sqrt(u * u + v * v);
      if (d <= inner) return 1;
      if (d >= 1) return 0;
      return 1 - smooth((d - inner) / Math.max(1e-3, 1 - inner));
    };
  } else {
    const { plane, bw, bh } = rasterBrush(mask, srcW, srcH);
    f = (x, y) => {
      const px = x * bw - 0.5, py = y * bh - 0.5;
      const xi = Math.floor(px), yi = Math.floor(py), fx = px - xi, fy = py - yi;
      const g = (xx, yy) => (xx < 0 || yy < 0 || xx >= bw || yy >= bh ? 0 : plane[yy * bw + xx]);
      return (g(xi, yi) * (1 - fx) + g(xi + 1, yi) * fx) * (1 - fy) + (g(xi, yi + 1) * (1 - fx) + g(xi + 1, yi + 1) * fx) * fy;
    };
  }
  const amt = mask.amount;
  return mask.invert ? (x, y) => amt * (1 - f(x, y)) : (x, y) => amt * f(x, y);
}

function samplePass(img, sw, sh, M, W, H, gr, gg, gb, R, G, B, SX, SY) {
  const enc = (v) => { if (v <= 0) return 0; if (v >= 1) return 1.055 * Math.pow(v, 1 / 2.4) - 0.055; const f = v * ENC_N, j = f | 0; return ENC[j] + (ENC[j + 1] - ENC[j]) * (f - j); };
  // An unrotated, unscaled crop is a straight copy; anything else samples bilinearly.
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const straight = near(M[0], 1) && near(M[1], 0) && near(M[3], 0) && near(M[4], 1) && near(M[2], Math.round(M[2])) && near(M[5], Math.round(M[5]));
  const tx = Math.round(M[2]), ty = Math.round(M[5]);
  const wantCoords = !!SX;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      const sx = M[0] * x + M[1] * y + M[2], sy = M[3] * x + M[4] * y + M[5];
      let lr, lg, lb;
      if (straight) {
        const o = (clamp(y + ty, 0, sh - 1) * sw + clamp(x + tx, 0, sw - 1)) * 4;
        lr = TO_LIN[img[o]]; lg = TO_LIN[img[o + 1]]; lb = TO_LIN[img[o + 2]];
      } else {
        const xi = Math.floor(sx), yi = Math.floor(sy), fx = sx - xi, fy = sy - yi;
        const x0 = xi < 0 ? 0 : xi > sw - 1 ? sw - 1 : xi, x1 = xi + 1 < 0 ? 0 : xi + 1 > sw - 1 ? sw - 1 : xi + 1;
        const y0 = yi < 0 ? 0 : yi > sh - 1 ? sh - 1 : yi, y1 = yi + 1 < 0 ? 0 : yi + 1 > sh - 1 ? sh - 1 : yi + 1;
        const a = (y0 * sw + x0) * 4, bq = (y0 * sw + x1) * 4, c = (y1 * sw + x0) * 4, d = (y1 * sw + x1) * 4;
        const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
        lr = TO_LIN[img[a]] * w00 + TO_LIN[img[bq]] * w10 + TO_LIN[img[c]] * w01 + TO_LIN[img[d]] * w11;
        lg = TO_LIN[img[a + 1]] * w00 + TO_LIN[img[bq + 1]] * w10 + TO_LIN[img[c + 1]] * w01 + TO_LIN[img[d + 1]] * w11;
        lb = TO_LIN[img[a + 2]] * w00 + TO_LIN[img[bq + 2]] * w10 + TO_LIN[img[c + 2]] * w01 + TO_LIN[img[d + 2]] * w11;
      }
      R[i] = enc(lr * gr); G[i] = enc(lg * gg); B[i] = enc(lb * gb);
      if (wantCoords) { SX[i] = (sx + 0.5) / sw; SY[i] = (sy + 0.5) / sh; }
    }
  }
}

// ── The pipeline ──────────────────────────────────────────────────────

/**
 * Develop a photo.
 * @param {{data: Uint8Array|Uint8ClampedArray, width: number, height: number}} src RGBA, sRGB
 * @param {object} rawEdit any edit; it is normalized first
 * @param {{scale?: number}} opts scale = this source's width ÷ the original's
 *   (a preview proxy passes < 1 so pixel-sized settings such as the
 *   sharpening radius mean the same thing at every size)
 * @returns {{data: Uint8ClampedArray, width: number, height: number}}
 */
export function develop(src, rawEdit, opts = {}) {
  const e = normalizeEdit(rawEdit);
  const sw = src.width, sh = src.height;
  const scale = clamp(num(opts.scale, 1), 1e-3, 1);
  const img = applySpots(src.data, sw, sh, e.spots);
  const { width: W, height: H } = outputSize(sw, sh, e);
  const N = W * H;
  const M = outputToSourceMatrix(sw, sh, e);
  const R = new Float32Array(N), G = new Float32Array(N), B = new Float32Array(N);
  const SX = new Float32Array(e.masks.length ? N : 0), SY = new Float32Array(e.masks.length ? N : 0); // source-normalized, for masks
  const b = e.basic;
  const wb = whiteBalanceGains(b.temperature, b.tint), ev = Math.pow(2, b.exposure);
  samplePass(img, sw, sh, M, W, H, wb[0] * ev, wb[1] * ev, wb[2] * ev, R, G, B, e.masks.length > 0 ? SX : null, SY);
  const md = Math.min(W, H);
  const L0 = new Float32Array(N);
  for (let i = 0; i < N; i++) L0[i] = lumOf(R[i], G[i], B[i]);
  const needLocal = b.shadows || b.highlights;
  const anyMaskClarity = e.masks.some((m) => m.adj.clarity);
  const LbLarge = needLocal ? blurPlane(L0, W, H, md * 0.035) : null;
  const LbSmall = b.clarity || anyMaskClarity ? blurPlane(L0, W, H, md * 0.012) : null;

  // Tone on luminance.
  (() => {
  const sh_ = b.shadows / 100, hi = b.highlights / 100, k = b.contrast / 100, cl = b.clarity / 100;
  const bp = -b.blacks / 100 * 0.12, wp = 1 - b.whites / 100 * 0.2;
  if (needLocal || b.whites || b.blacks || k || cl) {
    const rgb = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const L = L0[i];
      let L1 = L;
      if (needLocal) {
        const lb = clamp(LbLarge[i], 0, 1.5);
        const ws = smooth(1 - lb * 2), wh = smooth(lb * 2 - 1);
        L1 += sh_ * 0.4 * ws * (sh_ > 0 ? Math.max(0, 1 - L) * Math.sqrt(Math.max(0, L)) * 2 : L);
        L1 += hi * 0.45 * wh * (hi > 0 ? Math.max(0, 1 - L) : L);
      }
      L1 = (L1 - bp) / (wp - bp);
      L1 = sCurve(L1, k);
      if (cl) { const c = clamp(L1, 0, 1); L1 += cl * 0.9 * (L - LbSmall[i]) * (1 - (2 * c - 1) * (2 * c - 1)); }
      if (L1 !== L) { rgb[0] = R[i]; rgb[1] = G[i]; rgb[2] = B[i]; retone(rgb, L, L1); R[i] = rgb[0]; G[i] = rgb[1]; B[i] = rgb[2]; }
    }
  }
  })();

  // Dehaze: a dark-channel estimate of the haze, removed (or added) per channel.
  (() => {
  if (b.dehaze) {
    const d = b.dehaze / 100;
    const dark = new Float32Array(N);
    for (let i = 0; i < N; i++) dark[i] = clamp(Math.min(R[i], G[i], B[i]), 0, 1);
    const darkB = blurPlane(dark, W, H, md * 0.02);
    const hist = new Uint32Array(256);
    for (let i = 0; i < N; i++) hist[clamp((lumOf(R[i], G[i], B[i]) * 255) | 0, 0, 255)]++;
    let acc = 0, A = 1;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= N * 0.01) { A = Math.max(0.5, v / 255); break; } }
    for (let i = 0; i < N; i++) {
      if (d > 0) {
        const t = Math.max(0.2, 1 - 0.85 * d * darkB[i]);
        R[i] = (R[i] - A) / t + A; G[i] = (G[i] - A) / t + A; B[i] = (B[i] - A) / t + A;
      } else {
        const m = -d * 0.55;
        R[i] += (A - R[i]) * m; G[i] += (A - G[i]) * m; B[i] += (A - B[i]) * m;
      }
    }
  }
  })();

  // Tone curve (master, then per channel).
  (() => {
  const cv = e.curve;
  const curves = [cv.rgb, cv.r, cv.g, cv.b].map((c) => (isIdentityCurve(c) ? null : curveLUT(c)));
  if (curves.some(Boolean)) {
    const look = (lut, v) => { const f = clamp(v, 0, 1) * 1023, j = f | 0, t = f - j; return j >= 1023 ? lut[1023] : lut[j] + (lut[j + 1] - lut[j]) * t; };
    for (let i = 0; i < N; i++) {
      let r = R[i], g = G[i], bb = B[i];
      if (curves[0]) { r = look(curves[0], r); g = look(curves[0], g); bb = look(curves[0], bb); }
      if (curves[1]) r = look(curves[1], r);
      if (curves[2]) g = look(curves[2], g);
      if (curves[3]) bb = look(curves[3], bb);
      R[i] = r; G[i] = g; B[i] = bb;
    }
  }
  })();

  // HSL bands, vibrance, saturation.
  (() => {
  const bands = HSL_BANDS.map((n) => e.hsl[n]);
  const anyHsl = bands.some((v) => v.h || v.s || v.l);
  if (anyHsl || b.vibrance || b.saturation) {
    // The eight bands blend linearly between neighbouring centres, so every
    // hue's shift / saturation / lightness change is a lookup (1/4° steps).
    const HN = 1440, dH = new Float32Array(HN), dS = new Float32Array(HN), dL = new Float32Array(HN);
    if (anyHsl) {
      for (let j = 0; j < HN; j++) {
        const [i0, i1, t] = bandsOf(j / 4);
        const A0 = bands[i0], A1 = bands[i1];
        dH[j] = (A0.h * (1 - t) + A1.h * t) * 0.3; dS[j] = (A0.s * (1 - t) + A1.s * t) / 100; dL[j] = (A0.l * (1 - t) + A1.l * t) / 100;
      }
    }
    const hsl = [0, 0, 0], out = [0, 0, 0];
    const sat = 1 + b.saturation / 100, vib = b.vibrance / 100;
    for (let i = 0; i < N; i++) {
      rgbToHsl(clamp(R[i], 0, 1), clamp(G[i], 0, 1), clamp(B[i], 0, 1), hsl);
      let h = hsl[0], s = hsl[1], l = hsl[2];
      if (s < 1e-4) continue; // a grey pixel has no hue to shift or saturate
      const s0 = s;
      if (anyHsl) {
        const j = ((h * 4) | 0) % HN;
        h += dH[j];
        s *= 1 + dS[j];
        l += dL[j] * 0.3 * (s0 * 1.5 < 1 ? s0 * 1.5 : 1) * (1 - Math.abs(2 * l - 1));
      }
      if (vib) {
        const hh = h < 0 ? h + 360 : h >= 360 ? h - 360 : h;
        const skin = hh > 10 && hh < 50 ? 0.5 : 1;
        s *= 1 + vib * (1 - (s < 1 ? s : 1)) * skin * (vib > 0 ? 1 : 0.8);
      }
      s = s * sat; s = s < 0 ? 0 : s > 1 ? 1 : s;
      hslToRgb(h, s, l < 0 ? 0 : l > 1 ? 1 : l, out);
      R[i] = out[0]; G[i] = out[1]; B[i] = out[2];
    }
  }
  })();

  // Local masks.
  (() => {
  for (const m of e.masks) {
    const a = m.adj;
    if (!Object.values(a).some(Boolean)) continue;
    const weigh = maskWeigher(m, sw, sh);
    const mev = Math.pow(2, a.exposure / 2.2), mwb = whiteBalanceGains(a.temperature, a.tint);
    const mk = a.contrast / 100, msh = a.shadows / 100, mhi = a.highlights / 100, msat = 1 + a.saturation / 100, mcl = a.clarity / 100;
    const rgb = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const w = weigh(SX[i], SY[i]);
      if (w <= 1e-4) continue;
      let r = R[i] * mwb[0] * mev, g = G[i] * mwb[1] * mev, bb = B[i] * mwb[2] * mev;
      const L = lumOf(r, g, bb);
      let L1 = L;
      if (msh) L1 += msh * 0.35 * smooth(1 - L * 2) * (msh > 0 ? Math.max(0, 1 - L) : L);
      if (mhi) L1 += mhi * 0.4 * smooth(L * 2 - 1) * (mhi > 0 ? Math.max(0, 1 - L) : L);
      if (mk) L1 = sCurve(L1, mk);
      if (mcl && LbSmall) { const c = clamp(L1, 0, 1); L1 += mcl * 0.9 * (L0[i] - LbSmall[i]) * (1 - (2 * c - 1) * (2 * c - 1)); }
      if (L1 !== L) { rgb[0] = r; rgb[1] = g; rgb[2] = bb; retone(rgb, L, L1); r = rgb[0]; g = rgb[1]; bb = rgb[2]; }
      if (a.saturation) { const Lm = lumOf(r, g, bb); r = Lm + (r - Lm) * msat; g = Lm + (g - Lm) * msat; bb = Lm + (bb - Lm) * msat; }
      R[i] += (r - R[i]) * w; G[i] += (g - G[i]) * w; B[i] += (bb - B[i]) * w;
    }
  }
  })();

  // Noise reduction and sharpening, on luminance.
  (() => {
  const dt = e.detail;
  if (dt.noise || dt.sharpen) {
    const L = new Float32Array(N);
    for (let i = 0; i < N; i++) L[i] = lumOf(R[i], G[i], B[i]);
    const rgb = [0, 0, 0];
    if (dt.noise) {
      const nb = blurPlane(L, W, H, Math.max(1, 1.5 * scale));
      const amt = dt.noise / 100;
      for (let i = 0; i < N; i++) {
        const diff = Math.abs(L[i] - nb[i]);
        const wgt = amt * (1 - smooth(diff / 0.08)); // smooth flat areas, keep edges
        if (wgt <= 0) continue;
        const L1 = L[i] + (nb[i] - L[i]) * wgt;
        rgb[0] = R[i]; rgb[1] = G[i]; rgb[2] = B[i]; retone(rgb, L[i], L1); R[i] = rgb[0]; G[i] = rgb[1]; B[i] = rgb[2];
        L[i] = L1;
      }
    }
    if (dt.sharpen) {
      const rad = dt.radius * scale;
      const sb = rad >= 0.6 ? blurPlane(L, W, H, rad) : null;
      if (sb) {
        const amt = dt.sharpen / 100;
        for (let i = 0; i < N; i++) {
          const detail = L[i] - sb[i];
          if (Math.abs(detail) < 0.004) continue;
          const L1 = L[i] + amt * detail;
          rgb[0] = R[i]; rgb[1] = G[i]; rgb[2] = B[i]; retone(rgb, L[i], L1); R[i] = rgb[0]; G[i] = rgb[1]; B[i] = rgb[2];
        }
      }
    }
  }
  })();

  // Vignette (after the crop, centred on the shown frame).
  const out = (() => {
  const vg = e.effects.vignette / 100;
  const out = new Uint8ClampedArray(N * 4);
  const hx = W / 2, hy = H / 2;
  for (let y = 0, i = 0; y < H; y++) {
    for (let x = 0; x < W; x++, i++) {
      let r = R[i], g = G[i], bb = B[i];
      if (vg) {
        const d = Math.hypot((x + 0.5 - hx) / hx, (y + 0.5 - hy) / hy) / Math.SQRT2;
        const f = smooth((d - 0.35) / 0.75);
        if (vg < 0) { const m = 1 + vg * f * 0.9; r *= m; g *= m; bb *= m; }
        else { const m = vg * f * 0.9; r += (1 - r) * m; g += (1 - g) * m; bb += (1 - bb) * m; }
      }
      const o = i * 4;
      out[o] = Math.round(clamp(r, 0, 1) * 255); out[o + 1] = Math.round(clamp(g, 0, 1) * 255); out[o + 2] = Math.round(clamp(bb, 0, 1) * 255); out[o + 3] = 255;
    }
  }
  return out;
  })();
  return { data: out, width: W, height: H };
}

/** Per-channel and luminance histograms (256 bins) plus clipped-pixel counts. */
export function histogram(img, step = 1) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  let low = 0, high = 0, n = 0;
  const d = img.data, s = Math.max(1, Math.floor(step)) * 4;
  for (let i = 0; i < d.length; i += s) {
    const R_ = d[i], G_ = d[i + 1], B_ = d[i + 2];
    r[R_]++; g[G_]++; b[B_]++;
    const L = Math.round(lumOf(R_, G_, B_)); l[L]++;
    if (R_ === 0 && G_ === 0 && B_ === 0) low++;
    if (R_ === 255 || G_ === 255 || B_ === 255) high++;
    n++;
  }
  return { r, g, b, l, clippedShadows: low, clippedHighlights: high, samples: n };
}
