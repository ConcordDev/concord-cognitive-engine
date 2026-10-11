/**
 * Member-facing view of getBrainStatus().
 *
 * The raw object carries internal Ollama URLs (docker hostnames, pod
 * addresses, Cloudflare vision endpoints). Those are operator diagnostics.
 * A signed-in member gets the same health, model, and role fields with
 * every URL removed. Admins (owner / admin / founder / sovereign) still
 * see the raw object.
 */

export const BRAIN_STATUS_ADMIN_ROLES = new Set(["owner", "admin", "founder", "sovereign"]);

const URL_KEYS = new Set(["url", "urls", "host", "endpoint", "endpoints", "baseUrl", "baseURL"]);

export function viewerCanSeeBrainUrls(user) {
  const role = user && (user.role || (user.actor && user.actor.role));
  return typeof role === "string" && BRAIN_STATUS_ADMIN_ROLES.has(role);
}

function looksLikeInternalUrl(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (/^(https?|cloudflare|ollama):\/\//i.test(s)) return true;
  if (/:1143\d\b/.test(s)) return true;
  if (/\bollama-(conscious|subconscious|utility|repair|vision)\b/i.test(s)) return true;
  return false;
}

function stripUrls(value) {
  if (Array.isArray(value)) {
    return value.map(stripUrls).filter((v) => v !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (URL_KEYS.has(key)) continue;
      const next = stripUrls(child);
      if (next !== undefined) out[key] = next;
    }
    return out;
  }
  if (looksLikeInternalUrl(value)) return undefined;
  return value;
}

/**
 * @param {object} status raw getBrainStatus() payload (plus llmReady)
 * @param {object|null|undefined} user req.user or ctx.actor
 */
export function brainStatusForViewer(status, user) {
  if (!status || typeof status !== "object") return status;
  if (viewerCanSeeBrainUrls(user)) return status;
  return { ...stripUrls(status), urlsRedacted: true };
}

/**
 * GET /api/brain/status. `getStatus` returns the raw payload; this route
 * is the only place that payload is allowed to leave the process, and it
 * leaves sanitized unless the caller is an admin.
 */
export function mountBrainStatusRoute(app, getStatus) {
  app.get("/api/brain/status", (req, res) => {
    try {
      const status = typeof getStatus === "function" ? getStatus() : {};
      res.json(brainStatusForViewer(status, req.user));
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
