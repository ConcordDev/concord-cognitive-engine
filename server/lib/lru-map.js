// server/lib/lru-map.js
//
// LRU-bounded Map and Set. Drop-in replacements for `new Map()` /
// `new Set()` at module scope when the container's lifetime is the
// process lifetime (i.e. it would grow forever otherwise).
//
// Eviction is insertion-order LRU: when size > max, the oldest entry
// is dropped. This is the same policy as `Map`'s natural iteration
// order; we just enforce a ceiling.
//
// Tuning:
//   `new LruMap(50_000)` — explicit cap
//   `new LruMap()`       — default 100_000
//
// Env override (process-wide):
//   `CONCORD_LRU_DEFAULT_MAX=250000`
//
// Why this exists:
//   The repo had 115 module-level `new Map()` / `new Set()` instances
//   with no .delete()/.clear() callsite — slow memory leaks under
//   long-running uptime. Replacing each with `new LruMap()` gives a
//   real ceiling AND satisfies the unbounded-cache detector (which
//   anchors on the `new Map`/`new Set` literal token).

const DEFAULT_MAX = (() => {
  const env = Number(process.env.CONCORD_LRU_DEFAULT_MAX);
  if (Number.isFinite(env) && env > 0) return env;
  return 100_000;
})();

export class LruMap extends Map {
  constructor(maxSize = DEFAULT_MAX, iterable) {
    super(iterable || []);
    this.maxSize = maxSize;
  }
  set(key, value) {
    // Refresh insertion order on re-set so frequently-touched keys
    // survive eviction.
    if (super.has(key)) super.delete(key);
    super.set(key, value);
    while (this.size > this.maxSize) {
      const oldest = this.keys().next().value;
      super.delete(oldest);
    }
    return this;
  }
}

export class LruSet extends Set {
  constructor(maxSize = DEFAULT_MAX, iterable) {
    super(iterable || []);
    this.maxSize = maxSize;
  }
  add(value) {
    if (super.has(value)) super.delete(value);
    super.add(value);
    while (this.size > this.maxSize) {
      const oldest = this.values().next().value;
      super.delete(oldest);
    }
    return this;
  }
}

export default { LruMap, LruSet };
