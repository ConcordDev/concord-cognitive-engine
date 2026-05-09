// server/lib/autofix/unused-import.js
//
// Auto-fix: remove `import { X } from "…"` when the named symbol has zero
// references in the rest of the module body. Idempotent. Skips
// side-effect-only imports (`import "./foo"`) and default imports.
//
// AST-free for portability — uses a tight regex to identify import
// statements and a word-boundary scan to confirm zero references.

const NAMED_IMPORT_RE = /^import\s*\{\s*([^}]+)\s*\}\s*from\s*['"`][^'"`]+['"`];?\s*$/gm;

export const unusedImportFix = {
  id: "unused_import_removal",
  label: "Remove imports whose named bindings are never referenced",
  riskTier: "low",
  matchFinding(f) {
    return f?.id === "import_unused" || f?.fixHint === "unused_import_removal";
  },
  isApplicable(_filePath, content, _f) { return /^import\s*\{/m.test(content); },
  apply(content) {
    let changed = false;
    NAMED_IMPORT_RE.lastIndex = 0;
    const next = content.replace(NAMED_IMPORT_RE, (match, names) => {
      // Each named binding (potentially with `as` rename)
      const bindings = names.split(",").map(n => n.trim()).filter(Boolean);
      const surviving = bindings.filter(b => {
        const usedAs = b.includes(" as ") ? b.split(" as ")[1].trim() : b.trim();
        // Reference search outside this import statement.
        const restOfFile = content.replace(match, "");
        const re = new RegExp(`\\b${usedAs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        return re.test(restOfFile);
      });
      if (surviving.length === bindings.length) return match;
      changed = true;
      if (surviving.length === 0) return ""; // remove entire line
      // Reassemble import with surviving bindings only
      return match.replace(`{ ${names} }`, `{ ${surviving.join(", ")} }`)
                  .replace(`{${names}}`, `{ ${surviving.join(", ")} }`);
    });
    if (!changed) return null;
    return next;
  },
  describe(_f) { return "Drop named imports whose bindings are never referenced"; },
};
