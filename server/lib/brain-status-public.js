/**
 * Viewer-scoped projection of getBrainStatus().
 *
 * Shared module name and exports with PR #1098
 * (cursor/settings-brain-honesty-26ad), which strips internal Ollama URLs
 * and still returns model names to anonymous callers (HTTP 200,
 * urlsRedacted). This copy is stricter, on purpose:
 *   - GET /api/brain/status: anonymous → 401 authentication_required
 *   - a signed-in member gets mode / onlineCount / enabled / role / stats
 *     with every URL, host, and model name removed
 *   - owner / admin / founder / sovereign still receive the raw object
 *
 * brainStatusForViewer() itself does not 401. Nested public payloads
 * (GET /api/system/health, GET /api/platform/status) keep their outer 200
 * and embed the reduced view. mountBrainStatusRoute() and
 * authenticatedBrainStatus() are the places that refuse an anonymous caller.
 *
 * If #1098 merges after this branch, keep THIS file's 401 and the model-name
 * strip. Take that PR's settings-lens UI. Do not restore anonymous 200 or
 * member-visible model names.
 */

export const BRAIN_STATUS_ADMIN_ROLES = new Set(["owner", "admin", "founder", "sovereign"]);

const URL_KEYS = new Set([
  "url", "urls", "host", "hostname", "endpoint", "endpoints", "baseUrl", "baseURL", "ollamaUrl",
]);
const MODEL_KEYS = new Set(["model", "modelName", "pipelineOllamaModel"]);

export function viewerCanSeeBrainUrls(user) {
  const role = viewerRole(user);
  return typeof role === "string" && BRAIN_STATUS_ADMIN_ROLES.has(role);
}

function viewerRole(user) {
  if (!user || typeof user !== "object") return null;
  if (typeof user.role === "string") return user.role;
  if (user.actor && typeof user.actor.role === "string") return user.actor.role;
  return null;
}

function viewerId(user) {
  if (!user || typeof user !== "object") return null;
  const id = user.id || user.userId || user.actor?.userId || user.actor?.id || null;
  if (!id || id === "anon") return null;
  return String(id);
}

function looksLikeInternalUrl(value) {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (/^(https?|cloudflare|ollama):\/\//i.test(s)) return true;
  if (/:1143\d\b/.test(s)) return true;
  if (/\bollama-(conscious|subconscious|utility|repair|vision)\b/i.test(s)) return true;
  return false;
}

function stripSensitive(value) {
  if (Array.isArray(value)) {
    return value.map(stripSensitive).filter((v) => v !== undefined);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (URL_KEYS.has(key) || MODEL_KEYS.has(key)) continue;
      const next = stripSensitive(child);
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
 * @returns {object} raw for an admin role, otherwise a copy with URLs and model names removed
 */
export function brainStatusForViewer(status, user) {
  if (!status || typeof status !== "object") return status;
  if (viewerCanSeeBrainUrls(user)) return status;
  return { ...stripSensitive(status), urlsRedacted: true, modelsRedacted: true };
}

/**
 * Macro wrapper. Anonymous actors get authentication_required and none of
 * the raw payload. Members get the reduced view. Admins get the raw view.
 */
export function authenticatedBrainStatus(raw, actor, extra) {
  if (!viewerId(actor)) return { ok: false, error: "authentication_required" };
  const view = brainStatusForViewer(raw && typeof raw === "object" ? raw : {}, actor);
  return { ok: true, ...view, ...(extra || {}) };
}

/**
 * Anonymous brain reads (status and the live health probe) must not reach
 * the payload. Returns a 401 body, or null when the caller is signed in.
 */
export function denyAnonymousBrainRead(req) {
  if (viewerId(req?.user)) return null;
  return { status: 401, body: { ok: false, error: "authentication_required" } };
}

/**
 * GET /api/brain/status. `getStatus` returns the raw payload. Anonymous
 * callers are refused. Everyone else receives brainStatusForViewer().
 */
export function mountBrainStatusRoute(app, getStatus) {
  app.get("/api/brain/status", (req, res) => {
    try {
      const denied = denyAnonymousBrainRead(req);
      if (denied) return res.status(denied.status).json(denied.body);
      const status = typeof getStatus === "function" ? getStatus() : {};
      res.json(brainStatusForViewer(status, req.user));
    } catch (e) {
      res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });
}
