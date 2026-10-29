// server/lib/evo-asset/detail-maps-deps.js
// The real image-generation dependency for the evo-asset detail_maps
// refinement pass (refinement-passes.js runDetailMapsPass).
//
// The pass consumes `{ prompt, size }` and needs image BYTES back
// (`{ ok, imageB64 }`). The platform's shared generator —
// lib/pollinations-image.js generatePollinationsImage — is GPU-first
// (local FLUX gen server) and returns exactly that shape on the GPU
// path. Its Pollinations fallback, however, returns only a remote URL:
// honest for chat/art surfaces that render the URL, useless to a pass
// that must write a variant file. This adapter bridges the two
// contracts:
//
//   - size "1024x1024" → width/height numbers for the generator
//   - generator failure → passed through as { ok:false, reason }
//   - ok-but-byte-less (URL-only fallback) → { ok:false,
//     reason:"no_image_bytes" } so the pass skips cleanly instead of
//     writing a broken variant. The pass then simply doesn't run on a
//     pod whose GPU gen server is down — it runs again next tick.
//
// Kept as a factory so tests can inject a fake generator without
// touching the network or the GPU.

import { generatePollinationsImage } from "../pollinations-image.js";

export function makeDetailMapsImageGen(generate = generatePollinationsImage) {
  return async function callImageGen({ prompt, size } = {}) {
    const [wRaw, hRaw] = String(size || "1024x1024").split("x");
    const width = Number(wRaw);
    const height = Number(hRaw);
    const gen = await generate({
      prompt,
      width: Number.isFinite(width) && width > 0 ? width : 1024,
      height: Number.isFinite(height) && height > 0 ? height : 1024,
    });
    if (!gen?.ok) {
      return { ok: false, reason: gen?.reason || gen?.error || "image_gen_failed" };
    }
    if (!gen.imageB64) {
      return { ok: false, reason: "no_image_bytes" };
    }
    return gen;
  };
}

export const callImageGen = makeDetailMapsImageGen();
