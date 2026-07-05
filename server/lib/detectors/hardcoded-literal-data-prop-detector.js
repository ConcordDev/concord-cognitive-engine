// server/lib/detectors/hardcoded-literal-data-prop-detector.js
//
// Detects a component being mounted with a hardcoded "empty/off" literal
// (`0`, `false`, `null`, `[]`, `''`/`""`) passed to a prop whose NAME
// strongly implies it should carry live/computed data — silently making a
// feature permanently inert without it looking obviously broken. Distinct
// from class-3 fabrication (no `Math.random()`, no fake data generation —
// just a dead default masquerading as real wiring).
//
// Seeded from a REAL bug found during the 2026-07 audit:
//   concord-frontend/app/lenses/world/page.tsx mounted THREE different
//   components — SkyWeatherRenderer, FactionBanners, InstancedGrass — each
//   with `windDirection={0}` hardcoded, instead of the live `windDirection`
//   state the file already tracked (a `useState` fed by a socket handler
//   two lines away). Verified fixed at HEAD (all three sites now read
//   `windDirection={windDirection}`) — this detector exists so the NEXT
//   instance of the pattern doesn't require an audit to find.
//
// IMPORTANT DEVIATION FROM THE ORIGINAL SPEC (documented per instructions):
// the task brief's suggested noise filter was "flag only when the SAME
// COMPONENT is mounted 2+ times with the identical hardcoded value for the
// same prop." The real bug that motivated this detector does NOT match that
// shape — it was three DIFFERENT components (SkyWeatherRenderer,
// FactionBanners, InstancedGrass), each independently hardcoding the same
// prop name to the same literal. Grouping by component name would have
// missed the seed bug entirely. This detector instead groups by
// (propName, literalValue) PER FILE, regardless of which component carries
// it — the systemic-miss signal ("this exact reading was never threaded to
// N different consumers") is at least as strong as the same-component
// signal, and it's the one that's actually falsifiable against the real
// example. See the precision-choice note further down for how single-mount
// occurrences are handled differently (narrower, lower severity).
//
// Detection strategy (heuristic — approximate, not an AST):
//   1. Walk .tsx/.jsx files, find JSX component mount tags (`<ComponentName
//      ... />` / `<ComponentName ...>`), tracking brace/string depth so
//      attribute values that themselves contain `{`, `}`, `<`, `>` (nested
//      JSX, arrow functions, generics) don't desync the tag boundary.
//   2. Within each tag, extract `propName=value` pairs.
//   3. Keep only props whose name contains (case-insensitively) one of the
//      data-sounding keywords: direction, position, value, data, state,
//      level, count, amount, percent, strength, intensity, progress, score.
//   4. Keep only values that are EXACTLY one of the "empty/off" literals:
//      `{0}` (incl. `-0`, `0.0`), `{false}`, `{null}`, `{[]}`,
//      `{''}`/`{""}`, or the bare-string form `""`/`''`. A variable,
//      member expression, ternary, template literal, or function call is
//      never a match — only a literal with nothing else in the braces.
//
// Precision choice (read before trusting the ratchet with this one):
//   • Tier A — MULTI-MOUNT (medium): the same (propName, literalValue) pair
//     appears at 2+ distinct JSX mount sites in the same file. This is the
//     strong signal — matches the real seed bug exactly — but it is
//     file-wide, not proximity-scoped: two unrelated components 4,000 lines
//     apart that both happen to pass `level={0}` would still group. In a
//     ~5,000-line world-lens page.tsx that's a real risk. Spot-checked
//     below; see the report at the bottom of this file's paired test run
//     for the honest verdict.
//   • Tier B — SINGLE-MOUNT (low): a prop appears exactly once with a
//     hardcoded literal. To keep the false-positive rate sane, single
//     mounts are ONLY flagged when the prop name is in the narrow
//     highest-confidence list — ends in "direction" or "position"
//     (`windDirection`, `xPosition`, bare `direction`/`position`, etc).
//     Generic names (`count`, `level`, `score`, ...) are never flagged on a
//     single mount — a `count={0}` on a component that manages its own
//     counting is extremely common and legitimate; without a second
//     occurrence to compare against there's no way to distinguish "forgot
//     to wire this" from "this really always starts at zero."
//   • RECOMMENDATION: given the file-wide (non-proximity-scoped) grouping in
//     Tier A, treat this detector as ADVISORY-ONLY until it's been run
//     against the real tree and the finding list hand-reviewed a few times.
//     It is intentionally NOT registered in index.js — see the task note
//     there. Promote to a gated tier only after a burn-in period with a
//     tracked false-positive rate.
//
// Escape hatch: `// detector-allow: hardcoded-prop <reason>` either on the
// same line as the flagged attribute, or on the line directly above the
// mount's OPENING tag (`<ComponentName`, not the attribute's own line —
// tags routinely span multiple lines) suppresses that one occurrence. This
// mirrors the codebase's existing `@decorative-ok` convention (single line
// directly above, checked by exact line index, not a fuzzy window) so the
// annotation placement rule is consistent across detectors. Suppressing one
// occurrence can correctly collapse a 2-mount Tier A group back down to a
// Tier B single mount, or to nothing at all.

import { walk, readSafe, makeReport, makeError, lineOf, relPath } from "./_framework.js";

const CATEGORY = "dead-wiring";

// Case-insensitive substring match against the prop name.
const DATA_PROP_RE = /(direction|position|value|data|state|level|count|amount|percent|strength|intensity|progress|score)/i;

// Tier B (single-mount) highest-confidence names: compound-or-bare
// "...direction" / "...position" only. Deliberately excludes the generic
// keywords above — see the precision-choice note.
const HIGH_CONFIDENCE_SINGLE_RE = /(?:direction|position)$/i;

const SKIP_FILES = [
  /\.(?:test|spec|stories)\.(?:jsx|tsx)$/,
  /\/(?:__tests__|__mocks__|__fixtures__)\//,
  /\.d\.ts$/,
];

const ALLOW_RE = /detector-allow:\s*hardcoded-prop\b/;

/**
 * Does a `// detector-allow: hardcoded-prop <reason>` annotation appear on
 * the SAME line as the flagged attribute (`attrLine`), or on the line
 * DIRECTLY ABOVE the mount's opening tag (`mountStartLine`)? Both are
 * 1-indexed. Checking the tag's start line (not the attribute's own line)
 * matters because a real mount tag commonly spans several lines — an
 * annotation placed above the whole element should suppress every
 * attribute inside it, not just one sitting on the tag's first line.
 */
function isAllowedNear(lines, mountStartLine, attrLine) {
  if (ALLOW_RE.test(lines[attrLine - 1] || "")) return true;
  if (ALLOW_RE.test(lines[mountStartLine - 2] || "")) return true;
  return false;
}

/**
 * Scan `content` for JSX component mount tags: `<ComponentName ...>` or
 * `<ComponentName ... />`. Component names start uppercase (React
 * convention) or are dotted (`Foo.Bar`). Tracks `{}` depth and string/
 * template literal state so an attribute value containing braces or angle
 * brackets (nested JSX, arrow functions, generics, comparisons) doesn't
 * desync the tag boundary.
 *
 * KNOWN LIMITATION: a component mounted INSIDE another component's prop
 * expression (e.g. `icon={<Icon size={0} />}`) is not discovered as its own
 * top-level mount — the outer tag's balanced-brace scan swallows it. This
 * under-counts nested mounts; it does not over-count (no false positives
 * from this limitation, only missed detections).
 */
export function extractJsxMounts(content) {
  const mounts = [];
  const openRe = /<([A-Z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\b/g;
  let m;
  while ((m = openRe.exec(content)) != null) {
    const component = m[1];
    const start = m.index;
    let i = openRe.lastIndex;
    let depth = 0;
    let inStr = null;
    let end = content.length;
    while (i < content.length) {
      const ch = content[i];
      if (inStr) {
        if (ch === "\\") { i += 2; continue; }
        if (ch === inStr) inStr = null;
        i++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; i++; continue; }
      if (ch === "{") { depth++; i++; continue; }
      if (ch === "}") { depth--; i++; continue; }
      if (depth <= 0 && ch === "/" && content[i + 1] === ">") { end = i + 2; break; }
      if (depth <= 0 && ch === ">") { end = i + 1; break; }
      i++;
    }
    const tagText = content.slice(start, end);
    mounts.push({ component, tagText, start, end });
    openRe.lastIndex = end > start ? end : openRe.lastIndex;
  }
  return mounts;
}

/**
 * Extract `name=value` attribute pairs from a single tag's text (as
 * produced by `extractJsxMounts`). `value` is returned RAW, including its
 * delimiters (`{...}` or `"..."`/`'...'`), so the caller can classify it.
 * Boolean-shorthand attributes (`disabled` with no `=`) are skipped — they
 * can't carry a data-sounding literal by construction.
 */
export function extractAttrs(tagText) {
  const attrs = [];
  const nameRe = /([A-Za-z_][\w-]*)\s*=\s*/g;
  let m;
  while ((m = nameRe.exec(tagText)) != null) {
    const name = m[1];
    let i = nameRe.lastIndex;
    const ch = tagText[i];
    let value = null;
    let next = i;
    if (ch === "{") {
      let depth = 0, j = i, inStr = null;
      while (j < tagText.length) {
        const c = tagText[j];
        if (inStr) {
          if (c === "\\") { j += 2; continue; }
          if (c === inStr) inStr = null;
          j++;
          continue;
        }
        if (c === "'" || c === '"' || c === "`") { inStr = c; j++; continue; }
        if (c === "{") depth++;
        else if (c === "}") { depth--; if (depth === 0) { j++; break; } }
        j++;
      }
      value = tagText.slice(i, j);
      next = j;
    } else if (ch === '"' || ch === "'") {
      const q = ch;
      let j = i + 1;
      while (j < tagText.length && tagText[j] !== q) {
        if (tagText[j] === "\\") j++;
        j++;
      }
      value = tagText.slice(i, Math.min(j + 1, tagText.length));
      next = j + 1;
    } else {
      // No `{` or quote after `=` (malformed, or a TS-generic false match) — skip.
      continue;
    }
    attrs.push({ name, rawValue: value, index: m.index });
    nameRe.lastIndex = next;
  }
  return attrs;
}

/**
 * Classify an attribute's raw value (with delimiters). Returns
 * `{ literal: boolean, norm?: string }` — `norm` is a stable label used as
 * the group key when `literal` is true.
 */
export function classifyAttrValue(rawValue) {
  const v = (rawValue || "").trim();
  if (v.startsWith("{") && v.endsWith("}")) {
    const inner = v.slice(1, -1).trim();
    if (/^-?0(\.0+)?$/.test(inner)) return { literal: true, norm: "0" };
    if (inner === "false") return { literal: true, norm: "false" };
    if (inner === "null") return { literal: true, norm: "null" };
    if (/^\[\s*\]$/.test(inner)) return { literal: true, norm: "[]" };
    if (/^(['"])\1$/.test(inner)) return { literal: true, norm: "''" };
    return { literal: false };
  }
  // Bare string attribute, e.g. windDirection="" (no braces).
  if (/^(['"])\1$/.test(v)) return { literal: true, norm: "''" };
  return { literal: false };
}

export async function runHardcodedLiteralDataPropDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("hardcoded-literal-data-prop", "no_root", null, t0);

  try {
    const files = await walk(root, [".tsx", ".jsx"]);
    const findings = [];
    let scanned = 0;

    for (const f of files) {
      const rel = relPath(root, f);
      if (SKIP_FILES.some((re) => re.test(rel))) continue;
      const content = await readSafe(f);
      if (!content) continue;
      scanned++;

      const lines = content.split("\n");
      const mounts = extractJsxMounts(content);
      if (mounts.length === 0) continue;

      // occurrences[key] = [{ component, line, prop, rawValue }]
      const occurrences = new Map();

      for (const mount of mounts) {
        const mountStartLine = lineOf(content, mount.start);
        const attrs = extractAttrs(mount.tagText);
        for (const attr of attrs) {
          if (!DATA_PROP_RE.test(attr.name)) continue;
          const cls = classifyAttrValue(attr.rawValue);
          if (!cls.literal) continue;

          const absoluteIndex = mount.start + attr.index;
          const line = lineOf(content, absoluteIndex);
          if (isAllowedNear(lines, mountStartLine, line)) continue;

          const key = `${attr.name} ${cls.norm}`;
          if (!occurrences.has(key)) occurrences.set(key, []);
          occurrences.get(key).push({
            component: mount.component,
            line,
            prop: attr.name,
            norm: cls.norm,
            rawValue: attr.rawValue,
          });
        }
        if (findings.length > 500) break;
      }

      for (const [, occs] of occurrences) {
        if (occs.length >= 2) {
          // Tier A — multi-mount, same (prop, literal) pair across the file.
          const components = [...new Set(occs.map((o) => o.component))];
          const lineList = occs.map((o) => o.line).sort((a, b) => a - b);
          findings.push({
            id: "hardcoded_literal_data_prop_multi_mount",
            severity: "medium",
            kind: "static",
            category: CATEGORY,
            subject: { kind: "file", path: rel },
            message:
              `prop '${occs[0].prop}' is hardcoded to the literal ${occs[0].rawValue} at ${occs.length} mount site(s)` +
              ` (${components.join(", ")}) — looks like live/computed data that was never wired in`,
            location: `${rel}:${lineList[0]}`,
            evidence: {
              prop: occs[0].prop,
              value: occs[0].rawValue,
              components,
              lines: lineList,
            },
            fixHint: "thread_the_real_state_value_into_this_prop_at_every_mount_site",
          });
        } else if (occs.length === 1) {
          // Tier B — single mount, only for the highest-confidence prop names.
          const o = occs[0];
          if (!HIGH_CONFIDENCE_SINGLE_RE.test(o.prop)) continue;
          findings.push({
            id: "hardcoded_literal_data_prop_single_mount",
            severity: "low",
            kind: "static",
            category: CATEGORY,
            subject: { kind: "file", path: rel },
            message: `prop '${o.prop}' on <${o.component}> is hardcoded to the literal ${o.rawValue} — verify this isn't meant to track live data`,
            location: `${rel}:${o.line}`,
            evidence: { prop: o.prop, value: o.rawValue, component: o.component },
            fixHint: "verify_hardcoded_value_is_intentional_or_wire_the_real_source",
          });
        }
      }
      if (findings.length > 500) break;
    }

    findings.unshift({
      id: "hardcoded_literal_data_prop_summary",
      severity: "info",
      kind: "static",
      category: CATEGORY,
      message: `Scanned ${scanned} JSX file(s) of ${files.length}; flagged ${findings.length}`,
      evidence: { scanned, totalFiles: files.length },
    });

    return makeReport("hardcoded-literal-data-prop", findings, t0);
  } catch (err) {
    return makeError("hardcoded-literal-data-prop", "exception", err, t0);
  }
}
