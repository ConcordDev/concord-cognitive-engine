/**
 * Browser-held X25519 keys for the Anonymous lens.
 *
 * Enabled only when NEXT_PUBLIC_CONCORD_ANON_CLIENT_E2E=1. The matching server
 * flag is CONCORD_ANON_CLIENT_E2E=1. The private key is written to localStorage
 * and is never placed on a request. Existing server-held identities are left
 * alone: identity registration sends a public key, and if the server returns
 * a different server-held key the caller keeps using the plaintext path.
 */

const STORAGE_KEY = "concord.anon.clientE2E.v1";

export interface ClientKeyMaterial {
  publicKeySpkiB64: string;
  privateKeyPkcs8B64: string;
}

export interface SealedEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
}

export function isAnonClientE2EFlagOn(): boolean {
  return process.env.NEXT_PUBLIC_CONCORD_ANON_CLIENT_E2E === "1";
}

function bufToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new ArrayBuffer(bin.length);
  const view = new Uint8Array(out);
  for (let i = 0; i < bin.length; i++) view[i] = bin.charCodeAt(i);
  return out;
}

export async function createClientKeyPair(): Promise<ClientKeyMaterial> {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKeySpkiB64 = bufToB64(new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey)));
  const privateKeyPkcs8B64 = bufToB64(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)));
  return { publicKeySpkiB64, privateKeyPkcs8B64 };
}

export function readStoredClientKey(): ClientKeyMaterial | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientKeyMaterial>;
    if (!parsed.publicKeySpkiB64 || !parsed.privateKeyPkcs8B64) return null;
    return {
      publicKeySpkiB64: parsed.publicKeySpkiB64,
      privateKeyPkcs8B64: parsed.privateKeyPkcs8B64,
    };
  } catch {
    return null;
  }
}

export function writeStoredClientKey(key: ClientKeyMaterial): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(key));
}

export async function loadOrCreateClientKey(): Promise<ClientKeyMaterial> {
  const existing = readStoredClientKey();
  if (existing) return existing;
  const fresh = await createClientKeyPair();
  writeStoredClientKey(fresh);
  return fresh;
}

/** Identity registration body. The private key is not a field. */
export function buildIdentityParams(
  flagOn: boolean,
  key: ClientKeyMaterial | null,
): Record<string, unknown> {
  if (flagOn && key) return { publicKey: key.publicKeySpkiB64 };
  return {};
}

export function buildAnonSendPayload(args: {
  clientHeld: boolean;
  conversationId: string;
  draft: string;
  sealedSender: boolean;
  ephemeralSec?: number | null;
  envelopes?: Record<string, SealedEnvelope> | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    conversationId: args.conversationId,
    sealedSender: args.sealedSender,
  };
  if (args.ephemeralSec != null) payload.ephemeralSec = args.ephemeralSec;
  if (args.clientHeld) {
    if (!args.envelopes) throw new Error("envelopes required");
    payload.envelopes = args.envelopes;
    return payload;
  }
  payload.content = args.draft.trim();
  return payload;
}

async function importPrivate(pkcs8B64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    b64ToBuf(pkcs8B64),
    { name: "X25519" },
    false,
    ["deriveBits"],
  );
}

async function importPublic(spkiB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    b64ToBuf(spkiB64),
    { name: "X25519" },
    false,
    [],
  );
}

async function aesKeyFromShared(shared: ArrayBuffer): Promise<CryptoKey> {
  const aesRaw = await crypto.subtle.digest("SHA-256", shared);
  return crypto.subtle.importKey("raw", aesRaw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function sealEnvelopes(
  myPrivatePkcs8B64: string,
  members: { anonId: string; publicKey: string }[],
  plaintext: string,
): Promise<Record<string, SealedEnvelope>> {
  const myPriv = await importPrivate(myPrivatePkcs8B64);
  const encoded = new TextEncoder().encode(plaintext);
  const out: Record<string, SealedEnvelope> = {};
  for (const member of members) {
    if (!member.publicKey) throw new Error("missing publicKey");
    const peerPub = await importPublic(member.publicKey);
    const shared = await crypto.subtle.deriveBits(
      { name: "X25519", public: peerPub },
      myPriv,
      256,
    );
    const aesKey = await aesKeyFromShared(shared);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const combined = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, aesKey, encoded),
    );
    const tag = combined.slice(combined.length - 16);
    const ct = combined.slice(0, combined.length - 16);
    out[member.anonId] = {
      ciphertext: bufToB64(ct),
      iv: bufToB64(iv),
      tag: bufToB64(tag),
    };
  }
  return out;
}

export async function openSealed(
  myPrivatePkcs8B64: string,
  senderPublicKeySpkiB64: string,
  env: SealedEnvelope,
): Promise<string> {
  const myPriv = await importPrivate(myPrivatePkcs8B64);
  const senderPub = await importPublic(senderPublicKeySpkiB64);
  const shared = await crypto.subtle.deriveBits(
    { name: "X25519", public: senderPub },
    myPriv,
    256,
  );
  const aesKey = await aesKeyFromShared(shared);
  const iv = new Uint8Array(b64ToBuf(env.iv));
  const ct = new Uint8Array(b64ToBuf(env.ciphertext));
  const tag = new Uint8Array(b64ToBuf(env.tag));
  if (iv.byteLength !== 12 || tag.byteLength !== 16 || ct.byteLength === 0) {
    throw new Error("malformed envelope");
  }
  const combined = new Uint8Array(ct.byteLength + tag.byteLength);
  combined.set(ct, 0);
  combined.set(tag, ct.byteLength);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    aesKey,
    combined,
  );
  return new TextDecoder().decode(plain);
}

/** Same grouping as server/domains/anon.js safetyNumber, computed locally. */
export async function safetyNumberGroups(pubA: string, pubB: string): Promise<string[]> {
  const sorted = [pubA, pubB].sort().join("|");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted)));
  const view = new DataView(digest.buffer, digest.byteOffset, digest.byteLength);
  const groups: string[] = [];
  for (let i = 0; i < 12; i++) {
    const chunk = view.getUint32((i * 2) % 28, false);
    groups.push(String(chunk % 100000).padStart(5, "0"));
  }
  return groups;
}
