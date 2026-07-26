// Invariant: every literal WebSocket event name in
// concord-frontend/hooks/useRealtimeLens.ts's DOMAIN_EVENTS map has a real
// server-side emitter. Catches the "badge lies pessimistically" bug class —
// a lens keyed to an event nobody ever emits reports a permanent
// isLive=false the moment isLive stops being socket-health-only (which it
// was, at least once, at server.js history — see the hook's own comment).
//
// Root-caused 2026-07-25: the LiveIndicator badge on the world lens showed
// "Disconnected" forever even though the socket was demonstrably healthy,
// because 'world:update' (the fallback event for the un-mapped 'world'
// domain) is never emitted anywhere in server/. The immediate fix lives in
// the hook itself (isLive is now socket-health-only, not gated on any
// domain event ever firing) — but the ROOT CAUSE of why 4 entries had
// silently gone dead in DOMAIN_EVENTS was that nothing checked a mapped
// event actually had an emitter. This test is that check.
//
// Why not a naive `grep -r "realtimeEmit(" server/`: a literal-string scan
// misses the one real indirection in this codebase's realtime-feeds
// module — server/emergent/realtime-feeds.js's `_tickRssDomain(domain,
// feeds, eventName, ...)` helper takes the event name as its 3rd
// parameter and calls `realtimeEmit(eventName, ...)` internally, so the
// literal string never appears as `realtimeEmit`'s own first argument.
// 11 of the 19 real events checked below (legal/government/realestate/
// aviation/insurance/manufacturing/logistics/retail/fitness/agriculture/
// education `:update`) are ONLY visible through this indirection —
// verified by direct reading of realtime-feeds.js, not inferred. A test
// using only the naive scan would report all 11 as false positives
// ("dead"), which is exactly the kind of stale-doc-style false positive
// CLAUDE.md warns is worse than no test at all. resolveTickRssDomainCalls()
// below resolves this one specific, verified indirection by name; it does
// NOT attempt to be a general-purpose indirection resolver (that's
// server/lib/detectors/dead-event-listener-detector.js's job, and even
// that detector's own `collectEmits`-equivalent misses this exact case —
// see server/tests/invariants/emit-subscribe-pairing.test.js's
// `collectEmits()`, which uses the same naive `realtimeEmit("literal"` regex).
//
// When you add a new entry to DOMAIN_EVENTS: either wire a real
// realtimeEmit/socket-emit call for it, or the test fails and tells you
// exactly which name has no emitter. There is deliberately no allowlist —
// every entry that remains in the map after this fix has a verified real
// emitter, so a clean gate (no waivers) is the correct bar going forward.

import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..", "..");
const SERVER_DIR = path.join(ROOT, "server");
const HOOK_FILE = path.join(ROOT, "concord-frontend", "hooks", "useRealtimeLens.ts");

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "coverage", "dist", "build"].includes(entry.name)) continue;
      walkFiles(full, out);
    } else if (entry.isFile() && /\.js$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

// Strips `//` and `/* */` comments (comment-unaware regex scans are how
// the "grade-ux-polish.mjs" trap CLAUDE.md documents happens — a comment
// that *mentions* an event name, e.g. explaining it was removed, would
// otherwise be counted as a live emit site). Loose string-tracking, same
// approach the dead-event-listener-detector.js family uses.
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let inStr = "";
  while (i < n) {
    const ch = src[i];
    if (inStr) {
      out += ch;
      if (ch === "\\") { out += src[i + 1] || ""; i += 2; continue; }
      if (ch === inStr) inStr = "";
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; out += ch; i++; continue; }
    if (ch === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * Extracts the literal event-name strings from the DOMAIN_EVENTS map in
 * useRealtimeLens.ts. Static text extraction (no TS execution needed) —
 * finds the `const DOMAIN_EVENTS: ... = {` declaration, then walks
 * balanced braces to find the matching close, then pulls every quoted
 * string literal out of that span (array values only — the map's keys
 * are bare identifiers, so a quote-scan only ever picks up event names).
 */
function extractDomainEventNames(hookSrc) {
  const stripped = stripComments(hookSrc);
  const declIdx = stripped.indexOf("const DOMAIN_EVENTS");
  assert.ok(declIdx >= 0, "expected to find 'const DOMAIN_EVENTS' in useRealtimeLens.ts — hook structure changed?");
  const braceStart = stripped.indexOf("{", declIdx);
  assert.ok(braceStart >= 0, "expected an opening brace after DOMAIN_EVENTS declaration");

  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < stripped.length; i++) {
    if (stripped[i] === "{") depth++;
    else if (stripped[i] === "}") {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end > braceStart, "unbalanced braces while extracting DOMAIN_EVENTS — hook structure changed?");

  const body = stripped.slice(braceStart, end + 1);
  const names = new Set();
  const strLitRe = /['"]([a-zA-Z][\w:.-]*)['"]/g;
  let m;
  while ((m = strLitRe.exec(body)) != null) names.add(m[1]);
  return names;
}

/**
 * Direct literal emit-call scan: `realtimeEmit("name", ...)` /
 * `_concordRealtimeEmit("name", ...)`, and `<socket|io>.emit("name", ...)`
 * (case-insensitive Emit, `?.` tolerant, matching the same conservative
 * shape used elsewhere in this codebase's detector family — see
 * server/lib/detectors/dead-event-listener-detector.js's
 * REALTIME_EMIT_RE/SOCKET_EMIT_RE, kept as two separate patterns rather
 * than one merged alternation: `realtimeEmit(` already contains the
 * literal substring "Emit", so folding it into a single "receiver +
 * mandatory .emit(" pattern double-counts that suffix and never matches).
 */
const REALTIME_EMIT_RE = /\b(?:realtimeEmit|_concordRealtimeEmit)\s*\??\.?\s*\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;
const SOCKET_EMIT_RE = /\b\w*(?:[Ss]ocket|[Ii]o)\??\.(?:to\([^)]*?\)\s*\??\.\s*)?emit\s*\??\.?\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;

/**
 * Resolves the ONE verified indirection this test needs to see through:
 * server/emergent/realtime-feeds.js's `_tickRssDomain(domainLabel, feeds,
 * eventName, bridgeType, realtimeEmit, opts)` helper. `eventName` is a
 * variable inside the helper, so REALTIME_EMIT_RE can't see it — but every
 * call site passes it as a literal 3rd argument
 * (`_tickRssDomain("legal", _DOMAIN_FEEDS.legal, "legal:update", ...)`),
 * which this regex captures directly.
 */
const TICK_RSS_DOMAIN_CALL_RE = /_tickRssDomain\(\s*["'`]\w+["'`]\s*,\s*[^,]+,\s*["'`]([a-zA-Z][\w:.-]*?)["'`]/g;

function collectLiveServerEvents() {
  const live = new Set();
  for (const f of walkFiles(SERVER_DIR)) {
    if (f.includes(`${path.sep}tests${path.sep}`)) continue;
    if (f.includes(`${path.sep}migrations${path.sep}`)) continue;
    let content;
    try { content = fs.readFileSync(f, "utf8"); } catch { continue; }
    const stripped = stripComments(content);

    for (const re of [REALTIME_EMIT_RE, SOCKET_EMIT_RE, TICK_RSS_DOMAIN_CALL_RE]) {
      const scoped = new RegExp(re.source, "g");
      let m;
      while ((m = scoped.exec(stripped)) != null) live.add(m[1]);
    }
  }
  return live;
}

test("every DOMAIN_EVENTS entry in useRealtimeLens.ts has a real server-side emitter", () => {
  assert.ok(fs.existsSync(HOOK_FILE), `expected to find ${HOOK_FILE}`);
  const hookSrc = fs.readFileSync(HOOK_FILE, "utf8");
  const mappedEvents = extractDomainEventNames(hookSrc);
  const liveEvents = collectLiveServerEvents();

  assert.ok(mappedEvents.size > 0, "expected to find event names inside DOMAIN_EVENTS — extraction regex probably broken");
  assert.ok(liveEvents.size > 0, "expected to find some realtimeEmit/socket-emit calls in server/ — pattern probably broken");

  const dead = [...mappedEvents].filter((e) => !liveEvents.has(e)).sort();

  assert.deepStrictEqual(
    dead,
    [],
    `${dead.length} DOMAIN_EVENTS entr${dead.length === 1 ? "y has" : "ies have"} no real server-side emitter:\n` +
      dead.map((e) => `  - "${e}"`).join("\n") +
      `\n\nThis is exactly the class of bug that made the world-lens LiveIndicator badge lie ` +
      `("Disconnected" while the socket was healthy) — a mapped event that never fires can never ` +
      `honestly gate any UI claim. Either wire a real realtimeEmit(...) call for it in server/, or ` +
      `remove the entry from DOMAIN_EVENTS (concord-frontend/hooks/useRealtimeLens.ts).`,
  );
});

// Sanity check on the extractor + resolver themselves, independent of the
// live DOMAIN_EVENTS map — pins the two indirection classes this file
// depends on (direct literal emit, and the _tickRssDomain 3rd-arg
// indirection) so a future refactor of realtime-feeds.js that silently
// breaks the resolver is caught here, not by a confusing failure in the
// test above.
test("collectLiveServerEvents resolves both known event-emission shapes", () => {
  const live = collectLiveServerEvents();
  // Direct literal realtimeEmit(...) call (server/emergent/realtime-feeds.js#tickFinancialFeeds).
  assert.ok(live.has("finance:ticker"), "expected 'finance:ticker' to be resolved via a direct literal realtimeEmit(...) call");
  // Only reachable via the _tickRssDomain 3rd-argument indirection.
  assert.ok(live.has("legal:update"), "expected 'legal:update' to be resolved via the _tickRssDomain(...) indirection");
});

test("a comment-only mention of an event name is not mistaken for a live emitter", () => {
  // Regression guard for the documented "grade-ux-polish.mjs"-style trap:
  // a source file whose ONLY appearance of a namespaced string is inside
  // a comment (explaining, say, that an event was retired) must not be
  // treated as a real emit site. stripComments() is what prevents this.
  const fakeSrc = [
    "// this file used to call realtimeEmit(\"totally:fake-event\", payload) but no longer does",
    "function noop() { return 1; }",
  ].join("\n");
  const stripped = stripComments(fakeSrc);
  const re = new RegExp(REALTIME_EMIT_RE.source, "g");
  const found = new Set();
  let m;
  while ((m = re.exec(stripped)) != null) found.add(m[1]);
  assert.ok(!found.has("totally:fake-event"), "comment-only mention was incorrectly counted as a live emit site");
});
