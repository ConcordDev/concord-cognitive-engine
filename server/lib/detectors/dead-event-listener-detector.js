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

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

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
  return report;
}
