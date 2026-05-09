// server/lib/detectors/secret-leak-detector.js
//
// Scans the codebase for hardcoded secrets / credentials / API keys.
// Critical findings here are real risk — they should never reach a commit.
//
// We bias for precision over recall: each pattern has a tight regex AND a
// minimum length AND requires the surrounding string to look like an actual
// secret (no `example`, `your-key`, `test`, `xxxx` markers).

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";

const PATTERNS = [
  {
    id: "openai_key",
    severity: "critical",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    description: "OpenAI API key",
  },
  {
    id: "anthropic_key",
    severity: "critical",
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,
    description: "Anthropic API key",
  },
  {
    id: "github_token",
    severity: "critical",
    regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}/g,
    description: "GitHub personal access token",
  },
  {
    id: "aws_access_key",
    severity: "critical",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
    description: "AWS access key",
  },
  {
    id: "aws_secret",
    severity: "critical",
    regex: /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+=]{30,}['"]/gi,
    description: "AWS secret access key",
  },
  {
    id: "stripe_live_key",
    severity: "critical",
    regex: /\bsk_live_[A-Za-z0-9]{24,}/g,
    description: "Stripe live secret key",
  },
  {
    id: "stripe_test_key",
    severity: "high",
    regex: /\bsk_test_[A-Za-z0-9]{24,}/g,
    description: "Stripe test secret key",
  },
  {
    id: "slack_token",
    severity: "high",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
    description: "Slack token",
  },
  {
    id: "private_key_pem",
    severity: "critical",
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g,
    description: "Embedded private key",
  },
  {
    id: "google_api_key",
    severity: "high",
    regex: /\bAIza[0-9A-Za-z_\-]{35}\b/g,
    description: "Google API key",
  },
  {
    id: "jwt_token",
    severity: "medium",
    regex: /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\b/g,
    description: "JWT bearer token",
  },
  {
    id: "generic_password",
    severity: "high",
    // password / passwd / pwd assignment containing 6+ char value, NOT empty / 'pass' / process.env / env vars
    regex: /(?:^|[^A-Za-z_])(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"\s]{6,})['"]/gi,
    description: "Hardcoded password",
    skipMatch: (m) => /^(?:process\.env|env\.|undefined|null)/i.test(m[1] || ""),
  },
];

// false-positive markers — regex matches that contain any of these are dropped
const FALSE_POSITIVE_MARKERS = [
  "example", "placeholder", "your-key", "yourkey", "<your", "test_key", "fake",
  "abcdefg", "xxxx", "redacted", "sample", "dummy", "lorem",
];

const SKIP_FILES = [
  /\.(?:lock|md|json5|yaml|yml|toml|env\.example|env\.runpod)$/,
  /\/(?:audit|reports|docs|skills|content|monitoring|nginx|k8s|load-tests|extension)\//,
  /\/test-fixtures?\//,
  /\.test\.(?:js|ts|tsx|jsx)$/,
  /\.spec\.(?:js|ts|tsx|jsx)$/,
  /\/__mocks?__\//,
  /\.env\.example$/,
];

function isFalsePositive(match) {
  const s = match.toLowerCase();
  return FALSE_POSITIVE_MARKERS.some(m => s.includes(m));
}

export async function runSecretLeakDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("secret-leak", "no_root", null, t0);

  try {
    const exts = [".js", ".ts", ".tsx", ".jsx", ".env", ".sh", ".py"];
    const files = await walk(root, exts);
    const findings = [];

    for (const f of files) {
      const rel = relPath(root, f);
      if (SKIP_FILES.some(re => re.test(rel))) continue;
      const c = await readSafe(f);
      if (!c) continue;

      for (const p of PATTERNS) {
        p.regex.lastIndex = 0;
        let m;
        while ((m = p.regex.exec(c)) != null) {
          const matched = m[0];
          if (isFalsePositive(matched)) continue;
          if (p.skipMatch && p.skipMatch(m)) continue;
          findings.push({
            id: `secret_${p.id}`,
            severity: p.severity,
            kind: "secret-leak",
            subject: { kind: "file", path: rel },
            message: `${p.description} embedded in source`,
            location: `${rel}:${lineOf(c, m.index)}`,
            evidence: { snippet: snippet(matched, 50) },
            fixHint: "rotate_secret_and_move_to_env",
          });
          if (findings.length > 500) break;
        }
        if (findings.length > 500) break;
      }
      if (findings.length > 500) break;
    }

    findings.unshift({
      id: "secret_leak_summary",
      severity: "info",
      kind: "secret-leak",
      message: `Scanned ${files.length} files; flagged ${findings.length}`,
      evidence: { fileCount: files.length },
    });

    return makeReport("secret-leak", findings, t0);
  } catch (err) {
    return makeError("secret-leak", "exception", err, t0);
  }
}
