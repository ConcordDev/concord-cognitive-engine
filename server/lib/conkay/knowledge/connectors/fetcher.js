// server/lib/conkay/knowledge/connectors/fetcher.js
//
// Document retrieval for the knowledge connectors. Every response is a
// document: URL, HTTP status, body, SHA-256 of the body, retrieval date. The
// connectors never call the network themselves; they are given a `get(url)`
// that returns such a document, so the same parsing runs on a live fetch, on a
// recorded excerpt (tests, demo), or on an operator's capture.
//
//   liveGetter({ fetch, sleep, maxAttempts, retryDelayMs, minIntervalMs, store })
//     retries only what the server says is temporary (HTTP 429 / 503, PubChem
//     "PUGVIEW.ServerBusy"), spaced at least minIntervalMs apart (PubChem asks
//     for no more than 5 requests a second); a 404 / "NotFound" is a real
//     answer (no data) and is returned as such, never retried and never
//     turned into a value. Every 200 response is put in the evidence store.
//   replayGetter(recordings)
//     serves recorded documents by URL; an unrecorded URL is an error, so a
//     test or demo cannot silently fall back to the network.
//   EvidenceStore: the original documents, content-addressed by SHA-256
//     (CONKAY_EVIDENCE_DIR, or an in-memory store).

import { createHash } from "node:crypto";
import { fetchPublicUrl } from "../../../public-fetch.js";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export class EvidenceStore {
  constructor(dir = null) {
    this.dir = dir;
    this.mem = new Map();
  }

  static default() {
    return new EvidenceStore(process.env.CONKAY_EVIDENCE_DIR || path.join(os.tmpdir(), "conkay-evidence"));
  }

  /** Store a document's body under its SHA-256 (async file I/O); returns the stored record. */
  async put(doc) {
    const rec = { url: doc.url, status: doc.status, sha256: doc.sha256, retrieved: doc.retrieved, contentType: doc.contentType || null, bytes: Buffer.byteLength(doc.body) };
    if (this.dir) {
      await fsp.mkdir(this.dir, { recursive: true });
      await fsp.writeFile(path.join(this.dir, `${doc.sha256}.body`), doc.body);
      await fsp.writeFile(path.join(this.dir, `${doc.sha256}.json`), JSON.stringify(rec, null, 2));
    } else {
      this.mem.set(doc.sha256, { ...rec, body: doc.body });
    }
    return rec;
  }

  async get(hash) {
    if (this.mem.has(hash)) return this.mem.get(hash);
    if (!this.dir) return null;
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(this.dir, `${hash}.json`), "utf8"));
      return { ...meta, body: await fsp.readFile(path.join(this.dir, `${hash}.body`), "utf8") };
    } catch {
      return null;
    }
  }
}

const today = () => new Date().toISOString().slice(0, 10);
const BUSY = /PUGVIEW\.ServerBusy|"Code"\s*:\s*"ServerBusy"|Too many requests/i;
const NOT_FOUND = /PUGVIEW\.NotFound|"Code"\s*:\s*"PUGREST\.NotFound"|No data found/i;

/** The host of a URL string, lower-cased; null when unparseable. Parsing is not a DNS lookup. */
export function hostOf(url) {
  try { return new URL(String(url)).hostname.toLowerCase() || null; } catch { return null; }
}

/**
 * SB-06: bind a getter to a connector's host allowlist. An off-list host
 * is refused BEFORE any fetch and before DNS, as a permanent refusal in
 * the getter's own document shape (never retried, never a value).
 */
export function withHostAllowlist(get, hosts) {
  const allowed = new Set((hosts || []).map((h) => String(h).toLowerCase()));
  return async function allowlistedGet(url) {
    const host = hostOf(url);
    if (!host || !allowed.has(host)) {
      return { ok: false, url, error: `host ${host || "(unparseable url)"} is not on this connector's allowlist`, attempts: 0 };
    }
    return get(url);
  };
}

/** A getter over a real fetch. */
export function liveGetter({ fetch = null, allowHosts = null, sleep = (ms) => new Promise((r) => { setTimeout(r, ms); }), maxAttempts = 6, retryDelayMs = 5000, minIntervalMs = 250, store = null, userAgent = "ConKay-knowledge-connector/1.0 (concord-os.org)", now = today } = {}) {
  // SB-06: the DEFAULT transport is the SB-01 SSRF guard (fetchPublicUrl),
  // never the raw global fetch. A caller-supplied fetch stays the caller's
  // own transport — the guard module's test-seam convention.
  const transport = typeof fetch === "function" ? fetch : (u, init) => fetchPublicUrl(u, init);
  if (typeof transport !== "function") throw new Error("liveGetter needs a fetch function");
  let last = 0;
  return async function get(url) {
    // SB-06: a connector allowlist refuses off-list hosts before any
    // fetch call and before DNS — permanent, not retried.
    if (allowHosts) {
      const host = hostOf(url);
      if (!host || !allowHosts.map((h) => String(h).toLowerCase()).includes(host)) {
        return { ok: false, url, error: `host ${host || "(unparseable url)"} is not on this connector's allowlist`, attempts: 0 };
      }
    }
    for (let attempt = 1; ; attempt++) {
      const wait = last + minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      last = Date.now();
      let res, body;
      try {
        res = await transport(url, { headers: { "user-agent": userAgent, accept: "application/json, text/plain, text/html" } });
        body = await res.text();
      } catch (e) {
        // An SSRF refusal is permanent — never retried as a network error.
        if (e && e.code === "SSRF_BLOCKED") return { ok: false, url, error: `refused: ${e.message}`, attempts: attempt };
        if (attempt >= maxAttempts) return { ok: false, url, error: `network error: ${e.message}`, attempts: attempt };
        await sleep(retryDelayMs * attempt);
        continue;
      }
      const busy = res.status === 429 || res.status === 503 || BUSY.test(body.slice(0, 400));
      if (busy) {
        if (attempt >= maxAttempts) return { ok: false, url, status: res.status, error: "server busy: retries exhausted (temporary; try later)", attempts: attempt, retryable: true };
        await sleep(retryDelayMs * attempt);
        continue;
      }
      const doc = { ok: true, url, status: res.status, body, sha256: sha256(body), retrieved: now(), contentType: res.headers?.get?.("content-type") || null, attempts: attempt };
      if (res.status === 404 || NOT_FOUND.test(body.slice(0, 400))) return { ...doc, notFound: true };
      if (res.status !== 200) return { ok: false, url, status: res.status, error: `HTTP ${res.status}`, attempts: attempt };
      if (store) await store.put(doc);
      return doc;
    }
  };
}

/**
 * A getter over recorded documents: { url: { body, retrieved, fullSha256?, excerpt? } }. The returned document's
 * sha256 is the hash of the recorded body; when the recording is an excerpt of a larger response, fullSha256 is
 * the hash of the full response as retrieved (so the original can be re-identified).
 */
export function replayGetter(recordings) {
  return async function get(url) {
    const r = recordings[url];
    if (!r) return { ok: false, url, error: `no recording for ${url} (replay never falls back to the network)` };
    if (r.notFound) return { ok: true, notFound: true, url, status: 404, body: r.body || "", sha256: sha256(r.body || ""), retrieved: r.retrieved };
    return { ok: true, url, status: 200, body: r.body, sha256: sha256(r.body), fullSha256: r.fullSha256 || null, excerpt: !!r.excerpt, retrieved: r.retrieved };
  };
}

/** The evidence ref (schema EvidenceRef) for a retrieved document and a location in it. */
export function documentEvidence(doc, { sourceId, title, locator, excerpt = null, license = null }) {
  return {
    kind: "url", sourceId, title, url: doc.url, document: null, author: null, date: null,
    retrieved: doc.retrieved, locator, excerpt: excerpt == null ? null : String(excerpt).slice(0, 400),
    sha256: doc.fullSha256 || doc.sha256, license, receiptRef: null,
  };
}
