/**
 * Client mirror of requireOperatorRole in server/domains/repair.js.
 *
 * Every repair.* macro (health_log, escalations, memory, resolve_escalation,
 * run_now) returns { ok:false, error:"admin_only" } unless ctx.actor.role is
 * one of admin, owner, sovereign, founder. makeCtx copies that role from
 * req.user.role — the same field GET /api/auth/me returns. Scopes are not
 * consulted: a member with scope "*" or "admin" is still denied, and a role
 * named "operator" is not in the allow-list. shapeLensRunHttp maps
 * admin_only to HTTP 400, so isForbidden() (403 / "forbidden") never sees it.
 */

export const REPAIR_OPERATOR_ROLES = ['admin', 'owner', 'sovereign', 'founder'] as const;

const ROLE_SET = new Set<string>(REPAIR_OPERATOR_ROLES);

export function canViewRepairTelemetry(
  user: { role?: string | null } | null | undefined,
): boolean {
  return typeof user?.role === 'string' && ROLE_SET.has(user.role);
}

/** True when a lensRun envelope is the repair macro's admin_only refusal. */
export function isRepairAdminDenied(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  return (payload as { error?: unknown }).error === 'admin_only';
}
