// server/lib/detectors/domain-reachability-detector.js
//
// OP4 (2026-07-23) — the generalized, permanent version of the manual
// wiring audit that found 5 fully-coded, fully-tested domain files
// (immersive-sim, skill-tree, sports-careers, survival, vehicle-tuning —
// fixed in commit 61a29cc0) that registered real macros but were never
// imported by anything. Static grep alone missed it for months because
// `stale-code-detector.js`'s "ghost module" rule (section 3) explicitly
// treats every file under `server/domains/` as "wired via domain
// registration scan" (see its DYNAMIC_LOAD_HINT) and skips it entirely —
// domains/ was a blind spot by design, not an oversight this detector
// duplicates.
//
// Ground truth: `server/domains/*.js` reaches the runtime MACROS/LENS_ACTIONS
// maps through exactly two loader mechanisms:
//
//   1. server.js's registration block does the 2-line pattern directly:
//        import registerFooMacros from "./domains/foo.js";
//        registerFooMacros(register);
//
//   2. server/domains/index.js imports the file AND includes the imported
//      binding in its exported `export default [ ... ]` array, which
//      server.js drains with `domainModules.forEach(mod => mod(registerLensAction))`
//      (see server.js: `const { default: domainModules } = await import
//      ('./domains/index.js'); domainModules.forEach(...)`).
//
// A domain file with a default export that is reachable through NEITHER
// path is dead code with a guaranteed-unreachable registrar — the exact
// "caller-with-no-receiver" bug class. This detector flags it.
//
// Scope discipline: only files that actually export a default function are
// "domain registrar" candidates. Files with no default export (e.g. the
// underscore-prefixed `_recent-mine-helper.js` / `_dtu-recent-mine.js`
// factories, consumed via NAMED imports from other domain files) are a
// different question — named-export reachability — reported separately at
// lower severity so a genuinely-orphaned helper still surfaces, but never
// conflated with the "registrar never wired" finding.

import path from "node:path";
import { readdir } from "node:fs/promises";
import { readSafe, makeReport, makeError, relPath } from "./_framework.js";
import { stripComments } from "./command-injection-detector.js";

const DEFAULT_EXPORT_RE = /export\s+default\s+(?:async\s+)?function\s*(\w*)|export\s+default\s+(\w+)\s*;/;

// A default import may carry a companion clause before `from`:
//   import vault from './vault.js';                          // bare
//   import vault, { setAdmissionProtectionHandler } from ...  // + named
//   import vault, * as ns from './vault.js';                  // + namespace
// Requiring the bare form made this detector report a LIVE, wired domain as
// unreachable dead code: `domains/index.js:209` imports `vault` exactly the
// second way, and `:508` includes it in the `export default [...]` array that
// `server.js:45270` drains via `domainModules.forEach(mod => mod(...))`. The
// finding's own message ("imported by NEITHER server.js NOR domains/index.js")
// was therefore false on both halves. Same failure mode as the `_tickRssDomain`
// lesson in CLAUDE.md §1 — a syntactic variation defeats a literal scan — so
// the companion clause is now optional rather than forbidden.
// NB: the trailing `\s+from` is deliberately still MANDATORY whitespace, as it
// was before. Relaxing it to `\s*` would let a malformed `import xfrom "..."`
// match by splitting the identifier — a correctness fix must not smuggle in a
// loosening that makes the detector easier to satisfy.
const DEFAULT_BINDING = String.raw`([A-Za-z_$][\w$]*)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][\w$]*))?`;
const IMPORT_FROM_DOMAINS_RE = (stem) =>
  new RegExp(String.raw`import\s+${DEFAULT_BINDING}\s+from\s+["'\`]\.\/domains\/${stem}\.js["'\`]`);
const IMPORT_FROM_DOT_RE = (stem) =>
  new RegExp(String.raw`import\s+${DEFAULT_BINDING}\s+from\s+["'\`]\.\/${stem}\.js["'\`]`);

function escapeStem(stem) {
  return stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Does `serverJsContent` both import the domain file AND call the bound
 * identifier somewhere (a real registration call, not just the import
 * line)? Mirrors tests/domain-registration-wiring.test.js's two-part check
 * but generically over the bound identifier name rather than a fixed string.
 */
function reachableViaServerJs(serverJsContent, stem) {
  const m = IMPORT_FROM_DOMAINS_RE(escapeStem(stem)).exec(serverJsContent);
  if (!m) return false;
  const ident = m[1];
  // Any `<ident>(` occurrence is a call site — the import statement itself
  // has no parenthesis after the identifier, so this can't self-match.
  const callRe = new RegExp(`\\b${ident.replace(/[$]/g, "\\$")}\\s*\\(`);
  return callRe.test(serverJsContent);
}

/**
 * Is the domain file imported into domains/index.js AND actually included
 * in its exported default array (an import with no array-inclusion is
 * itself a lesser but real form of this bug — imported yet never drained).
 */
function reachableViaIndex(indexContent, arrayBody, stem) {
  const m = IMPORT_FROM_DOT_RE(escapeStem(stem)).exec(indexContent);
  if (!m) return false;
  const ident = m[1];
  const identRe = new RegExp(`(?:^|[^\\w$])${ident.replace(/[$]/g, "\\$")}(?:[^\\w$]|$)`);
  return identRe.test(arrayBody);
}

/** Extract the `export default [ ... ]` array body from domains/index.js. */
function extractDefaultArrayBody(indexContent) {
  const start = indexContent.indexOf("export default [");
  if (start < 0) return "";
  const open = indexContent.indexOf("[", start);
  let depth = 0, end = -1;
  for (let i = open; i < indexContent.length; i++) {
    if (indexContent[i] === "[") depth++;
    else if (indexContent[i] === "]") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return "";
  return indexContent.slice(open, end + 1);
}

export async function runDomainReachabilityDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("domain-reachability", "no_root", null, t0);

  try {
    const domainsDir = path.join(root, "server", "domains");
    const serverJsPath = path.join(root, "server", "server.js");
    const indexPath = path.join(domainsDir, "index.js");

    let entries;
    try { entries = await readdir(domainsDir, { withFileTypes: true }); }
    catch { return makeError("domain-reachability", "domains_dir_missing", null, t0); }

    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".js") && e.name !== "index.js")
      .map((e) => e.name);

    // Comments are stripped before every structural match below (a doc-example
    // like `//   export default function registerFooMacros(register) {` in a
    // factory-usage comment must never be mistaken for a real export, and a
    // commented-out `import ... from "./domains/x.js"` must never count as a
    // real wire). `stripComments` preserves newlines/line count and is
    // string/template-literal aware — the same lexer command-injection-detector
    // and five other detectors already rely on.
    const serverJsContentRaw = await readSafe(serverJsPath);
    const indexContentRaw = await readSafe(indexPath);
    const serverJsContent = stripComments(serverJsContentRaw || "");
    const indexContent = stripComments(indexContentRaw || "");
    const arrayBody = extractDefaultArrayBody(indexContent);

    // Read + comment-strip every domain file exactly once, up front, so the
    // O(n^2) helper cross-reference pass below reuses the same stripped text
    // instead of re-reading/re-stripping per pair.
    const strippedByFile = new Map();
    for (const fileName of files) {
      const raw = await readSafe(path.join(domainsDir, fileName));
      if (raw != null) strippedByFile.set(fileName, stripComments(raw));
    }

    const findings = [];
    let registrarCount = 0;
    let unreachableRegistrars = 0;
    let helperCount = 0;
    let unreachableHelpers = 0;

    for (const fileName of files) {
      const stem = fileName.replace(/\.js$/, "");
      const fullPath = path.join(domainsDir, fileName);
      const content = strippedByFile.get(fileName);
      if (content == null) continue;

      const hasDefaultExport = DEFAULT_EXPORT_RE.test(content);

      if (hasDefaultExport) {
        registrarCount++;
        const viaServer = serverJsContent ? reachableViaServerJs(serverJsContent, stem) : false;
        const viaIndex = indexContent ? reachableViaIndex(indexContent, arrayBody, stem) : false;
        if (!viaServer && !viaIndex) {
          unreachableRegistrars++;
          findings.push({
            id: "domain_registrar_unreachable",
            severity: "high",
            kind: "static",
            category: "wiring",
            message: `server/domains/${fileName} exports a default registrar function but is imported by NEITHER server.js NOR domains/index.js — every macro it registers is unreachable at runtime (caller-with-no-receiver dead code)`,
            location: relPath(root, fullPath),
            evidence: { file: `server/domains/${fileName}` },
            fixHint: "import_and_call_registrar_or_add_to_domains_index",
            subject: { kind: "file", path: `server/domains/${fileName}` },
          });
        }
      } else {
        // Helper/library module (e.g. `_recent-mine-helper.js`) — reachability
        // means "does ANY other domains/*.js or server.js import it", checked
        // via named-import reference to its exact relative path. This is a
        // deliberately separate, lower-severity finding: an unreachable
        // helper wastes no runtime macro surface (nothing depends on it by
        // definition), but it's still dead weight worth surfacing.
        helperCount++;
        const stemEsc = escapeStem(stem);
        const refRe = new RegExp(String.raw`from\s+["'\`]\.\/${stemEsc}\.js["'\`]|from\s+["'\`]\.\/domains\/${stemEsc}\.js["'\`]`);
        let referenced = false;
        for (const otherName of files) {
          if (otherName === fileName) continue;
          const otherContent = strippedByFile.get(otherName);
          if (otherContent && refRe.test(otherContent)) { referenced = true; break; }
        }
        if (!referenced && serverJsContent && refRe.test(serverJsContent)) referenced = true;
        if (!referenced) {
          unreachableHelpers++;
          findings.push({
            id: "domain_helper_unreachable",
            severity: "low",
            kind: "static",
            category: "wiring",
            message: `server/domains/${fileName} has no default export (a helper/library module) and is never imported by any domains/*.js file or server.js — dead weight`,
            location: relPath(root, fullPath),
            evidence: { file: `server/domains/${fileName}` },
            fixHint: "wire_a_consumer_or_delete",
          });
        }
      }
    }

    findings.unshift({
      id: "domain_reachability_summary",
      severity: "info",
      kind: "static",
      category: "wiring",
      message: `Scanned ${files.length} server/domains/*.js file(s): ${registrarCount} registrar(s) (${unreachableRegistrars} unreachable), ${helperCount} helper module(s) (${unreachableHelpers} unreachable)`,
      evidence: { totalFiles: files.length, registrarCount, unreachableRegistrars, helperCount, unreachableHelpers },
    });

    return makeReport("domain-reachability", findings, t0);
  } catch (err) {
    return makeError("domain-reachability", "exception", err, t0);
  }
}
