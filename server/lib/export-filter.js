/**
 * Export read filter (HANDOFF-SEC-2 Fix 8b).
 *
 * Every export surface (GET /api/export/json|markdown, the
 * export.json/markdown/obsidian macros, and their REST wrappers)
 * historically returned EVERY DTU in STATE — including other users'
 * private DTUs and hidden system bookkeeping rows — to any caller.
 *
 * The rule: an export contains only DTUs the caller may read
 * (lib/dtu-read-access.js ctxMayReadDtu) that are not hidden system
 * rows (the server's _isHiddenSystemDtu predicate, injected because
 * it closes over the server's system-source set). Explicitly
 * requested ids that fail the filter are silently dropped — an
 * export must never leak that an unreadable DTU exists.
 *
 * Bulk exports (no explicit ids) additionally require a real
 * signed-in user: anonymous bulk export is a full-corpus scrape.
 * Internal callers (ctx.internal / actor.internal — backups,
 * agents-export) and a missing ctx (the server-internal CLI export
 * command, which never serves an HTTP caller) are unfiltered, and
 * AUTH_MODE=public (the solo notebook, where the anonymous user is
 * the owner) keeps working exactly as ctxMayReadDtu defines it.
 */
import { ctxMayReadDtu } from "./dtu-read-access.js";
import { resolveAuthMode } from "./dtu-ownership.js";

function isInternal(ctx) {
  return ctx == null || ctx?.internal === true || ctx?.actor?.internal === true;
}

function realUserId(ctx) {
  const id = ctx?.actor?.userId || ctx?.actor?.id || ctx?.actor?.odId || null;
  if (!id || id === "anon") return null;
  return String(id);
}

/**
 * The DTUs from `dtus` this caller may export. `isHiddenSystemDtu`
 * is the server's predicate; it is required so no surface can
 * forget the hidden-system half of the rule.
 */
export function exportableDtus(ctx, dtus, isHiddenSystemDtu) {
  if (!Array.isArray(dtus)) return [];
  if (isInternal(ctx)) return dtus.slice();
  return dtus.filter(
    (d) => d && ctxMayReadDtu(ctx, d) && !isHiddenSystemDtu(d),
  );
}

/**
 * null when a bulk (no-ids) export may proceed; a fresh 401 denial
 * for an anonymous bulk export in a secured auth mode.
 */
export function exportBulkDenial(ctx, hasExplicitIds) {
  if (hasExplicitIds) return null;
  if (isInternal(ctx)) return null;
  if (resolveAuthMode() === "public") return null;
  if (realUserId(ctx)) return null;
  return {
    ok: false,
    status: 401,
    code: "AUTH_REQUIRED",
    error: "sign in required",
  };
}
