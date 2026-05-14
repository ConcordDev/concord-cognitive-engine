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
    // Anchor on the OCCURRENCE the finding actually reported. Codex P2:
    // a route file can have several `const row = ...get(...)` statements;
    // matching the first one by name could insert the guard into an
    // unrelated handler and leave the real unsafe access unfixed.
    //
    // finding.location is "file:line" — we use that line to pick the
    // assignment that starts at (or nearest at-or-after) the reported
    // line, instead of the first global match.
    const reportedLine = (() => {
      const loc = String(finding?.location || "");
      const n = Number(loc.split(":").pop());
      return Number.isFinite(n) && n > 0 ? n : null;
    })();
    const assignRe = new RegExp(
      "((?:const|let|var)\\s+" + name + "\\s*=\\s*[^;]*\\.(?:get|findById|findOne|getOne)\\s*\\([\\s\\S]*?\\)\\s*;)",
      "g"
    );
    let m = null;
    if (reportedLine != null) {
      // Walk all matches; keep the one whose start-line is the reported
      // line (exact) or, failing an exact hit, the closest one at-or-after.
      let best = null;
      let bestDelta = Infinity;
      let mm;
      while ((mm = assignRe.exec(content)) !== null) {
        const startLine = content.slice(0, mm.index).split("\n").length;
        const delta = startLine - reportedLine;
        if (delta === 0) { best = mm; break; }
        // Prefer the closest match within ±3 lines (detection-vs-apply drift).
        if (delta >= -3 && delta <= 3 && Math.abs(delta) < bestDelta) {
          best = mm;
          bestDelta = Math.abs(delta);
        }
      }
      m = best;
    }
    // Fallback: no line info or no near-match — use the first by-name.
    if (!m) {
      assignRe.lastIndex = 0;
      m = assignRe.exec(content);
    }
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
