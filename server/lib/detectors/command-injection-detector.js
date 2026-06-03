// server/lib/detectors/command-injection-detector.js
//
// Shell / command-injection detector.
//
// Seeded from a REAL miss: PR #808 shipped
//   execSync(`git diff --name-only ${baseRef}...HEAD`, …)
// where `baseRef` is `process.argv[2] || process.env.GITHUB_BASE_REF` — an
// argv/env-derived value interpolated straight into a shell command line.
// CodeQL caught it ("Indirect uncontrolled command line"); Concord's own
// ~30-detector suite did NOT, because it had zero injection coverage. This
// detector closes that gap so the class is caught in-house, not by an external
// scanner after merge.
//
// Precision discipline (the whole point — a detector that cries wolf gets
// muted, and then it might as well not exist):
//   • We ONLY consider calls bound to a `child_process` import. `db.exec(`…`)`
//     (better-sqlite3 SQL — by far the most common `exec(` in this tree) is
//     never flagged, because `db`/`_db` is not the child_process namespace and
//     `exec` here is a member call on a different receiver.
//   • `exec` / `execSync` ALWAYS spawn through a shell → any non-literal command
//     argument is a finding.
//   • `spawn` / `spawnSync` / `execFile` / `execFileSync` / `fork` take an
//     args ARRAY and do NOT use a shell — they are the SAFE fix (the #808
//     remediation switched to `execFileSync('git', [...])`). They are only
//     flagged when the options object sets `shell: true`, which re-introduces
//     the shell.
//
// Severity:
//   critical — interpolated/concatenated command whose dynamic part references
//              an obvious external-input marker (argv / env / req / params /
//              body / query / process). This is the #808 shape.
//   high     — interpolated/concatenated command with any non-literal part
//              (still a shell-injection sink; the taint just isn't proven here).
//   medium   — a bare variable passed as the whole command (could be tainted;
//              worth a human glance).
//   (string literal commands are never flagged.)

import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";

// Functions that go through a shell unconditionally.
const SHELL_FUNCS = new Set(["exec", "execSync"]);
// Functions that take an args array (no shell) UNLESS { shell: true }.
const ARGV_FUNCS = new Set(["spawn", "spawnSync", "execFile", "execFileSync", "fork"]);
const ALL_FUNCS = new Set([...SHELL_FUNCS, ...ARGV_FUNCS]);

// External-input markers that escalate a finding to critical when they appear
// in the dynamic part of an interpolated command.
const TAINT_MARKERS = /\b(?:req\.(?:body|query|params|headers|cookies)|process\.argv|process\.env|argv|GITHUB_[A-Z_]+|userInput|payload|message|filename|fileName|userId|user_id|\.body\b|\.query\b|\.params\b)\b/;

const SKIP_FILES = [
  /\/(?:audit|reports|docs|skills|content|monitoring|nginx|k8s|load-tests)\//,
  /\.d\.ts$/,
  // Test/spec code legitimately shells out (fixtures, harness setup) and is not
  // a production attack surface — focus the security gate on shipped code.
  /\.(?:test|spec)\.(?:js|mjs|cjs|ts|tsx)$/,
  // The detector sources + their fixtures carry seed examples of the very
  // pattern they hunt for; scanning them is meta-noise.
  /\/lib\/detectors\//,
];

const CHILD_PROCESS_IMPORT = /(?:require\(\s*['"](?:node:)?child_process['"]\s*\)|from\s+['"](?:node:)?child_process['"])/;

/**
 * Strip JS comments so a sink (or an import mention) living in a comment — a
 * doc example, commented-out code — is never flagged. Newlines are preserved
 * so `lineOf` line numbers stay accurate. Best-effort lexer: it tracks string
 * and template-literal context so a `//` or `/*` inside a string isn't treated
 * as a comment.
 */
export function stripComments(src) {
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
    out += ch;
    i++;
  }
  return out;
}

/**
 * Parse a file's child_process bindings.
 * Returns { named: Set<fnName>, namespaces: Set<alias> } or null if the file
 * doesn't import child_process at all.
 */
export function parseChildProcessBindings(content) {
  if (!CHILD_PROCESS_IMPORT.test(content)) return null;
  const named = new Set();
  const namespaces = new Set();

  // import { execSync, exec as run } from 'child_process'
  let m;
  const namedImportRe = /import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g;
  while ((m = namedImportRe.exec(content)) != null) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      // `exec as run` → the local binding is `run`; `execSync` → `execSync`.
      const asMatch = /^(\w+)\s+as\s+(\w+)$/.exec(seg);
      if (asMatch) named.add(asMatch[2]);
      else named.add(seg);
    }
  }

  // import cp from 'child_process'  /  import * as cp from 'child_process'
  const defaultNsRe = /import\s+(?:\*\s+as\s+)?(\w+)\s+from\s*['"](?:node:)?child_process['"]/g;
  while ((m = defaultNsRe.exec(content)) != null) namespaces.add(m[1]);

  // const { execSync } = require('child_process')
  const cjsNamedRe = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g;
  while ((m = cjsNamedRe.exec(content)) != null) {
    for (const part of m[1].split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      // CJS rename is `exec: run`
      const colon = /^(\w+)\s*:\s*(\w+)$/.exec(seg);
      if (colon) named.add(colon[2]);
      else named.add(seg);
    }
  }

  // const cp = require('child_process')
  const cjsNsRe = /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g;
  while ((m = cjsNsRe.exec(content)) != null) namespaces.add(m[1]);

  return { named, namespaces };
}

/** Extract the (balanced-paren) argument substring of a call starting at `open`. */
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

/** First top-level argument (split on the first comma not inside (), [], {}, or a string). */
function firstArg(args) {
  let depth = 0, inStr = null;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i];
    if (inStr) { if (ch === inStr && args[i - 1] !== "\\") inStr = null; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { inStr = ch; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) return args.slice(0, i);
  }
  return args;
}

/**
 * Collect variable names assigned from an external-input source ANYWHERE in the
 * file, so an interpolation of one of those names is recognised as tainted even
 * when the assignment is on a different line. This is the #808 shape:
 *   const baseRef = process.argv[2] || process.env.GITHUB_BASE_REF;
 *   execSync(`git diff … ${baseRef} …`);
 * — `${baseRef}` carries the argv/env taint two lines up. One-hop, intra-file,
 * deliberately simple (no full data-flow): enough to grade the real bug
 * critical without the false confidence of a fake taint engine.
 */
export function collectTaintedVars(content) {
  const tainted = new Set();
  const re = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g;
  let m;
  while ((m = re.exec(content)) != null) {
    if (TAINT_MARKERS.test(m[2])) tainted.add(m[1]);
  }
  // function params named like request input also count.
  return tainted;
}

function interpReferencesTainted(arg, taintedVars) {
  if (!taintedVars || taintedVars.size === 0) return false;
  const interps = arg.match(/\$\{([^}]*)\}/g) || [];
  for (const block of interps) {
    for (const id of block.match(/[A-Za-z_$][\w$]*/g) || []) {
      if (taintedVars.has(id)) return true;
    }
  }
  // concat form: any bare identifier in the arg that's tainted
  for (const id of arg.match(/[A-Za-z_$][\w$]*/g) || []) {
    if (taintedVars.has(id)) return true;
  }
  return false;
}

/**
 * Classify a command argument string.
 * @param {string} arg
 * @param {Set<string>} [taintedVars] file-level tainted variable names
 * @returns {{ flag: boolean, reason: string, tainted: boolean }}
 */
export function classifyCommandArg(arg, taintedVars) {
  const a = arg.trim();
  // Template literal with interpolation: `… ${x} …`
  if (/^`[\s\S]*\$\{[\s\S]*`$/.test(a)) {
    const interp = a.match(/\$\{([^}]*)\}/g)?.join(" ") || "";
    const tainted = TAINT_MARKERS.test(interp) || TAINT_MARKERS.test(a) || interpReferencesTainted(a, taintedVars);
    return { flag: true, reason: "template_interpolation", tainted };
  }
  // String concatenation: '…' + x  /  x + '…'
  if (/['"`]\s*\+|\+\s*['"`]/.test(a) && /\+/.test(a)) {
    return { flag: true, reason: "string_concat", tainted: TAINT_MARKERS.test(a) || interpReferencesTainted(a, taintedVars) };
  }
  // Plain string literal (single/double/backtick with no interpolation) → safe.
  if (/^(['"])[\s\S]*\1$/.test(a) || (/^`[^`]*`$/.test(a) && !a.includes("${"))) {
    return { flag: false, reason: "string_literal", tainted: false };
  }
  // A bare identifier / member expression as the whole command — could be tainted.
  if (/^[A-Za-z_$][\w$.?[\]'"]*$/.test(a)) {
    return { flag: true, reason: "variable_command", tainted: TAINT_MARKERS.test(a) };
  }
  // Anything else (e.g. a function call returning a string) — flag conservatively low.
  return { flag: true, reason: "dynamic_command", tainted: TAINT_MARKERS.test(a) };
}

/** Does the call's options object set shell: true? (for the argv-family funcs) */
function hasShellTrue(args) {
  return /\bshell\s*:\s*(?:true|1|['"]\/?[\w/]*sh['"])/.test(args);
}

function severityFor(funcName, klass) {
  // argv-family with shell:true, or shell-family — same risk model below.
  if (klass.reason === "variable_command") return klass.tainted ? "high" : "medium";
  if (klass.reason === "string_concat" || klass.reason === "template_interpolation") {
    return klass.tainted ? "critical" : "high";
  }
  return klass.tainted ? "high" : "medium"; // dynamic_command
}

export async function runCommandInjectionDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("command-injection", "no_root", null, t0);

  try {
    const exts = [".js", ".mjs", ".cjs", ".ts", ".tsx"];
    const files = await walk(root, exts);
    const findings = [];
    let scanned = 0;

    for (const f of files) {
      const rel = relPath(root, f);
      if (SKIP_FILES.some((re) => re.test(rel))) continue;
      const raw = await readSafe(f);
      if (!raw) continue;
      // Scan comment-free source so a sink in a doc example / commented-out
      // code is never flagged (line numbers preserved by stripComments).
      const c = stripComments(raw);
      const bindings = parseChildProcessBindings(c);
      if (!bindings) continue; // file doesn't touch child_process → cannot be a CP injection
      scanned++;
      const taintedVars = collectTaintedVars(c);

      // Build a regex matching either a bare imported binding `name(` (not a
      // member access — excludes `db.exec(`) or a namespace member `cp.exec(`.
      const callRe = /(\.?)\b([A-Za-z_$][\w$]*)\s*\(/g;
      let m;
      while ((m = callRe.exec(c)) != null) {
        const isMember = m[1] === ".";
        const name = m[2];
        let funcName = null;

        if (!isMember && bindings.named.has(name) && ALL_FUNCS.has(name)) {
          funcName = name;
        } else if (isMember && ALL_FUNCS.has(name)) {
          // member call: require the receiver to be a known child_process ns alias.
          const recv = c.slice(Math.max(0, m.index - 40), m.index).match(/([A-Za-z_$][\w$]*)\s*\.$/);
          if (recv && bindings.namespaces.has(recv[1])) funcName = name;
        }
        if (!funcName) continue;

        const open = c.indexOf("(", m.index + m[0].length - 1);
        if (open < 0) continue;
        const args = callArgs(c, open);

        // argv-family is safe unless shell:true re-introduces the shell.
        if (ARGV_FUNCS.has(funcName) && !hasShellTrue(args)) continue;

        const arg0 = firstArg(args);
        const klass = classifyCommandArg(arg0, taintedVars);
        if (!klass.flag) continue;

        const usesShell = SHELL_FUNCS.has(funcName) || (ARGV_FUNCS.has(funcName) && hasShellTrue(args));
        const severity = severityFor(funcName, klass);
        findings.push({
          id: `cmd_injection_${klass.reason}`,
          severity,
          kind: "static",
          category: "security",
          subject: { kind: "file", path: rel },
          message:
            `${funcName}() ${usesShell ? "runs a shell on" : "invokes"} a non-literal command (${klass.reason}` +
            `${klass.tainted ? ", references external input" : ""}) — shell-injection sink`,
          location: `${rel}:${lineOf(c, m.index)}`,
          evidence: { snippet: snippet(arg0, 120), func: funcName },
          fixHint: "use_execfile_with_args_array_no_shell",
        });
        if (findings.length > 500) break;
      }
      if (findings.length > 500) break;
    }

    findings.unshift({
      id: "command_injection_summary",
      severity: "info",
      kind: "static",
      category: "security",
      message: `Scanned ${scanned} child_process-importing file(s) of ${files.length}; flagged ${findings.length}`,
      evidence: { cpFiles: scanned, totalFiles: files.length },
    });

    return makeReport("command-injection", findings, t0);
  } catch (err) {
    return makeError("command-injection", "exception", err, t0);
  }
}
