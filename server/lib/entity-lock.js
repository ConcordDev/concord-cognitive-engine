// server/lib/entity-lock.js
//
// Adversarial-hardening: a tiny in-process per-key async mutex.
//
// better-sqlite3 is synchronous, so a single synchronous read-modify-write can
// never interleave. The TOCTOU window opens the moment an `await` lands BETWEEN
// the read and the write (e.g. an `await import(...)` in the middle of a gather
// handler, or two HTTP requests each doing SELECT → await → INSERT). Two
// concurrent requests on the SAME entity can then both observe the pre-write
// state and both commit — a double-spend / duplicate-row / double-extract.
//
// `withEntityLock(key, fn)` serializes async fns that share a key. Same key →
// they run strictly one-after-another (the second awaits the first). Different
// keys → fully parallel. The lock is a per-key promise chain held in a Map;
// the entry is deleted once the chain drains, so the Map can't grow unbounded.
//
// Default mode is QUEUE (await your turn) — correct for craft / trade / gather
// where the caller wants the operation to actually happen, just not
// concurrently. A `{ mode: 'reject' }` option fast-rejects with a `busy` error
// instead, for callers that prefer to bounce a contended request.
//
// Never deadlocks: a key is only ever held for the duration of one fn, and the
// chain advances on settle (resolve OR reject) via finally.

const _chains = new Map(); // key -> Promise (tail of the per-key queue)

class EntityBusyError extends Error {
  constructor(key) {
    super(`entity_busy:${key}`);
    this.name = "EntityBusyError";
    this.code = "busy";
    this.key = key;
  }
}

/**
 * Run `fn` while holding an exclusive lock on `key`. Concurrent calls on the
 * same key serialize; different keys run in parallel.
 *
 * @template T
 * @param {string} key   lock identity, e.g. `item:<id>`, `node:<id>`, `trade:<id>`
 * @param {() => (T | Promise<T>)} fn  the read-modify-write to serialize
 * @param {object} [opts]
 * @param {'queue'|'reject'} [opts.mode='queue']  queue (await) or fast-reject when held
 * @returns {Promise<T>}
 */
export function withEntityLock(key, fn, opts = {}) {
  const k = String(key);
  const mode = opts.mode === "reject" ? "reject" : "queue";

  const held = _chains.has(k);
  if (held && mode === "reject") {
    return Promise.reject(new EntityBusyError(k));
  }

  // Previous tail (resolved when the prior holder fully settles + releases). If
  // nothing is queued, start from an already-resolved promise.
  const prev = _chains.get(k) || Promise.resolve();

  // Our turn: wait for the prior holder, then run fn. We swallow the prior
  // holder's outcome so a rejection upstream doesn't poison our run.
  const run = prev.then(
    () => fn(),
    () => fn(),
  );

  // The new tail resolves when OUR fn settles (success or failure) AND the lock
  // is released, so the next waiter chains after us. We deliberately do NOT
  // propagate fn's rejection into the tail (the `.then(noop,noop)`) — the tail
  // is a pure "is the lock free yet" signal, never an error channel.
  const tail = run.then(noop, noop).finally(() => {
    // Only clear if we're still the tail — a later waiter may have replaced it.
    if (_chains.get(k) === tail) _chains.delete(k);
  });
  _chains.set(k, tail);

  // Return a promise that mirrors fn's result/rejection but only settles AFTER
  // the lock has been released (tail drained). This makes the contract clean:
  // when a caller's `await withEntityLock(...)` returns, the key is free again,
  // so a follow-up reject-mode probe won't see stale "busy" state.
  return tail.then(() => run);
}

function noop() {}

/** Test/diagnostic helper: number of keys with a live lock chain. */
export function _lockCount() {
  return _chains.size;
}

/** Test helper: is a given key currently locked? */
export function _isLocked(key) {
  return _chains.has(String(key));
}

export { EntityBusyError };
