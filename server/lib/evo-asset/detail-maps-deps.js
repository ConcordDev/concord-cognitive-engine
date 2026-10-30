// server/lib/evo-asset/detail-maps-deps.js
// The real image-generation dependency for the evo-asset detail_maps
// refinement pass (refinement-passes.js runDetailMapsPass).
//
// The pass consumes `{ prompt, size }` and needs image BYTES back
// (`{ ok, imageB64 }`). It runs inside governorTick, so it uses the local
// GPU path ONLY (lib/pollinations-image.js generateViaLocalGpu):
//
//   - no Pollinations fallback. That path returns only a remote URL (never
//     bytes this pass can write), yet it would send the asset's
//     vision-derived prompt to a third party and issue an external HEAD on
//     every evolution tick. When the GPU is down the pass skips, with zero
//     external calls, and tries again next tick.
//   - bounded wait: the generator's 5-minute default is replaced by
//     CONCORD_EVO_DETAIL_GEN_TIMEOUT_MS (default 60 s) so one candidate
//     cannot sit inside the tick.
//   - the GPU request already carries the fail-if-busy header, so a GPU busy
//     with a user's art job answers gpu_busy and the pass skips instead of
//     queueing behind or ahead of user work.
//   - size "1024x1024" → width/height numbers for the generator
//   - generator failure → { ok:false, reason }; ok-but-byte-less →
//     { ok:false, reason:"no_image_bytes" }
//
// Kept as a factory so tests can inject a fake generator without
// touching the network or the GPU.

import { generateViaLocalGpu } from "../pollinations-image.js";

export const DETAIL_GEN_TIMEOUT_MS = () => Number(process.env.CONCORD_EVO_DETAIL_GEN_TIMEOUT_MS) || 60_000;

export function makeDetailMapsImageGen(generate = generateViaLocalGpu) {
  return async function callImageGen({ prompt, size } = {}) {
    const [wRaw, hRaw] = String(size || "1024x1024").split("x");
    const width = Number(wRaw);
    const height = Number(hRaw);
    const gen = await generate({
      prompt,
      width: Number.isFinite(width) && width > 0 ? width : 1024,
      height: Number.isFinite(height) && height > 0 ? height : 1024,
      timeoutMs: DETAIL_GEN_TIMEOUT_MS(),
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
