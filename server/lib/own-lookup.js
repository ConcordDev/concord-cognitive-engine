/**
 * Lookups on plain objects inherit Object.prototype. A token such as
 * "constructor", "toString", or "__proto__" therefore resolves to a
 * function or the prototype object. Spreading or `for...of`-ing that
 * value throws "… is not iterable".
 *
 * Use a null-prototype dictionary, Object.hasOwn, and Array.isArray
 * before any spread or iteration. Missing keys and inherited properties
 * are misses, never inherited values.
 */

/** Copy own enumerable entries onto a dictionary with no prototype. */
export function nullDict(entries) {
  const m = Object.create(null);
  if (entries && typeof entries === "object") {
    for (const [k, v] of Object.entries(entries)) m[k] = v;
  }
  return m;
}

/**
 * Own value stored at key, or undefined.
 * Never returns an inherited Object.prototype property.
 */
export function ownValue(map, key) {
  if (map == null || (typeof key !== "string" && typeof key !== "number")) return undefined;
  if (!Object.hasOwn(map, key)) return undefined;
  return map[key];
}

/** Own array at key, or null. */
export function ownArray(map, key) {
  const v = ownValue(map, key);
  return Array.isArray(v) ? v : null;
}
