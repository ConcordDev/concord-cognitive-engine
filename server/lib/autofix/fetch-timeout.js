// server/lib/autofix/fetch-timeout.js
//
// Auto-fix: add `{ signal: AbortSignal.timeout(<DEFAULT_TIMEOUT_MS>) }`
// to fetch() / axios() calls that have no timeout. Two shapes:
//
//   1. fetch(url)              →  fetch(url, { signal: AbortSignal.timeout(5000) })
//   2. fetch(url, { method })  →  fetch(url, { method, signal: AbortSignal.timeout(5000) })
//   3. axios(url)              →  axios(url, { timeout: 5000 })
//   4. axios.get(url)          →  axios.get(url, { timeout: 5000 })
//
// We DO NOT touch:
//   - calls that already have a `signal:` / `timeout:` / AbortController
//   - calls to Ollama brain ports (those route through llm-router which
//     manages its own timeout — same exclusion as the detector)
//   - multi-line argument lists with nested closures (risk too high)
//   - files marked `@http-error-ok: timeout`
//
// Risk tier: low. The added timeout is a defensive default; if the
// upstream is healthy the call still succeeds.

const DEFAULT_TIMEOUT_MS = 5000;
const TIMEOUT_HINT_RE = /\b(?:signal\s*:|timeout\s*:|AbortController|AbortSignal\.timeout)/;
const OLLAMA_HOST_RE = /\b(?:1143[4-8]|ollama|brain|llm.router|sd.?url|stable.{0,3}diffusion)\w*/i;
const HTTP_ERROR_OK_RE = /@http-error-ok\b/;

// Capture: function name (1), first arg (2), optional second arg block (3).
// Restricted to single-line forms — the second arg, if present, must be a
// well-formed `{ ... }` object literal with no newlines inside it. This
// keeps risk low; multi-line forms are out of scope.
const FETCH_CALL_LINE_RE = /\b(fetch|axios|axios\.(?:get|post|put|delete|patch|head))\s*\(\s*([^,)]+?)(\s*,\s*\{[^{}\n]*\})?\s*\)/g;

function rewriteOne(line, fn) {
  // First, skip lines that already have a timeout hint.
  if (TIMEOUT_HINT_RE.test(line)) return null;

  let changed = false;
  const out = line.replace(FETCH_CALL_LINE_RE, (full, name, firstArg, secondArg) => {
    if (OLLAMA_HOST_RE.test(firstArg)) return full;
    // Skip lines containing the @http-error-ok marker (operator opt-out).
    if (HTTP_ERROR_OK_RE.test(line)) return full;
    const isAxios = /^axios/.test(name);
    const timeoutFragment = isAxios
      ? `timeout: ${DEFAULT_TIMEOUT_MS}`
      : `signal: AbortSignal.timeout(${DEFAULT_TIMEOUT_MS})`;
    let next;
    if (secondArg) {
      // Inject before the closing `}`. The capture already includes
      // leading `, ` so we splice in the fragment.
      const insertPos = secondArg.lastIndexOf("}");
      if (insertPos < 0) return full;
      const before = secondArg.slice(0, insertPos).trimEnd();
      const trailingComma = before.endsWith(",") || before.endsWith("{") ? "" : ", ";
      next = `${name}(${firstArg}${before}${trailingComma}${timeoutFragment} })`;
    } else {
      next = `${name}(${firstArg}, { ${timeoutFragment} })`;
    }
    changed = true;
    return next;
  });

  return changed ? out : null;
}

export const fetchTimeoutFix = {
  id: "add_fetch_timeout",
  label: "fetch/axios call → add { signal: AbortSignal.timeout(5000) }",
  riskTier: "low",
  matchFinding(f) {
    return f?.id === "external_call_without_timeout";
  },
  isApplicable(filePath, content, _finding) {
    if (HTTP_ERROR_OK_RE.test(content)) return false;
    return FETCH_CALL_LINE_RE.test(content);
  },
  apply(content, finding) {
    // Single-line shape only — fix the exact line in the finding's
    // location. The detector reports `file:line` so we know where to
    // look. Operate per-line so we never accidentally rewrite a
    // different fetch call elsewhere in the file.
    if (!finding?.location) return null;
    const line = Number((finding.location.split(":")[1] || "").trim());
    if (!Number.isFinite(line) || line < 1) return null;

    const lines = content.split("\n");
    if (line > lines.length) return null;
    const replacement = rewriteOne(lines[line - 1], "fetch");
    if (replacement == null) return null;
    lines[line - 1] = replacement;
    return lines.join("\n");
  },
  describe(_f) {
    return `Add { signal: AbortSignal.timeout(${DEFAULT_TIMEOUT_MS}) } to external fetch/axios call`;
  },
};
