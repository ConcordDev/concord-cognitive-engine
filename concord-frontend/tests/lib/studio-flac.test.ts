import { describe, it, expect } from 'vitest';
import { encodeFlac } from '@/lib/daw/flac';

/** Minimal FLAC decoder covering what the encoder emits (CONSTANT / VERBATIM / FIXED, Rice, stereo modes). */
function decodeFlac(bytes: Uint8Array) {
  let pos = 0; // bit position
  const bit = () => (bytes[pos >> 3] >> (7 - (pos++ & 7))) & 1;
  const read = (n: number) => { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + bit(); return v; };
  const sread = (n: number) => { const v = read(n); return v >= 2 ** (n - 1) ? v - 2 ** n : v; };
  const align = () => { pos = (pos + 7) & ~7; };
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('fLaC');
  pos = 32;
  const last = read(1); read(7); const len = read(24);
  expect(last).toBe(1);
  const metaStart = pos;
  read(16); read(16); read(24); read(24);
  const sr = read(20); const nch = read(3) + 1; const bps = read(5) + 1;
  const total = read(4) * 2 ** 32 + read(32);
  pos = metaStart + len * 8;
  const out = Array.from({ length: nch }, () => [] as number[]);
  while (pos < bytes.length * 8 - 16) {
    expect(read(14)).toBe(0x3ffe);
    read(1); read(1);
    const bsc = read(4); read(4); const assign = read(4); read(3); read(1);
    let b = read(8); while ((b & 0xc0) === 0xc0) { b = (b << 1) & 0xff; read(8); }
    const n = bsc === 12 ? 4096 : read(16) + 1;
    read(8); // crc8
    const subs: number[][] = [];
    for (let c = 0; c < nch; c++) {
      let sbps = bps;
      if ((assign === 8 && c === 1) || (assign === 9 && c === 0) || (assign === 10 && c === 1)) sbps++;
      read(1); const type = read(6); read(1);
      const x: number[] = [];
      if (type === 0) { const v = sread(sbps); for (let i = 0; i < n; i++) x.push(v); }
      else if (type === 1) { for (let i = 0; i < n; i++) x.push(sread(sbps)); }
      else {
        const order = type & 7;
        for (let i = 0; i < order; i++) x.push(sread(sbps));
        expect(read(2)).toBe(0);
        const po = read(4); const parts = 1 << po;
        const res: number[] = [];
        for (let p = 0; p < parts; p++) {
          const k = read(4);
          const cnt = (p === 0 ? n / parts - order : n / parts);
          for (let j = 0; j < cnt; j++) {
            let q = 0; while (bit() === 0) q++;
            const u = q * 2 ** k + read(k);
            res.push(u & 1 ? -((u + 1) / 2) : u / 2);
          }
        }
        for (let i = order; i < n; i++) {
          const r = res[i - order];
          let pr = 0;
          if (order === 1) pr = x[i - 1];
          else if (order === 2) pr = 2 * x[i - 1] - x[i - 2];
          else if (order === 3) pr = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3];
          else if (order === 4) pr = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4];
          x.push(pr + r);
        }
      }
      subs.push(x);
    }
    let L = subs[0], R = subs[1];
    if (assign === 8) R = L.map((l, i) => l - subs[1][i]);
    else if (assign === 9) { R = subs[1]; L = subs[0].map((s, i) => s + R[i]); }
    else if (assign === 10) {
      L = []; R = [];
      for (let i = 0; i < n; i++) { const s = subs[1][i]; const m = subs[0][i] * 2 + (s & 1); L.push((m + s) >> 1); R.push((m - s) >> 1); }
    }
    if (nch === 2) { out[0].push(...L); out[1].push(...R); } else subs.forEach((x, c) => out[c].push(...x));
    align();
    read(16);
  }
  return { sr, nch, bps, total, out };
}

const quant = (x: Float32Array, bps: number) => Array.from(x, (v) => Math.max(-(2 ** (bps - 1)), Math.min(2 ** (bps - 1) - 1, Math.round(v * 2 ** (bps - 1)))));

describe('FLAC encoder', () => {
  it('round-trips 24-bit stereo losslessly (no dither)', () => {
    const sr = 48000, n = 10000;
    const L = new Float32Array(n), R = new Float32Array(n);
    for (let i = 0; i < n; i++) { L[i] = 0.5 * Math.sin(i / 20); R[i] = 0.3 * Math.sin(i / 7) + (i % 50 === 0 ? 0.2 : 0); }
    const f = encodeFlac([L, R], sr, { bitDepth: 24, dither: false });
    const d = decodeFlac(f);
    expect(d.sr).toBe(sr); expect(d.nch).toBe(2); expect(d.bps).toBe(24); expect(d.total).toBe(n);
    expect(d.out[0]).toEqual(quant(L, 24));
    expect(d.out[1]).toEqual(quant(R, 24));
    expect(f.length).toBeLessThan(n * 2 * 3);
  });

  it('round-trips 16-bit mono with silence and a short last block', () => {
    const n = 4096 * 2 + 123;
    const x = new Float32Array(n);
    for (let i = 5000; i < n; i++) x[i] = ((i * 7919) % 2001) / 1000 - 1;
    const d = decodeFlac(encodeFlac([x], 44100, { bitDepth: 16, dither: false }));
    expect(d.out[0]).toEqual(quant(x, 16));
  });
});
