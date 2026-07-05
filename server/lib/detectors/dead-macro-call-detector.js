// server/lib/detectors/dead-macro-call-detector.js
//
// Per-call-site dead-macro-call detector.
//
// `scripts/verify-lens-backends.mjs` (a separate, protected, existing static
// verifier — this detector does not edit it) checks reachability at the LENS
// level: does a lens page reach AT LEAST ONE registered macro domain? Its own
// `macroDomains` set is even coarser than that — it only records the DOMAIN
// half of `register("d","n", …)` calls, never the (domain, macro) PAIR. A
// lens with ten macro calls where one targets a domain/macro pair that was
// never registered still reads "WIRED" overall as long as the other nine
// succeed, and even a same-domain typo on the macro name is invisible to it.
//
// This detector closes that gap at the individual call-site granularity:
// build the REAL set of registered (domain, macro) pairs from `server/`, then
// walk every literal `lensRun('d','n', …)` / `runDomain('d','n', …)` /
// `runMacro('d','n', …)` / `POST /api/lens/run` call site in
// `concord-frontend/` and flag any whose (domain, macro) pair was never
// registered. Every such call is a GUARANTEED `unknown_macro` at runtime —
// a feature that always breaks, invisible to the coarser lens-level check.
//
// Precision discipline (a detector that floods with false positives gets
// muted, which is worse than not existing):
//   • Only LITERAL domain+macro pairs are ever flagged. A dynamic/variable
//     domain or macro name (e.g. `apiHelpers.lens.runDomain('bio', action, …)`
//     where `action` is a prop/param) cannot be resolved statically without a
//     false-positive risk, so it is silently skipped — never flagged, never
//     counted as "checked". This mirrors verify-lens-backends.mjs's own
//     documented reasoning for excluding ambiguous call shapes.
//   • Comments are stripped before scanning (a local, regex-literal-aware
//     lexer — see `stripCommentsAndRegex` below) — several real files in this
//     tree carry a `// runMacro("domain", "macro", …)`
//     usage example in a doc comment above the ACTUAL call, and a naive grep
//     matches the comment as if it were code (verified during authoring: e.g.
//     `components/world/TombMarker.tsx`, `components/skills/EvolutionModal.tsx`,
//     `app/lenses/crafting/page.tsx` all have such comments).
//   • The registered-pairs set is built the SAME way `verify-lens-backends.mjs`
//     builds its (coarser) `macroDomains` set: alias-aware `register(...)` /
//     `registerLensAction(...)` literal-pair scanning across all of `server/`
//     (some domains — `personas.js`, `settings.js` — bind a local
//     `const reg = registerLensAction` alias and call `reg("d","n", …)`; the
//     scan detects per-file aliases exactly like the lens verifier does).
//   • One known BULK registration gap is special-cased so it isn't a false-
//     positive generator: `server/domains/_recent-mine-bulk.js` iterates its
//     `DOMAIN_TYPE_MAP` object (~160 domains) and calls
//     `buildDtuRecentMineMacro(register, domain, opts)` per key — `domain` is
//     a loop variable there, never a literal at the `register(domain, …)`
//     call site inside `_dtu-recent-mine.js`, so the generic literal-pair scan
//     can't see e.g. `pharmacy.recent_mine` as registered. This detector
//     parses `DOMAIN_TYPE_MAP`'s keys (minus `SKIP_DOMAINS`) directly so those
//     ~160 domains' `.recent_mine` / `.list_mine` pairs count as registered.
//     (In practice the frontend calls this generic surface through
//     `useListMine(domain, …)` with a variable `domain` prop, so this gap
//     doesn't currently produce visible false positives either way — but the
//     registered-set builder should be complete, not lucky.)

import path from "node:path";
import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";

// The shared `stripComments` lexer (command-injection-detector.js) tracks
// string/template context but NOT regex literals. It reads any `/*` outside a
// string as a block-comment start — which is wrong when the `/*` is really
// inside a regex literal, e.g. `server/domains/code-quality.js`'s
// `trimmed.replace(/^[/*#\s]+/, "")`. On that file the naive stripper treats
// the whole rest of the file (900+ lines, including 13 real
// `registerLensAction("code-quality", …)` calls) as one giant unterminated
// comment and silently drops it — verified during authoring: it turned 7 real,
// registered `code-quality.*` macros invisible to the registered-pairs scan,
// which would have made every frontend call to them a FALSE POSITIVE dead-call
// finding. `stripCommentsAndRegex` below is a local, slightly heavier lexer
// that additionally recognizes regex-literal context (by checking whether the
// preceding non-whitespace token looks like an operator/keyword rather than a
// value) and passes matched regex literals through untouched instead of
// mis-reading them as comment delimiters.
const REGEX_PRECEDING_OK_RE = /[([{,;:=&|!?+\-*%^~<>]$/;
const REGEX_PRECEDING_KEYWORD_RE = /\b(?:return|typeof|instanceof|in|of|new|delete|void|throw|do|else|yield|await|case)$/;

export function stripCommentsAndRegex(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let str = null; // current string delimiter: ' " or `
  while (i < n) {
    const ch = src[i];
    const nx = src[i + 1];
    if (str) {
      out += ch;
      if (ch === "\\") { out += nx ?? ""; i += 2; continue; }
      if (ch === str) str = null;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { str = ch; out += ch; i++; continue; }
    if (ch === "/" && nx === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue; // leave the \n to be copied next iter
    }
    if (ch === "/" && nx === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") out += "\n"; i++; }
      i += 2;
      continue;
    }
    if (ch === "/") {
      let j = out.length - 1;
      while (j >= 0 && /\s/.test(out[j])) j--;
      const prevChar = j >= 0 ? out[j] : "";
      const tail = out.slice(Math.max(0, j - 12), j + 1);
      const looksLikeRegexStart =
        prevChar === "" || REGEX_PRECEDING_OK_RE.test(prevChar) || REGEX_PRECEDING_KEYWORD_RE.test(tail);
      if (looksLikeRegexStart) {
        let k = i + 1;
        let inClass = false;
        let closed = false;
        while (k < n) {
          const c2 = src[k];
          if (c2 === "\\") { k += 2; continue; }
          if (c2 === "\n") break; // regex literals never span lines — bail out below
          if (c2 === "[") { inClass = true; k++; continue; }
          if (c2 === "]") { inClass = false; k++; continue; }
          if (c2 === "/" && !inClass) { closed = true; k++; break; }
          k++;
        }
        if (closed) {
          while (k < n && /[a-z]/i.test(src[k])) k++; // trailing flags
          out += src.slice(i, k);
          i = k;
          continue;
        }
        // Not a well-formed single-line regex literal — fall through and
        // treat the '/' as an ordinary character (division etc).
      }
    }
    out += ch;
    i++;
  }
  return out;
}

const SERVER_SKIP = [
  /\/(?:tests?|__tests__)\//,
  /\.(?:test|spec)\.(?:js|mjs|cjs)$/,
];
const FRONTEND_SKIP = [
  /\/(?:tests?|__tests__|stories|coverage|\.next)\//,
  /\.(?:test|spec|stories)\.(?:js|jsx|ts|tsx)$/,
];

const IDENT = "[a-zA-Z0-9_.\\-]+";

/** Extract the balanced-paren argument substring of a call starting at `open` (index of the `(`). */
function callArgs(content, open) {
  let depth = 0, i = open, buf = "";
  while (i < content.length) {
    const ch = content[i];
    if (ch === "(") { if (depth > 0) buf += ch; depth++; }
    else if (ch === ")") { depth--; if (depth === 0) break; buf += ch; }
    else if (depth > 0) buf += ch;
    i++;
  }
  return buf;
}

/** Walk backward from `idx` to find the open-paren of the nearest enclosing call. */
function enclosingOpenParen(content, idx) {
  let depth = 0;
  for (let i = idx - 1; i >= 0; i--) {
    const ch = content[i];
    if (ch === ")") depth++;
    else if (ch === "(") { if (depth === 0) return i; depth--; }
  }
  return -1;
}

/** First literal string value for `key: "value"` (key may be an alternation) within `text`. */
function firstLiteralKV(text, keyAlt) {
  const re = new RegExp(String.raw`\b(?:${keyAlt})\s*:\s*["'\`](${IDENT})["'\`]`);
  const m = re.exec(text);
  return m ? m[1] : null;
}

// ── Registration-side: build the real (domain, macro) pair set ─────────────

const REGISTER_BULK_FILE = "server/domains/_recent-mine-bulk.js";
const BULK_KEY_RE = /^[ \t]*(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$-]*))[ \t]*:[ \t]*\{/gm;
const BULK_SKIP_RE = /SKIP_DOMAINS\s*=\s*new\s+Set\(\s*\[([^\]]*)\]/;
const BULK_SKIP_ITEM_RE = /["'`]([^"'`]+)["'`]/g;

/**
 * Special-case resolver for `_recent-mine-bulk.js`'s `DOMAIN_TYPE_MAP`-driven
 * bulk registration (see module header). Returns the list of domains that get
 * a `.recent_mine` + `.list_mine` pair via this path, honoring `SKIP_DOMAINS`.
 * Best-effort — any parse failure degrades to an empty list (never throws).
 */
export async function collectBulkRecentMineDomains(root) {
  try {
    const raw = await readSafe(path.join(root, REGISTER_BULK_FILE));
    if (!raw) return [];
    const c = stripCommentsAndRegex(raw);

    const mapStart = c.indexOf("DOMAIN_TYPE_MAP");
    const objOpen = c.indexOf("{", mapStart);
    if (mapStart < 0 || objOpen < 0) return [];
    let depth = 0, end = -1;
    for (let i = objOpen; i < c.length; i++) {
      if (c[i] === "{") depth++;
      else if (c[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return [];
    const body = c.slice(objOpen + 1, end);

    const domains = new Set();
    BULK_KEY_RE.lastIndex = 0;
    let m;
    while ((m = BULK_KEY_RE.exec(body)) != null) domains.add(m[1] || m[2] || m[3]);

    const skipMatch = BULK_SKIP_RE.exec(c);
    if (skipMatch) {
      let sm;
      BULK_SKIP_ITEM_RE.lastIndex = 0;
      while ((sm = BULK_SKIP_ITEM_RE.exec(skipMatch[1])) != null) domains.delete(sm[1]);
    }
    return [...domains];
  } catch {
    return [];
  }
}

/**
 * Build the set of every registered (domain, macro) pair across `server/`.
 * Alias-aware: a file that binds `const reg = registerLensAction` (or
 * `= register`) is scanned for `reg("d","n", …)` calls too, matching
 * `verify-lens-backends.mjs`'s own documented approach.
 *
 * Returns a Map<"domain macro", {file, line}> (first registration site wins).
 */
export async function buildRegisteredMacroPairs(root) {
  const serverDir = path.join(root, "server");
  const files = await walk(serverDir, [".js"]);
  const pairs = new Map();

  for (const f of files) {
    const rel = relPath(root, f);
    if (SERVER_SKIP.some((re) => re.test(rel))) continue;
    const raw = await readSafe(f);
    if (!raw) continue;
    const c = stripCommentsAndRegex(raw);

    const aliases = new Set(["register", "registerLensAction"]);
    for (const m of c.matchAll(/\bconst\s+(\w+)\s*=\s*(?:registerLensAction|register)\b/g)) {
      aliases.add(m[1]);
    }
    const aliasPattern = [...aliases].map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const callRe = new RegExp(
      String.raw`\b(?:${aliasPattern})\(\s*["'\`](${IDENT})["'\`]\s*,\s*["'\`](${IDENT})["'\`]`,
      "g",
    );
    let m;
    while ((m = callRe.exec(c)) != null) {
      const key = `${m[1]} ${m[2]}`;
      if (!pairs.has(key)) pairs.set(key, { file: rel, line: lineOf(c, m.index) });
    }
  }

  // Special-cased bulk registration gap (see module header).
  const bulkDomains = await collectBulkRecentMineDomains(root);
  for (const domain of bulkDomains) {
    for (const macro of ["recent_mine", "list_mine"]) {
      const key = `${domain} ${macro}`;
      if (!pairs.has(key)) pairs.set(key, { file: REGISTER_BULK_FILE, line: 0 });
    }
  }

  return pairs;
}

// ── Call-site side: literal (domain, macro) pairs the frontend invokes ─────

const CALL_ANCHOR_RE = /\b(?:lensRun|runDomain|runMacro)\b(?:<[^>(]*>)?\s*\(/g;
const POSITIONAL_PAIR_RE = new RegExp(String.raw`^\s*["'\`](${IDENT})["'\`]\s*,\s*["'\`](${IDENT})["'\`]`);
const LENS_RUN_PATH_RE = /\/api\/lens\/run/g;

/**
 * Extract every literal (domain, macro) call site from a single (already
 * comment-stripped) frontend source file.
 * @returns {{domain:string, macro:string, index:number}[]}
 */
export function extractCallSites(content) {
  const found = [];
  const seen = new Set(); // de-dupe the same (index) reached by two heuristics

  const record = (index, domain, macro) => {
    if (!domain || !macro) return;
    const key = `${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ domain, macro, index });
  };

  // 1) lensRun(...) / runDomain(...) / runMacro(...) — positional or object-spec.
  CALL_ANCHOR_RE.lastIndex = 0;
  let m;
  while ((m = CALL_ANCHOR_RE.exec(content)) != null) {
    const open = m.index + m[0].length - 1;
    const args = callArgs(content, open);
    const pos = POSITIONAL_PAIR_RE.exec(args);
    if (pos) {
      record(m.index, pos[1], pos[2]);
      continue;
    }
    const domain = firstLiteralKV(args, "domain");
    const macro = firstLiteralKV(args, "action|name");
    if (domain && macro) record(m.index, domain, macro);
  }

  // 2) fetch('/api/lens/run', …) / api.post('/api/lens/run', {domain, name/action}) —
  //    anchor on the literal path, walk back to the enclosing call, and read
  //    the domain/(action|name) literal keys out of that call's full args.
  LENS_RUN_PATH_RE.lastIndex = 0;
  while ((m = LENS_RUN_PATH_RE.exec(content)) != null) {
    const open = enclosingOpenParen(content, m.index);
    if (open < 0) continue;
    const args = callArgs(content, open);
    const domain = firstLiteralKV(args, "domain");
    const macro = firstLiteralKV(args, "action|name");
    if (domain && macro) record(open, domain, macro);
  }

  return found;
}

export async function runDeadMacroCallDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("dead-macro-call", "no_root", null, t0);

  try {
    const registered = await buildRegisteredMacroPairs(root);

    const frontendDir = path.join(root, "concord-frontend");
    const files = await walk(frontendDir, [".js", ".jsx", ".ts", ".tsx"]);
    const findings = [];
    let scanned = 0;
    let callSitesChecked = 0;

    for (const f of files) {
      const rel = relPath(root, f);
      if (FRONTEND_SKIP.some((re) => re.test(rel))) continue;
      const raw = await readSafe(f);
      if (!raw) continue;
      const c = stripCommentsAndRegex(raw);
      const sites = extractCallSites(c);
      if (sites.length === 0) continue;
      scanned++;

      for (const site of sites) {
        callSitesChecked++;
        const key = `${site.domain} ${site.macro}`;
        if (registered.has(key)) continue;
        findings.push({
          id: "dead_macro_call",
          severity: "high",
          kind: "static",
          category: "wiring",
          subject: { kind: "file", path: rel, domain: site.domain, macro: site.macro },
          message: `Call to ${site.domain}.${site.macro} targets a (domain, macro) pair that is never registered on the backend — guaranteed unknown_macro at runtime`,
          location: `${rel}:${lineOf(c, site.index)}`,
          evidence: { domain: site.domain, macro: site.macro, snippet: snippet(c.slice(site.index, site.index + 80), 100) },
          fixHint: "register_macro_or_fix_call_site",
        });
        if (findings.length > 500) break;
      }
      if (findings.length > 500) break;
    }

    findings.unshift({
      id: "dead_macro_call_summary",
      severity: "info",
      kind: "static",
      category: "wiring",
      message: `${registered.size} registered (domain, macro) pairs; scanned ${scanned} frontend file(s) with macro-run call sites, checked ${callSitesChecked} literal call site(s), flagged ${findings.length}`,
      evidence: { registeredPairs: registered.size, filesScanned: scanned, callSitesChecked, flagged: findings.length },
    });

    return makeReport("dead-macro-call", findings, t0);
  } catch (err) {
    return makeError("dead-macro-call", "exception", err, t0);
  }
}
