// server/lib/detectors/macro-stub-detector.js
//
// "Is this registered macro actually DOING something, or is it a stub
// disguised as working?"
//
// The suite already has three adjacent checks and none of them cover this:
//   • dead-macro-call    — frontend calls a (domain,macro) pair nobody registered
//   • macro-usage        — a registered macro that no caller ever invokes
//   • fabrication-mechanism / frontend-fake-data — fake data in a *render* path
//
// The gap: a macro that IS registered, IS reachable, IS called — but whose
// handler body returns hardcoded / simulated / random / no-op-success data
// while presenting `{ ok: true }` as if it did real work. An LLM agent
// (ConKay) calling `run_lens_action` against one of these gets a
// confident-looking success and builds on sand. This detector is the
// permanent version of the manual "why did that macro lie to me" hunt.
//
// It reports two things:
//   1. STUBS DISGUISED AS WORKING (low→high severity, feeds the ratchet):
//      - macro_fabricated_random   Math.random() flows into the returned value
//      - macro_todo_stub           TODO/FIXME/"not implemented" body that still returns ok:true
//      - macro_simulation_language simulate/mock/fake/dummy identifiers building an ok:true response
//      - macro_noop_success        trivial body, returns {ok:true}, never touches db/ctx/input/await
//      - macro_hardcoded_dataset   returns a literal array-of-objects with no db/ctx/await in the body
//   2. HONEST ROADMAP STUBS (info only — NOT a bug):
//      - macro_honest_roadmap_stub returns {ok:false, reason:'roadmap'|'not_implemented'|…}
//      These are the correct honest-failure pattern. The detector inventories
//      them (in the summary finding's evidence) so agent tooling / callers
//      have a machine-readable "do not rely on these yet" list.
//
// Precision discipline (a noisy detector gets muted):
//   • Only handlers whose body can be statically bracket-matched are analysed.
//     A `register("d","n", someNamedFn)` reference is resolved one level to a
//     same-file `function someNamedFn` / `const someNamedFn = (…) =>`; if that
//     fails the registration is skipped, never guessed.
//   • A body that returns `{ ok:false, … }` is NEVER flagged as a
//     disguised-stub — an honest failure is the point.
//   • A body that returns a pure catalog/enum (array of strings, or a
//     frozen constant referenced by name) is `utility`, not a stub — skipped.
//   • Opt-out: `// @macro-stub-ok: <reason>` on the register line, the two
//     lines above it, or anywhere in the handler body.
//   • Game/sim emergent modules (server/emergent/**) are out of scope — their
//     Math.random() is mechanics, covered by fabrication-mechanism's allowlist.
//
// Runtime cross-check (best-effort): if macro telemetry is available and a
// flagged noop/simulation macro actually FIRED in the live window, the
// finding's severity is bumped one notch and `runtimeHit:true` is stamped —
// a stub nobody calls is debt; a stub under live traffic is a lie in flight.

import path from "node:path";
import {
  walk, readSafe, makeReport, makeError, lineOf, relPath, snippet,
} from "./_framework.js";
import { stripCommentsAndRegex } from "./dead-macro-call-detector.js";
import { loadAggregated as _loadAggregated, MACRO_LIVE_WINDOW_DAYS as _MACRO_LIVE_WINDOW_DAYS } from "./macro-telemetry.js";

const IDENT = "[A-Za-z0-9_.$-]+";
const STUB_OK_RE = /@macro-stub-ok\b/;

// Files that register macros. server/emergent/** is deliberately excluded
// (game-mechanic randomness). Tests excluded.
const SKIP_RE = [
  /\/(?:tests?|__tests__)\//,
  /\.(?:test|spec)\.(?:js|mjs|cjs)$/,
  /\/emergent\//,
  /\/migrations\//,
];

const REGISTER_CALL_RE = new RegExp(
  String.raw`\b(register|registerLensAction|[A-Za-z_$][\w$]*)\(\s*["'\`](${IDENT})["'\`]\s*,\s*["'\`](${IDENT})["'\`]\s*,`,
  "g",
);

// ── honest-roadmap signal ────────────────────────────────────────────────
// A handler that returns { ok:false, reason:'roadmap' } (or similar). This
// is the CORRECT honest-failure pattern — inventoried, never flagged as a bug.
const ROADMAP_REASON_RE =
  /\b(?:reason|error|code)\s*:\s*["'`](roadmap|not_?implemented|unimplemented|coming_?soon|not_?yet(?:_wired|_built|_implemented)?|planned|feature_disabled)["'`]/i;

// ── disguised-stub signal 1: explicit incompleteness marker ──────────────
// COMMENT-FORM ONLY (scanned against the raw, un-stripped body). A bare word
// "todo" in code is a domain term in this repo (task managers, kanban); only
// a `// TODO` / `/* FIXME */` style comment, or a hard "not implemented yet"
// phrase in a comment, is a real incompleteness marker.
const TODO_COMMENT_RE =
  /(?:\/\/|\/\*|\*)\s*(?:@?TODO\b|@?FIXME\b|XXX\b|not\s+(?:yet\s+)?implemented|unimplemented|(?:this\s+is|just|only)\s+a\s+stub|stub(?:bed)?\s+(?:out|for\s+now|response|impl|until|handler)|stub:|placeholder\s+(?:impl|implementation|response|until|data)|for\s+now[,:]?\s+(?:just\s+)?(?:return|hard-?code)|hard-?cod(?:e|ed|ing)\s+(?:for\s+now|until\s|this\s+(?:response|result|list))|fake\s+(?:it|response|data)\s+(?:for\s+now|until)|simulat(?:e|ed|ing)\s+(?:a\s+)?(?:response|result|success)\b|returns?\s+(?:a\s+)?(?:canned|hardcoded|fake|dummy)\b|not\s+wired\s+(?:up\s+)?yet|real\s+impl(?:ementation)?\s+(?:pending|todo|later))/i;

// Macro-name shapes that legitimately return small static / enum / status
// data — a { ok: true } with a constant list is the correct implementation,
// not a stub. Excludes the noop-success rule only (never the marker rule).
const STATIC_SHAPE_NAME_RE =
  /^(?:status|health|healthz|ping|info|version|ready|readyz|ok|constants?|options?|config|settings|schema|capabilities|kinds?|types?|presets?|catalog|catalogue|fields?|enums?|list|list[-_].+|.+[-_]list|defaults?|manifest|meta|about|help)$/i;

// Body text that is a code-generation template, not a real handler.
const TEMPLATE_BODY_RE = /\{\s*\.\.\.\s*\}|\/\/\s*(?:action\s+logic\s+here|your\s+(?:code|logic)\s+here|implement(?:ation)?\s+here|\.\.\.)|<your[- ]/i;

// ── disguised-stub signal 2: no-op success ──────────────────────────────
const RETURNS_OK_TRUE_RE = /return\s*\{[^}]*\bok\s*:\s*true\b/;
const RETURNS_OK_FALSE_RE = /return\s*\{[^}]*\bok\s*:\s*false\b/;
// "real work" tokens — presence of ANY means the handler does something.
const REAL_WORK_RE =
  /\b(?:await|db\b|ctx\.(?!log\b)|STATE\b|runMacro\b|params\.[a-zA-Z_$]|input\.[a-zA-Z_$]|artifact\.[a-zA-Z_$]|req\.[a-zA-Z_$]|opts\.[a-zA-Z_$]|\.prepare\(|\.run\(|\.get\(|\.all\(|\.push\(|\.set\(|\.delete\(|\.filter\(|\.map\(|\.reduce\(|\.find\(|emit\(|dispatch\(|fetch\(|throw\b|if\s*\(|for\s*\(|while\s*\(|switch\s*\()/;
// A returned value that is a bare module constant (SCREAMING_SNAKE or
// PascalCase identifier) is a catalog/enum delegation — the `utility` tier,
// not a stub. e.g. `return { ok:true, result:{ templates: AGENT_TEMPLATES } }`.
const CATALOG_RETURN_RE = /return\s*\{[\s\S]*?\b(?:[A-Z][A-Z0-9_]{3,}|[A-Z][a-zA-Z0-9]*[a-z][A-Z][a-zA-Z0-9]*)\b[\s\S]*?\}/;
// Any non-trivial helper call means it delegates real logic somewhere.
const HELPER_CALL_RE =
  /\b(?!return|if|for|while|switch|typeof|String|Number|Boolean|Object|Array|JSON|Math|Date|Set|Map|Promise|parseInt|parseFloat|isNaN|Array)([a-zA-Z_$][\w$]{2,})\s*\(/;

/**
 * Given the full (comment-stripped) source and the index just past the
 * `register(…, "d", "n",` comma, extract the handler function body `{…}`.
 * Returns { body, concise:false } for a block body, { body, concise:true }
 * for a concise arrow (`=> expr`), or null if it can't be resolved.
 */
export function extractHandlerBody(src, afterCommaIdx) {
  // skip whitespace
  let i = afterCommaIdx;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (i >= src.length) return null;

  // Case A: named reference — `register("d","n", myHandler)` or `, myHandler);`
  const refMatch = /^([A-Za-z_$][\w$]*)\s*[),]/.exec(src.slice(i, i + 120));
  if (refMatch) {
    const name = refMatch[1];
    // resolve one level in the same file
    const defRe = new RegExp(
      String.raw`(?:function\s+${name}\s*\([^)]*\)\s*\{|(?:const|let|var)\s+${name}\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{|(?:const|let|var)\s+${name}\s*=\s*(?:async\s*)?function\s*\*?\s*\([^)]*\)\s*\{)`,
    );
    const dm = defRe.exec(src);
    if (!dm) return null;
    const braceStart = src.indexOf("{", dm.index);
    const body = balancedBlock(src, braceStart);
    return body == null ? null : { body, concise: false, resolvedFrom: name };
  }

  // Case B: inline function — arrow or function expression
  // Consume an optional `async`, then params `(...)` or a single ident, then `=>` or it's `function`.
  let j = i;
  if (src.startsWith("async", j)) j += 5;
  while (j < src.length && /\s/.test(src[j])) j++;

  if (src.startsWith("function", j)) {
    const braceStart = src.indexOf("{", j);
    if (braceStart < 0) return null;
    const body = balancedBlock(src, braceStart);
    return body == null ? null : { body, concise: false };
  }

  // arrow: params
  if (src[j] === "(") {
    const close = matchParen(src, j);
    if (close < 0) return null;
    j = close + 1;
  } else if (/[A-Za-z_$]/.test(src[j])) {
    while (j < src.length && /[\w$]/.test(src[j])) j++;
  } else {
    return null;
  }
  while (j < src.length && /\s/.test(src[j])) j++;
  if (src[j] !== "=" || src[j + 1] !== ">") return null;
  j += 2;
  while (j < src.length && /\s/.test(src[j])) j++;

  if (src[j] === "{") {
    const body = balancedBlock(src, j);
    return body == null ? null : { body, concise: false };
  }
  // concise arrow — grab until the top-level `)` or `;` that closes the register() call
  let depth = 0, k = j, out = "";
  while (k < src.length) {
    const ch = src[k];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) break;
      depth--;
    } else if (ch === ";" && depth === 0) break;
    out += ch;
    k++;
  }
  return { body: out.trim(), concise: true };
}

function balancedBlock(src, braceStart) {
  if (braceStart < 0 || src[braceStart] !== "{") return null;
  let depth = 0;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(braceStart + 1, i); }
  }
  return null;
}
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Classify a single handler.
 * @param body    comment-stripped handler body (for structure/logic checks)
 * @param rawBody raw handler body incl. comments (for incompleteness markers)
 * @returns { id, severity, message, reason? } or null
 */
export function classifyHandlerBody(body, rawBody, { concise, macroName } = {}) {
  const compact = body.replace(/\s+/g, " ").trim();
  if (TEMPLATE_BODY_RE.test(body) || TEMPLATE_BODY_RE.test(rawBody || "")) return null;
  const returnsOkFalse = RETURNS_OK_FALSE_RE.test(body);
  const returnsOkTrue = RETURNS_OK_TRUE_RE.test(body);
  const presentsAsWorking =
    returnsOkTrue || concise || (!returnsOkFalse && /return\s*[{[]/.test(body));

  // Honest roadmap stub — NOT a bug, inventoried at info level.
  if (returnsOkFalse && !returnsOkTrue && ROADMAP_REASON_RE.test(body)) {
    const m = ROADMAP_REASON_RE.exec(body);
    return {
      id: "macro_honest_roadmap_stub", severity: "info", reason: (m?.[1] || "roadmap").toLowerCase(),
      message: `honest not-yet-wired stub (reason: ${(m?.[1] || "roadmap").toLowerCase()})`,
    };
  }

  // 1. Explicit incompleteness marker in a COMMENT, in a handler that still
  //    presents success. This is the "disguised as working" core case.
  if (presentsAsWorking && rawBody && TODO_COMMENT_RE.test(rawBody)) {
    const m = TODO_COMMENT_RE.exec(rawBody);
    const marker = (m?.[0] || "").replace(/^[\s/*]+/, "").trim();
    return {
      id: "macro_todo_stub", severity: "medium",
      message: `handler carries an incompleteness marker ("${snippet(marker, 48)}") but still returns a success shape`,
    };
  }

  // 2. No-op success — the whole body is (effectively) `return { ok: true, … }`
  //    with no db/ctx/input read, no await, no branching, no real helper call,
  //    and the returned value is not a module catalog constant.
  if (
    returnsOkTrue &&
    !concise &&
    compact.length <= 300 &&
    !(macroName && STATIC_SHAPE_NAME_RE.test(macroName)) &&
    !REAL_WORK_RE.test(body) &&
    !CATALOG_RETURN_RE.test(body) &&
    !HELPER_CALL_RE.test(body.replace(/return\s*/g, " "))
  ) {
    return {
      id: "macro_noop_success", severity: "medium",
      message: "handler is effectively `return { ok: true }` — no db/ctx/input read, no computation, no delegation",
    };
  }

  return null;
}

/**
 * Pull the raw (comment-included) handler-body slice for a register call.
 * Scans from `fromIdx` forward, brace-matches with string/comment awareness,
 * returns the `{…}` interior or "" if it can't be matched cleanly.
 */
export function rawBodySlice(raw, fromIdx) {
  // find the first `{` that opens the handler block (skip the params paren)
  let i = fromIdx;
  // skip an optional `async`
  const head = raw.slice(i, i + 4000);
  const arrowBrace = head.search(/=>\s*\{/);
  const fnBrace = head.search(/function\s*\*?\s*[\w$]*\s*\([^)]*\)\s*\{/);
  let open = -1;
  if (arrowBrace >= 0 && (fnBrace < 0 || arrowBrace < fnBrace)) {
    open = i + head.indexOf("{", arrowBrace);
  } else if (fnBrace >= 0) {
    open = i + head.indexOf("{", fnBrace);
  }
  if (open < 0) return "";
  let depth = 0, str = null, k = open;
  for (; k < raw.length && k < open + 20000; k++) {
    const c = raw[k], n = raw[k + 1];
    if (str) {
      if (c === "\\") { k++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "/" && n === "/") { while (k < raw.length && raw[k] !== "\n") k++; continue; }
    if (c === "/" && n === "*") { k += 2; while (k < raw.length && !(raw[k] === "*" && raw[k + 1] === "/")) k++; k++; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return raw.slice(open + 1, k); }
  }
  return "";
}

/** Locate the raw-source index of `register…("domain", "name",` (best-effort). */
export function findRegisterInRaw(raw, domain, name) {
  const re = new RegExp(
    String.raw`\bregister(?:LensAction)?\s*\(\s*["'\`]${domain.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}["'\`]\s*,\s*["'\`]${name.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}["'\`]`,
  );
  const m = re.exec(raw);
  return m ? m.index : -1;
}

export async function runMacroStubDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("macro-stub", "no_root", null, t0);

  try {
    const serverDir = path.join(root, "server");
    const files = (await walk(serverDir, [".js"])).filter(
      (f) => !SKIP_RE.some((re) => re.test(relPath(root, f))),
    );

    // telemetry — which macros actually fired (best-effort)
    let liveKeys = new Set();
    try {
      const agg = await _loadAggregated(root, _MACRO_LIVE_WINDOW_DAYS ?? 7);
      liveKeys = agg?.liveKeys instanceof Set ? agg.liveKeys : new Set();
    } catch { /* telemetry optional */ }

    const findings = [];
    const roadmapStubs = [];
    let analysed = 0, unresolved = 0;
    const bySeverity = { high: 0, medium: 0, low: 0 };

    for (const f of files) {
      const raw = await readSafe(f);
      if (!raw) continue;
      if (!/\bregister(?:LensAction)?\s*\(/.test(raw)) continue;
      const rel = relPath(root, f);
      const src = stripCommentsAndRegex(raw);
      const rawLines = raw.split("\n");

      REGISTER_CALL_RE.lastIndex = 0;
      let m;
      while ((m = REGISTER_CALL_RE.exec(src)) != null) {
        const alias = m[1];
        // alias must be a plausible registrar
        if (!/^register/i.test(alias) && !/^(reg|r|add|define|lens)$/i.test(alias)) continue;
        const domain = m[2];
        const name = m[3];
        const key = `${domain}.${name}`;
        const callLine = lineOf(src, m.index);

        // annotation opt-out — check raw source around the call line
        const annoWindow = rawLines.slice(Math.max(0, callLine - 3), callLine + 1).join("\n");
        if (STUB_OK_RE.test(annoWindow)) continue;

        const handler = extractHandlerBody(src, REGISTER_CALL_RE.lastIndex);
        if (!handler) { unresolved++; continue; }

        // raw body (comments intact) for the incompleteness-marker check
        const rawIdx = findRegisterInRaw(raw, domain, name);
        const rawBody = handler.concise || rawIdx < 0 ? "" : rawBodySlice(raw, rawIdx);
        if (STUB_OK_RE.test(rawBody)) continue;

        analysed++;
        const verdict = classifyHandlerBody(handler.body, rawBody, { concise: handler.concise, macroName: name });
        if (!verdict) continue;

        if (verdict.id === "macro_honest_roadmap_stub") {
          roadmapStubs.push(key);
          findings.push({
            id: verdict.id, severity: "info", kind: "semantic", category: "macro-stub",
            message: `Macro ${key}: ${verdict.message}`,
            location: `${rel}:${callLine}`,
            evidence: { macro: key, reason: verdict.reason },
          });
          continue;
        }

        // Severity stays static (deterministic ratchet); a runtime hit is
        // stamped in evidence so triage can prioritise, without making the
        // finding count vary with telemetry noise.
        const severity = verdict.severity;
        const runtimeHit = liveKeys.has(key);
        bySeverity[severity] = (bySeverity[severity] || 0) + 1;

        findings.push({
          id: verdict.id,
          severity,
          kind: "semantic",
          category: "macro-stub",
          message: `Macro ${key}: ${verdict.message}${runtimeHit ? " [fired at runtime in the live window]" : ""}`,
          location: `${rel}:${callLine}`,
          evidence: {
            macro: key,
            runtimeHit,
            bodyPreview: snippet(handler.body.replace(/\s+/g, " ").trim(), 180),
            resolvedFrom: handler.resolvedFrom,
          },
          fixHint: "implement_macro_or_return_honest_failure",
        });
      }
    }

    findings.unshift({
      id: "macro_stub_summary",
      severity: "info",
      kind: "semantic",
      category: "macro-stub",
      message: `${analysed} handler bodies analysed · ${bySeverity.high} high · ${bySeverity.medium} medium · ${bySeverity.low} low · ${roadmapStubs.length} honest roadmap stubs · ${unresolved} unresolved refs`,
      evidence: {
        analysed, unresolved,
        disguisedStubs: bySeverity,
        honestRoadmapStubs: roadmapStubs.slice(0, 120),
        telemetryActive: liveKeys.size > 0,
      },
    });

    return makeReport("macro-stub", findings, t0);
  } catch (err) {
    return makeError("macro-stub", "exception", err, t0);
  }
}
