#!/usr/bin/env node
// server/scripts/audit-silent-failures.js
// Phase 3: Silent failure detection sweep.
// AI-generated code's signature failure mode: exceptions swallowed, errors logged but not handled,
// async mistakes, sensitive data in error messages.
// Usage: node server/scripts/audit-silent-failures.js [--json] [--severity=critical|high|medium|low]

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../");
const JSON_MODE = process.argv.includes("--json");
const MIN_SEVERITY = (process.argv.find(a => a.startsWith("--severity=")) || "").split("=")[1] || "low";

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

// ── Pattern definitions ───────────────────────────────────────────────────────

const PATTERNS = [
  {
    id: "empty_catch",
    severity: "critical",
    description: "Empty catch block — exception swallowed silently",
    regex: /catch\s*\(\s*(?:\w+\s*)?\)\s*\{\s*\}/g,
    ai_tell: true,
  },
  {
    id: "catch_log_only",
    severity: "high",
    description: "Catch block logs only — no corrective action taken",
    regex: /catch\s*\([^)]*\)\s*\{\s*console\.\w+\([^;]+\);?\s*\}/g,
    ai_tell: true,
  },
  {
    id: "console_log_production",
    severity: "medium",
    description: "console.log left in production code (use logger instead)",
    regex: /^\s*console\.log\s*\(/gm,
    excludeFiles: ["test", "spec", "scripts/", "audit-"],
    ai_tell: true,
  },
  {
    id: "todo_comment",
    severity: "medium",
    description: "TODO comment left in production code — implementation incomplete",
    regex: /\/\/\s*TODO[:\s]/g,
    ai_tell: true,
  },
  {
    id: "placeholder_variable",
    severity: "low",
    description: "Placeholder variable name — likely AI-generated scaffold",
    regex: /\b(?:foo|bar|baz|temp|tmp|asdf|qwerty|placeholder)\d*\b/g,
    excludeFiles: ["test", "spec"],
    ai_tell: true,
  },
  {
    id: "generic_error_message",
    severity: "high",
    description: "Generic error message — hides root cause",
    regex: /throw\s+new\s+Error\s*\(\s*['"](?:Something went wrong|Error occurred|Failed|An error|Unexpected error)['"]/gi,
    ai_tell: true,
  },
  {
    id: "empty_function_body",
    severity: "high",
    description: "Empty function body — implementation missing",
    regex: /(?:function\s+\w+\s*\([^)]*\)|=>\s*)\s*\{\s*\}\s*[;,)]/g,
    excludeFiles: ["test", "spec"],
    ai_tell: true,
  },
  {
    id: "sensitive_in_error",
    severity: "critical",
    description: "Sensitive data potentially leaked in error message",
    regex: /throw\s+new\s+Error\s*\([^)]*(?:password|token|secret|api.?key|private)[^)]*\)/gi,
  },
  {
    id: "unhandled_promise",
    severity: "high",
    description: "Promise chain without .catch — rejection unhandled",
    regex: /\.then\s*\([^)]+\)(?!\s*\.catch)(?!\s*\.finally)/g,
  },
  {
    id: "await_in_loop",
    severity: "medium",
    description: "await inside for loop — sequential when could be parallel with Promise.all",
    regex: /for\s*\([^)]*\)[^{]*\{[^}]*await\s+/g,
  },
  {
    id: "null_default",
    severity: "low",
    description: "Null-coalescing to null — obscures missing data rather than handling it",
    regex: /\?\?\s*null/g,
  },
  {
    id: "catch_rethrow_only",
    severity: "medium",
    description: "Catch block only re-throws — pointless wrapper adds noise",
    regex: /catch\s*\((\w+)\)\s*\{\s*throw\s+\1\s*;?\s*\}/g,
  },
  {
    id: "async_without_await",
    severity: "medium",
    description: "async function contains no await — probably wrong",
    // Detected via custom logic below
    customDetector: true,
  },
];

// ── File walker ────────────────────────────────────────────────────────────────

async function getFiles(dir, exts = [".js"]) {
  const results = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", ".next", "dist", "build"].includes(entry.name)) continue;
      results.push(...await getFiles(fullPath, exts));
    } else if (entry.isFile() && exts.some(e => entry.name.endsWith(e))) {
      results.push(fullPath);
    }
  }
  return results;
}

// ── Async-without-await detector ─────────────────────────────────────────────

function detectAsyncWithoutAwait(content, filePath) {
  const findings = [];
  const asyncFnPattern = /async\s+(?:function\s+\w+|\w+\s*=>|\([^)]*\)\s*=>)\s*\{([^}]{0,500})\}/g;
  let m;
  while ((m = asyncFnPattern.exec(content)) !== null) {
    const body = m[1];
    if (!body.includes("await") && !body.includes("return") && body.trim().length > 10) {
      const lineNum = content.slice(0, m.index).split("\n").length;
      findings.push({ line: lineNum, snippet: m[0].slice(0, 80) });
    }
  }
  return findings;
}

// ── Main ────────────────────────────────────────────────────────────────────────

async function main() {
  const serverLib = await getFiles(path.join(ROOT, "server/lib"), [".js"]);
  const serverRoutes = await getFiles(path.join(ROOT, "server/routes"), [".js"]);
  const files = [...serverLib, ...serverRoutes];

  log(`Scanning ${files.length} production source files for silent failure patterns...`);

  const allFindings = [];
  const minLevel = SEVERITY_ORDER[MIN_SEVERITY] ?? 3;

  for (const filePath of files) {
    const relPath = path.relative(ROOT, filePath);
    const content = await readFile(filePath, "utf-8").catch(() => "");
    if (!content) continue;

    for (const pattern of PATTERNS) {
      if (SEVERITY_ORDER[pattern.severity] > minLevel) continue;

      // Skip files excluded by pattern
      if (pattern.excludeFiles?.some(ex => relPath.includes(ex))) continue;

      if (pattern.customDetector) {
        if (pattern.id === "async_without_await") {
          const hits = detectAsyncWithoutAwait(content, filePath);
          for (const hit of hits) {
            allFindings.push({ file: relPath, pattern: pattern.id, severity: pattern.severity,
              description: pattern.description, line: hit.line, snippet: hit.snippet, aiTell: false });
          }
        }
        continue;
      }

      pattern.regex.lastIndex = 0;
      let m;
      while ((m = pattern.regex.exec(content)) !== null) {
        const lineNum = content.slice(0, m.index).split("\n").length;
        const snippet = m[0].slice(0, 100).replace(/\n/g, " ↵ ");
        allFindings.push({
          file: relPath,
          pattern: pattern.id,
          severity: pattern.severity,
          description: pattern.description,
          line: lineNum,
          snippet,
          aiTell: Boolean(pattern.ai_tell),
        });
      }
    }
  }

  // Sort by severity
  allFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const byPattern = {};
  for (const f of allFindings) {
    if (!byPattern[f.pattern]) byPattern[f.pattern] = { count: 0, severity: f.severity, description: f.description, files: new Set() };
    byPattern[f.pattern].count++;
    byPattern[f.pattern].files.add(f.file);
  }

  const result = {
    scanned: files.length,
    totalFindings: allFindings.length,
    critical: allFindings.filter(f => f.severity === "critical").length,
    high: allFindings.filter(f => f.severity === "high").length,
    medium: allFindings.filter(f => f.severity === "medium").length,
    low: allFindings.filter(f => f.severity === "low").length,
    aiTells: allFindings.filter(f => f.aiTell).length,
    byPattern: Object.fromEntries(
      Object.entries(byPattern).map(([k, v]) => [k, { ...v, files: [...v.files] }])
    ),
    findings: allFindings.slice(0, 100), // cap output
    generatedAt: new Date().toISOString(),
  };

  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(result, null, 2));
  } else {
    log(`\n══ SILENT FAILURE AUDIT ══`);
    log(`Scanned: ${result.scanned} files`);
    log(`Findings: ${result.totalFindings} total | ${result.critical} critical | ${result.high} high | ${result.medium} medium | ${result.low} low`);
    log(`AI code tells: ${result.aiTells}`);
    log(`\nBy pattern:`);
    for (const [id, data] of Object.entries(result.byPattern)) {
      const severity = { critical: "🔴", high: "🟠", medium: "🟡", low: "⚪" }[data.severity] || "";
      log(`  ${severity} ${id} (${data.count} occurrences in ${data.files.length} files)`);
      log(`    ${data.description}`);
    }

    if (result.critical > 0) {
      log(`\n⚠️  Critical findings:`);
      allFindings.filter(f => f.severity === "critical").slice(0, 10).forEach(f => {
        log(`  ${f.file}:${f.line} — ${f.snippet}`);
      });
    }
  }

  return result;
}

function log(...args) {
  if (!JSON_MODE) console.log(...args);
}

main().catch(e => { console.error(e.message); process.exit(1); });
