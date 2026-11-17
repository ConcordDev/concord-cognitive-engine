/**
 * Reference-data store — SXE-41 (ConKay solver catalogue, Wave 0).
 *
 * Where ConKay keeps the free public reference data its solver results
 * are signed against (DC-01). Four guarantees:
 *
 *   1. Provenance records. Nothing is stored without its source URL,
 *      its licence, when it was retrieved, and the SHA-256 of the exact
 *      bytes. A datum without provenance is refused — storing it anyway
 *      would defeat the store's purpose.
 *   2. Literal re-find. A checker can ask whether a cited value
 *      literally appears in the stored source bytes. A reference that
 *      does not literally contain the value it is cited for does not
 *      sign anything.
 *   3. On-demand fetch, SSRF-guarded. http/https only; every resolved
 *      address (and every redirect hop) must be a public IP; size and
 *      time are capped. Private, loopback, and link-local targets are
 *      refused before any fetch happens.
 *   4. Disk budget. The store refuses a write that would exceed its
 *      budget — it never silently evicts a provenance record.
 *
 * Records are content-addressed: the same source URL + same bytes is
 * the same record, so re-storing is idempotent.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { lookup as dnsLookup } from "node:dns/promises";

export const DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024;
export const DEFAULT_FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

/** True only for globally routable addresses. Everything else is refused. */
export function isPublicIp(ip) {
  if (typeof ip !== "string") return false;
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return false; // unspecified, private, loopback
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 169 && b === 254) return false; // link-local
    if (a === 192 && b === 0) return false; // IETF protocol assignments / TEST-NET-1 vicinity
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51) return false; // TEST-NET-2
    if (a === 203 && b === 0) return false; // TEST-NET-3
    if (a >= 240) return false; // reserved / broadcast
    if (a >= 224 && a <= 239) return false; // multicast
    return true;
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1" || v6 === "::") return false; // loopback / unspecified
  if (v6.startsWith("fe8") || v6.startsWith("fe9") || v6.startsWith("fea") || v6.startsWith("feb")) return false; // link-local fe80::/10
  if (v6.startsWith("fc") || v6.startsWith("fd")) return false; // unique local fc00::/7
  if (v6.startsWith("ff")) return false; // multicast
  if (v6.startsWith("2001:db8")) return false; // documentation
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIp(mapped[1]); // IPv4-mapped: judge the v4 address
  return v6.includes(":");
}

async function defaultLookup(hostname) {
  const rows = await dnsLookup(hostname, { all: true });
  return rows.map((r) => r.address);
}

export function createRefdataStore(opts = {}) {
  const dir = opts.dir;
  if (!dir) throw new Error("refdata store: dir is required");
  const budgetBytes = opts.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const lookupImpl = opts.lookupImpl ?? defaultLookup;
  const now = opts.now ?? (() => new Date().toISOString());
  mkdirSync(dir, { recursive: true });

  const recordPath = (id) => join(dir, `${id}.json`);
  const contentPath = (id) => join(dir, `${id}.content`);

  function listRecords() {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  }

  function bytesUsed() {
    return listRecords().reduce((sum, r) => sum + (r.bytes || 0), 0);
  }

  function put({ sourceUrl, licence, content, retrievedVia = "put" }) {
    if (!sourceUrl || typeof sourceUrl !== "string") {
      return { ok: false, reason: "refdata_provenance_missing:sourceUrl" };
    }
    if (!licence || typeof licence !== "string") {
      return { ok: false, reason: "refdata_provenance_missing:licence" };
    }
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content ?? ""), "utf8");
    const contentHash = sha256(buf);
    const id = sha256(`${sourceUrl}\n${contentHash}`).slice(0, 32);
    if (existsSync(recordPath(id))) {
      return { ok: true, record: JSON.parse(readFileSync(recordPath(id), "utf8")), deduplicated: true };
    }
    if (bytesUsed() + buf.length > budgetBytes) {
      return { ok: false, reason: "refdata_budget_exceeded", budgetBytes };
    }
    const record = {
      id,
      sourceUrl,
      licence,
      retrievedAt: now(),
      retrievedVia,
      sha256: contentHash,
      bytes: buf.length,
    };
    writeFileSync(contentPath(id), buf);
    writeFileSync(recordPath(id), JSON.stringify(record, null, 2));
    return { ok: true, record };
  }

  function get(id) {
    if (!existsSync(recordPath(id))) return null;
    const record = JSON.parse(readFileSync(recordPath(id), "utf8"));
    const content = readFileSync(contentPath(id));
    return { record, content };
  }

  /** Literal re-find: does the cited literal appear in the stored bytes? */
  function refind(id, literal) {
    const hit = get(id);
    if (!hit) return { ok: false, reason: "refdata_not_found", id };
    const needle = Buffer.isBuffer(literal) ? literal : Buffer.from(String(literal), "utf8");
    if (needle.length === 0) return { ok: false, reason: "refdata_empty_literal", id };
    let occurrences = 0;
    let idx = hit.content.indexOf(needle);
    while (idx !== -1) {
      occurrences += 1;
      idx = hit.content.indexOf(needle, idx + 1);
    }
    return { ok: true, id, found: occurrences > 0, occurrences, sha256: hit.record.sha256 };
  }

  /**
   * SSRF guard: validate one URL end to end. Returns {ok:true, url} or
   * {ok:false, reason}. Every resolved address must be public.
   */
  async function guardUrl(rawUrl) {
    let url;
    try {
      url = new URL(rawUrl);
    } catch {
      return { ok: false, reason: "ssrf_blocked:invalid_url" };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, reason: `ssrf_blocked:scheme:${url.protocol}` };
    }
    if (url.username || url.password) {
      return { ok: false, reason: "ssrf_blocked:credentials_in_url" };
    }
    let addresses;
    try {
      addresses = await lookupImpl(url.hostname);
    } catch {
      return { ok: false, reason: "ssrf_blocked:dns_failed" };
    }
    if (!addresses || addresses.length === 0) {
      return { ok: false, reason: "ssrf_blocked:dns_empty" };
    }
    for (const addr of addresses) {
      if (!isPublicIp(addr)) {
        return { ok: false, reason: `ssrf_blocked:non_public_address:${addr}` };
      }
    }
    return { ok: true, url };
  }

  /** Fetch a free public source on demand and store it with provenance. */
  async function fetchAndStore(rawUrl, { licence, maxBytes = DEFAULT_FETCH_MAX_BYTES, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) {
    if (!licence) return { ok: false, reason: "refdata_provenance_missing:licence" };
    let current = rawUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const guard = await guardUrl(current);
      if (!guard.ok) return guard;
      let res;
      try {
        res = await fetchImpl(guard.url.href, {
          redirect: "manual",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { "user-agent": "Concord-ConKay-refdata/1.0" },
        });
      } catch (err) {
        return { ok: false, reason: `refdata_fetch_failed:${err?.name === "TimeoutError" ? "timeout" : (err?.message || "error")}` };
      }
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return { ok: false, reason: "refdata_fetch_failed:redirect_without_location" };
        if (hop === MAX_REDIRECTS) return { ok: false, reason: "refdata_fetch_failed:too_many_redirects" };
        current = new URL(location, guard.url).href; // re-guarded at the top of the loop
        continue;
      }
      if (res.status !== 200) {
        return { ok: false, reason: `refdata_fetch_failed:http_${res.status}` };
      }
      const declared = Number(res.headers.get("content-length") || 0);
      if (declared > maxBytes) return { ok: false, reason: "refdata_fetch_failed:too_large" };
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) return { ok: false, reason: "refdata_fetch_failed:too_large" };
      const stored = put({ sourceUrl: rawUrl, licence, content: buf, retrievedVia: "fetch" });
      if (!stored.ok) return stored;
      return { ...stored, fetchedFrom: guard.url.href, status: res.status };
    }
    return { ok: false, reason: "refdata_fetch_failed:too_many_redirects" };
  }

  function stats() {
    const records = listRecords();
    return {
      records: records.length,
      bytesUsed: records.reduce((s, r) => s + (r.bytes || 0), 0),
      budgetBytes,
    };
  }

  return { put, get, refind, fetchAndStore, guardUrl, stats, dir, list: listRecords };
}
