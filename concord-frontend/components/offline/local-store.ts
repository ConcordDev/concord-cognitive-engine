'use client';

/**
 * local-store — real IndexedDB write-through for the offline lens.
 *
 * This is the "Dexie-style" local persistence layer the spec asks for: the
 * offline lens writes documents here FIRST (so the write survives a reload
 * even with no network), then replicates them to the server via the
 * `offline.replicationPush` macro. On the way back, server changes pulled by
 * `offline.replicationPull` are merged into the same store.
 *
 * No external dependency — a thin promise wrapper over the raw IndexedDB API,
 * which is exactly what Dexie wraps. Two object stores:
 *   - `docs`     keyPath 'id'   — the replicated document set
 *   - `outbox`   keyPath 'id'   — local writes not yet pushed to the server
 */

export interface LocalDoc {
  id: string;
  body: Record<string, unknown>;
  rev: string | null;
  baseRev: string | null;
  updatedAt: string;
  dirty: boolean;
  deleted: boolean;
  /** The device that authored the current `rev` — null when unknown (e.g. a
   * local write not yet pushed, or a revision written before this field
   * existed). Multi-device conflict provenance: see `getDeviceId` below. */
  deviceId: string | null;
}

const DB_NAME = 'concord-offline-lens';
const DB_VERSION = 1;
const DOCS = 'docs';
const DEVICE_ID_KEY = 'concord-offline-device-id';

/**
 * Stable, per-browser device identifier for multi-device conflict
 * provenance (which device wrote which revision). Generated once and
 * persisted in `localStorage` — deliberately separate from
 * `ReplicationPanel`'s `checkpointIdFor`/`replicationId`, which identifies a
 * SYNC STREAM (the unfiltered feed vs. a saved filter's own incremental
 * checkpoint), not a physical device; conflating the two would corrupt the
 * just-shipped filtered-replication checkpoint isolation.
 *
 * Every `offline.replicationPush` / `offline.mergeResolve` call from this
 * browser stamps this id, so a later conflict — or any document pulled from
 * another device — can honestly show "written by device X".
 *
 * Best-effort: returns null (never a fabricated id) when `localStorage` is
 * unavailable (SSR, privacy mode, storage quota errors, etc.), so an absent
 * writer id stays honestly absent rather than invented.
 */
export function getDeviceId(): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    return null;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOCS)) {
        db.createObjectStore(DOCS, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(DOCS, mode);
        const req = fn(t.objectStore(DOCS));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Read every locally-persisted document. */
export async function allDocs(): Promise<LocalDoc[]> {
  try {
    const rows = await tx<LocalDoc[]>('readonly', (s) => s.getAll() as IDBRequest<LocalDoc[]>);
    return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch {
    return [];
  }
}

/** The subset of docs that have been written locally but not yet replicated. */
export async function dirtyDocs(): Promise<LocalDoc[]> {
  return (await allDocs()).filter((d) => d.dirty);
}

/** Write a doc locally — marks it dirty so the next push picks it up. */
export async function putDoc(id: string, body: Record<string, unknown>): Promise<LocalDoc> {
  const existing = await getDoc(id);
  const doc: LocalDoc = {
    id,
    body,
    rev: existing?.rev ?? null,
    baseRev: existing?.rev ?? null,
    updatedAt: new Date().toISOString(),
    dirty: true,
    deleted: false,
    // Not yet re-assigned to this device's writer id — that happens once the
    // push that carries this write actually lands (see markClean).
    deviceId: existing?.deviceId ?? null,
  };
  await tx('readwrite', (s) => s.put(doc));
  return doc;
}

export async function getDoc(id: string): Promise<LocalDoc | undefined> {
  try {
    return await tx<LocalDoc | undefined>('readonly', (s) => s.get(id) as IDBRequest<LocalDoc | undefined>);
  } catch {
    return undefined;
  }
}

/** Tombstone a doc locally — dirty + deleted so the push removes it server-side. */
export async function deleteDocLocal(id: string): Promise<void> {
  const existing = await getDoc(id);
  if (!existing) return;
  await tx('readwrite', (s) =>
    s.put({ ...existing, dirty: true, deleted: true, updatedAt: new Date().toISOString() }),
  );
}

/**
 * Mark a doc as successfully replicated — clears the dirty flag, stamps
 * server rev. `deviceId` (optional) is this browser's own device id — the
 * push that just landed was authored by us, so the local copy's writer id
 * is stamped to match what the server now has on record.
 */
export async function markClean(
  id: string,
  rev: string,
  deleted: boolean,
  deviceId: string | null = null,
): Promise<void> {
  if (deleted) {
    await tx('readwrite', (s) => s.delete(id));
    return;
  }
  const existing = await getDoc(id);
  if (!existing) return;
  await tx('readwrite', (s) =>
    s.put({ ...existing, rev, baseRev: rev, dirty: false, deviceId: deviceId ?? existing.deviceId ?? null }),
  );
}

/**
 * Merge a server change pulled from the changes feed into the local store.
 * `deviceId` (optional) is the ORIGIN device of this revision as reported by
 * `offline.replicationPull` — may be a different browser than this one.
 */
export async function applyServerChange(
  id: string,
  rev: string,
  body: Record<string, unknown> | null,
  deleted: boolean,
  deviceId: string | null = null,
): Promise<void> {
  if (deleted || body === null) {
    await tx('readwrite', (s) => s.delete(id));
    return;
  }
  const doc: LocalDoc = {
    id,
    body,
    rev,
    baseRev: rev,
    updatedAt: new Date().toISOString(),
    dirty: false,
    deleted: false,
    deviceId: deviceId ?? null,
  };
  await tx('readwrite', (s) => s.put(doc));
}

/** Wipe the whole local store. */
export async function clearLocal(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch {
    /* nothing to clear */
  }
}

/** Approximate byte footprint of the local store. */
export async function localBytes(): Promise<number> {
  const docs = await allDocs();
  return docs.reduce((sum, d) => sum + JSON.stringify(d.body).length, 0);
}
