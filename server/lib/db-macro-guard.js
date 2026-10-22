/**
 * db.query, db.migrate, and db.syncToPostgres run arbitrary SQL or rewrite
 * the Postgres copy of the catalog. runMacro skips its ACL for any signed-in
 * human request, and an anonymous HTTP call is only stopped in production
 * when AUTH_MODE is not public. This wraps the registered functions and
 * rejects the HTTP entry points before those handlers run.
 *
 * db.status stays open. Internal owner/system callers (makeInternalCtx)
 * still run migrations at boot.
 */

const GATED = new Set(["query", "migrate", "syncToPostgres"]);
const ADMIN_ROLES = new Set(["admin", "owner", "sovereign", "founder", "system"]);

export function actorMayRunDbMacro(ctx) {
  const actor = ctx?.actor && typeof ctx.actor === "object" ? ctx.actor : {};
  const role = String(actor.role || ctx?.role || "").toLowerCase();
  const scopes = Array.isArray(actor.scopes) ? actor.scopes : (Array.isArray(ctx?.scopes) ? ctx.scopes : []);
  const privileged = ADMIN_ROLES.has(role) || scopes.includes("*") || scopes.includes("admin") || scopes.includes("admin/*");
  if (actor.internal === true) {
    return role === "owner" || role === "system" || actor.userId === "system";
  }
  return privileged;
}

function deny(name) {
  return { ok: false, status: 403, error: `forbidden: ${name}`, code: "DB_MACRO_ADMIN" };
}

function wrapFn(label, orig, allow) {
  if (typeof orig !== "function" || orig.__dbMacroGuarded) return orig;
  const guarded = async (ctx, input) => {
    if (!allow(ctx, input)) return deny(label);
    return orig(ctx, input);
  };
  guarded.__dbMacroGuarded = true;
  return guarded;
}

export function installDbMacroGuards(macros) {
  const root = macros || globalThis._concordMACROS;
  if (!root || typeof root.get !== "function") return false;
  const db = root.get("db");
  if (db && typeof db.get === "function") {
    for (const name of GATED) {
      const entry = db.get(name);
      if (!entry || typeof entry.fn !== "function" || entry.fn.__dbMacroGuarded) continue;
      entry.fn = wrapFn(`db.${name}`, entry.fn, (ctx) => actorMayRunDbMacro(ctx));
    }
  }
  const jobs = root.get("jobs");
  const enqueue = jobs && typeof jobs.get === "function" ? jobs.get("enqueue") : null;
  if (enqueue && typeof enqueue.fn === "function" && !enqueue.fn.__dbMacroGuarded) {
    enqueue.fn = wrapFn("jobs.enqueue", enqueue.fn, (ctx, input) => {
      const kind = String(input?.kind || "");
      const [domain, name] = kind.split(".");
      if (domain === "db" && GATED.has(name)) return actorMayRunDbMacro(ctx);
      return true;
    });
  }
  return true;
}

function actorFromReq(req) {
  const user = req?.user;
  if (!user || typeof user !== "object") return null;
  return {
    userId: user.id || user.userId || null,
    role: user.role || null,
    scopes: user.scopes || [],
    internal: false,
  };
}

function gatedDbAction(domain, action) {
  return String(domain) === "db" && GATED.has(String(action));
}

export function dbMacroHttpGuard(req, res, next) {
  installDbMacroGuards(globalThis._concordMACROS);
  if (req.method !== "POST") return next();
  const url = String(req.originalUrl || req.url || "").split("?")[0];
  const body = req.body && typeof req.body === "object" ? req.body : {};
  let domain = body.domain;
  let action = body.action || body.name;
  const v1 = url.match(/^\/api\/v1\/lens\/([^/]+)\/([^/]+)\/?$/);
  if (v1) {
    domain = decodeURIComponent(v1[1]);
    action = decodeURIComponent(v1[2]);
  }
  const lensRun = url === "/api/lens/run" || url === "/api/macros/run";
  if (!lensRun && !v1) return next();
  const actor = { actor: actorFromReq(req) };
  if (gatedDbAction(domain, action) && !actorMayRunDbMacro(actor)) {
    const refused = deny(`db.${action}`);
    return res.status(403).json(refused);
  }
  if (String(domain) === "jobs" && String(action) === "enqueue") {
    const kind = String(body.kind || body.input?.kind || "");
    const [jobDomain, jobName] = kind.split(".");
    if (jobDomain === "db" && GATED.has(jobName) && !actorMayRunDbMacro(actor)) {
      const refused = deny(kind);
      return res.status(403).json(refused);
    }
  }
  return next();
}

setImmediate(() => {
  try { installDbMacroGuards(globalThis._concordMACROS); } catch { /* registry not up yet */ }
});
