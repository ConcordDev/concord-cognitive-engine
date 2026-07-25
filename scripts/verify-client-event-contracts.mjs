#!/usr/bin/env node
// scripts/verify-client-event-contracts.mjs
//
// The missing quadrant. Concord already checks three of the four corners of
// frontend<->backend event/call wiring:
//   - scripts/verify-event-consumers.mjs      server EMITS -> any FE consumer?
//   - scripts/check-orphaned-events.mjs       FE dispatches a DOM CustomEvent -> any listener?
//   - server/lib/detectors/dead-macro-call-detector.js   per-call-site macro resolution
//
// Nothing checks: the FRONTEND SUBSCRIBES to a socket.io event that NO server
// path ever emits — a lens listening for `world:update` / `finance:alert` /
// `news:breaking` that nothing ever dispatches, so the feature silently never
// fires. Four such names were found and removed by hand in commit daac9787
// (see concord-frontend/hooks/useRealtimeLens.ts's header comment and
// server/tests/invariants/realtime-lens-event-liveness.test.js, which pins
// that fix for ONE source — the DOMAIN_EVENTS map). This script generalizes
// the same check across every FE subscription surface, as a RATCHET matching
// the CLI shape of verify-event-consumers.mjs (--json, --ci) and the
// allowlist/ratchet mechanics of check-orphaned-events.mjs.
//
// HONEST STATE OF THE TREE (first run, see the triage report this script's
// authoring session produced): this quadrant had never been checked before,
// so — unlike check-orphaned-events.mjs, whose allowlist was curated over
// time to make a clean baseline — the FIRST run of this script surfaces real,
// previously-undetected dead subscriptions (`coop:build:edit`, `fishing:cast`,
// `weather:alert`, and ~24 more — full list + evidence in the authoring
// session's report). Per this project's own anti-cheat rule, they are NOT
// silently allowlisted to force a clean pass — an honest non-zero ratchet is
// the correct state until each is actually fixed (remove the stale
// SocketEvent-union/TRACKED_EVENTS entry, or wire a real emitter). Only
// entries that are genuinely LIVE (verified by hand against server/) but
// unresolvable by static analysis go in ALLOWLIST — see its entries for the
// one case found so far and why.
//
// ── Two traps this file is built to survive ─────────────────────────────────
//
// TRAP 1 (INDIRECTION): a literal-string scan of the server gives the WRONG
// answer. server/emergent/realtime-feeds.js's `_tickRssDomain(domain, feeds,
// eventName, bridgeType, realtimeEmit)` emits `eventName` from INSIDE the
// helper; 11 domains pass their event name as a literal 3RD ARGUMENT at the
// call site, invisible to a scan that only looks at `realtimeEmit("literal"`.
// A naive scan calls all 11 "dead" and would delete live features.
//
// This script does NOT special-case just that one helper (the way
// server/tests/invariants/realtime-lens-event-liveness.test.js does, for
// good reason — it only needs to prove one map). It generalizes: it finds
// every function in server/ whose body passes one of its own PARAMETERS as
// the literal event-name argument to `realtimeEmit(...)` / `.emit(...)` /
// `_concordRealtimeEmit(...)`, records which parameter position that is, then
// resolves every call site of that helper where the argument at that
// position is a string literal. This resolves `_tickRssDomain` (3rd arg) and
// `emitModeToUser`/`emitModeToWorld`/`emitModeToRoom` (3rd arg — the
// horde/mahjong/extraction/time-loop/restaurant/horror/theme-park/roguelite/
// lfg/courtship game-mode HUD events) and any future helper shaped the same
// way, without hardcoding each one by name.
//
// One further level: when a call site passes a BARE IDENTIFIER (not a
// literal) at the resolved event-arg position — e.g.
// `emitModeToUser(io, userId, event, ...)` where `event = _MODE_EVENT[m[1]]`
// — the resolver looks for that identifier's `const X = ...` assignment in
// the same file. If the right-hand side is itself a lookup into an object
// literal (`SOME_TABLE[key]`), every string value in `SOME_TABLE` is
// harvested as live. This is scoped narrowly on purpose: it only fires for
// identifiers already proven (by the step above) to flow into a real
// `.emit()`/`realtimeEmit()` call, so it does NOT rediscover the false-friend
// case this project already hit — `server/lib/feed-manager.js`'s
// `mapDomainToEventType()` table contains the literal string "weather:alert"
// as a VALUE, but that value is used only as a DTU-bridge `type` tag, never
// passed to a real socket emit, so it must NOT count as a live emitter (and
// per the useRealtimeLens.ts audit trail, "weather:alert" really was dead and
// was removed). Because this resolver only walks object-literal tables that
// are provably read by a real emit call, `mapDomainToEventType` is never
// touched by it and this trap is avoided by construction, not by luck.
//
// Where a value truly can't be resolved statically (e.g. a computed template
// string, or a variable threaded through several hops with no literal table
// backing it), the resolver SKIPS it — it is deliberately biased toward
// under-reporting "live" precision misses rather than over-reporting "dead"
// false positives. A false positive here gets the checker muted, which is
// worse than the checker not existing (see CLAUDE.md's anti-cheat section).
//
// TRAP 2 (COMMENTS): a scanner that isn't comment-aware repeatedly flags
// files that were just fixed, because the explanatory comment at the fix
// site quotes the offending pattern verbatim (documented twice already in
// this repo's history). Every source file here is passed through the same
// character-by-character, string/template-literal-aware comment stripper
// used by realtime-lens-event-liveness.test.js before any regex runs.
//
// ── Scope note on the useRealtimeLens `${domain}:update` fallback ──────────
// `useRealtimeLens(domain)` falls back to a computed `${domain}:update` event
// for any domain with no explicit DOMAIN_EVENTS entry (~230 lens domains).
// Per the hook's own header comment (fixed 2026-07-25), `isLive` no longer
// depends on any domain event ever firing — "a domain can be honestly
// connected with hasReceivedData: false ... a genuinely dead server-side
// event" is an EXPLICITLY ACCEPTABLE state for the fallback path; only the
// explicit DOMAIN_EVENTS map entries are asserted to have real emitters
// (exactly what realtime-lens-event-liveness.test.js already pins). Emulating
// that same scope split here: computed fallback names are collected and
// reported for visibility (`fallbackNeverEmitted` in --json output) but are
// NOT part of the hard ratchet — gating on all ~230 of them would either (a)
// fail on today's tree, contradicting "today's tree must pass", or (b)
// require an allowlist entry per lens domain that adds no real signal beyond
// "this lens has no dedicated realtime push yet", which the hook already
// documents as fine. The explicit DOMAIN_EVENTS map, TRACKED_EVENTS,
// FORWARDED_EVENTS, the SocketEvent union, and any literal `.on(`/`subscribe(`
// call ARE gated, because those are affirmative claims that a specific event
// name is real, not a generic degrade-gracefully fallback.
//
// Usage: node scripts/verify-client-event-contracts.mjs [--json] [--ci] [--list]

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'server');
const FE = path.join(ROOT, 'concord-frontend');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const ciMode = args.includes('--ci');
const listOnly = args.includes('--list');

// ═══════════════════════════════════════════════════════════════════════════
// Shared utilities
// ═══════════════════════════════════════════════════════════════════════════

function walk(dir, opts, acc = []) {
  const { exts, excludeDirNames = [], excludeFileRe = null } = opts;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (excludeDirNames.includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, opts, acc);
    else if (exts.some((x) => e.name.endsWith(x))) {
      if (excludeFileRe && excludeFileRe.test(e.name)) continue;
      acc.push(p);
    }
  }
  return acc;
}

// Character-by-character, string/template-literal-aware comment stripper.
// Same shape as server/tests/invariants/realtime-lens-event-liveness.test.js
// (itself modeled on server/lib/detectors/*): tracks whether we're inside a
// '/"/` string so a `//` or `/*` INSIDE a string/URL (e.g. "https://...") is
// never mistaken for a comment start, and a comment that quotes an event
// name in prose is never mistaken for a live reference.
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inStr = '';
  while (i < n) {
    const ch = src[i];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += src[i + 1] || ''; i += 2; continue; }
      if (ch === inStr) inStr = '';
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; out += ch; i++; continue; }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Finds the span of a balanced `{...}` (or `[...]`/`(...)`) starting at the
// index of the opening bracket. Returns the index of the matching close, or
// -1. Ignores brackets that appear inside string/template literals (the
// input is expected to already be comment-stripped, but NOT string-stripped
// — we still need real string contents for extracting the literals inside).
function matchBracket(src, openIdx, openCh, closeCh) {
  let depth = 0;
  let inStr = '';
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Splits a raw argument-list string (the text between a call's parens) into
// top-level arguments, respecting nested (), [], {}, and string/template
// literals so a comma inside a nested structure doesn't split early.
function splitTopLevelArgs(raw) {
  const args = [];
  let depth = 0;
  let inStr = '';
  let cur = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      cur += ch;
      if (ch === '\\') { cur += raw[i + 1] || ''; i++; continue; }
      if (ch === inStr) inStr = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') { depth++; cur += ch; continue; }
    if (ch === ')' || ch === ']' || ch === '}') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim().length) args.push(cur.trim());
  return args;
}

const STRING_LITERAL_RE = /^['"`]([a-zA-Z][\w:.-]*)['"`]$/;

function extractQuotedNames(text) {
  const names = new Set();
  const re = /['"`]([a-zA-Z][\w:.-]*)['"`]/g;
  let m;
  while ((m = re.exec(text)) != null) names.add(m[1]);
  return names;
}

// ═══════════════════════════════════════════════════════════════════════════
// Part A — collect every socket event name the SERVER can actually emit.
// ═══════════════════════════════════════════════════════════════════════════

// Lifecycle / transport-level socket.io events. These are matched by a broad
// `.on(`/`subscribe(` scan on the FE side (useSocket.ts genuinely does
// `socket.on('connect', ...)` etc.) but are never emitted by application code
// as a literal `realtimeEmit`/`.emit(` call — they're dispatched by the
// socket.io engine itself. Same set verify-event-consumers.mjs excludes.
const TRANSPORT = new Set([
  'connection', 'connect', 'disconnect', 'disconnecting', 'close', 'error',
  'reconnect', 'reconnect_attempt', 'reconnect_failed', 'ping', 'pong', 'connect_error',
]);

// Any call whose NAME contains "emit" (case-sensitive on the 'E'/'e', so it
// catches realtimeEmit, _concordRealtimeEmit, .emit, io.emit, socket.emit,
// _emit, emitFn, tryEmit, emitToUser, emitModeToUser, _xpEmitter, ... in one
// pattern — direct enumeration of this codebase's server/ tree turned up
// this many distinct spellings of "the thing that actually calls
// socket.emit", each used as a literal call at real emit sites:
// realtimeEmit, _concordRealtimeEmit, _emit, emit, emitFn, tryEmit,
// emitToUser, emitToWorld, emitToRoom, emitToDoc, emitToSession,
// emitToAstroRoom, emitToUserRoom, emitVoiceToRoom, emitModeToUser,
// emitModeToWorld, emitModeToRoom, xpEmitter (as `_xpEmitter`). Trying to
// hardcode each one is how the false-negative rot happens — every one of
// these was independently found to be missed by a narrower pattern during
// this script's own construction (`achievement:unlocked` via
// `_concordRealtimeEmit?.(` with optional chaining, `career:shift` via a
// bare `emit(`, `level:up` via `_xpEmitter(`, ...). Being broad on the NAME
// is safe here for the same reason the receiver-agnostic `.emit(` was safe:
// it only ever captures a literal when that literal is the call's own FIRST
// argument, which is a narrow, low-risk match regardless of what the
// function turns out to be. `\??\.?` after the name tolerates the
// optional-chaining style (`realtimeEmit?.(`, `.emit?.(`) used throughout
// this codebase's best-effort realtime call sites.
const EMIT_NAME_FRAGMENT = '[\\w]*[Ee]mit[\\w]*';
const DIRECT_EMIT_RES = [
  new RegExp(`\\b${EMIT_NAME_FRAGMENT}\\s*\\??\\.?\\(\\s*['"\`]([a-zA-Z][\\w:.-]*?)['"\`]`, 'g'),
];

// ── Generalized single-hop indirection resolver (subsumes the documented
// `_tickRssDomain` case without hardcoding it) ──────────────────────────────
//
// Step 1: find every `function NAME(p0, p1, ...) { ... }` (incl. `export
// function` and one-line arrow `const NAME = (p0, p1, ...) => { ... }`)
// declaration in server/ whose body — brace-matched, so nested helper
// functions inside don't leak params across scopes — passes one of its own
// parameters as the literal event-name argument to realtimeEmit(...) /
// .emit(...) / _concordRealtimeEmit(...). Record {name, paramIndex}.
// Third alternative handles the one curried-arrow helper found by direct
// read: server/lib/webrtc-signalling.js's
// `const relay = (event) => ({ visitId, sdp, candidate, target } = {}) => {
// ... .emit(event, payload) ... }` — a function that returns a handler
// function rather than being one. Call sites (`relay("webrtc:offer")`) only
// ever supply the OUTER argument (`event`), so the outer params are what
// matters for resolution; the body we brace-match starts after the INNER
// arrow's `{`.
const FN_DECL_RE = /(?:function\s+(\w+)\s*\(([^)]*)\)\s*\{|const\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*\{|const\s+(\w+)\s*=\s*\(([^)]*)\)\s*=>\s*\([^)]*\)\s*=>\s*\{)/g;

// Position-agnostic check: does parameter `p` appear as ANY top-level
// argument (not just the first) to an emit-like call inside `body`? Needed
// for helpers like server/routes/parties.js's locally-scoped
// `const _emit = (uid, event, payload) => { emitToUser?.(uid, event,
// payload); }` — `event` is passed to `emitToUser` at inner-call position 1
// (after `uid`), not position 0, so a "must be the first arg" check misses
// it. We only need a yes/no answer here (does this outer parameter carry an
// event name into a real emit at all); the outer parameter's OWN index
// (tracked by the caller) is what matters for resolving call sites of the
// outer helper.
function paramFlowsToEmitCall(body, paramName) {
  const emitCallRe = new RegExp(`\\b${EMIT_NAME_FRAGMENT}\\s*\\??\\.?\\(`, 'g');
  let m;
  while ((m = emitCallRe.exec(body)) != null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchBracket(body, openIdx, '(', ')');
    if (closeIdx < 0) continue;
    const args = splitTopLevelArgs(body.slice(openIdx + 1, closeIdx));
    if (args.some((a) => a === paramName)) return true;
  }
  return false;
}

function findEmitHelperSignatures(files) {
  // Seed the two root primitives this codebase's realtime layer is built on
  // (confirmed by direct read: server.js defines `function realtimeEmit(event,
  // payload, opts) {...}` and, separately, `globalThis._concordRealtimeEmit =
  // realtimeEmit;` at server.js:8904 — an ALIAS assignment, not its own
  // declaration, so `_concordRealtimeEmit` would never be found by the
  // declaration scan below). Seeding both at paramIndex 0 lets the alias pass
  // (aliasEmitHelpers) resolve the many `const re = globalThis.
  // _concordRealtimeEmit;` local aliases found throughout server/emergent/*.
  const helpers = new Map([
    ['realtimeEmit', new Set([0])],
    ['_concordRealtimeEmit', new Set([0])],
  ]);
  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const stripped = stripComments(content);
    const re = new RegExp(FN_DECL_RE.source, 'g');
    let m;
    while ((m = re.exec(stripped)) != null) {
      const name = m[1] || m[3] || m[5];
      const paramsRaw = m[2] ?? m[4] ?? m[6] ?? '';
      const params = paramsRaw.split(',').map((s) => s.trim().split('=')[0].trim())
        .map((s) => s.replace(/^\{|\}$/g, '').trim());
      if (!name || !params.length) continue;
      const openIdx = m.index + m[0].length - 1; // index of the opening `{`
      const closeIdx = matchBracket(stripped, openIdx, '{', '}');
      if (closeIdx < 0) continue;
      const body = stripped.slice(openIdx, closeIdx + 1);
      for (let idx = 0; idx < params.length; idx++) {
        const p = params[idx];
        if (!/^[a-zA-Z_$][\w$]*$/.test(p)) continue;
        if (paramFlowsToEmitCall(body, p)) {
          if (!helpers.has(name)) helpers.set(name, new Set());
          helpers.get(name).add(idx);
        }
      }
    }
  }
  return helpers;
}

// Step 2: find every call site of a discovered helper anywhere in server/,
// and resolve the argument at the recorded parameter index.
function resolveHelperCallSites(files, helpers) {
  const live = new Set();
  if (helpers.size === 0) return live;
  const namePattern = [...helpers.keys()].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!namePattern) return live;
  const callRe = new RegExp(`\\b(${namePattern})\\s*\\??\\.?\\(`, 'g');

  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const stripped = stripComments(content);
    const re = new RegExp(callRe.source, 'g');
    let m;
    while ((m = re.exec(stripped)) != null) {
      const fnName = m[1];
      const openIdx = m.index + m[0].length - 1; // index of the opening `(`
      const closeIdx = matchBracket(stripped, openIdx, '(', ')');
      if (closeIdx < 0) continue;
      // Skip matching the function's OWN declaration line (already handled
      // by findEmitHelperSignatures) — a decl looks like
      // `function fnName(...)` / `const fnName = (...) =>`, i.e. immediately
      // preceded by "function " or "const " with no other call context.
      const preceding = stripped.slice(Math.max(0, m.index - 10), m.index);
      if (/\bfunction\s+$/.test(preceding) || /\bconst\s+$/.test(preceding)) continue;

      const argsRaw = stripped.slice(openIdx + 1, closeIdx);
      const argList = splitTopLevelArgs(argsRaw);
      for (const paramIndex of helpers.get(fnName)) {
        const arg = argList[paramIndex];
        if (!arg) continue;
        const lit = arg.match(STRING_LITERAL_RE);
        if (lit) { live.add(lit[1]); continue; }
        // Bare identifier or a member/bracket lookup on one — try one more
        // hop: does this exact file assign that identifier from a lookup
        // into an object-literal table? (`const X = TABLE[key]` style.)
        const identMatch = arg.match(/^([a-zA-Z_$][\w$]*)/);
        if (!identMatch) continue;
        const ident = identMatch[1];
        // A direct literal default like `event = "x"` inside a destructure
        // isn't handled here (rare); the identifier-assignment path below
        // covers the two real cases in this codebase (_MODE_EVENT lookup +
        // plain reassignment).
        const assignRe = new RegExp(`\\bconst\\s+${ident}\\s*=\\s*([^;]+);`);
        const assignMatch = stripped.match(assignRe);
        if (!assignMatch) continue;
        const rhs = assignMatch[1].trim();
        const rhsLit = rhs.match(STRING_LITERAL_RE);
        if (rhsLit) { live.add(rhsLit[1]); continue; }
        // `SOME_TABLE[...]` or `SOME_TABLE.prop` — resolve SOME_TABLE's own
        // object-literal definition in the same file and harvest every
        // string VALUE inside it. Scoped to identifiers already proven (by
        // reaching this branch) to flow into a real emit call — this is
        // exactly what keeps it from re-discovering the feed-manager.js
        // `mapDomainToEventType` false-friend (that table's values flow into
        // a DTU-bridge `type` tag, never into one of these helpers, so it is
        // never a candidate here in the first place).
        const tableMatch = rhs.match(/^([a-zA-Z_$][\w$]*)\s*[[.]/);
        if (!tableMatch) continue;
        const tableName = tableMatch[1];
        const tableDeclRe = new RegExp(`\\bconst\\s+${tableName}\\s*=\\s*(?:Object\\.freeze\\()?\\{`);
        const tableDeclMatch = stripped.match(tableDeclRe);
        if (!tableDeclMatch) continue;
        const braceIdx = stripped.indexOf('{', tableDeclMatch.index);
        const braceClose = matchBracket(stripped, braceIdx, '{', '}');
        if (braceClose < 0) continue;
        const tableBody = stripped.slice(braceIdx, braceClose + 1);
        for (const v of extractQuotedNames(tableBody)) live.add(v);
      }
    }
  }
  return live;
}

// Third hop: a module-level variable holding a REFERENCE to an already-known
// emit-helper, rather than calling it directly — e.g.
// server/lib/world-progression.js: `let _xpEmitter = null;` then
// `_xpEmitter = typeof emitToUser === "function" ? emitToUser : null;`, after
// which `_xpEmitter(userId, "level:up", ...)` is the real emit call. Scoped
// per-file (the same de-risking rationale as the object-literal-table hop
// above): only fires when a bare identifier is assigned an expression that
// literally mentions an ALREADY-discovered helper name, so it can only ever
// alias onto something already proven to reach a real `.emit()`.
function aliasEmitHelpers(files, helpers) {
  const knownNames = [...helpers.keys()];
  if (!knownNames.length) return;
  const knownPattern = knownNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const aliasRe = new RegExp(`\\b([a-zA-Z_$][\\w$]*)\\s*=[^;\\n]*\\b(${knownPattern})\\b[^;\\n]*;`, 'g');
  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const stripped = stripComments(content);
    const re = new RegExp(aliasRe.source, 'g');
    let m;
    while ((m = re.exec(stripped)) != null) {
      const [, alias, source] = m;
      if (alias === source || helpers.has(alias)) continue;
      helpers.set(alias, new Set(helpers.get(source)));
    }
  }
}

function collectLiveServerEvents(serverDir = SERVER) {
  const files = walk(serverDir, { exts: ['.js'], excludeDirNames: ['node_modules', '.git', 'tests', 'test', 'migrations', '.next', 'dist', 'build'] });
  const live = new Set();

  for (const f of files) {
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const stripped = stripComments(content);
    for (const re of DIRECT_EMIT_RES) {
      const scoped = new RegExp(re.source, 'g');
      let m;
      while ((m = scoped.exec(stripped)) != null) live.add(m[1]);
    }
  }

  const helpers = findEmitHelperSignatures(files);
  aliasEmitHelpers(files, helpers);
  for (const v of resolveHelperCallSites(files, helpers)) live.add(v);

  return live;
}

// ═══════════════════════════════════════════════════════════════════════════
// Part B — collect every socket event name the FRONTEND subscribes to.
// ═══════════════════════════════════════════════════════════════════════════

function readStripped(relPath) {
  const full = path.join(FE, relPath);
  return stripComments(fs.readFileSync(full, 'utf8'));
}

// (a) Any literal `.on('x')` / `subscribe('x')` / `subscribe<T>('x')` /
// `useSocketEvent('x')` call, anywhere in the frontend tree.
//
// `.on(` alone is FAR too generic to trust blindly — verified by direct scan
// (see the exploration that motivated this filter): the frontend tree also
// has `player.on('play'|'pause'|'ended'|...)` (an audio/video player lib),
// `peer.on('signal'|'stream'|...)` (simple-peer WebRTC, not socket.io),
// `cy.on('tap'|'dbltap'|'mouseover'|...)` (Cytoscape graph), `awareness.on(
// 'update'|'change')` (Yjs awareness), `map.on('click')` (a map library),
// `doc.on('update')` (Yjs doc), and a `bus.on('user:login', ...)` that is
// itself inside a documentation CODE-SAMPLE STRING in app/lenses/code/page.tsx
// (an EventEmitter usage example shown to users, not real subscribing code —
// the same class of false-positive risk as an explanatory comment, but for
// string-literal-embedded sample code instead of prose). None of these are
// socket.io subscriptions and none should ever be checked for a server
// emitter. Only receivers that are demonstrably a real Socket.IO client are
// accepted:
//   - the receiver's last dotted segment matches /socket/i (`socket`,
//     `worldSocket`, `opts.socket` -> `socket`, `mySocket`, ...) — covers
//     every real socket.on(...) site found by direct enumeration except one;
//   - OR the receiver is exactly `io`;
//   - OR the SAME FILE assigns that exact identifier from a real
//     `= io(...)` socket.io-client factory call (covers
//     `components/code/CodeAdvancedPanel.tsx`'s locally-scoped `const s =
//     io(SOCKET_URL, ...)` Live Share connection, whose `.on(` calls use the
//     single-letter alias `s`).
const SOCKET_RECEIVER_RE = /([a-zA-Z_$][\w]*(?:\.[a-zA-Z_$][\w]*)*)\??\.on\(\s*['"`]([a-zA-Z][\w:.-]*)['"`]/g;
const SUBSCRIBE_RE = /\b(?:subscribe|useSocketEvent)(?:<[^>]*>)?\(\s*['"`]([a-zA-Z][\w:.-]*)['"`]/g;

function isSocketReceiver(recv, strippedFileSrc) {
  const lastSegment = recv.split('.').pop();
  if (/socket/i.test(lastSegment)) return true;
  if (lastSegment === 'io') return true;
  const ioAssignRe = new RegExp(`\\b(?:const|let|var)\\s+${recv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*io\\(`);
  return ioAssignRe.test(strippedFileSrc);
}

function collectDirectSubscriptions(feDir = FE) {
  const files = walk(feDir, {
    exts: ['.ts', '.tsx'],
    excludeDirNames: ['node_modules', '.git', '.next', 'dist', 'build'],
  });
  const found = new Map(); // name -> file:line (first occurrence)
  const record = (name, file, index, stripped) => {
    if (TRANSPORT.has(name)) return;
    if (!found.has(name)) {
      const line = stripped.slice(0, index).split('\n').length;
      found.set(name, `${path.relative(ROOT, file)}:${line}`);
    }
  };
  for (const f of files) {
    if (/\.(test|spec)\.tsx?$/.test(f)) continue;
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const stripped = stripComments(content);

    const onRe = new RegExp(SOCKET_RECEIVER_RE.source, 'g');
    let m;
    while ((m = onRe.exec(stripped)) != null) {
      const [, recv, name] = m;
      if (!isSocketReceiver(recv, stripped)) continue;
      record(name, f, m.index, stripped);
    }

    const subRe = new RegExp(SUBSCRIBE_RE.source, 'g');
    while ((m = subRe.exec(stripped)) != null) {
      record(m[1], f, m.index, stripped);
    }
  }
  return found;
}

// (b) hooks/useRealtimeLens.ts — the explicit DOMAIN_EVENTS map (hard-gated)
// plus the computed `${domain}:update` fallback for every OTHER literal
// `useRealtimeLens('x')` call site (reported, not hard-gated — see the
// header comment's "Scope note").
function collectRealtimeLensEvents() {
  const hookSrc = readStripped('hooks/useRealtimeLens.ts');
  const declIdx = hookSrc.indexOf('const DOMAIN_EVENTS');
  if (declIdx < 0) return { mapEvents: new Set(), mapDomains: new Set(), fallbackEvents: new Set() };
  const braceStart = hookSrc.indexOf('{', declIdx);
  const braceEnd = matchBracket(hookSrc, braceStart, '{', '}');
  const body = hookSrc.slice(braceStart, braceEnd + 1);

  const mapEvents = extractQuotedNames(body);
  const mapDomains = new Set();
  const keyRe = /(?:^|\n)\s*([a-zA-Z][\w-]*)\s*:\s*\[/g;
  let km;
  while ((km = keyRe.exec(body)) != null) mapDomains.add(km[1]);

  // Every literal useRealtimeLens('x') call site across the whole frontend.
  const files = walk(FE, { exts: ['.ts', '.tsx'], excludeDirNames: ['node_modules', '.git', '.next', 'dist', 'build'] });
  const fallbackEvents = new Set();
  const callRe = /useRealtimeLens\(\s*['"`]([a-zA-Z][\w-]*)['"`]/g;
  for (const f of files) {
    if (/\.(test|spec)\.tsx?$/.test(f)) continue;
    let content;
    try { content = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const stripped = stripComments(content);
    const re = new RegExp(callRe.source, 'g');
    let m;
    while ((m = re.exec(stripped)) != null) {
      const domain = m[1];
      if (!mapDomains.has(domain)) fallbackEvents.add(`${domain}:update`);
    }
  }
  return { mapEvents, mapDomains, fallbackEvents };
}

// (c) EmergentEventFeed.tsx TRACKED_EVENTS — `{ name: 'x' [as SocketEvent], channel: ... }`
function collectTrackedEvents() {
  const src = readStripped('components/world/EmergentEventFeed.tsx');
  const names = new Set();
  const re = /name:\s*'([a-zA-Z][\w:.-]*)'(?:\s+as SocketEvent)?\s*,\s*channel:/g;
  let m;
  while ((m = re.exec(src)) != null) names.add(m[1]);
  return names;
}

// (d) lib/realtime/socket.ts — the `type SocketEvent = ... ;` union.
function collectSocketEventUnion() {
  const src = readStripped('lib/realtime/socket.ts');
  const blk = src.match(/type SocketEvent\s*=([\s\S]*?);/);
  if (!blk) return new Set();
  return extractQuotedNames(blk[1]);
}

// (e) hooks/useSocket.ts — the FORWARDED_EVENTS array (the universal
// per-socket-event-bus forwarder; every name here gets a real `socket.on(event, ...)`
// registration inside a loop, so the literal names never sit textually next
// to `.on(` the way collectDirectSubscriptions() expects).
function collectForwardedEvents() {
  const src = readStripped('hooks/useSocket.ts');
  const declIdx = src.indexOf('const FORWARDED_EVENTS');
  if (declIdx < 0) return new Set();
  const bracketStart = src.indexOf('[', declIdx);
  const bracketEnd = matchBracket(src, bracketStart, '[', ']');
  if (bracketEnd < 0) return new Set();
  return extractQuotedNames(src.slice(bracketStart, bracketEnd + 1));
}

// ═══════════════════════════════════════════════════════════════════════════
// Part C — allowlist (ratchet). Every entry REQUIRES a written reason.
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWLIST = new Map([
  // Verified LIVE by hand (server/emergent/social-layer.js:24 calls
  // `_socialEmitter(userId, "social:notification", {...})`); the real emit
  // path is `server.js:8832`'s `setSocialEmitter(async (uid, evt, payload) =>
  // { emitToUser(uid, evt, payload); ... })` — an inline callback ARGUMENT
  // (not a named function) whose own parameter `evt` (index 1) flows into
  // `emitToUser` (a known helper). Resolving this generically would require
  // tracing: (1) which literal callback is passed at `setSocialEmitter`'s one
  // call site, (2) that inline callback's own param-to-emit-call mapping,
  // (3) back through `_socialEmitter = fn` inside `setSocialEmitter`'s body
  // to the exported setter — i.e. genuine interprocedural data-flow, not a
  // single extra regex hop like the other indirections this file resolves.
  // Collector limitation, not a forward-looking hook or a dead subscription —
  // flagged here rather than silently miscounted as "new dead".
  ['social:notification', 'verified live by hand: server.js:8832 setSocialEmitter(inline callback) -> emitToUser(uid, evt, payload); emergent/social-layer.js:24 calls it with the literal "social:notification". Static collector cannot trace an inline-callback-argument + module-private-setter chain this deep; see this file\'s header comment.'],
]);

// ═══════════════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════════════

function main() {
  const liveServerEvents = collectLiveServerEvents();

  const direct = collectDirectSubscriptions();
  const { mapEvents, fallbackEvents } = collectRealtimeLensEvents();
  const tracked = collectTrackedEvents();
  const union = collectSocketEventUnion();
  const forwarded = collectForwardedEvents();

  // Hard-gated corpus: every affirmative "this event is real" claim.
  const gatedSources = new Map(); // name -> [source labels]
  const addSource = (set, label) => {
    for (const name of set) {
      if (TRANSPORT.has(name)) continue;
      if (!gatedSources.has(name)) gatedSources.set(name, []);
      gatedSources.get(name).push(label);
    }
  };
  addSource(direct.keys(), 'direct-subscription');
  addSource(mapEvents, 'useRealtimeLens.DOMAIN_EVENTS');
  addSource(tracked, 'EmergentEventFeed.TRACKED_EVENTS');
  addSource(union, 'SocketEvent-union');
  addSource(forwarded, 'FORWARDED_EVENTS');

  const gatedNames = [...gatedSources.keys()].sort();
  const dead = gatedNames.filter((n) => !liveServerEvents.has(n));
  const newDead = dead.filter((n) => !ALLOWLIST.has(n));
  const staleAllowlist = [...ALLOWLIST.keys()].filter((n) => !gatedNames.includes(n) || liveServerEvents.has(n));

  // Informational-only (never gates): the useRealtimeLens computed fallback.
  const fallbackDead = [...fallbackEvents].filter((n) => !liveServerEvents.has(n)).sort();

  const result = {
    scanned: { gatedSubscriptions: gatedNames.length, liveServerEvents: liveServerEvents.size },
    dead: dead.map((n) => ({ name: n, sources: gatedSources.get(n), allowlisted: ALLOWLIST.has(n) })),
    newDead,
    staleAllowlist,
    fallbackNeverEmitted: { count: fallbackDead.length, names: fallbackDead },
  };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('\n=== Client Event Contract Gate (FE subscribes -> server emits?) ===');
    console.log(`gated FE subscriptions: ${gatedNames.length} · live server events resolved: ${liveServerEvents.size}`);
    console.log(`dead: ${dead.length} total, ${ALLOWLIST.size} allowlisted, ${newDead.length} new\n`);

    if (listOnly) {
      for (const n of dead) {
        const tag = ALLOWLIST.has(n) ? 'ok  ' : 'NEW ';
        console.log(`  [${tag}] ${n}  (${gatedSources.get(n).join(', ')})`);
      }
      if (staleAllowlist.length) {
        console.log('\nStale allowlist entries (now wired or removed — please delete):');
        for (const n of staleAllowlist) console.log(`  - ${n}`);
      }
      console.log(`\n(fallback-only, informational, not gated: ${fallbackDead.length} — see header comment "Scope note")`);
    } else if (newDead.length) {
      console.error('✗ New dead client subscription(s) — FE subscribes but nothing on the server ever emits:\n');
      for (const n of newDead) console.error(`  • ${n}  (${gatedSources.get(n).join(', ')})`);
      console.error('\nWire a real emitter, or if intentional/forward-looking, add it to ALLOWLIST');
      console.error('in scripts/verify-client-event-contracts.mjs with a reason.');
      if (ciMode) console.error('\n[--ci] failing the build on the new dead subscription(s) above.');
    } else {
      console.log('✓ No new dead client subscriptions.');
    }
    if (!listOnly && fallbackDead.length) {
      console.log(`\n(${fallbackDead.length} useRealtimeLens fallback domain(s) have no dedicated push yet — informational only, not gated; run --json for the list)`);
    }
    console.log('');
  }

  if (listOnly) { process.exit(0); }
  if (newDead.length) { process.exit(1); }
  process.exit(0);
}

// Only run the CLI when this file is executed directly (`node
// scripts/verify-client-event-contracts.mjs`) — NOT when imported, so the
// pinning test (server/tests/invariants/client-event-contract.test.js) can
// import the building blocks below without triggering a full run + exit().
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) main();

export {
  stripComments,
  matchBracket,
  splitTopLevelArgs,
  extractQuotedNames,
  collectLiveServerEvents,
  collectDirectSubscriptions,
  collectRealtimeLensEvents,
  collectTrackedEvents,
  collectSocketEventUnion,
  collectForwardedEvents,
  findEmitHelperSignatures,
  aliasEmitHelpers,
  resolveHelperCallSites,
  TRANSPORT,
  ALLOWLIST,
  ROOT,
  SERVER,
  FE,
};
