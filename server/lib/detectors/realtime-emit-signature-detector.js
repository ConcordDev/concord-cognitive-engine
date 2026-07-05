// server/lib/detectors/realtime-emit-signature-detector.js
//
// realtimeEmit() call-signature detector.
//
// Seeded from a REAL miss found during a 2026-07-05 audit: `realtimeEmit`'s
// actual signature (server.js:8066) is
//
//   realtimeEmit(event, payload, { sessionId, orgId, userId, requestId })
//
// — the event name comes FIRST as a literal string; the target room is
// resolved INTERNALLY from the third-argument options object (`userId` →
// `user:<id>`, `sessionId` → `session:<id>`, `orgId` → `org:<id>`, else a
// global broadcast). There is no "room" parameter — realtimeEmit never
// takes one.
//
// Commit `310e8e3a` fixed 2 real call sites that misused this contract by
// treating it as `(room, event, payload)`:
//   - server.js:52106 (`/api/combat/brawl/invite`) built a room+event string
//     as the WHOLE first argument (`` `user:${toUserId}:brawl-invited` ``)
//     with no options object at all.
//   - server/emergent/brawl-queue-cycle.js:23,29 (brawl-queue heartbeat)
//     called it as `realtimeEmit(`user:${id}`, "brawl-invited", {...})` —
//     three positional args in (room, event, payload) order.
// Neither call ever produced a room-scoped emit — both fell through
// realtimeEmit's `else` branch to an UNSCOPED GLOBAL `io.emit()` under a
// garbled event name (the room string, not a real event name).
//
// The same audit flagged (but, out of scope for that fix, did not repair)
// a SECOND failure shape: passing `{ targetUserId: x }` instead of
// `{ userId: x }` in the options object. `realtimeEmit` destructures
// exactly `sessionId`/`orgId`/`userId`/`requestId` — an unrecognised key
// like `targetUserId` is silently ignored, so the call falls through to
// the same unscoped global broadcast. This shape is easy to introduce by
// analogy with route-local variables that are themselves named
// `targetUserId` (a completely normal and correct local-variable name —
// the bug is only in the OPTIONS-OBJECT KEY passed to realtimeEmit).
//
// This is a pure static/textual detector (no type info, no cross-file
// data flow) — it parses each `realtimeEmit(`/`realtimeEmit?.(` call site's
// argument list and applies two narrow, precision-first rules calibrated
// against the ~30 real call sites in the tree so a correctly-shaped call
// is never flagged:
//
//   (a) wrong_argument_order — the FIRST argument doesn't look like a
//       plausible static event-name literal. Real event names in this
//       codebase are ALWAYS plain string literals (optionally namespaced
//       with `:` or `-`, e.g. "brawl-invited", "world:invite-received").
//       A template literal whose static leading text is a known
//       scope-prefix word (`user`/`session`/`org`/`room`/`channel`)
//       immediately followed by an interpolation (`` `user:${id}` ``), or
//       a bare identifier whose name itself reads as a room/target
//       variable (`room`, `channel`, `userId`, `sessionId`, `orgId` as a
//       whole word or camelCase suffix), is the room-shaped first
//       argument from the historical bug — NOT an event name.
//   (b) wrong_key_name — the options-object argument (3rd positional arg)
//       is an object literal containing `targetUserId` (or
//       `targetSessionId` / `targetOrgId`) but NOT the correspondingly
//       correct `userId` (`sessionId` / `orgId`) key. realtimeEmit
//       silently ignores unknown keys, so this options object scopes
//       nothing — the call broadcasts globally instead of to the
//       intended recipient.
//
// Both rules are HIGH severity: neither throws, neither errors visibly —
// the emit just quietly broadcasts to everyone (or nobody meaningfully
// scoped), which is exactly the kind of silent breakage this suite exists
// to catch before it needs an unrelated bug report to surface.

import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";

const SKIP_FILES = [
  /\/(?:audit|reports|docs|skills|content|monitoring|nginx|k8s|load-tests)\//,
  /\.d\.ts$/,
  // Test/spec fixtures may legitimately embed the buggy shape as regex
  // literals / comments / doc strings while pinning the regression — not
  // a production call site.
  /\.(?:test|spec)\.(?:js|mjs|cjs|ts|tsx)$/,
  // The detector source + its own fixtures carry seed examples of the
  // very pattern it hunts for; scanning them is meta-noise.
  /\/lib\/detectors\//,
];

// Matches a bare call `realtimeEmit(` or an optional-chained
// `realtimeEmit?.(`, with or without a member-access receiver in front
// (e.g. `_config?.realtimeEmit?.(`, `deps.realtimeEmit(`) — the receiver
// doesn't matter, only the argument shape does. Also matches
// `globalThis._concordRealtimeEmit(...)` / `?.` — the module-scope stash
// of the very same function (`globalThis._concordRealtimeEmit = realtimeEmit;`
// at server.js:8078) that ~9 emergent/lib modules call directly by that
// name so they can reach it without a circular import of server.js. Does
// NOT match other locally-aliased bindings (e.g. `const emitFn =
// globalThis._concordRealtimeEmit; emitFn(...)`) — tracing arbitrary local
// aliases is out of scope for a textual detector (see command-injection
// detector's own one-hop-only taint-tracking precedent); this covers the
// two names the real function is actually called by across the tree.
const CALL_RE = /\b(?:realtimeEmit|_concordRealtimeEmit)\s*\?\.\s*\(|\b(?:realtimeEmit|_concordRealtimeEmit)\s*\(/g;

// Scope-prefix words that realtimeEmit itself resolves into a room
// internally (userId/sessionId/orgId) plus the two generic "obviously a
// room, not an event" words called out in the audit (room/channel).
const ROOM_PREFIX_WORD = /^(?:user|session|org|room|channel)$/i;
// A bare identifier that reads as a room/target variable: the whole
// identifier IS one of the scope words, or it ends in one as a
// camelCase suffix (toUserId, targetSessionId, orgId, roomName, ...).
const ROOM_IDENTIFIER_RE = /(?:^|[a-z0-9])(?:userid|sessionid|orgid|room|channel)$/i;

/**
 * Strip JS line/block comments (best-effort, string/template-aware) so a
 * call site living only in a comment is never flagged. Newlines are kept
 * so line numbers stay accurate.
 */
export function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let str = null;
  while (i < n) {
    const ch = src[i];
    const nx = src[i + 1];
    if (str) {
      out += ch;
      if (ch === "\\") { out += nx ?? ""; i += 2; continue; }
      if (ch === str) str = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { str = ch; out += ch; i++; continue; }
    if (ch === "/" && nx === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && nx === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; }
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Extract the balanced-paren argument substring of a call starting at `open` (the index of its `(`). */
function callArgs(content, open) {
  let depth = 0, i = open, buf = "";
  while (i < content.length) {
    const ch = content[i];
    if (ch === "(") { if (depth > 0) buf += ch; depth++; }
    else if (ch === ")") { depth--; if (depth === 0) break; buf += ch; }
    else if (depth > 0) buf += ch;
    i++;
  }
  return buf;
}

/**
 * Split a call's argument-list string into top-level argument substrings
 * — split on commas at bracket/brace/paren/string depth 0.
 */
export function splitTopLevelArgs(argsStr) {
  const out = [];
  let depth = 0, inStr = null, buf = "";
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (inStr) {
      buf += ch;
      if (ch === "\\") { buf += argsStr[i + 1] ?? ""; i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; buf += ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; buf += ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth--; buf += ch; continue; }
    if (ch === "," && depth === 0) { out.push(buf); buf = ""; continue; }
    buf += ch;
  }
  if (buf.trim() !== "") out.push(buf);
  return out.map((s) => s.trim());
}

/**
 * Extract the top-level property-key names of an object-literal source
 * string (e.g. `{ targetUserId: x, foo }` -> ["targetUserId", "foo"]).
 * Handles shorthand properties, string/computed keys are ignored (they
 * can't be the destructured-by-name options realtimeEmit reads anyway).
 */
export function objectLiteralKeys(objSrc) {
  const s = objSrc.trim();
  if (!/^\{[\s\S]*\}$/.test(s)) return null;
  const inner = s.slice(1, -1);
  const entries = splitTopLevelArgs(inner);
  const keys = [];
  for (const entry of entries) {
    const e = entry.trim();
    if (!e || e.startsWith("...")) continue;
    // `key: value` (top-level colon only — splitTopLevelArgs already kept
    // nested `{}`/`[]`/`()` intact so the first top-level colon is safe).
    let depth = 0, colonAt = -1, inStr2 = null;
    for (let i = 0; i < e.length; i++) {
      const ch = e[i];
      if (inStr2) { if (ch === "\\") { i++; continue; } if (ch === inStr2) inStr2 = null; continue; }
      if (ch === "'" || ch === '"' || ch === "`") { inStr2 = ch; continue; }
      if (ch === "(" || ch === "[" || ch === "{") depth++;
      else if (ch === ")" || ch === "]" || ch === "}") depth--;
      else if (ch === ":" && depth === 0) { colonAt = i; break; }
    }
    if (colonAt >= 0) {
      const key = e.slice(0, colonAt).trim().replace(/^['"]|['"]$/g, "");
      if (/^[A-Za-z_$][\w$]*$/.test(key)) keys.push(key);
    } else if (/^[A-Za-z_$][\w$]*$/.test(e)) {
      keys.push(e); // shorthand { userId }
    }
  }
  return keys;
}

/**
 * Classify the FIRST argument of a realtimeEmit call.
 * @returns {{ flag: boolean, reason: string }}
 */
export function classifyFirstArg(arg) {
  const a = (arg || "").trim();
  if (!a) return { flag: false, reason: "empty" };

  // Plain string literal (single/double, or backtick with NO interpolation)
  // — this is what every correct call in the tree uses. Never flagged,
  // regardless of content (a single-word literal like "ping" is still a
  // static, compile-time event name, not a room).
  if (/^(['"])[\s\S]*\1$/.test(a)) return { flag: false, reason: "string_literal" };
  if (/^`[^`]*`$/.test(a) && !a.includes("${")) return { flag: false, reason: "string_literal" };

  // Template literal WITH interpolation.
  if (/^`[\s\S]*\$\{[\s\S]*`$/.test(a)) {
    const firstInterpIdx = a.indexOf("${");
    const staticPrefix = a.slice(1, firstInterpIdx).replace(/[:_-]+$/, "");
    if (ROOM_PREFIX_WORD.test(staticPrefix)) {
      return { flag: true, reason: "template_room_prefix" };
    }
    // Any other dynamic template (e.g. a per-district topic string) is a
    // deliberate dynamic-event-name pattern outside this rule's scope —
    // not the (room, event, payload) misordering this detector hunts for.
    return { flag: false, reason: "template_non_scope_prefix" };
  }

  // Bare identifier / simple member expression (no quotes at all) as the
  // WHOLE first argument, e.g. `roomKey`, `toUserId`, `channel`.
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\?\.[A-Za-z_$][\w$]*|\[[^\]]+\])*$/.test(a)) {
    const lastIdent = (a.match(/[A-Za-z_$][\w$]*$/) || [a])[0];
    if (ROOM_IDENTIFIER_RE.test(lastIdent)) {
      return { flag: true, reason: "bare_room_identifier" };
    }
    return { flag: false, reason: "bare_identifier_other" };
  }

  // Anything else (ternary, function call, string concat, …) — too
  // speculative to grade against this narrow bug shape; skip rather than
  // guess (precision over recall, per the command-injection detector's
  // own discipline note).
  return { flag: false, reason: "unclassified" };
}

/**
 * Check the options-object argument (3rd positional arg, if present and
 * an object literal) for the wrong-key-name shape.
 * @returns {{ flag: boolean, badKey: string, goodKey: string }|null}
 */
export function classifyOptionsArg(arg) {
  if (!arg) return null;
  const keys = objectLiteralKeys(arg);
  if (!keys) return null; // not an object literal — out of scope for this rule
  const PAIRS = [
    ["targetUserId", "userId"],
    ["targetSessionId", "sessionId"],
    ["targetOrgId", "orgId"],
  ];
  for (const [bad, good] of PAIRS) {
    if (keys.includes(bad) && !keys.includes(good)) {
      return { flag: true, badKey: bad, goodKey: good };
    }
  }
  return { flag: false };
}

export async function runRealtimeEmitSignatureDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("realtime-emit-signature", "no_root", null, t0);

  try {
    const exts = [".js", ".mjs", ".cjs", ".ts", ".tsx"];
    const files = await walk(root, exts);
    const findings = [];
    let scanned = 0;
    let callSites = 0;

    for (const f of files) {
      const rel = relPath(root, f);
      if (SKIP_FILES.some((re) => re.test(rel))) continue;
      const raw = await readSafe(f);
      // Case-insensitive pre-filter: matches both bare "realtimeEmit" and
      // the "_concordRealtimeEmit" global stash (capital R) cheaply, before
      // paying for stripComments on files that can't possibly contain a
      // call site.
      if (!raw || !/realtimeemit/i.test(raw)) continue;
      const c = stripComments(raw);
      if (!/realtimeemit/i.test(c)) continue;
      scanned++;

      CALL_RE.lastIndex = 0;
      let m;
      while ((m = CALL_RE.exec(c)) != null) {
        const open = m.index + m[0].length - 1;
        if (c[open] !== "(") continue;
        const argsStr = callArgs(c, open);
        const args = splitTopLevelArgs(argsStr);
        if (args.length === 0) continue;
        callSites++;
        const line = lineOf(c, m.index);

        // Rule (a): first-argument shape.
        const firstClass = classifyFirstArg(args[0]);
        if (firstClass.flag) {
          findings.push({
            id: "realtime_emit_wrong_argument_order",
            severity: "high",
            kind: "static",
            category: "correctness",
            subject: { kind: "file", path: rel },
            message:
              `realtimeEmit() called with a room/target-shaped first argument (${firstClass.reason}) — ` +
              `the real signature is realtimeEmit(event, payload, { userId|sessionId|orgId }); the target ` +
              `is derived from the 3rd-arg options object, not the 1st positional argument. This call falls ` +
              `through to an unscoped global io.emit() under a garbled event name.`,
            location: `${rel}:${line}`,
            evidence: { snippet: snippet(args[0], 120) },
            fixHint: "realtime_emit_event_first_options_third",
          });
        }

        // Rule (b): options-object key name (3rd positional arg).
        if (args.length >= 3) {
          const optClass = classifyOptionsArg(args[2]);
          if (optClass && optClass.flag) {
            findings.push({
              id: "realtime_emit_wrong_key_name",
              severity: "high",
              kind: "static",
              category: "correctness",
              subject: { kind: "file", path: rel },
              message:
                `realtimeEmit() options object uses "${optClass.badKey}" — realtimeEmit destructures exactly ` +
                `"${optClass.goodKey}" (plus sessionId/orgId/requestId) and silently ignores unknown keys, so ` +
                `this call scopes nothing and broadcasts globally instead of to the intended recipient.`,
              location: `${rel}:${line}`,
              evidence: { snippet: snippet(args[2], 120), badKey: optClass.badKey, goodKey: optClass.goodKey },
              fixHint: `rename_${optClass.badKey}_to_${optClass.goodKey}`,
            });
          }
        }

        if (findings.length > 500) break;
      }
      if (findings.length > 500) break;
    }

    findings.unshift({
      id: "realtime_emit_signature_summary",
      severity: "info",
      kind: "static",
      category: "correctness",
      message: `Scanned ${scanned} realtimeEmit-mentioning file(s) of ${files.length}; ${callSites} call site(s); flagged ${findings.length}`,
      evidence: { filesWithCalls: scanned, totalFiles: files.length, callSites },
    });

    return makeReport("realtime-emit-signature", findings, t0);
  } catch (err) {
    return makeError("realtime-emit-signature", "exception", err, t0);
  }
}
