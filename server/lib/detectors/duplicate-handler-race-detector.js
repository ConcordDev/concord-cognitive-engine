// server/lib/detectors/duplicate-handler-race-detector.js
//
// Duplicate-handler / double-mount race detector.
//
// Seeded from two REAL bugs fixed this session:
//
//   1. `git show eecb0bec` — CommandPalette was mounted app-wide by AppShell
//      AND per-route by app/lenses/layout.tsx, and AppShell additionally
//      duplicated CommandPalette's own Ctrl+K toggle logic. Two independent
//      `document`/`window` keydown listeners both checked
//      `(e.metaKey || e.ctrlKey) && e.key === 'k'` and both toggled the SAME
//      shared UI-store boolean. On a keypress the two handlers raced on a
//      `useSyncExternalStore` re-render (each read a stale pre-render
//      snapshot) and could net-cancel the open.
//   2. `git show c74b60d6 -- concord-frontend/components/world-lens/ConcordiaScene.tsx`
//      — `canvas.addEventListener('contextmenu', (e) => e.preventDefault())`
//      passed an anonymous inline arrow function. An anonymous function
//      expression has no outer binding, so it can NEVER be passed to a later
//      `removeEventListener` call — every re-run of the owning `useEffect`
//      (StrictMode double-invoke, HMR, prop-driven remount) permanently
//      stacked another listener on the canvas.
//
// Both bugs share a shape: a listener that either (a) can't structurally be
// cleaned up, or (b) is redundantly registered by more than one owner. This
// detector looks for both shapes.
//
// Detection strategy — frontend (`concord-frontend/`), scoped to the body of
// each `useEffect(() => { ... }, [...])` (the re-run-prone lifecycle boundary
// that actually causes accumulation — a listener attached once outside any
// effect and never re-attached doesn't have this failure mode):
//
//   (a) ANONYMOUS-LISTENER LEAK (medium). `<receiver>.addEventListener(evt, <expr>)`
//       where `<expr>` is not a bare identifier / member-expression reference
//       (i.e. it's an inline arrow/function expression, an IIFE-ish call, or a
//       `.bind(...)` — none of these can ever be named in a `removeEventListener`
//       call because nothing outside the call site holds a reference to them).
//       Exempted: `{ once: true }` listeners (browser self-removes after the
//       first firing, so there's nothing to leak).
//
//   (b) DUPLICATE KEY-HANDLER RACE (high). Two or more DISTINCT files each
//       register a `window`/`document` `keydown`/`keyup`/`keypress` listener
//       (inside a `useEffect`) whose body checks the SAME `e.key === 'x'`
//       literal GATED BY AT LEAST ONE modifier key (metaKey/ctrlKey/altKey/
//       shiftKey, order-independent — e.g. Mod+K). This is deliberately a
//       coarse, cross-file heuristic — precision over recall, per the
//       CommandPalette bug shape: only an EXACT (event, key, modifier-set)
//       match across independently-authored files is flagged. UN-modified
//       key checks (bare `e.key === 'Escape'`/`'Enter'`/arrow keys, with no
//       modifier) are deliberately EXCLUDED — a live spot-check found a
//       single bare-Escape "close this modal" idiom repeated, harmlessly,
//       across 10+ unrelated components; a modifier-gated check is a rare,
//       deliberate claim on a GLOBAL override shortcut, which is what
//       actually makes two owners suspicious.
//
// Detection strategy — server (`server/`):
//
//   (c) DUPLICATE SOCKET HANDLER (high). `socket.on('event', ...)` registered
//       more than once for the SAME event name within one file. Node's
//       EventEmitter doesn't replace a handler on re-`.on()` — it stacks a
//       second listener, so BOTH fire on every emit.
//
//   (d) DUPLICATE ROUTE REGISTRATION (high). `app.<method>('/path', ...)` or
//       `router.<method>('/path', ...)` registered more than once for the
//       identical (receiver, method, literal path) tuple within one file.
//       Express doesn't overwrite the first handler — it appends a second
//       middleware for the same route, so only the first one's terminal
//       `res.*` call "wins" (or both run if the first calls `next()`), which
//       is the server-side shape of the exact same "two owners, one event"
//       race the frontend rules above are named for.
//
// Opt-out (any of the four rules): put `// detector-allow: duplicate-handler
// <reason>` on the flagged line, or up to two lines above it.
//
// This detector is NOT wired into `index.js` (orchestrator-only per the
// authoring brief) — it's callable directly for now.

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const FRONTEND_EXTS = [".tsx", ".ts", ".jsx", ".js"];
const SERVER_EXTS = [".js", ".mjs", ".cjs"];

const FRONTEND_SKIP = [
  /\.(?:test|spec|stories)\.(?:js|mjs|cjs|ts|tsx|jsx)$/,
  /\.d\.ts$/,
  /\/(?:__tests__|__mocks__|storybook)\//,
];

const SERVER_SKIP = [
  /\.(?:test|spec)\.(?:js|mjs|cjs)$/,
  /\/(?:tests?|__tests__)\//,
  // The detector suite carries seed examples of the very patterns it hunts
  // for (e.g. this file's own header comments quote `socket.on(...)` and
  // `addEventListener(...)` shapes) — scanning it is meta-noise.
  /\/lib\/detectors\//,
];

const ALLOW_RE = /detector-allow:\s*duplicate-handler\b/;
// The sibling resource-leak-detector's opt-out already covers "this listener
// registration was reviewed for leak-safety" (e.g. a Worker whose listeners
// are torn down wholesale by `worker.terminate()`, so an inline handler
// there isn't the ConcordiaScene re-run-stacking failure mode). Honor it for
// the anonymous-listener rule specifically rather than making every such
// file carry two overlapping annotations.
const RESOURCE_LEAK_OK_RE = /@resource-leak-ok\b/;

/** Does the (1-indexed) line, or either of the 2 lines above it, carry the opt-out annotation? */
function isAllowedNear(rawLines, lineNo, extraRe) {
  for (let i = Math.max(0, lineNo - 3); i < lineNo; i++) {
    const line = rawLines[i] || "";
    if (ALLOW_RE.test(line)) return true;
    if (extraRe && extraRe.test(line)) return true;
  }
  return false;
}

/** Balanced-brace scan from an opening `{` at `openIdx`; returns the index of the matching `}`, or -1. */
export function findMatchingBrace(content, openIdx) {
  let depth = 0;
  let str = null;
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];
    if (str) {
      if (ch === "\\") { i++; continue; }
      if (ch === str) str = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { str = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Balanced-paren scan from an opening `(` at `openIdx`; returns the index of the matching `)`, or -1. */
export function findMatchingParen(content, openIdx) {
  let depth = 0;
  let str = null;
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];
    if (str) {
      if (ch === "\\") { i++; continue; }
      if (ch === str) str = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { str = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split a call's raw argument text on top-level commas (respects nesting + strings). */
export function splitTopLevelArgs(argsStr) {
  const parts = [];
  let depth = 0;
  let str = null;
  let buf = "";
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (str) {
      buf += ch;
      if (ch === "\\") { buf += argsStr[i + 1] ?? ""; i++; continue; }
      if (ch === str) str = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { str = ch; buf += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; buf += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; buf += ch; continue; }
    if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim().length) parts.push(buf);
  return parts.map((s) => s.trim());
}

/**
 * Strip TypeScript noise that wraps an otherwise-bare reference so it isn't
 * misclassified as an inline expression:
 *   - trailing `as SomeType` assertions (`handler as EventListener`) — the
 *     overwhelmingly common real-world shape in this .tsx-heavy codebase for
 *     passing a typed callback to a DOM `addEventListener`.
 *   - a single layer of fully-wrapping parens (`(handler)`).
 * Idempotent — repeats until neither strip applies.
 */
export function stripTsNoise(expr) {
  let e = (expr || "").trim();
  for (;;) {
    const asMatch = e.match(/^([\s\S]+?)\s+as\s+[A-Za-z_$][\w$.<>[\], |]*$/);
    if (asMatch) { e = asMatch[1].trim(); continue; }
    if (e.startsWith("(") && e.endsWith(")")) {
      let depth = 0, wrapsWhole = true;
      for (let i = 0; i < e.length; i++) {
        if (e[i] === "(") depth++;
        else if (e[i] === ")") { depth--; if (depth === 0 && i !== e.length - 1) { wrapsWhole = false; break; } }
      }
      if (wrapsWhole) { e = e.slice(1, -1).trim(); continue; }
    }
    break;
  }
  return e;
}

/** Is `expr` a bare identifier / member-expression / optional-chain reference (i.e. removable)? */
export function isBareReference(expr) {
  const e = stripTsNoise(expr);
  if (!e) return false;
  return /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]]*\])*$/.test(e);
}

const USE_EFFECT_RE = /\buseEffect\s*\(/g;

/**
 * Extract every `useEffect(...)` callback body in `content` (comment-stripped).
 * Returns `[{ start, end, startLine }]` — `start`/`end` are absolute indexes
 * of the body's outer `{`/`}` in `content`.
 */
export function extractEffectBodies(content) {
  const bodies = [];
  USE_EFFECT_RE.lastIndex = 0;
  let m;
  while ((m = USE_EFFECT_RE.exec(content)) != null) {
    const openParenIdx = m.index + m[0].length - 1;
    const braceIdx = content.indexOf("{", openParenIdx);
    if (braceIdx < 0) continue;
    // Don't reach across an unrelated later statement if this useEffect's
    // arg list closes before any `{` (e.g. `useEffect(fn, [deps])`  — no
    // inline body to scan).
    const closeParenGuess = findMatchingParen(content, openParenIdx);
    if (closeParenGuess >= 0 && braceIdx > closeParenGuess) continue;
    const closeBraceIdx = findMatchingBrace(content, braceIdx);
    if (closeBraceIdx < 0) continue;
    bodies.push({ start: braceIdx, end: closeBraceIdx, startLine: lineOf(content, m.index) });
  }
  return bodies;
}

const ADD_LISTENER_CALL_RE = /((?:[A-Za-z_$][\w$]*)(?:\??\.[A-Za-z_$][\w$]*)*)\.addEventListener\s*\(/g;

/** Scan one useEffect body for anonymous-handler addEventListener calls. */
function scanAnonymousListeners(content, body, rel, rawLines) {
  const findings = [];
  const bodyText = content.slice(body.start, body.end + 1);
  ADD_LISTENER_CALL_RE.lastIndex = 0;
  let m;
  while ((m = ADD_LISTENER_CALL_RE.exec(bodyText)) != null) {
    const receiver = m[1];
    const openParenIdx = m.index + m[0].length - 1;
    const closeParenIdx = findMatchingParen(bodyText, openParenIdx);
    if (closeParenIdx < 0) continue;
    const argsStr = bodyText.slice(openParenIdx + 1, closeParenIdx);
    const args = splitTopLevelArgs(argsStr);
    if (args.length < 2) continue;

    const eventArg = args[0];
    const handlerArg = args[1];
    const optsArg = args[2] || "";
    const eventNameMatch = eventArg.match(/^['"`]([^'"`]+)['"`]$/);
    const eventName = eventNameMatch ? eventNameMatch[1] : snippet(eventArg, 40);

    // { once: true } is self-cleaning — the browser drops the listener after
    // the first firing, so an inline handler there is not a leak.
    if (/\bonce\s*:\s*(?:true|1)\b/.test(optsArg)) continue;
    if (isBareReference(handlerArg)) continue; // named/referenced — removable, safe

    const absIdx = body.start + m.index;
    const lineNo = lineOf(content, absIdx);
    if (isAllowedNear(rawLines, lineNo, RESOURCE_LEAK_OK_RE)) continue;

    findings.push({
      id: "anonymous_listener_leak",
      severity: "medium",
      kind: "static",
      category: "reliability",
      subject: { kind: "listener_leak", file: rel },
      message:
        `${receiver}.addEventListener('${eventName}', <inline handler>) inside a useEffect — the handler is not ` +
        `a named/referenced function, so it can never be passed to removeEventListener. Every re-run of this ` +
        `effect (StrictMode double-invoke, HMR, a dependency change) permanently stacks another listener ` +
        `(the ConcordiaScene.tsx contextmenu leak fixed in c74b60d6 was exactly this shape).`,
      location: `${rel}:${lineNo}`,
      evidence: { receiver, eventName, snippet: snippet(handlerArg, 100) },
      fixHint: "name_the_handler_and_remove_it_in_the_effect_cleanup",
    });
  }
  return findings;
}

const KEY_EVENTS = new Set(["keydown", "keyup", "keypress"]);
const GLOBAL_RECEIVERS = new Set(["window", "document"]);
const KEY_CHECK_RE = /\.key\s*===\s*['"`]([^'"`]+)['"`]/g;
const MODIFIER_RE = /\.(metaKey|ctrlKey|altKey|shiftKey)\b/g;

/**
 * Extract the modifier keys REQUIRED (positively checked, not `!`-negated) on
 * a line. `!e.metaKey` means "this modifier must be absent" — the opposite
 * requirement of `e.metaKey` / `(e.metaKey || e.ctrlKey)` — so it must NOT be
 * folded into the same signature as a positive check, or two handlers with
 * opposite modifier gating (e.g. Mod+K vs bare-K-without-Mod) would wrongly
 * be treated as the same race.
 */
export function extractPositiveModifiers(lineText) {
  const mods = new Set();
  MODIFIER_RE.lastIndex = 0;
  let mm;
  while ((mm = MODIFIER_RE.exec(lineText)) != null) {
    let i = mm.index - 1;
    while (i >= 0 && /[\w$]/.test(lineText[i])) i--; // skip back over the receiver identifier (e.g. "e")
    while (i >= 0 && /[\s(]/.test(lineText[i])) i--; // skip whitespace / open-parens from grouping
    if (lineText[i] === "!") continue; // negated — "must NOT have this modifier"
    mods.add(mm[1]);
  }
  return mods;
}

/** Does this effect body register a window/document keydown|keyup|keypress listener? If so, which event? */
function globalKeyListenerEvent(bodyText) {
  ADD_LISTENER_CALL_RE.lastIndex = 0;
  let m;
  while ((m = ADD_LISTENER_CALL_RE.exec(bodyText)) != null) {
    const receiver = m[1];
    if (!GLOBAL_RECEIVERS.has(receiver)) continue;
    const openParenIdx = m.index + m[0].length - 1;
    const closeParenIdx = findMatchingParen(bodyText, openParenIdx);
    if (closeParenIdx < 0) continue;
    const argsStr = bodyText.slice(openParenIdx + 1, closeParenIdx);
    const args = splitTopLevelArgs(argsStr);
    const eventNameMatch = (args[0] || "").match(/^['"`]([^'"`]+)['"`]$/);
    const eventName = eventNameMatch ? eventNameMatch[1] : null;
    if (eventName && KEY_EVENTS.has(eventName)) return eventName;
  }
  return null;
}

/**
 * Collect `{ eventName, keyLiteral, modifiers, rel, lineNo }` signatures from
 * one effect body.
 *
 * Only bare-key checks GATED BY AT LEAST ONE MODIFIER are collected. A
 * modifier-gated check (Mod+K, Mod+Shift+F, ...) is a deliberate claim on a
 * global override shortcut — rare, and exactly the CommandPalette/AppShell
 * bug shape. An UN-modified key check (`e.key === 'Escape'`, `'Enter'`,
 * `'ArrowLeft'`, ...) is the overwhelmingly common "close/advance THIS
 * mounted widget" idiom repeated, harmlessly, across dozens of independent
 * modals/carousels/menus that are never all mounted+racing at once — a
 * spot-check against the live tree found a single bare-Escape "group" that
 * would otherwise span 10+ unrelated files, which is exactly the cried-wolf
 * noise this detector's precision-over-recall brief warns against.
 */
function collectKeySignatures(content, body, rel, rawLines) {
  const bodyText = content.slice(body.start, body.end + 1);
  const eventName = globalKeyListenerEvent(bodyText);
  if (!eventName) return [];

  const sigs = [];
  KEY_CHECK_RE.lastIndex = 0;
  let m;
  while ((m = KEY_CHECK_RE.exec(bodyText)) != null) {
    const keyLiteral = m[1].toLowerCase();
    const absIdx = body.start + m.index;
    const lineNo = lineOf(content, absIdx);
    if (isAllowedNear(rawLines, lineNo)) continue;

    const lineText = rawLines[lineNo - 1] || "";
    const mods = extractPositiveModifiers(lineText);
    if (mods.size === 0) continue; // un-modified key — not a global-override claim
    const modifiers = [...mods].sort().join("+");

    sigs.push({ eventName, keyLiteral, modifiers, rel, lineNo });
  }
  return sigs;
}

const SOCKET_ON_RE = /\bsocket\.on\s*\(\s*(['"`])([^'"`]+)\1/g;
const ROUTE_RE = /\b(app|router)\.(get|post|put|delete|patch|all)\s*\(\s*(['"`])(\/[^'"`]*)\3/g;

/** Scan one server file (comment-stripped) for duplicate socket.on / route registrations. */
function scanServerDuplicates(content, rel, rawLines) {
  const findings = [];

  const socketSeen = new Map();
  SOCKET_ON_RE.lastIndex = 0;
  let m;
  while ((m = SOCKET_ON_RE.exec(content)) != null) {
    const event = m[2];
    const lineNo = lineOf(content, m.index);
    if (isAllowedNear(rawLines, lineNo)) continue;
    if (socketSeen.has(event)) {
      findings.push({
        id: "duplicate_socket_handler",
        severity: "high",
        kind: "static",
        category: "reliability",
        subject: { kind: "duplicate_handler", file: rel },
        message:
          `socket.on('${event}', ...) is registered more than once in ${rel} (first at line ${socketSeen.get(event)}) — ` +
          `Node's EventEmitter stacks listeners rather than replacing them, so BOTH handlers fire on every emit of this event.`,
        location: `${rel}:${lineNo}`,
        evidence: { event, firstLine: socketSeen.get(event) },
        fixHint: "consolidate_into_a_single_socket_on_handler",
      });
    } else {
      socketSeen.set(event, lineNo);
    }
  }

  const routeSeen = new Map();
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(content)) != null) {
    const receiver = m[1];
    const method = m[2].toUpperCase();
    const routePath = m[4];
    const key = `${receiver}|${method}|${routePath}`;
    const lineNo = lineOf(content, m.index);
    if (isAllowedNear(rawLines, lineNo)) continue;
    if (routeSeen.has(key)) {
      findings.push({
        id: "duplicate_route_registration",
        severity: "high",
        kind: "static",
        category: "reliability",
        subject: { kind: "duplicate_handler", file: rel },
        message:
          `${receiver}.${method.toLowerCase()}('${routePath}', ...) is registered more than once in ${rel} ` +
          `(first at line ${routeSeen.get(key)}) — Express appends a second handler for the same route rather ` +
          `than replacing the first; only the first terminal res.* call "wins" (or both run if it calls next()).`,
        location: `${rel}:${lineNo}`,
        evidence: { receiver, method, path: routePath, firstLine: routeSeen.get(key) },
        fixHint: "remove_or_merge_the_duplicate_route_handler",
      });
    } else {
      routeSeen.set(key, lineNo);
    }
  }

  return findings;
}

export async function runDuplicateHandlerRaceDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("duplicate-handler-race", "no_root", null, t0);

  try {
    const findings = [];
    let scannedFrontend = 0;
    let scannedServer = 0;
    const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;

    // ── Frontend: anonymous-listener leaks + cross-file key-handler races ──
    const feRoot = path.join(root, "concord-frontend");
    const feFiles = await walk(feRoot, FRONTEND_EXTS);
    const keySignatures = [];

    for (const f of feFiles) {
      if (findings.length >= findingCap) break;
      const rel = relPath(root, f);
      if (FRONTEND_SKIP.some((re) => re.test(rel))) continue;
      const raw = await readSafe(f);
      if (!raw) continue;
      scannedFrontend++;

      const c = stripComments(raw);
      const rawLines = raw.split("\n");
      const bodies = extractEffectBodies(c);
      for (const body of bodies) {
        findings.push(...scanAnonymousListeners(c, body, rel, rawLines));
        keySignatures.push(...collectKeySignatures(c, body, rel, rawLines));
        if (findings.length >= findingCap) break;
      }
    }

    // Group key signatures across ALL files; flag groups spanning >= 2 files.
    const groups = new Map();
    for (const sig of keySignatures) {
      const key = `${sig.eventName}|${sig.keyLiteral}|${sig.modifiers}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(sig);
    }
    for (const sigs of groups.values()) {
      const distinctFiles = [...new Set(sigs.map((s) => s.rel))];
      if (distinctFiles.length < 2) continue;
      const { eventName, keyLiteral, modifiers } = sigs[0];
      const locations = sigs.map((s) => `${s.rel}:${s.lineNo}`).slice(0, 10);
      findings.push({
        id: "duplicate_key_handler_race",
        severity: "high",
        kind: "static",
        category: "reliability",
        subject: { kind: "duplicate_handler", files: distinctFiles },
        message:
          `${distinctFiles.length} different files each register a global '${eventName}' listener that checks the ` +
          `SAME modifier-gated key ('${keyLiteral}' + ${modifiers}) — two independently-mounted handlers toggling ` +
          `on the identical keypress is the CommandPalette/AppShell Mod+K race (fixed in eecb0bec): each can read a ` +
          `stale pre-render snapshot of shared state and net-cancel the other.`,
        location: locations[0],
        evidence: { eventName, keyLiteral, modifiers, locations },
        fixHint: "keep_a_single_owner_for_this_shortcut_and_remove_the_rest",
      });
    }

    // ── Server: duplicate socket.on / duplicate route registration ──
    const srvRoot = path.join(root, "server");
    const srvFiles = await walk(srvRoot, SERVER_EXTS);
    for (const f of srvFiles) {
      if (findings.length >= findingCap) break;
      const rel = relPath(root, f);
      if (SERVER_SKIP.some((re) => re.test(rel))) continue;
      const raw = await readSafe(f);
      if (!raw) continue;
      scannedServer++;

      const c = stripComments(raw);
      const rawLines = raw.split("\n");
      findings.push(...scanServerDuplicates(c, rel, rawLines));
    }

    findings.unshift({
      id: "duplicate_handler_race_summary",
      severity: "info",
      kind: "static",
      category: "reliability",
      message: `Scanned ${scannedFrontend} frontend file(s) + ${scannedServer} server file(s); flagged ${findings.length}.`,
      evidence: { scannedFrontend, scannedServer },
    });

    return makeReport("duplicate-handler-race", findings, t0);
  } catch (err) {
    return makeError("duplicate-handler-race", "exception", err, t0);
  }
}
