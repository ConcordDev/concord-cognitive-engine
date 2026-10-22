/**
 * Minimal, dependency-free FLAC encoder (lossless) for Studio exports.
 *
 * Fixed-blocksize frames (4096), per channel the best of CONSTANT / FIXED
 * predictor orders 0-4 / VERBATIM, Rice-coded residuals with partition orders
 * 0-4, left/side/right/mid-side stereo decorrelation. 16- or 24-bit, TPDF
 * dithered from float. STREAMINFO MD5 is left zero ("not computed"), which
 * the FLAC spec allows.
 */

class BitWriter {
  private buf: Uint8Array;
  private pos = 0; // bytes
  private acc = 0;
  private nbits = 0;
  constructor(initial = 1 << 16) {
    this.buf = new Uint8Array(initial);
  }
  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let len = this.buf.length * 2;
    while (len < this.pos + n) len *= 2;
    const nb = new Uint8Array(len);
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
  }
  /** Write the low `n` bits of `v` (n ≤ 32). */
  write(v: number, n: number) {
    if (n === 0) return;
    if (n > 24) {
      this.write(Math.floor(v / 0x1000000) & ((1 << (n - 24)) - 1), n - 24);
      this.write(v & 0xffffff, 24);
      return;
    }
    this.acc = (this.acc * (1 << n)) + (v & ((1 << n) - 1));
    this.nbits += n;
    this.ensure(4);
    while (this.nbits >= 8) {
      this.nbits -= 8;
      this.buf[this.pos++] = Math.floor(this.acc / (1 << this.nbits)) & 0xff;
      this.acc = this.acc & ((1 << this.nbits) - 1);
    }
  }
  writeUnary(q: number) {
    while (q >= 24) { this.write(0, 24); q -= 24; }
    this.write(1, q + 1);
  }
  alignZero() {
    if (this.nbits > 0) this.write(0, 8 - this.nbits);
  }
  get bytePos() { return this.pos; }
  bytes(from = 0, to = this.pos) { return this.buf.subarray(from, to); }
  writeBytes(b: Uint8Array) { this.alignZero(); this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
  toUint8Array() { this.alignZero(); return this.buf.slice(0, this.pos); }
}

function crc8(b: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i];
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
  }
  return c;
}
function crc16(b: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < b.length; i++) {
    c ^= b[i] << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
  }
  return c;
}

function utf8Num(n: number): number[] {
  if (n < 0x80) return [n];
  const limits = [0x800, 0x10000, 0x200000, 0x4000000, 0x80000000];
  const leads = [0xc0, 0xe0, 0xf0, 0xf8, 0xfc];
  let cont = 1;
  while (cont < 5 && n >= limits[cont - 1]) cont++;
  const out: number[] = [];
  for (let i = 0; i < cont; i++) { out.unshift(0x80 | (n & 0x3f)); n = Math.floor(n / 64); }
  out.unshift(leads[cont - 1] | n);
  return out;
}

const fixedResidual = (x: Int32Array, order: number): Int32Array => {
  const n = x.length;
  const r = new Int32Array(Math.max(0, n - order));
  for (let i = order; i < n; i++) {
    let p = 0;
    switch (order) {
      case 0: p = 0; break;
      case 1: p = x[i - 1]; break;
      case 2: p = 2 * x[i - 1] - x[i - 2]; break;
      case 3: p = 3 * x[i - 1] - 3 * x[i - 2] + x[i - 3]; break;
      case 4: p = 4 * x[i - 1] - 6 * x[i - 2] + 4 * x[i - 3] - x[i - 4]; break;
    }
    r[i - order] = x[i] - p;
  }
  return r;
};

const zig = (v: number) => (v >= 0 ? v * 2 : -v * 2 - 1);

/** Best Rice partitioning: returns [bits, partitionOrder, params]. */
function planRice(res: Int32Array, blockSize: number, order: number): { bits: number; po: number; params: number[] } {
  let best = { bits: Infinity, po: 0, params: [0] };
  for (let po = 0; po <= 4; po++) {
    const parts = 1 << po;
    if (blockSize % parts !== 0) break;
    const psize = blockSize / parts;
    if (psize <= order) break;
    let total = 0;
    const params: number[] = [];
    let idx = 0;
    for (let p = 0; p < parts; p++) {
      const cnt = p === 0 ? psize - order : psize;
      let sum = 0;
      for (let k = 0; k < cnt; k++) sum += zig(res[idx + k]);
      const mean = cnt ? sum / cnt : 0;
      let k = mean > 1 ? Math.min(14, Math.max(0, Math.floor(Math.log2(mean)))) : 0;
      // Evaluate k and k+1, keep the cheaper.
      const cost = (kk: number) => { let b = 0; for (let j = 0; j < cnt; j++) b += (zig(res[idx + j]) >>> kk) + 1 + kk; return b; };
      let c0 = cost(k);
      if (k < 14) { const c1 = cost(k + 1); if (c1 < c0) { k++; c0 = c1; } }
      if (k > 0) { const cm = cost(k - 1); if (cm < c0) { k--; c0 = cm; } }
      params.push(k);
      total += 5 + c0;
      idx += cnt;
    }
    if (total < best.bits) best = { bits: total, po, params };
  }
  return best;
}

function writeSubframe(w: BitWriter, x: Int32Array, bps: number): void {
  const n = x.length;
  let constant = true;
  for (let i = 1; i < n; i++) if (x[i] !== x[0]) { constant = false; break; }
  if (constant) {
    w.write(0, 1); w.write(0, 6); w.write(0, 1); // CONSTANT
    w.write(x[0] & (2 ** bps - 1), bps);
    return;
  }
  let best: { order: number; res: Int32Array; plan: ReturnType<typeof planRice> } | null = null;
  for (let order = 0; order <= Math.min(4, n - 1); order++) {
    const res = fixedResidual(x, order);
    // Residuals must fit in 32-bit signed for Rice coding.
    const plan = planRice(res, n, order);
    const bits = plan.bits + order * bps;
    if (!best || bits < best.plan.bits + best.order * bps) best = { order, res, plan };
  }
  const verbatimBits = n * bps;
  if (!best || best.plan.bits + best.order * bps >= verbatimBits) {
    w.write(0, 1); w.write(1, 6); w.write(0, 1); // VERBATIM
    for (let i = 0; i < n; i++) w.write(x[i] & (2 ** bps - 1), bps);
    return;
  }
  w.write(0, 1); w.write(8 | best.order, 6); w.write(0, 1); // FIXED order
  for (let i = 0; i < best.order; i++) w.write(x[i] & (2 ** bps - 1), bps);
  w.write(0, 2); // RICE (4-bit params)
  w.write(best.plan.po, 4);
  let idx = 0;
  const parts = 1 << best.plan.po;
  const psize = n / parts;
  for (let p = 0; p < parts; p++) {
    const k = best.plan.params[p];
    w.write(k, 4);
    const cnt = p === 0 ? psize - best.order : psize;
    for (let j = 0; j < cnt; j++) {
      const u = zig(best.res[idx + j]);
      w.writeUnary(Math.floor(u / 2 ** k));
      if (k) w.write(u % 2 ** k, k);
    }
    idx += cnt;
  }
}

function quantize(ch: Float32Array, bps: number, dither: boolean): Int32Array {
  const max = 2 ** (bps - 1);
  const out = new Int32Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    let s = Number.isFinite(ch[i]) ? ch[i] : 0;
    if (dither) s += (Math.random() - Math.random()) / max;
    const v = Math.round(s * max);
    out[i] = Math.max(-max, Math.min(max - 1, v));
  }
  return out;
}

const SR_CODES: Record<number, number> = { 88200: 1, 176400: 2, 192000: 3, 8000: 4, 16000: 5, 22050: 6, 24000: 7, 32000: 8, 44100: 9, 48000: 10, 96000: 11 };

export interface FlacOptions {
  bitDepth?: 16 | 24;
  dither?: boolean;
  blockSize?: number;
}

export function encodeFlac(channels: Float32Array[], sampleRate: number, opts: FlacOptions = {}): Uint8Array {
  const bps = opts.bitDepth ?? 24;
  const nch = channels.length;
  if (nch < 1 || nch > 8) throw new Error('encodeFlac: 1-8 channels');
  const total = channels[0].length;
  const blockSize = opts.blockSize ?? 4096;
  const ints = channels.map((c) => quantize(c, bps, opts.dither ?? true));
  const w = new BitWriter(Math.max(1 << 16, total * nch * 2));

  // fLaC + STREAMINFO (last metadata block)
  w.writeBytes(new Uint8Array([0x66, 0x4c, 0x61, 0x43]));
  w.write(1, 1); w.write(0, 7); w.write(34, 24);
  w.write(blockSize, 16); w.write(blockSize, 16);
  w.write(0, 24); w.write(0, 24); // min/max frame size unknown
  w.write(sampleRate, 20); w.write(nch - 1, 3); w.write(bps - 1, 5);
  w.write(Math.floor(total / 2 ** 32), 4); w.write(total >>> 0, 32);
  for (let i = 0; i < 16; i++) w.write(0, 8); // MD5 unknown

  const srCode = SR_CODES[sampleRate] ?? 0;
  if (!srCode) throw new Error(`encodeFlac: unsupported sample rate ${sampleRate}`);
  const bpsCode = bps === 16 ? 4 : 6;

  let frame = 0;
  for (let start = 0; start < total; start += blockSize, frame++) {
    const n = Math.min(blockSize, total - start);
    const blk = ints.map((c) => c.subarray(start, start + n));
    // Stereo decorrelation choice.
    let assign = nch - 1; // independent
    let subs: Array<{ x: Int32Array; bps: number }> = blk.map((x) => ({ x, bps }));
    if (nch === 2) {
      const L = blk[0], R = blk[1];
      const S = new Int32Array(n), M = new Int32Array(n);
      for (let i = 0; i < n; i++) { S[i] = L[i] - R[i]; M[i] = (L[i] + R[i]) >> 1; }
      const est = (x: Int32Array) => { let s = 0; for (let i = 2; i < x.length; i++) s += Math.abs(x[i] - 2 * x[i - 1] + x[i - 2]); return s; };
      const eL = est(L), eR = est(R), eS = est(S), eM = est(M);
      const opts2 = [
        { a: 1, c: eL + eR, s: [{ x: L, bps }, { x: R, bps }] },
        { a: 8, c: eL + eS, s: [{ x: L, bps }, { x: S, bps: bps + 1 }] },
        { a: 9, c: eS + eR, s: [{ x: S, bps: bps + 1 }, { x: R, bps }] },
        { a: 10, c: eM + eS, s: [{ x: M, bps }, { x: S, bps: bps + 1 }] },
      ].sort((a, b) => a.c - b.c)[0];
      assign = opts2.a;
      subs = opts2.s;
    }
    const startByte = w.bytePos;
    // Frame header
    w.write(0x3ffe, 14); w.write(0, 1); w.write(0, 1); // sync, reserved, fixed-blocksize
    const bsCode = n === 4096 ? 12 : 7; // 12 = 4096 samples, 7 = 16-bit (n-1) after the frame number
    w.write(bsCode, 4);
    w.write(srCode, 4);
    w.write(assign, 4);
    w.write(bpsCode, 3);
    w.write(0, 1);
    for (const b of utf8Num(frame)) w.write(b, 8);
    if (bsCode === 7) w.write(n - 1, 16);
    w.alignZero();
    const hdr = w.bytes(startByte, w.bytePos);
    w.write(crc8(hdr), 8);
    for (const s of subs) writeSubframe(w, s.x, s.bps);
    w.alignZero();
    w.write(crc16(w.bytes(startByte, w.bytePos)), 16);
  }
  return w.toUint8Array();
}
