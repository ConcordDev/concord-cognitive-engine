// Read the camera facts out of a photo's EXIF block (the buffer sharp's
// metadata() returns as `exif`: "Exif\0\0" then a TIFF structure). Only the
// fields a photographer reads in a darkroom: camera, lens, exposure triangle,
// focal length, capture time, orientation and GPS position. Unknown or
// malformed data yields fewer fields, never a guess.

const TAGS_IFD0 = { 0x010f: "make", 0x0110: "model", 0x0112: "orientation", 0x0131: "software", 0x0132: "modifiedAt", 0x8769: "_exif", 0x8825: "_gps" };
const TAGS_EXIF = { 0x829a: "exposureTime", 0x829d: "fNumber", 0x8827: "iso", 0x9003: "capturedAt", 0x920a: "focalLength", 0xa405: "focalLength35", 0xa434: "lens", 0x9204: "exposureBias", 0x9209: "flash", 0xa002: "pixelWidth", 0xa003: "pixelHeight" };
const TAGS_GPS = { 0x0001: "latRef", 0x0002: "lat", 0x0003: "lonRef", 0x0004: "lon", 0x0006: "altitude" };
const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

function readIfd(buf, base, off, le, tags, out) {
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const i32 = (o) => (le ? buf.readInt32LE(o) : buf.readInt32BE(o));
  if (off + 2 > buf.length) return;
  const n = u16(off);
  if (n > 500) return;
  for (let k = 0; k < n; k++) {
    const e = off + 2 + k * 12;
    if (e + 12 > buf.length) return;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const name = tags[tag];
    if (!name) continue;
    const size = (SIZES[type] || 1) * count;
    const vo = size <= 4 ? e + 8 : base + u32(e + 8);
    if (vo < 0 || vo + size > buf.length) continue;
    let v;
    if (type === 2) v = buf.toString("latin1", vo, vo + count).replace(/\0.*$/s, "").trim();
    else if (type === 3) v = count === 1 ? u16(vo) : Array.from({ length: Math.min(count, 8) }, (_, j) => u16(vo + j * 2));
    else if (type === 4) v = count === 1 ? u32(vo) : null;
    else if (type === 5 || type === 10) {
      const rd = (j) => { const a = type === 5 ? u32(vo + j * 8) : i32(vo + j * 8), b = type === 5 ? u32(vo + j * 8 + 4) : i32(vo + j * 8 + 4); return b ? a / b : null; };
      v = count === 1 ? rd(0) : Array.from({ length: Math.min(count, 4) }, (_, j) => rd(j));
    } else continue;
    out[name] = v;
  }
}

/** Parse an EXIF buffer into plain fields; {} when there is nothing readable. */
export function parseExif(raw) {
  try {
    if (!Buffer.isBuffer(raw) || raw.length < 14) return {};
    let base = 0;
    if (raw.toString("latin1", 0, 6) === "Exif\0\0") base = 6;
    const order = raw.toString("latin1", base, base + 2);
    const le = order === "II";
    if (!le && order !== "MM") return {};
    const u32 = (o) => (le ? raw.readUInt32LE(o) : raw.readUInt32BE(o));
    const out = {};
    readIfd(raw, base, base + u32(base + 4), le, TAGS_IFD0, out);
    if (out._exif) readIfd(raw, base, base + out._exif, le, TAGS_EXIF, out);
    const gps = {};
    if (out._gps) readIfd(raw, base, base + out._gps, le, TAGS_GPS, gps);
    delete out._exif; delete out._gps;
    const dms = (a) => (Array.isArray(a) && a.length >= 3 && a.every((x) => Number.isFinite(x)) ? a[0] + a[1] / 60 + a[2] / 3600 : null);
    const lat = dms(gps.lat), lon = dms(gps.lon);
    if (lat != null && lon != null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      out.gps = { lat: Math.round((gps.latRef === "S" ? -lat : lat) * 1e6) / 1e6, lon: Math.round((gps.lonRef === "W" ? -lon : lon) * 1e6) / 1e6 };
    }
    if (Array.isArray(out.iso)) out.iso = out.iso[0];
    for (const k of Object.keys(out)) if (out[k] == null || out[k] === "" || (typeof out[k] === "number" && !Number.isFinite(out[k]))) delete out[k];
    return out;
  } catch { return {}; }
}

/** "1/250 s", "2 s" */
export function formatShutter(t) {
  if (!(t > 0)) return null;
  if (t >= 1) return `${Math.round(t * 10) / 10} s`;
  return `1/${Math.round(1 / t)} s`;
}

/** EXIF "2026:11:20 14:05:09" → unix seconds (local time read as UTC; EXIF carries no zone). */
export function exifTime(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ""));
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isFinite(t) && t > 0 ? Math.round(t / 1000) : null;
}
