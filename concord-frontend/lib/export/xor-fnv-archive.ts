/**
 * Browser copy of server/lib/export-archive.js (concord-xor-fnv/v1).
 * Decrypt runs here so the downloaded envelope is the bytes that are
 * checked — the file is not posted back through a second request.
 * Keystream mixes JS code units, low 8 bits, the same way the server does.
 */

function fnvStep(h: number, code: number): number {
  const x = (h ^ code) >>> 0;
  return Math.imul(x, 0x01000193) >>> 0;
}

export function deriveKeyStream(password: string, salt: string, length: number): Uint8Array {
  const seed = `${password}::${salt}`;
  const ks = new Uint8Array(length);
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < seed.length; i++) h = fnvStep(h, seed.charCodeAt(i));
  for (let i = 0; i < length; i++) {
    h = fnvStep(h, i & 0xff);
    h ^= h >>> 13;
    ks[i] = h & 0xff;
  }
  return ks;
}

export function archiveChecksum(bytes: Uint8Array): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < bytes.length; i++) h = fnvStep(h, bytes[i]);
  return (h >>> 0).toString(16).padStart(8, '0');
}

function xor(bytes: Uint8Array, password: string, salt: string): Uint8Array {
  const ks = deriveKeyStream(password, salt, bytes.length);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i];
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface EncEnvelope {
  algorithm: string;
  salt: string;
  plainChecksum: string;
  ciphertextBase64: string;
}

/** The JSON file EncryptedArchive downloads. */
export function packEncEnvelope(fields: EncEnvelope): string {
  return JSON.stringify({
    algorithm: fields.algorithm,
    salt: fields.salt,
    plainChecksum: fields.plainChecksum,
    ciphertextBase64: fields.ciphertextBase64,
  });
}

/** What DecryptedArchive reads back out of that file. */
export function readEncEnvelope(text: string): EncEnvelope | null {
  let parsed: { salt?: unknown; plainChecksum?: unknown; ciphertextBase64?: unknown; algorithm?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed?.salt !== 'string' || !parsed.salt) return null;
  if (typeof parsed.ciphertextBase64 !== 'string' || !parsed.ciphertextBase64) return null;
  return {
    algorithm: typeof parsed.algorithm === 'string' ? parsed.algorithm : '',
    salt: parsed.salt,
    plainChecksum: typeof parsed.plainChecksum === 'string' ? parsed.plainChecksum : '',
    ciphertextBase64: parsed.ciphertextBase64,
  };
}

export function decryptEncEnvelope(password: string, envelope: EncEnvelope): { verified: boolean; plaintext: string; checksum: string } {
  const plain = xor(base64ToBytes(envelope.ciphertextBase64), password, envelope.salt);
  const checksum = archiveChecksum(plain);
  const verified = !envelope.plainChecksum || checksum === envelope.plainChecksum;
  return { verified, checksum, plaintext: new TextDecoder().decode(plain) };
}

export function encryptEncEnvelope(password: string, payload: string, salt: string): EncEnvelope {
  const plain = new TextEncoder().encode(payload);
  const cipher = xor(plain, password, salt);
  return {
    algorithm: 'concord-xor-fnv/v1',
    salt,
    plainChecksum: archiveChecksum(plain),
    ciphertextBase64: bytesToBase64(cipher),
  };
}
