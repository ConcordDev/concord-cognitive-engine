/**
 * Lens exhaust DTUs (title, tags, artifact id) are the caller's.
 * A missing or placeholder owner must not fan the payload out to every socket.
 */
const NOT_A_PERSON = new Set(["anon", "anonymous", "system", "founder"]);

export function lensExhaustEmitTarget(ownerId) {
  if (typeof ownerId !== "string") return null;
  const id = ownerId.trim();
  if (!id || NOT_A_PERSON.has(id)) return null;
  return { userId: id };
}
