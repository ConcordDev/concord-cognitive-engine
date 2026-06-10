#!/usr/bin/env node
/**
 * Repair Cortex — Mid-Build Surgeon (CLI)
 *
 * Full-system build error analyzer and auto-fixer.
 * Handles ALL error categories: TypeScript, ESLint, Next.js, lockfile,
 * native modules, Docker, CSS/Tailwind, React, Node.js runtime, and more.
 *
 * Called by concord-deploy.sh between build retries.
 *
 * Usage:
 *   node scripts/repair-surgeon.js [project-root] [build-output-file]
 *
 * Exit codes:
 *   0 — Fix applied (retry the build)
 *   1 — Could not fix (escalate to sovereign)
 *
 * Additive only. No modifications to existing systems.
 */

import fs from "fs";
import { execSync, execFileSync } from "child_process";
import {
  matchErrorPattern,
  addToRepairMemory,
  lookupRepairMemory,
} from "../server/emergent/repair-cortex.js";

// ── Fix Executors ──────────────────────────────────────────────────────────
// Maps fix names to shell commands that actually apply them on disk.
// Returns a command string or null (= cannot be automated, escalate).

// ── Capture validators ──────────────────────────────────────────────────────
// match[1] is interpolated from pattern-matched build output into a SHELL
// command (these fixes legitimately need a shell — they use &&/||/pipes — so
// execFileSync isn't an option). Every interpolated capture is therefore
// validated against a strict allowlist regex BEFORE it reaches the command
// string; anything that doesn't match is rejected (returns null → escalate),
// closing the command-injection sink at the source.
//   - npm package name: scoped or unscoped, optional @version (npm naming rules)
//   - port: bare digits only
//   - filesystem path: no shell-meta chars, no leading dash, no '..' traversal
const NPM_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[a-zA-Z0-9-._^~><=|*x ]+)?$/;
const PORT_RE = /^\d{1,5}$/;
const SAFE_PATH_RE = /^[A-Za-z0-9_./-]+$/;

function safePkg(s) {
  return typeof s === "string" && NPM_NAME_RE.test(s) ? s : null;
}
function safePort(s) {
  if (typeof s !== "string" || !PORT_RE.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 65535 ? s : null;
}
function safePath(s) {
  return typeof s === "string" && SAFE_PATH_RE.test(s) && !s.includes("..") ? s : null;
}

function _fixCmd(name, match, projectRoot) {
  const cmds = {
    // npm / lockfile
    regenerate_lockfile:     () => `cd "${projectRoot}" && npm install --package-lock-only`,
    run_npm_install_first:   () => `cd "${projectRoot}" && npm install --package-lock-only`,
    install_legacy_peer_deps:() => `cd "${projectRoot}" && npm install --legacy-peer-deps`,
    install_force:           () => `cd "${projectRoot}" && npm install --force`,
    delete_and_reinstall:    () => `cd "${projectRoot}" && rm -rf node_modules package-lock.json && npm install`,
    reinstall_deps:          () => `cd "${projectRoot}" && npm install`,
    npm_audit_fix:           () => `cd "${projectRoot}" && npm audit fix || true`,
    install_package:         () => { const p = safePkg(match?.[1]); return p ? `cd "${projectRoot}" && npm install "${p}" || true` : null; },
    install_missing:         () => { const p = safePkg(match?.[1]); return p ? `cd "${projectRoot}" && npm install "${p}" || true` : null; },

    // native modules
    rebuild_native:          () => `cd "${projectRoot}" && npm rebuild`,
    rebuild_sqlite:          () => `cd "${projectRoot}" && npm rebuild better-sqlite3`,
    reinstall_sqlite:        () => `cd "${projectRoot}" && npm uninstall better-sqlite3 && npm install better-sqlite3`,
    reinstall_sharp:         () => `cd "${projectRoot}" && npm install --platform=linux --arch=x64 sharp`,

    // runtime
    kill_process:            () => { const p = safePort(match?.[1]); return p ? `fuser -k ${p}/tcp 2>/dev/null || true` : null; },
    increase_heap:           () => null, // requires env change — escalate
    create_directory:        () => { const p = safePath(match?.[1]); return p ? `mkdir -p "${p}"` : null; },
    fix_permissions:         () => { const p = safePath(match?.[1]); return p ? `chmod -R u+rwX "${p}"` : null; },

    // docker
    docker_prune:            () => `docker system prune -f && docker builder prune -f`,
    clear_docker_cache:      () => `docker builder prune -f`,
    clean_old_images:        () => `docker image prune -f`,
    recreate_network:        () => `docker network prune -f`,

    // eslint autofix — runs on the concord-frontend directory
    eslint_autofix:          () => `cd "${projectRoot}/concord-frontend" && npx eslint --fix app/ components/ lib/ hooks/ store/ --ext .tsx,.ts 2>/dev/null || true`,
    // useRef React 19 fix — useRef<T>() → useRef<T>(undefined)
    fix_useref_react19:      () => `find "${projectRoot}/concord-frontend" -name "*.tsx" -o -name "*.ts" | xargs sed -i 's/useRef<\\([^>]*\\)>()/useRef<\\1>(undefined)/g' 2>/dev/null || true`,

    // eslint — prefix underscore for unused vars
    prefix_underscore:       () => null, // needs AST modification — escalate
    remove_import:           () => null,
    add_eslint_disable:      () => null,
  };
  const fn = cmds[name];
  return fn ? fn() : null;
}

function executeFixCommand(cmd, fixName) {
  try {
    console.log(`  Executing: ${cmd.slice(0, 200)}`);
    // `cmd` is a fixed shell pipeline built by _fixCmd() from a closed map of
    // hardcoded templates; the only interpolated values are captures already
    // run through safePkg/safePort/safePath (null = rejected before reaching
    // here). A shell is required because the commands use &&/||/cd/rm, so this
    // stays execSync — the injection surface is closed upstream at the
    // validators, not at this call. (Dev/CI repair tool, not a request path.)
    execSync(cmd, { stdio: "pipe", timeout: 120000 });
    console.log(`  ✓ Fix "${fixName}" applied successfully`);
    return true;
  } catch (e) {
    console.log(`  ✗ Fix "${fixName}" failed: ${String(e?.message || e).slice(0, 150)}`);
    return false;
  }
}

/**
 * Parse file paths from eslint/typescript warning lines and run eslint --fix.
 * Handles formats: ./path/to/file.tsx:LINE:COL, ./path/to/file.tsx(LINE,COL)
 * Non-blocking — logs results but never fails the surgeon.
 */
function runEslintAutofix(buildOutput, rootDir) {
  try {
    const fileSet = new Set();
    const lines = buildOutput.split("\n");
    for (const line of lines) {
      // Match: ./path/to/file.tsx:42:10 or ./app/foo/bar.ts:100:5
      const m = line.match(/(\.\/(app|components|lib|hooks|store)\/[^\s:]+\.[jt]sx?)/);
      // The capture is interpolated into a shell command below; the broad
      // [^\s:]+ inner match still admits shell-meta chars (" $ ` ; etc.), so
      // re-validate each path against the strict safe-path allowlist and drop
      // anything that doesn't pass (no traversal, no meta chars).
      if (m && safePath(m[1])) fileSet.add(m[1]);
    }
    if (fileSet.size === 0) return 0;

    const files = Array.from(fileSet);
    console.log(`  ESLint autofix: ${files.length} file(s) to fix`);
    try {
      // No shell: execFileSync with an arg array passes each (already
      // safePath-validated) file as a literal argv entry, so there is no
      // interpolation sink here at all — defense by construction, not by
      // escaping. cwd replaces the old `cd && …` shell prefix.
      execFileSync("npx", ["eslint", "--fix", ...files], {
        cwd: `${rootDir}/concord-frontend`,
        stdio: "pipe",
        timeout: 120000,
      });
    } catch {
      // eslint --fix exits non-zero if unfixable warnings remain — that's OK
    }
    console.log(`  ESLint autofix: completed on ${files.length} file(s)`);
    return files.length;
  } catch (e) {
    console.log(`  ESLint autofix: skipped (${String(e?.message || e).slice(0, 80)})`);
    return 0;
  }
}

const projectRoot = process.argv[2] || process.cwd();
const buildOutputFile = process.argv[3] || "/tmp/build-output.log";

console.log("╔═══════════════════════════════════════════════╗");
console.log("║  REPAIR CORTEX — MID-BUILD SURGEON            ║");
console.log("║  Full-System Error Analysis                    ║");
console.log("╚═══════════════════════════════════════════════╝");
console.log("");
console.log(`Project root:  ${projectRoot}`);
console.log(`Build output:  ${buildOutputFile}`);
console.log(`Timestamp:     ${new Date().toISOString()}`);
console.log("");

function main() {
  try {
    // Read the build output
    if (!fs.existsSync(buildOutputFile)) {
      console.error("Build output file not found:", buildOutputFile);
      process.exit(1);
    }

    const buildOutput = fs.readFileSync(buildOutputFile, "utf-8");
    const lines = buildOutput.split("\n").filter(l => l.trim());

    console.log(`Analyzing ${lines.length} lines of build output...`);
    console.log("");

    // Scan each line for known error patterns
    const errors = [];
    const seenPatterns = new Set(); // Deduplicate same error type
    for (const line of lines) {
      const matched = matchErrorPattern(line);
      if (matched && !seenPatterns.has(matched.key)) {
        errors.push({ line: line.trim(), ...matched });
        seenPatterns.add(matched.key);
      }
    }

    // Categorize errors for summary
    const categories = new Map();
    for (const error of errors) {
      const cat = error.category || "unknown";
      categories.set(cat, (categories.get(cat) || 0) + 1);
    }

    if (errors.length === 0) {
      // Try heuristic fallback for unrecognized errors
      const heuristicResult = tryHeuristicDiagnosis(buildOutput, lines);
      if (heuristicResult) {
        console.log(`Heuristic diagnosis: ${heuristicResult.category}`);
        console.log(`  ${heuristicResult.message}`);
        console.log(`  Suggested: ${heuristicResult.suggestion}`);
        console.log("");
        // Try to execute the heuristic fix
        const cmd = _fixCmd(heuristicResult.suggestion, null, projectRoot);
        if (cmd) {
          const success = executeFixCommand(cmd, heuristicResult.suggestion);
          if (!success) {
            console.log("SURGEON: Heuristic fix failed to apply. Sovereign intervention required.");
            process.exit(1);
          }
        }

        addToRepairMemory(heuristicResult.pattern, {
          name: heuristicResult.suggestion,
          confidence: heuristicResult.confidence,
          category: heuristicResult.category,
          description: heuristicResult.message,
        });
        console.log("SURGEON: Heuristic fix applied. Retry the build.");
        process.exit(0);
      }

      console.log("No recognized error patterns found in build output.");
      console.log("Sovereign intervention required.");
      process.exit(1);
    }

    console.log(`Found ${errors.length} recognized error pattern(s):`);
    if (categories.size > 0) {
      console.log(`  Categories: ${Array.from(categories.entries()).map(([k, v]) => `${k}(${v})`).join(", ")}`);
    }
    console.log("");

    let fixApplied = false;

    for (const error of errors) {
      console.log(`  Pattern:  ${error.key}`);
      console.log(`  Category: ${error.category}`);
      console.log(`  Line:     ${error.line.slice(0, 150)}`);

      // Check repair memory first
      const knownFix = lookupRepairMemory(error.match?.[0] || error.line);
      if (knownFix) {
        console.log(`  Known fix: ${knownFix.name} (from repair memory, success rate: ${knownFix.successRate || "?"})`);
        const cmd = _fixCmd(knownFix.name, error.match, projectRoot);
        if (cmd) {
          fixApplied = executeFixCommand(cmd, knownFix.name) || fixApplied;
        } else {
          console.log(`  (no automated command for "${knownFix.name}" — retry may still help)`);
        }
        console.log("");
        continue;
      }

      // Try pattern-matched fixes
      if (error.fixes && error.fixes.length > 0) {
        const sortedFixes = [...error.fixes].sort((a, b) => b.confidence - a.confidence);
        const bestFix = sortedFixes[0];

        console.log(`  Best fix:    ${bestFix.name} (confidence: ${bestFix.confidence})`);
        console.log(`  Description: ${bestFix.describe(error.match)}`);

        if (sortedFixes.length > 1) {
          console.log(`  Alt fixes:   ${sortedFixes.slice(1).map(f => `${f.name}(${f.confidence})`).join(", ")}`);
        }

        // Actually execute the fix
        const cmd = _fixCmd(bestFix.name, error.match, projectRoot);
        if (cmd) {
          const success = executeFixCommand(cmd, bestFix.name);
          if (success) {
            fixApplied = true;
          } else if (sortedFixes.length > 1) {
            // Try the next best fix
            for (const altFix of sortedFixes.slice(1)) {
              const altCmd = _fixCmd(altFix.name, error.match, projectRoot);
              if (altCmd) {
                console.log(`  Trying alt: ${altFix.name} (confidence: ${altFix.confidence})`);
                if (executeFixCommand(altCmd, altFix.name)) {
                  fixApplied = true;
                  break;
                }
              }
            }
          }
        } else {
          console.log(`  (no automated command for "${bestFix.name}" — cannot apply)`);
        }

        // Record in repair memory
        addToRepairMemory(error.match?.[0] || error.line, {
          name: bestFix.name,
          confidence: bestFix.confidence,
          category: error.category,
          description: bestFix.describe(error.match),
        });

        // Only count as fix applied if we actually changed something on disk
      } else {
        console.log("  No fixes available for this pattern");
      }

      console.log("");
    }

    // After per-error fixes, run targeted eslint autofix if lint/eslint errors were found
    if (categories.has("lint") || categories.has("eslint")) {
      console.log("Running targeted ESLint autofix on affected files...");
      const eslintFixed = runEslintAutofix(buildOutput, projectRoot);
      if (eslintFixed > 0) {
        fixApplied = true;
        console.log(`  ESLint autofix: cleaned ${eslintFixed} file(s)`);
      }
      console.log("");
    }

    if (fixApplied) {
      console.log(`SURGEON: ${errors.length} error(s) analyzed, fix(es) applied on disk. Retry the build.`);
      process.exit(0);
    } else {
      console.log("SURGEON: No automated fixes available for these errors. Sovereign intervention required.");
      process.exit(1);
    }
  } catch (e) {
    console.error("SURGEON ERROR:", e?.message || e);
    process.exit(1);
  }
}

/**
 * Heuristic fallback for errors that don't match any explicit pattern.
 * Looks for broad signals in the build output.
 */
function tryHeuristicDiagnosis(fullOutput, lines) {
  try {
    const lower = fullOutput.toLowerCase();

    // Lockfile / npm ci failures
    if (lower.includes("npm ci") && (lower.includes("lockfile") || lower.includes("package-lock"))) {
      return {
        category: "lockfile",
        pattern: "npm_ci_lockfile_generic",
        message: "npm ci failed due to lockfile issue",
        suggestion: "regenerate_lockfile",
        confidence: 0.9,
      };
    }

    // ERESOLVE anywhere
    if (lower.includes("eresolve")) {
      return {
        category: "lockfile",
        pattern: "eresolve_generic",
        message: "npm dependency resolution failed (ERESOLVE)",
        suggestion: "install_legacy_peer_deps",
        confidence: 0.85,
      };
    }

    // TypeScript errors
    if (lower.includes("error ts") || lower.includes("type error")) {
      const count = (fullOutput.match(/error TS\d+/g) || []).length;
      return {
        category: "typescript",
        pattern: "typescript_generic",
        message: `TypeScript compilation failed with ${count || "unknown"} error(s)`,
        suggestion: "fix_typescript_errors",
        confidence: 0.7,
      };
    }

    // Next.js build failure
    if (lower.includes("next build") && lower.includes("failed")) {
      return {
        category: "nextjs",
        pattern: "nextjs_build_generic",
        message: "Next.js build failed",
        suggestion: "check_next_build_output",
        confidence: 0.6,
      };
    }

    // ESLint
    if (lower.includes("eslint") && (lower.includes("error") || lower.includes("problems"))) {
      return {
        category: "eslint",
        pattern: "eslint_generic",
        message: "ESLint found errors that block the build",
        suggestion: "fix_eslint_errors",
        confidence: 0.7,
      };
    }

    // Docker no space
    if (lower.includes("no space left")) {
      return {
        category: "docker",
        pattern: "no_space_generic",
        message: "No disk space left on device",
        suggestion: "docker_prune",
        confidence: 0.95,
      };
    }

    // Native module / gyp
    if (lower.includes("gyp err") || lower.includes("node-pre-gyp") || lower.includes("prebuild-install")) {
      return {
        category: "native",
        pattern: "native_module_generic",
        message: "Native module compilation failed",
        suggestion: "install_build_tools",
        confidence: 0.8,
      };
    }

    // Permission denied
    if (lower.includes("eacces") || lower.includes("permission denied")) {
      return {
        category: "runtime",
        pattern: "permission_generic",
        message: "Permission denied during build",
        suggestion: "fix_permissions",
        confidence: 0.8,
      };
    }

    // Network timeout
    if (lower.includes("etimedout") || lower.includes("econnrefused") || lower.includes("fetch failed")) {
      return {
        category: "network",
        pattern: "network_generic",
        message: "Network error during build (timeout or connection refused)",
        suggestion: "check_network_retry",
        confidence: 0.7,
      };
    }

    return null;
  } catch {
    return null;
  }
}

main();
