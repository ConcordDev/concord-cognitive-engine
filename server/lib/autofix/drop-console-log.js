// server/lib/autofix/drop-console-log.js
//
// Auto-fix: remove `console.log(...)` lines flagged by `console_log_production`.
// Keeps `console.warn` / `console.error` (legit signals). Skips lines marked
// `// keep-console` and skips files in test / scripts / migration paths
// (those legitimately use console.log).
//
// Conservative: only acts on a line that is JUST a console.log call (with
// optional indent + trailing semicolon). Lines that interleave console.log
// inside a chain or expression are declined.

const CONSOLE_LOG_LINE_RE = /^\s*console\.log\s*\([^)]*\)\s*;?\s*$/gm;

export const dropConsoleLogFix = {
  id: "drop_console_log",
  label: "Remove console.log() lines from production code",
  riskTier: "low",
  matchFinding(f) { return f?.id === "console_log_production" || f?.fixHint === "drop_console_log"; },
  isApplicable(filePath, content) {
    if (/\/(?:tests?|scripts|migrations|examples?)\//.test(filePath)) return false;
    if (/console\.log\s*\(/.test(content)) return /^\s*console\.log\s*\(/m.test(content);
    return false;
  },
  apply(content) {
    let changed = false;
    const next = content.replace(CONSOLE_LOG_LINE_RE, (match) => {
      if (/keep-console/.test(match)) return match;
      changed = true;
      return "";
    });
    return changed ? next : null;
  },
  describe(_f) { return "Drop bare console.log() calls from production code"; },
};
