// Theme: deferred (procgen Simplex terrain) — small 2D simplex-noise
// implementation seeded from a 32-bit integer.
//
// Why bundle this instead of a npm dep: keeps the world-lens build
// surface self-contained, avoids the babel/three pinning quirks that
// the simplex-noise@4 package has had with Next.js, and a 2D simplex
// is cheap to write (~80 LOC). Output range: [-1, +1].
//
// Reference: Stefan Gustavson's 2012 paper "Simplex noise demystified".
//
// Usage:
//   const noise = createSimplexNoise2D(0xC0FFEE);
//   const v = noise(x, y);                    // single sample
//   const v2 = octaveNoise2D(noise, x, y, 4); // 4-octave fractal

const GRAD3: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];

// 32-bit xorshift, just enough randomness for a permutation seed.
function xorshift32(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return ((s >>> 0) / 0xffffffff);
  };
}

function buildPerm(rng: () => number): Uint8Array {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  // Double the table so [perm[i + perm[j]]] fits in 0..511 without modulo.
  const out = new Uint8Array(512);
  for (let i = 0; i < 512; i++) out[i] = p[i & 255];
  return out;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

/**
 * Create a 2D simplex-noise function seeded from `seed`. Same seed →
 * same output. Returns values in [-1, 1].
 */
export function createSimplexNoise2D(seed: number): (x: number, y: number) => number {
  const perm = buildPerm(xorshift32(seed));

  return function noise2D(x: number, y: number): number {
    // Skew the input space.
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const X0 = i - t;
    const Y0 = j - t;
    const x0 = x - X0;
    const y0 = y - Y0;

    let i1: number, j1: number;
    if (x0 > y0) { i1 = 1; j1 = 0; }
    else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;

    const ii = i & 255;
    const jj = j & 255;
    const gi0 = perm[ii + perm[jj]] % 12;
    const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
    const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;

    let n0 = 0, n1 = 0, n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      const g = GRAD3[gi0];
      n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      const g = GRAD3[gi1];
      n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      const g = GRAD3[gi2];
      n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  };
}

/**
 * Octaved fractal noise — superposes `octaves` simplex samples at
 * geometrically increasing frequency and decreasing amplitude. Common
 * used for natural-looking terrain. Returns roughly [-1, 1].
 */
export function octaveNoise2D(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
  persistence: number = 0.5,
  lacunarity: number = 2,
): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let maxValue = 0;
  for (let i = 0; i < octaves; i++) {
    total += noise(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / maxValue;
}
