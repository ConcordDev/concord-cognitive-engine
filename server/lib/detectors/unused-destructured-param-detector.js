// server/lib/detectors/unused-destructured-param-detector.js
//
// Flags a function that destructures an object parameter and never
// references one of the bound names anywhere in its body. The signature
// promises the value matters (it's pulled out by name, sometimes with a
// default); the body proves it doesn't.
//
// Seeded from a real bug (fixed during conductor verification, so the
// fixtures below are a synthetic reproduction, not the live file):
//
//   function analyticISI({ tau_m, V_rest, V_reset, V_th, R, refractory }, I) {
//     const drive = R * I;
//     const gap = V_th - V_rest;
//     return tau_m * Math.log(drive / (drive - gap));   // <- V_reset, refractory unused
//   }
//
// (`server/lib/simulation/spiking-network.js`.) The function destructured a
// full neuron-params object, which reads as general/complete, so a caller
// passing a distinct reset potential or a nonzero refractory period got a
// confidently wrong ISI with no warning anywhere — the formula was only
// correct when `V_reset === V_rest` and `refractory === 0`.
//
// ── Scope (deliberately narrow, for precision) ──────────────────────────
// Only two unambiguous function-definition shapes are analyzed:
//   1. `function NAME({ ... }, ...) { ... }`             — named declarations
//   2. `const/let/var NAME = ({ ... }, ...) => { ... }`  — arrow assigned to
//      a binding
// Anonymous inline callbacks (`arr.map(({a,b}) => ...)`, a macro registered
// with an inline arrow) are NOT analyzed: an inline `(` that opens an object
// literal is trivially confusable with a plain call's argument list (`foo({a:
// 1})` is a call, not a definition), and disambiguating the two reliably needs
// more than regex scanning. Missing those is an accepted false-negative, not
// a soundness bug — this detector prefers missing a few over crying wolf.
// Only BLOCK-bodied functions (`=> { ... }`, a real `{` after the params) are
// analyzed. A concise-body arrow (`({a}) => a.b`) has no braces to bound a
// body scan and is skipped. A signature with a return type containing an
// inline object type (`: Promise<{ ok: boolean }>`) is also skipped — the
// lookahead used to find the real body brace deliberately refuses to match
// through an unexpected `{`, rather than risk mistaking the return type's
// own braces for the function body (which would make every param look
// unused). Ambient/overload signatures with no body (`;` right after the
// params, `.d.ts` files) are skipped outright.
//
// ── What "unused" means ──────────────────────────────────────────────────
// A destructured binding counts as USED if its bound name (the alias, for a
// rename `key: alias`) appears anywhere in the function body text as a whole
// word — this deliberately also catches the common "just pass it through"
// idioms without any special-casing:
//   - `return { id, label };`      — shorthand return re-uses the identifier
//   - `x.field = value;`           — assignment uses it
//   - `return <button>{label}</button>;` — JSX interpolation uses it
//   - `return <div {...rest}>...` — JSX spread uses it
// NOT flagged (see the header rationale for each):
//   - a `...rest` sibling — never required to be independently "used"
//   - a name prefixed with `_` (`_unused`, `_`) — the underscore convention
//     for "I know, and that's fine"
//   - a nested destructuring alias (`{ meta: { id } }`) — too complex to
//     track precisely without a real parser; skipped rather than risk a
//     false positive on the outer or inner name
//   - a computed key alias landing inside a bracket pattern
//
// Severity: medium (a silent-wrong-answer risk, not a crash).
//
// Opt-out: `@unused-param-ok` in the file's first 5 lines suppresses the
// whole file; on the line above (or the same line as) a specific finding
// suppresses just that finding — same convention as
// frontend-unsafe-chain-detector.js's `@unsafe-chain-ok`.

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const CATEGORY = "unused-destructured-param";
const FINDING_CAP = 500;
const FILE_CAP = 8000;

const ANNOTATION_OK_RE = /@unused-param-ok\b/;

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".next", "coverage", "dist", "build", "out",
  "__tests__", "stories", "storybook", "data", "audit",
]);
const SKIP_FILE_RE = [
  /\.d\.ts$/,
  /\.(?:test|spec)\.(?:js|mjs|cjs|ts|tsx)$/,
  /\/lib\/detectors\//, // avoid meta-noise scanning the detector suite itself
];

const BACKEND_DIR = "server";
const FRONTEND_DIRS = ["concord-frontend/app", "concord-frontend/components", "concord-frontend/lib"];

function shouldSkipFile(relFile) {
  return SKIP_FILE_RE.some((re) => re.test(relFile));
}

// ── Small balanced-delimiter helpers (quote-aware) ─────────────────────

/**
 * Index of the delimiter matching `content[openIdx]` (assumed to equal
 * `openCh`), tracking string/template-literal context so a `{`/`}`/`(`/`)`
 * inside a quoted default value never perturbs the depth count. Returns -1
 * if unterminated.
 */
function matchDelim(content, openIdx, openCh, closeCh) {
  let depth = 0;
  let quote = null;
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

/**
 * Parse one destructure entry (`name`, `name = default`, `key: alias`,
 * `key: alias = default`) into its bound identifier.
 */
function parseDestructureEntry(entry) {
  let depth = 0, quote = null;
  let colonIdx = -1, eqIdx = -1;
  for (let i = 0; i < entry.length; i++) {
    const ch = entry[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{" || ch === "[" || ch === "(") { depth++; continue; }
    if (ch === "}" || ch === "]" || ch === ")") { depth--; continue; }
    if (depth === 0 && ch === ":" && colonIdx === -1) colonIdx = i;
    if (depth === 0 && ch === "=" && eqIdx === -1) { eqIdx = i; break; }
  }
  if (colonIdx !== -1 && (eqIdx === -1 || colonIdx < eqIdx)) {
    const aliasRaw = (eqIdx !== -1 ? entry.slice(colonIdx + 1, eqIdx) : entry.slice(colonIdx + 1)).trim();
    return { alias: aliasRaw, isNested: /^[{[]/.test(aliasRaw) };
  }
  const nameRaw = (eqIdx !== -1 ? entry.slice(0, eqIdx) : entry).trim();
  return { alias: nameRaw, isNested: /^[{[]/.test(nameRaw) };
}

const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

// ── Function-signature discovery ────────────────────────────────────────

const FUNC_DECL_RE = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
const ARROW_ASSIGN_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g;

// Body-open lookahead: an optional TS return-type annotation with NO braces
// of its own (a return type containing an inline object literal makes this
// deliberately fail to match — see header rationale), then the real `{`.
const FUNC_BODY_LOOKAHEAD_RE = /^\s*(?::\s*[^{;=]*)?\{/;
const ARROW_BODY_LOOKAHEAD_RE = /^\s*(?::\s*[^{;=]*)?=>\s*\{/;

function findFunctionCandidates(content) {
  const out = [];
  let m;
  FUNC_DECL_RE.lastIndex = 0;
  while ((m = FUNC_DECL_RE.exec(content)) != null) {
    out.push({ name: m[1], sigIndex: m.index, parenOpenIdx: m.index + m[0].length - 1, isArrow: false });
  }
  ARROW_ASSIGN_RE.lastIndex = 0;
  while ((m = ARROW_ASSIGN_RE.exec(content)) != null) {
    out.push({ name: m[1], sigIndex: m.index, parenOpenIdx: m.index + m[0].length - 1, isArrow: true });
  }
  out.sort((a, b) => a.sigIndex - b.sigIndex);
  return out;
}

/**
 * Resolve one candidate into `{ name, paramsText, bodyText, bodyOpenIdx }`,
 * or null if the candidate doesn't cleanly resolve to a block-bodied
 * function (overload/ambient signature, concise-body arrow, return type with
 * an inline object literal — all accepted misses, see header).
 */
function resolveFunction(content, cand) {
  const parenClose = matchDelim(content, cand.parenOpenIdx, "(", ")");
  if (parenClose === -1) return null;
  const paramsText = content.slice(cand.parenOpenIdx + 1, parenClose);
  const after = content.slice(parenClose + 1, parenClose + 1 + 600);
  const lookRe = cand.isArrow ? ARROW_BODY_LOOKAHEAD_RE : FUNC_BODY_LOOKAHEAD_RE;
  const lm = lookRe.exec(after);
  if (!lm) return null;
  const bodyOpenIdx = parenClose + 1 + lm.index + lm[0].length - 1; // index of the real `{`
  const bodyCloseIdx = matchDelim(content, bodyOpenIdx, "{", "}");
  if (bodyCloseIdx === -1) return null;
  const bodyText = content.slice(bodyOpenIdx + 1, bodyCloseIdx);
  return { name: cand.name, paramsText, bodyText, bodyOpenIdx };
}

/** Top-level `{...}` destructure parameters within a raw param-list string. */
function findDestructureParams(paramsText) {
  const params = splitTopLevel(paramsText);
  const out = [];
  for (const p of params) {
    if (!p.startsWith("{")) continue;
    const close = matchDelim(p, 0, "{", "}");
    if (close === -1) continue;
    out.push(p.slice(1, close));
  }
  return out;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runUnusedDestructuredParamDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || process.cwd();
  const findings = [];
  const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : FILE_CAP;
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : FINDING_CAP;
  let scanned = 0;
  let filesWithCandidates = 0;

  try {
    const skip = new Set(SKIP_DIRS);
    const backendFiles = await walk(path.join(repoRoot, BACKEND_DIR), [".js"], skip);
    const frontendFilesAll = await walk(path.join(repoRoot, "concord-frontend"), [".ts", ".tsx"], skip);
    const scopedFrontend = frontendFilesAll.filter((f) => {
      const rel = relPath(repoRoot, f).replace(/\\/g, "/");
      return FRONTEND_DIRS.some((d) => rel.startsWith(d + "/"));
    });
    const files = [...backendFiles, ...scopedFrontend];

    for (const abs of files) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      const rel = relPath(repoRoot, abs).replace(/\\/g, "/");
      if (shouldSkipFile(rel)) continue;
      scanned++;

      const raw = await readSafe(abs);
      if (!raw) continue;
      const headLines = raw.split("\n").slice(0, 5).join("\n");
      if (ANNOTATION_OK_RE.test(headLines)) continue;

      const c = stripComments(raw);
      const candidates = findFunctionCandidates(c);
      if (candidates.length === 0) continue;
      filesWithCandidates++;

      const fileLines = raw.split("\n");

      for (const cand of candidates) {
        if (findings.length >= findingCap) break;
        const fn = resolveFunction(c, cand);
        if (!fn) continue;
        const destructures = findDestructureParams(fn.paramsText);
        if (destructures.length === 0) continue;

        for (const inner of destructures) {
          const entries = splitTopLevel(inner);
          for (const entry of entries) {
            if (entry.startsWith("...")) continue; // rest sibling — never required to be "used"
            const { alias, isNested } = parseDestructureEntry(entry);
            if (!alias || isNested) continue;
            if (!IDENT_RE.test(alias)) continue; // computed/malformed — be conservative
            if (alias === "_" || alias.startsWith("_")) continue; // underscore convention

            const used = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(fn.bodyText);
            if (used) continue;

            const lineNum = lineOf(c, fn.bodyOpenIdx);
            const above = fileLines[lineNum - 2] || "";
            const here = fileLines[lineNum - 1] || "";
            if (ANNOTATION_OK_RE.test(above) || ANNOTATION_OK_RE.test(here)) continue;

            findings.push({
              id: "unused_destructured_param",
              severity: "medium",
              kind: "static",
              category: CATEGORY,
              message:
                `\`${fn.name}\` destructures \`${alias}\` from a parameter but never references it in the ` +
                `function body — the signature promises the value matters; the body proves it doesn't. ` +
                `Same shape as the pre-fix analyticISI bug (silently dropped V_reset/refractory).`,
              location: `${rel}:${lineNum}`,
              subject: { kind: "unused_destructured_param", file: rel, function: fn.name, param: alias },
              evidence: { function: fn.name, param: alias },
              fixHint:
                `Either use \`${alias}\` in \`${fn.name}\`'s computation, or drop it from the destructure ` +
                `if it's genuinely not needed (prefix with \`_\` to document that on purpose).`,
            });
            if (findings.length >= findingCap) break;
          }
          if (findings.length >= findingCap) break;
        }
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  findings.unshift({
    id: "unused_destructured_param_summary",
    severity: "info",
    kind: "static",
    category: CATEGORY,
    message: `Scanned ${scanned} file(s); ${filesWithCandidates} had analyzable function signatures; flagged ${findings.length}`,
    evidence: { scanned, filesWithCandidates },
  });

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
