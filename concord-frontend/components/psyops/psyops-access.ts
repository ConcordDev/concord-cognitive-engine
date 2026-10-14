/**
 * Client mirror of requireOperatorRole in server/domains/psyops.js
 * (and _psyopsRequireOperatorRole in server.js).
 *
 * Every psyops.* console macro returns
 * { ok:false, error:"Insufficient permissions: admin role required" }
 * unless ctx.actor.role is one of owner, admin, founder. makeCtx copies
 * that role from req.user.role — the same field GET /api/auth/me returns.
 * Scopes are not consulted. Role name "operator" is not in the allow-list.
 */

export const PSYOPS_OPERATOR_ROLES = ['owner', 'admin', 'founder'] as const;

const ROLE_SET = new Set<string>(PSYOPS_OPERATOR_ROLES);

export function isPsyopsOperator(role: string | undefined | null): boolean {
  return typeof role === 'string' && ROLE_SET.has(role);
}
