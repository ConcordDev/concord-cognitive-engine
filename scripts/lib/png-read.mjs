/**
 * png-read.mjs — minimal, dependency-free PNG decoder + the pixel measurements
 * the visual-QA harness asserts on.
 *
 * Dependency-free on purpose: this runs in CI next to a 126 MB engine download;
 * adding an image library to the repo root for four measurements is not worth
 * the supply-chain surface. Node's zlib does the only hard part.
 *
 * Supports the subset Godot's `Image.save_png()` emits for a viewport capture:
 * 8-bit RGB / RGBA, non-interlaced. Anything else throws loudly rather than
 * guessing — a mis-decoded frame silently passing assertions would be the
 * worst possible failure mode for a verification harness.
 */

import zlib from 'node:zlib';
import fs from 'node:fs';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode a PNG file to { width, height, channels, data:Uint8Array (RGB or RGBA) }. */
export function decodePng(filePath) {
  const buf = fs.readFileSync(filePath);
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error(`not a PNG: ${filePath}`);

  let pos = 8;
  let ihdr = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      };
    } else if (type === 'IDAT') {
      idat.push(body);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!ihdr) throw new Error(`no IHDR in ${filePath}`);
  if (ihdr.bitDepth !== 8) throw new Error(`unsupported bit depth ${ihdr.bitDepth} in ${filePath}`);
  if (ihdr.interlace !== 0) throw new Error(`interlaced PNG unsupported: ${filePath}`);
  const channels = { 2: 3, 6: 4, 0: 1, 4: 2 }[ihdr.colorType];
  if (!channels) throw new Error(`unsupported colour type ${ihdr.colorType} in ${filePath}`);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);

  let rp = 0;
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = raw.subarray(rp, rp + stride);
    rp += stride;
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      const v = line[x];
      let val;
      switch (filter) {
        case 0: val = v; break;
        case 1: val = v + a; break;
        case 2: val = v + b; break;
        case 3: val = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter} in ${filePath}`);
      }
      cur[x] = val & 0xff;
    }
    out.set(cur, y * stride);
    prev = cur;
  }
  return { width, height, channels, data: out };
}

/** Write a minimal 8-bit RGB PNG (used for golden baselines + diff maps). */
export function encodePngRgb(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgb.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  const chunks = [PNG_SIG];
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9 })));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

/* ── Measurements ─────────────────────────────────────────────────────────── */

/** sRGB byte triple → HSV-ish { h, s, v } with s,v in 0..1. */
export function rgbToHsv(r, g, b) {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;
  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rf) h = ((gf - bf) / d) % 6;
    else if (max === gf) h = (bf - rf) / d + 2;
    else h = (rf - gf) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function pixel(img, x, y) {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/**
 * Whole-frame statistics.
 *   meanChroma      — mean HSV saturation weighted by value (a black pixel has
 *                     no meaningful hue, so it should not drag the mean).
 *   meanLuma        — mean Rec.709 luma 0..1.
 *   lumaStdDev      — 0 for a flat fill; the blank-frame detector.
 *   distinctColors  — count of distinct 5-bit-per-channel colour buckets.
 *   nonBlackRatio   — fraction of pixels above luma 0.02.
 */
export function frameStats(img) {
  const { width, height } = img;
  const n = width * height;
  let sumChroma = 0;
  let chromaWeight = 0;
  let sumLuma = 0;
  let sumLumaSq = 0;
  let nonBlack = 0;
  const buckets = new Set();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(img, x, y);
      const { s, v } = rgbToHsv(r, g, b);
      sumChroma += s * v;
      chromaWeight += v;
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      sumLuma += luma;
      sumLumaSq += luma * luma;
      if (luma > 0.02) nonBlack++;
      buckets.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
    }
  }
  const meanLuma = sumLuma / n;
  return {
    width,
    height,
    pixels: n,
    meanChroma: chromaWeight > 0 ? sumChroma / chromaWeight : 0,
    meanLuma,
    lumaStdDev: Math.sqrt(Math.max(0, sumLumaSq / n - meanLuma * meanLuma)),
    distinctColors: buckets.size,
    nonBlackRatio: nonBlack / n,
  };
}

/**
 * Count connected foreground regions (4-connectivity), where "foreground" is
 * any pixel further than `tol` (in 0..255 max-channel distance) from the
 * frame's most common colour — which for these probe scenes is the background.
 * Regions smaller than `minArea` are ignored as anti-aliasing crumbs.
 */
export function connectedRegions(img, { tol = 26, minArea = 200 } = {}) {
  const { width, height } = img;
  const counts = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(img, x, y);
      const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  let bgKey = 0;
  let bgCount = -1;
  for (const [k, c] of counts) if (c > bgCount) ((bgCount = c), (bgKey = k));
  const bg = [((bgKey >> 12) & 0x3f) << 2, ((bgKey >> 6) & 0x3f) << 2, (bgKey & 0x3f) << 2];

  const fg = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(img, x, y);
      const d = Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
      fg[y * width + x] = d > tol ? 1 : 0;
    }
  }

  const seen = new Uint8Array(width * height);
  const regions = [];
  const stack = new Int32Array(width * height);
  for (let i = 0; i < fg.length; i++) {
    if (!fg[i] || seen[i]) continue;
    let sp = 0;
    stack[sp++] = i;
    seen[i] = 1;
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (sp > 0) {
      const p = stack[--sp];
      const px = p % width;
      const py = (p / width) | 0;
      area++;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      const nb = [
        px > 0 ? p - 1 : -1,
        px < width - 1 ? p + 1 : -1,
        py > 0 ? p - width : -1,
        py < height - 1 ? p + width : -1,
      ];
      for (const q of nb) {
        if (q >= 0 && fg[q] && !seen[q]) {
          seen[q] = 1;
          stack[sp++] = q;
        }
      }
    }
    if (area >= minArea) regions.push({ area, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  regions.sort((a, b) => b.area - a.area);
  return { background: bg, regions, foregroundRatio: fg.reduce((a, v) => a + v, 0) / fg.length };
}

/**
 * Luminance clustering over a region of interest — the toon-ramp measurement.
 * A quantised N-band ramp produces a small number of heavily-populated luma
 * levels; a smooth gradient spreads population across many. Returns the
 * clusters holding at least `minShare` of the sampled pixels, merged when
 * within `mergeTol` of one another.
 */
export function lumaClusters(img, roi, { bins = 64, minShare = 0.06, mergeTol = 2 } = {}) {
  const hist = new Float64Array(bins);
  let total = 0;
  for (let y = roi.minY; y <= roi.maxY; y++) {
    for (let x = roi.minX; x <= roi.maxX; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const [r, g, b] = pixel(img, x, y);
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (roi.mask && !roi.mask(x, y, r, g, b)) continue;
      const bin = Math.min(bins - 1, Math.max(0, Math.floor(luma * bins)));
      hist[bin]++;
      total++;
    }
  }
  if (total === 0) return { total: 0, clusters: [] };
  // Merge adjacent populated bins into runs, then keep runs above minShare.
  const runs = [];
  let cur = null;
  for (let i = 0; i < bins; i++) {
    if (hist[i] / total >= 0.002) {
      if (cur && i - cur.end <= mergeTol) {
        cur.end = i;
        cur.count += hist[i];
        if (hist[i] > cur.peakCount) ((cur.peakCount = hist[i]), (cur.peakBin = i));
      } else {
        cur = { start: i, end: i, count: hist[i], peakBin: i, peakCount: hist[i] };
        runs.push(cur);
      }
    }
  }
  const clusters = runs
    .filter((r) => r.count / total >= minShare)
    .map((r) => ({
      luma: (r.peakBin + 0.5) / bins,
      share: r.count / total,
      spanBins: r.end - r.start + 1,
    }))
    .sort((a, b) => a.luma - b.luma);
  return { total, clusters, histShareTop: clusters.reduce((a, c) => a + c.share, 0) };
}

/** Downsample to a small RGB buffer (box filter) — the golden-baseline form. */
export function downsample(img, outW, outH) {
  const out = new Uint8Array(outW * outH * 3);
  const sx = img.width / outW;
  const sy = img.height / outH;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yy = Math.floor(y * sy); yy < Math.min(img.height, Math.floor((y + 1) * sy)); yy++) {
        for (let xx = Math.floor(x * sx); xx < Math.min(img.width, Math.floor((x + 1) * sx)); xx++) {
          const p = pixel(img, xx, yy);
          r += p[0];
          g += p[1];
          b += p[2];
          n++;
        }
      }
      const i = (y * outW + x) * 3;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
    }
  }
  return out;
}
