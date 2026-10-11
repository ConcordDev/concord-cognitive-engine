// DTU tag coercion.
//
// String(someObject) is the literal "[object Object]". A writer that then
// calls toLowerCase() stores "[object object]" on the DTU. That string is
// not a topic. An object contributes its own string name (tag, name,
// label, …) when it has one. Otherwise it is dropped. Nothing here calls
// String() on an object.

const LABEL_KEYS = ["tag", "topic", "name", "label", "text", "value"];

export function isObjectCoercionTag(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "[object object]";
}

/** Own string name of a tag object, or null when it has none. */
export function objectTagName(tag) {
  if (!tag || typeof tag !== "object") return null;
  for (const key of LABEL_KEYS) {
    const v = tag[key];
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (s && !isObjectCoercionTag(s)) return s;
  }
  return null;
}

/**
 * Map a tag list through `normalize`, which receives either the original
 * non-object value or the object's own string name. Object values are
 * never passed to `normalize` as objects, so String(object) cannot run.
 * The coercion artifact is omitted in any letter case.
 */
export function normalizeTagList(tags, normalize) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    let value = t;
    if (t && typeof t === "object") {
      const name = objectTagName(t);
      if (!name) continue;
      value = name;
    } else if (typeof t === "string" && isObjectCoercionTag(t)) {
      continue;
    }
    const mapped = normalize(value);
    if (typeof mapped !== "string") continue;
    if (!mapped || isObjectCoercionTag(mapped)) continue;
    out.push(mapped);
  }
  return out;
}

/**
 * Upsert sanitizer: lowercase string tags, keep an object's own name,
 * drop everything else (including the coercion artifact).
 */
export function sanitizeDtuTags(tags) {
  if (!Array.isArray(tags)) return [];
  const mapped = normalizeTagList(tags, (t) => {
    if (typeof t !== "string") return "";
    return t.toLowerCase().trim().replace(/[<>"'`]/g, "");
  });
  return [...new Set(mapped.filter((t) => t.length > 0 && t.length <= 100))];
}

/**
 * Drop the coercion artifact and replace object tags with their name.
 * Every other entry is left unchanged (no lowercasing, no trimming).
 * Returns the same array when nothing changed.
 */
export function scrubStoredTags(tags) {
  if (!Array.isArray(tags)) return tags;
  let changed = false;
  const next = [];
  for (const t of tags) {
    if (t && typeof t === "object") {
      changed = true;
      const name = objectTagName(t);
      if (name) next.push(name);
      continue;
    }
    if (typeof t === "string" && isObjectCoercionTag(t)) {
      changed = true;
      continue;
    }
    next.push(t);
  }
  return changed ? next : tags;
}
