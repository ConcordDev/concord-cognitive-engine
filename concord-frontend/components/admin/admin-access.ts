/**
 * Client mirror of the role gate on GET /api/admin/dashboard,
 * /api/admin/metrics, and /api/admin/logs.
 *
 * Those routes (server/routes/domain.js, registered ahead of the shadowed
 * server.js /api/admin/logs handler) run the admin.dashboard / admin.metrics
 * / admin.logs macros. Each macro calls requireAdminRole (server.js): role
 * owner, admin, or founder. Scopes are not consulted — a member with
 * scope "*" or "admin" is still denied, and sovereign is not in the list
 * (unlike requireRole(), which lets sovereign through). A denial is mapped
 * to HTTP 403. AUTH_MODE=public is a server deploy flag, not a viewer role.
 */

const ADMIN_LENS_ROLES = new Set(['owner', 'admin', 'founder']);

export function canViewAdminLens(user: { role?: string | null } | null | undefined): boolean {
  return !!user?.role && ADMIN_LENS_ROLES.has(user.role);
}
