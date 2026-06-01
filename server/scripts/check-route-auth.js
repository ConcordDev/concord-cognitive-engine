#!/usr/bin/env node
/**
 * Route auth gate — CI script.
 *
 * Walks every server/routes/*.js file and asserts each
 *   router.{post,put,delete,patch}(...)
 * is either:
 *   (a) followed by an auth-checking middleware in the args list
 *       (requireAuth / auth / authMiddleware / requireAuthOrToken / etc.)
 *   (b) preceded by an inline `// AUTH: <reason>` comment justifying public
 *       access (e.g. webhook-signature, public, csrf-bypass, etc.)
 *
 * Anything that fails both checks is a candidate auth gap. The script
 * compares against a baseline (audit/route-auth.baseline.json) so
 * pre-existing untouched gaps don't block CI; a new gap fails the build.
 *
 * Usage:
 *   node server/scripts/check-route-auth.js          # check vs baseline
 *   node server/scripts/check-route-auth.js --update # rewrite baseline
 *   node server/scripts/check-route-auth.js --json   # machine-readable
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ROUTES_DIR = path.resolve(REPO_ROOT, "server", "routes");
const BASELINE_PATH = path.resolve(REPO_ROOT, "audit", "route-auth.baseline.json");

const ARGS = new Set(process.argv.slice(2));
const UPDATE = ARGS.has("--update");
const JSON_OUT = ARGS.has("--json");

// Middleware names that count as authentication when present in the route
// args list. Word-boundary matched.
const AUTH_NAMES = new Set([
  "requireAuth",
  "auth",
  "authMiddleware",
  "requireAuthOrToken",
  "requirePluginAuth",
  "requireOwner",
  "requireAdmin",
  "requireAdminRole",
  "requireRole",
  "adminGate", // local alias for requireRole("owner","admin","sovereign") (e.g. routes/brains.js)
  "requireApiKey",
  "requireToken",
  "requireSession",
  "requireUser",
  "ensureAuthenticated",
]);

// Patterns that, if present inside the handler BODY, prove the route is
// auth-gated even when no middleware appears in the args list. These cover
// the idioms common in this codebase that are invisible to an arg-list scan:
//   - runMacro(...)            macro-system gate (publicReadDomains allowlist)
//   - if (!req.user)           inline early-return on missing auth
//   - if (!req?.user)          same, optional-chain form
//   - requireRole("...")       inline role check (not in middleware position)
//   - req.user.id              handler reads req.user.id (presumes authed —
//                              also the canonical authorization pattern; a
//                              route that reads req.user.id is doing the
//                              right thing per actor-from-token, not
//                              actor-from-body)
//   - req.user?.id             same, optional-chain form
const BODY_AUTH_PATTERNS = [
  /\brunMacro\s*\(/,
  /if\s*\(\s*!\s*req\.user\b/,
  /if\s*\(\s*!\s*req\?\.user\b/,
  /\brequireRole\s*\(/,
  /\brequireAdminRole\s*\(/,
  /\breq\.user\.id\b/,
  /\breq\.user\?\.id\b/,
];

// Inline-marker pattern: `// AUTH: <reason>` on the line above the handler.
const AUTH_MARKER_RE = /\/\/\s*AUTH:\s*(\S+)/i;

const ROUTE_RE = /router\.(post|put|delete|patch)\s*\(/g;

function* eachLine(content) {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) yield { lineNo: i + 1, line: lines[i] };
}

function findAuthInArgs(callExpr) {
  // callExpr is the substring starting at `router.METHOD(`.  We walk the
  // arg list with a tiny paren counter and capture chars up to the
  // matching close paren.  We then trim to the slice BEFORE the handler
  // arrow / function so comments and var names INSIDE the handler body
  // can't false-positive (e.g. `/* auth */` or `req.user` won't match).
  // This is a lexical check, not AST — good enough for the strict
  // pattern this codebase uses.
  let depth = 0;
  let i = callExpr.indexOf("(");
  if (i < 0) return null;
  i += 1;
  let buf = "";
  while (i < callExpr.length) {
    const ch = callExpr[i];
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      if (depth === 0) break;
      depth -= 1;
    }
    buf += ch;
    i += 1;
  }

  // Strip JS comments first (block + line) so `/* auth */` can't lie.
  buf = buf
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  // Cut off the handler. The handler is the LAST argument and is either
  // an arrow function `(...) =>` / `async (...) =>` or a `function` /
  // `async function` expression. Anything after that boundary is body.
  const handlerStart = (() => {
    const arrowMatch = /\(\s*[^)]*\)\s*=>/.exec(buf);
    const fnMatch = /\bfunction\b/.exec(buf);
    let pos = -1;
    if (arrowMatch) pos = arrowMatch.index;
    if (fnMatch && (pos < 0 || fnMatch.index < pos)) pos = fnMatch.index;
    return pos;
  })();
  const argsOnly = handlerStart >= 0 ? buf.slice(0, handlerStart) : buf;
  const handlerBody = handlerStart >= 0 ? buf.slice(handlerStart) : "";

  // (1) Args-list middleware
  for (const name of AUTH_NAMES) {
    // word-boundary match — avoid `requireAuthxxx` false positive.
    const re = new RegExp(`\\b${name}\\b`);
    if (re.test(argsOnly)) return name;
  }
  // (2) Handler-body auth idioms — recognises runMacro / inline req.user
  // checks / inline requireRole calls. Documented in BODY_AUTH_PATTERNS.
  for (const re of BODY_AUTH_PATTERNS) {
    const match = re.exec(handlerBody);
    if (match) return `body:${match[0].slice(0, 16)}`;
  }
  return null;
}

function scanFile(file) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  const findings = [];

  let m;
  ROUTE_RE.lastIndex = 0;
  while ((m = ROUTE_RE.exec(content))) {
    const offset = m.index;
    // Locate line number.
    const before = content.slice(0, offset);
    const lineNo = before.split("\n").length;
    const method = m[1].toUpperCase();
    const lineText = lines[lineNo - 1] || "";

    // Inline-marker: check the immediate line above.
    const above = lines[lineNo - 2] || "";
    const marker = AUTH_MARKER_RE.exec(above);

    // Walk argument list.
    const callExpr = content.slice(offset);
    const auth = findAuthInArgs(callExpr);

    if (!auth && !marker) {
      // Extract a short signature for reporting: first ~80 chars of the call.
      const slice = callExpr.slice(0, Math.min(120, callExpr.length)).replace(/\s+/g, " ");
      findings.push({
        file: path.relative(REPO_ROOT, file),
        line: lineNo,
        method,
        signature: slice,
      });
    }
  }

  return findings;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
  } catch {
    return [];
  }
}

function findingKey(f) {
  return `${f.file}:${f.method}:${f.line}`;
}

function main() {
  const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".js"));
  const allFindings = [];
  for (const f of files) {
    const full = path.join(ROUTES_DIR, f);
    allFindings.push(...scanFile(full));
  }

  const baseline = loadBaseline();
  const baselineSet = new Set(baseline.map(findingKey));

  const newFindings = allFindings.filter((f) => !baselineSet.has(findingKey(f)));

  if (UPDATE) {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(allFindings, null, 2) + "\n", "utf8");
    process.stdout.write(`Baseline rewritten with ${allFindings.length} findings.\n`);
    return process.exit(0);
  }

  if (JSON_OUT) {
    process.stdout.write(JSON.stringify({ allFindings, newFindings, baselineCount: baseline.length }, null, 2) + "\n");
    return process.exit(newFindings.length > 0 ? 1 : 0);
  }

  if (allFindings.length === 0) {
    process.stdout.write(`route-auth: 0 findings (${files.length} files scanned).\n`);
    return process.exit(0);
  }

  process.stdout.write(`route-auth: ${allFindings.length} total finding(s) across ${files.length} files.\n`);
  process.stdout.write(`route-auth: ${baseline.length} grandfathered in baseline; ${newFindings.length} new.\n\n`);

  if (newFindings.length > 0) {
    process.stdout.write("New auth gaps (must fix or add `// AUTH: <reason>` marker above):\n");
    for (const f of newFindings.slice(0, 50)) {
      process.stdout.write(`  ${f.file}:${f.line} ${f.method}  ${f.signature.slice(0, 80)}…\n`);
    }
    process.stdout.write("\nFix options:\n");
    process.stdout.write("  1. Add `requireAuth` (or another auth-list middleware) to the route args.\n");
    process.stdout.write("  2. If the route is intentionally public, add `// AUTH: public` on the line above.\n");
    process.stdout.write("  3. If the route is webhook-signature-verified, use `// AUTH: webhook-signature`.\n");
    process.stdout.write("  4. Re-baseline (only if reviewed): npm run check-route-auth -- --update\n");
    return process.exit(1);
  }

  process.exit(0);
}

main();
