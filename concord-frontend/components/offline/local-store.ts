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
}

const DB_NAME = 'concord-offline-lens';
const DB_VERSION = 1;
const DOCS = 'docs';

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

/** Mark a doc as successfully replicated — clears the dirty flag, stamps server rev. */
export async function markClean(id: string, rev: string, deleted: boolean): Promise<void> {
  if (deleted) {
    await tx('readwrite', (s) => s.delete(id));
    return;
  }
  const existing = await getDoc(id);
  if (!existing) return;
  await tx('readwrite', (s) => s.put({ ...existing, rev, baseRev: rev, dirty: false }));
}

/** Merge a server change pulled from the changes feed into the local store. */
export async function applyServerChange(
  id: string,
  rev: string,
  body: Record<string, unknown> | null,
  deleted: boolean,
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
