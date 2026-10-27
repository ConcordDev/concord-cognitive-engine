/**
 * A DTU tagged quarantine:* (e.g. quarantine:injection-review) is never
 * public or listed to anyone but its user owner (and server-internal callers).
 */
export function isQuarantined(d) {
  const tags = d?.tags;
  return Array.isArray(tags) && tags.some((t) => typeof t === "string" && t.toLowerCase().startsWith("quarantine:"));
}
