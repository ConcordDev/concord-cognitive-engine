// Chat messages keep a short artifact record. A TRELLIS mesh is the triangle
// arrays (150 KB after decimation, up to several MB) and the session store
// drops any artifact whose JSON is 60 KB or larger. The concept PNG already
// lives as a private media DTU with a stream URL. Do the same for the GLB
// and for a large inline image, and leave triangle count, title, and the
// media URL on the message so a reload can show the model.

import { Document, NodeIO } from "@gltf-transform/core";
import { storeArtifact } from "../artifact-store.js";
import { createMediaDTU } from "../media-dtu.js";

export const GLB_MIME = "model/gltf-binary";
export const CHAT_ARTIFACT_JSON_MAX = 60_000;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MEDIA_URL = /^\/api\/media\/[^/]+\/stream$/;

function isPngOrJpeg(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 3) return false;
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_MAGIC)) return true;
  return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function isGlb(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "glTF";
}

function mediaHost(explicit) {
  if (explicit && typeof explicit === "object") return explicit;
  if (globalThis._concordSTATE) return globalThis._concordSTATE;
  return { dtus: new Map() };
}

function jsonLength(value) {
  try { return JSON.stringify(value).length; } catch { return Infinity; }
}

/** Indexed triangles → GLB bytes. In memory; chat does not need a temp path. */
export async function trianglesToGlb({ positions, indices } = {}) {
  const pos = Float32Array.from(positions ?? []);
  const idx = Uint32Array.from(indices ?? []);
  if (pos.length < 9 || pos.length % 3 !== 0) throw new Error("bad_positions");
  if (idx.length < 3 || idx.length % 3 !== 0) throw new Error("bad_indices");
  const doc = new Document();
  const buf = doc.createBuffer();
  const posAcc = doc.createAccessor().setType("VEC3").setArray(pos).setBuffer(buf);
  const idxAcc = doc.createAccessor().setType("SCALAR").setArray(idx).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute("POSITION", posAcc).setIndices(idxAcc);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return Buffer.from(await new NodeIO().writeBinary(doc));
}

async function publishBytes({ bytes, mimeType, filename, title, ownerId, state, mediaType, tags }) {
  const host = mediaHost(state);
  const authorId = String(ownerId || "anonymous");
  let artifactRef;
  try {
    artifactRef = await storeArtifact(`chat-${mediaType}-${authorId}-${Date.now()}`, bytes, mimeType, filename);
  } catch {
    return null;
  }
  const created = createMediaDTU(host, {
    authorId,
    title: String(title || filename).slice(0, 180),
    mediaType,
    mimeType,
    fileSize: bytes.length,
    originalFilename: filename,
    privacy: "private",
    tags: tags || ["chat"],
    artifactRef,
  });
  if (!created.ok) return null;
  return { url: `/api/media/${created.mediaDTU.id}/stream`, mediaId: created.mediaDTU.id, mimeType };
}

function countsFrom(artifact, positions, indices) {
  const triangleCount = Number.isFinite(Number(artifact?.triangleCount))
    ? Number(artifact.triangleCount)
    : (Array.isArray(indices) ? Math.floor(indices.length / 3) : undefined);
  const vertexCount = Number.isFinite(Number(artifact?.vertexCount))
    ? Number(artifact.vertexCount)
    : (Array.isArray(positions) ? Math.floor(positions.length / 3) : undefined);
  return { triangleCount, vertexCount };
}

function slimMesh(artifact, published, counts) {
  const partList = Array.isArray(artifact.partList) && jsonLength(artifact.partList) < 8000 ? artifact.partList : undefined;
  const bbox = artifact.bbox_mm && jsonLength(artifact.bbox_mm) < 2000 ? artifact.bbox_mm : undefined;
  return {
    kind: "mesh",
    url: published.url,
    mimeType: published.mimeType || GLB_MIME,
    mediaId: published.mediaId,
    ...(artifact.title ? { title: artifact.title } : {}),
    ...(counts.triangleCount != null ? { triangleCount: counts.triangleCount } : {}),
    ...(counts.vertexCount != null ? { vertexCount: counts.vertexCount } : {}),
    ...(artifact.color != null ? { color: artifact.color } : {}),
    ...(artifact.meshKind ? { meshKind: artifact.meshKind } : {}),
    ...(artifact.source ? { source: artifact.source } : {}),
    ...(artifact.pass != null ? { pass: artifact.pass } : {}),
    ...(partList ? { partList } : {}),
    ...(bbox ? { bbox_mm: bbox } : {}),
  };
}

function decodeBase64(value) {
  if (typeof value !== "string" || !value) return null;
  try { return Buffer.from(value, "base64"); } catch { return null; }
}

function meshBytes(artifact) {
  if (Buffer.isBuffer(artifact.glb)) return artifact.glb;
  return decodeBase64(artifact.glb_b64 || artifact.glbBase64);
}

function imageBytes(artifact) {
  if (artifact.image_b64) return decodeBase64(String(artifact.image_b64));
  const raw = String(artifact.url || artifact.dataUrl || "");
  const comma = raw.indexOf(",");
  if (!raw.startsWith("data:") || comma < 0 || !/;base64/i.test(raw.slice(0, comma))) return null;
  return decodeBase64(raw.slice(comma + 1));
}

/**
 * One artifact → a record small enough for chat_messages.meta_json.
 * Returns null when the payload is too big to keep and is not real media
 * (a 70 KB fake data URL stays dropped).
 */
export async function externalizeChatArtifact(artifact, { ownerId, state } = {}) {
  if (!artifact || typeof artifact !== "object") return null;
  const kind = artifact.kind || artifact.type;

  if (kind === "mesh") {
    const url = typeof artifact.url === "string" && MEDIA_URL.test(artifact.url) ? artifact.url : "";
    const positions = artifact.positions;
    const indices = artifact.indices;
    const hasGeom = Array.isArray(positions) && positions.length >= 9 && Array.isArray(indices) && indices.length >= 3;
    const glb = meshBytes(artifact);
    if (url && !hasGeom && !(glb && isGlb(glb))) return artifact;
    if (url) return slimMesh(artifact, { url, mediaId: artifact.mediaId, mimeType: artifact.mimeType || GLB_MIME }, countsFrom(artifact, positions, indices));
    let bytes = glb && isGlb(glb) ? glb : null;
    if (!bytes && hasGeom) {
      try { bytes = await trianglesToGlb({ positions, indices }); } catch { return null; }
    }
    if (!bytes || !isGlb(bytes)) return jsonLength(artifact) < CHAT_ARTIFACT_JSON_MAX ? artifact : null;
    const published = await publishBytes({
      bytes, mimeType: GLB_MIME, filename: "model.glb",
      title: artifact.title || "3D model", ownerId, state,
      mediaType: "model", tags: ["chat", "mesh"],
    });
    if (!published) return null;
    return slimMesh(artifact, published, countsFrom(artifact, positions, indices));
  }

  if (kind === "image") {
    const len = jsonLength(artifact);
    const url = String(artifact.url || "");
    if (MEDIA_URL.test(url) && len < CHAT_ARTIFACT_JSON_MAX) return artifact;
    if (len < CHAT_ARTIFACT_JSON_MAX) return artifact;
    const bytes = imageBytes(artifact);
    if (!bytes || !isPngOrJpeg(bytes)) return null;
    const mime = bytes[0] === 0xff ? "image/jpeg" : "image/png";
    const published = await publishBytes({
      bytes, mimeType: mime, filename: mime === "image/jpeg" ? "image.jpg" : "image.png",
      title: artifact.title || artifact.prompt || "image", ownerId, state,
      mediaType: "image", tags: ["chat", "image"],
    });
    if (!published) return null;
    return {
      kind: "image",
      url: published.url,
      mediaId: published.mediaId,
      mimeType: mime,
      ...(artifact.title ? { title: artifact.title } : {}),
      ...(artifact.prompt ? { prompt: String(artifact.prompt).slice(0, 300) } : {}),
      ...(artifact.source ? { source: artifact.source } : {}),
      ...(artifact.width ? { width: artifact.width } : {}),
      ...(artifact.height ? { height: artifact.height } : {}),
    };
  }

  return jsonLength(artifact) < CHAT_ARTIFACT_JSON_MAX ? artifact : null;
}

export async function externalizeChatArtifacts(artifacts, opts = {}) {
  const out = [];
  for (const artifact of (Array.isArray(artifacts) ? artifacts : []).slice(0, 4)) {
    try {
      const slim = await externalizeChatArtifact(artifact, opts);
      if (slim) out.push(slim);
    } catch { /* one bad artifact does not drop the rest */ }
  }
  return out;
}
