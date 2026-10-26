/**
 * Aura — a deterministic profile banner generated from the handle
 * (job oc-social-5, Social identity / JOB 8).
 *
 * Nothing about a person's Aura is stored or accepted from users: the
 * handle is hashed (FNV-1a of the lower-cased handle), the hash seeds a
 * small PRNG (mulberry32), and the PRNG picks 5 blurred blob
 * positions/sizes/colours from a palette fixed in this file. Same handle →
 * byte-identical SVG, different handles → different output. The user
 * string itself never enters the output — only numbers derived from the
 * hash — so no unescaped user content can end up in the SVG. An optional
 * accent (already validated as a strict #rrggbb hex by the picker and the
 * server) may colour one of the blobs.
 *
 * This is a STILL image: no drift, no animation, no motion of any kind.
 */

/** FNV-1a, 32-bit. Returns an unsigned 32-bit integer. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force to unsigned 32-bit so the seed is stable across engines.
  return hash >>> 0;
}

/** mulberry32 — a tiny deterministic PRNG (public domain reference). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fixed blob palette — colours picked in code, never user-supplied. */
export const AURA_PALETTE = [
  '#0ea5e9',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
  '#f43f5e',
  '#84cc16',
] as const;

export const AURA_BLOB_COUNT = 5;
export const AURA_WIDTH = 600;
export const AURA_HEIGHT = 160;
/** Blur radius for the blobs (spec: feGaussianBlur ~34-40). */
export const AURA_BLUR = 38;
const AURA_BASE = '#0d0d14';

/** Strict #rrggbb hex (case-insensitive input). Returns lowercase or null. */
export function normalizeHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

export interface AuraBlob {
  cx: number;
  cy: number;
  r: number;
  color: string;
  opacity: number;
}

/**
 * The 5 blob picks for a handle. Deterministic: same handle (and accent),
 * same blobs. The accent, when valid, replaces the first blob's colour.
 */
export function auraBlobs(handle: string, accent?: string | null): AuraBlob[] {
  const seed = fnv1a(String(handle || '').toLowerCase());
  const rand = mulberry32(seed);
  const accentHex = normalizeHex(accent);
  const blobs: AuraBlob[] = [];
  for (let i = 0; i < AURA_BLOB_COUNT; i++) {
    blobs.push({
      cx: Math.round(rand() * AURA_WIDTH),
      cy: Math.round(rand() * AURA_HEIGHT),
      r: 60 + Math.round(rand() * 80),
      color: AURA_PALETTE[Math.floor(rand() * AURA_PALETTE.length)],
      opacity: 0.45 + rand() * 0.25,
    });
  }
  if (accentHex) blobs[0].color = accentHex;
  return blobs;
}

/**
 * The full Aura as a static inline-SVG string. Only hash-derived numbers
 * and palette/accent hexes appear in the markup — the handle never does.
 */
export function auraSvg(handle: string, accent?: string | null): string {
  const seed = fnv1a(String(handle || '').toLowerCase());
  const blobs = auraBlobs(handle, accent);
  const filterId = `aura_blur_${seed.toString(36)}`;
  const circles = blobs
    .map(
      (b) =>
        `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="${b.color}" opacity="${b.opacity.toFixed(3)}"/>`,
    )
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${AURA_WIDTH} ${AURA_HEIGHT}" ` +
    `preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" focusable="false">` +
    `<defs><filter id="${filterId}" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feGaussianBlur stdDeviation="${AURA_BLUR}"/></filter></defs>` +
    `<rect width="${AURA_WIDTH}" height="${AURA_HEIGHT}" fill="${AURA_BASE}"/>` +
    `<g filter="url(#${filterId})">${circles}</g>` +
    `</svg>`
  );
}