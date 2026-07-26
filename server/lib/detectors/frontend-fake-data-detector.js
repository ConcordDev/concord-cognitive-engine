// server/lib/detectors/frontend-fake-data-detector.js
//
// Frontend-specific fake-data detector. Complements the repo-wide
// `fake-data-detector.js` (NAME-based: mock/fake/stub identifiers, TODO
// markers) and `fabrication-mechanism-detector.js` (MECHANISM-based:
// Math.random() -> metric-shaped field -> render/API, one-hop taint
// tracking) with a THIRD, narrower lens scoped to lens pages + components:
// hardcoded literal content that is rendered as if it were live substrate
// data, with no real fetch path anywhere in the enclosing component.
//
// Three independent rules, each scanning only
// `concord-frontend/app/lenses/**/*.tsx` and
// `concord-frontend/components/**/*.tsx` (this repo's honest-by-construction
// invariant is a frontend-rendering concern first — the backend equivalent
// is already covered by fake-data-detector.js's exported-mock-identifier
// rule):
//
//   1. hardcoded_array_rendered_as_live_data (high)
//      `const episodes = [{ title: 'Sample Episode', ... }, ...]` — a
//      local array-of-objects literal that is later iterated with
//      `.map(` (or interpolated directly) in the component's JSX, where
//      the enclosing component body contains NO data-fetching call
//      (useLensData/useLensDTUs/useQuery/useSWR/lensRun/fetch/api.*/
//      apiHelpers.*). This is the deferred-wiring smell named in the task
//      brief verbatim — a literal masquerading as substrate.
//
//   2. math_random_in_render (medium)
//      `Math.random()` appearing directly inside a JSX expression
//      container — either as JSX child text (`{Math.random() > 0.5 ? …}`)
//      or as a JSX attribute value (`width={\`${Math.random()*100}%\`}`)
//      — i.e. synthesizing a value the user actually sees, not a
//      client-side id/key/animation-jitter helper. Deliberately narrower
//      than fabrication-mechanism-detector's assignment-taint rule: this
//      one fires on the call site being INSIDE the JSX itself, a stronger
//      and more localized signal, so the two rules are complementary
//      rather than duplicative.
//
//   3. placeholder_content_in_jsx (medium/info)
//      Lorem-ipsum / "sample data" / "example data" / dummy / fake / mock
//      / TODO strings that sit inside a rendered string literal (JSX
//      attribute value, JSX text node, or an object-literal field that
//      flows into JSX) — content dressed up as real copy. Strong
//      compound phrases ("lorem ipsum", "sample text", "example data")
//      are medium; bare single words (dummy/fake/mock/placeholder/TODO)
//      inside a quoted string are info — same low-confidence tier the
//      sibling fake-data-detector uses for its "suspicious string"
//      finding, since a single word alone is common in legitimate prose
//      too ("mock combat", "the fake ID he used" as narrative content,
//      etc).
//
// Escape hatch, matching the sibling detectors' convention:
//   `// detector-allow: frontend-fake-data <reason>` on the flagged line
//   or up to 4 lines above suppresses that one finding.
//   `// @frontend-fake-data-ok-file` anywhere in the file suppresses the
//   whole file (for demo/showcase lenses that are explicitly not
//   substrate-backed by design, e.g. a style-guide page).

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";

const CATEGORY = "frontend-fake-data";

const SCAN_DIRS = [
  "concord-frontend/app/lenses",
  "concord-frontend/components",
];

const SKIP_FILES = [
  /\.(?:test|spec|stories)\.(?:tsx|jsx)$/,
  /\/(?:__tests__|__mocks__|__fixtures__|storybook)\//,
  /\.d\.ts$/,
];

const FILE_ALLOW_RE = /@frontend-fake-data-ok-file\b/;
const LINE_ALLOW_RE = /detector-allow:\s*frontend-fake-data\b/;

function isInScope(rel) {
  if (!SCAN_DIRS.some((p) => rel.startsWith(p + "/"))) return false;
  if (SKIP_FILES.some((re) => re.test(rel))) return false;
  return true;
}

function hasAllowAnnotation(lines, lineIdx) {
  for (let j = Math.max(0, lineIdx - 4); j <= lineIdx; j++) {
    if (LINE_ALLOW_RE.test(lines[j] || "")) return true;
  }
  return false;
}

// ── Shared bracket-balanced helpers (same shape as the sibling detectors —
// this is a regex-based heuristic scanner, not an AST; see file header). ──

function findMatchingBrace(content, openIdx, limit = 20000) {
  let depth = 1;
  let i = openIdx + 1;
  let inStr = null;
  const cap = Math.min(content.length, openIdx + limit);
  while (i < cap) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return i; }
    i++;
  }
  return cap;
}

function findMatchingBracket(content, openIdx, limit = 20000) {
  let depth = 1;
  let i = openIdx + 1;
  let inStr = null;
  const cap = Math.min(content.length, openIdx + limit);
  while (i < cap) {
    const ch = content[i];
    if (inStr) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; i++; continue; }
    if (ch === "[") depth++;
    else if (ch === "]") { depth--; if (depth === 0) return i; }
    i++;
  }
  return cap;
}

// ── Rule 1: hardcoded array-of-objects rendered as live data ────────────

const FETCH_HOOK_RE = new RegExp(
  [
    "\\buseLensData\\b", "\\buseLensDTUs\\b", "\\buseLensQuery\\b",
    "\\buseLensBridge\\b", "\\buseQuery\\s*\\(", "\\buseSWR\\s*\\(",
    "\\buseFetch\\b", "\\buseApiQuery\\b", "\\blensRun\\s*\\(",
    "\\bapi\\.\\w+\\s*\\(", "\\bapiHelpers\\.\\w+\\s*\\(",
    "\\bfetch\\s*\\(", "\\baxios\\.\\w+\\s*\\(",
  ].join("|"),
);

// Top-level `const IDENT = [` or `const IDENT: Type[] = [` — the array
// itself is bracket-matched from the `[` that follows.
const ARRAY_DECL_RE = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=\n]+)?=\s*\[/g;

// Component/function opening shapes, used to find the nearest ENCLOSING
// scope of a declaration (for "no fetch hook nearby" = nearby its own
// component, not merely somewhere else in a large file).
const FUNC_OPEN_RE = /(?:^|\n)[ \t]*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::[^{]+)?\{|(?:^|\n)[ \t]*(?:export\s+(?:default\s+)?)?const\s+[A-Za-z_$][\w$]*\s*(?::[^=\n]+)?=\s*(?:React\.)?(?:memo\s*\(\s*)?(?:async\s*)?\([^)]*\)\s*(?::[^{=]+)?=>\s*\{/g;

/** Returns { start, end } text span of the nearest enclosing function body
 * that opens BEFORE declIndex and whose matching close brace is AFTER
 * declIndex — or null if none found (caller falls back to whole file). */
function enclosingFunctionBody(content, declIndex) {
  FUNC_OPEN_RE.lastIndex = 0;
  let m;
  let best = null;
  while ((m = FUNC_OPEN_RE.exec(content)) != null) {
    // Both alternatives of FUNC_OPEN_RE end with a literal `{`, so the
    // last character of the match IS the opening brace.
    const openBraceIdx = m.index + m[0].length - 1;
    if (openBraceIdx < 0 || openBraceIdx >= declIndex) continue;
    const closeBraceIdx = findMatchingBrace(content, openBraceIdx);
    if (closeBraceIdx > declIndex) {
      // Prefer the closest (innermost) enclosing scope — the one whose
      // open brace is nearest to declIndex among valid candidates.
      if (!best || openBraceIdx > best.openBraceIdx) {
        best = { openBraceIdx, closeBraceIdx };
      }
    }
  }
  if (!best) return null;
  return { start: best.openBraceIdx, end: best.closeBraceIdx };
}

// Structural/config field names — the vocabulary of UI-nav / toolbar /
// settings arrays (`TABS`, `tools`, `SECTIONS` navigation, dashboard
// widget config), which are legitimate hardcoded authored UI structure,
// NOT data pretending to be live substrate. An array whose keys are
// ENTIRELY drawn from this set is skipped outright regardless of size.
const STRUCTURAL_KEY_WORDS = new Set([
  "id", "key", "label", "icon", "href", "path", "disabled", "active",
  "tab", "view", "mode", "color", "accent", "unit", "current", "target",
  "enabled", "value", "shortcut", "hotkey", "order", "index",
  // Moved from CONTENT_KEY_WORDS (2026-07 precision pass — see the note on
  // CONTENT_KEY_WORDS below). A full manual classification of every finding
  // this rule produced against the real tree found `title`/`name`/`desc`/
  // `description`/`code` are overwhelmingly identity/presentation fields on
  // navigation-destination and settings-option arrays (TABS, DESTINATIONS,
  // GROUPS, COUNTRIES, LOCALE_INFO, QUALITY_OPTIONS, SCOPE_OPTIONS, …) — a
  // hardcoded tab strip's `label`/`desc` is the component's own structure,
  // not data pretending to be live. The one confirmed true positive
  // (DTUDiffViewer's fabricated `VERSIONS`) still fires because it also
  // carries `author`/`date` (below) — genuinely person-like / timestamp
  // fields that no legitimate nav-config array needs.
  "title", "name", "desc", "description", "code",
]);

// Content field names — the vocabulary that suggests a row of authored
// or fetched CONTENT (an article, episode, product, review, …) rather
// than UI chrome. Presence of one of these is the positive signal that
// promotes a finding from "advisory" to "likely fake content". Narrowed
// (2026-07 precision pass) to fields that carry OBSERVATIONS ABOUT THE
// WORLD — person-like names, dates/timestamps, measurements, statuses,
// ratings — rather than identity/presentation fields. `title`/`name`/
// `desc`/`description`/`code` moved to STRUCTURAL_KEY_WORDS above; as a
// group they were the single largest false-positive source in this rule
// (config/nav arrays vastly outnumber genuinely fabricated content rows
// in this codebase).
const CONTENT_KEY_WORDS = new Set([
  "summary", "body", "content",
  "author", "episode", "post", "article", "review", "comment", "price",
  "rating", "date", "thumbnail", "image", "avatar", "email", "bio",
  "quote", "message", "excerpt", "synopsis", "username", "handle",
]);

// Count top-level `{` object literals inside an array-literal body, the
// widest field count seen on any one object, and the set of distinct
// property key names used across all objects (lower-cased, quotes
// stripped).
function extractArrayShape(arrayBody) {
  let depth = 0;
  let inStr = null;
  let objectCount = 0;
  let bestPropCount = 0;
  let curPropCount = 0;
  const keys = new Set();
  for (let i = 0; i < arrayBody.length; i++) {
    const ch = arrayBody[i];
    if (inStr) {
      if (ch === "\\") { i++; continue; }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; continue; }
    if (ch === "{") {
      depth++;
      if (depth === 1) { objectCount++; curPropCount = 0; }
      continue;
    }
    if (ch === "}") {
      if (depth === 1) bestPropCount = Math.max(bestPropCount, curPropCount);
      depth--;
      continue;
    }
    // A `key:` at depth 1 inside an object literal is a property.
    if (depth === 1 && ch === ":") {
      // Look back for an identifier/string key immediately before this colon
      // (skip whitespace) — cheap heuristic, good enough given the object
      // must ALSO be inside an array (so this isn't a ternary `?:`).
      let j = i - 1;
      while (j >= 0 && /\s/.test(arrayBody[j])) j--;
      let k = j;
      while (k >= 0 && /[\w$]/.test(arrayBody[k])) k--;
      const keyRaw = arrayBody.slice(k + 1, j + 1).replace(/['"`]/g, "");
      if (keyRaw) {
        curPropCount++;
        keys.add(keyRaw.toLowerCase());
      }
    }
  }
  return { objectCount, bestPropCount, keys };
}

/** All quoted-string VALUES (not identifiers/key names) inside `text`. */
function extractStringLiterals(text) {
  const out = [];
  const re = /(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;
  let mm;
  while ((mm = re.exec(text)) != null) out.push(mm[2]);
  return out;
}

// A top-level `...identifier` / `...(expr)` spread inside the array body —
// as opposed to `...[literal]` or `...{literal}` — is strong evidence the
// array is being BUILT FROM external/live data (a fetched prop, other
// component state, form-input values) rather than being a self-contained
// hardcoded literal. Real false positives found this way in the real tree:
// `VehicleHistory.tsx`'s `events = [...recalls.map(...), ...(schedule?.
// services || []).filter(...).map(...)]` (spreads two already-fetched,
// already-mapped arrays) and `ObservePlatform.tsx`'s `routes = [...(status?.
// routes || []), { name: routeName.trim() || channel, ... }]` (spreads a
// live status field and appends a row built from React state/form input,
// not fabricated literal values). Deliberately loose (no bracket-depth
// tracking) — a real fake-content array spreading a hardcoded default
// object (`{ ...DEFAULTS, title: 'Sample Episode' }`) would also be
// exempted by this check, an accepted precision/recall trade-off.
const EXTERNAL_SPREAD_RE = /\.\.\.\s*(?:\(|[A-Za-z_$])/;
function hasExternalSpread(arrayBody) {
  return EXTERNAL_SPREAD_RE.test(arrayBody);
}

/**
 * Is `ident` actually rendered as data — `.map()`'d, or bare-interpolated
 * as JSX content (`{ident}`) — anywhere after `fromIdx`?
 *
 * The bare-interpolation check excludes the identifier appearing as an
 * object-literal SHORTHAND PROPERTY in a function-call argument
 * (`lensRun('x', 'y', { ident })`) — real false positive found in
 * `PlanningTools.tsx`: `participants` was built from live component state
 * and passed as a `{ participants }` payload to `lensRun(...)`, which the
 * old regex `\{\s*ident\s*\}` misread as JSX interpolation because it
 * doesn't distinguish "used as a call argument" from "rendered in JSX".
 */
function isRenderedAsData(content, ident, fromIdx) {
  const mapRe = new RegExp(`\\b${ident}\\s*\\.map\\s*\\(`);
  if (mapRe.test(content.slice(fromIdx))) return true;

  const braceRe = new RegExp(`\\{\\s*${ident}\\s*\\}`, "g");
  const rest = content.slice(fromIdx);
  let bm;
  while ((bm = braceRe.exec(rest)) != null) {
    const absIdx = fromIdx + bm.index;
    let p = absIdx - 1;
    while (p >= 0 && /\s/.test(content[p])) p--;
    const before = content[p] || "";
    // `(` — function-call argument; `,` — another arg/property in the same
    // call or object literal. Neither is JSX interpolation.
    if (before === "(" || before === ",") continue;
    return true;
  }
  return false;
}

function checkHardcodedArrayRenderedAsData(rel, content, rawLines, findings) {
  ARRAY_DECL_RE.lastIndex = 0;
  let m;
  while ((m = ARRAY_DECL_RE.exec(content)) != null) {
    if (findings.length > 5000) break; // safety net only — real cap is opts.findingCap, enforced between rule calls
    const ident = m[1];
    const arrOpenIdx = m.index + m[0].length - 1; // index of the `[`
    const arrCloseIdx = findMatchingBracket(content, arrOpenIdx);
    const arrayBody = content.slice(arrOpenIdx + 1, arrCloseIdx);

    // A top-level spread of external/live data (`...recalls.map(...)`,
    // `...(status?.routes || [])`) means this "literal" is actually built
    // from a fetch/prop/state source elsewhere — not hardcoded fake content.
    if (hasExternalSpread(arrayBody)) continue;

    const { objectCount, bestPropCount, keys } = extractArrayShape(arrayBody);
    // Require at least 1 object literal with 2+ fields, OR 2+ object
    // literals of any size — a single-field array is much more likely to
    // be a real constant (e.g. enum options) than fabricated content rows.
    const looksLikeData = (objectCount >= 1 && bestPropCount >= 2) || objectCount >= 2;
    if (!looksLikeData) continue;

    // Skip arrays whose fields are ENTIRELY structural/UI-chrome vocabulary
    // (TABS, toolbar buttons, nav sections, settings toggles) — these are
    // legitimate authored UI structure, not content pretending to be data.
    if (keys.size > 0 && [...keys].every((k) => STRUCTURAL_KEY_WORDS.has(k))) continue;

    const hasContentKey = [...keys].some((k) => CONTENT_KEY_WORDS.has(k));
    // Test placeholder/lorem/sample terms against string-literal VALUES
    // only — NOT the raw array-body text, which would also match a
    // property KEY named e.g. `placeholder:` (a legitimate field name on
    // a markdown-toolbar "insert this placeholder text" config) and
    // false-positive on it.
    const stringValues = extractStringLiterals(arrayBody);
    const hasPlaceholderTerm = stringValues.some((s) => STRONG_TERMS_RE.test(s) || WEAK_TERMS_RE.test(s));
    // Require a positive content signal — either a content-shaped field
    // name (title/description/author/…) or an actual placeholder/lorem/
    // sample term inside the literal itself. Without either, this is more
    // likely a legitimate constant (color palette, numeric lookup table,
    // icon-keyed config) than fabricated content.
    if (!hasContentKey && !hasPlaceholderTerm) continue;

    // Must actually be rendered: `.map(` call on the identifier, or a
    // direct `{ident}` interpolation (NOT a function-call argument's
    // shorthand property), somewhere after the declaration.
    if (!isRenderedAsData(content, ident, arrCloseIdx)) continue;

    const lineNum = lineOf(content, m.index);
    if (hasAllowAnnotation(rawLines, lineNum - 1)) continue;

    // Scope: nearest enclosing component/function body, falling back to
    // the whole file if none is found (e.g. module-scope constant used by
    // several components — still worth flagging if nothing in the file
    // fetches).
    const scope = enclosingFunctionBody(content, m.index);
    const scopeText = scope ? content.slice(scope.start, scope.end) : content;
    if (FETCH_HOOK_RE.test(scopeText)) continue;

    findings.push({
      id: "hardcoded_array_rendered_as_live_data",
      // "high" only when a placeholder/lorem/sample term is ALSO present
      // (the worked `episodes = [{title: 'Sample Episode'}]` example) —
      // a content-shaped key with no placeholder term is real-but-static
      // content until proven otherwise, so it's "medium" advisory.
      severity: hasPlaceholderTerm ? "high" : "medium",
      kind: "static",
      category: CATEGORY,
      subject: { kind: "file", path: rel, identifier: ident },
      message: `'${ident}' is a hardcoded array literal (${objectCount} object(s), up to ${bestPropCount} fields) rendered via .map()/interpolation with no data-fetching call (useLensData/useLensDTUs/useQuery/useSWR/lensRun/fetch/api.*) in its enclosing scope`,
      location: `${rel}:${lineNum}`,
      evidence: { identifier: ident, objectCount, bestPropCount, scoped: !!scope, hasContentKey, hasPlaceholderTerm },
      fixHint: "Fetch this data via a real hook (useLensData/useLensDTUs/lensRun) or, if intentionally static reference data, rename away from a data-sounding identifier and document why no backend call is needed.",
    });
  }
}

// ── Rule 2: Math.random() synthesizing a value inside JSX ───────────────

const RANDOM_CALL_RE = /Math\.random\s*\(\s*\)/g;
// Word-boundary exclusions: legitimate uses named as such nearby (ids,
// timing/entropy, decorative motion, physics/graph/particle geometry,
// disclosed simulations).
const EXCLUDE_CONTEXT_RE = /\b(key|id|uid|jitter|nonce|seed|salt|delay|duration|transition|animation|particle|confetti|sparkle|decorat\w*|simulation|layout|geometry|position|velocity|radius|angle|offset|coordinate|palette|color|colour)\b/i;
// Substring (no word-boundary) exclusions for camelCase identifiers where
// \b can't fire inside the identifier (`generateUUID`, `makeGuid`).
const EXCLUDE_SUBSTR_RE = /uuid|guid/i;
// `array[Math.floor(Math.random() * array.length)]` — selecting a random
// element from an EXISTING real array/list is not fabrication; the value
// shown is real content, just randomly chosen (a "shuffle a real prompt
// list" or "pick a random real palette color" pattern).
const RANDOM_ARRAY_PICK_RE = /\[\s*Math\.floor\s*\(\s*Math\.random\(\)\s*\*\s*[\w.$]+\.length\s*\)\s*\]/;
// Lens directories where randomness is disclosed simulation/game/physics
// mechanics, not a stand-in for a real measurement — same rationale as
// fabrication-mechanism-detector's ALLOWLIST_PATH_RES, scoped to the
// lens directories that are explicitly simulators.
const SIM_LENS_PATH_RE = /\/app\/lenses\/(?:sim|physics|game)\//i;

function checkMathRandomInJsx(rel, content, rawLines, findings) {
  if (SIM_LENS_PATH_RE.test(rel)) return;
  RANDOM_CALL_RE.lastIndex = 0;
  let m;
  while ((m = RANDOM_CALL_RE.exec(content)) != null) {
    if (findings.length > 5000) break; // safety net only — real cap is opts.findingCap, enforced between rule calls
    const idx = m.index;

    // Walk backward to find the innermost unmatched `{` before this call —
    // i.e. the JSX expression container (or object-literal) this call sits
    // inside, at the CURRENT nesting depth (not one it opened itself).
    let depth = 0;
    let braceIdx = -1;
    for (let i = idx - 1; i >= 0 && idx - i < 4000; i--) {
      const ch = content[i];
      if (ch === "}") { depth++; continue; }
      if (ch === "{") {
        // A template-literal interpolation opener (`${`) is TRANSPARENT
        // for this walk — `style={{ width: \`${Math.random()*100}%\` }}`
        // must resolve to the outer JSX/style-object brace, not stop at
        // the interpolation boundary. Skip past the `$` and keep walking
        // backward through the enclosing literal.
        if (content[i - 1] === "$") { i--; continue; }
        if (depth === 0) { braceIdx = i; break; }
        depth--;
        continue;
      }
    }
    if (braceIdx < 0) continue;

    // Preceding non-whitespace char before the `{`: `=` (JSX attr or
    // object value), `>` (JSX text-node start), or nothing (start of
    // file/expression) all count as "flows toward render" — but each has
    // a same-shaped FALSE friend that must be told apart:
    //   `=>` arrow-function body opening (`() => { … }`) also ends in
    //   `>`, and a plain `const x = { … }` variable declaration also
    //   ends in `=`. Neither is a JSX boundary.
    let k = braceIdx - 1;
    while (k >= 0 && /\s/.test(content[k])) k--;
    const before = content[k] || "";
    let isJsxLike = before === "{" || before === "\n" || before === "";

    if (before === ">") {
      // JSX tag close (`<div>{`) vs. arrow-function body (`=> {`) vs. a
      // JSX self-closing tag (never has text children, so not relevant
      // here but excluded anyway): only the bare tag-close counts.
      let p = k - 1;
      while (p >= 0 && /\s/.test(content[p])) p--;
      const prevPrev = content[p] || "";
      isJsxLike = prevPrev !== "=" && prevPrev !== "/";
    } else if (before === "=") {
      // JSX attribute assignment (`width={`) vs. a plain variable
      // declaration (`const x = {`): reject when the identifier right
      // before the `=` is itself preceded by a const/let/var keyword.
      // `k` points at the `=` itself — skip the whitespace between it and
      // the identifier BEFORE walking back over the identifier's own
      // characters (a bare `while (/[\w$]/)` starting at k-1 would see
      // the space right after the identifier and never move).
      let p = k - 1;
      while (p >= 0 && /\s/.test(content[p])) p--;
      while (p >= 0 && /[\w$]/.test(content[p])) p--;
      let q = p;
      while (q >= 0 && /\s/.test(content[q])) q--;
      const declWord = content.slice(Math.max(0, q - 5), q + 1);
      isJsxLike = !/\b(?:const|let|var)\s*$/.test(declWord);
    }
    if (!isJsxLike) continue;

    // A wide-ish window: enough to reach the enclosing function/variable
    // NAME (e.g. `function generateUUID() {` several lines above the
    // actual Math.random() call inside its body), not just the same line.
    const winStart = Math.max(0, idx - 350);
    const winEnd = Math.min(content.length, idx + 80);
    const window = content.slice(winStart, winEnd);
    if (EXCLUDE_CONTEXT_RE.test(window) || EXCLUDE_SUBSTR_RE.test(window)) continue;
    if (RANDOM_ARRAY_PICK_RE.test(content.slice(Math.max(0, idx - 10), Math.min(content.length, idx + 200)))) continue;

    const lineNum = lineOf(content, idx);
    if (hasAllowAnnotation(rawLines, lineNum - 1)) continue;

    findings.push({
      id: "math_random_in_render",
      severity: "medium",
      kind: "static",
      category: CATEGORY,
      subject: { kind: "file", path: rel },
      message: "Math.random() called directly inside a JSX expression container — synthesizes a value the user sees, with no real backing measurement",
      location: `${rel}:${lineNum}`,
      evidence: { snippet: snippet((rawLines[lineNum - 1] || "").trim(), 140) },
      fixHint: "Derive the rendered value from real fetched/computed state, or disclose the synthetic nature explicitly in the UI (per CLAUDE.md's honest-by-construction rule).",
    });
  }
}

// ── Rule 3: placeholder / lorem / dummy content rendered as real ────────

const STRONG_TERMS_RE = /\b(lorem ipsum|sample (?:text|data|episode|item|user|post|title|entry|record)|example data|placeholder (?:text|data|content|value)|dummy data|fake data|mock data)\b/i;
// `(?![-:])` guards against Tailwind utility-class prefixes/variants —
// `placeholder-gray-500` (color utility) and `placeholder:text-gray-400`
// (variant-modifier syntax) are both real, extremely common Tailwind
// class idioms that would otherwise dominate every className string in
// this codebase with a false match.
const WEAK_TERMS_RE = /\b(placeholder|dummy|fake|mock|TODO)\b(?![-:])/;
const QUOTED_STR_RE = /(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;
const PLACEHOLDER_ATTR_RE = /\bplaceholder\s*=/; // legit HTML/JSX attribute name
// Combat-training "DUMMY" is a real domain noun in this codebase's world
// lens (a training-dummy entity with HP/loadout), not placeholder data —
// same allowlist rationale as fake-data-detector.js's DOMAIN_TERM_IDENTS.
// Scoped by PATH (sandbox/arena/training/combat directory or filename)
// since content strings don't carry identifier-style naming to check.
const DUMMY_DOMAIN_PATH_RE = /\b(?:sandbox|arena|training|combat)\b/i;

// A negation word BEFORE the matched term, in the same string, means the
// string is DISCLAIMING fake data rather than presenting it — real false
// positive found in `CaseAnalytics.tsx`: an empty-state message reading
// "...analytics runs the real caseAnalysis / deadlineTracker macros over
// your real matters, never sample data." The phrase "sample data" is
// present only to honestly deny it, which is the opposite of the honesty
// violation this rule exists to catch.
const NEGATION_RE = /\b(never|not|isn't|without|instead of)\b/i;

// Identity/presentation key names — when the matched term is the VALUE of
// one of these keys (`label: 'Sample Data'`), it's naming/labeling a UI
// element (e.g. a tab that previews sample data), not fabricated body
// content — real false positive found in `SchemaWorkbench.tsx`'s tab
// config `{ id: 'sample', label: 'Sample Data', icon: Beaker }`. Narrower
// than STRUCTURAL_KEY_WORDS on purpose: `title`/`description` are left
// OUT so a standalone `title="Sample Episode"` (not inside a nav/tab
// array, so Rule 1 never sees it) still gets caught here.
const IDENTITY_KEY_SKIP = new Set(["id", "key", "label", "name", "tab", "value"]);

/** The lowercased `key` immediately before `line[quoteStartIdx]` in `key: '...'` — or null. */
function precedingKeyName(line, quoteStartIdx) {
  let j = quoteStartIdx - 1;
  while (j >= 0 && /\s/.test(line[j])) j--;
  if (line[j] !== ":") return null;
  j--;
  while (j >= 0 && /\s/.test(line[j])) j--;
  let k = j;
  while (k >= 0 && /[\w$]/.test(line[k])) k--;
  const keyRaw = line.slice(k + 1, j + 1).replace(/['"`]/g, "");
  return keyRaw ? keyRaw.toLowerCase() : null;
}

function checkPlaceholderContent(rel, content, rawLines, findings) {
  const isDummyDomainPath = DUMMY_DOMAIN_PATH_RE.test(rel);
  for (let i = 0; i < rawLines.length; i++) {
    if (findings.length > 5000) break; // safety net only — real cap is opts.findingCap, enforced between rule calls
    const line = rawLines[i];
    const trimmed = line.trim();
    // Skip pure comment lines — TODO/FIXME markers-as-comments are the
    // sibling fake-data-detector's job, not this JSX-content-focused rule.
    if (/^(\/\/|\/\*|\*|<!--)/.test(trimmed)) continue;
    // Skip import/require specifiers — a module path like
    // '@tiptap/extension-placeholder' is a package name, not rendered
    // content, even though it's a quoted string containing "placeholder".
    if (/^\s*import\b.*\bfrom\s*['"`]/.test(line) || /\brequire\(\s*['"`]/.test(line)) continue;
    if (!STRONG_TERMS_RE.test(line) && !WEAK_TERMS_RE.test(line)) continue;
    // The `placeholder="..."` JSX attribute is a legitimate input hint,
    // not fabricated content — only skip when the match IS that attribute
    // name (not the word appearing elsewhere in a string on the same
    // line).
    if (PLACEHOLDER_ATTR_RE.test(line) && !STRONG_TERMS_RE.test(line)) {
      // Still check for other terms outside the attribute name itself.
      const withoutAttr = line.replace(PLACEHOLDER_ATTR_RE, "");
      if (!WEAK_TERMS_RE.test(withoutAttr) && !STRONG_TERMS_RE.test(withoutAttr)) continue;
    }
    if (hasAllowAnnotation(rawLines, i)) continue;

    // Require the term to sit inside a quoted string literal (JSX attr
    // value, object-literal field, or template literal) — this is the
    // "flows into JSX" corroboration and keeps bare-word comments/code
    // identifiers from firing (identifiers already excluded by \b word
    // boundaries, but this also excludes unquoted JSX text like raw
    // variable names).
    QUOTED_STR_RE.lastIndex = 0;
    let qm;
    let matchedInString = false;
    let matchedTerm = null;
    let isStrong = false;
    while ((qm = QUOTED_STR_RE.exec(line)) != null) {
      // The value is the value of an identity/presentation key (a tab/nav
      // config label naming a feature) — not fabricated body content.
      if (IDENTITY_KEY_SKIP.has(precedingKeyName(line, qm.index) || "")) continue;
      const strContent = qm[2];
      const strongM = STRONG_TERMS_RE.exec(strContent);
      if (strongM) {
        if (NEGATION_RE.test(strContent.slice(0, strongM.index))) continue; // honestly DENYING fake data
        matchedInString = true; matchedTerm = strongM[0]; isStrong = true; break;
      }
      const weakM = WEAK_TERMS_RE.exec(strContent);
      if (weakM) {
        if (NEGATION_RE.test(strContent.slice(0, weakM.index))) continue;
        matchedInString = true; matchedTerm = weakM[0]; isStrong = false;
      }
    }
    if (!matchedInString) continue;
    if (!isStrong && matchedTerm.toLowerCase() === "dummy" && isDummyDomainPath) continue;

    findings.push({
      id: isStrong ? "placeholder_content_strong" : "placeholder_content_weak",
      severity: isStrong ? "medium" : "info",
      kind: "static",
      category: CATEGORY,
      subject: { kind: "file", path: rel },
      message: `Placeholder-sounding content rendered as real: "${matchedTerm}" in ${snippet(trimmed, 120)}`,
      location: `${rel}:${i + 1}`,
      evidence: { term: matchedTerm },
      fixHint: "Replace with real content from the backend/substrate, or if this is intentional sample/demo copy, label it visibly as such in the UI.",
    });
  }
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function runFrontendFakeDataDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError(CATEGORY, "no_root", null, t0);

  try {
    const fileCap = Number.isFinite(opts.fileCap) ? opts.fileCap : 5000;
    const findingCap = Number.isFinite(opts.findingCap) ? opts.findingCap : 500;
    // Walk only the two in-scope directories directly (rather than the
    // whole repo tree + filtering) — this detector's contract is
    // deliberately narrow to lens pages + components.
    const files = [];
    for (const scanDir of SCAN_DIRS) {
      files.push(...await walk(path.join(root, scanDir), [".tsx"]));
    }
    const findings = [];
    let scanned = 0;

    for (const f of files) {
      if (scanned >= fileCap) break;
      if (findings.length >= findingCap) break;
      const rel = relPath(root, f);
      if (!isInScope(rel)) continue;
      const content = await readSafe(f);
      if (!content) continue;
      scanned++;

      if (FILE_ALLOW_RE.test(content)) continue;
      const rawLines = content.split("\n");

      checkHardcodedArrayRenderedAsData(rel, content, rawLines, findings);
      if (findings.length >= findingCap) break;
      checkMathRandomInJsx(rel, content, rawLines, findings);
      if (findings.length >= findingCap) break;
      checkPlaceholderContent(rel, content, rawLines, findings);
      if (findings.length >= findingCap) break;
    }

    findings.unshift({
      id: "frontend_fake_data_summary",
      severity: "info",
      kind: "static",
      category: CATEGORY,
      message: `Scanned ${scanned} frontend file(s) under app/lenses + components; flagged ${findings.length}`,
      evidence: { scanned, flagged: findings.length },
    });

    return makeReport(CATEGORY, findings, t0);
  } catch (err) {
    return makeError(CATEGORY, "exception", err, t0);
  }
}
