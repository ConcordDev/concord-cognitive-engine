// server/lib/debug-ingest-handler.js
// The Debug ingest endpoint's request logic, expressed without express
// so the full status taxonomy is behaviour-testable: the route
// (server/routes/debug-ingest.js) adapts req/res to this handler and
// owns only the raw-body plumbing. Domain access goes through the
// `debugIngest` hooks exported by server/domains/debug.js — passed in
// as a live object, since the hooks are populated at domain
// registration (boot) and read per request.
//
// Status taxonomy (Q1 slice):
//   200  event(s) ingested — { id, ingested, ignored? }
//   200  no event items — { id: header event_id | null, ingested: 0, ignored }
//   400  malformed envelope/event (defect named), gzip failure,
//        or the key is not scoped to the path's project
//   401  missing / unknown / revoked key — one body for all three
//   404  the key's project no longer exists (deleted after key creation)
//   429  per-key rate limit, with Retry-After
//   503  the debug domain has not registered its hooks yet

import { gunzipSync } from "node:zlib";
import {
  parseEnvelope,
  mapEventToIssue,
  parseSentryAuthHeader,
  createRateLimiter,
} from "./sentry-envelope.js";

export function createIngestHandler({ ingest, limit = 600, windowMs = 60_000 } = {}) {
  const limiter = createRateLimiter({ limit, windowMs });
  const fail = (status, error, headers) => ({ status, json: { error }, ...(headers ? { headers } : {}) });

  function handle({ projectId, authHeader, body, contentEncoding } = {}) {
    if (!ingest || typeof ingest.ingestEvent !== "function") {
      return fail(503, "ingest unavailable");
    }
    let raw = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "", "utf8");
    if (typeof contentEncoding === "string" && contentEncoding.includes("gzip")) {
      try {
        raw = gunzipSync(raw);
      } catch {
        return fail(400, "envelope body is not valid gzip");
      }
    }
    // Auth first: nothing about projects or payloads is revealed to a
    // caller without a live key, and all three key failures share one
    // body so the endpoint is not a key oracle.
    const rawKey = parseSentryAuthHeader(authHeader);
    const verified = rawKey ? ingest.verifyKey(rawKey) : null;
    if (!verified) return fail(401, "invalid or missing ingest key");
    const { userId, record } = verified;
    if (record.projectId !== projectId) {
      return fail(400, "ingest key is not scoped to this project");
    }
    const gate = limiter.check(record.id);
    if (!gate.allowed) {
      return fail(429, "rate limit exceeded", { "Retry-After": String(gate.retryAfterSec) });
    }
    const parsed = parseEnvelope(raw);
    if (!parsed.ok) return fail(400, parsed.error);
    const eventItems = parsed.items.filter((i) => i.type === "event");
    const ignored = parsed.items.length - eventItems.length;
    if (eventItems.length === 0) {
      ingest.touchKey(userId, record.id);
      return {
        status: 200,
        json: { id: parsed.header?.event_id ?? null, ingested: 0, ignored },
      };
    }
    // Validate everything before ingesting anything: a malformed
    // event 400s the envelope whole rather than half-landing it.
    const mapped = [];
    for (const item of eventItems) {
      const m = mapEventToIssue(item.payload);
      if (!m.ok) return fail(400, m.error);
      mapped.push(m.fields);
    }
    for (const fields of mapped) {
      const r = ingest.ingestEvent(userId, projectId, fields);
      if (!r.ok) {
        // The one realistic failure is the project having been deleted
        // after the key was created — the key cascade normally prevents
        // even that; anything else is a server fault.
        return r.error === "project not found"
          ? fail(404, "project not found")
          : fail(500, "ingest failed");
      }
    }
    ingest.touchKey(userId, record.id);
    return {
      status: 200,
      json: {
        id: mapped[0].eventId,
        ingested: mapped.length,
        ...(ignored > 0 ? { ignored } : {}),
      },
    };
  }

  return { handle };
}
