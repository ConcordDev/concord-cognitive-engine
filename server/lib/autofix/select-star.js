// server/lib/autofix/select-star.js
//
// Auto-fix: comment-injection only — adds a `// TODO: project explicit
// columns` comment immediately above any `SELECT * FROM <table>` callsite.
// Schema-aware projection requires a real parser + DB introspection;
// keeping this fix as a suggestion-comment so risk stays at zero.

const SELECT_STAR_RE = /^(\s*)(.*\bSELECT\s+\*\s+FROM\s+\w+\b)/gim;
const TODO_MARKER = "// TODO: project explicit columns (auto-fix suggestion)";

export const selectStarFix = {
  id: "select_star_to_comment",
  label: "Inject TODO comment above SELECT * callsites",
  riskTier: "low",
  matchFinding(f) {
    return f?.id === "perf_select_star_hot" || f?.fixHint === "replace_select_star";
  },
  isApplicable(_filePath, content) { return /\bSELECT\s+\*/i.test(content); },
  apply(content) {
    let changed = false;
    SELECT_STAR_RE.lastIndex = 0;
    const next = content.replace(SELECT_STAR_RE, (match, indent, body) => {
      // Idempotent: skip if TODO already present on the previous line.
      const lookback = content.slice(Math.max(0, content.indexOf(match) - 200), content.indexOf(match));
      if (lookback.includes(TODO_MARKER)) return match;
      changed = true;
      return `${indent}${TODO_MARKER}\n${indent}${body}`;
    });
    if (!changed) return null;
    return next;
  },
  describe(_f) { return "Suggest explicit column projection above SELECT *"; },
};
