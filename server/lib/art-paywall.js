// Priced art is server-gated. A non-owner without an active usage license
// never receives the original bytes. Images get a watermarked preview.
// Anything else is a 402 JSON refusal — not the full file.

import { licenseIsActive } from "./license-revocation.js";

export function artListingPrice(dtu) {
  const candidates = [dtu?.marketplace?.price, dtu?.meta?.price, dtu?.price];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

export function artOwnerId(dtu) {
  return dtu?.ownerId || dtu?.createdBy || dtu?.createdByUser || dtu?.authorId || dtu?.meta?.createdBy || null;
}

export function viewerHasFullArtAccess(dtu, userId, db) {
  if (!dtu) return false;
  if (artListingPrice(dtu) <= 0) return true;
  const owner = artOwnerId(dtu);
  if (userId && owner && String(userId) === String(owner)) return true;
  if (userId && db && licenseIsActive(db, { artifactId: dtu.id, licenseeId: userId })) return true;
  return false;
}

export async function watermarkArtPreview(buffer) {
  const sharpMod = await import("sharp");
  const sharp = sharpMod.default || sharpMod;
  const base = sharp(buffer, { failOn: "none" }).rotate().resize({
    width: 640,
    height: 640,
    fit: "inside",
    withoutEnlargement: true,
  });
  const meta = await base.metadata();
  const w = meta.width || 320;
  const h = meta.height || 320;
  const font = Math.max(18, Math.floor(Math.min(w, h) / 8));
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="${Math.floor(h * 0.4)}" width="${w}" height="${Math.floor(h * 0.2)}" fill="rgba(0,0,0,0.35)"/>
      <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle"
        fill="rgba(255,255,255,0.85)" font-size="${font}" font-family="sans-serif"
        transform="rotate(-18 ${w / 2} ${h / 2})">PREVIEW</text>
    </svg>`,
  );
  return base.composite([{ input: svg, gravity: "centre" }]).png().toBuffer();
}

/**
 * Decide which bytes a viewer may receive.
 * @returns {{access:'full'|'preview'|'denied', contentType?:string, buffer?:Buffer, status?:number, body?:object}}
 */
export async function bytesForViewer({ dtu, userId, db, buffer, contentType }) {
  if (viewerHasFullArtAccess(dtu, userId, db)) {
    return { access: "full", contentType, buffer };
  }
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (mime.startsWith("image/") && buffer) {
    try {
      const preview = await watermarkArtPreview(buffer);
      if (preview && preview.length && !preview.equals(buffer)) {
        return { access: "preview", contentType: "image/png", buffer: preview };
      }
    } catch {
      // Fall through. Never send the original when watermarking fails.
    }
  }
  return {
    access: "denied",
    status: 402,
    body: {
      ok: false,
      error: "This artwork is priced. Full resolution is limited to the owner and licensees.",
    },
  };
}
