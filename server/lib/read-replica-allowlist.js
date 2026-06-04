// server/lib/read-replica-allowlist.js
//
// Read-only replica request gate (horizontal read scale-out).
//
// A replica process (CONCORD_READ_REPLICA=1) opens the DB read-only and may
// serve ONLY vetted pure-read GET endpoints. This module is the default-DENY
// allowlist: a request is allowed on a replica iff it is a GET (or HEAD) AND
// matches a SAFE pattern AND does not match a DANGER pattern. Everything else
// is rejected so it can never reach a write-on-read handler that would throw on
// the readonly handle (SQLITE_READONLY) or mutate divergent in-memory STATE.
//
// nginx already routes only the safe paths to the replica upstream; this gate
// is defense-in-depth so a misrouted or direct request still can't write.
//
// The allowlist is intentionally CONSERVATIVE — it lists endpoints confirmed
// pure-read by the write-purity audit (server/routes/{dtus,worlds,city,feeds,
// atlas}.js, marketplace-lens-registry.js). Widen it only after auditing the
// handler (and, for runMacro-routed GETs, the macro) for zero writes.

// Liveness / scrape endpoints a replica must always answer (no DB writes).
const INFRA = [
  /^\/health\/?$/,
  /^\/ready\/?$/,
  /^\/livez\/?$/,
  /^\/metrics\/?$/,
];

// Confirmed pure-read GET endpoints (write-purity audit). Anchored regexes;
// `:id`-style segments are matched with [^/]+ and trailing query is ignored by
// the caller (it passes req.path, not the querystring).
const SAFE = [
  // DTU substrate (catalog / detail / export / verify) — read-only macros + SELECTs.
  /^\/api\/dtus\/?$/,
  /^\/api\/dtus\/stats\/?$/,
  /^\/api\/dtus\/shadow(\/pending)?\/?$/,
  /^\/api\/dtus\/promotion\/queue\/?$/,
  /^\/api\/dtus\/[^/]+\/?$/,
  /^\/api\/dtu_view\/[^/]+\/?$/,
  /^\/api\/dtu\/[^/]+\/(export|verify-container)\/?$/,
  /^\/api\/megas\/?$/,
  /^\/api\/hypers\/?$/,
  /^\/api\/definitions(\/[^/]+)?\/?$/,
  // Worlds — list/detail/quests/relationships/market/directives/rooms.
  // EXCLUDES /nodes, /buildings, /buildings/:id/interior (lazy-seed / activity writes).
  /^\/api\/worlds\/?$/,
  /^\/api\/worlds\/current\/?$/,
  /^\/api\/worlds\/[^/]+\/?$/,
  /^\/api\/worlds\/[^/]+\/quests(\/active)?\/?$/,
  /^\/api\/worlds\/[^/]+\/npc-relationships\/(gossip-feed|list)\/?$/,
  /^\/api\/worlds\/[^/]+\/emergents\/?$/,
  /^\/api\/worlds\/[^/]+\/market\/?$/,
  /^\/api\/worlds\/[^/]+\/directives\/?$/,
  /^\/api\/worlds\/[^/]+\/buildings\/[^/]+\/rooms\/?$/,
  /^\/api\/worlds\/[^/]+\/frame\/?$/,
  /^\/api\/worlds\/[^/]+\/health\/?$/,
  // Cities, feeds, marketplace browse, atlas, leaderboards — catalog reads.
  /^\/api\/cities(\/[^/]+(\/players)?|\/home)?\/?$/,
  /^\/api\/feeds(\/(health|domains|domain\/[^/]+))?\/?$/,
  /^\/api\/marketplace\/(stats|categories|browse|search|dtu-types|full-summary)\/?$/,
  /^\/api\/marketplace\/(lens\/[^/]+(\/citations|\/full)?|by-category\/[^/]+|by-classification\/[^/]+)\/?$/,
  /^\/api\/atlas\/(tile|volume|material|subsurface|change|coverage|live)\/?$/,
  /^\/api\/leaderboards(\/[^/]+)?\/?$/,
  /^\/api\/player-inventory\/knowledge\/?$/,
];

// Endpoints that LOOK read but mutate on access (write-purity audit DANGER set).
// Matched BEFORE SAFE so a broad world pattern can't admit them.
const DANGER = [
  /^\/api\/worlds\/[^/]+\/nodes\/?$/,                       // seedWorldContent() → INSERT
  /^\/api\/worlds\/[^/]+\/buildings\/?$/,                   // seedWorldContent() → INSERT
  /^\/api\/worlds\/[^/]+\/buildings\/[^/]+\/interior\/?$/,  // recordInteriorActivity() → UPDATE
];

function matchesAny(patterns, p) {
  for (const re of patterns) if (re.test(p)) return true;
  return false;
}

/**
 * Is this request safe to serve on a read-only replica?
 * @param {string} method - HTTP method
 * @param {string} pathname - req.path (NO querystring)
 * @returns {boolean}
 */
export function isReadSafe(method, pathname) {
  const m = String(method || "").toUpperCase();
  if (m === "OPTIONS") return true;          // CORS preflight — no handler write
  if (m !== "GET" && m !== "HEAD") return false; // replicas never write
  if (matchesAny(INFRA, pathname)) return true;
  if (matchesAny(DANGER, pathname)) return false;
  return matchesAny(SAFE, pathname);
}

/**
 * Express middleware factory for the read-only replica gate. No-op (passthrough)
 * unless `enabled` is true, so the writer is unaffected.
 * @param {boolean} enabled - true on a replica process (CONCORD_READ_REPLICA)
 */
export function readReplicaGate(enabled) {
  if (!enabled) return (_req, _res, next) => next();
  return (req, res, next) => {
    if (isReadSafe(req.method, req.path)) return next();
    return res.status(421).json({
      ok: false,
      error: "read_replica_misrouted",
      reason: "This endpoint is not served by a read-only replica; route writes/uncached reads to the writer.",
      method: req.method,
      path: req.path,
    });
  };
}

export const _internal = { SAFE, DANGER, INFRA };
