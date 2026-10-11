// Topic labels for the social trending list.
//
// A DTU tag is sometimes a non-string (an object, or the coercion artifact
// "[object Object]" / "[object object]"). Counting that value and sending it
// to the client renders as that text. Only a real string label is a topic.
// An object contributes its own string name when it has one; otherwise it is
// omitted. Nothing here invents a label via String(object). The artifact is
// matched case-insensitively because writers store both casings.

import { isObjectCoercionTag, objectTagName } from "./dtu-tags.js";

export function topicLabel(tag) {
  if (typeof tag === "string") {
    const s = tag.trim();
    if (!s || isObjectCoercionTag(s)) return null;
    return s;
  }
  if (typeof tag === "number" && Number.isFinite(tag)) return String(tag);
  if (tag && typeof tag === "object") return objectTagName(tag);
  return null;
}

// tagLists: iterable of tag arrays (one per post/DTU). Non-arrays are skipped
// so a single bad `tags` object cannot throw the whole list.
export function aggregateTopicCounts(tagLists, limit = 20) {
  const tagCount = new Map();
  const lists = tagLists && typeof tagLists[Symbol.iterator] === "function" ? tagLists : [];
  for (const tags of lists) {
    if (!Array.isArray(tags)) continue;
    for (const t of tags) {
      const label = topicLabel(t);
      if (!label) continue;
      tagCount.set(label, (tagCount.get(label) || 0) + 1);
    }
  }
  const cap = Math.min(100, Math.max(1, limit || 20));
  return [...tagCount.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([tag, count]) => ({ tag, count }));
}
