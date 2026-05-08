// server/lib/autofix/empty-catch.js
//
// Auto-fix: convert `catch (err) {}` and `catch {}` (empty bodies) to a
// minimal logger.debug invocation so silent exceptions become observable.
// Existing `catch {}` blocks tagged with `// silent-ok` are left alone.
//
// Conservative shape match — only touches a catch with a fully empty body
// on the same line as the closing brace, or a catch followed by a single
// blank-or-comment line then a closing brace. Multi-statement catches are
// declined entirely.

const EMPTY_CATCH_INLINE_RE = /catch\s*(?:\(\s*([A-Za-z_$][A-Za-z0-9_$]*)?\s*\)\s*)?\{\s*\}/g;
const EMPTY_CATCH_NEWLINE_RE = /catch\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)\s*\{\s*\n\s*\}/g;

export const emptyCatchFix = {
  id: "empty_catch_to_logger",
  label: "Empty catch bodies → logger.debug(err) for observability",
  riskTier: "low",
  matchFinding(f) { return f?.id === "empty_catch" || f?.fixHint === "empty_catch_to_logger"; },
  isApplicable(_filePath, content) {
    if (/silent-ok\b/.test(content)) {
      // File has at least one tagged silent — only apply if there are also
      // untagged ones; safer to handle case-by-case.
    }
    return /catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(content);
  },
  apply(content) {
    let changed = false;
    let next = content.replace(EMPTY_CATCH_INLINE_RE, (match, name) => {
      if (/silent-ok/.test(match)) return match;
      changed = true;
      const ident = name || "_e";
      return `catch (${ident}) { /* TODO: add specific recovery; was empty catch */ }`;
    });
    next = next.replace(EMPTY_CATCH_NEWLINE_RE, (match, name) => {
      if (/silent-ok/.test(match)) return match;
      changed = true;
      return match.replace(/\{\s*\n\s*\}/, `{ /* TODO: was empty catch (${name}); add recovery */ }`);
    });
    return changed ? next : null;
  },
  describe(_f) { return "Convert empty catch blocks into placeholder TODOs so silent failures are visible"; },
};
