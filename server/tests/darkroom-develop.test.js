// The Darkroom's develop pipeline, pinned at the pixel level: each control
// does what its name says and nothing else, coordinates survive every
// geometry change, masks and spots stay where they were put, hostile input
// is clamped, and the browser runs the very same file the export runs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  develop, normalizeEdit, isDefaultEdit, defaultEdit, outputSize, outputToSourceNorm, sourceNormToOutput,
  curveLUT, whiteBalanceGains, histogram, findHealSource, maskWeigher, LIMITS,
} from "../lib/darkroom/develop.js";
import { parseExif, formatShutter, exifTime } from "../lib/darkroom/exif.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const enc = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));

function flat(w, h, rgb) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = 255; }
  return { data: d, width: w, height: h };
}
function ramp(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = Math.round((x / (w - 1)) * 255); d[i + 1] = Math.round((y / (h - 1)) * 255); d[i + 2] = 96; d[i + 3] = 255; }
  return { data: d, width: w, height: h };
}
function greyRamp(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; d[i] = d[i + 1] = d[i + 2] = Math.round((x / (w - 1)) * 255); d[i + 3] = 255; }
  return { data: d, width: w, height: h };
}
const px = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };

describe("one pipeline, two places", () => {
  it("the browser's copy is byte-identical to the server's", () => {
    const a = fs.readFileSync(path.join(here, "../lib/darkroom/develop.js"));
    const b = fs.readFileSync(path.join(here, "../../concord-frontend/lib/photos/develop.js"));
    assert.ok(a.equals(b), "concord-frontend/lib/photos/develop.js has drifted from server/lib/darkroom/develop.js — copy it over");
  });
});

describe("a default edit changes nothing", () => {
  it("returns every pixel exactly", () => {
    const src = ramp(97, 61);
    const out = develop(src, defaultEdit());
    assert.equal(out.width, 97); assert.equal(out.height, 61);
    for (let i = 0; i < src.data.length; i++) assert.equal(out.data[i], src.data[i]);
    assert.equal(isDefaultEdit({}), true);
    assert.equal(isDefaultEdit({ basic: { exposure: 0.1 } }), false);
    assert.equal(isDefaultEdit({ spots: [{ x: 0.5, y: 0.5 }] }), false);
  });
});

describe("light", () => {
  it("+1 EV doubles linear light, −1 halves it", () => {
    const src = flat(8, 8, [118, 118, 118]);
    const up = px(develop(src, { basic: { exposure: 1 } }), 3, 3);
    const down = px(develop(src, { basic: { exposure: -1 } }), 3, 3);
    assert.deepEqual(up, Array(3).fill(enc(lin(118) * 2)));
    assert.deepEqual(down, Array(3).fill(enc(lin(118) / 2)));
  });
  it("contrast pushes tones apart around the middle and keeps order", () => {
    const src = greyRamp(256, 4);
    const out = develop(src, { basic: { contrast: 60 } });
    const before = [40, 200].map((x) => px(src, x, 1)[0]), after = [40, 200].map((x) => px(out, x, 1)[0]);
    assert.ok(after[0] < before[0] && after[1] > before[1], `${before} → ${after}`);
    for (let x = 1; x < 256; x++) assert.ok(px(out, x, 1)[0] >= px(out, x - 1, 1)[0], `not monotone at ${x}`);
  });
  it("shadows lifts dark areas and leaves bright ones; highlights does the reverse", () => {
    const w = 200, h = 20, src = greyRamp(w, h);
    const sh = develop(src, { basic: { shadows: 80 } }), hi = develop(src, { basic: { highlights: -80 } });
    assert.ok(px(sh, 20, 10)[0] > px(src, 20, 10)[0] + 5);
    assert.ok(Math.abs(px(sh, 190, 10)[0] - px(src, 190, 10)[0]) <= 3);
    assert.ok(px(hi, 190, 10)[0] < px(src, 190, 10)[0] - 5);
    assert.ok(Math.abs(px(hi, 20, 10)[0] - px(src, 20, 10)[0]) <= 3);
  });
  it("whites and blacks move the end points", () => {
    const src = flat(4, 4, [200, 200, 200]);
    assert.ok(px(develop(src, { basic: { whites: 60 } }), 1, 1)[0] > 200);
    const dark = flat(4, 4, [30, 30, 30]);
    assert.ok(px(develop(dark, { basic: { blacks: -60 } }), 1, 1)[0] < 30);
  });
});

describe("colour", () => {
  it("white balance keeps a grey's brightness and warms or cools it", () => {
    const [r, g, b] = whiteBalanceGains(40, 0);
    assert.ok(Math.abs(0.2126 * r + 0.7152 * g + 0.0722 * b - 1) < 1e-9);
    const warm = px(develop(flat(4, 4, [128, 128, 128]), { basic: { temperature: 40 } }), 1, 1);
    const cool = px(develop(flat(4, 4, [128, 128, 128]), { basic: { temperature: -40 } }), 1, 1);
    assert.ok(warm[0] > warm[2] && cool[2] > cool[0], `${warm} / ${cool}`);
    const tint = px(develop(flat(4, 4, [128, 128, 128]), { basic: { tint: 50 } }), 1, 1);
    assert.ok(tint[1] < tint[0], "+tint is magenta: less green");
  });
  it("saturation −100 makes black and white", () => {
    const out = develop(ramp(40, 40), { basic: { saturation: -100 } });
    for (let i = 0; i < out.data.length; i += 4) assert.ok(Math.abs(out.data[i] - out.data[i + 1]) <= 1 && Math.abs(out.data[i + 1] - out.data[i + 2]) <= 1);
  });
  it("vibrance lifts a dull colour more than a vivid one", () => {
    const dull = flat(2, 2, [140, 120, 110]), vivid = flat(2, 2, [40, 90, 230]);
    const chroma = (c) => Math.max(...c) - Math.min(...c);
    const dg = chroma(px(develop(dull, { basic: { vibrance: 80 } }), 0, 0)) / chroma(px(dull, 0, 0));
    const vg = chroma(px(develop(vivid, { basic: { vibrance: 80 } }), 0, 0)) / chroma(px(vivid, 0, 0));
    assert.ok(dg > vg, `dull ×${dg.toFixed(2)} vs vivid ×${vg.toFixed(2)}`);
  });
  it("an HSL band moves its own colours only", () => {
    const blue = flat(2, 2, [40, 40, 220]), red = flat(2, 2, [220, 40, 40]), grey = flat(2, 2, [128, 128, 128]);
    const e = { hsl: { blue: { h: 0, s: -100, l: 0 } } };
    const b2 = px(develop(blue, e), 0, 0);
    assert.ok(Math.max(...b2) - Math.min(...b2) <= 2, `blue desaturated: ${b2}`);
    assert.deepEqual(px(develop(red, e), 0, 0), px(red, 0, 0));
    assert.deepEqual(px(develop(grey, e), 0, 0), px(grey, 0, 0));
  });
});

describe("the tone curve", () => {
  it("passes through its points and never turns back", () => {
    const pts = [[0, 0], [0.25, 0.15], [0.5, 0.55], [0.75, 0.9], [1, 1]];
    const lut = curveLUT(pts);
    for (const [x, y] of pts) assert.ok(Math.abs(lut[Math.round(x * 1023)] - y) < 0.005, `(${x}, ${y})`);
    for (let i = 1; i < lut.length; i++) assert.ok(lut[i] >= lut[i - 1] - 1e-6);
  });
  it("a per-channel curve touches only that channel", () => {
    const src = flat(2, 2, [128, 128, 128]);
    const out = px(develop(src, { curve: { r: [[0, 0], [0.5, 0.7], [1, 1]] } }), 0, 0);
    assert.ok(out[0] > 150); assert.equal(out[1], 128); assert.equal(out[2], 128);
  });
});

describe("geometry", () => {
  it("a crop gives the cropped size and the cropped pixels", () => {
    const src = ramp(100, 50);
    const e = { geometry: { crop: { x: 0.5, y: 0.2, w: 0.3, h: 0.4 } } };
    assert.deepEqual(outputSize(100, 50, e), { width: 30, height: 20 });
    const out = develop(src, e);
    assert.deepEqual(px(out, 0, 0), px(src, 50, 10));
  });
  it("rotating 90° turns the frame and puts the left edge at the top", () => {
    const src = ramp(60, 30);
    const out = develop(src, { geometry: { orient: 90 } });
    assert.deepEqual([out.width, out.height], [30, 60]);
    // clockwise: the source's bottom-left corner lands top-left
    assert.deepEqual(px(out, 0, 0), px(src, 0, 29));
    assert.deepEqual(px(develop(src, { geometry: { flipH: true } }), 0, 0), px(src, 59, 0));
  });
  it("a point on the shown photo maps to the source and back through any rotation, straighten and crop", () => {
    const e = { geometry: { orient: 270, flipH: true, angle: 7.5, crop: { x: 0.12, y: 0.2, w: 0.6, h: 0.55 } } };
    for (const [u, v] of [[0.1, 0.1], [0.5, 0.5], [0.9, 0.3]]) {
      const [x, y] = outputToSourceNorm(4000, 3000, e, u, v);
      const [u2, v2] = sourceNormToOutput(4000, 3000, e, x, y);
      assert.ok(Math.abs(u2 - u) < 1e-9 && Math.abs(v2 - v) < 1e-9);
    }
  });
  it("straightening zooms just enough that no empty corner shows", () => {
    const out = develop(flat(200, 120, [200, 50, 50]), { geometry: { angle: 12 } });
    for (const [x, y] of [[0, 0], [out.width - 1, 0], [0, out.height - 1], [out.width - 1, out.height - 1]]) assert.deepEqual(px(out, x, y), [200, 50, 50]);
  });
});

describe("local masks", () => {
  it("a radial mask brightens inside and leaves outside; inverted it is the other way round", () => {
    const src = flat(100, 100, [100, 100, 100]);
    const m = { kind: "radial", radial: { cx: 0.5, cy: 0.5, rx: 0.2, ry: 0.2, feather: 0.2 }, adj: { exposure: 1 } };
    const a = develop(src, { masks: [m] }), b = develop(src, { masks: [{ ...m, invert: true }] });
    assert.ok(px(a, 50, 50)[0] > 120); assert.equal(px(a, 5, 5)[0], 100);
    assert.equal(px(b, 50, 50)[0], 100); assert.ok(px(b, 5, 5)[0] > 120);
  });
  it("a linear gradient goes from full to none between its two points", () => {
    const src = flat(10, 100, [100, 100, 100]);
    const out = develop(src, { masks: [{ kind: "linear", linear: { x1: 0.5, y1: 0.2, x2: 0.5, y2: 0.6 }, adj: { exposure: -1 } }] });
    assert.ok(px(out, 5, 5)[0] < 80); assert.equal(px(out, 5, 90)[0], 100);
    assert.ok(px(out, 5, 40)[0] > px(out, 5, 5)[0] && px(out, 5, 40)[0] < 100);
  });
  it("a brush stroke paints where it was drawn, and erasing takes it back", () => {
    const src = flat(120, 80, [100, 100, 100]);
    const stroke = { pts: [[0.2, 0.5], [0.8, 0.5]], size: 0.06, feather: 0.3 };
    const out = develop(src, { masks: [{ kind: "brush", brush: { strokes: [stroke] }, adj: { exposure: 1 } }] });
    assert.ok(px(out, 60, 40)[0] > 120); assert.equal(px(out, 60, 5)[0], 100);
    const erased = develop(src, { masks: [{ kind: "brush", brush: { strokes: [stroke, { ...stroke, erase: true, size: 0.1 }] }, adj: { exposure: 1 } }] });
    assert.equal(px(erased, 60, 40)[0], 100);
  });
  it("a mask stays on its spot in the photo when the photo is cropped", () => {
    const src = flat(200, 200, [100, 100, 100]);
    const m = { kind: "radial", radial: { cx: 0.75, cy: 0.75, rx: 0.05, ry: 0.05, feather: 0 }, adj: { exposure: 1 } };
    const out = develop(src, { masks: [m], geometry: { crop: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 } } });
    assert.ok(px(out, 50, 50)[0] > 120, "the masked spot is now at the centre of the crop");
    const w = maskWeigher(normalizeEdit({ masks: [m] }).masks[0], 200, 200);
    assert.equal(w(0.75, 0.75), 1); assert.equal(w(0.1, 0.1), 0);
  });
});

describe("spot healing and cloning", () => {
  function blemished() {
    const img = flat(120, 120, [180, 150, 120]);
    for (let y = 50; y < 70; y++) for (let x = 50; x < 70; x++) { const i = (y * 120 + x) * 4; img.data[i] = 30; img.data[i + 1] = 20; img.data[i + 2] = 20; }
    return img;
  }
  it("a clone copies the source area over the spot", () => {
    const out = develop(blemished(), { spots: [{ x: 60 / 120, y: 60 / 120, r: 0.12, sx: 20 / 120, sy: 20 / 120, mode: "clone", feather: 0 }] });
    assert.deepEqual(px(out, 60, 60), [180, 150, 120]);
  });
  it("a heal takes the texture from the source and the tone from around the spot", () => {
    const img = blemished();
    // a slightly darker source area: heal must match the surroundings, clone wouldn't
    for (let y = 5; y < 40; y++) for (let x = 5; x < 40; x++) { const i = (y * 120 + x) * 4; img.data[i] = 160; img.data[i + 1] = 130; img.data[i + 2] = 100; }
    const spot = { x: 0.5, y: 0.5, r: 0.12, sx: 22 / 120, sy: 22 / 120, feather: 0 };
    const healed = px(develop(img, { spots: [{ ...spot, mode: "heal" }] }), 60, 60);
    const cloned = px(develop(img, { spots: [{ ...spot, mode: "clone" }] }), 60, 60);
    assert.deepEqual(cloned, [160, 130, 100]);
    assert.ok(Math.abs(healed[0] - 180) <= 4 && Math.abs(healed[2] - 120) <= 4, `healed ${healed}`);
  });
  it("picks a clean source nearby on its own", () => {
    const img = blemished();
    const { sx, sy } = findHealSource(img, { x: 0.5, y: 0.5, r: 0.08 });
    const [r] = px(img, Math.round(sx * 120), Math.round(sy * 120));
    assert.equal(r, 180, "the chosen source is clean skin, not the blemish");
  });
});

describe("detail and effects", () => {
  it("sharpening raises edge contrast; noise reduction flattens grain", () => {
    const src = flat(60, 60, [100, 100, 100]);
    for (let y = 0; y < 60; y++) for (let x = 30; x < 60; x++) { const i = (y * 60 + x) * 4; src.data[i] = src.data[i + 1] = src.data[i + 2] = 160; }
    const sh = develop(src, { detail: { sharpen: 120, radius: 1.5 } });
    assert.ok(px(sh, 31, 30)[0] > 160 && px(sh, 28, 30)[0] < 100);
    const noisy = flat(60, 60, [120, 120, 120]);
    for (let i = 0; i < noisy.data.length; i += 4) { const n = ((i * 2654435761) >>> 28) - 8; noisy.data[i] += n; noisy.data[i + 1] += n; noisy.data[i + 2] += n; }
    const dev = (img) => { let s = 0, s2 = 0, n = 0; for (let i = 0; i < img.data.length; i += 4) { s += img.data[i]; s2 += img.data[i] ** 2; n++; } return Math.sqrt(s2 / n - (s / n) ** 2); };
    assert.ok(dev(develop(noisy, { detail: { noise: 100 } })) < dev(noisy) * 0.8);
  });
  it("a negative vignette darkens the corners and not the centre", () => {
    const out = develop(flat(100, 80, [150, 150, 150]), { effects: { vignette: -80 } });
    assert.ok(px(out, 1, 1)[0] < 120); assert.equal(px(out, 50, 40)[0], 150);
  });
});

describe("a preview means what the export means", () => {
  it("developing a half-size proxy matches developing full size and shrinking it", async () => {
    const big = ramp(400, 300);
    const e = { basic: { exposure: 0.4, contrast: 25, shadows: 30, highlights: -30, vibrance: 20, temperature: 15 }, curve: { rgb: [[0, 0], [0.3, 0.25], [1, 1]] }, hsl: { green: { h: 10, s: -20, l: 5 } }, geometry: { angle: 3, crop: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } } };
    const full = develop(big, e);
    const fullHalf = await sharp(Buffer.from(full.data), { raw: { width: full.width, height: full.height, channels: 4 } }).resize(Math.round(full.width / 2), Math.round(full.height / 2)).raw().toBuffer();
    const smallSrc = await sharp(Buffer.from(big.data), { raw: { width: 400, height: 300, channels: 4 } }).resize(200, 150).raw().toBuffer();
    const proxy = develop({ data: new Uint8ClampedArray(smallSrc), width: 200, height: 150 }, e, { scale: 0.5 });
    assert.equal(proxy.width, Math.round(full.width / 2));
    let sum = 0, n = 0;
    for (let i = 0; i < Math.min(proxy.data.length, fullHalf.length); i++) { if (i % 4 === 3) continue; sum += Math.abs(proxy.data[i] - fullHalf[i]); n++; }
    assert.ok(sum / n < 3, `mean difference ${(sum / n).toFixed(2)} of 255`);
  });
});

describe("hostile input", () => {
  it("clamps every number, drops junk, and caps the counts", () => {
    const e = normalizeEdit({
      basic: { exposure: 1e9, contrast: -Infinity, shadows: "lots", __proto__: { polluted: 1 } },
      curve: { rgb: [[2, -3], ["x", 1], [0.5, 0.5]] },
      geometry: { orient: 45, angle: 900, crop: { x: 0.9, y: -1, w: 0.5, h: 7 } },
      masks: Array.from({ length: 100 }, () => ({ kind: "radial", adj: { exposure: 99 } })).concat([{ kind: "evil" }]),
      spots: Array.from({ length: 1000 }, () => ({ x: 9, y: -9, r: 5 })),
    });
    assert.equal(e.basic.exposure, 5); assert.equal(e.basic.contrast, 0); assert.equal(e.basic.shadows, 0);
    assert.equal(({}).polluted, undefined);
    assert.deepEqual(e.curve.rgb, [[0.5, 0.5], [1, 0]]);
    assert.deepEqual([e.geometry.orient, e.geometry.angle], [0, 45]);
    assert.ok(e.geometry.crop.x + e.geometry.crop.w <= 1 && e.geometry.crop.h === 1);
    assert.equal(e.masks.length, LIMITS.masks); assert.equal(e.masks[0].adj.exposure, 4);
    assert.equal(e.spots.length, LIMITS.spots); assert.deepEqual([e.spots[0].x, e.spots[0].y, e.spots[0].r], [1, 0, 0.25]);
    assert.doesNotThrow(() => develop(flat(20, 20, [1, 2, 3]), e));
  });
});

describe("histogram", () => {
  it("counts every pixel and the clipped ones", () => {
    const img = flat(10, 10, [0, 0, 0]);
    for (let i = 0; i < 40; i += 4) img.data[i] = 255;
    const h = histogram(img);
    assert.equal(h.samples, 100); assert.equal(h.clippedShadows, 90); assert.equal(h.clippedHighlights, 10);
    assert.equal(h.r[255], 10); assert.equal(h.g[0], 100);
  });
});

describe("camera facts", () => {
  it("reads what a camera wrote, GPS included", async () => {
    const buf = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#777" } }).jpeg()
      .withExif({ IFD0: { Make: "Fujifilm", Model: "X-T5" }, IFD2: { ExposureTime: "1/250", FNumber: "56/10", ISOSpeedRatings: "320", DateTimeOriginal: "2026:10:04 07:41:12", FocalLength: "33/1", LensModel: "XF33mmF1.4" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "33/1 52/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "151/1 12/1 36/1" } })
      .toBuffer();
    const ex = parseExif((await sharp(buf).metadata()).exif);
    assert.deepEqual([ex.make, ex.model, ex.iso, ex.fNumber, ex.focalLength, ex.lens], ["Fujifilm", "X-T5", 320, 5.6, 33, "XF33mmF1.4"]);
    assert.equal(formatShutter(ex.exposureTime), "1/250 s");
    assert.deepEqual(ex.gps, { lat: -33.866667, lon: 151.21 });
    assert.equal(exifTime(ex.capturedAt), Date.UTC(2026, 9, 4, 7, 41, 12) / 1000);
    assert.deepEqual(parseExif(Buffer.from("not exif at all")), {});
  });
});
