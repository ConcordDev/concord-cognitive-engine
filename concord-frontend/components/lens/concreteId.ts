/**
 * A host-supplied id is usable only when it names a real record.
 * Empty strings and the anonymous placeholder are not targets.
 * Ids that begin with the historical placeholder prefix are not targets.
 */

const PLACEHOLDER_PREFIX = 'target_';

export function isConcreteId(id: unknown): id is string {
  if (typeof id !== 'string') return false;
  const value = id.trim();
  if (!value || value === 'anonymous') return false;
  if (value.startsWith(PLACEHOLDER_PREFIX)) return false;
  return true;
}
