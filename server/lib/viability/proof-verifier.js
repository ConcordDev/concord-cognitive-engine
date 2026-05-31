// server/lib/viability/proof-verifier.js
//
// Wave 5 #30 — proof / verifier: the TRUTH BOUNDARY. Before a DTU may be
// admitted as a verified premise (for NPC reasoning #16, knowledge-as-constraint
// #29, or persistence of an imported claim), it must clear three checks that
// compose already-shipped layers — no new trust machinery:
//   1. structural  — a well-formed envelope (lib/dtu-protocol.js#validate),
//   2. integrity   — its content hash matches (dtu-protocol#verify): untampered,
//   3. epistemic   — it is CANON (carries a checkable verifier; corpus-tier.js).
// A conjecture DTU may still be admitted as DATA (requireCanon:false) but never
// as a verified premise. Pure; instantiates one DTUProtocol. The formal gate the
// `dtu.protocol_validate` macro / any import path should call.

import DTUProtocol from "../dtu-protocol.js";
import { tierDtu } from "./corpus-tier.js";

const _proto = new DTUProtocol();

/**
 * Verify a DTU against the truth boundary.
 * @param {object} dtu
 * @param {{ requireCanon?: boolean }} [opts]  requireCanon (default true) = admit
 *        only as a verified PREMISE; false = admit as data (integrity only).
 * @returns {{ admissible:boolean, tier:'canon'|'conjecture', structural:boolean, integrity:boolean, reasons:string[] }}
 */
export function verifyClaim(dtu, { requireCanon = true } = {}) {
  const reasons = [];
  const tier = tierDtu(dtu);

  // Epistemic gate — only canon may be a verified premise.
  const canonOk = tier === "canon";
  if (requireCanon && !canonOk) reasons.push("not_canon");

  // Structural gate — only for things shaped like a protocol envelope.
  let structural = true;
  const looksLikeEnvelope = dtu && typeof dtu === "object" && "content" in dtu && "metadata" in dtu;
  if (looksLikeEnvelope) {
    const v = _proto.validate(dtu);
    structural = !!v.valid;
    if (!structural) reasons.push("malformed_envelope");
  }

  // Integrity gate — only when a content hash is present to check against.
  let integrity = true;
  if (dtu && dtu.metadata && dtu.metadata.contentHash) {
    const ver = _proto.verify(dtu);
    integrity = !!ver.verified;
    if (!integrity) reasons.push("hash_mismatch");
  }

  const admissible = (requireCanon ? canonOk : true) && structural && integrity;
  return { admissible, tier, structural, integrity, reasons };
}

/** Convenience: may this DTU be admitted as a verified reasoning premise? */
export function admissibleAsPremise(dtu) {
  return verifyClaim(dtu, { requireCanon: true }).admissible;
}
