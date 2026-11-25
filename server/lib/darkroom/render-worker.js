// A render job off the main thread: decode a photo with sharp (EXIF
// orientation applied), run the shared develop pipeline on its pixels, and
// encode the result. Used for exports, release proofs and release downloads.

import { parentPort } from "node:worker_threads";
import sharp from "sharp";
import { develop, outputSize } from "./develop.js";

const MAX_PIXELS = 80_000_000;

function watermarkSvg(w, h, text) {
  const size = Math.max(14, Math.round(Math.min(w, h) / 16));
  const esc = String(text).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const rows = [];
  const stepY = size * 4.2, stepX = size * 12;
  for (let y = -h; y < h * 2; y += stepY) {
    for (let x = -w; x < w * 2; x += stepX) rows.push(`<text x="${x.toFixed(0)}" y="${y.toFixed(0)}">${esc}</text>`);
  }
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <g transform="rotate(-28 ${w / 2} ${h / 2})" font-family="Helvetica, Arial, sans-serif" font-size="${size}" font-weight="600" fill="#ffffff" fill-opacity="0.22" stroke="#000000" stroke-opacity="0.18" stroke-width="1">${rows.join("")}</g>
  </svg>`);
}

async function render(job) {
  const base = sharp(job.path, { limitInputPixels: MAX_PIXELS, failOn: "error" }).rotate();
  const meta = await sharp(job.path, { limitInputPixels: MAX_PIXELS }).metadata();
  const swap = (meta.orientation || 1) >= 5;
  const fullW = swap ? meta.height : meta.width, fullH = swap ? meta.width : meta.height;
  let pipe = base;
  let scale = 1;
  // Resize BEFORE developing when the output is smaller: the crop is
  // normalized, so the recipe means the same thing at any size, and a small
  // export should not pay for a full-size render.
  // longEdge is the FINISHED photo's long edge (after crop and rotation).
  const want = Math.round(Number(job.longEdge) || 0);
  const out0 = outputSize(fullW, fullH, job.edit);
  if (want > 0 && Math.max(out0.width, out0.height) > want) {
    scale = want / Math.max(out0.width, out0.height);
    pipe = pipe.resize({ width: Math.max(1, Math.round(fullW * scale)), height: Math.max(1, Math.round(fullH * scale)), fit: "fill" });
  }
  const { data, info } = await pipe.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = develop({ data, width: info.width, height: info.height }, job.edit, { scale });
  let enc = sharp(Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength), { raw: { width: out.width, height: out.height, channels: 4 } }).removeAlpha();
  if (job.watermark) enc = enc.composite([{ input: watermarkSvg(out.width, out.height, job.watermark), top: 0, left: 0 }]);
  const q = Math.max(40, Math.min(100, Math.round(Number(job.quality) || 90)));
  if (job.format === "png") enc = enc.png({ compressionLevel: 8 });
  else if (job.format === "webp") enc = enc.webp({ quality: q });
  else enc = enc.jpeg({ quality: q, mozjpeg: true, chromaSubsampling: q >= 90 ? "4:4:4" : "4:2:0" });
  if (job.exif && typeof job.exif === "object") enc = enc.withExif(job.exif);
  const buf = await enc.toBuffer();
  return { buf, width: out.width, height: out.height };
}

parentPort.on("message", async (job) => {
  try {
    const { buf, width, height } = await render(job);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parentPort.postMessage({ id: job.id, ok: true, buf: ab, width, height }, [ab]);
  } catch (err) {
    parentPort.postMessage({ id: job.id, ok: false, error: String(err?.message || err).slice(0, 300) });
  }
});
