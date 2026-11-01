// server/lib/ics-fetch.js
//
// SSRF-guarded fetch of a user-supplied iCalendar (ICS) feed URL for the calendar lens (accounts-connect /
// accounts-sync). Both used a bare fetch(icsUrl) on a URL the user typed, bypassing lib/public-fetch.js: an
// authenticated member could aim the server at loopback / RFC1918 / link-local / cloud-metadata addresses and
// read the status or error text back (a port-scan oracle), or have it pull an arbitrary internal body.
//
//   icsUrlProblem(url)  sync save-time check: scheme, credentials, localhost names, private/loopback/
//                       link-local/metadata IP literals. null when acceptable. (DNS-level checks need the
//                       network, so they happen in fetchIcsText.)
//   fetchIcsText(url)   guarded fetch via fetchPublicUrl (scheme + private-IP + DNS-rebinding pin), manual
//                       redirects re-validated per hop (<= 3), 15 s timeout, 5 MB body cap.

import net from "node:net";
import { fetchPublicUrl, PUBLIC_URL_BLOCKED } from "./public-fetch.js";

export const ICS_MAX_BYTES = 5 * 1024 * 1024;
export const ICS_TIMEOUT_MS = 15_000;
export const ICS_MAX_HOPS = 3;

function ipv4Private(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||      // CGNAT
    (a === 169 && b === 254) ||                // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                                   // multicast / reserved / broadcast
  );
}

function ipv6Private(ip) {
  const x = ip.toLowerCase();
  if (x === "::" || x === "::1") return true;
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4Private(mapped[1]);
  // URL normalizes IPv4-mapped addresses to hex groups ("::ffff:a00:1" for ::ffff:10.0.0.1).
  const hex = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16); const lo = parseInt(hex[2], 16);
    return ipv4Private(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return /^(fc|fd)/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
}

/** Sync save-time check. Returns a human reason, or null when the URL may be stored/fetched. */
export function icsUrlProblem(urlString) {
  let u;
  try { u = new URL(String(urlString ?? "").trim()); } catch { return "not a valid URL"; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return "only http(s) feed URLs are allowed";
  if (u.username || u.password) return "feed URLs with embedded credentials are not allowed";
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host) return "not a valid URL";
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return PUBLIC_URL_BLOCKED;
  const kind = net.isIP(host);
  if (kind === 4 && ipv4Private(host)) return PUBLIC_URL_BLOCKED;
  if (kind === 6 && ipv6Private(host)) return PUBLIC_URL_BLOCKED;
  return null;
}

async function readCapped(res, maxBytes) {
  const len = Number(res.headers?.get?.("content-length"));
  if (Number.isFinite(len) && len > maxBytes) throw new Error("feed too large");
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { try { await reader.cancel(); } catch { /* */ } throw new Error("feed too large"); }
      chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  }
  const text = await res.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("feed too large");
  return text;
}

/**
 * Fetch an ICS feed through the SSRF guard. Never throws.
 * @returns {Promise<{ok:true,text:string,finalUrl:string}|{ok:false,error:string,status?:number}>}
 */
export async function fetchIcsText(urlString, { fetchOpts = {}, maxBytes = ICS_MAX_BYTES, timeoutMs = ICS_TIMEOUT_MS, maxHops = ICS_MAX_HOPS } = {}) {
  let url = String(urlString ?? "").trim();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    for (let hop = 0; hop <= maxHops; hop++) {
      const problem = icsUrlProblem(url);
      if (problem) return { ok: false, error: problem };
      let res;
      try {
        res = await fetchPublicUrl(url, { redirect: "manual", signal: ctl.signal, headers: { accept: "text/calendar, text/plain, */*" } }, fetchOpts);
      } catch (e) {
        if (e?.code === "SSRF_BLOCKED") return { ok: false, error: PUBLIC_URL_BLOCKED };
        return { ok: false, error: `feed unreachable: ${e instanceof Error ? e.message : String(e)}` };
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers?.get?.("location");
        if (!loc) return { ok: false, error: `feed responded ${res.status} without a Location`, status: res.status };
        if (hop === maxHops) return { ok: false, error: "feed redirected too many times" };
        try { url = new URL(loc, url).toString(); } catch { return { ok: false, error: "feed redirected to an invalid URL" }; }
        continue; // the next iteration re-validates the new target
      }
      if (!res.ok) return { ok: false, error: `feed responded ${res.status}`, status: res.status };
      try {
        return { ok: true, text: await readCapped(res, maxBytes), finalUrl: url };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
    return { ok: false, error: "feed redirected too many times" };
  } finally {
    clearTimeout(timer);
  }
}
