/**
 * Concord SSRF Guard
 *
 * Single source of truth for "is this URL safe to fetch server-side?"
 *
 * Protects against:
 *   • Private/reserved IPv4 ranges (RFC1918, loopback, link-local, CGNAT,
 *     multicast, benchmark, broadcast).
 *   • IPv4 in non-dotted forms (decimal, octal, hex, shorthand like
 *     `http://2130706433/` = `127.0.0.1`) — we normalize via dns.lookup.
 *   • IPv4-mapped IPv6 addresses (`::ffff:10.0.0.1`, `::ffff:127.0.0.1`).
 *   • IPv6 loopback, link-local, unique-local, and multicast.
 *   • Cloud metadata service endpoints (AWS/Azure/GCP IMDS).
 *   • Non-http(s) schemes (file://, gopher://, data://, javascript:, etc.).
 *   • DNS rebinding — after validation, we resolve the hostname again
 *     immediately before returning. A subsequent HTTP client still
 *     performs its own DNS lookup, so to make this airtight callers
 *     should use the `fetchWithPinnedIp` helper below, which connects
 *     to the validated IP with the `Host:` header set to the original
 *     hostname.
 *
 * Usage:
 *   import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";
 *
 *   const check = await validateSafeFetchUrl(userUrl);
 *   if (!check.ok) throw new Error(check.error);
 *
 *   // Safe: pinned fetch guarantees the TCP connection lands on the
 *   // IP we validated, eliminating DNS rebinding.
 *   const res = await fetchWithPinnedIp(check);
 */

import dns from "node:dns/promises";
import net from "node:net";
import logger from "../logger.js";

// ── Scheme allowlist ────────────────────────────────────────────────────────
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// ── Reserved IPv4 ranges (stored as [startInt, endInt]) ─────────────────────
// Each entry is [cidrStart, cidrEnd] where cidrStart/end are 32-bit integers.
function ipv4ToInt(a, b, c, d) {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}
function cidrToRange(cidr) {
  const [base, bitsStr] = cidr.split("/");
  const [a, b, c, d] = base.split(".").map(Number);
  const start = ipv4ToInt(a, b, c, d);
  const bits = parseInt(bitsStr, 10);
  const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1)) >>> 0;
  const networkStart = (start & mask) >>> 0;
  const size = Math.pow(2, 32 - bits) - 1;
  const networkEnd = (networkStart + size) >>> 0;
  return [networkStart, networkEnd];
}

const PRIVATE_IPV4_RANGES = [
  "0.0.0.0/8",          // "this network"
  "10.0.0.0/8",         // RFC1918
  "100.64.0.0/10",      // CGNAT (RFC6598)
  "127.0.0.0/8",        // loopback
  "169.254.0.0/16",     // link-local + cloud metadata (169.254.169.254)
  "172.16.0.0/12",      // RFC1918
  "192.0.0.0/24",       // IETF protocol assignments
  "192.0.2.0/24",       // TEST-NET-1
  "192.88.99.0/24",     // 6to4 relay anycast
  "192.168.0.0/16",     // RFC1918
  "198.18.0.0/15",      // benchmarking
  "198.51.100.0/24",    // TEST-NET-2
  "203.0.113.0/24",     // TEST-NET-3
  "224.0.0.0/4",        // multicast
  "240.0.0.0/4",        // reserved
  "255.255.255.255/32", // limited broadcast
].map(cidrToRange);

function isPrivateIPv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true; // not a valid dotted IPv4 → reject defensively
  }
  const n = ipv4ToInt(parts[0], parts[1], parts[2], parts[3]);
  for (const [start, end] of PRIVATE_IPV4_RANGES) {
    if (n >= start && n <= end) return true;
  }
  return false;
}

// ── IPv6 reserved checks ────────────────────────────────────────────────────
function normalizeIPv6(ip) {
  // Strip zone id and brackets, lowercase
  const s = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  return s;
}

function isIPv4MappedIPv6(ip) {
  // Matches ::ffff:a.b.c.d and ::ffff:0:a.b.c.d (dotted-quad form)
  const dotted = ip.match(/^::ffff:(?:0:)?(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];
  // WHATWG URL parser canonicalizes ::ffff:127.0.0.1 to ::ffff:7f00:1
  // (compressed hex). Accept that form too: two 16-bit hex groups after
  // the ::ffff: prefix get unpacked back into four dotted-quad octets.
  const hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    if (Number.isFinite(hi) && Number.isFinite(lo)) {
      const a = (hi >> 8) & 0xff;
      const b = hi & 0xff;
      const c = (lo >> 8) & 0xff;
      const d = lo & 0xff;
      return `${a}.${b}.${c}.${d}`;
    }
  }
  return null;
}

function isPrivateIPv6(ip) {
  const s = normalizeIPv6(ip);
  if (s === "::1" || s === "::") return true;                  // loopback, unspecified
  if (s.startsWith("fe80:") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb")) return true; // link-local
  if (s.startsWith("fc") || s.startsWith("fd")) return true;   // unique-local fc00::/7
  if (s.startsWith("ff")) return true;                         // multicast
  // Cloud metadata over IPv6 (AWS/GCP/Azure)
  if (s === "fd00:ec2::254") return true;
  // IPv4-mapped — check the embedded v4
  const mapped = isIPv4MappedIPv6(s);
  if (mapped && isPrivateIPv4(mapped)) return true;
  // NAT64 translation prefixes carry an IPv4 in the last 32 bits —
  // check the embedded v4 the same way. A public embedded address is
  // the prefix's designed function and stays reachable.
  const nat64 = nat64EmbeddedIPv4(s);
  if (nat64 && isPrivateIPv4(nat64)) return true;
  return false;
}

// Expand an IPv6 address to its eight 16-bit groups, or null when the
// text is not a well-formed IPv6 address. Handles "::" compression and
// a dotted-quad tail.
function ipv6Groups(ip) {
  let s = ip;
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split(".").map(Number);
    s = s.slice(0, s.length - dotted[1].length)
      + ((a << 8) | b).toString(16) + ":" + ((c << 8) | d).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 0) return null;
  const parts = [...head, ...new Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  if (parts.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return parts.map((g) => parseInt(g, 16));
}

// NAT64 (RFC 6052 well-known prefix 64:ff9b::/96; RFC 8215 local-use
// prefix 64:ff9b:1::/48): the last 32 bits are an embedded IPv4
// address. Returns it dotted, or null when the address is not a NAT64
// translation form.
function nat64EmbeddedIPv4(ip) {
  const g = ipv6Groups(ip);
  if (!g) return null;
  if (g[0] !== 0x64 || g[1] !== 0xff9b) return null;
  const wellKnown = g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0;
  const localUse = g[2] === 1 && g[3] === 0 && g[4] === 0 && g[5] === 0;
  if (!wellKnown && !localUse) return null;
  return `${(g[6] >> 8) & 0xff}.${g[6] & 0xff}.${(g[7] >> 8) & 0xff}.${g[7] & 0xff}`;
}

// ── Cloud metadata hostnames (defense-in-depth beyond IP checks) ────────────
const CLOUD_METADATA_HOSTS = new Set([
  "169.254.169.254",            // AWS, GCP (via gateway), Azure IMDS
  "metadata.google.internal",   // GCP
  "metadata.goog",               // GCP alt
  "fd00:ec2::254",              // AWS IPv6 IMDS
]);

// ── Main validator ──────────────────────────────────────────────────────────

/**
 * Validate a URL for safe server-side fetching.
 *
 * @param {string} urlString
 * @param {object} [opts]
 * @param {boolean} [opts.allowHttp=true] - whether plain http is OK
 * @returns {Promise<{
 *   ok: boolean,
 *   error?: string,
 *   url?: string,           // canonical URL string
 *   hostname?: string,      // original hostname for Host header
 *   resolvedIp?: string,    // validated IP literal
 *   family?: 4 | 6,
 *   parsed?: URL,
 * }>}
 */
export async function validateSafeFetchUrl(urlString, opts = {}) {
  const allowHttp = opts.allowHttp !== false;

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return { ok: false, error: `Disallowed URL scheme: ${parsed.protocol}` };
  }
  if (!allowHttp && parsed.protocol !== "https:") {
    return { ok: false, error: "Only https URLs are allowed here" };
  }

  // Reject credentials in URL (classic obfuscation)
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs with embedded credentials are not allowed" };
  }

  const rawHost = parsed.hostname.toLowerCase();
  if (!rawHost) {
    return { ok: false, error: "URL has no hostname" };
  }

  // Explicit block for known metadata hostnames before DNS lookup
  if (CLOUD_METADATA_HOSTS.has(rawHost)) {
    return { ok: false, error: "Cloud metadata endpoint blocked" };
  }

  // If hostname is already a literal IP, check it directly.
  const netFamily = net.isIP(rawHost.replace(/^\[|\]$/g, ""));
  if (netFamily === 4) {
    if (isPrivateIPv4(rawHost)) {
      return { ok: false, error: "URL resolves to a private/reserved IP" };
    }
    if (CLOUD_METADATA_HOSTS.has(rawHost)) {
      return { ok: false, error: "Cloud metadata endpoint blocked" };
    }
    return { ok: true, url: parsed.toString(), hostname: rawHost, resolvedIp: rawHost, family: 4, parsed };
  }
  if (netFamily === 6) {
    const normalized = normalizeIPv6(rawHost);
    if (isPrivateIPv6(normalized)) {
      return { ok: false, error: "URL resolves to a private/reserved IPv6 address" };
    }
    return { ok: true, url: parsed.toString(), hostname: rawHost, resolvedIp: normalized, family: 6, parsed };
  }

  // Hostname is a DNS name — resolve all addresses and reject if ANY resolve to a private range.
  let addresses;
  try {
    addresses = await dns.lookup(rawHost, { all: true, verbatim: true });
  } catch (err) {
    return { ok: false, error: `DNS lookup failed: ${err.code || err.message}` };
  }
  if (!addresses || addresses.length === 0) {
    return { ok: false, error: "Hostname did not resolve" };
  }

  // Reject if ANY resolved address is private — rebinding attackers often
  // return both a public and a private address so legacy resolvers get
  // confused. The only safe thing is "every resolution is public".
  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) {
      return { ok: false, error: `Hostname ${rawHost} resolves to private IP ${address}` };
    }
    if (family === 6 && isPrivateIPv6(address)) {
      return { ok: false, error: `Hostname ${rawHost} resolves to private IPv6 ${address}` };
    }
  }

  // Pick the first address — caller should use fetchWithPinnedIp to make
  // the actual connection, pinning this exact IP.
  const first = addresses[0];
  return {
    ok: true,
    url: parsed.toString(),
    hostname: rawHost,
    resolvedIp: first.address,
    family: first.family,
    parsed,
  };
}

/**
 * Construct the pinned dispatcher for one validated check. Any failure
 * here — the transport module missing, the Agent constructor throwing —
 * is fatal to the fetch (SB-02): the caller gets an SSRF_PIN_FAILED
 * error, never a silent degradation to an unpinned fetch.
 */
async function buildPinnedDispatcher(check) {
  try {
    if (_dispatcherFactory) return _dispatcherFactory(check);
    // Lazy import so a missing transport is a construction failure
    // handled below, not a module-load crash for every consumer.
    const { Agent } = await import("undici");

    const family = check.family === 6 ? 6 : 4;
    const resolvedIp = check.resolvedIp;

    // Pin DNS: every connection attempt uses our validated IP.
    //
    // Security audit 2026-07-30: this previously called back
    // `cb(null, resolvedIp, family)` — the older 3-arg dns.lookup
    // shape — which THIS undici/Node combination's connect.lookup does not
    // accept (confirmed directly: it throws "Invalid IP address: undefined"
    // deep in Node's net internals). The correct shape for this
    // connect.lookup — verified by direct reproduction against a local
    // test server before and after — is the `{all: true}` dns.lookup
    // array form: `cb(err, [{ address, family }])`.
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, _opts, cb) => cb(null, [{ address: resolvedIp, family }]),
      },
    });
    // Record the pinned IP on the dispatcher (non-enumerable) so the test
    // no-egress preload can tell a pinned-to-loopback test server apart from a
    // real external call — it used to trust every dispatcher blindly.
    Object.defineProperty(dispatcher, "__concordPinnedIp", { value: resolvedIp });
    return dispatcher;
  } catch (e) {
    const err = new Error(`pinned dispatcher construction failed: ${e?.message || e}`);
    err.code = "SSRF_PIN_FAILED";
    logger.error("ssrf-guard", "pinned dispatcher construction failed — refusing the fetch rather than degrading to an unpinned one", { code: err.code, error: e?.message });
    throw err;
  }
}

// Test seam (mirrors public-fetch.js's __setPublicFetchTestTransport):
// lets a pin force a dispatcher-construction failure to prove the
// fail-closed behaviour above. Null in production; production code
// never calls this.
let _dispatcherFactory = null;
export function __setPinnedDispatcherFactory(fn) {
  _dispatcherFactory = typeof fn === "function" ? fn : null;
}

const SSRF_MAX_REDIRECT_HOPS = 5;
const SSRF_DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const SSRF_DEFAULT_TIMEOUT_MS = 15_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function ssrfError(code, message) {
  const err = new Error(`${code}: ${message}`);
  err.code = code;
  return err;
}

// Buffer a final response under the byte cap so an unbounded body
// cannot stream into memory through the guarded path. Statuses that
// forbid a body, and body-less responses, pass through unchanged.
async function capResponseBody(res, maxBytes) {
  if (!res || !res.body || NULL_BODY_STATUSES.has(res.status)) return res;
  const len = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(len) && len > maxBytes) {
    try { await res.body.cancel(); } catch { /* already refused */ }
    throw ssrfError("SSRF_BODY_TOO_LARGE", `response body exceeds the ${maxBytes}-byte cap`);
  }
  if (typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* already refused */ }
        throw ssrfError("SSRF_BODY_TOO_LARGE", `response body exceeds the ${maxBytes}-byte cap`);
      }
      chunks.push(Buffer.from(value));
    }
    return new Response(Buffer.concat(chunks), {
      status: res.status,
      statusText: res.statusText,
      headers: res.headers,
    });
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw ssrfError("SSRF_BODY_TOO_LARGE", `response body exceeds the ${maxBytes}-byte cap`);
  }
  return new Response(buf, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/**
 * Fetch a validated URL with the resolved IP pinned via a custom
 * `dispatcher` (undici Agent), eliminating DNS rebinding: the TCP
 * connection lands on the exact IP that was validated.
 *
 * Redirects are followed MANUALLY (SB-01): whatever the caller passed,
 * the transport is told `redirect: "manual"`, and every hop's Location
 * is resolved against the current URL and re-validated through
 * validateSafeFetchUrl, then fetched on a NEW dispatcher pinned to
 * that hop's validated address. At most 5 hops; a refused hop throws
 * SSRF_BLOCKED; a 6th redirect throws SSRF_TOO_MANY_REDIRECTS.
 * Credentials (authorization / cookie) never cross an origin boundary.
 * The final body is capped (default 5 MB) and the whole chain runs
 * under one timeout (default 15 s); both are overridable per call via
 * `init.maxBytes` / `init.timeoutMs` (consumed here, never forwarded).
 * There is NO unpinned fallback (SB-02): if the pinned dispatcher
 * cannot be constructed, the fetch fails closed with SSRF_PIN_FAILED.
 *
 * @param {Awaited<ReturnType<typeof validateSafeFetchUrl>> & { ok: true }} check
 * @param {RequestInit & { maxBytes?: number, timeoutMs?: number }} [init]
 */
export async function fetchWithPinnedIp(check, init = {}) {
  if (!check || !check.ok) throw new Error("validateSafeFetchUrl failed");

  const maxBytes = Number.isFinite(init.maxBytes) && init.maxBytes > 0 ? init.maxBytes : SSRF_DEFAULT_MAX_BYTES;
  const timeoutMs = Number.isFinite(init.timeoutMs) && init.timeoutMs > 0 ? init.timeoutMs : SSRF_DEFAULT_TIMEOUT_MS;

  // One timeout for the whole chain, composed with the caller's own
  // signal when they passed one.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("guarded fetch timed out")), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  const signal = init.signal && typeof AbortSignal.any === "function"
    ? AbortSignal.any([init.signal, ctl.signal])
    : (init.signal || ctl.signal);

  let currentCheck = check;
  let method = String(init.method || "GET").toUpperCase();
  let body = init.body;
  const headers = new Headers(init.headers || {});

  try {
    for (let hop = 0; ; hop++) {
      const dispatcher = await buildPinnedDispatcher(currentCheck);
      const hopInit = { ...init, method, headers, redirect: "manual", dispatcher, signal };
      delete hopInit.maxBytes;
      delete hopInit.timeoutMs;
      if (body === undefined) delete hopInit.body; else hopInit.body = body;

      // Route through globalThis.fetch (Node's built-in fetch — the same
      // undici implementation, exposed globally) rather than a separately
      // imported undici.fetch reference. Not cosmetic: it's the only way
      // test-time guards apply. tests/preload/no-egress.mjs patches
      // globalThis.fetch to reject every non-loopback URL under
      // NODE_ENV=test, and individual tests that mock a live response
      // (`globalThis.fetch = async () => canned`) depend on that exact
      // global slot being what the code actually calls. Passing
      // `dispatcher` through globalThis.fetch pins the connection
      // identically to an explicit undici.fetch call, since Node's
      // built-in fetch IS undici's implementation.
      const res = await globalThis.fetch(currentCheck.url, hopInit);

      const location = res.headers?.get?.("location");
      if (!REDIRECT_STATUSES.has(res.status) || !location) {
        return await capResponseBody(res, maxBytes);
      }
      if (hop >= SSRF_MAX_REDIRECT_HOPS) {
        throw ssrfError("SSRF_TOO_MANY_REDIRECTS", `more than ${SSRF_MAX_REDIRECT_HOPS} redirect hops`);
      }
      let nextUrl;
      try {
        nextUrl = new URL(location, currentCheck.url);
      } catch {
        throw ssrfError("SSRF_BLOCKED", "redirect Location is not a valid URL");
      }
      const nextCheck = await validateSafeFetchUrl(nextUrl.toString());
      if (!nextCheck.ok) {
        throw ssrfError("SSRF_BLOCKED", `redirect hop ${hop + 2} refused: ${nextCheck.error}`);
      }
      // Credentials never cross an origin boundary.
      if (nextUrl.origin !== new URL(currentCheck.url).origin) {
        headers.delete("authorization");
        headers.delete("cookie");
      }
      // Fetch-spec method rewriting: 303 turns anything but HEAD into
      // a bodyless GET; 301/302 do the same for POST.
      if ((res.status === 303 && method !== "HEAD") || ((res.status === 301 || res.status === 302) && method === "POST")) {
        method = "GET";
        body = undefined;
        headers.delete("content-type");
        headers.delete("content-length");
      }
      try { await res.body?.cancel(); } catch { /* hop body is not needed */ }
      currentCheck = nextCheck;
    }
  } finally {
    clearTimeout(timer);
  }
}

// ── Database targets (DBX-1) ───────────────────────────────────────────────
//
// validateSafeFetchUrl above guards http(s) fetches. A database
// connection is not a URL: the caller dials a raw host:port (e.g. via
// the `pg` driver) with credentials, so it needs the same address
// discipline plus a port allowlist — a guarded fetch may legitimately
// reach port 443, a database dial may not. This validator reuses the
// range tables and resolution rules above (this module stays the
// single source of truth) and returns a pinned IP the caller dials
// directly, so the TCP connection lands on the address that was
// validated — the raw-TCP equivalent of fetchWithPinnedIp. (For TLS,
// the caller passes the original hostname as the SNI servername while
// connecting to the pinned IP.)

/** Database service ports a server-side dial may target. */
export const DB_PORT_ALLOWLIST = Object.freeze([5432, 3306, 6379, 1433, 27017, 26257]);

/**
 * Synchronous private/reserved classification for an IP literal
 * (IPv4, IPv6, or IPv4-mapped IPv6). Non-IP input classifies as
 * private — the defensive direction, mirroring isPrivateIPv4.
 */
export function isPrivateIpAddress(address) {
  if (typeof address !== "string") return true;
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0];
  const family = net.isIP(bare);
  if (family === 4) return isPrivateIPv4(bare);
  if (family === 6) return isPrivateIPv6(normalizeIPv6(bare));
  return true;
}

/**
 * Validate a raw database target (host + port) for a server-side dial.
 *
 * @param {string} host - hostname or IP literal (never a URL)
 * @param {number|string} port
 * @param {object} [opts]
 * @param {Function} [opts.lookup] - dns.lookup-compatible resolver (tests inject this)
 * @param {number[]} [opts.allowPorts] - port allowlist override
 * @returns {Promise<{
 *   ok: boolean, code?: string, error?: string,
 *   hostname?: string, port?: number,
 *   resolvedIp?: string, family?: 4 | 6,
 *   addresses?: Array<{ address: string, family: number }>,
 * }>} Never throws; refusals are { ok: false, code, error }.
 */
export async function validateDbTarget(host, port, opts = {}) {
  const lookup = opts.lookup || dns.lookup;
  const allowPorts = opts.allowPorts || DB_PORT_ALLOWLIST;

  // Port first: the cheap checks run before any DNS work.
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) {
    return { ok: false, code: "invalid_port", error: `Invalid port: ${port}` };
  }
  if (!allowPorts.includes(p)) {
    return { ok: false, code: "port_not_allowed", error: `Port ${p} is not an allowed database port` };
  }

  if (typeof host !== "string") {
    return { ok: false, code: "invalid_host", error: "Host is required" };
  }
  const h = host.trim().toLowerCase();
  if (!h) {
    return { ok: false, code: "invalid_host", error: "Host is required" };
  }
  // A database target is a bare host — never a URL, a path, or a
  // credential-bearing authority string.
  if (/[\s/\\@]/.test(h) || h.includes("://")) {
    return { ok: false, code: "invalid_host", error: "Host must be a hostname or IP address, not a URL" };
  }

  // Local and metadata names are refused before DNS: their resolution
  // is environment-defined, which is exactly what an attacker wants.
  if (CLOUD_METADATA_HOSTS.has(h)) {
    return { ok: false, code: "metadata_blocked", error: "Cloud metadata endpoint blocked" };
  }
  if (h === "localhost" || h.endsWith(".localhost")) {
    return { ok: false, code: "local_blocked", error: "Localhost targets are not allowed" };
  }

  // IP literal — classify directly, no DNS involved.
  const bare = h.replace(/^\[|\]$/g, "");
  const literalFamily = net.isIP(bare);
  if (literalFamily === 4) {
    if (isPrivateIPv4(bare)) {
      return { ok: false, code: "private_address", error: "Target is a private/reserved IP" };
    }
    return { ok: true, hostname: h, port: p, resolvedIp: bare, family: 4, addresses: [{ address: bare, family: 4 }] };
  }
  if (literalFamily === 6) {
    const normalized = normalizeIPv6(bare);
    if (isPrivateIPv6(normalized)) {
      return { ok: false, code: "private_address", error: "Target is a private/reserved IPv6 address" };
    }
    return { ok: true, hostname: h, port: p, resolvedIp: normalized, family: 6, addresses: [{ address: normalized, family: 6 }] };
  }

  // DNS name: conservative label shape, then resolve and reject if ANY
  // address is private — the same anti-rebinding rule as the URL path.
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(h) || h.includes("..")) {
    return { ok: false, code: "invalid_host", error: "Host must be a hostname or IP address, not a URL" };
  }
  let addresses;
  try {
    addresses = await lookup(h, { all: true, verbatim: true });
  } catch (err) {
    return { ok: false, code: "unresolvable", error: `DNS lookup failed: ${err.code || err.message}` };
  }
  if (!addresses || addresses.length === 0) {
    return { ok: false, code: "unresolvable", error: "Hostname did not resolve" };
  }
  for (const { address, family } of addresses) {
    if (family === 4 && isPrivateIPv4(address)) {
      return { ok: false, code: "private_address", error: `Hostname ${h} resolves to private IP ${address}` };
    }
    if (family === 6 && isPrivateIPv6(address)) {
      return { ok: false, code: "private_address", error: `Hostname ${h} resolves to private IPv6 ${address}` };
    }
  }
  const first = addresses[0];
  return {
    ok: true,
    hostname: h,
    port: p,
    resolvedIp: first.address,
    family: first.family,
    addresses: addresses.map(({ address, family }) => ({ address, family })),
  };
}

// ── Named exports for the older isUrlSafe / validateUrl surfaces ────────────

/**
 * Backwards-compatible synchronous-ish URL check that mirrors the legacy
 * `validateUrl` / `isUrlSafe` shape. Prefer `validateSafeFetchUrl` above
 * — this only exists so existing callers don't break when they can't
 * switch to async.
 */
export async function isUrlSafeAsync(urlString) {
  const r = await validateSafeFetchUrl(urlString);
  if (r.ok) return { safe: true };
  return { safe: false, reason: r.error };
}
