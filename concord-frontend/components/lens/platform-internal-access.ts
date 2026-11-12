/**
 * Client mirror of the platform-internal lens gate
 * (server/lib/platform-internal-lens-gate.js).
 *
 * The `ops` and `system` lens domains are operator surfaces. Every action
 * in those domains is checked once, on the lens-run dispatch path, with
 * requireRole("owner", "admin", "sovereign", "founder")
 * (server/lib/role-gate.js). requireRole also passes a caller whose
 * scopes include "*" — the same fields GET /api/auth/me returns and this
 * mirror reads. Scopes narrower than "*" do not pass, and a role named
 * "operator" is not in the allow-list.
 *
 * AUTH_MODE=public is a server deploy flag, not a viewer role: in public
 * mode the server admits everyone and this mirror would over-gate, so
 * the pages keep their reactive 403 backstop for the reverse
 * disagreement (server refuses a viewer this mirror admitted).
 */

export const PLATFORM_INTERNAL_LENS_ROLES = [
  'owner',
  'admin',
  'sovereign',
  'founder',
] as const;

const ROLE_SET = new Set<string>(PLATFORM_INTERNAL_LENS_ROLES);

export function canViewPlatformInternalLens(
  user: { role?: string | null; scopes?: string[] | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (typeof user.role === 'string' && ROLE_SET.has(user.role)) return true;
  return Array.isArray(user.scopes) && user.scopes.includes('*');
}
