// server/lib/receipts/qr-svg.js
//
// A compact, dependency-free QR encoder (ISO/IEC 18004) producing an inline
// SVG. Byte mode, error-correction level M, versions 1–10, fixed mask 0
// (a valid mask; decoders accept any). The server has no QR package in its
// dependency tree (qrcode exists only in the frontend's), and the calc
// sheet must render without network access, so the code lives here.
//
// Correctness anchors: GF(256) Reed–Solomon over primitive polynomial
// 0x11d exactly as the spec defines; the encoded block's syndrome is zero
// by construction (asserted in tests by re-dividing), and the data path
// round-trips through the test decoder.

// ---- GF(256) -------------------------------------------------------------
const GF_EXP = new Array(512);
const GF_LOG = new Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
}
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]]);

/** Reed–Solomon generator polynomial of degree n (coefficients, highest first). */
function rsGenerator(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], GF_EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

/** EC codewords for one data block. */
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Array(ecLen).fill(0);
  for (const d of data) {
    const factor = d ^ res[0];
    res.shift();
    res.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) res[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return res;
}

// ---- Capacity / block table, level M, versions 1–10 ----------------------
// [totalCodewords, ecPerBlock, [[blockCount, dataPerBlock], ...groups]]
const QR_M = {
  1: [26, 10, [[1, 16]]],
  2: [44, 16, [[1, 28]]],
  3: [70, 26, [[1, 44]]],
  4: [100, 18, [[2, 32]]],
  5: [134, 24, [[2, 43]]],
  6: [172, 16, [[4, 27]]],
  7: [196, 18, [[4, 31]]],
  8: [242, 22, [[2, 38], [2, 39]]],
  9: [292, 22, [[3, 36], [2, 37]]],
  10: [346, 26, [[4, 43], [1, 44]]],
};
const ALIGNMENT = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};
const REMAINDER_BITS = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

function dataCapacity(version) {
  return QR_M[version][2].reduce((sum, [count, per]) => sum + count * per, 0);
}

/** Data codewords for `bytes` at `version` (byte mode, level M), or null when they do not fit. */
export function qrDataCodewords(bytes, version) {
  const capacity = dataCapacity(version);
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0b0100, 4); // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);
  if (bits.length > capacity * 8) return null;
  const cap = capacity * 8;
  push(0, Math.min(4, cap - bits.length)); // terminator
  while (bits.length % 8 !== 0) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  for (let pad = 0xec; out.length < capacity; pad = pad === 0xec ? 0x11 : 0xec) out.push(pad);
  return out;
}

/** Full interleaved codeword stream (data + EC + remainder bits as a bit array tail count). */
export function qrCodewords(bytes, version) {
  const data = qrDataCodewords(bytes, version);
  if (!data) return null;
  const [, ecPerBlock, groups] = QR_M[version];
  const blocks = [];
  let off = 0;
  for (const [count, per] of groups) {
    for (let i = 0; i < count; i++) {
      const block = data.slice(off, off + per);
      off += per;
      blocks.push({ data: block, ec: rsEncode(block, ecPerBlock) });
    }
  }
  const out = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const b of blocks) out.push(b.ec[i]);
  return { codewords: out, remainderBits: REMAINDER_BITS[version] };
}

/** 15-bit format information for level M and `mask` (BCH(15,5), XOR mask 0x5412). */
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // level M = 00
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * The module matrix for `text` at the smallest fitting version 1–10.
 * Returns { version, size, modules } (modules[row][col], true = dark), or null.
 */
export function qrMatrix(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let version = 0;
  for (let v = 1; v <= 10; v++) {
    if (qrDataCodewords(bytes, v)) { version = v; break; }
  }
  if (!version) return null;
  const size = 4 * version + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r, c, v) => { if (r >= 0 && r < size && c >= 0 && c < size) m[r][c] = v; };

  const finder = (r0, c0) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inside = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const dark = inside && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(r0 + r, c0 + c, dark);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // Timing patterns.
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Alignment patterns: every center pair except the three corners that
  // would overlap a finder (patterns on the timing lines are real and are
  // drawn over the timing cells).
  const centers = ALIGNMENT[version];
  if (centers.length) {
    const lo = centers[0];
    const hi = centers[centers.length - 1];
    for (const r of centers) {
      for (const c of centers) {
        if ((r === lo && c === lo) || (r === lo && c === hi) || (r === hi && c === lo)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
          }
        }
      }
    }
  }
  // Dark module.
  set(4 * version + 9, 8, true);
  // Reserve format information cells.
  const reserveFormat = () => {
    for (let i = 0; i <= 8; i++) {
      if (m[8][i] === null) m[8][i] = false;
      if (m[i][8] === null) m[i][8] = false;
    }
    for (let i = 0; i < 8; i++) {
      if (m[8][size - 1 - i] === null) m[8][size - 1 - i] = false;
      if (m[size - 1 - i][8] === null) m[size - 1 - i][8] = false;
    }
    m[size - 8][8] = true; // dark module already set above overlaps this cell for some versions; keep true
  };
  reserveFormat();

  // Data placement: zigzag from bottom-right, skipping column 6, mask 0.
  const { codewords, remainderBits } = qrCodewords(bytes, version);
  const bits = [];
  for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
  for (let i = 0; i < remainderBits; i++) bits.push(0);
  let bit = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let i = 0; i < size; i++) {
      const row = upward ? size - 1 - i : i;
      for (const c of [col, col - 1]) {
        if (m[row][c] === null) {
          let v = bit < bits.length ? bits[bit++] === 1 : false;
          if ((row + c) % 2 === 0) v = !v; // mask 0
          m[row][c] = v;
        }
      }
    }
    upward = !upward;
  }
  // Format information (mask 0).
  const fmt = formatBits(0);
  const fbit = (i) => ((fmt >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) m[8][i] = fbit(i);
  m[8][7] = fbit(6);
  m[8][8] = fbit(7);
  m[7][8] = fbit(8);
  for (let i = 9; i < 15; i++) m[14 - i][8] = fbit(i);
  for (let i = 0; i < 8; i++) m[size - 1 - i][8] = fbit(i);
  for (let i = 8; i < 15; i++) m[8][size - 15 + i] = fbit(i);
  m[size - 8][8] = true;

  return { version, size, modules: m.map((row) => row.map((v) => v === true)) };
}

/** Inline SVG (with quiet zone) for `text`, or "" when it cannot be encoded. */
export function qrSvg(text, { modulePx = 4 } = {}) {
  const q = qrMatrix(text);
  if (!q) return "";
  const quiet = 4;
  const dim = (q.size + quiet * 2) * modulePx;
  let rects = "";
  for (let r = 0; r < q.size; r++) {
    for (let c = 0; c < q.size; c++) {
      if (q.modules[r][c]) {
        rects += `<rect x="${(c + quiet) * modulePx}" y="${(r + quiet) * modulePx}" width="${modulePx}" height="${modulePx}"/>`;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" role="img" aria-label="QR code for the verification link"><rect width="${dim}" height="${dim}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
}
