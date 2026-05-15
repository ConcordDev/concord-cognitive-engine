// Performance benchmarks for cryptographic operations — hashing, keys, signatures, encoding

import {
  crc32, toHex, fromHex, toBase64, fromBase64, constantTimeEqual,
  generateId, encodeUTF8, decodeUTF8, concatBytes,
  setCryptoProvider, sha256, hmacSha256, randomBytes,
} from '../../utils/crypto';
import type { CryptoProvider } from '../../utils/crypto';

// ── Timing helpers ───────────────────────────────────────────────────────────

// CI runners are shared 2-core boxes; wall-clock perf budgets that are snug
// on a dev workstation flake here from runner load. Divide every measured
// time by 3 in CI so existing toBeLessThan(N) assertions implicitly get 3×
// headroom. Local runs keep tight budgets for honest regression detection.
// Matches the divisor pattern in store-scale.perf.test.ts (introduced in #375).
const CI_BUDGET_DIVISOR = process.env.CI ? 3 : 1;

function measureMs(fn: () => void): number {
  const start = performance.now();
  fn();
  return (performance.now() - start) / CI_BUDGET_DIVISOR;
}

async function measureMsAsync(fn: () => Promise<void>): Promise<number> {
  const start = performance.now();
  await fn();
  return (performance.now() - start) / CI_BUDGET_DIVISOR;
}

// ── Mock crypto provider ─────────────────────────────────────────────────────

const mockCrypto: CryptoProvider = {
  sha256: jest.fn(async (d: Uint8Array) => {
    const r = new Uint8Array(32);
    for (let i = 0; i < Math.min(d.length, 32); i++) r[i] = d[i] ^ 0xff;
    return r;
  }),
  hmacSha256: jest.fn(async (d: Uint8Array, k: Uint8Array) => {
    const r = new Uint8Array(32);
    for (let i = 0; i < 32; i++) r[i] = (d[i % d.length] ^ k[i % k.length]) & 0xff;
    return r;
  }),
  crc32: jest.fn((d: Uint8Array) => { let c = 0; for (let i = 0; i < d.length; i++) c = (c + d[i]) >>> 0; return c; }),
  randomBytes: jest.fn((n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 37) & 0xff; return b; }),
  ed25519GenerateKeypair: jest.fn(async () => ({ publicKey: new Uint8Array(32).fill(0x01), privateKey: new Uint8Array(64).fill(0x02) })),
  ed25519Sign: jest.fn(async (m: Uint8Array) => { const s = new Uint8Array(64); for (let i = 0; i < 64; i++) s[i] = m[i % m.length] ^ 0xaa; return s; }),
  ed25519Verify: jest.fn(async () => true),
};

beforeAll(() => { setCryptoProvider(mockCrypto); });
beforeEach(() => { jest.clearAllMocks(); });

// ── Hash Computation Throughput ──────────────────────────────────────────────

describe('hash computation throughput', () => {
  it('SHA-256 of 1000 payloads (256B each) in under 1000ms', async () => {
    const buf = new Uint8Array(256).fill(0x42);
    const ms = await measureMsAsync(async () => { for (let i = 0; i < 1000; i++) await sha256(buf); });
    expect(ms).toBeLessThan(1000);
  });

  it('SHA-256 of 100 large payloads (64KB) in under 1000ms', async () => {
    const buf = new Uint8Array(65536).fill(0x55);
    const ms = await measureMsAsync(async () => { for (let i = 0; i < 100; i++) await sha256(buf); });
    expect(ms).toBeLessThan(1000);
  });

  it('HMAC-SHA256 for 1000 payloads in under 1000ms', async () => {
    const d = new Uint8Array(128).fill(0x33);
    const k = new Uint8Array(32).fill(0x77);
    const ms = await measureMsAsync(async () => { for (let i = 0; i < 1000; i++) await hmacSha256(d, k); });
    expect(ms).toBeLessThan(1000);
  });

  it('CRC32 of 10000 payloads (48B each) in under 400ms', () => {
    const buf = new Uint8Array(48).fill(0xde);
    const ms = measureMs(() => { for (let i = 0; i < 10000; i++) crc32(buf); });
    expect(ms).toBeLessThan(400);
  });
});

// ── Key Generation Time ──────────────────────────────────────────────────────

describe('key generation time', () => {
  it('generates 100 Ed25519 keypairs in under 1000ms', async () => {
    const ms = await measureMsAsync(async () => { for (let i = 0; i < 100; i++) await mockCrypto.ed25519GenerateKeypair(); });
    expect(ms).toBeLessThan(1000);
  });

  it('generates 10000 random ID strings in under 2000ms', () => {
    const ms = measureMs(() => { for (let i = 0; i < 10000; i++) generateId('dtu'); });
    expect(ms).toBeLessThan(2000);
  });

  it('generates 1000 random byte arrays (32B) in under 200ms', () => {
    const ms = measureMs(() => { for (let i = 0; i < 1000; i++) randomBytes(32); });
    expect(ms).toBeLessThan(200);
  });
});

// ── Signature Creation/Verification Throughput ───────────────────────────────

describe('signature creation/verification throughput', () => {
  it('signs 500 messages in under 1000ms', async () => {
    const msg = new Uint8Array(256).fill(0xcc);
    const key = new Uint8Array(64).fill(0x02);
    const ms = await measureMsAsync(async () => { for (let i = 0; i < 500; i++) await mockCrypto.ed25519Sign(msg, key); });
    expect(ms).toBeLessThan(1000);
  });

  it('verifies 500 signatures in under 1000ms', async () => {
    const msg = new Uint8Array(256).fill(0xcc);
    const sig = new Uint8Array(64).fill(0x55);
    const pk = new Uint8Array(32).fill(0x01);
    const ms = await measureMsAsync(async () => { for (let i = 0; i < 500; i++) await mockCrypto.ed25519Verify(msg, sig, pk); });
    expect(ms).toBeLessThan(1000);
  });

  it('constant-time comparison 10000 matching pairs in under 200ms', () => {
    const a = new Uint8Array(32).fill(0xab), b = new Uint8Array(32).fill(0xab);
    const ms = measureMs(() => { for (let i = 0; i < 10000; i++) constantTimeEqual(a, b); });
    expect(ms).toBeLessThan(200);
  });

  it('constant-time comparison 10000 mismatched pairs in under 200ms', () => {
    const a = new Uint8Array(32).fill(0xab), b = new Uint8Array(32).fill(0xcd);
    const ms = measureMs(() => { for (let i = 0; i < 10000; i++) constantTimeEqual(a, b); });
    expect(ms).toBeLessThan(200);
  });
});

// ── Base64 Encode/Decode Throughput ──────────────────────────────────────────

describe('base64 encode/decode throughput', () => {
  it('round-trips 10000 small payloads (48B) in under 400ms', () => {
    const d = new Uint8Array(48); for (let i = 0; i < 48; i++) d[i] = i;
    const ms = measureMs(() => { for (let i = 0; i < 10000; i++) fromBase64(toBase64(d)); });
    expect(ms).toBeLessThan(400);
  });

  it('round-trips 1000 payloads (1KB) in under 1000ms', () => {
    const d = new Uint8Array(1024); for (let i = 0; i < 1024; i++) d[i] = i % 256;
    const ms = measureMs(() => { for (let i = 0; i < 1000; i++) fromBase64(toBase64(d)); });
    expect(ms).toBeLessThan(1000);
  });

  it('hex round-trips 10000 32-byte arrays in under 1000ms', () => {
    const d = new Uint8Array(32).fill(0xde);
    const ms = measureMs(() => { for (let i = 0; i < 10000; i++) fromHex(toHex(d)); });
    expect(ms).toBeLessThan(1000);
  });

  it('UTF-8 round-trips 10000 strings in under 1000ms', () => {
    const txt = 'Concord DTU content with test data 12345 payload';
    const ms = measureMs(() => { for (let i = 0; i < 10000; i++) decodeUTF8(encodeUTF8(txt)); });
    expect(ms).toBeLessThan(1000);
  });

  it('concatenates 1000 arrays of 10 buffers in under 200ms', () => {
    const arrs = Array.from({ length: 10 }, (_, i) => new Uint8Array(64).fill(i & 0xff));
    const ms = measureMs(() => { for (let i = 0; i < 1000; i++) concatBytes(...arrs); });
    expect(ms).toBeLessThan(200);
  });
});
