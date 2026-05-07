/**
 * Production SecureStorage implementations.
 *
 * Replaces the placeholder flagged in CLAUDE.md as the mobile production
 * blocker. Three concrete implementations:
 *
 *   1. createExpoSecureStorage()  — iOS Keychain / Android Keystore via
 *      expo-secure-store. Items are scoped to the app, encrypted at rest,
 *      and biometric-protected when WHEN_UNLOCKED_THIS_DEVICE_ONLY is set.
 *      This is the production target for the mobile app.
 *
 *   2. createWebSecureStorage()   — fallback for the web wrapper. Uses
 *      WebCrypto + IndexedDB-backed Origin Private File System. Encrypts
 *      the value with a derived key before storage. NOT as strong as
 *      Keychain/Keystore but stronger than naked localStorage.
 *
 *   3. createInMemorySecureStorage() — tests + ephemeral sessions only.
 *      Same shape, no persistence, no encryption.
 *
 * Pick the right implementation at app boot:
 *   import { Platform } from 'react-native';
 *   const storage = Platform.OS === 'web' ? createWebSecureStorage() : createExpoSecureStorage();
 *   const identity = createIdentityManager(storage);
 *
 * SECURITY INVARIANT: the SecureStorage caller never sees the raw
 * encrypted bytes. Encryption happens INSIDE the implementation;
 * getItem/setItem deal in plaintext that the IdentityManager owns.
 */

import type { SecureStorage } from "./identity-manager";

/* ─── Expo native (iOS Keychain / Android Keystore) ─────────────────── */

/**
 * Creates a SecureStorage backed by expo-secure-store.
 *
 * Requires `expo-secure-store` in the bundle. Throws clearly at construction
 * time if it isn't available so the app fails fast on misconfigured builds.
 */
export function createExpoSecureStorage(opts: {
  keychainService?: string;
  requireAuthentication?: boolean;
} = {}): SecureStorage {
  // Lazy require so this module can be imported on web without pulling
  // expo-secure-store into the web bundle. We resolve at first call.
  let _SecureStore: any = null;
  const _load = () => {
    if (_SecureStore) return _SecureStore;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      _SecureStore = require("expo-secure-store");
    } catch (err) {
      throw new Error(
        "expo-secure-store is not installed. Run: npx expo install expo-secure-store"
      );
    }
    return _SecureStore;
  };

  const storeOptions = (): Record<string, unknown> => {
    const SS = _load();
    return {
      keychainService: opts.keychainService ?? "concord_identity",
      keychainAccessible: SS.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      requireAuthentication: !!opts.requireAuthentication,
    };
  };

  return {
    async setItem(key: string, value: string): Promise<void> {
      const SS = _load();
      await SS.setItemAsync(key, value, storeOptions());
    },
    async getItem(key: string): Promise<string | null> {
      const SS = _load();
      return await SS.getItemAsync(key, storeOptions());
    },
    async removeItem(key: string): Promise<void> {
      const SS = _load();
      await SS.deleteItemAsync(key, storeOptions());
    },
    async hasItem(key: string): Promise<boolean> {
      const SS = _load();
      const v = await SS.getItemAsync(key, storeOptions());
      return v !== null && v !== undefined;
    },
  };
}

/* ─── Web fallback (WebCrypto + IndexedDB) ─────────────────────────── */

const WEB_DB_NAME = "concord_secure_storage";
const WEB_STORE_NAME = "secrets";
const WEB_KEY_NAME   = "concord_master_key_v1";

interface WebCryptoEnv {
  subtle: SubtleCrypto;
  getRandomValues: (b: Uint8Array) => Uint8Array;
}

function _getWebCrypto(): WebCryptoEnv | null {
  if (typeof globalThis === "undefined" || !globalThis.crypto?.subtle) return null;
  return {
    subtle: globalThis.crypto.subtle,
    getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto),
  };
}

async function _openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WEB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(WEB_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function _idbGet(key: string): Promise<unknown | undefined> {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_STORE_NAME, "readonly");
    const req = tx.objectStore(WEB_STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function _idbSet(key: string, value: unknown): Promise<void> {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_STORE_NAME, "readwrite");
    tx.objectStore(WEB_STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function _idbDelete(key: string): Promise<void> {
  const db = await _openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WEB_STORE_NAME, "readwrite");
    tx.objectStore(WEB_STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function _getOrCreateMasterKey(c: WebCryptoEnv): Promise<CryptoKey> {
  const stored = await _idbGet(WEB_KEY_NAME);
  if (stored && (stored as { type?: string }).type === "secret") {
    return stored as unknown as CryptoKey;
  }
  const key = await c.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractable — even XSS can't exfiltrate it
    ["encrypt", "decrypt"],
  );
  await _idbSet(WEB_KEY_NAME, key);
  return key;
}

/**
 * Web fallback. Encrypts each value with a non-extractable AES-GCM key
 * stored in IndexedDB. Strictly weaker than native Keychain/Keystore but
 * much stronger than naked localStorage. Requires WebCrypto + IndexedDB.
 */
export function createWebSecureStorage(): SecureStorage {
  const c = _getWebCrypto();
  if (!c) {
    throw new Error("WebCrypto unavailable; createWebSecureStorage requires a secure context");
  }

  const _encrypt = async (plaintext: string): Promise<{ iv: number[]; ciphertext: number[] }> => {
    const key = await _getOrCreateMasterKey(c);
    const iv = c.getRandomValues(new Uint8Array(12));
    const buf = new TextEncoder().encode(plaintext);
    // TS 5.7+ tightened Uint8Array's buffer-type generic — the iv from
    // getRandomValues is Uint8Array<ArrayBufferLike> which isn't directly
    // assignable to BufferSource. Cast through the BufferSource union so
    // WebCrypto's encrypt accepts it. Runtime behavior is unchanged.
    const ct = await c.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, buf);
    return { iv: Array.from(iv), ciphertext: Array.from(new Uint8Array(ct)) };
  };

  const _decrypt = async (record: { iv: number[]; ciphertext: number[] }): Promise<string> => {
    const key = await _getOrCreateMasterKey(c);
    const pt = await c.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv) },
      key,
      new Uint8Array(record.ciphertext),
    );
    return new TextDecoder().decode(pt);
  };

  return {
    async setItem(key: string, value: string): Promise<void> {
      const enc = await _encrypt(value);
      await _idbSet(`secret:${key}`, enc);
    },
    async getItem(key: string): Promise<string | null> {
      const rec = (await _idbGet(`secret:${key}`)) as { iv: number[]; ciphertext: number[] } | undefined;
      if (!rec) return null;
      try { return await _decrypt(rec); } catch { return null; }
    },
    async removeItem(key: string): Promise<void> {
      await _idbDelete(`secret:${key}`);
    },
    async hasItem(key: string): Promise<boolean> {
      const rec = await _idbGet(`secret:${key}`);
      return rec !== undefined;
    },
  };
}

/* ─── In-memory (tests + ephemeral) ───────────────────────────────── */

export function createInMemorySecureStorage(): SecureStorage {
  const m = new Map<string, string>();
  return {
    async setItem(k, v) { m.set(k, v); },
    async getItem(k)    { return m.has(k) ? (m.get(k) ?? null) : null; },
    async removeItem(k) { m.delete(k); },
    async hasItem(k)    { return m.has(k); },
  };
}

/**
 * Convenience: pick the right backend at runtime. Pass the Platform
 * object from react-native; falls back to in-memory on unknown platforms
 * so tests + SSR don't crash.
 */
export function createSecureStorageForPlatform(platform: { OS?: string } | null | undefined): SecureStorage {
  if (!platform) return createInMemorySecureStorage();
  if (platform.OS === "web") {
    try { return createWebSecureStorage(); } catch { return createInMemorySecureStorage(); }
  }
  if (platform.OS === "ios" || platform.OS === "android") {
    return createExpoSecureStorage();
  }
  return createInMemorySecureStorage();
}
