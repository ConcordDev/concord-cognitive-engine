/**
 * Stream paywall for priced Create/Commercial media.
 *
 * Owners and license holders receive the full artifact. Everyone else, when
 * a create or commercial tier has a price, receives only the preview window
 * (previewStart + previewDuration, seconds). Range requests are applied to
 * that window, so a caller cannot address bytes past the preview.
 */

export function normalizeTiers(tiers) {
  if (!Array.isArray(tiers)) return [];
  const allowed = new Set(["listen", "create", "commercial"]);
  const out = [];
  for (const t of tiers.slice(0, 8)) {
    const tier = String(t?.tier || "").toLowerCase();
    if (!allowed.has(tier)) continue;
    out.push({
      tier,
      enabled: t?.enabled !== false,
      price: Math.max(0, Number(t?.price) || 0),
      currency: String(t?.currency || "USD").slice(0, 8),
    });
  }
  return out;
}

export function pricedCreateOrCommercial(mediaDTU) {
  return (mediaDTU?.tiers || []).some((t) =>
    (t.tier === "create" || t.tier === "commercial")
    && t.enabled !== false
    && Number(t.price) > 0
  );
}

function licenseSet(STATE, mediaId) {
  const media = STATE?._media;
  if (!media) return null;
  if (!media.licenses) media.licenses = new Map();
  return media.licenses.get(mediaId) || null;
}

/** Record that `userId` may stream the full artifact (a purchased license). */
export function grantMediaLicense(STATE, mediaId, userId) {
  if (!STATE || !mediaId || !userId) return { ok: false, error: "mediaId and userId are required" };
  if (!STATE._media) STATE._media = {};
  if (!STATE._media.licenses) STATE._media.licenses = new Map();
  let grants = STATE._media.licenses.get(mediaId);
  if (!grants) {
    grants = new Set();
    STATE._media.licenses.set(mediaId, grants);
  }
  grants.add(userId);
  return { ok: true };
}

export function viewerMayStreamFull(STATE, mediaDTU, viewerId) {
  if (!mediaDTU || !viewerId) return false;
  if (mediaDTU.author === viewerId) return true;
  const grants = licenseSet(STATE, mediaDTU.id);
  if (grants && grants.has(viewerId)) return true;
  if (Array.isArray(mediaDTU.licensedUserIds) && mediaDTU.licensedUserIds.includes(viewerId)) return true;
  try {
    const db = STATE?.db;
    if (db && typeof db.prepare === "function") {
      const row = db.prepare(
        "SELECT id FROM creative_usage_licenses WHERE artifact_id = ? AND licensee_id = ? AND status = 'active'"
      ).get(mediaDTU.id, viewerId);
      if (row) return true;
    }
  } catch {
    // Table is optional on minimal builds — absence is "no license", not a leak.
  }
  return false;
}

function readWavLayout(buffer) {
  if (!buffer || buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let fmt = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === "fmt " && size >= 16 && dataStart + 16 <= buffer.length) {
      fmt = {
        audioFormat: buffer.readUInt16LE(dataStart),
        channels: buffer.readUInt16LE(dataStart + 2),
        sampleRate: buffer.readUInt32LE(dataStart + 4),
        byteRate: buffer.readUInt32LE(dataStart + 8),
        blockAlign: buffer.readUInt16LE(dataStart + 12),
      };
    } else if (id === "data") {
      dataOffset = dataStart;
      dataSize = Math.min(size, buffer.length - dataStart);
      break;
    }
    const step = 8 + size + (size % 2);
    if (step <= 0) break;
    offset += step;
  }
  if (!fmt || fmt.audioFormat !== 1 || dataOffset < 0 || !(fmt.byteRate > 0)) return null;
  const block = fmt.blockAlign > 0 ? fmt.blockAlign : 1;
  return { fmt, dataOffset, dataSize, block };
}

function buildPcmWav(fmt, samples) {
  const header = Buffer.alloc(44);
  const dataSize = samples.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(fmt.channels || 1, 22);
  header.writeUInt32LE(fmt.sampleRate, 24);
  header.writeUInt32LE(fmt.byteRate, 28);
  header.writeUInt16LE(fmt.blockAlign || 1, 32);
  header.writeUInt16LE(Math.max(8, Math.round((fmt.byteRate / Math.max(1, fmt.sampleRate) / Math.max(1, fmt.channels)) * 8)), 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, samples]);
}

/**
 * Bytes a non-licensee may receive. Null when the preview window can't be
 * cut — callers must deny the stream rather than fall back to the full file.
 */
export function slicePreviewWindow(buffer, mediaDTU) {
  const startSec = Math.max(0, Number(mediaDTU?.previewStart) || 0);
  const previewSec = Math.max(0, Number(mediaDTU?.previewDuration) || 0);
  if (!(previewSec > 0) || !buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) return null;

  const wav = readWavLayout(buffer);
  if (wav) {
    const { fmt, dataOffset, dataSize, block } = wav;
    const startByte = Math.floor((startSec * fmt.byteRate) / block) * block;
    const take = Math.floor((previewSec * fmt.byteRate) / block) * block;
    if (startByte >= dataSize || take <= 0) return null;
    const samples = buffer.subarray(dataOffset + startByte, dataOffset + Math.min(dataSize, startByte + take));
    if (samples.length === 0) return null;
    const preview = buildPcmWav(fmt, samples);
    // A rebuilt header can be a few bytes larger than a tiny source. Never
    // return more sample payload than the preview window asked for.
    if (preview.length >= buffer.length && samples.length >= dataSize) {
      return buffer.subarray(0, buffer.length);
    }
    return preview;
  }

  const totalSec = Number(mediaDTU?.duration) || 0;
  if (!(totalSec > 0)) return null;
  const start = Math.min(buffer.length, Math.floor(buffer.length * (startSec / totalSec)));
  const end = Math.min(buffer.length, Math.ceil(buffer.length * ((startSec + previewSec) / totalSec)));
  if (end <= start) return null;
  return buffer.subarray(start, end);
}

export function resolvePlaybackBuffer(buffer, mediaDTU, viewerId, STATE) {
  if (!pricedCreateOrCommercial(mediaDTU) || viewerMayStreamFull(STATE, mediaDTU, viewerId)) {
    return { ok: true, buffer, preview: false };
  }
  const preview = slicePreviewWindow(buffer, mediaDTU);
  if (!preview || preview.length === 0) {
    return { ok: false, status: 403, error: "license_required" };
  }
  return { ok: true, buffer: preview, preview: true };
}

function parseByteRange(header, total) {
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(header || "").trim());
  if (!m || total <= 0) return { error: true };
  const startStr = m[1];
  const endStr = m[2];
  if (startStr === "" && endStr === "") return { error: true };
  if (startStr === "") {
    const suffix = parseInt(endStr, 10);
    if (!Number.isFinite(suffix) || suffix <= 0) return { error: true };
    const len = Math.min(suffix, total);
    return { start: total - len, end: total - 1 };
  }
  const start = parseInt(startStr, 10);
  const end = endStr === "" ? total - 1 : parseInt(endStr, 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { error: true };
  if (start < 0 || start >= total || end < start) return { error: true };
  return { start, end: Math.min(end, total - 1) };
}

/**
 * Send `buffer` with Range support. `buffer` is already the bytes this
 * viewer is allowed to see (full file or preview). Ranges past that window
 * are 416 — they are never satisfied from a larger original.
 */
export function sendRangedBuffer(res, buffer, contentType, rangeHeader, { privateCache = false } = {}) {
  const total = buffer.length;
  const cache = privateCache ? "private, no-store" : "public, max-age=86400";
  const type = contentType || "application/octet-stream";
  if (rangeHeader) {
    const parsed = parseByteRange(rangeHeader, total);
    if (parsed.error) {
      res.status(416);
      res.set({
        "Content-Range": `bytes */${total}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": cache,
      });
      return res.json({ ok: false, error: "range_not_satisfiable" });
    }
    const chunk = buffer.subarray(parsed.start, parsed.end + 1);
    res.status(206);
    res.set({
      "Content-Range": `bytes ${parsed.start}-${parsed.end}/${total}`,
      "Accept-Ranges": "bytes",
      "Content-Length": String(chunk.length),
      "Content-Type": type,
      "Cache-Control": cache,
    });
    return res.end(chunk);
  }
  res.status(200);
  res.set({
    "Content-Type": type,
    "Content-Length": String(total),
    "Accept-Ranges": "bytes",
    "Cache-Control": cache,
  });
  return res.end(buffer);
}
