/** Platform roles that may pin, lock, and see the moderation queue. */
const FORUM_MOD_ROLES = new Set(['moderator', 'admin', 'owner', 'founder', 'sovereign']);

export function isForumModerator(role?: string | null): boolean {
  return !!role && FORUM_MOD_ROLES.has(role.toLowerCase());
}
