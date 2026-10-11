/**
 * Trusted client IP for rate limits — INC-20261010-15.
 *
 * Production topology:
 *   Cloudflare → cloudflared (same host) → Next.js :3000 and/or Express.
 *   Browser login is same-origin, so Next's `/api/*` rewrite connects to
 *   Express from 127.0.0.1. Some other paths are dialed by cloudflared
 *   straight at Express; those also arrive from loopback, but with the
 *   visitor address in X-Forwarded-For / CF-Connecting-IP.
 *
 * Two defects collapsed every login into one bucket:
 *   1. `TRUST_PROXY=1` in the environment is the string "1". proxy-addr
 *      compiles that as the address 0.0.0.1 (ipaddr.js accepts "1"), not
 *      as hop-count 1. The socket is 127.0.0.1, which is not 0.0.0.1, so
 *      X-Forwarded-For is ignored and req.ip is the socket for every
 *      proxied request. Measured: string "1" → ip 127.0.0.1, ips [].
 *   2. A numeric hop count of 1 stops at the closest forwarded address.
 *      When a second local hop appends itself, X-Forwarded-For
 *      "client, 127.0.0.1" yields req.ip 127.0.0.1. Express never reads
 *      CF-Connecting-IP, so a rewrite that replaces X-Forwarded-For with
 *      the loopback peer still hides the visitor.
 *
 * Trust decision:
 *   Forwarded headers are client-spoofable. Honor them ONLY when the
 *   immediate TCP peer is loopback (127.0.0.0/8, ::1, or IPv4-mapped
 *   loopback) — cloudflared and Next.js on this host. A non-loopback
 *   peer's X-Forwarded-For and CF-Connecting-IP are ignored; the socket
 *   address is the client. That peer cannot evade or reset a bucket by
 *   presenting a fresh header, and cannot fill someone else's bucket.
 *
 *   When the peer is loopback, the visitor address is:
 *     1. CF-Connecting-IP, if it is a single non-loopback IP. Cloudflare
 *        overwrites this with the visitor; a client cannot prepend a
 *        spoof the way they can with X-Forwarded-For. A comma-separated
 *        list is rejected (ambiguous).
 *     2. Otherwise the rightmost non-loopback X-Forwarded-For hop — the
 *        address the nearest trusted proxy appended. Leftmost hops are
 *        attacker-controlled and are not used.
 *     3. Otherwise the real client is unknown. Callers keep one shared
 *        bucket (the loopback peer) and this module counts and, on auth
 *        paths, logs that fallback. It does not silently look global.
 *
 * `app.set('trust proxy', 'loopback')` is the same peer rule for
 * X-Forwarded-Proto / Host (secure cookies, redirects). It does not
 * read CF-Connecting-IP; the middleware below is what rate limits use.
 */

import net from "node:net";
import promClient from "prom-client";
import logger from "../logger.js";

const SHARED_BUCKET_METRIC = "concord_client_ip_shared_bucket_total";

const AUTH_LIMITED_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/refresh",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
]);

let sharedFallbackTotal = 0;

function sharedBucketCounter() {
  const existing = promClient.register.getSingleMetric(SHARED_BUCKET_METRIC);
  if (existing) return existing;
  return new promClient.Counter({
    name: SHARED_BUCKET_METRIC,
    help: "Requests from a loopback proxy whose real client IP was unknown, so per-IP rate limits used one shared bucket",
  });
}

/** @param {string} raw */
export function normalizeIp(raw) {
  if (raw == null) return "";
  let s = String(raw).trim();
  if (!s) return "";
  if (s.startsWith("[") && s.includes("]")) s = s.slice(1, s.indexOf("]"));
  const zone = s.indexOf("%");
  if (zone !== -1) s = s.slice(0, zone);
  s = s.toLowerCase();
  if (s.startsWith("::ffff:")) {
    const v4 = s.slice("::ffff:".length);
    if (net.isIP(v4) === 4) return v4;
  }
  return s;
}

/** @param {string} ip */
export function isLoopbackAddress(ip) {
  const s = normalizeIp(ip);
  if (s === "::1") return true;
  if (net.isIP(s) !== 4) return false;
  const n = Number(s.split(".")[0]);
  return n === 127;
}

function headerValue(header) {
  if (header == null) return "";
  if (Array.isArray(header)) return header.join(",");
  return String(header);
}

/**
 * Cloudflare's CF-Connecting-IP is one address. A list is not that header
 * (a client or a buggy hop glued values together); refuse it.
 * @param {string|string[]|undefined} header
 * @returns {string}
 */
function cfConnectingIp(header) {
  const raw = headerValue(header).trim();
  if (!raw || raw.includes(",")) return "";
  const ip = normalizeIp(raw);
  if (net.isIP(ip) === 0 || isLoopbackAddress(ip)) return "";
  return ip;
}

/** @param {string|string[]|undefined} header @returns {string[]} left → right */
function forwardedForHops(header) {
  const raw = headerValue(header);
  if (!raw) return [];
  return raw.split(",").map((part) => normalizeIp(part)).filter(Boolean);
}

function peerAddress(req) {
  return normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress || "");
}

/**
 * @param {import("express").Request} req
 * @returns {{ ip: string, source: "peer"|"cf-connecting-ip"|"x-forwarded-for"|"shared-loopback", shared: boolean }}
 */
export function resolveTrustedClientIp(req) {
  const peer = peerAddress(req);
  if (!isLoopbackAddress(peer)) {
    const ip = net.isIP(peer) ? peer : "0.0.0.0";
    return { ip, source: "peer", shared: !net.isIP(peer) };
  }
  const cf = cfConnectingIp(req.headers?.["cf-connecting-ip"]);
  if (cf) return { ip: cf, source: "cf-connecting-ip", shared: false };
  const hops = forwardedForHops(req.headers?.["x-forwarded-for"]);
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = hops[i];
    if (net.isIP(hop) === 0 || isLoopbackAddress(hop)) continue;
    return { ip: hop, source: "x-forwarded-for", shared: false };
  }
  return { ip: peer || "127.0.0.1", source: "shared-loopback", shared: true };
}

function requestPath(req) {
  const path = req.path || req.url || "";
  const q = path.indexOf("?");
  return q === -1 ? path : path.slice(0, q);
}

function noteSharedFallback(req, resolved) {
  sharedFallbackTotal += 1;
  try { sharedBucketCounter().inc(); } catch { /* metric must not block auth */ }
  if (!AUTH_LIMITED_PATHS.has(requestPath(req))) return;
  logger.warn("auth", "client_ip_shared_bucket", {
    path: requestPath(req),
    method: req.method,
    peer: peerAddress(req) || "unknown",
    source: resolved.source,
    sharedFallbackTotal,
  });
}

export function trustedClientIpMiddleware(req, _res, next) {
  const resolved = resolveTrustedClientIp(req);
  Object.defineProperty(req, "ip", {
    configurable: true,
    enumerable: true,
    value: resolved.ip,
  });
  if (resolved.shared) noteSharedFallback(req, resolved);
  next();
}

/**
 * Install loopback-only proxy trust and the client-IP middleware.
 * Call before any rate limiter or request logger so req.ip is already
 * the visitor address those layers key and log.
 * @param {import("express").Express} app
 */
export function installTrustedClientIp(app) {
  // 'loopback' is proxy-addr's 127.0.0.0/8 + ::1 range. Do not pass
  // process.env.TRUST_PROXY through: the string "1" is the 0.0.0.1 bug.
  app.set("trust proxy", "loopback");
  app.use(trustedClientIpMiddleware);
  return app;
}

/** In-process count of shared-bucket fallbacks. Tests read the delta. */
export function getSharedClientIpFallbackTotal() {
  return sharedFallbackTotal;
}
