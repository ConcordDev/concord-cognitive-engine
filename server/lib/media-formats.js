/**
 * Concord — audio/video upload format table (single source of truth).
 *
 * One canonical MIME per container, the browser/OS aliases that map onto it,
 * the file extensions that identify it, and a magic-byte check. routes/media.js
 * (allowlist + magic validation), lib/artifact-store.js (SUPPORTED_TYPES) and
 * lib/media-dtu.js (MEDIA_MIME_MAP) all derive from this so they cannot drift:
 * before it existed the route rejected audio/x-m4a, audio/x-wav, audio/x-flac,
 * audio/mp3 and video/quicktime (browsers send all of them), and the store
 * kept .aac / m4a bytes as application/octet-stream.
 */

const isEbml = (b) => b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3;
// ISO base media (mp4 / m4a / mov / m4v): a box header whose type is at offset 4.
const isFtyp = (b) => b.length >= 8 && b.toString("latin1", 4, 8) === "ftyp";
const isQuickTime = (b) =>
  isFtyp(b) || (b.length >= 8 && ["moov", "mdat", "wide", "free", "skip", "pnot"].includes(b.toString("latin1", 4, 8)));
const hasId3 = (b) => b.length >= 3 && b.toString("latin1", 0, 3) === "ID3";

export const AV_FORMATS = Object.freeze([
  {
    mime: "audio/mpeg", ext: "mp3", exts: ["mp3", "mpga"], kind: "audio",
    aliases: ["audio/mp3", "audio/mpeg3", "audio/x-mpeg-3", "audio/x-mpeg"],
    // ID3 tag, or an MPEG frame sync (11 set bits) with a non-zero layer.
    sniff: (b) => hasId3(b) || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0),
  },
  {
    mime: "audio/wav", ext: "wav", exts: ["wav", "wave"], kind: "audio",
    aliases: ["audio/x-wav", "audio/wave", "audio/vnd.wave"],
    sniff: (b) => b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WAVE",
  },
  {
    mime: "audio/flac", ext: "flac", exts: ["flac"], kind: "audio",
    aliases: ["audio/x-flac"],
    sniff: (b) => b.length >= 4 && b.toString("latin1", 0, 4) === "fLaC",
  },
  {
    mime: "audio/ogg", ext: "ogg", exts: ["ogg", "oga", "opus"], kind: "audio",
    aliases: ["audio/opus", "audio/x-ogg", "application/ogg"],
    sniff: (b) => b.length >= 4 && b.toString("latin1", 0, 4) === "OggS",
  },
  {
    mime: "audio/mp4", ext: "m4a", exts: ["m4a", "m4b"], kind: "audio",
    aliases: ["audio/x-m4a", "audio/m4a", "audio/x-mp4"],
    sniff: isFtyp,
  },
  {
    mime: "audio/aac", ext: "aac", exts: ["aac", "adts"], kind: "audio",
    aliases: ["audio/x-aac", "audio/aacp"],
    // ADTS sync (0xFFF, layer 00), or an ID3-tagged stream.
    sniff: (b) => hasId3(b) || (b.length >= 2 && b[0] === 0xff && (b[1] & 0xf6) === 0xf0),
  },
  { mime: "audio/webm", ext: "weba", exts: ["weba"], kind: "audio", aliases: [], sniff: isEbml },
  {
    mime: "video/mp4", ext: "mp4", exts: ["mp4"], kind: "video",
    aliases: ["video/x-mp4"],
    sniff: isFtyp,
  },
  {
    mime: "video/quicktime", ext: "mov", exts: ["mov", "qt"], kind: "video",
    aliases: ["video/x-quicktime"],
    sniff: isQuickTime,
  },
  { mime: "video/x-m4v", ext: "m4v", exts: ["m4v"], kind: "video", aliases: ["video/m4v"], sniff: isFtyp },
  { mime: "video/webm", ext: "webm", exts: ["webm"], kind: "video", aliases: [], sniff: isEbml },
]);

const BY_MIME = new Map();
const BY_EXT = new Map();
for (const f of AV_FORMATS) {
  BY_MIME.set(f.mime, f);
  for (const a of f.aliases) BY_MIME.set(a, f);
  for (const e of f.exts) BY_EXT.set(e, f);
}

/** Every canonical audio/video MIME, plus every alias a browser may send. */
export const AV_ACCEPTED_MIMES = Object.freeze([...BY_MIME.keys()]);
export const AV_CANONICAL_MIMES = Object.freeze(AV_FORMATS.map((f) => f.mime));

const GENERIC = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-unknown"]);

export function normalizeMimeString(mime) {
  return String(mime || "").split(";")[0].trim().toLowerCase();
}

/** Canonical form of an audio/video MIME alias, or the cleaned input unchanged. */
export function canonicalMime(mime) {
  const m = normalizeMimeString(mime);
  return BY_MIME.get(m)?.mime || m;
}

/** The format row for a canonical MIME or alias (null if not audio/video). */
export function formatForMime(mime) {
  return BY_MIME.get(normalizeMimeString(mime)) || null;
}

function extOf(filename) {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(filename || ""));
  return m ? m[1].toLowerCase() : "";
}

/**
 * True/false when a rule exists for this (canonical) MIME and the leading
 * bytes do/don't match it; null when there is no rule (non-audio/video).
 */
export function sniffMatches(mime, buf) {
  const f = formatForMime(mime);
  if (!f || !buf || !buf.length) return null;
  return f.sniff(buf);
}

/**
 * Decide the MIME for an upload. A declared audio/video type (any alias)
 * wins and is canonicalised. When the browser sent nothing useful (empty /
 * octet-stream / an unlisted type) the file extension decides, then the
 * magic bytes. Returns the canonical MIME, or the cleaned declared value
 * when nothing identifies the file.
 */
export function inferMime({ declared, filename, buffer } = {}) {
  const d = normalizeMimeString(declared);
  const known = BY_MIME.get(d);
  if (known) return known.mime;
  if (d && !GENERIC.has(d)) return d; // a non-AV type the caller declared (image/pdf/…)
  const byExt = BY_EXT.get(extOf(filename));
  if (byExt) return byExt.mime;
  if (buffer && buffer.length) {
    const head = buffer.subarray(0, 32);
    // Order matters: WAV/FLAC/OGG/ID3 are unambiguous; ftyp is checked as m4a-vs-mp4 by extension above.
    for (const f of AV_FORMATS) if (f.sniff(head)) return f.mime;
  }
  return d || "application/octet-stream";
}
