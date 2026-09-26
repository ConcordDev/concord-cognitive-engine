// server/lib/asset-gen/organic/glb-normalize.js
//
// Make an externally generated GLB readable by @gltf-transform/core and
// importable by engine-side glTF loaders.
//
// TRELLIS.2 (and other image-to-3D services) emit textures as WebP and mark
// `EXT_texture_webp` as REQUIRED. @gltf-transform/core refuses to read a file
// whose required extensions it has no implementation for, and Unity's glTF
// importer support for the extension is not guaranteed. Rather than add the
// @gltf-transform/extensions package (an `npm install` in server/ currently
// prunes the optional `pg` dependency — see docs/CONCORD_ORGANIC_ASSET_PIPELINE.md),
// this does the two-step fallback-free conversion by hand:
//
//   1. Rewrite the GLB JSON chunk: each texture's EXT_texture_webp.source
//      becomes its core `source`, and the extension is removed from
//      extensionsUsed/extensionsRequired. The BIN chunk is untouched, so the
//      image bytes are still WebP at this point.
//   2. Read with NodeIO and re-encode every image/webp texture with `sharp`
//      (already installed): PNG only when its alpha can actually be seen,
//      otherwise JPEG q90 — the format Meshy ships, and a fraction of the
//      bytes of lossless 2k PNG. Alpha "can be seen" only when a material
//      uses the texture as base color with alphaMode BLEND or MASK; under
//      alphaMode OPAQUE the glTF spec says the alpha value is ignored.
//      TRELLIS.2 base-color maps carry alpha = 0 in the UV-atlas padding on
//      OPAQUE materials, so keeping that channel only doubled file size.

import fs from "fs";
import { NodeIO } from "@gltf-transform/core";

const GLB_MAGIC = 0x46546c67; // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const WEBP_EXT = "EXT_texture_webp";

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== GLB_MAGIC) throw new Error("not_glb");
  const jsonLen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== CHUNK_JSON) throw new Error("glb_first_chunk_not_json");
  const json = JSON.parse(buf.slice(20, 20 + jsonLen).toString("utf8"));
  const rest = buf.slice(20 + jsonLen); // remaining chunks (BIN), byte-for-byte
  return { json, rest };
}

function writeGlb(json, rest) {
  let jsonBuf = Buffer.from(JSON.stringify(json), "utf8");
  const pad = (4 - (jsonBuf.length % 4)) % 4;
  if (pad) jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc(pad, 0x20)]);
  const header = Buffer.alloc(20);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + rest.length, 8);
  header.writeUInt32LE(jsonBuf.length, 12);
  header.writeUInt32LE(CHUNK_JSON, 16);
  return Buffer.concat([header, jsonBuf, rest]);
}

/** Pure JSON rewrite: move EXT_texture_webp sources onto the core `source`. */
export function stripWebpExtension(json) {
  let moved = 0;
  for (const tex of json.textures || []) {
    const ext = tex.extensions?.[WEBP_EXT];
    if (!ext) continue;
    if (ext.source !== undefined) { tex.source = ext.source; moved += 1; }
    delete tex.extensions[WEBP_EXT];
    if (Object.keys(tex.extensions).length === 0) delete tex.extensions;
  }
  for (const key of ["extensionsUsed", "extensionsRequired"]) {
    if (!Array.isArray(json[key])) continue;
    json[key] = json[key].filter((e) => e !== WEBP_EXT);
    if (json[key].length === 0) delete json[key];
  }
  return moved;
}

/** True if any material uses `tex` as base color with alpha that renders. */
export function alphaVisible(tex) {
  return tex.listParents().some((p) => p.propertyType === "Material"
    && p.getBaseColorTexture() === tex
    && p.getAlphaMode() !== "OPAQUE");
}

/**
 * Normalize `srcPath` into `destPath`: WebP textures → JPEG/PNG, no required
 * extensions left that core can't read. Returns what changed.
 */
export async function normalizeGlb(srcPath, destPath) {
  const { json, rest } = readGlb(await fs.promises.readFile(srcPath));
  const movedWebp = stripWebpExtension(json);
  const required = json.extensionsRequired || [];
  if (required.length) return { ok: false, reason: "unsupported_required_extension", extensions: required };

  const io = new NodeIO();
  const doc = await io.readBinary(new Uint8Array(writeGlb(json, rest)));
  const converted = [];
  const textures = doc.getRoot().listTextures();
  const needsSharp = textures.some((t) => t.getMimeType() === "image/webp");
  const sharp = needsSharp ? (await import("sharp")).default : null;
  for (const tex of textures) {
    if (tex.getMimeType() !== "image/webp") continue;
    const img = sharp(Buffer.from(tex.getImage()));
    const { hasAlpha } = await img.metadata();
    const [bytes, mime, ext] = hasAlpha && alphaVisible(tex)
      ? [await img.png().toBuffer(), "image/png", ".png"]
      : [await img.removeAlpha().jpeg({ quality: 90, mozjpeg: true }).toBuffer(), "image/jpeg", ".jpg"];
    tex.setImage(new Uint8Array(bytes)).setMimeType(mime);
    const uri = tex.getURI();
    if (uri) tex.setURI(uri.replace(/\.webp$/i, ext));
    converted.push(mime);
  }
  await io.write(destPath, doc);
  return { ok: true, path: destPath, movedWebp, converted, bytes: (await fs.promises.stat(destPath)).size };
}
