// server/lib/detectors/lens-decorative-state-detector.js
//
// Flags lens pages that have UI controls whose state is never read —
// "decorative non-functional UI". A button calls setState, the user thinks
// it worked, but no render branch ever consults the value.
//
// This bug class drew real blood: shipped on `agents`, `board`, `code-quality`,
// `fork`, and `law` lenses before being caught by manual audit.
//
// Five rules, in order of severity:
//
//   1. lens_discarded_state (critical)
//      const [, setX] = useState(...)   — the value side is `,`-discarded,
//      so it's structurally impossible to read it.
//
//   2. lens_decorative_state (high)
//      const [x, setX] = useState(...) where setX(...) is called from a
//      handler but x is never referenced elsewhere.
//
//   3. lens_view_mode_unbranched (high)
//      A state variable typed as a literal-union (e.g. 'a' | 'b' | 'c') has
//      setters bound to multiple values, but the JSX has fewer than 2
//      distinct equality comparisons against those literals.
//
//   4. lens_dead_filter (high)
//      A state variable is read inside a useMemo callback that calls
//      .filter() / .sort(), but the variable is missing from the memo's
//      deps array. The filter never re-runs when the user changes the
//      control.
//
//   5. lens_empty_handler (low)
//      onClick={() => {}} or similar empty arrow on a non-stub element.
//
// Operator escape hatch: place `// @decorative-ok: <reason>` on the line
// directly above a flagged useState declaration to suppress findings for
// that state. See `_framework.js#decorativeOkExempt`.

import path from "node:path";
import { readdir } from "node:fs/promises";
import {
  walk, readSafe, makeReport, makeError, lineOf, relPath, snippet,
  decorativeOkExempt,
} from "./_framework.js";

// ── Regexes ────────────────────────────────────────────────────────────────

// const [name, setName] = useState(...)  /  const [, setName] = useState(...)
// const [name, setName] = useState<T>(...)
// Captures: [1] var (may be empty for discarded), [2] setter, [3] type
//           annotation (may be undefined if no <T> generic was used).
//
// The type annotation must terminate at `(` so we don't accidentally pick up
// the NEXT useState's annotation when this declaration has none.
const USE_STATE_RE = /\bconst\s*\[\s*([a-zA-Z_]\w*)?\s*,\s*(set[A-Z]\w*)\s*\]\s*=\s*useState(?:\s*<\s*([^>]+?)\s*>)?\s*\(/g;

// useMemo(() => { ... return arr.filter(...).sort(...) ... }, [deps])
// Match the body and the deps array separately so we can compare.
const USE_MEMO_RE = /useMemo\s*\(\s*\(\s*\)\s*=>\s*\{?([\s\S]*?)\}?\s*,\s*\[([^\]]*)\]\s*\)/g;

// Empty arrow on event handlers. Allow whitespace inside the braces.
// Must be on a real interactive prop — narrow to onClick/onSubmit/onChange.
const EMPTY_HANDLER_RE = /\bon(?:Click|Submit|Change|KeyDown|MouseDown|Press)\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/g;

// JSX literal-equality `xxx === 'literal'` or `xxx === "literal"`
function literalEqualitiesFor(content, varName) {
  // Match: varName === 'foo' OR 'foo' === varName, single or double quotes.
  // We only care about the `===` operator; loose `==` is unusual in TS code.
  const re = new RegExp(
    `\\b${varName}\\s*===\\s*['"\`]([^'"\`]+)['"\`]|['"\`]([^'"\`]+)['"\`]\\s*===\\s*\\b${varName}\\b`,
    "g",
  );
  const literals = new Set();
  let m;
  while ((m = re.exec(content)) != null) {
    literals.add(m[1] || m[2]);
  }
  return literals;
}

// Heuristic: variables read this many times or more are assumed to be
// consumed correctly via function calls / derived state, even if not all
// literal-equality branches exist. Tunes the false-positive rate of rule 3.
const HEAVY_USE_THRESHOLD = 10;

// Setter call sites: `setX(` — count ignoring the destructure declaration.
function setterCallCount(content, setter) {
  const re = new RegExp(`\\b${setter}\\s*\\(`, "g");
  return (content.match(re) || []).length;
}

// Variable read sites: `\bvar\b` outside the setter calls and the destructure
// declaration. Counts each appearance.
function variableReadCount(content, varName, setter) {
  // First mask out the destructure declaration so we don't count it as a read.
  let masked = content.replace(USE_STATE_RE, "/*USE_STATE*/");
  // Then mask out setter call sites — `varName` doesn't appear in the call,
  // but be defensive: also strip strings that contain the var (a heuristic
  // to avoid counting a JSX placeholder string as a read).
  masked = masked.replace(new RegExp(`\\b${setter}\\s*\\([^)]*\\)`, "g"), "/*SETTER_CALL*/");

  // Count word-boundary matches of varName.
  const re = new RegExp(`\\b${varName}\\b`, "g");
  return (masked.match(re) || []).length;
}

// Resolve a captured useState<T> type annotation to the set of literal-union
// values it represents (or null if it isn't a literal union). Handles two
// shapes:
//   useState<'a' | 'b' | 'c'>     — inline literal union
//   useState<MyType>              — type alias resolved against the file
function resolveTypeLiterals(content, typeBlob) {
  if (!typeBlob) return null;
  const ident = typeBlob.trim();
  // Single PascalCase identifier → look up the type alias in the file.
  if (/^[A-Z]\w*$/.test(ident)) {
    const aliasRe = new RegExp(`\\btype\\s+${ident}\\s*=\\s*([^;\\n]+)`);
    const a = content.match(aliasRe);
    if (a) return parseLiteralUnion(a[1]);
    return null;
  }
  return parseLiteralUnion(typeBlob);
}

function parseLiteralUnion(blob) {
  const re = /['"`]([^'"`]+)['"`]/g;
  const literals = new Set();
  let m;
  while ((m = re.exec(blob)) != null) literals.add(m[1]);
  return literals.size > 0 ? literals : null;
}

// Heuristic: is this state name shaped like a "view mode" (a discrete UI
// branch toggle)? View modes get separate JSX render branches; filters /
// sorts / searches don't, even when typed as literal-unions.
//
// Match common view-mode naming conventions: viewMode / activeTab /
// activePanel / currentScreen / mode / tab / view.  Exclude obvious filter
// indicators ("filter", "sort", "search", "query", "kind", "type") so that
// `txFilter: 'all' | 'purchase' | …` doesn't get flagged as a missing
// render branch when it's actually a filter sentinel.
function isViewModeName(varName) {
  if (!varName) return false;
  const lower = varName.toLowerCase();
  if (/(?:filter|sort|search|query|status|kind|category|severity|priority|policy)/.test(lower)) {
    return false;
  }
  return /(?:view|mode|tab|panel|screen|page|section)/.test(lower) || lower === "view";
}

// ── The detector ────────────────────────────────────────────────────────────

export async function runLensDecorativeStateDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("lens-decorative-state", "no_root", null, t0);

  try {
    const lensesDir = path.join(root, "concord-frontend", "app", "lenses");

    let lensEntries = [];
    try { lensEntries = await readdir(lensesDir, { withFileTypes: true }); }
    catch { return makeError("lens-decorative-state", "lenses_dir_missing", null, t0); }

    // Match lens-health-detector skip-rule: Next.js dynamic and route-group dirs.
    const lensDirs = lensEntries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .filter(n => !n.startsWith("[") && !n.startsWith("("));

    const findings = [];

    for (const lensName of lensDirs) {
      const pagePath = path.join(lensesDir, lensName, "page.tsx");
      const content = await readSafe(pagePath);
      if (!content) continue; // empty / missing handled by lens-health-detector

      const lines = content.split("\n");

      // Pre-collect every useState declaration in the file.  Using
      // `matchAll` (returns a fresh iterator) instead of `.exec()` so we
      // never share `lastIndex` state between the multiple passes below.
      const decls = [];
      for (const m of content.matchAll(USE_STATE_RE)) {
        decls.push({
          varName: m[1] || null,
          setter: m[2],
          typeBlob: m[3] || null,
          index: m.index ?? 0,
          declLine: lineOf(content, m.index ?? 0),
        });
      }

      // Pass 1 — useState rule application (1, 2, 3)
      for (const d of decls) {
        const lineAbove = lines[d.declLine - 2] || "";
        if (decorativeOkExempt(lineAbove)) continue;

        // Rule 1: discarded value side
        if (!d.varName) {
          const setCount = setterCallCount(content, d.setter);
          if (setCount >= 1) {
            findings.push({
              id: "lens_discarded_state",
              severity: "critical",
              kind: "static",
              message: `Lens ${lensName}: state value discarded with [, ${d.setter}] but ${d.setter} is called ${setCount}× — handler is a no-op`,
              location: `${relPath(root, pagePath)}:${d.declLine}`,
              evidence: { lens: lensName, setter: d.setter, setterCallSites: setCount },
              fixHint: `Restore the value side: const [stateName, ${d.setter}] = useState(...) and add a render branch consuming it. Or if the value is intentionally write-only, mark with // @decorative-ok above the declaration.`,
            });
          }
          continue;
        }

        // Rule 2: variable never read meaningfully.  Skip variables that
        // start with `_` — TypeScript / ESLint convention for "intentionally
        // unused" identifier.  The author has signalled they know it's
        // not consumed.
        if (d.varName.startsWith("_")) continue;
        const setCount = setterCallCount(content, d.setter);
        const readCount = variableReadCount(content, d.varName, d.setter);
        if (setCount >= 1 && readCount === 0) {
          findings.push({
            id: "lens_decorative_state",
            severity: "high",
            kind: "static",
            message: `Lens ${lensName}: state '${d.varName}' is set ${setCount}× via ${d.setter} but never read — control is decorative`,
            location: `${relPath(root, pagePath)}:${d.declLine}`,
            evidence: { lens: lensName, varName: d.varName, setter: d.setter, setterCallSites: setCount },
            fixHint: `Either consume '${d.varName}' in a render branch / filter, or delete the state and the controls that set it.`,
          });
          continue; // don't double-flag with rule 3
        }

        // Rule 3: literal-union view-mode pattern. Only fires when:
        //   - The variable name semantically suggests view-mode
        //   - It has at least 1 matched render branch (proves SOME
        //     branching) but not all literals (proves the rest is missing)
        //   - The variable's read count is bounded (lots of reads imply
        //     consumption via function calls / derived state, e.g.
        //     `currentType = getTypeForTab(activeMode)` patterns)
        const literals = resolveTypeLiterals(content, d.typeBlob);
        if (literals && literals.size >= 2 && setCount >= 1 && isViewModeName(d.varName) && readCount < HEAVY_USE_THRESHOLD) {
          const equalities = literalEqualitiesFor(content, d.varName);
          const matchedEqualities = new Set([...equalities].filter(l => literals.has(l)));
          if (matchedEqualities.size >= 1 && matchedEqualities.size < literals.size) {
            findings.push({
              id: "lens_view_mode_unbranched",
              severity: "high",
              kind: "static",
              message: `Lens ${lensName}: '${d.varName}' has ${literals.size} possible values but only ${matchedEqualities.size} render branch${matchedEqualities.size === 1 ? "" : "es"} — ${[...literals].filter(l => !matchedEqualities.has(l)).join(", ")} mode never renders`,
              location: `${relPath(root, pagePath)}:${d.declLine}`,
              evidence: {
                lens: lensName,
                varName: d.varName,
                literals: [...literals],
                rendered: [...matchedEqualities],
                missing: [...literals].filter(l => !matchedEqualities.has(l)),
              },
              fixHint: `Add ${literals.size - matchedEqualities.size} missing render branch(es), or remove the unused literal(s) from the type and the controls that set them.`,
            });
          }
        }
      }

      // Rule 4 (lens_dead_filter) is intentionally NOT implemented here:
      // detecting "useMemo reads state X but X isn't in deps" requires AST
      // awareness to distinguish state-variable reads from same-named
      // property accesses (e.g. `fact.subject` shouldn't count as a read of
      // a `subject` state variable).  Regex can't safely make that
      // distinction, and eslint-plugin-react-hooks/exhaustive-deps already
      // does the AST work correctly.  We rely on the lint pass for that
      // check — adding it here would be lossy duplication.

      // Pass 2 — empty event handlers (rule 5)
      for (const mh of content.matchAll(/\bon(?:Click|Submit|Change|KeyDown|MouseDown|Press)\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/g)) {
        const handlerLine = lineOf(content, mh.index ?? 0);
        const above = lines[handlerLine - 2] || "";
        if (decorativeOkExempt(above)) continue;
        findings.push({
          id: "lens_empty_handler",
          severity: "low",
          kind: "static",
          message: `Lens ${lensName}: empty event handler — control fires no action`,
          location: `${relPath(root, pagePath)}:${handlerLine}`,
          evidence: { lens: lensName, snippet: snippet(mh[0], 80) },
          fixHint: `Wire the handler to a real action, or delete the prop / element.`,
        });
      }
    }

    // Summary header for parity with other detectors.
    findings.unshift({
      id: "lens_decorative_state_summary",
      severity: "info",
      kind: "static",
      message: `Scanned ${lensDirs.length} lenses · ${findings.length} decorative-state issue${findings.length === 1 ? "" : "s"} found`,
      evidence: { lensCount: lensDirs.length },
    });

    return makeReport("lens-decorative-state", findings, t0);
  } catch (err) {
    return makeError("lens-decorative-state", "exception", err, t0);
  }
}
