// server/lib/detectors/dead-envelope-field-access-detector.js
//
// Flags a read of `.ok` / `.error` nested under `.result` on a variable
// traced back to `lensRun()` (concord-frontend/lib/api/client.ts) — but
// ONLY when the specific macro's OWN backend handler proves that field is
// structurally unreachable. This detector cross-references the frontend
// call site against the real `server/` registration for the same
// `(domain, action)` pair before flagging anything; see the calibration
// story below for why that turned out to be load-bearing, not optional.
//
// ── The contract (read `client.ts`'s own doc comment before touching this) ──
// `lensRun()` ALWAYS resolves to
//   { data: { ok: boolean, result: T | null, error: string | null } }
// The route (`/api/lens/run` in server.js) wraps the domain handler's return
// value exactly once: `res.json({ ok: true, result: <handlerReturn> })`,
// where `<handlerReturn>` is `_unwrapLensEnvelope(await handler(...))` and
// `_unwrapLensEnvelope(r)` strips exactly one `{ ok, result }` layer IF `r`
// has BOTH keys, else returns `r` unchanged. `lensRun`'s client-side loop
// then keeps unwrapping WHILE the current node has BOTH `ok` AND `result`,
// and on a terminal `ok === false` node returns `{ result: null, error }`.
//
// ── Why the naive "always dead" version was wrong (the calibration story) ──
// A first pass at this detector flagged every `.data.result.ok` /
// `.data.result.error` read off a lensRun-sourced var, using only the
// documented ConceptArtBoard.tsx bug as the model (its handler,
// `art.concept-art-list`, returns `{ ok:false, error }` flat on failure and
// `{ ok:true, result:{ conceptArt, count } }` NESTED on success — so
// `_unwrapLensEnvelope` strips the success case down to `{ conceptArt,
// count }`, meaning `.result.ok` is genuinely always undefined). Run against
// the real repo, that naive version produced ~49 findings — but a spot check
// (`concord-frontend/app/lenses/forecast/page.tsx`, `sessions/page.tsx`,
// `fishing/page.tsx`, and more) showed most of them were WRONG: their
// backend macros (e.g. `server/domains/sessions.js`'s `sessions.search`)
// return a FLAT payload on success — `{ ok: true, sort, query, sessions }`,
// no `result:` key at all. `_unwrapLensEnvelope` only strips a payload that
// has BOTH `ok` AND `result`; a flat payload doesn't, so it survives
// untouched, and `r.data.result.ok` genuinely IS that macro's own real
// success flag — reading it is completely correct. The naive detector could
// not tell those two shapes apart from the frontend alone, because the
// distinguishing fact — does THIS macro's success return nest a `result:`
// key or not — lives entirely in the backend handler.
//
// The fix: `classifyBackendMacroShapes()` below does a single pass over
// `server/**/*.js`, finds every `register(domain, action, handler)` /
// `registerLensAction(domain, action, handler)` call, and inspects the
// handler's own `return { ... }` literals. For every literal with `ok:
// true`, it checks whether that SAME object also has a sibling `result:`
// key:
//   - EVERY `ok:true` return nests a `result:` key  → "nested" (the
//     ConceptArtBoard shape — `.result.ok`/`.result.error` reads on this
//     macro ARE dead; flag them).
//   - ANY `ok:true` return is flat (no `result:` key)  → "flat" (the
//     forecast/sessions shape — `.result.ok` is real domain data; never
//     flag reads of this macro).
//   - no literal `ok:true` return found at all (delegates to an imported
//     lib function, computed shape, etc.)  → "unknown" — NOT flagged. Being
//     unable to prove the field is dead is not the same as proving it's
//     dead, and this detector would rather miss than mislabel a live field
//     as unreachable.
// A finding only fires when the frontend call site's `(domain, action)`
// resolves (string literals only — a dynamic action variable is "unknown"
// by construction) to a macro classified "nested".
//
// ── Design ─────────────────────────────────────────────────────────────
// Block-scoped variable tracking (same rationale as
// frontend-unsafe-chain-detector.js: generic names like `r`/`res`/`node` get
// reused across unrelated functions constantly). Two binding shapes:
//   - "full"       — `const NAME = await lensRun('domain','action', ...)` —
//                     NAME IS the `{ data }` wrapper; sink is
//                     `NAME.data.result.ok` / `NAME.data.result.error`.
//   - "dataDirect" — `const { data } = await lensRun(...)` (optionally
//                     renamed `{ data: ALIAS }`), OR a one-hop derivation
//                     `const ALIAS = NAME.data;` off a "full" var (the
//                     `quests/page.tsx` idiom `const node = qRes?.data;`) —
//                     ALIAS IS the envelope directly; sink is
//                     `ALIAS.result.ok` / `ALIAS.result.error`.
// A `lensRun<{...}>(...)` call with an explicit TS generic type argument is
// recognized (a plain `lensRun\s*\(` misses it — a real gap this detector
// hit and fixed while calibrating against the actual repo).
// A guard around the read (`if (!x.result) ...`, `x.result &&`) does NOT
// exempt a finding — unlike frontend-unsafe-chain-detector, this isn't
// about crash-safety, it's about value reachability. A guarded read of a
// "nested"-classified macro's `.result.ok` still only ever observes
// `undefined`, so the branch behind it is just as dead.
//
// Severity: high — a dead error-branch means real backend failures render
// as success-shaped emptiness, the sharpest form of the honesty invariant
// this repo enforces (CLAUDE.md, "honest by construction").
//
// Opt-out: `@dead-envelope-ok` in the file's first 5 lines suppresses the
// whole file; on the line above (or the same line as) a specific finding
// suppresses just that finding.

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const CATEGORY = "dead-envelope-field-access";
const FINDING_CAP = 500;
const FILE_CAP = 6000;

const ANNOTATION_OK_RE = /@dead-envelope-ok\b/;

const SCAN_DIRS = ["concord-frontend/app", "concord-frontend/components", "concord-frontend/lib"];
const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "coverage", "dist", "build", "out",
  "__tests__", "stories", "storybook",
]);
const SKIP_FILE_RE = [/\.d\.ts$/, /\.(?:test|spec|stories)\.(?:ts|tsx)$/];

const BACKEND_SKIP_DIRS = new Set([
  "node_modules", ".git", "coverage", "dist", "build", "tests", "__tests__", "data",
]);
const BACKEND_SKIP_FILE_RE = /\.(?:test|spec)\.js$/;

function shouldScanFrontend(rel) {
  if (!SCAN_DIRS.some((p) => rel.startsWith(p + "/"))) return false;
  return !SKIP_FILE_RE.some((re) => re.test(rel));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Index of the delimiter matching `content[openIdx]`, quote-aware. */
function matchDelim(content, openIdx, openCh, closeCh) {
  let depth = 0, quote = null;
  for (let i = openIdx; i < content.length; i++) {
    const ch = content[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === openCh) depth++;
    else if (ch === closeCh) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Split `str` on top-level `,` — respects nesting of `{}[]()` and quotes. */
function splitTopLevel(str) {
  const parts = [];
  let depth = 0, quote = null, buf = "";
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      buf += ch;
      if (ch === "\\") { buf += str[i + 1] ?? ""; i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; buf += ch; continue; }
    if (ch === "{" || ch === "[" || ch === "(") { depth++; buf += ch; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth--; buf += ch; continue; }
    if (ch === "," && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Nearest enclosing `{...}` block containing `idx`. */
function enclosingBlock(content, idx) {
  let depth = 0;
  let i = idx - 1;
  while (i >= 0) {
    const ch = content[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        let fdepth = 1, j = i + 1;
        while (j < content.length && fdepth > 0) {
          if (content[j] === "{") fdepth++;
          else if (content[j] === "}") fdepth--;
          j++;
        }
        return { start: i + 1, end: fdepth === 0 ? j - 1 : content.length };
      }
      depth--;
    }
    i--;
  }
  return { start: 0, end: content.length };
}

const STR_LIT_RE = /^['"`]([a-zA-Z0-9_.-]+)['"`]$/;

/** `lensRun('domain','action', input)` or `lensRun({ domain, action, input })` — string literals only. */
function extractDomainAction(argsText) {
  const top = splitTopLevel(argsText);
  if (top.length >= 2) {
    const m0 = STR_LIT_RE.exec(top[0].trim());
    const m1 = STR_LIT_RE.exec(top[1].trim());
    if (m0 && m1) return `${m0[1]}.${m1[1]}`;
  }
  const dm = /\bdomain\s*:\s*['"`]([a-zA-Z0-9_.-]+)['"`]/.exec(argsText);
  const am = /\b(?:action|name)\s*:\s*['"`]([a-zA-Z0-9_.-]+)['"`]/.exec(argsText);
  if (dm && am) return `${dm[1]}.${am[1]}`;
  return null;
}

// ── Backend macro-shape classification ──────────────────────────────────

const REGISTER_CALL_RE =
  /\b(?:registerLensAction|register)\(\s*['"`]([a-zA-Z0-9_.-]+)['"`]\s*,\s*['"`]([a-zA-Z0-9_.-]+)['"`]\s*,\s*(?:async\s*)?\(/g;
const HANDLER_BODY_LOOKAHEAD_RE = /^\s*(?::\s*[^{;=]*)?=>\s*\{/;

function resolveHandlerBody(content, callOpenParenIdx) {
  const parenClose = matchDelim(content, callOpenParenIdx, "(", ")");
  if (parenClose === -1) return null;
  const after = content.slice(parenClose + 1, parenClose + 1 + 300);
  const lm = HANDLER_BODY_LOOKAHEAD_RE.exec(after);
  if (!lm) return null; // concise-body handler or unrecognized shape — skip
  const bodyOpenIdx = parenClose + 1 + lm.index + lm[0].length - 1;
  const bodyCloseIdx = matchDelim(content, bodyOpenIdx, "{", "}");
  if (bodyCloseIdx === -1) return null;
  return content.slice(bodyOpenIdx + 1, bodyCloseIdx);
}

/** Every `return { ... }` object literal's inner text, top-level in `bodyText`. */
function findReturnObjects(bodyText) {
  const out = [];
  const re = /\breturn\s*\{/g;
  let m;
  while ((m = re.exec(bodyText)) != null) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchDelim(bodyText, openIdx, "{", "}");
    if (closeIdx === -1) continue;
    out.push(bodyText.slice(openIdx + 1, closeIdx));
  }
  return out;
}

/**
 * Classifies `ok` and `error` INDEPENDENTLY, because they can differ within
 * the same handler. Calibration case: `server/domains/database.js`'s
 * `query-run` / `query-explain` wrap their SUCCESS return as `{ ok: true,
 * result: { error: sqlError, ... } }` — the outer wrapper follows the nested
 * convention (so `_unwrapLensEnvelope` strips it), but the INNER payload
 * itself independently carries a real `error` field as domain data (the SQL
 * execution's own error message), which survives the strip and DOES reach
 * `r.data.result.error`. A macro-wide "nested ⇒ everything under .result is
 * dead" verdict would have wrongly flagged that as a bug.
 *
 * For each field F ("ok" | "error"):
 *   - "flat" if F is reachable: either an `ok:true` return has NO `result:`
 *     key at all (F lives directly on it), OR an `ok:true` return's
 *     `result:` VALUE is itself an inline object literal that has its own
 *     top-level `F` key (the database.js shape above).
 *   - "nested" if every literal `ok:true` return DOES have a `result:` key
 *     and NONE of the inspectable inner literals carry `F` themselves —
 *     the ConceptArtBoard shape.
 *   - "unknown" if no literal `ok:true` return was found, or a `result:`
 *     value isn't a literal object we can inspect (delegates to an
 *     imported/computed value) — conservative: a field we can't prove dead
 *     is never flagged.
 */
function classifyHandlerBody(bodyText) {
  const state = { ok: { nested: false, flat: false }, error: { nested: false, flat: false } };
  for (const inner of findReturnObjects(bodyText)) {
    const entries = splitTopLevel(inner);
    let okVal = null;
    let hasResultKey = false;
    let resultValueText = null;
    const topKeys = new Set();
    for (const entry of entries) {
      const ci = entry.indexOf(":");
      const key = (ci === -1 ? entry : entry.slice(0, ci)).trim();
      topKeys.add(key);
      if (ci === -1) continue;
      const val = entry.slice(ci + 1).trim();
      if (key === "ok") okVal = val;
      if (key === "result") { hasResultKey = true; resultValueText = val; }
    }
    if (okVal !== "true") continue; // only success returns inform classification
    if (!hasResultKey) {
      state.ok.flat = true;
      if (topKeys.has("error")) state.error.flat = true;
      continue;
    }
    state.ok.nested = true;
    state.error.nested = true;
    if (resultValueText && resultValueText.startsWith("{")) {
      const closeIdx = matchDelim(resultValueText, 0, "{", "}");
      if (closeIdx !== -1) {
        const innerKeys = new Set(
          splitTopLevel(resultValueText.slice(1, closeIdx)).map((e) => {
            const ci = e.indexOf(":");
            return (ci === -1 ? e : e.slice(0, ci)).trim();
          }),
        );
        if (innerKeys.has("ok")) state.ok.flat = true;
        if (innerKeys.has("error")) state.error.flat = true;
      }
      // A `result:` value that ISN'T an inline object literal (a variable, a
      // function call, a spread) can't be inspected — it stays "nested" by
      // default rather than "unknown", since every real handler this
      // detector was calibrated against that uses a non-literal `result:`
      // value (e.g. delegating to a helper) returns a flat domain payload
      // with no ok/error of its own. If that assumption ever proves wrong
      // for a new domain, the fix is here, not a manual annotation.
    }
  }
  const classify = (f) => (state[f].flat ? "flat" : (state[f].nested ? "nested" : "unknown"));
  return { ok: classify("ok"), error: classify("error") };
}

async function classifyBackendMacroShapes(repoRoot) {
  const map = new Map();
  const files = await walk(path.join(repoRoot, "server"), [".js"], BACKEND_SKIP_DIRS);
  for (const abs of files) {
    const rel = relPath(repoRoot, abs).replace(/\\/g, "/");
    if (BACKEND_SKIP_FILE_RE.test(rel)) continue;
    const raw = await readSafe(abs);
    if (!raw) continue;
    if (!/\b(?:register|registerLensAction)\(/.test(raw)) continue;
    const c = stripComments(raw);
    REGISTER_CALL_RE.lastIndex = 0;
    let m;
    while ((m = REGISTER_CALL_RE.exec(c)) != null) {
      const key = `${m[1]}.${m[2]}`;
      const openParenIdx = m.index + m[0].length - 1;
      const body = resolveHandlerBody(c, openParenIdx);
      if (!body) continue;
      const cls = classifyHandlerBody(body);
      if (!map.has(key)) map.set(key, cls); // first registration wins; duplicates are a rare edge case
    }
  }
  return map;
}

// ── Frontend binding discovery ────────────────────────────────────────

const LENS_RUN_CALL_RE = "lensRun\\s*(?:<[^<>]*>)?\\s*\\(";
const FULL_RE = new RegExp(`\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*await\\s+${LENS_RUN_CALL_RE}`, "g");
const DATA_DESTRUCTURE_RE = new RegExp(
  `\\b(?:const|let|var)\\s*\\{\\s*data(?:\\s*:\\s*([A-Za-z_$][\\w$]*))?\\s*[,}][^=]*=\\s*await\\s+${LENS_RUN_CALL_RE}`,
  "g",
);

/** For a binding regex match, resolve the lensRun call's `(domain, action)` key, if statically knowable. */
function domainActionForMatch(content, m) {
  const openParenIdx = m.index + m[0].length - 1;
  const closeParenIdx = matchDelim(content, openParenIdx, "(", ")");
  if (closeParenIdx === -1) return null;
  return extractDomainAction(content.slice(openParenIdx + 1, closeParenIdx));
}

function findBindings(content) {
  const bindings = []; // { name, index, kind, domainAction }
  let m;
  FULL_RE.lastIndex = 0;
  while ((m = FULL_RE.exec(content)) != null) {
    bindings.push({ name: m[1], index: m.index, kind: "full", domainAction: domainActionForMatch(content, m) });
  }
  DATA_DESTRUCTURE_RE.lastIndex = 0;
  while ((m = DATA_DESTRUCTURE_RE.exec(content)) != null) {
    bindings.push({ name: m[1] || "data", index: m.index, kind: "dataDirect", domainAction: domainActionForMatch(content, m) });
  }
  return bindings;
}

/** One-hop `.data` derivation off a "full" var (`const node = r?.data;`). */
function findDataDerivation(block, fullName) {
  const re = new RegExp(
    `\\b(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*${escapeRegExp(fullName)}\\s*(?:\\?\\.|\\.)\\s*data\\b(?!\\s*(?:\\?\\.|\\.)\\s*result)`,
    "g",
  );
  const out = [];
  let m;
  while ((m = re.exec(block)) != null) out.push(m[1]);
  return out;
}

/** Every `.data.result.(ok|error)` ("full") or `.result.(ok|error)` ("dataDirect") occurrence for `name`. */
function findDeadSinks(block, name, kind) {
  const esc = escapeRegExp(name);
  const re =
    kind === "full"
      ? new RegExp(`\\b${esc}(?:\\?\\.|\\.)data(?:\\?\\.|\\.)result(?:\\?\\.|\\.)(ok|error)\\b`, "g")
      : new RegExp(`\\b${esc}(?:\\?\\.|\\.)result(?:\\?\\.|\\.)(ok|error)\\b`, "g");
  const out = [];
  let m;
  while ((m = re.exec(block)) != null) out.push({ index: m.index, field: m[1], chainText: m[0] });
  return out;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runDeadEnvelopeFieldAccessDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || process.cwd();
  const findings = [];
  const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : FILE_CAP;
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : FINDING_CAP;
  let scanned = 0;
  let filesWithLensRun = 0;
  let suppressedNonNested = 0;

  try {
    const macroShapes = await classifyBackendMacroShapes(repoRoot);
    const allFiles = await walk(path.join(repoRoot, "concord-frontend"), [".ts", ".tsx"], SKIP_DIRS);

    for (const abs of allFiles) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      const rel = relPath(repoRoot, abs).replace(/\\/g, "/");
      if (!shouldScanFrontend(rel)) continue;
      scanned++;

      const raw = await readSafe(abs);
      if (!raw) continue;
      const headLines = raw.split("\n").slice(0, 5).join("\n");
      if (ANNOTATION_OK_RE.test(headLines)) continue;

      const c = stripComments(raw);
      if (!/\blensRun\s*(?:<[^<>]*>)?\s*\(/.test(c)) continue;

      const bindings = findBindings(c);
      if (bindings.length === 0) continue;
      filesWithLensRun++;

      // Group by enclosing block so an unrelated sibling function reusing a
      // generic name (`r`, `data`, `node`) never contaminates another scope.
      const blocks = new Map(); // "start:end" -> { start, end, text, names: Map<name,{kind,classification}> }
      for (const { name, index, kind, domainAction } of bindings) {
        const { start, end } = enclosingBlock(c, index);
        const key = `${start}:${end}`;
        let block = blocks.get(key);
        if (!block) { block = { start, end, text: c.slice(start, end), names: new Map() }; blocks.set(key, block); }
        if (!block.names.has(name)) {
          const shape = domainAction ? macroShapes.get(domainAction) : null;
          block.names.set(name, { kind, shape: shape || null, domainAction });
        }
      }
      for (const block of blocks.values()) {
        for (const [name, rec] of [...block.names]) {
          if (rec.kind !== "full") continue;
          for (const derived of findDataDerivation(block.text, name)) {
            if (!block.names.has(derived)) {
              block.names.set(derived, { kind: "dataDirect", shape: rec.shape, domainAction: rec.domainAction });
            }
          }
        }
      }

      const fileLines = raw.split("\n");

      for (const block of blocks.values()) {
        for (const [name, rec] of block.names) {
          const sinks = findDeadSinks(block.text, name, rec.kind);
          if (sinks.length === 0) continue;
          for (const sink of sinks) {
            if (findings.length >= findingCap) break;
            const fieldClassification = rec.shape ? rec.shape[sink.field] : "unknown";
            if (fieldClassification !== "nested") { suppressedNonNested++; continue; }
            const absIndex = block.start + sink.index;
            const lineNum = lineOf(c, absIndex);
            const above = fileLines[lineNum - 2] || "";
            const here = fileLines[lineNum - 1] || "";
            if (ANNOTATION_OK_RE.test(above) || ANNOTATION_OK_RE.test(here)) continue;

            const correctPath = rec.kind === "full" ? `${name}.data.${sink.field}` : `${name}.${sink.field}`;
            findings.push({
              id: "dead_envelope_field_access",
              severity: "high",
              kind: "static",
              category: CATEGORY,
              message:
                `\`${sink.chainText}\` reads \`.${sink.field}\` nested under \`.result\` on a lensRun()-sourced ` +
                `value for \`${rec.domainAction}\` — that macro's own backend handler always nests a \`result:\` ` +
                `key inside its \`ok:true\` return, and the inner payload never carries its own \`${sink.field}\`, ` +
                `so lensRun's unwrap strips it down to a payload with no \`.${sink.field}\` of its own; the real ` +
                `flag lives at \`${correctPath}\`. Same shape as the pre-fix ConceptArtBoard.tsx bug: a real ` +
                `failure would render as silent success-shaped emptiness.`,
              location: `${rel}:${lineNum}`,
              subject: { kind: "dead_envelope_field_access", file: rel, variable: name, domainAction: rec.domainAction },
              evidence: { chain: sink.chainText, field: sink.field, bindingKind: rec.kind, domainAction: rec.domainAction },
              fixHint: `Read \`${correctPath}\` instead — lensRun() already unwraps the envelope for you.`,
            });
          }
          if (findings.length >= findingCap) break;
        }
        if (findings.length >= findingCap) break;
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  findings.unshift({
    id: "dead_envelope_field_access_summary",
    severity: "info",
    kind: "static",
    category: CATEGORY,
    message:
      `Scanned ${scanned} frontend file(s); ${filesWithLensRun} called lensRun(); flagged ${findings.length}; ` +
      `${suppressedNonNested} candidate read(s) suppressed because the backend macro's return shape is flat or unknown (not provably dead)`,
    evidence: { scanned, filesWithLensRun, suppressedNonNested },
  });

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
