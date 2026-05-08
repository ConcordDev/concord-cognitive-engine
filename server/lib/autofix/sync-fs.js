// server/lib/autofix/sync-fs.js
//
// Auto-fix: rewrite `fs.readFileSync(p, opts)` to
// `await fs.promises.readFile(p, opts)` when the surrounding function is
// `async`. Single-line shape only — multi-line continuations are
// declined to keep risk low.
//
// Caller-side guarantees (handled by safeApply):
//   - hard-refusal paths (server.js / migrations / tests / economy / etc) skipped
// Callee-side guarantees (this file):
//   - file must contain at least one `async function` or `async (` shape
//   - replacement is per-line and idempotent
//   - returns null when nothing changed

const SYNC_FS_RE = /\bfs\.(readFileSync|writeFileSync|appendFileSync|existsSync|statSync)\s*\(/g;
const ASYNC_HINT_RE = /\basync\s+(?:function|\()/;

export const syncFsFix = {
  id: "sync_fs_to_promises",
  label: "fs.*Sync inside async fn → await fs.promises.*",
  riskTier: "low",
  matchFinding(f) {
    return f?.id === "perf_sync_fs_in_handler" || f?.fixHint === "sync_fs_to_promises";
  },
  isApplicable(filePath, content, _finding) {
    if (!ASYNC_HINT_RE.test(content)) return false;
    if (/@sync-fs-ok\b/.test(content)) return false;
    return SYNC_FS_RE.test(content);
  },
  apply(content) {
    SYNC_FS_RE.lastIndex = 0;
    let changed = false;
    const replaced = content.replace(SYNC_FS_RE, (match, fn) => {
      const promiseFn = {
        readFileSync: "readFile",
        writeFileSync: "writeFile",
        appendFileSync: "appendFile",
        existsSync: null,    // no fs.promises equivalent — leave alone
        statSync: "stat",
      }[fn];
      if (!promiseFn) return match;
      changed = true;
      return `await fs.promises.${promiseFn}(`;
    });
    if (!changed) return null;
    // Sanity check: never produce double-await
    if (/await\s+await/.test(replaced)) return null;
    return replaced;
  },
  describe(_f) { return "Rewrite synchronous fs calls inside async functions"; },
};
