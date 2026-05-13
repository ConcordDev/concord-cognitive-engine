// server/lib/detectors/http-error-detector.js
//
// Catches HTTP-error-shaped patterns that surface as 4xx/5xx in
// production. The 500/unhandled-async family is already covered by
// observability-gap-detector.js#route_without_try_catch — this detector
// fills the rest of the matrix:
//
//   400 — req.body / req.params / req.query used without validation
//   400 — numeric coercion without parseInt / Number()
//   404 — DB result used without null-check (.get() returns undefined)
//   409 — INSERT INTO without ON CONFLICT and not in try/catch
//   429 — expensive route (external fetch / email send) without an
//         inline rate-limiter middleware
//   504 — fetch / axios call with no timeout / AbortSignal
//
// 401 (route-auth) coverage is piecewise across invariant-guardian +
// lens-health-detector.
// 403 (resource-ownership / IDOR) is deferred — detecting it statically
// needs DB schema awareness to know which params map to which ownership
// columns.
// 503 (health-check audit) belongs in invariant-guardian as a one-off.
//
// Severities:
//   medium — req.body field used without validation
//   medium — DB .get() result property-accessed without null-check
//   medium — expensive route without per-route rate limiter
//   medium — external fetch / axios without timeout
//   low    — req.params/.query used as number without parseInt
//   low    — INSERT INTO not inside try/catch and no ON CONFLICT
//
// Operator opt-out: `@http-error-ok` anywhere in file suppresses all
// rules for that file; `@http-error-ok` on the line directly above (or
// on the same line as) a specific match suppresses that match only.

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "http-error";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_DIRS = ["server/routes"];
const SCAN_FILES = new Set(["server/server.js"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build", "tests", "__tests__"]);
const ANNOTATION_OK_RE = /@http-error-ok\b/;

function isInteresting(file) {
  return /\.(js|mjs)$/.test(file);
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
  if (SCAN_FILES.has(rel)) return true;
  if (!SCAN_DIRS.some(p => rel.startsWith(p + "/"))) return false;
  // Skip code-generation engines — their string-template "routes" are
  // emitted output, not real routes. Mirrors observability-gap's skip.
  if (/forge-template-/.test(rel) || /code-substrate\//.test(rel)) return false;
  return true;
}

// ── Patterns ───────────────────────────────────────────────────────────────

// Matches `app.get('/x', ...handler)` / `router.get(...)` etc. and
// captures the opening `{` of the arrow-function body so we can
// brace-count the handler body.
const ROUTE_HANDLER_RE = /\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*([^]*?)(async\s*)?\(([^)]*)\)\s*=>\s*\{/g;

const VALIDATION_HINTS = /\b(?:z\.object|z\.string|z\.number|z\.array|z\.boolean|safeParse|\.parse\(|Joi\.|Yup\.|ajv\.|enforceRequestInvariants|req\.validated\b|req\.validatedQuery\b)/;
const EXPLICIT_BODY_GUARD = /\bif\s*\(\s*!?\s*req\.body\b|\btypeof\s+req\.body\b/;
// Same-line short-circuit guards: `req.body && req.body.X`,
// `req.body?.X && req.body.X` (optional-chaining + truthy gate). The
// short-circuit makes the subsequent unguarded access safe.
const FIELD_SHORT_CIRCUIT_RE = /\breq\.body\s*&&|\breq\.body\?\./;
// Capture the field name AND a look-ahead char so we can detect the
// "field || default" / "Number(req.body.x)" defensive patterns. The
// look-ahead is non-consuming so the regex stays line-anchorable.
const REQ_BODY_FIELD_RE = /\breq\.body\.([a-zA-Z_]\w*)(\s*(?:\|\||\?\?|\)\s*\|\||,))?/g;
const REQ_BODY_DESTRUCTURE_RE = /\bconst\s*\{[^}]+\}\s*=\s*req\.body\b/;
// Defensive-coercion seams that make a raw req.body.x access safe:
//   • `req.body.x || default` / `req.body.x ?? default` (default-coalesce)
//   • `Number(req.body.x)` / `String(req.body.x)` / `Boolean(req.body.x)` (coercion)
//   • `Array.isArray(req.body.x)` (shape check)
//   • `req.body.x &&` (short-circuit guard before use)
const FIELD_DEFENSIVE_CONTEXT = /(?:Number|String|Boolean|Array\.isArray|parseInt|parseFloat|JSON\.stringify|typeof)\s*\(\s*req\.body\./;
// Middleware-position validation seam: a `validate("schema")` call
// inserted between the route path and the handler arrow function.
// Routes that pass through validate() have already been Zod-checked
// and would 400-fail before reaching the handler.
const VALIDATE_MIDDLEWARE_RE = /\bvalidate\s*\(\s*['"`][^'"`)]+['"`]\s*[,)]/;

const REQ_PARAM_AS_NUMBER_RE = /\breq\.(params|query)\.([a-zA-Z_]\w*)\s*([+\-*/%<>=!]=?|>=|<=|===|!==)\s*\d/g;
const NUMERIC_COERCION_HINT = /\b(?:parseInt|parseFloat|Number)\s*\(|\bNumber\.parseInt\b|\|\s*0\b/;

// better-sqlite3 .get() returns undefined when no row matches. We only
// fire when the assignment chain includes a .prepare() call and the
// entire chain lives in a single statement (no `;` between `const X =`
// and `.get(`) — that's the canonical DB-query shape. Plain
// Map/Cache/Headers .get() are allowed to return undefined and are not
// 404-shaped.
const DB_GET_ASSIGN_RE = /\bconst\s+(\w+)\s*=\s*[^;]*?\.prepare\s*\([^;]*?\)\s*\.get\s*\(/g;

const INSERT_INTO_RE = /\bINSERT\s+INTO\s+(\w+)/gi;

// External fetch / axios calls — skip Ollama brain ports.
const FETCH_CALL_RE = /\b(fetch|axios(?:\.get|\.post|\.put|\.delete|\.patch)?)\s*\(\s*([^,)]+)/g;
const TIMEOUT_HINT_RE = /\b(?:signal\s*:|timeout\s*:|AbortController|AbortSignal\.timeout|setTimeout\s*\([^,]+,\s*\d+)/;
// Ollama / local-brain URL patterns. The brain pool (CLAUDE.md §
// Five-brain architecture) routes through ports 11434-11438 referenced
// via env variables (OLLAMA_BASE_URL, BRAIN_*_URL) or per-pool
// references (BRAIN.repair.url, brain.url, brainUrl). All of those
// internally manage timeouts via callBrain() / llm-router. Case-
// insensitive because the variable names use SHOUTY_SNAKE for env
// vars and camelCase for runtime references.
// Match leading-word-boundary only: `\b<token>\w*` (no trailing
// boundary) so `OLLAMA` matches in `OLLAMA_BASE_URL` even though `_`
// is a word char.
const OLLAMA_HOST_RE = /\b(?:1143[4-8]|ollama|brain|llm.router|sd.?url|stable.{0,3}diffusion)\w*/i;

// sendMail / mailer indicators — the canonical "expensive op" signal
// for the rate-limit rule.
const SEND_MAIL_RE = /\b(?:nodemailer|sendMail|transporter\.send|mailer\.send)\b/;
// Per-route rate-limiter middleware. Recognised forms:
//   • the canonical limiter binds defined in server.js:6492-6547
//   • the project's *RateLimit* / *rateLimit* helper convention
//     (authRateLimitMiddleware, chatRateLimit, perEndpointRateLimit(...))
const RATE_LIMITER_MW_RE = /\b(?:[A-Za-z_]\w*[Rr]ate[Ll]imit(?:er|Middleware)?|perEndpointRateLimit\s*\(|rateLimiter)\s*[,(]/;

// ── Helpers ────────────────────────────────────────────────────────────────

function lineNumberAt(content, idx) {
  // Count newlines up to idx. O(n) but findings are bounded.
  let n = 1;
  for (let i = 0; i < idx; i++) if (content.charCodeAt(i) === 10) n++;
  return n;
}

function findHandlerBody(content, openIdx) {
  // Brace-count from the matched `{` to its closing `}`. Cap at 8 KB
  // so a malformed unclosed handler doesn't pull the rest of the file.
  let depth = 1;
  let i = openIdx + 1;
  const limit = Math.min(content.length, openIdx + 8192);
  while (i < limit && depth > 0) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  const closeIdx = depth === 0 ? i : limit;
  return { body: content.slice(openIdx, closeIdx), closeIdx };
}

function lineExempt(lines, lineNum) {
  // Same-line or previous-line `@http-error-ok` annotation suppresses
  // this finding. lineNum is 1-indexed.
  const here = lines[lineNum - 1] || "";
  const prev = lines[lineNum - 2] || "";
  return ANNOTATION_OK_RE.test(here) || ANNOTATION_OK_RE.test(prev);
}

function locOf(rel, lineNum) {
  return `${rel}:${lineNum}`;
}

// ── Per-handler rules ──────────────────────────────────────────────────────

function checkReqBodyValidation(rel, content, handler, findings) {
  const { body, bodyStart, declMatch, declSlice } = handler;
  // Middleware-position seam: `validate("schemaName")` between the
  // route path and the handler runs Zod safeParse and 400s before the
  // handler is invoked (server.js#validate, line 6072). declMatch is
  // the full matched declaration text and reliably captures every
  // middleware including those on continuation lines.
  if (VALIDATE_MIDDLEWARE_RE.test(declMatch || declSlice || "")) return;
  // Per-handler short-circuit: if validation hint or guard appears
  // anywhere in the handler body, every field is presumed validated.
  if (VALIDATION_HINTS.test(body)) return;
  if (EXPLICIT_BODY_GUARD.test(body)) return;
  if (REQ_BODY_DESTRUCTURE_RE.test(body)) return;
  const fileLines = content.split("\n");
  const re = new RegExp(REQ_BODY_FIELD_RE.source, "g");
  const seen = new Set();
  let m;
  while ((m = re.exec(body)) != null) {
    const field = m[1];
    const trailingDefense = m[2];
    if (seen.has(field)) continue;
    seen.add(field);
    // Defensive-coalesce pattern: `req.body.x || default` /
    // `req.body.x ?? default`. The captured look-ahead group makes the
    // access safe — the local variable always has a defined fallback.
    if (trailingDefense) continue;
    const absIdx = bodyStart + m.index;
    const lineNum = lineNumberAt(content, absIdx);
    if (lineExempt(fileLines, lineNum)) continue;
    // Coercion-wrapped: `Number(req.body.x)`, `String(req.body.x)`,
    // `Boolean(req.body.x)`, `Array.isArray(req.body.x)`,
    // `parseInt(req.body.x)`, `parseFloat(req.body.x)`,
    // `typeof req.body.x`. Inspect the line; coercion is always on the
    // same line as the access.
    const accessLine = fileLines[lineNum - 1] || "";
    const prevLine = fileLines[lineNum - 2] || "";
    if (FIELD_DEFENSIVE_CONTEXT.test(accessLine)) continue;
    // Same-line short-circuit: `req.body && req.body.X` /
    // `req.body?.field && req.body.field`. The short-circuit ensures
    // the subsequent access is safe. Also check the previous line for
    // an enclosing `if (... && req.body?.X)` guard.
    if (FIELD_SHORT_CIRCUIT_RE.test(accessLine)) continue;
    if (/\bif\s*\([^)]*\breq\.body\??\.\w+/.test(prevLine)) continue;
    findings.push({
      id: "req_body_used_without_validation",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: `Route reads req.body.${field} without prior validation (Zod / Joi / explicit guard / defensive coalesce) — malformed bodies surface as 400 or 500.`,
      location: locOf(rel, lineNum),
      subject: { kind: "route", file: rel, field },
      fixHint: "Validate req.body with a Zod schema (z.object({...}).safeParse(req.body)) before field access, OR add an explicit `if (!req.body || typeof req.body.X !== 'string') return res.status(400).json(...)` guard, OR use a defensive default `const x = req.body.X || <default>`.",
    });
  }
}

function checkParamAsNumber(rel, content, handler, findings) {
  const { body, bodyStart } = handler;
  const re = new RegExp(REQ_PARAM_AS_NUMBER_RE.source, "g");
  const lines = content.split("\n");
  let m;
  while ((m = re.exec(body)) != null) {
    const absIdx = bodyStart + m.index;
    const lineNum = lineNumberAt(content, absIdx);
    if (lineExempt(lines, lineNum)) continue;
    // Guard: parseInt / Number() / `|0` on same or previous line of the file.
    const hereLine = lines[lineNum - 1] || "";
    const prevLine = lines[lineNum - 2] || "";
    if (NUMERIC_COERCION_HINT.test(hereLine) || NUMERIC_COERCION_HINT.test(prevLine)) continue;
    findings.push({
      id: "req_param_used_as_number_without_parse",
      severity: "low",
      kind: "static",
      category: CATEGORY,
      message: `req.${m[1]}.${m[2]} is used in a numeric expression without parseInt/Number() — strings concatenate instead of adding, producing 400-shaped data bugs.`,
      location: locOf(rel, lineNum),
      subject: { kind: "route", file: rel, source: m[1], field: m[2] },
      fixHint: "Wrap with parseInt(req." + m[1] + "." + m[2] + ", 10) or Number(req." + m[1] + "." + m[2] + ") and validate non-NaN before use.",
    });
  }
}

function checkDbResultNullCheck(rel, content, handler, findings) {
  const { body, bodyStart } = handler;
  const lines = content.split("\n");
  const bodyLines = body.split("\n");
  const re = new RegExp(DB_GET_ASSIGN_RE.source, "g");
  let m;
  while ((m = re.exec(body)) != null) {
    const varName = m[1];
    const assignAbsIdx = bodyStart + m.index;
    const assignLine = lineNumberAt(content, assignAbsIdx);
    if (lineExempt(lines, assignLine)) continue;
    // Find the line index inside body for the assignment, then scan
    // the next 5 lines for the first property access on varName.
    const bodyLineIdx = (body.slice(0, m.index).match(/\n/g) || []).length;
    const window = bodyLines.slice(bodyLineIdx, bodyLineIdx + 6).join("\n");
    // Guard: explicit null-check, truthy check, optional chaining,
    // short-circuit `varName && varName.x`, ternary `varName ? x : y`,
    // or a 404/throw short-circuit. These are all the patterns that
    // make .get()-returns-undefined safe in this codebase.
    const guardRe = new RegExp(
      `if\\s*\\(\\s*!\\s*${varName}\\b` +              // if (!row)
      `|if\\s*\\(\\s*${varName}\\s*[=!&|)]` +           // if (row), if (row &&, if (row ||, if (row ==
      `|\\b${varName}\\s*\\?\\.` +                      // row?.field (optional chaining)
      `|\\b${varName}\\s*&&\\s*${varName}\\b` +         // row && row.field
      `|\\b${varName}\\s*\\?\\s*[^:]+:` +               // row ? x : y (ternary)
      `|return\\s+res\\.status\\(404\\)` +
      `|throw\\s+`,
      ""
    );
    if (guardRe.test(window)) continue;
    // Trigger: property access (varName.x or varName[x]) within window.
    const useRe = new RegExp(`\\b${varName}\\.[a-zA-Z_]`, "");
    if (!useRe.test(window)) continue;
    findings.push({
      id: "db_get_used_without_null_check",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: `DB query result \`${varName}\` is property-accessed without null-check — .get() returns undefined for no-match, producing 500 instead of 404.`,
      location: locOf(rel, assignLine),
      subject: { kind: "route", file: rel, varName },
      fixHint: `Add \`if (!${varName}) return res.status(404).json({ error: 'not_found' });\` between the .get() and the first property access, OR switch to optional chaining (${varName}?.field).`,
    });
  }
}

function checkInsertConflictGuard(rel, content, handler, findings) {
  const { body, bodyStart, declMatch, declSlice } = handler;
  // If the handler body has an explicit try, INSERT throws are caught
  // and the developer is in charge of mapping to 409 — skip.
  if (/\btry\s*\{/.test(body)) return;
  // asyncHandler / errorHandler wrappers forward throws to express's
  // error chain (server.js#asyncHandler) — the throw is observable
  // even if 500-shaped. Acceptable; skip.
  if (/\b(?:asyncHandler|errorHandler|safeHandler|wrapHandler)\s*\(/.test(declMatch || declSlice || "")) return;
  const lines = content.split("\n");
  const re = new RegExp(INSERT_INTO_RE.source, "gi");
  let m;
  while ((m = re.exec(body)) != null) {
    const absIdx = bodyStart + m.index;
    const lineNum = lineNumberAt(content, absIdx);
    if (lineExempt(lines, lineNum)) continue;
    // Look 3 lines after the INSERT for an `ON CONFLICT` clause; the
    // SQL may be split across template-literal lines.
    const bodyLineIdx = (body.slice(0, m.index).match(/\n/g) || []).length;
    const bodyLines2 = body.split("\n");
    const window = bodyLines2.slice(bodyLineIdx, bodyLineIdx + 5).join("\n");
    if (/\bON\s+CONFLICT\b/i.test(window)) continue;
    findings.push({
      id: "insert_without_conflict_guard",
      severity: "low",
      kind: "static",
      category: CATEGORY,
      message: `INSERT INTO ${m[1]} in a handler without surrounding try/catch and no ON CONFLICT clause — unique-constraint violations escape as 500.`,
      location: locOf(rel, lineNum),
      subject: { kind: "route", file: rel, table: m[1] },
      fixHint: "Either (a) wrap the route handler in try/catch and return 409 on UNIQUE-constraint error, or (b) add `ON CONFLICT (col) DO UPDATE / DO NOTHING` to the INSERT.",
    });
  }
}

function checkExpensiveRouteRateLimit(rel, content, handler, findings) {
  const { body, declLine, declSlice } = handler;
  // Skip health / metrics / readiness probes — those need to stay fast
  // and the global limiter already covers abuse.
  if (/\/(health|ready|live|metrics)\b/.test(handler.routePath || "")) return;
  // "Expensive" trigger: sendMail OR external (non-Ollama) fetch.
  const hasSendMail = SEND_MAIL_RE.test(body);
  const hasExternalFetch = (() => {
    const fre = new RegExp(FETCH_CALL_RE.source, "g");
    let fm;
    while ((fm = fre.exec(body)) != null) {
      const arg = fm[2] || "";
      if (!OLLAMA_HOST_RE.test(arg)) return true;
    }
    return false;
  })();
  if (!hasSendMail && !hasExternalFetch) return;
  // Is the route declaration preceded by a per-route rate-limiter
  // middleware? Inspect the declSlice (decl line + 2 lines above).
  if (RATE_LIMITER_MW_RE.test(declSlice)) return;
  const lines = content.split("\n");
  if (lineExempt(lines, declLine)) return;
  findings.push({
    id: "expensive_route_without_rate_limit",
    severity: "medium",
    kind: "static",
    category: CATEGORY,
    message: `Route does ${hasSendMail ? "email send" : "external API call"} without a per-route rate-limiter middleware — global limiter alone won't stop a low-rate abuse pattern from running up cost.`,
    location: locOf(rel, declLine),
    subject: { kind: "route", file: rel, trigger: hasSendMail ? "send_mail" : "external_fetch" },
    fixHint: "Add an inline rate-limiter middleware to the route declaration: `router.post('/x', authRateLimiter, handler)`. Limiters are defined in server.js:6492-6547.",
  });
}

// ── File-scoped rules (run outside per-handler context) ────────────────────

function checkExternalCallTimeout(rel, content, findings) {
  const lines = content.split("\n");
  const re = new RegExp(FETCH_CALL_RE.source, "g");
  let m;
  while ((m = re.exec(content)) != null) {
    const arg = m[2] || "";
    // Skip Ollama / llm-router calls — those go through callBrain()
    // which has its own AbortSignal.timeout(...).
    if (OLLAMA_HOST_RE.test(arg)) continue;
    const lineNum = lineNumberAt(content, m.index);
    if (lineExempt(lines, lineNum)) continue;
    // Inspect 20 lines centred on the call for a timeout hint. The
    // axios/fetch options object can span 15+ lines in this codebase
    // (multi-line headers + body + signal).
    const start = Math.max(0, lineNum - 2);
    const end = Math.min(lines.length, lineNum + 20);
    const window = lines.slice(start, end).join("\n");
    if (TIMEOUT_HINT_RE.test(window)) continue;
    findings.push({
      id: "external_call_without_timeout",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      message: `${m[1]}(${arg.trim().slice(0, 40)}…) has no timeout / AbortSignal — a hung upstream surfaces as a 504 (or worse, ties up an event-loop slot).`,
      location: locOf(rel, lineNum),
      subject: { kind: "external_call", file: rel, call: m[1] },
      fixHint: "Pass `{ signal: AbortSignal.timeout(5000) }` to fetch, or `{ timeout: 5000 }` to axios. Tune per-call latency budget.",
    });
  }
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function runHttpErrorDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || REPO_ROOT;
  const findings = [];
  const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : 5000;
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
  let scanned = 0;

  try {
    for await (const rel of walk(repoRoot)) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      if (!shouldScan(rel)) continue;
      scanned++;

      let content;
      try { content = await readFile(path.join(repoRoot, rel), "utf-8"); } catch { continue; }
      if (ANNOTATION_OK_RE.test(content) && content.split("\n").slice(0, 5).some(l => ANNOTATION_OK_RE.test(l))) {
        // File-level opt-out — annotation in first 5 lines suppresses all rules.
        continue;
      }

      const fileLines = content.split("\n");

      // File-scoped rules first.
      checkExternalCallTimeout(rel, content, findings);
      if (findings.length >= findingCap) break;

      // Per-handler rules: walk route handlers + brace-count bodies.
      const handlerRe = new RegExp(ROUTE_HANDLER_RE.source, "g");
      let m;
      while ((m = handlerRe.exec(content)) != null) {
        const openIdx = m.index + m[0].lastIndexOf("{");
        const { body, closeIdx } = findHandlerBody(content, openIdx);
        const declLine = lineNumberAt(content, m.index);
        const declSliceStart = Math.max(0, declLine - 3);
        const declSlice = fileLines.slice(declSliceStart, declLine).join("\n");
        // declMatch is the full matched declaration text from
        // `app.post(` to the opening `{`. Covers every middleware
        // between the path and the handler body — including
        // asyncHandler / validate / rate-limiter on continuation lines
        // for multi-line declarations.
        const declMatch = m[0];
        const handler = {
          method: m[1],
          routePath: m[2],
          middlewares: m[3] || "",
          declMatch,
          body,
          bodyStart: openIdx,
          bodyEnd: closeIdx,
          declLine,
          declSlice,
        };

        checkReqBodyValidation(rel, content, handler, findings);
        if (findings.length >= findingCap) break;
        checkParamAsNumber(rel, content, handler, findings);
        if (findings.length >= findingCap) break;
        checkDbResultNullCheck(rel, content, handler, findings);
        if (findings.length >= findingCap) break;
        checkInsertConflictGuard(rel, content, handler, findings);
        if (findings.length >= findingCap) break;
        checkExpensiveRouteRateLimit(rel, content, handler, findings);
        if (findings.length >= findingCap) break;
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
