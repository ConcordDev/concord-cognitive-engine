// server/lib/qualia-space.js
//
// Wave 7 / Track A7.1 — STRUCTURED QUALIA CONTENT-SPACE (quality-space theory:
// Clark, Rosenthal). The A6 felt-per is a MAGNITUDE (how much / how good-bad). This
// is the "what-it-is-like" CONTENT layer: a quale is what it is by its POSITION
// relative to all other qualia ("this dread is near that grief, far from that
// triumph"), not a lone valence/arousal scalar. Research-forward, env-gated
// (CONCORD_QUALIA_SPACE), build-last; pure + total.
//
// This measures STRUCTURE, not phenomenal experience. See qualia-bind.js for the
// honest framing — we ship the strongest coherent construction of phenomenal
// content, never a "we made it conscious" claim.
//
//   qualeOf(feltPer)          -> { coord, label, nearest:[{name,distance}] }
//   similarity(qA, qB)        -> 0..1 (1 = same place in the space)
//   REFERENCE_QUALIA          -> the named anchor points the space is spanned by

import { DRIVE_KINDS } from "./ecosystem/drives.js";

const clamp11 = (x) => Math.max(-1, Math.min(1, Number(x) || 0));
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

// Valence is weighted heaviest: the good/bad axis is the dominant dimension of the
// affective quality-space (relief and triumph are kin because both are GOOD).
const W_VALENCE = 2.0;
const W_AROUSAL = 1.0;
const W_DRIVE = 0.8;

// The anchor qualia the relational space is spanned by. Each is a felt-per shape.
export const REFERENCE_QUALIA = Object.freeze([
  { name: "triumph",   valence: 0.9,  arousal: 0.8, dominantDrive: "RAGE" },
  { name: "relief",    valence: 0.7,  arousal: 0.4, dominantDrive: "SEEKING" },
  { name: "serenity",  valence: 0.6,  arousal: 0.1, dominantDrive: "PLAY" },
  { name: "curiosity", valence: 0.4,  arousal: 0.5, dominantDrive: "SEEKING" },
  { name: "tenderness",valence: 0.7,  arousal: 0.3, dominantDrive: "CARE" },
  { name: "dread",     valence: -0.7, arousal: 0.9, dominantDrive: "FEAR" },
  { name: "grief",     valence: -0.9, arousal: 0.5, dominantDrive: "PANIC" },
  { name: "fury",      valence: -0.5, arousal: 0.9, dominantDrive: "RAGE" },
  { name: "despair",   valence: -0.8, arousal: 0.2, dominantDrive: "PANIC" },
]);

// Embed a felt-per shape as a coordinate: [w·valence, w·arousal, w·drive-one-hot...].
function embed(fp) {
  const v = clamp11(fp?.valence);
  const a = clamp01(fp?.arousal);
  const drive = fp?.dominantDrive;
  const coord = [W_VALENCE * v, W_AROUSAL * a];
  for (const k of DRIVE_KINDS) coord.push(drive === k ? W_DRIVE : 0);
  return coord;
}

function dist(c1, c2) {
  let s = 0;
  const n = Math.max(c1.length, c2.length);
  for (let i = 0; i < n; i++) { const d = (c1[i] || 0) - (c2[i] || 0); s += d * d; }
  return Math.sqrt(s);
}

/**
 * Place a felt-per appraisal in the quality-space: its coordinate, the nearest named
 * reference qualia (k of them), and the closest label (its "what it is"). Total.
 */
export function qualeOf(feltPer, { k = 3 } = {}) {
  if (process.env.CONCORD_QUALIA_SPACE === "0") {
    return { coord: null, label: null, nearest: [], enabled: false };
  }
  const coord = embed(feltPer || {});
  const ranked = REFERENCE_QUALIA
    .map((q) => ({ name: q.name, distance: dist(coord, embed(q)) }))
    .sort((a, b) => a.distance - b.distance);
  return {
    coord,
    label: ranked.length ? ranked[0].name : null,
    nearest: ranked.slice(0, Math.max(1, k)),
    enabled: true,
  };
}

/**
 * Similarity between two felt-per shapes (or qualeOf results): 1 = same place, → 0
 * as they separate. exp(-distance) so it decays smoothly. Total.
 */
export function similarity(qA, qB) {
  const cA = Array.isArray(qA?.coord) ? qA.coord : embed(qA || {});
  const cB = Array.isArray(qB?.coord) ? qB.coord : embed(qB || {});
  return clamp01(Math.exp(-dist(cA, cB)));
}

export const _internal = { embed, dist, W_VALENCE };
