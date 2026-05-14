// server/lib/autofix/null-check.js
//
// Repair-cortex auto-fix for `null_check_missing` findings.
//
// Inserts `if (!<name>) return res.status(404).json({ ok: false, error: "<resource>_not_found" });`
// between the `.get()` assignment and its first unguarded property access.
//
// Risk tier: MEDIUM. The fix changes the response shape (adds a 404 path
// that wasn't there before) so a UI that was previously crashing on the
// 500 might now see a 404 it doesn't know how to render. Repair-cortex
// applies these as SUGGESTIONS — they land in a follow-up PR for human
// review, not auto-merged.

export const nullCheckFix = {
  id: "insert_null_check_404",
  label: "Insert 404-on-missing-row guard",
  riskTier: "medium",

  matchFinding(f) {
    return f?.id === "null_check_missing" && f?.subject?.variable;
  },

  isApplicable(filePath, content, finding) {
    if (!finding?.subject?.variable) return false;
    // Only apply to route handler files — that's where the response shape
    // change matters. For lib/ files we'd need to know the caller's
    // contract.
    if (!/\/routes\//.test(filePath)) return false;
    return content.includes(finding.subject.variable);
  },

  apply(content, finding) {
    const name = finding?.subject?.variable;
    if (!name) return null;
    // Re-locate the .get() assignment for `name` (the line numbers in
    // the finding may have drifted between detection and apply).
    const assignRe = new RegExp(
      "((?:const|let|var)\\s+" + name + "\\s*=\\s*[^;]*\\.(?:get|findById|findOne|getOne)\\s*\\([\\s\\S]*?\\)\\s*;)"
    );
    const m = assignRe.exec(content);
    if (!m) return null;
    const insertAt = m.index + m[0].length;
    // Indent the inserted guard to match the assignment's line.
    const before = content.slice(0, m.index);
    const lastNewline = before.lastIndexOf("\n");
    const lineStart = lastNewline + 1;
    const indent = content.slice(lineStart, m.index).match(/^\s*/)[0];
    // Resource name guess from the variable: `dispute`, `row`, `user`, etc.
    // We use the variable name as the error code lowercased.
    const resource = /^row$|^result$|^r$/i.test(name) ? "resource" : name;
    const guard = `\n${indent}if (!${name}) return res.status(404).json({ ok: false, error: "${resource}_not_found" });`;
    return content.slice(0, insertAt) + guard + content.slice(insertAt);
  },

  describe(finding) {
    const name = finding?.subject?.variable || "<row>";
    return `Insert 'if (!${name}) return 404' guard between the query and its first property access.`;
  },
};
