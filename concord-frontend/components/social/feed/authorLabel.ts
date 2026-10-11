/** Display name and @handle. A raw user id is not a handle. */
export function authorLabel(
  userId: string,
  username?: string | null,
  displayName?: string | null,
): { name: string; handle: string | null } {
  const handle = username && username !== userId ? username : null;
  const named = displayName && displayName !== userId ? displayName : null;
  return { name: named || handle || 'Member', handle };
}
