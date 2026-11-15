/**
 * exif.ts — minimal client-side EXIF reader for photo uploads.
 *
 * Same approach as components/geology/exif.ts (no dependency — reads
 * the JPEG APP1 TIFF structure directly), extended to the fields the
 * photography lens displays: camera, lens, ISO, aperture, shutter,
 * focal length, and capture time. Returns only real values found in
 * the file; absent tags come back as null so the UI can show exactly
 * what the file carried — nothing is fabricated.
 */

export interface PhotoExif {
  camera: string | null;
  lens: string | null;
  iso: number | null;
  aperture: number | null;
  /** Display-ready exposure time, e.g. "1/250" or "2". */
  shutter: string | null;
  /** Focal length in mm. */
  focalLength: number | null;
  /** ISO-8601 capture time from DateTimeOriginal, when present. */
  takenAt: string | null;
}

const EMPTY: PhotoExif = {
  camera: null, lens: null, iso: null, aperture: null,
  shutter: null, focalLength: null, takenAt: null,
};

function readRational(view: DataView, offset: number, little: boolean): number {
  const num = view.getUint32(offset, little);
  const den = view.getUint32(offset + 4, little);
  return den === 0 ? 0 : num / den;
}

function readAscii(view: DataView, offset: number, count: number): string {
  let s = '';
  for (let i = 0; i < count; i++) {
    const c = view.getUint8(offset + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function typeSize(type: number): number {
  if (type === 3) return 2; // SHORT
  if (type === 1 || type === 2 || type === 7) return 1; // BYTE / ASCII / UNDEFINED
  if (type === 5 || type === 10) return 8; // RATIONAL / SRATIONAL
  return 4; // LONG / SLONG / FLOAT
}

/** Walk one IFD, invoking onTag for each entry with its resolved value offset. */
function walkIfd(
  view: DataView,
  ifdStart: number,
  tiffStart: number,
  little: boolean,
  onTag: (tag: number, type: number, count: number, valOff: number) => void,
): void {
  const entries = view.getUint16(ifdStart, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifdStart + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const count = view.getUint32(entry + 4, little);
    const valOff = typeSize(type) * count <= 4
      ? entry + 8
      : tiffStart + view.getUint32(entry + 8, little);
    onTag(tag, type, count, valOff);
  }
}

function formatShutter(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds >= 1) return `${Math.round(seconds * 10) / 10}`;
  return `1/${Math.round(1 / seconds)}`;
}

function formatTakenAt(raw: string): string | null {
  // EXIF format: "YYYY:MM:DD HH:MM:SS"
  const m = raw.match(/^(\d{4}):(\d{2}):(\d{2})[ ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

/** Extract the display EXIF fields from a JPEG File. All-null when absent/unreadable. */
export async function readPhotoExif(file: File): Promise<PhotoExif> {
  try {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return EMPTY;

    // Find the APP1 segment carrying "Exif\0\0".
    let offset = 2;
    let tiffStart = -1;
    while (offset + 4 <= view.byteLength) {
      const marker = view.getUint16(offset);
      if ((marker & 0xff00) !== 0xff00) break;
      const size = view.getUint16(offset + 2);
      if (marker === 0xffe1 && offset + 10 <= view.byteLength
        && view.getUint32(offset + 4) === 0x45786966 /* "Exif" */
        && view.getUint16(offset + 8) === 0) {
        tiffStart = offset + 10;
        break;
      }
      if (size < 2) break;
      offset += 2 + size;
    }
    if (tiffStart < 0 || tiffStart + 8 > view.byteLength) return EMPTY;

    const little = view.getUint16(tiffStart) === 0x4949; // "II"
    if (view.getUint16(tiffStart + 2, little) !== 42) return EMPTY;
    const ifd0Start = tiffStart + view.getUint32(tiffStart + 4, little);

    const out: PhotoExif = { ...EMPTY };
    let exifIfdStart = -1;

    walkIfd(view, ifd0Start, tiffStart, little, (tag, type, count, valOff) => {
      if (tag === 0x010f && type === 2) out.camera = readAscii(view, valOff, count) || out.camera;
      if (tag === 0x0110 && type === 2) {
        const model = readAscii(view, valOff, count);
        if (model) out.camera = out.camera && !model.startsWith(out.camera) ? `${out.camera} ${model}` : model;
      }
      if (tag === 0x8769) exifIfdStart = tiffStart + view.getUint32(valOff, little);
    });

    if (exifIfdStart > 0 && exifIfdStart + 2 <= view.byteLength) {
      walkIfd(view, exifIfdStart, tiffStart, little, (tag, type, count, valOff) => {
        if (tag === 0x829a && type === 5) out.shutter = formatShutter(readRational(view, valOff, little));
        if (tag === 0x829d && type === 5) { const f = readRational(view, valOff, little); out.aperture = f > 0 ? Math.round(f * 10) / 10 : null; }
        if (tag === 0x8827 && type === 3) out.iso = view.getUint16(valOff, little) || null;
        if (tag === 0x9003 && type === 2) out.takenAt = formatTakenAt(readAscii(view, valOff, count));
        if (tag === 0x920a && type === 5) { const fl = readRational(view, valOff, little); out.focalLength = fl > 0 ? Math.round(fl * 10) / 10 : null; }
        if (tag === 0xa434 && type === 2) out.lens = readAscii(view, valOff, count) || null;
      });
    }
    return out;
  } catch {
    return EMPTY;
  }
}
