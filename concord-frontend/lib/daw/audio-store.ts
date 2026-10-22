/**
 * Durable audio storage for Studio takes and imported samples.
 *
 * Project snapshots saved to the server are JSON and deliberately carry no
 * PCM. The audio itself lives here, in IndexedDB on this device, keyed by
 * the clip's `audioBufferId`, so recordings survive reloads and reopen with
 * the project. Float32 channel data is stored as-is (lossless).
 */

const DB_NAME = 'concord-studio-audio';
const DB_VERSION = 1;
const STORE = 'buffers';

export interface StoredAudio {
  id: string;
  projectId: string;
  name: string;
  sampleRate: number;
  channelData: Float32Array[];
  createdAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function idb(factory?: IDBFactory): IDBFactory | null {
  if (factory) return factory;
  if (typeof indexedDB === 'undefined') return null;
  return indexedDB;
}

function open(factory?: IDBFactory): Promise<IDBDatabase> {
  if (dbPromise && !factory) return dbPromise;
  const f = idb(factory);
  if (!f) return Promise.reject(new Error('IndexedDB unavailable'));
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    const req = f.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  if (!factory) dbPromise = p.catch((e) => { dbPromise = null; throw e; });
  return p;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, factory?: IDBFactory): Promise<T> {
  return open(factory).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
      }),
  );
}

export function putAudio(a: StoredAudio, factory?: IDBFactory): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.put(a), factory);
}

export function getAudio(id: string, factory?: IDBFactory): Promise<StoredAudio | undefined> {
  return tx<StoredAudio | undefined>('readonly', (s) => s.get(id) as IDBRequest<StoredAudio | undefined>, factory);
}

export function deleteAudio(id: string, factory?: IDBFactory): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(id) as IDBRequest<undefined>, factory);
}

/** Ask the browser not to evict our audio under storage pressure (best effort). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* unsupported */ }
  return false;
}
