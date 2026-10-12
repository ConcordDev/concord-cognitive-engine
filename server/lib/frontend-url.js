// Shared public origin for signing links, OAuth redirects, CDN CORS, and
// Stripe return URLs.
//
// INC-67: a production deploy copied FRONTEND_URL=https://yourdomain.com from
// the env template. Every signing link was then minted on that host, which
// would hand the unguessable token to whoever owns the placeholder domain.
// Placeholder hosts are invalid. Callers fall back to the canonical origin
// (or, for OAuth/CDN, keep their existing "unset in production" failure).

export const CANONICAL_FRONTEND_URL = "https://concord-os.org";
export const DEV_FRONTEND_URL = "http://localhost:3000";

const PRIMARY_ENV = ["FRONTEND_URL", "NEXT_PUBLIC_FRONTEND_URL", "CONCORD_FRONTEND_URL"];

const NAMED_PLACEHOLDER_HOSTS = new Set([
  "yourdomain.com",
  "example.com",
  "example.org",
  "example.net",
]);

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
]);

let loggerFn = null;
let warnedKey = "";

export function setFrontendUrlLogger(fn) {
  loggerFn = typeof fn === "function" ? fn : null;
}

export function _resetFrontendUrlWarningForTest() {
  warnedKey = "";
}

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function bareHost(hostname) {
  let host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.startsWith("www.")) host = host.slice(4);
  return host;
}

export function isPlaceholderFrontendHost(hostname, production = isProduction()) {
  const host = bareHost(hostname);
  if (!host) return true;
  if (NAMED_PLACEHOLDER_HOSTS.has(host)) return true;
  if (production && LOOPBACK_HOSTS.has(host)) return true;
  return false;
}

function inspectCandidate(raw) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "unparseable", value: trimmed.slice(0, 200) };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "unparseable", value: trimmed.slice(0, 200) };
  }
  const base = trimmed.replace(/\/+$/, "");
  if (isPlaceholderFrontendHost(parsed.hostname)) {
    return {
      ok: false,
      reason: "placeholder_host",
      host: bareHost(parsed.hostname),
      value: base.slice(0, 200),
    };
  }
  return { ok: true, base, host: bareHost(parsed.hostname) };
}

function warnPlaceholder(rejected, logger) {
  const key = rejected.map((r) => `${r.name}:${r.reason}:${r.value}`).join("|");
  if (warnedKey === key) return;
  warnedKey = key;
  const data = {
    rejected,
    fallback: CANONICAL_FRONTEND_URL,
    message: "FRONTEND_URL, NEXT_PUBLIC_FRONTEND_URL, or CONCORD_FRONTEND_URL is a known placeholder (yourdomain.com, example.com, example.org, example.net, or localhost in production). Refusing it so signing links and redirects are not sent to a template or third-party host.",
  };
  const log = typeof logger === "function" ? logger : loggerFn;
  if (typeof log === "function") {
    try {
      log("error", "frontend_url_placeholder", data);
      return;
    } catch { /* a broken logger must not block boot */ }
  }
  console.error(`[error] frontend_url_placeholder ${JSON.stringify(data)}`);
}

/**
 * Resolve the public frontend origin.
 *
 * Candidates, in order: FRONTEND_URL, NEXT_PUBLIC_FRONTEND_URL,
 * CONCORD_FRONTEND_URL, then any extraEnv names. A placeholder host is
 * skipped. localhost / 127.0.0.1 / ::1 count as placeholders only when
 * NODE_ENV is production.
 *
 * mode "public" (signing links, Stripe): always returns an origin. Invalid
 * or missing configuration falls back to https://concord-os.org.
 * mode "app" (OAuth, CDN): nothing set in dev returns http://localhost:3000;
 * nothing set in production returns null so the caller can still fail closed.
 * A placeholder still falls back to the canonical origin in either mode, and
 * logs one structured error per distinct bad configuration.
 *
 * @param {{ mode?: "public"|"app", extraEnv?: string[], logger?: Function }} [opts]
 * @returns {string|null}
 */
export function resolveFrontendUrl(opts = {}) {
  const mode = opts.mode === "app" ? "app" : "public";
  const names = PRIMARY_ENV.concat(Array.isArray(opts.extraEnv) ? opts.extraEnv : []);
  const rejected = [];
  for (const name of names) {
    const raw = process.env[name];
    if (raw == null || String(raw).trim() === "") continue;
    const inspected = inspectCandidate(raw);
    if (!inspected) continue;
    if (!inspected.ok) {
      rejected.push({
        name,
        reason: inspected.reason,
        host: inspected.host || null,
        value: inspected.value,
      });
      continue;
    }
    if (rejected.length) warnPlaceholder(rejected, opts.logger);
    return inspected.base;
  }
  if (rejected.length) {
    warnPlaceholder(rejected, opts.logger);
    return CANONICAL_FRONTEND_URL;
  }
  if (mode === "app" && !isProduction()) return DEV_FRONTEND_URL;
  if (mode === "app") return null;
  return CANONICAL_FRONTEND_URL;
}
