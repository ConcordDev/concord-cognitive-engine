#!/usr/bin/env node
// scripts/extract-macro-input-hints.mjs
//
// GENERATES server/lib/macro-input-hints.js — a docs-as-build-artifact map of
// "domain.action" -> [{name, optional}] fields, derived from the informal
// `input: { field1, field2? }` doc-comment convention that already sits above
// ~195 `register("domain", "name", handler, ...)` calls across
// server/domains/*.js + server.js. No structured input schema exists anywhere
// in the backend (only free-text `desc` strings) — authoring one across the
// ~10,000 registered macro pairs is a separate, much larger effort. This
// script instead reproducibly recovers the hints that already exist as prose,
// so AutoActionStrip.tsx can render real labeled fields instead of a raw-JSON
// textarea for the subset of macros that documented their shape this way.
//
// Deliberately scoped to the `register(...)` convention only, NOT
// `registerLensAction(...)` — the latter's preceding comments use a much more
// heterogeneous `params.x` / `artifact.data.x` prose style (no single regex
// safely recovers a field list from those without false positives).
//
// Deliberately SKIPS any hint whose `input: {...}` shape is not flat (a
// top-level field with a nested `{...}`/`[...]` value, or a `{ a } | { b }`
// union) — a flat key/value form would misrepresent those, so the consuming
// UI keeps its raw-JSON fallback for exactly those macros instead.
//
// USAGE
//   node scripts/extract-macro-input-hints.mjs           # (re)write the module
//   node scripts/extract-macro-input-hints.mjs --check   # exit 1 on drift

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ROOT = path.join(ROOT, "server");
const OUT = path.join(SERVER_ROOT, "lib", "macro-input-hints.js");
const CHECK = process.argv.includes("--check");

const TARGET_FILES = [
  path.join(SERVER_ROOT, "server.js"),
  path.join(SERVER_ROOT, "guidance.js"),
  ...fs.readdirSync(path.join(SERVER_ROOT, "domains"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => path.join(SERVER_ROOT, "domains", f)),
].filter((f) => fs.existsSync(f));

/** Index of every `/** ... *\/` block comment: [{start, end}], end exclusive. */
export function findBlockComments(src) {
  const out = [];
  const re = /\/\*\*[\s\S]*?\*\//g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return out;
}

/** Every `register("domain", "name", ...)` call — NOT `registerLensAction(`.
 *  The negative lookbehind on the identifier boundary is what excludes it:
 *  `registerLensAction(` never matches `\bregister\(` because the character
 *  immediately after "register" there is "L", not "(". */
export function findRegisterCalls(src) {
  const out = [];
  const re = /\bregister\(\s*(["'])([a-zA-Z0-9_-]+)\1\s*,\s*(["'])([a-zA-Z0-9_.-]+)\3/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ start: m.index, domain: m[2], name: m[4] });
  }
  return out;
}

/** From `openIdx` (must point at a '{' or '['), find the index of its match. */
export function matchBracket(str, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === "{" || str[i] === "[") depth++;
    else if (str[i] === "}" || str[i] === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split `content` on top-level commas only (ignoring commas nested inside
 *  {}/[] inside a field's own type annotation). */
export function splitTopLevel(content) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of content) {
    if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

const SIMPLE_FIELD_RE = /^[A-Za-z_$][\w$]*\??$/;

/** Parse one comment's `input: { ... }` clause into a flat field list, or
 *  null if the shape isn't flat (nested object/array value, or a union). */
export function parseInputHint(commentText) {
  const idx = commentText.indexOf("input:");
  if (idx === -1) return null;
  const braceIdx = commentText.indexOf("{", idx);
  if (braceIdx === -1) return null;
  // Reject if there's non-whitespace between "input:" and the brace other
  // than the brace itself (keeps this from matching a stray later "input:").
  const between = commentText.slice(idx + "input:".length, braceIdx);
  if (!/^\s*$/.test(between)) return null;

  const closeIdx = matchBracket(commentText, braceIdx);
  if (closeIdx === -1) return null;

  // A trailing `| { ... }` union right after the closing brace means the
  // shape isn't a single flat object — bail out to the raw-JSON fallback.
  const afterClose = commentText.slice(closeIdx + 1, closeIdx + 6);
  if (/^\s*\|/.test(afterClose)) return null;

  const inner = commentText.slice(braceIdx + 1, closeIdx);
  const tokens = splitTopLevel(inner).map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return null;

  const fields = [];
  for (const tok of tokens) {
    if (!SIMPLE_FIELD_RE.test(tok)) return null; // any complex token -> bail entirely
    const optional = tok.endsWith("?");
    const name = optional ? tok.slice(0, -1) : tok;
    fields.push({ name, optional });
  }
  return fields;
}

/** Pure core: given a file's full source text, return every
 *  "domain.name" -> fields[] hint it documents. No filesystem access — this
 *  is what the unit tests exercise directly against literal fixture strings. */
export function extractHintsFromSource(src) {
  const comments = findBlockComments(src);
  const calls = findRegisterCalls(src);
  const hints = {};

  for (const call of calls) {
    // Nearest comment ending at-or-before the call, with only whitespace
    // between the comment's end and the call's start (i.e. genuinely
    // documents THIS call, not some earlier one).
    let best = null;
    for (const c of comments) {
      if (c.end > call.start) break;
      best = c;
    }
    if (!best) continue;
    const between = src.slice(best.end, call.start);
    if (!/^\s*$/.test(between)) continue;

    const fields = parseInputHint(best.text);
    if (!fields) continue;
    hints[`${call.domain}.${call.name}`] = fields;
  }
  return hints;
}

function extractFromFile(file) {
  return extractHintsFromSource(fs.readFileSync(file, "utf8"));
}

function main() {
  const merged = {};
  for (const file of TARGET_FILES) {
    const hints = extractFromFile(file);
    for (const [key, fields] of Object.entries(hints)) merged[key] = fields;
  }

  const sortedKeys = Object.keys(merged).sort();
  const sorted = {};
  for (const k of sortedKeys) sorted[k] = merged[k];

  const body = [
    "// server/lib/macro-input-hints.js",
    "// GENERATED by scripts/extract-macro-input-hints.mjs — do not hand-edit.",
    "// Regenerate: node scripts/extract-macro-input-hints.mjs",
    "// Drift gate: node scripts/extract-macro-input-hints.mjs --check",
    "//",
    "// Field hints recovered from the `input: { field1, field2? }` doc-comment",
    "// convention above `register(\"domain\", \"name\", ...)` calls. Absence of a",
    "// key here means no hint was found (informal comment missing, non-flat",
    "// shape, or the macro uses the registerLensAction(...) convention instead)",
    "// — NOT that the macro takes no input. Consumers should always keep a",
    "// raw-JSON fallback for the unhinted majority.",
    "",
    `export const MACRO_INPUT_HINTS = ${JSON.stringify(sorted, null, 2)};`,
    "",
  ].join("\n");

  if (CHECK) {
    let committed = "";
    try { committed = fs.readFileSync(OUT, "utf8"); } catch { /* absent */ }
    if (committed !== body) {
      console.error(
        `server/lib/macro-input-hints.js is STALE vs freshly-extracted output (${sortedKeys.length} hints computed). ` +
        "Regenerate: node scripts/extract-macro-input-hints.mjs"
      );
      process.exit(1);
    }
    console.log(`server/lib/macro-input-hints.js matches freshly-extracted output ✓ (${sortedKeys.length} hints)`);
  } else {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, body);
    console.log(`wrote server/lib/macro-input-hints.js (${sortedKeys.length} hints from ${TARGET_FILES.length} files)`);
  }
}

// Guard so the exported pure functions above can be imported by unit tests
// (server/tests/extract-macro-input-hints.test.js) without running the full
// scan + write/--check pass as a side effect of the import.
const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) main();
