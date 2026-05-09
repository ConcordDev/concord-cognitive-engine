// server/lib/detectors/env-config-drift-detector.js
//
// Catches category #4 (config / env drift): values that should live in
// env vars or config but are hardcoded in production code paths.
//
// Patterns:
//   - http(s):// URLs in non-test code that aren't already coming from env
//   - localhost / 127.0.0.1 / 0.0.0.0 hardcoded
//   - Magic ports (5050, 11434, 11435, 3000, 5432) hardcoded
//   - Numeric timeout literals > 5000 ms in API paths
//   - Hardcoded service paths like "/var/lib/", "/tmp/concord"
//
// Severities:
//   high   — production URL hardcoded (api.concord-os.org, etc)
//   medium — localhost / 127.0.0.1 hardcoded outside config + dev paths
//   low    — port numbers hardcoded outside CONST exports
//   info   — magic timeout literals

import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeReport, makeError } from "./_framework.js";

const CATEGORY = "env-config-drift";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../");

const SCAN_PATHS = ["server/lib", "server/routes", "server/economy", "server/emergent", "concord-frontend/lib", "concord-frontend/components", "concord-frontend/hooks", "concord-frontend/app"];
const SKIP_DIRS = new Set(["node_modules", ".git", "coverage", "dist", "build", ".next", "audit", "tests", "__tests__", "docs", "scripts"]);

function isInteresting(file) {
  return /\.(js|ts|tsx|jsx|mjs)$/.test(file);
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
  if (/\b(test|spec|fixtures?)\.(js|ts|tsx|jsx)$/.test(rel)) return false;
  return SCAN_PATHS.some(p => rel.startsWith(p + "/"));
}

const PROD_URL_RE = /['"`](https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|::1)[^'"`]+\.[a-z]{2,}[^'"`]*)['"`]/g;
// RFC 6761 / W3 namespace / template / brand URLs that look prod but aren't.
const PLACEHOLDER_URL_RE = /(?:^|\b)(example\.com|example\.org|example\.net|\.example(?:\b|\/)|\.test(?:\b|\/)|\.invalid(?:\b|\/)|w3\.org|your-[a-z-]+\.com|[a-z][\w-]*\.example|placeholder|concord-os\.org\/(?:legal|terms|privacy|brand)|github\.com\/|claude\.ai\/|anthropic\.com\/|mit-license\.org)/i;
const LOCALHOST_RE = /['"`](https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?[^'"`]*)['"`]/g;
const KNOWN_PORTS = new Set([5050, 11434, 11435, 11436, 11437, 11438, 3000, 3001, 5432, 6379, 9090, 3030]);
const PORT_RE = /\bport\s*[:=]\s*(\d{4,5})\b/gi;
const TIMEOUT_RE = /\b(?:timeout|TIMEOUT|delay|DELAY)\s*[:=]\s*(\d{5,7})\b/g;
const ANNOTATION_OK_RE = /@env-config-ok\b/;
const ENV_GUARD_RE = /process\.env\./;

export async function runEnvConfigDriftDetector({ root, opts = {} } = {}) {
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
      if (ANNOTATION_OK_RE.test(content)) continue;

      const fileHasEnvFallback = ENV_GUARD_RE.test(content);
      const lines = content.split("\n");

      // Check each suspicious URL — but only flag if there's NO env fallback in the file.
      // This avoids flagging `process.env.API_URL || "https://api.concord-os.org"` as a real bug.
      let m;

      const prodRe = new RegExp(PROD_URL_RE.source, "g");
      while ((m = prodRe.exec(content)) !== null) {
        const url = m[1];
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        if (/process\.env\.[A-Z_]+\s*(?:\|\||,)/.test(lineText)) continue;
        if (/^\s*(?:\/\/|\/\*|\*|#)/.test(lineText)) continue;
        // Skip placeholder / reserved / standards-namespace / brand URLs.
        if (PLACEHOLDER_URL_RE.test(url)) continue;
        findings.push({
          id: "hardcoded_prod_url",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `Hardcoded production URL: ${url.slice(0, 80)}`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "url", file: rel, url },
          fixHint: "Move to an env var (process.env.<NAME>) with a sensible default for dev.",
        });
        if (findings.length >= findingCap) break;
      }

      const lhRe = new RegExp(LOCALHOST_RE.source, "g");
      while ((m = lhRe.exec(content)) !== null) {
        const url = m[1];
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        if (/process\.env\.[A-Z_]+\s*(?:\|\||,)/.test(lineText)) continue;
        if (/^\s*(?:\/\/|\/\*|\*|#)/.test(lineText)) continue;
        // Localhost URLs are commonly fine in dev defaults — only flag if the
        // file has no env-var pattern at all (likely a forgotten hardcode).
        if (fileHasEnvFallback) continue;
        findings.push({
          id: "hardcoded_localhost",
          severity: "medium",
          kind: "static",
          category: CATEGORY,
          message: `Hardcoded localhost URL with no env-var fallback in this file: ${url}`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "url", file: rel, url },
        });
        if (findings.length >= findingCap) break;
      }

      // Magic ports — flag known service ports outside CONSTANT_DEF
      const portRe = new RegExp(PORT_RE.source, "gi");
      while ((m = portRe.exec(content)) !== null) {
        const port = parseInt(m[1], 10);
        if (!KNOWN_PORTS.has(port)) continue;
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        if (/process\.env\./.test(lineText)) continue;
        if (/^\s*(?:const|export const)\s+[A-Z_]+\s*=/.test(lineText)) continue;
        findings.push({
          id: "magic_port",
          severity: "low",
          kind: "static",
          category: CATEGORY,
          message: `Hardcoded service port ${port} — should come from env`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "port", file: rel, port },
        });
        if (findings.length >= findingCap) break;
      }

      // Timeout literals > 10s
      const timeRe = new RegExp(TIMEOUT_RE.source, "g");
      while ((m = timeRe.exec(content)) !== null) {
        const ms = parseInt(m[1], 10);
        if (ms < 10000) continue;
        const lineNum = content.slice(0, m.index).split("\n").length;
        const lineText = lines[lineNum - 1] || "";
        if (ANNOTATION_OK_RE.test(lineText)) continue;
        if (/process\.env\./.test(lineText)) continue;
        findings.push({
          id: "magic_timeout",
          severity: "info",
          kind: "static",
          category: CATEGORY,
          message: `Magic timeout ${ms}ms — consider env-driven`,
          location: `${rel}:${lineNum}`,
          subject: { kind: "timeout", file: rel, ms },
        });
      }
    }
  } catch (err) {
    return makeError(CATEGORY, "detector_threw", err, t0);
  }

  const report = makeReport(CATEGORY, findings, t0);
  report.scanned = scanned;
  return report;
}
