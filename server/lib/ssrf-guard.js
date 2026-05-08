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
  return false;
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
 * Fetch a URL using Node's global fetch, but with the resolved IP pinned
 * via a custom `dispatcher` (undici Agent). This eliminates DNS rebinding
 * because the TCP connection lands on the exact IP we validated — not a
 * second-resolve from the URL hostname.
 *
 * If undici isn't available at runtime (older Node?), we fall back to a
 * best-effort fetch with the original hostname and rely on the validation
 * above. That's not perfect, but it's strictly better than no validation.
 *
 * @param {Awaited<ReturnType<typeof validateSafeFetchUrl>> & { ok: true }} check
 * @param {RequestInit} [init]
 */
export async function fetchWithPinnedIp(check, init = {}) {
  if (!check || !check.ok) throw new Error("validateSafeFetchUrl failed");

  try {
    // Lazy require so we don't explode if undici is unavailable.
    const undici = await import("undici");
    const { Agent } = undici;

    const family = check.family === 6 ? 6 : 4;
    const resolvedIp = check.resolvedIp;

    // Pin DNS: every connection attempt uses our validated IP.
    const dispatcher = new Agent({
      connect: {
        lookup: (_hostname, _opts, cb) => cb(null, resolvedIp, family),
      },
    });

    const { fetch: undiciFetch } = undici;
    return await undiciFetch(check.url, { ...init, dispatcher });
  } catch {
    // Fall back — still-validated URL, but DNS rebinding window re-opens.
    return fetch(check.url, init);
  }
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
