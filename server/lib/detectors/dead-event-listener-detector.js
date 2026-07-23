// server/lib/detectors/dead-event-listener-detector.js
//
// Catches the "ghost event" pattern — `window.dispatchEvent(new
// CustomEvent('foo:bar'))` with no `addEventListener('foo:bar', …)`
// anywhere in the codebase. The button isn't a ghost click (the
// dispatch fires), but the EVENT is a ghost — nothing listens, so
// the user-visible result is the same: a click that does nothing.
//
// This detector is the wiring complement to frontend-ghost-click —
// that one ensures every <button> has an onClick; this one ensures
// every dispatched event has a subscriber.
//
// Scope: namespaced events only (those containing `:` like
// `media:like`, `world-hud:trade`). Bare DOM events (`click`,
// `keydown`, etc.) are ignored — they're standard browser events
// dispatched by the browser, not application code.
//
// Operator opt-out: `@dead-event-ok` annotation on the dispatch line
// or in the listener-side file declaring intent (e.g. "external
// caller subscribes via window-level integration").
//
// ── Extension X2 — listener-side orphans + socket both-directions ─────────
//
// The dispatch-side pass above only catches HALF of the "ghost event"
// problem: a dispatch with no listener. The mirror-image bug is just as
// real — a `window.addEventListener('foo:bar', …)` with NOTHING anywhere
// that ever dispatches 'foo:bar' is exactly as dead. And on the realtime
// layer, a server `realtimeEmit(...)` / `io.emit(...)` / `socket.emit(...)`
// can broadcast into the void if no frontend code ever subscribes, or a
// frontend `subscribe()` / `socket.on()` can wait forever for an event the
// server never sends (a typo, a rename, a copy-pasted listener nobody
// wired up). A verification-audit pass on this branch (commits
// `385fd5a8` / `75d46fb4`) found and fixed ~20 real instances of exactly
// this gap.
//
// CLAUDE.md's own doctrine is why the passes below are conservative: a
// "dead" event has previously turned out to be alive via indirection — a
// `subscribe(evt.name)` reading a shared array of event-name constants.
// Two such indirection patterns are real and load-bearing in this
// codebase today:
//
//   1. Bridge arrays — `SR_BRIDGE_EVENTS` (app/lenses/world/page.tsx) is a
//      literal array of raw socket-event names, each `.on()`'d in a loop
//      and re-dispatched as a derived `concordia:${name.replace(/:/g,
//      '-')}` window CustomEvent; `FORWARDED_EVENTS` (hooks/useSocket.ts)
//      is a literal array of socket-event names each `.on()`'d in a loop
//      and forwarded to the frontend event bus. A window listener or a
//      socket name that's only wired via one of these arrays is alive,
//      not orphaned — collectArrayIndirection() below detects the
//      general shape (an array literal with 2+ namespaced string
//      literals) without hardcoding either array's name.
//   2. Dynamic-dispatch equality chains — hooks/useSocket.ts also
//      special-cases several event names via `event === ('name' as
//      SocketEvent)` guards before a single dynamic
//      `dispatchEvent(new CustomEvent(event as string, …))` call. The
//      literal-string DISPATCH_RE above can't see this (the CustomEvent
//      argument is a variable, not a literal) — `refusal:compound-
//      threshold`'s only real dispatcher is this chain, so treating it
//      as undispatched would be a false positive against fixed, working
//      code. collectEqChainIndirection() below detects the shape
//      generically.
//
// A third, unrelated indirection also had to be modeled: server code
// funnels realtime broadcasts through several thin wrapper names, not
// only the canonical `realtimeEmit` (`globalThis._concordRealtimeEmit`
// directly, or assigned to a short local alias like `re`/`emitFn`/`emit`
// and called two lines later — see server/lib/achievement-engine.js and
// the various server/emergent/*-cycle.js modules). collectServerEmits()
// resolves the direct calls and the single-hop alias-assignment case;
// a best-effort "loose" pass (any `*emit*(...)` / `*.on(...)` call,
// regardless of receiver name) is used ONLY to further suppress
// candidates, never to manufacture new ones — consistent with this
// section's explicit bias toward under-flagging two-directional,
// uncertain wiring.
//
// Severity: all three new finding kinds are `medium`, matching the
// existing dead-dispatch rule. Annotate a false positive with
// `@dead-event-ok` on the listener/subscribe line (same mechanism as
// the dispatch-side rule) to suppress it.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError, SEVERITY_ORDER } from "./_framework.js";

const CATEGORY = "dead-event-listener";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

// Walk frontend + mobile for both dispatchers and listeners. Server-
// side dispatches don't apply here (the back end uses socket.io for
// realtime, not CustomEvent).
const SCAN_DIRS = [
  "concord-frontend/app",
  "concord-frontend/components",
  "concord-frontend/lib",
  "concord-frontend/hooks",
];
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "coverage", "dist", "build", "out",
  "__tests__", "stories", "storybook",
]);
const ANNOTATION_OK_RE = /@dead-event-ok\b/;

function isInteresting(file) {
  return /\.(tsx|jsx|ts|js)$/.test(file);
}

async function* walk(root, base = root) {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) yield* walk(root, full);
    else if (entry.isFile() && isInteresting(entry.name)) yield path.relative(root, full);
  }
}

function shouldScan(rel) {
  if (!SCAN_DIRS.some(p => rel.startsWith(p + "/"))) return false;
  if (/\.(test|spec|stories)\.(tsx|ts|jsx|js)$/.test(rel)) return false;
  return true;
}

// Dispatch: `window.dispatchEvent(new CustomEvent('name', ...))`
// We accept both `window.dispatchEvent` and bare `dispatchEvent` (some
// components destructure or assign to a local). The match captures the
// event name in the first string-literal arg of CustomEvent.
const DISPATCH_RE = /\b(?:window\.)?dispatchEvent\s*\(\s*new\s+CustomEvent\s*\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;

// Listener: `addEventListener('name', handler, ...)` or
// `useEventListener('name', ...)` (project hook). React's
// `window.addEventListener` in useEffect is the dominant pattern.
const LISTENER_RE = /\b(?:window\.)?addEventListener\s*\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;
const USE_LISTENER_RE = /\buseEventListener\s*\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;
// Handler-map pattern: a file that also calls `addEventListener` with
// a dynamic name (over `Object.entries(handlers)`) is usually a
// central event router. Its handler map is an object literal whose
// keys are namespaced event names. Collect those keys as listeners.
const HANDLER_MAP_KEY_RE = /['"`]([a-zA-Z][\w-]*:[a-zA-Z][\w:.-]*?)['"`]\s*:/g;

// ── Extension X2 regexes ────────────────────────────────────────────────

// Broader-than-DISPATCH_RE: also matches `new Event(...)` (bare Event,
// not CustomEvent — e.g. `window.dispatchEvent(new Event('conkay:summon'))`
// in components/common/CommandPalette.tsx). Used ONLY to build the
// "is this name dispatched anywhere, in any form" set that feeds the
// listener-orphan check (dimension 1) — the pinned dispatch-side rule
// above intentionally keeps using the narrower DISPATCH_RE so its
// existing behavior doesn't change.
const DISPATCH_ANY_RE = /\b(?:window\.)?dispatchEvent\s*\(\s*new\s+(?:CustomEvent|Event)\s*\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;

// A file contains a *dynamic* dispatch when `new CustomEvent(`/`new Event(`
// is immediately followed by something other than a quote — i.e. the
// event name is a variable, not a literal (hooks/useSocket.ts's universal
// forwarder: `dispatchEvent(new CustomEvent(event as string, ...))`).
const DYNAMIC_DISPATCH_RE = /dispatchEvent\s*\(\s*new\s+(?:CustomEvent|Event)\s*\(\s*(?!['"`])/;
// Inside a file with a dynamic dispatch, an `event === ('name' as X)` (or
// bare `event === 'name'`) guard names exactly which literal event names
// get funneled through that one dynamic dispatch call.
const EQ_CHAIN_RE = /===\s*\(?\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;

// A "bridge array" is a literal array containing 2+ namespaced string
// literals (SR_BRIDGE_EVENTS, FORWARDED_EVENTS, EmergentEventFeed.tsx's
// `TRACKED_EVENTS: { name: SocketEvent; ... }[]`). Every name inside one
// is wired somehow (`.on()`'d/`subscribe()`'d in a loop, or read as
// `evt.name` off an array of objects) even though no single literal
// `dispatchEvent(...)`/`subscribe(...)` call names it — this is
// literally CLAUDE.md's own cited false-positive precedent ("a 'dead'
// event that was consumed via a subscribe(evt.name) data array").
// The cap is generous (20000 chars, not the naive 4000 first tried
// here) because both real arrays in this codebase exceed 4000:
// FORWARDED_EVENTS (hooks/useSocket.ts) is ~4.6KB and EmergentEventFeed's
// TRACKED_EVENTS (an array of `{ name, channel, label }` objects, not
// bare strings) is ~9.5KB — a smaller cap silently produces zero
// suppression for exactly the two arrays this heuristic exists for.
const ARRAY_BLOCK_RE = /\[([^[\]]{0,20000})]/g;
const ARRAY_STRLIT_RE = /['"`]([a-zA-Z][\w:.-]*?)['"`]/g;

// Evidence that a file actually computes the SR_BRIDGE_EVENTS-style
// window-bridge name (`` `concordia:${kind.replace(/:/g, '-')}` ``) —
// gates whether the derived form gets added to the dispatched-indirect
// pool (see the call site for why this must not be unconditional).
const CONCORDIA_BRIDGE_TRANSFORM_RE = /`concordia:\$\{[^}]*\.replace\(/;

// Namespaced event names must have real content on both sides of the
// colon — a bare "quest:" or "world:event:" is a category-prefix filter
// (see app/lenses/event-timeline/page.tsx's `{ Quest: ['quest:', ...] }`
// legend), not a real event name. Reject those so they don't pollute the
// indirection pools or (worse) show up as a "finding" with a bogus name.
function isFullEventName(name) {
  return isNamespaced(name) && !name.startsWith(":") && !name.endsWith(":");
}

// Server-side realtime emit surface. `realtimeEmit` (server.js) and its
// documented alias `globalThis._concordRealtimeEmit` (used so emergent/
// modules don't need to import server.js) are the two canonical entry
// points; this also matches a one-hop local-variable alias
// (`const re = globalThis._concordRealtimeEmit; ...; re("name", ...)`),
// which several server/emergent/*-cycle.js modules use.
const REALTIME_EMIT_RE = /\b(?:_concordRealtimeEmit|realtimeEmit)\s*\??\.?\s*\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;
const EMIT_ALIAS_DECL_RE = /\b(?:const|let)\s+(\w+)\s*=\s*[^;\n]*?(?:_concordRealtimeEmit|realtimeEmit)\b/g;

// Raw socket.io emit: the receiver must plausibly BE a socket/IO manager
// (identifier ending in "socket"/"Socket"/"io"/"Io" — `io.emit(`,
// `socket.emit(`, `worldSocket.emit(`, `req.app.locals.io?.to(...).emit(`)
// — NOT a bare `.emit(` (that also matches unrelated internal Node
// `EventEmitter` instances like `this.emitter.emit(...)` in
// server/mind-space/cognitive-bridge.js, which never reaches a browser).
// `?.` shows up in three independent places in real call chains
// (`req.app.locals.io?.to(...)?.emit?.(...)`) — every optional-chain
// point below is deliberately tolerant of an optional `?.`.
const SOCKET_EMIT_RE = /\b\w*(?:[Ss]ocket|[Ii]o)\??\.(?:to\([^)]*?\)\s*\??\.\s*)?emit\s*\??\.?\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;
const SOCKET_ON_RE = /\b\w*(?:[Ss]ocket|[Ii]o)\??\.on\s*\??\.?\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;

// Frontend's canonical subscribe helper (lib/realtime/socket.ts). Allows
// an optional TypeScript generic (`subscribe<{ runId?: string }>(...)`) —
// without this, every generic-typed call site is invisible to a naive
// `subscribe\s*\(` match (this is a real, previously-undetected gap: the
// ConKay HUD's `macro:started`/`macro:stage`/`macro:completed`
// subscriptions are all generic-typed).
const SUBSCRIBE_RE = /\bsubscribe\s*(?:<[\s\S]{0,300}?>)?\s*\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;

// event-shapes.js registry keys — a curated, human-maintained list of
// "real, frontend-facing" socket events (see server/lib/event-shapes.js).
// Membership is treated as a high-confidence server-emit signal even when
// the emit call site itself is missed by the regexes above.
const EVENT_SHAPES_KEY_RE = /"([a-zA-Z][\w:.-]*?)":\s*\{/g;

// Loose rescue-only passes: broader than the precise regexes above, and
// used ONLY to further suppress candidates that already failed the
// precise cross-check — they never manufacture a new finding. This is
// the "only report when you can positively confirm NEITHER channel
// exists" contract: a bare `on('name', cb)` returned from a `useSocket()`
// hook (components/social/SharedSessionChat.tsx: `const { on, off } =
// useSocket(...)`) or a bespoke per-user emit helper
// (`_emit(userId, "name", payload)`, `deps.emitToUser(uid, "name", ...)`)
// are both real wiring this file's precise regexes cannot resolve
// without tracing variable definitions across files.
const LOOSE_FE_CONSUME_RE = /\b(?:on|off|subscribe|useEvent|onEvent|addEventListener)\s*(?:<[\s\S]{0,200}?>)?\s*\??\.?\(\s*['"`]([a-zA-Z][\w:.-]*?)['"`]/g;
// A dependency-injected `emit` callback param called as `emit?.("name", ...)`
// (server/lib/council-theater.js) is common enough to need the same `?.`
// tolerance before the paren as the precise regexes above.
const LOOSE_SERVER_EMIT_RE = /\b\w*[Ee]mit\w*\s*\??\.?\(\s*(?:[^,()'"`]{0,80},\s*)?['"`]([a-zA-Z][\w:.-]*?)['"`]/g;

// Namespaces that ride an alternate realtime transport (WebRTC peer
// signaling relay, Yjs y-websocket collab) where the server both
// receives AND relays the SAME literal name via a `relay(name)`-style
// factory or a Yjs awareness/doc channel — invisible to a literal-arg
// `.emit(` scan. Exempt from the socket-both-directions checks entirely
// rather than risk a confident-looking false positive.
const NON_SOCKETIO_PREFIXES = ["liveshare:", "webrtc:", "stun:", "turn:"];
function isNonSocketIoTransport(name) {
  return NON_SOCKETIO_PREFIXES.some((p) => name.startsWith(p));
}

const SERVER_SCAN_DIRS = ["server"];
const SERVER_SKIP_DIRS = new Set([
  "node_modules", ".git", "tests", "migrations", "data",
  "__tests__", "coverage", "dist", "build",
]);
function shouldScanServer(rel) {
  if (!SERVER_SCAN_DIRS.some((p) => rel === p || rel.startsWith(p + "/"))) return false;
  if (/\.(test|spec)\.(tsx|ts|jsx|js)$/.test(rel)) return false;
  return true;
}
async function* walkServer(root, base = root) {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (SERVER_SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) yield* walkServer(root, full);
    else if (entry.isFile() && isInteresting(entry.name)) yield path.relative(root, full);
  }
}

/**
 * Given a file's content, collect every namespaced name that appears
 * inside an array literal alongside 2+ other namespaced literals (the
 * "bridge array" shape). Returns a plain array (may contain duplicates
 * across multiple array blocks in the same file — callers dedupe via
 * Set).
 */
function collectArrayIndirection(content) {
  const names = [];
  const blockRe = new RegExp(ARRAY_BLOCK_RE.source, "g");
  let bm;
  while ((bm = blockRe.exec(content)) != null) {
    const body = bm[1];
    const found = [];
    const strRe = new RegExp(ARRAY_STRLIT_RE.source, "g");
    let sm;
    while ((sm = strRe.exec(body)) != null) {
      if (isFullEventName(sm[1])) found.push(sm[1]);
    }
    // Require 2+ names so a single incidental colon-containing string in
    // an unrelated array (e.g. a CSS/ICE-server config array) doesn't
    // get treated as an event-name roster.
    if (found.length >= 2) names.push(...found);
  }
  return names;
}

// `useRealtimeRefresh(['a:b', 'c:d'], refresh, opts)` (hooks/
// useRealtimeRefresh.ts) is a fourth real indirection pattern, distinct
// from the "bridge array" shape above: the array is passed INLINE as a
// call argument (not assigned to a named constant iterated in a loop
// elsewhere), and — critically — it is frequently a SINGLE-item array
// (`useRealtimeRefresh(['climbing:route-completed'], ...)`), so the
// bridge-array heuristic's "2+ names" threshold (needed there to avoid
// false-matching an unrelated array) would silently miss it. The hook's
// own contract makes a single name just as real evidence of a live
// subscription as two: `useRealtimeRefresh` unconditionally calls
// `subscribe(evt, ...)` for every entry (see the hook source) — there is
// no other array shape this call takes. Verified false positive this
// pattern was hiding: `climbing:route-completed`
// (concord-frontend/components/world/ClimbingTracker.tsx) previously
// reported as a dead `dead_socket_emit`.
const USE_REALTIME_REFRESH_RE = /\buseRealtimeRefresh\s*\(\s*\[([^[\]]{0,4000})]/g;

/**
 * Given a file's content, collect every namespaced literal passed inside
 * a `useRealtimeRefresh([...])` call's event-list argument. No minimum
 * count — see the note above USE_REALTIME_REFRESH_RE for why 1 is enough
 * evidence here (unlike the generic bridge-array heuristic).
 */
function collectRealtimeRefreshIndirection(content) {
  const names = [];
  const callRe = new RegExp(USE_REALTIME_REFRESH_RE.source, "g");
  let cm;
  while ((cm = callRe.exec(content)) != null) {
    const body = cm[1];
    const strRe = new RegExp(ARRAY_STRLIT_RE.source, "g");
    let sm;
    while ((sm = strRe.exec(body)) != null) {
      if (isFullEventName(sm[1])) names.push(sm[1]);
    }
  }
  return names;
}

/**
 * Given a file's content, collect namespaced names referenced in an
 * `event === 'name'` (or `=== ('name' as SocketEvent)`) equality chain,
 * but ONLY when the same file also contains a dynamic
 * `dispatchEvent(new CustomEvent(<variable>, ...))` call — i.e. the file
 * plausibly funnels those exact names through that one dynamic dispatch
 * (hooks/useSocket.ts's universal forwarder). Also derives the
 * `concordia:${name}` bridge form some of those forwards use (the
 * brawl-invited/brawl-started special case), since the derived name is
 * what a window listener would actually be registered under.
 */
function collectEqChainIndirection(content) {
  const names = [];
  if (!DYNAMIC_DISPATCH_RE.test(content)) return names;
  const re = new RegExp(EQ_CHAIN_RE.source, "g");
  let m;
  while ((m = re.exec(content)) != null) {
    const raw = m[1];
    if (isFullEventName(raw)) names.push(raw);
    names.push(`concordia:${raw}`);
  }
  return names;
}

function lineNumberAt(content, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

function isInsideComment(content, idx) {
  // Skip dispatches that appear inside `//` line comments or `/* */`
  // block comments (JSDoc). Plaintext mentions of dispatchEvent in
  // documentation would otherwise generate false-positive findings.
  // Same algorithm as the frontend-ghost-click detector.
  let lineStart = idx;
  while (lineStart > 0 && content[lineStart - 1] !== "\n") lineStart--;
  let inStr = "";
  for (let i = lineStart; i < idx; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "/" && content[i + 1] === "/") return true;
  }
  let blockOpen = -1;
  inStr = "";
  for (let i = 0; i < idx - 1; i++) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = "";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (blockOpen === -1) {
      if (ch === "/" && content[i + 1] === "*") { blockOpen = i; i++; }
    } else {
      if (ch === "*" && content[i + 1] === "/") { blockOpen = -1; i++; }
    }
  }
  return blockOpen !== -1;
}

function isNamespaced(name) {
  // A custom application event always contains a colon separator
  // (concordia:emote, world-hud:trade). Bare DOM events (click,
  // keydown, message, beforeunload) are dispatched by the browser
  // and are out of scope.
  return name.includes(":");
}

export async function runDeadEventListenerDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || REPO_ROOT;
  const findings = [];
  const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : 5000;
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
  let scanned = 0;

  // Pass 1: collect every namespaced event name that's listened to.
  const listenedTo = new Set();
  // Pass 1+2 must inspect the same file set, so we materialise the
  // file list once and reuse it.
  const files = [];
  try {
    for await (const rel of walk(repoRoot)) {
      if (!shouldScan(rel)) continue;
      files.push(rel);
      if (files.length >= fileCap) break;
    }
  } catch (err) {
    return makeError(CATEGORY, "walk_threw", err, t0);
  }

  try {
    for (const rel of files) {
      let content;
      try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
      // File-level opt-out for listener-side files only suppresses
      // findings on dispatches; listeners are always collected.
      const matchers = [
        new RegExp(LISTENER_RE.source, "g"),
        new RegExp(USE_LISTENER_RE.source, "g"),
      ];
      for (const re of matchers) {
        let m;
        while ((m = re.exec(content)) != null) {
          const name = m[1];
          if (isNamespaced(name)) listenedTo.add(name);
        }
      }
      // Handler-map heuristic: if this file calls addEventListener
      // with a dynamic name (no string literal — common for a central
      // event router that iterates Object.entries), treat every
      // namespaced object-literal key in the file as a listener.
      // We detect this by a non-string-literal addEventListener call.
      if (/\b(?:window\.)?addEventListener\s*\(\s*[a-zA-Z_$]/.test(content)) {
        const keyRe = new RegExp(HANDLER_MAP_KEY_RE.source, "g");
        let m;
        while ((m = keyRe.exec(content)) != null) {
          listenedTo.add(m[1]);
        }
      }
    }

    // Pass 2: report dispatchers whose event has no listener.
    const dispatchedNotListened = new Map(); // name → first-occurrence finding
    for (const rel of files) {
      if (findings.length >= findingCap) break;
      let content;
      try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
      scanned++;
      const fileLines = content.split("\n");
      const re = new RegExp(DISPATCH_RE.source, "g");
      let m;
      while ((m = re.exec(content)) != null) {
        const name = m[1];
        if (!isNamespaced(name)) continue;
        if (listenedTo.has(name)) continue;
        if (isInsideComment(content, m.index)) continue;
        const lineNum = lineNumberAt(content, m.index);
        const here = fileLines[lineNum - 1] || "";
        const prev = fileLines[lineNum - 2] || "";
        if (ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev)) continue;
        if (dispatchedNotListened.has(name)) continue;
        dispatchedNotListened.set(name, true);
        findings.push({
          id: "dead_event_dispatch",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `CustomEvent '${name}' is dispatched but no addEventListener / useEventListener subscribes to it — the dispatch is a no-op (ghost event).`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "custom_event", file: rel, eventName: name },
          fixHint: `Add window.addEventListener('${name}', handler) in the consuming component or the central event router (concord-frontend/lib/event-router.ts), OR remove the dispatch if the event is no longer needed.`,
        });
        if (findings.length >= findingCap) break;
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  report.listenedToCount = listenedTo.size;

  // ── Extension X2 ──────────────────────────────────────────────────────
  // Runs after the pinned dispatch-side logic and in its own try/catch so
  // a bug here can never regress the dispatch-side rule's report. On
  // failure this section silently adds no findings (report.ok stays true
  // — the base detector still did its job).
  try {
    await runExtensionX2({ repoRoot, opts, files, report });
  } catch (err) {
    report.x2Error = err?.message || String(err);
  }

  // runExtensionX2 pushes onto report.findings in place (same array
  // makeReport() already summarised above) — recompute the summary so
  // the three new finding kinds are actually counted.
  const summary = { total: report.findings.length, critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of report.findings) {
    const sev = SEVERITY_ORDER[f.severity] != null ? f.severity : "info";
    summary[sev] = (summary[sev] ?? 0) + 1;
  }
  report.summary = summary;

  return report;
}

/**
 * Re-reads the already-walked frontend file list plus a fresh server-side
 * walk to add three finding kinds to `report.findings` in place:
 *   - dead_event_listener       (window/useEventListener orphan)
 *   - dead_socket_emit          (server realtime emit, no frontend consumer)
 *   - orphan_socket_consumer    (frontend subscribe/on, no server emit)
 */
async function runExtensionX2({ repoRoot, opts, files, report }) {
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
  const findings = report.findings;

  // Re-read frontend files once, building every collection Pass
  // 3/4/5 need. A third read of an already-small, already-walked file set
  // is cheap relative to correctness (this detector runs off the hot
  // path — a heartbeat sweep or a manual CLI invocation, not per-request).
  const listenerSites = new Map(); // name -> { rel, index }[]
  const dispatchedIndirect = new Set();
  const feDirectConsumed = new Map(); // name -> rel[] (subscribe()/.on() literal, high confidence)
  const feLooseConsumed = new Set(); // rescue-only, never a source of new findings
  const arraySuppressionNames = new Set(); // safety net for socket direction A only

  for (const rel of files) {
    let content;
    try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }

    // Indirection pools (dimension 1 dispatch-equivalents). The
    // `concordia:${name-with-dashes}` window-bridge form is only derived
    // when THIS file actually computes it (app/lenses/world/page.tsx's
    // SR_BRIDGE_EVENTS: `` `concordia:${kind.replace(/:/g, '-')}` ``) —
    // deriving it unconditionally for every bridge array is wrong: e.g.
    // EmergentEventFeed.tsx's TRACKED_EVENTS array also lists
    // 'dream:composed' and 'prediction:realised' (it's a pure read-only
    // feed display, no window-bridge transform at all), and blindly
    // deriving 'concordia:dream-composed' / 'concordia:prediction-
    // realised' from it would coincidentally — and wrongly — suppress
    // two real dead listeners in DreamReader.tsx / ForwardPredictions
    // Panel.tsx that happen to share those exact derived names.
    const hasConcordiaBridgeTransform = CONCORDIA_BRIDGE_TRANSFORM_RE.test(content);
    for (const n of collectArrayIndirection(content)) {
      dispatchedIndirect.add(n);
      if (hasConcordiaBridgeTransform) dispatchedIndirect.add(`concordia:${n.replace(/:/g, "-")}`);
      arraySuppressionNames.add(n);
    }
    for (const n of collectEqChainIndirection(content)) dispatchedIndirect.add(n);
    // useRealtimeRefresh(['a:b', ...], refresh, opts) — see the note above
    // USE_REALTIME_REFRESH_RE. Feeds the same Pass-4 (dead_socket_emit)
    // suppression pool the bridge-array heuristic does; unlike that one,
    // a single name is sufficient evidence (the hook's own contract, not
    // an incidental array shape).
    for (const n of collectRealtimeRefreshIndirection(content)) arraySuppressionNames.add(n);

    // Listener sites (window.addEventListener / useEventListener), namespaced
    // only. Also NOT gated on isInsideComment() — empirically, this
    // codebase's near-universal JSDoc header style ("...the player's
    // current context...", "...doesn't...") means almost every file has
    // an apostrophe inside its very first block comment, which — per the
    // note above — poisons isInsideComment()'s quote-tracking for the
    // rest of the file. Verified concretely: components/world/
    // SystemPrompter.tsx's header comment ("the player's current
    // context") made isInsideComment() misreport its OWN real
    // `window.addEventListener('concordia:context-update', ...)` 14
    // lines later as "inside a comment", silently hiding a genuine dead
    // listener from this pass. The residual risk of skipping the check
    // (a comment containing the literal, exact call syntax
    // `window.addEventListener('name', ...)`) is low for this codebase's
    // prose-comment style, and reviewable via `@dead-event-ok` if it
    // ever produces a false positive.
    for (const re of [new RegExp(LISTENER_RE.source, "g"), new RegExp(USE_LISTENER_RE.source, "g")]) {
      let m;
      while ((m = re.exec(content)) != null) {
        const name = m[1];
        if (!isFullEventName(name)) continue;
        if (!listenerSites.has(name)) listenerSites.set(name, []);
        listenerSites.get(name).push({ rel, index: m.index });
      }
    }

    // Socket consumption, precise (subscribe()/`<Socket|Io>`-suffixed `.on()`).
    //
    // NOTE: deliberately NOT gated on isInsideComment() here (unlike the
    // pinned dispatch-side Pass 2 above). isInsideComment()'s naive
    // quote-tracking state machine does not know it's already inside a
    // `/* */` block comment, so a single apostrophe in ANY earlier
    // block-comment ("the palette's...", "doesn't...") poisons its
    // `inStr` tracking and makes it misreport every subsequent match in
    // the file as "inside a comment" — verified against the real repo
    // (concord-frontend/components/common/CommandPalette.tsx has such a
    // comment at a low line number, which made isInsideComment() wrongly
    // swallow the real `window.dispatchEvent(new CustomEvent('concordia:
    // start-mode', ...))` several hundred lines later during
    // development of this extension). Skipping the check here can only
    // ADD a name to a suppression/candidate pool from a comment-only
    // mention — which can only cause a missed finding, never a false
    // hard flag — so it's the correct trade-off for these two-directional,
    // already-conservative checks. The pinned Pass 2 above is left
    // exactly as it shipped; this note does not change its behavior.
    for (const re of [new RegExp(SUBSCRIBE_RE.source, "g"), new RegExp(SOCKET_ON_RE.source, "g")]) {
      let m;
      while ((m = re.exec(content)) != null) {
        const name = m[1];
        if (!isFullEventName(name)) continue;
        if (!feDirectConsumed.has(name)) feDirectConsumed.set(name, []);
        feDirectConsumed.get(name).push(rel);
      }
    }

    // Loose rescue pass (bare on()/off()/subscribe()/useEvent()/onEvent()/
    // addEventListener() with ANY receiver) — suppression-only.
    const looseRe = new RegExp(LOOSE_FE_CONSUME_RE.source, "g");
    let lm;
    while ((lm = looseRe.exec(content)) != null) {
      if (isFullEventName(lm[1])) feLooseConsumed.add(lm[1]);
    }
  }

  // ── Pass 3: listener-side orphans ────────────────────────────────────
  // "Any dispatch, in any form" is recomputed here (rather than threaded
  // through from Pass 2, which is scoped inside its own try block and
  // deliberately left untouched) — cheap given the already-small,
  // already-walked frontend file set.
  const dispatchedAnywhere = new Set(dispatchedIndirect);
  for (const rel of files) {
    let content;
    try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
    // Not gated on isInsideComment() — see the note above feDirectConsumed
    // for why (the check is unreliable past the first apostrophe-in-a-
    // block-comment in a file, and skipping it here only ever enlarges a
    // suppression set, never creates a hard finding).
    const anyRe = new RegExp(DISPATCH_ANY_RE.source, "g");
    let am;
    while ((am = anyRe.exec(content)) != null) {
      if (isFullEventName(am[1])) dispatchedAnywhere.add(am[1]);
    }
  }

  const listenerOrphanReported = new Set();
  for (const [name, sites] of listenerSites) {
    if (findings.length >= findingCap) break;
    if (dispatchedAnywhere.has(name)) continue;
    if (listenerOrphanReported.has(name)) continue;
    const { rel, index } = sites[0];
    let content;
    try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
    const lineNum = lineNumberAt(content, index);
    const fileLines = content.split("\n");
    const here = fileLines[lineNum - 1] || "";
    const prev = fileLines[lineNum - 2] || "";
    if (ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev)) continue;
    listenerOrphanReported.add(name);
    findings.push({
      id: "dead_event_listener",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: `addEventListener / useEventListener subscribes to '${name}' but nothing anywhere dispatches it — the listener is a no-op (ghost event, reverse direction).`,
      location: `${rel}:${lineNum}`,
      subject: { kind: "custom_event", file: rel, eventName: name },
      fixHint: `Dispatch window.dispatchEvent(new CustomEvent('${name}', { detail })) from the intended source, wire '${name}' through a socket bridge, OR remove the listener if it's no longer needed.`,
    });
  }

  // ── Socket both-directions (dimension 2) ────────────────────────────
  const serverFiles = [];
  try {
    for await (const rel of walkServer(repoRoot)) {
      if (!shouldScanServer(rel)) continue;
      serverFiles.push(rel);
      if (serverFiles.length >= (Number.isFinite(opts.fileCap) ? opts.fileCap : 5000)) break;
    }
  } catch { /* best-effort — an unreadable server tree just yields 0 findings for this dimension */ }

  const serverEmitted = new Map(); // name -> rel[]
  const serverLooseEmitted = new Set(); // rescue-only
  function addServerEmit(name, rel) {
    if (!isFullEventName(name)) return;
    if (!serverEmitted.has(name)) serverEmitted.set(name, []);
    serverEmitted.get(name).push(rel);
  }
  // None of the loops below gate on isInsideComment() — see the note
  // above feDirectConsumed in the frontend collection loop for why
  // (unreliable past the first apostrophe inside a block comment; this
  // matters even more here since server.js is 77k+ lines and virtually
  // guaranteed to have one early). Skipping the check can only add a
  // name to serverEmitted/serverLooseEmitted from a comment-only mention,
  // which can only suppress a would-be finding — never fabricate one.
  for (const rel of serverFiles) {
    let content;
    try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }

    for (const re of [new RegExp(REALTIME_EMIT_RE.source, "g"), new RegExp(SOCKET_EMIT_RE.source, "g")]) {
      let m;
      while ((m = re.exec(content)) != null) {
        addServerEmit(m[1], rel);
      }
    }

    // One-hop alias tracking: `const re = globalThis._concordRealtimeEmit;
    // ... re("name", payload)`.
    const aliasRe = new RegExp(EMIT_ALIAS_DECL_RE.source, "g");
    let alm;
    const aliases = new Set();
    while ((alm = aliasRe.exec(content)) != null) aliases.add(alm[1]);
    for (const alias of aliases) {
      if (!/^[A-Za-z_$][\w$]*$/.test(alias)) continue; // guard against regex-injection from a pathological identifier
      const callRe = new RegExp(`\\b${alias}\\s*\\??\\.?\\(\\s*['"\`]([a-zA-Z][\\w:.-]*?)['"\`]`, "g");
      let cm;
      while ((cm = callRe.exec(content)) != null) {
        addServerEmit(cm[1], rel);
      }
    }

    if (rel.endsWith("event-shapes.js")) {
      const ere = new RegExp(EVENT_SHAPES_KEY_RE.source, "g");
      let em;
      while ((em = ere.exec(content)) != null) addServerEmit(em[1], "event-shapes.js#registry");
    }

    // Loose rescue pass — suppression-only.
    const looseRe = new RegExp(LOOSE_SERVER_EMIT_RE.source, "g");
    let lm;
    while ((lm = looseRe.exec(content)) != null) {
      if (isFullEventName(lm[1])) serverLooseEmitted.add(lm[1]);
    }
  }

  // Pass 4: server emits, no frontend consumer anywhere.
  const socketEmitReported = new Set();
  for (const [name, locs] of serverEmitted) {
    if (findings.length >= findingCap) break;
    if (isNonSocketIoTransport(name)) continue;
    if (feDirectConsumed.has(name)) continue;
    if (arraySuppressionNames.has(name)) continue;
    if (feLooseConsumed.has(name)) continue;
    if (socketEmitReported.has(name)) continue;
    socketEmitReported.add(name);
    const rel = locs[0];
    findings.push({
      id: "dead_socket_emit",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: `Server broadcasts socket event '${name}' but no frontend code subscribes to it (checked subscribe()/socket.on()/bridge-array/window-listener indirection) — the broadcast has no listener.`,
      location: rel === "event-shapes.js#registry" ? "server/lib/event-shapes.js" : rel,
      subject: { kind: "socket_event", file: rel, eventName: name, direction: "server-to-frontend" },
      fixHint: `Add subscribe('${name}', handler) (concord-frontend/lib/realtime/socket.ts) or socket.on('${name}', handler) on the frontend, OR remove the server emit if the feature was retired. This is two-directional, uncertain wiring — verify at runtime before deleting either side.`,
    });
  }

  // Pass 5: frontend consumes, no server emit anywhere.
  const socketConsumerReported = new Set();
  for (const [name, locs] of feDirectConsumed) {
    if (findings.length >= findingCap) break;
    if (isNonSocketIoTransport(name)) continue;
    if (serverEmitted.has(name)) continue;
    if (serverLooseEmitted.has(name)) continue;
    if (socketConsumerReported.has(name)) continue;
    socketConsumerReported.add(name);
    const rel = locs[0];
    findings.push({
      id: "orphan_socket_consumer",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: `Frontend subscribes to socket event '${name}' but no server code ever emits it (checked realtimeEmit/io.emit/socket.emit and common emit-helper aliases) — the subscription will never fire.`,
      location: rel,
      subject: { kind: "socket_event", file: rel, eventName: name, direction: "frontend-consumer-only" },
      fixHint: `Emit '${name}' via realtimeEmit('${name}', payload) (or the equivalent io.emit) from the intended server code path, OR remove the dead subscription if the feature was retired/renamed. This is two-directional, uncertain wiring — verify at runtime before deleting either side.`,
    });
  }
}
