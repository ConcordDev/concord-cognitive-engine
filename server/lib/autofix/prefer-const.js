// server/lib/autofix/prefer-const.js
//
// Auto-fix: `let x = …` where x is never reassigned in the rest of the file
// → `const x = …`. AST-free heuristic, conservative.
//
// Conditions to apply:
//   - declaration line matches `^<indent>let <ident> = ...;?$`
//   - <ident> is never followed by `=` (assignment) elsewhere in the file
//   - <ident> is not used as a `for (let x of …)` or `for (let x in …)` loop binder
//   - file does not contain a destructuring `let { … } = …` containing the ident
//
// We deliberately decline destructuring forms `let { a, b } = …` to avoid
// surprises with whether one of the named bindings is reassigned.

const LET_DECL_RE = /^(\s*)let\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=([^;\n]+);?(?=\s*$)/gm;

export const preferConstFix = {
  id: "prefer_const",
  label: "let → const when the binding is never reassigned",
  riskTier: "low",
  matchFinding(f) { return f?.id === "let_never_reassigned" || f?.fixHint === "prefer_const"; },
  isApplicable(_filePath, content) { return /^\s*let\s+\w+\s*=/m.test(content); },
  apply(content) {
    let changed = false;
    const next = content.replace(LET_DECL_RE, (match, indent, ident, rhs) => {
      // Word-boundary scan for any `<ident> =` (assignment, not equality)
      // anywhere else in the file.
      const reassignRe = new RegExp(`\\b${ident}\\s*(?:=[^=]|\\+\\+|--|[+\\-*/%&|^]?=[^=])`, "g");
      let count = 0;
      let m;
      reassignRe.lastIndex = 0;
      while ((m = reassignRe.exec(content)) != null) {
        // Skip the declaration itself (the original match)
        const idx = m.index;
        if (idx >= content.indexOf(match) && idx < content.indexOf(match) + match.length) continue;
        count++;
        if (count > 0) break;
      }
      if (count > 0) return match;
      // Skip when the ident appears as a loop binder
      if (new RegExp(`for\\s*\\(\\s*let\\s+${ident}\\s+(?:of|in)\\b`).test(content)) return match;
      changed = true;
      return `${indent}const ${ident} =${rhs};`;
    });
    return changed ? next : null;
  },
  describe(_f) { return "Convert `let` declarations that are never reassigned into `const`"; },
};
