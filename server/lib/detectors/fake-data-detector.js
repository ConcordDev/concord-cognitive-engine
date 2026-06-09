// server/lib/detectors/fake-data-detector.js
//
// Detects mock / fake / placeholder / stub data living in production
// code paths. The pattern that motivates this detector:
//
//   - A test mocks `@/lib/lens-registry` to provide 2 fake lenses,
//     but the real registry has 200+. Tests pass against the mock
//     and miss the production drift.
//   - A lib/ file exports a `getMockUsers()` function that's still
//     wired into a real route.
//   - A production module hardcodes `[{ id: "test-1" }]` because
//     real wiring was deferred.
//   - A "TODO replace with real data" marker has outlived its // @fake-data-ok
//     context.
//
// Severities:
//   high    — production lib/ or routes/ file containing
//             mock/fake/stub identifiers in EXPORTED names. Active
//             dead-letter risk.
//   medium  — `TODO REPLACE` / `FIXME REPLACE` markers in production
//             paths — the test-WAS-DEFERRED smell.
//   low     — TODO/FIXME markers in production paths (general signal).
//   info    — test mocks of production modules (legitimate unit-test
//             pattern; surfacing the gap so a future fixture-loader
//             migration can move them to real-data integration tests),
//             fake-sounding string literals in non-test paths, and
//             non-exported fake-named identifiers in production.

import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "fake-data";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

// Paths considered "production" — findings here are higher severity.
const PROD_PATHS = ["server/lib", "server/routes", "server/economy", "server/emergent", "server/domains", "concord-frontend/lib", "concord-frontend/components", "concord-frontend/app"];

// Skip these directories entirely.
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build", ".next", "audit", ".github"]);

// Identifier patterns that strongly suggest fake data when EXPORTED.
const FAKE_EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(mock|fake|stub|placeholder|dummy)([A-Z_]\w*)/m;

// Lighter signal: any identifier with mock/fake/stub/placeholder in
// the name in production paths.
const FAKE_IDENT_RE = /\b(mock|fake|stub|placeholder|dummy)([A-Z_]\w+)\s*[(=:]/g;

// Domain-noun allowlist: "dummy" is a real game-mechanic noun in this
// codebase — a COMBAT TRAINING DUMMY (HP, count, loadout), not placeholder
// data. These identifiers are legitimate domain terms, not deferred-wiring
// smells. Matched case-insensitively against the full identifier.
const DOMAIN_TERM_IDENTS = new Set([
  "dummyconfig", "dummyconfigs", "dummyid", "dummyids", "dummyhp",
  "dummycount", "dummyentity", "dummytarget", "dummytargets",
  "dummystate", "dummyloadout",
]);
// Files where a "dummy" identifier is overwhelmingly the training-dummy
// domain noun (combat sandbox / arena / training). In these contexts a
// `dummy*` identifier is a domain term, not fake data.
const TRAINING_CONTEXT_RE = /(?:^|[/\\])(?:sandbox|arena|training|combat)[\w-]*\.(?:js|ts|tsx|jsx|mjs)$/i;

// Suspicious string literals in non-test code. Match the suspicious
// token anywhere inside a string literal (allow trailing context),
// and accept hyphen / underscore / space as separators inside the
// fake-* family.
const SUSPICIOUS_STR_RE = /['"`][^'"`]*?(lorem ipsum|test[-_ ]user[-_ ]?\d|fake[-_ ]?(name|email|user|data)|placeholder[-_ ]?(text|value)|TODO[-_ ]?REPLACE|FIXME[-_ ]?REPLACE)[^'"`]*['"`]/i;

// TODO / FIXME / PLACEHOLDER markers in production paths. // @fake-data-ok: pattern-doc
const TODO_RE = /(?:\/\/|#|\*|<!--)\s*(TODO|FIXME|XXX|PLACEHOLDER|HACK)\b[:.\s]*([^\n]{0,120})/g;

// Test file: any file containing `vi.mock(` or `jest.mock(` for a
// non-relative (production) module path.
const TEST_MOCK_RE = /(?:vi|jest)\.mock\s*\(\s*['"`]([^'"`]+)['"`]/g;

// Files we want to inspect.
function isInteresting(file) {
  return /\.(js|ts|tsx|jsx|mjs)$/.test(file);
}

function isTestFile(rel) {
  // Match a test directory segment, not an arbitrary occurrence of the
  // word "test" anywhere in the path (e.g. `routes/test.js` is NOT a
  // test file — it's a production route).
  return /(?:^|\/)(tests?|__tests__|spec|fixtures?)\//.test(rel) ||
         /\.(test|spec)\.(js|ts|tsx|jsx)$/.test(rel);
}

function isProductionPath(rel) {
  if (isTestFile(rel)) return false;
  // Self-skip:
  //   - The detector codebase itself: its rule strings literally include
  //     "fake-data", "mock", "placeholder", etc. — flagging them is a
  //     tautology.
  //   - The autofix/repair-cortex template files: they emit "TODO"
  //     markers as PART of the patches they inject elsewhere, so the
  //     marker strings are template output, not unresolved work.
  if (/[/\\]lib[/\\]detectors[/\\]/.test(rel)) return false;
  if (/[/\\]lib[/\\]autofix[/\\]/.test(rel)) return false;
  // The forge template engine + generator embed user-facing code in
  // backtick templates; their `TODO` markers belong to the GENERATED
  // app, not this server.
  if (/forge-template-(engine|generator)/.test(rel)) return false;
  for (const p of PROD_PATHS) {
    if (rel.startsWith(p + "/") || rel === p) return true;
  }
  return false;
}

async function* walk(root, base = root) {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(base, entry.name);
    if (entry.isDirectory()) {
      yield* walk(root, full);
    } else if (entry.isFile() && isInteresting(entry.name)) {
      yield path.relative(root, full);
    }
  }
}

export async function runFakeDataDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  const repoRoot = root || REPO_ROOT;
  const findings = [];
  const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : 5000;
  const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;

  let scanned = 0;
  let testMockCount = 0;
  try {
    for await (const rel of walk(repoRoot)) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      scanned++;

      let content;
      try { content = await readFile(path.join(repoRoot, rel), "utf-8"); }
      catch { continue; }

      const lines = content.split("\n");
      const isProd = isProductionPath(rel);
      const isTest = isTestFile(rel);
      // File-level operator opt-out: `@fake-data-ok-file: <reason>`
      // anywhere in the file (typically at the top in a header comment)
      // suppresses ALL fake-data findings for that file. Use for files
      // where mock/placeholder identifiers are tracked-in-flight UI
      // (Phase D UX Suite, demo scaffolds awaiting backend wiring).
      if (/@fake-data-ok-file\b/.test(content)) continue;

      // Inline annotation check: `// @fake-data-ok: <reason>` on the
      // same line OR within 6 lines above suppresses findings on that
      // line. The window accommodates multi-line comment blocks
      // followed by a setTimeout/IIFE wrapper before the flagged
      // identifier (a common React-component pattern).
      const hasAnnotationNear = (i) => {
        for (let j = Math.max(0, i - 6); j <= i; j++) {
          if (/@fake-data-ok\b/.test(lines[j] || "")) return true;
        }
        return false;
      };

      // ── HIGH: exported mock/fake/stub/placeholder/dummy identifiers
      // in production paths.
      if (isProd) {
        let m;
        const re = new RegExp(FAKE_EXPORT_RE.source, "gm");
        while ((m = re.exec(content)) !== null) {
          const lineNum = content.slice(0, m.index).split("\n").length;
          findings.push({
            id: "fake_export_in_production",
            severity: "high",
            kind: "static",
            category: CATEGORY,
            message: `Production file exports identifier prefixed '${m[1]}': ${m[1]}${m[2]}`,
            location: `${rel}:${lineNum}`,
            subject: { kind: "fake_export", file: rel, identifier: `${m[1]}${m[2]}` },
            fixHint: "Replace with real implementation OR move to a tests/ subdirectory.",
          });
          if (findings.length >= findingCap) break;
        }
      }

      // ── INFO: count test mocks of production modules for the summary.
      // Per-mock findings were a 102-entry budget hog with no targeted
      // fix path (each mock is a legitimate unit-test isolation). The
      // aggregate count is preserved in the fake_data_summary finding
      // below; future migration to fixture loaders happens at the test
      // PR level, not via per-mock detector pings.
      if (isTest) {
        let m;
        const re = new RegExp(TEST_MOCK_RE.source, "g");
        while ((m = re.exec(content)) !== null) {
          const modulePath = m[1];
          if (/^\.\/[^.]/.test(modulePath)) continue;
          if (/^(next\/|lucide-react|@testing-library|framer-motion|node:|process|fs|path|url|crypto|@radix-ui|vitest|jest)/.test(modulePath)) continue;
          const isProductionMock =
            /^@\/(?:lib|components|store|hooks)/.test(modulePath) ||
            /^\.\.\/(?:lib|domains|emergent|routes|economy)/.test(modulePath) ||
            /^\.\.\/\.\.\/(?:lib|domains|emergent|routes|economy)/.test(modulePath);
          if (!isProductionMock) continue;
          testMockCount = (testMockCount || 0) + 1;
        }
      }

      // ── MEDIUM: `TODO REPLACE` / `FIXME REPLACE` — explicit
      // deferred-real-implementation markers. Active risk.
      // ── LOW: general TODO/FIXME markers in production paths.
      //
      // Operator opt-out: append ` @fake-data-ok` (anywhere in the line
      // after the TODO/FIXME) to skip. Use sparingly and document why.
      if (isProd) {
        let m;
        const re = new RegExp(TODO_RE.source, "g");
        while ((m = re.exec(content)) !== null) {
          const marker = m[1];
          if (!["TODO", "FIXME", "PLACEHOLDER"].includes(marker.toUpperCase())) continue;
          const tail = m[2].trim();
          // Skip if the comment carries the explicit opt-out annotation,
          // either inline or within 3 lines above.
          if (/@fake-data-ok\b/.test(tail)) continue;
          const lineNum = content.slice(0, m.index).split("\n").length;
          if (hasAnnotationNear(lineNum - 1)) continue;
          // Higher severity if the comment explicitly says it's a
          // deferred placeholder for a real implementation.
          const isDeferredReplace = /\b(replace|hardcoded|placeholder|stub|fake|mock|implement)\b/i.test(tail);
          findings.push({
            id: isDeferredReplace ? "todo_replace_in_production" : "todo_in_production",
            severity: isDeferredReplace ? "medium" : "low",
            kind: "static",
            category: CATEGORY,
            message: `${marker} marker in production: ${tail.slice(0, 100)}`,
            location: `${rel}:${lineNum}`,
            subject: { kind: "todo", file: rel, marker },
            fixHint: isDeferredReplace
              ? "Replace the placeholder/stub with the real implementation, OR drop the comment if no replacement is planned."
              : undefined,
          });
          if (findings.length >= findingCap) break;
        }
      }

      // ── INFO: suspicious string literals in production paths.
      // (Per-line and within-3-lines-above annotation handled via the
      // hasAnnotationNear helper defined above.)
      if (isProd) {
        for (let i = 0; i < lines.length; i++) {
          if (findings.length >= findingCap) break;
          const line = lines[i];
          // Skip comment-only lines.
          if (/^\s*(\/\/|\/\*|\*|#)/.test(line)) continue;
          if (hasAnnotationNear(i)) continue;
          if (SUSPICIOUS_STR_RE.test(line)) {
            findings.push({
              id: "suspicious_string_in_production",
              severity: "info",
              kind: "static",
              category: CATEGORY,
              message: `Suspicious literal in production: ${line.trim().slice(0, 100)}`,
              location: `${rel}:${i + 1}`,
              subject: { kind: "suspicious_string", file: rel },
            });
          }
        }
      }

      // ── INFO: identifier-level fake-naming in production (lighter
      // than HIGH — flags any usage, not just exports).
      // Operator opt-out: `// @fake-data-ok: <reason>` on the same line
      // or the line above.
      if (isProd) {
        let m;
        const re = new RegExp(FAKE_IDENT_RE.source, "g");
        while ((m = re.exec(content)) !== null) {
          const ident = `${m[1]}${m[2]}`;
          // Skip: well-known library helpers (vi.mock, jest.mock, etc — already
          // tested as test files; here in prod paths they're real usages).
          // Also skip identifiers starting with underscore (already-marked-internal).
          if (ident.startsWith("_")) continue;
          // Skip the combat-training-DUMMY domain noun: either a known
          // training-dummy identifier OR any `dummy*` identifier inside a
          // sandbox/arena/training/combat file. (Other fake-prefixes —
          // mock/fake/stub/placeholder — still fire here.)
          if (m[1].toLowerCase() === "dummy" &&
              (DOMAIN_TERM_IDENTS.has(ident.toLowerCase()) || TRAINING_CONTEXT_RE.test(rel))) {
            continue;
          }
          // Skip identifiers explicitly tagged as runtime-mock-mode (e.g.
          // mockOpenAI is a feature flag, not fake data).
          if (/^(mock(?:Openai|Llm|Brain|Inference|Llama)|stubReceiver)/i.test(ident)) continue;
          const lineNum = content.slice(0, m.index).split("\n").length;
          if (hasAnnotationNear(lineNum - 1)) continue;
          findings.push({
            id: "fake_ident_in_production",
            severity: "info",
            kind: "static",
            category: CATEGORY,
            message: `Production reference to identifier suggesting fake data: ${ident}`,
            location: `${rel}:${lineNum}`,
            subject: { kind: "fake_ident", file: rel, identifier: ident },
          });
          if (findings.length >= findingCap) break;
        }
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  if (testMockCount > 0) {
    findings.push({
      id: "fake_data_summary",
      severity: "info",
      kind: "static",
      category: CATEGORY,
      message: `${testMockCount} unit test(s) mock production modules — candidates for fixture-loader migration. Per-mock findings suppressed (each is a legitimate test isolation; migration is a test-PR concern).`,
      location: null,
      evidence: { testMockCount },
    });
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
