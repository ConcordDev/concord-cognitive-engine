/**
 * exif.ts — minimal client-side EXIF reader for rock-sample photos.
 *
 * Parses the JPEG APP1 EXIF segment to pull the GPS geotag, capture
 * timestamp and camera model. No dependency — reads the raw TIFF
 * structure directly. Returns only real values found in the file;
 * absent tags come back as null.
 */

export interface ExifGeotag {
  lat: number | null;
  lon: number | null;
  altitude: number | null;
  takenAt: string | null;
  cameraModel: string | null;
}

const EMPTY: ExifGeotag = { lat: null, lon: null, altitude: null, takenAt: null, cameraModel: null };

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

/** Parse one IFD and invoke `onTag` for each entry. */
function walkIfd(
  view: DataView,
  ifdStart: number,
  tiffStart: number,
  little: boolean,
  onTag: (tag: number, type: number, count: number, valOff: number) => void,
): number {
  const entries = view.getUint16(ifdStart, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifdStart + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const count = view.getUint32(entry + 4, little);
    const typeSize = type === 3 ? 2 : type === 1 || type === 2 ? 1 : 4;
    const totalSize = typeSize * count;
    const valOff = totalSize <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little);
    onTag(tag, type, count, valOff);
  }
  // Pointer to the next IFD (0 = end).
  return view.getUint32(ifdStart + 2 + entries * 12, little);
}

function dms(view: DataView, offset: number, little: boolean): number {
  const d = readRational(view, offset, little);
  const m = readRational(view, offset + 8, little);
  const s = readRational(view, offset + 16, little);
  return d + m / 60 + s / 3600;
}

/** Extract the EXIF geotag from a JPEG File. Returns nulls if absent. */
export async function readExifGeotag(file: File): Promise<ExifGeotag> {
  try {
    const buf = await file.arrayBuffer();
    const view = new DataView(buf);
    if (view.getUint16(0, false) !== 0xffd8) return EMPTY; // not a JPEG

    // Locate the APP1 (EXIF) segment.
    let offset = 2;
    let app1 = -1;
    while (offset < view.byteLength - 4) {
      const marker = view.getUint16(offset, false);
      if (marker === 0xffe1) { app1 = offset; break; }
      if ((marker & 0xff00) !== 0xff00) break;
      offset += 2 + view.getUint16(offset + 2, false);
    }
    if (app1 < 0) return EMPTY;

    // "Exif\0\0" header then the TIFF block.
    const tiffStart = app1 + 10;
    if (readAscii(view, app1 + 4, 4) !== 'Exif') return EMPTY;
    const little = view.getUint16(tiffStart, false) === 0x4949;

    let gpsIfd = 0;
    let exifIfd = 0;
    const result: ExifGeotag = { ...EMPTY };
    let latRef = 'N';
    let lonRef = 'E';
    let altRef = 0;

    const ifd0 = tiffStart + view.getUint32(tiffStart + 4, little);
    walkIfd(view, ifd0, tiffStart, little, (tag, type, count, valOff) => {
      if (tag === 0x8825) gpsIfd = tiffStart + view.getUint32(valOff, little);
      else if (tag === 0x8769) exifIfd = tiffStart + view.getUint32(valOff, little);
      else if (tag === 0x0110 && type === 2) result.cameraModel = readAscii(view, valOff, count);
    });

    if (exifIfd) {
      walkIfd(view, exifIfd, tiffStart, little, (tag, type, count, valOff) => {
        if (tag === 0x9003 && type === 2) {
          // "YYYY:MM:DD HH:MM:SS" → ISO.
          const raw = readAscii(view, valOff, count);
          const m = raw.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}:\d{2}:\d{2})$/);
          if (m) result.takenAt = `${m[1]}-${m[2]}-${m[3]}T${m[4]}`;
        }
      });
    }

    if (gpsIfd) {
      let latVal: number | null = null;
      let lonVal: number | null = null;
      let altVal: number | null = null;
      walkIfd(view, gpsIfd, tiffStart, little, (tag, _type, _count, valOff) => {
        if (tag === 0x0001) latRef = readAscii(view, valOff, 2) || 'N';
        else if (tag === 0x0002) latVal = dms(view, valOff, little);
        else if (tag === 0x0003) lonRef = readAscii(view, valOff, 2) || 'E';
        else if (tag === 0x0004) lonVal = dms(view, valOff, little);
        else if (tag === 0x0005) altRef = view.getUint8(valOff);
        else if (tag === 0x0006) altVal = readRational(view, valOff, little);
      });
      if (latVal != null) result.lat = latRef === 'S' ? -latVal : latVal;
      if (lonVal != null) result.lon = lonRef === 'W' ? -lonVal : lonVal;
      if (altVal != null) result.altitude = altRef === 1 ? -altVal : altVal;
    }

    return result;
  } catch {
    return EMPTY;
  }
}

/** Read a File into a data URL for storage / preview. */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
}
