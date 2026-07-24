// server/lib/detectors/constant-time-detector.js
//
// Constant-time / secret-dependent-flow detector.
//
// The first genuinely AST-based detector in this suite (every other detector
// is regex/string matching over raw file text). It parses each candidate
// backend source file into a real TypeScript/JavaScript AST (via the
// `typescript` compiler API's parser — no type-checking, syntax only) and
// runs a small, intentionally-simple taint analysis to find the SOURCE-LEVEL
// precondition for a timing side channel: control flow or a memory address
// that depends on secret data.
//
// ── Honest boundary (read before trusting a clean report) ─────────────────
// This is source-level detection of secret-dependent control flow and memory
// access — the *precondition* for a timing side channel, not proof of one,
// and not proof of its absence. Microarchitectural effects are HARDWARE
// semantics: speculative and transient execution, cache line state, port
// contention, and prefetcher behavior are invisible at this level and are
// not modeled. Even state-of-the-art tooling operates lower down — `ct-verif`
// works on LLVM IR with source annotations and has in practice been applied
// to functions well under 100 lines. This analyzer's taint propagation is
// FILE-SCOPED (not properly lexically scoped per function, not
// inter-procedural across files) — a local variable in one function that
// happens to share a name with a tainted variable in another function in the
// same file is also treated as tainted (a conservative, documented
// over-approximation). Its taint SOURCE by default is the explicit
// `// @secret` annotation ONLY — the SECRET_NAME_RE naming heuristic is
// opt-in via `opts.useNamingConvention` and defaults to OFF, because
// measured against this repo it produced 500 findings (its cap) after just
// 27 of 4,382 files, 373 of them from `seedDefaultCoA` alone. See the taint
// source policy at the seeding code for the full rationale. Consequence to
// be honest about: DEFAULT RECALL IS LOW. Nothing is tainted until an author
// annotates it, so a clean default run mostly means "nobody has marked their
// secrets yet," not "this codebase is constant-time." Property-access
// names are matched by text too (`obj.token` counts as a reference), which
// can conflate an unrelated property with a like-named tainted variable.
// Flow that leaves the file (a tainted value returned across a `require`/
// `import` boundary, or reaching a sink through a class instance field) is
// not tracked. A clean report means "no secret-dependent pattern found by
// these rules," never "constant-time."
//
// ── How secrets are identified (taint sources) ─────────────────────────────
//   1. Annotation: a `// @secret` comment leading (or trailing, same line)
//      the declaration, OR leading the enclosing statement (so it can sit
//      above a `function`/`const` line, not just inline on the parameter).
//   2. Naming convention (OPT-IN, default OFF — pass
//      `opts.useNamingConvention: true`): a variable/parameter/destructured-
//      binding name matching SECRET_NAME_RE. Appropriate when auditing a
//      specific crypto/auth module whose vocabulary genuinely means what it
//      says; inappropriate as a repo-wide default (see the boundary note).
//   3. Function-name propagation: if a function's `return` expression(s)
//      reference tainted data, the function's own name becomes a tainted
//      "producer" — so `const x = getSigningKey();` taints `x` when
//      `getSigningKey` is defined in the same file and returns tainted data.
//      This is the "returns" propagation the design calls for; it does NOT
//      model calls into functions from OTHER files.
//
// ── How taint propagates ────────────────────────────────────────────────────
//   - `const/let/var` declarations (including object/array destructuring):
//     if the initializer references a tainted identifier, every bound name
//     becomes tainted.
//   - Plain assignment (`x = expr`, including destructuring assignment
//     targets `{a,b} = obj` / `[a,b] = arr`): same rule.
//   - Compound assignment operators (`|=`, `^=`, `+=`, …) are DELIBERATELY
//     NOT taint-propagating. The canonical constant-time-compare idiom is
//     `diff |= a[i] ^ b[i]` — accumulating a difference across a fixed-length
//     loop and comparing once at the end is exactly the SAFE pattern this
//     analyzer must not punish; if `|=` propagated taint the safe idiom's
//     final `return diff === 0` would look no different from a leaky branch.
//   - Function parameters and destructured params are taint sources
//     directly (same naming/annotation rules as `const`).
//   - Propagation is a small fixed-point loop (max 3 rounds) over the file so
//     order-independent chains (`const a = f(); function f(){ return secret; }`
//     defined below its use) still resolve.
//
// ── What's flagged ──────────────────────────────────────────────────────────
//   (a) secret_dependent_branch — an `if`/ternary/`switch` test, or a
//       statement-level `&&`/`||` short-circuit, whose condition references
//       tainted data. The branch TAKEN (and its timing) can leak the secret.
//   (b) secret_dependent_index — `arr[secret]` / `obj[secretKey]`: the INDEX
//       expression (not just the object) references tainted data. Classic
//       cache-timing precondition (secret-dependent memory address).
//   (c) secret_dependent_loop_bound — a `for`/`while`/`do` loop condition
//       references tainted data as the bound itself. `.length` property
//       access on a tainted array/buffer is deliberately EXCLUDED from this
//       rule only — `for (let i = 0; i < secret.length; i++)` is the
//       recommended FIXED-length-loop idiom (iterate every byte regardless
//       of content), not a leak; a secret-dependent COUNT (`i < attempts`
//       where `attempts` is itself secret-tainted, not a `.length` access)
//       still fires.
//   (c) secret_dependent_early_exit — a `for`/`for-of`/`while`/`do` loop that
//       touches tainted data anywhere in its body AND contains a
//       conditionally-guarded `return`/`break` (nested inside an `if`,
//       anywhere in the loop body, not crossing into a nested function
//       boundary). This is the textbook non-constant-time comparison: exit
//       on first mismatch leaks the mismatch position via timing.
//
// Each finding carries a real `file:line` (via the AST node's actual source
// position, not a regex-guessed offset) and a `fixHint` naming the concrete
// remedy (constant-time comparison, branchless select, fixed public bound).
//
// ── Parser availability ─────────────────────────────────────────────────────
// `typescript` is a devDependency of server/package.json — it may be absent
// from a production install. It is lazy-imported inside `run()` inside a
// try/catch; if unavailable, the detector returns `ok:true` with a single
// `info` finding explaining it could not run, rather than crashing the
// sweep (a detector that throws breaks the runner for everything else).
// Tests can force this path via `opts.__loadTs` (an injectable loader hook)
// without needing to actually uninstall the package.

import { walk, readSafe, makeReport, makeError, relPath, snippet } from "./_framework.js";

export const SECRET_NAME_RE =
  /secret|password|passwd|private[_-]?key|api[_-]?key|token|nonce|seed|hmac|signature|passphrase|credential/i;
export const SECRET_ANNOTATION_RE = /@secret\b/;

// Deliberately backend-scoped. Control-flow/memory-index timing leaks are a
// crypto/auth-surface concern (signing, token comparison, session lookup);
// scoping to server/ avoids drowning true findings in concord-frontend/
// concord-mobile client-side `password` FORM STATE noise (an input field's
// React state named `password` is not a comparison/branch worth flagging the
// same way a backend verify function is).
const SCAN_ROOT = "server";
const EXTS = [".js", ".mjs", ".cjs", ".ts"];

const SKIP_FILES = [
  /\.(?:test|spec)\.(?:js|mjs|cjs|ts|tsx)$/,
  /\/tests\/fixtures\//,
  // The detector suite's own source is meta-noise (this file's header prose
  // and regex literals mention every taint keyword in the book) and is not
  // itself a runtime attack surface.
  /\/lib\/detectors\//,
];

const MAX_FINDINGS = 500;

/** Injectable so tests can simulate "parser unavailable" without uninstalling it. */
async function loadTs(opts) {
  if (opts && typeof opts.__loadTs === "function") return opts.__loadTs();
  try {
    const mod = await import("typescript");
    const ts = mod?.default && mod.default.isIdentifier ? mod.default : mod;
    if (!ts || typeof ts.createSourceFile !== "function") return null;
    return ts;
  } catch {
    return null;
  }
}

function scriptKindFor(ts, ext) {
  if (ext === ".ts") return ts.ScriptKind.TS;
  if (ext === ".tsx") return ts.ScriptKind.TSX;
  return ts.ScriptKind.JS;
}

// ── Binding / target name collection ────────────────────────────────────────

function collectBindingNames(ts, nameNode, out = []) {
  if (!nameNode) return out;
  if (ts.isIdentifier(nameNode)) { out.push(nameNode.text); return out; }
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const el of nameNode.elements) {
      if (ts.isBindingElement(el)) collectBindingNames(ts, el.name, out);
    }
  }
  return out;
}

function collectAssignmentTargetNames(ts, node, out = []) {
  if (!node) return out;
  if (ts.isIdentifier(node)) { out.push(node.text); return out; }
  if (ts.isObjectLiteralExpression(node)) {
    for (const p of node.properties) {
      if (ts.isShorthandPropertyAssignment(p)) out.push(p.name.text);
      else if (ts.isPropertyAssignment(p)) collectAssignmentTargetNames(ts, p.initializer, out);
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const el of node.elements) collectAssignmentTargetNames(ts, el, out);
    return out;
  }
  return out;
}

// ── Annotation lookup ────────────────────────────────────────────────────────

function hasSecretAnnotation(ts, sf, node) {
  const checkAt = (n) => {
    if (!n) return false;
    let leading = [], trailing = [];
    try { leading = ts.getLeadingCommentRanges(sf.text, n.getFullStart()) || []; } catch { /* boundary node */ }
    try { trailing = ts.getTrailingCommentRanges(sf.text, n.getEnd()) || []; } catch { /* boundary node */ }
    for (const r of [...leading, ...trailing]) {
      if (SECRET_ANNOTATION_RE.test(sf.text.slice(r.pos, r.end))) return true;
    }
    return false;
  };
  if (checkAt(node)) return true;
  let stmt = node.parent;
  while (stmt && !ts.isStatement(stmt)) stmt = stmt.parent;
  if (stmt && checkAt(stmt)) return true;
  return false;
}

// ── Taint reference check ───────────────────────────────────────────────────

/**
 * Does `node`'s subtree reference any identifier in `tainted`?
 * `skipLengthAccess`: when true, a `.length` PROPERTY ACCESS is opaque — its
 * object expression is not descended into. This is the carve-out that keeps
 * the fixed-length `for (i = 0; i < secret.length; i++)` idiom from being
 * misread as a secret-dependent loop bound (see header).
 */
function containsTaintedIdentifier(ts, node, tainted, { skipLengthAccess = false } = {}) {
  if (!node || !tainted || tainted.size === 0) return false;
  let found = false;
  function visit(n) {
    if (found) return;
    if (skipLengthAccess && ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.name) && n.name.text === "length") {
      return; // opaque: don't descend into the object being measured
    }
    if (ts.isIdentifier(n) && tainted.has(n.text)) { found = true; return; }
    n.forEachChild(visit);
  }
  visit(node);
  return found;
}

function subtreeHasReturnOrBreak(ts, node) {
  let found = false;
  function visit(n) {
    if (found) return;
    if (ts.isFunctionLike(n)) return; // don't cross function boundaries
    if (ts.isReturnStatement(n) || ts.isBreakStatement(n)) { found = true; return; }
    n.forEachChild(visit);
  }
  visit(node);
  return found;
}

/** Is there an `if` (anywhere in the body, not crossing a nested function) whose subtree contains a return/break? */
function loopBodyHasConditionalEarlyExit(ts, bodyNode) {
  let found = false;
  function visit(n) {
    if (found) return;
    if (ts.isFunctionLike(n) && n !== bodyNode) return;
    if (ts.isIfStatement(n)) {
      if (subtreeHasReturnOrBreak(ts, n)) { found = true; return; }
    }
    n.forEachChild(visit);
  }
  visit(bodyNode);
  return found;
}

function returnsTainted(ts, body, tainted) {
  let found = false;
  function visit(n) {
    if (found) return;
    if (ts.isFunctionLike(n) && n !== body) return;
    if (ts.isReturnStatement(n) && n.expression && containsTaintedIdentifier(ts, n.expression, tainted)) {
      found = true;
      return;
    }
    n.forEachChild(visit);
  }
  visit(body);
  return found;
}

// ── Per-file analysis ────────────────────────────────────────────────────────

export function analyzeSourceText(ts, fileName, text, relFile, ext, opts = {}) {
  let sf;
  try {
    sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, scriptKindFor(ts, ext));
  } catch {
    return []; // unparseable — never throw, just contribute nothing
  }
  if (!sf) return [];

  const tainted = new Set();

  // Pass 0: seed direct taint sources on every parameter and variable
  // declaration in the file.
  //
  // TAINT SOURCE POLICY (corrected during conductor verification — this is
  // the difference between a usable detector and 500 findings of noise):
  //
  // The `// @secret` ANNOTATION is authoritative and always seeds taint.
  // SECRET_NAME_RE is a heuristic and is OPT-IN (`opts.useNamingConvention`),
  // defaulting to OFF.
  //
  // Why: run against this repo with the naming heuristic on, the detector hit
  // its 500-finding cap after scanning 27 of 4,382 files, and 373 of those
  // came from a single file because `seedDefaultCoA` — chart-of-accounts
  // content seeding, nothing to do with cryptography — matches /seed/. "token"
  // matched LLM/Discord/Telegram API tokens throughout. A taint analysis is
  // only as good as its sources, and inferring "this is a secret" from an
  // identifier substring is guessing; in a 4,000-file general-purpose codebase
  // it guesses wrong far more often than right, and a detector that cries wolf
  // 500 times teaches everyone to ignore it.
  //
  // Annotation-only gives high precision and honest (low) recall, which is the
  // right default for a checker whose findings are meant to be acted on. A
  // caller auditing a specific crypto module — where the vocabulary genuinely
  // does mean what it says — can opt the heuristic back on.
  const useNamingConvention = opts.useNamingConvention === true;
  function seedName(nameNode, annotationNode) {
    const names = collectBindingNames(ts, nameNode);
    if (useNamingConvention) {
      for (const nm of names.filter((nm) => SECRET_NAME_RE.test(nm))) tainted.add(nm);
    }
    if (names.length && hasSecretAnnotation(ts, sf, annotationNode)) {
      for (const nm of names) tainted.add(nm);
    }
  }
  (function seedWalk(n) {
    if (ts.isParameter(n)) seedName(n.name, n);
    else if (ts.isVariableDeclaration(n)) seedName(n.name, n);
    n.forEachChild(seedWalk);
  })(sf);

  // Fixed-point propagation (function-return producers, decl init, plain assignment).
  for (let round = 0; round < 3; round++) {
    let changed = false;

    (function funcPass(n) {
      let name = null, body = null;
      if (ts.isFunctionDeclaration(n) && n.name) { name = n.name.text; body = n.body; }
      else if (
        ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.name) &&
        (ts.isFunctionExpression(n.initializer) || ts.isArrowFunction(n.initializer))
      ) { name = n.name.text; body = n.initializer.body; }
      if (name && body && !tainted.has(name) && returnsTainted(ts, body, tainted)) {
        tainted.add(name);
        changed = true;
      }
      n.forEachChild(funcPass);
    })(sf);

    (function declPass(n) {
      if (ts.isVariableDeclaration(n) && n.initializer) {
        const names = collectBindingNames(ts, n.name).filter((nm) => !tainted.has(nm));
        if (names.length && containsTaintedIdentifier(ts, n.initializer, tainted)) {
          for (const nm of names) tainted.add(nm);
          changed = true;
        }
      }
      n.forEachChild(declPass);
    })(sf);

    (function assignPass(n) {
      if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const names = collectAssignmentTargetNames(ts, n.left).filter((nm) => !tainted.has(nm));
        if (names.length && containsTaintedIdentifier(ts, n.right, tainted)) {
          for (const nm of names) tainted.add(nm);
          changed = true;
        }
      }
      n.forEachChild(assignPass);
    })(sf);

    if (!changed) break;
  }

  if (tainted.size === 0) return [];

  const findings = [];
  const lineOfNode = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  function pushFinding(id, severity, node, message, fixHint) {
    if (findings.length >= MAX_FINDINGS) return;
    findings.push({
      id,
      severity,
      kind: "static",
      category: "timing-side-channel",
      subject: { kind: "file", path: relFile },
      message,
      location: `${relFile}:${lineOfNode(node)}`,
      evidence: { snippet: snippet(node.getText(sf), 160) },
      fixHint,
    });
  }

  (function reportWalk(n) {
    if (findings.length >= MAX_FINDINGS) return;

    // (a) secret-dependent branch
    if (ts.isIfStatement(n)) {
      if (containsTaintedIdentifier(ts, n.expression, tainted)) {
        pushFinding(
          "secret_dependent_branch", "high", n,
          `if-condition depends on secret-tainted data (\`${snippet(n.expression.getText(sf), 80)}\`) — the branch taken (and its timing) can leak the secret.`,
          "replace the branch with a constant-time/branchless select (bitmask conditional move) over secret data, or restructure so the branch condition doesn't depend on the secret."
        );
      }
    } else if (ts.isConditionalExpression(n)) {
      if (containsTaintedIdentifier(ts, n.condition, tainted)) {
        pushFinding(
          "secret_dependent_branch", "high", n,
          `ternary condition depends on secret-tainted data (\`${snippet(n.condition.getText(sf), 80)}\`) — the branch taken (and its timing) can leak the secret.`,
          "replace with a constant-time/branchless select instead of a secret-dependent ternary."
        );
      }
    } else if (ts.isSwitchStatement(n)) {
      if (containsTaintedIdentifier(ts, n.expression, tainted)) {
        pushFinding(
          "secret_dependent_branch", "high", n,
          `switch discriminant depends on secret-tainted data (\`${snippet(n.expression.getText(sf), 80)}\`) — the case taken (and its timing) can leak the secret.`,
          "replace the switch with a constant-time/branchless select over secret data."
        );
      }
    } else if (
      ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || n.operatorToken.kind === ts.SyntaxKind.BarBarToken) &&
      n.parent && ts.isExpressionStatement(n.parent)
    ) {
      // Only the standalone-statement idiom (`isValid && doThing();`) — the
      // if/ternary/switch cases above already cover a &&/|| living inside a
      // control-construct's test, so this avoids double-reporting the same
      // underlying branch.
      if (containsTaintedIdentifier(ts, n.left, tainted)) {
        pushFinding(
          "secret_dependent_branch", "high", n,
          `short-circuit \`${n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ? "&&" : "||"}\` used as flow control on secret-tainted data (\`${snippet(n.left.getText(sf), 80)}\`) — whether the right side executes (and its timing) can leak the secret.`,
          "restructure so control flow doesn't fork on the secret; use a constant-time/branchless select."
        );
      }
    }

    // (b) secret-dependent memory index
    if (ts.isElementAccessExpression(n) && n.argumentExpression) {
      if (containsTaintedIdentifier(ts, n.argumentExpression, tainted)) {
        pushFinding(
          "secret_dependent_index", "high", n,
          `Index expression depends on secret-tainted data (\`${snippet(n.getText(sf), 100)}\`) — a secret-dependent memory address is the classic cache-timing side-channel precondition.`,
          "use a constant-time/branchless table lookup (touch every entry, select via bitmask) instead of indexing directly with secret data."
        );
      }
    }

    // (c) secret-dependent loop bound (fixed .length-of-tainted-array bound is exempt)
    if (ts.isForStatement(n) && n.condition) {
      if (containsTaintedIdentifier(ts, n.condition, tainted, { skipLengthAccess: true })) {
        pushFinding(
          "secret_dependent_loop_bound", "high", n,
          `for-loop bound depends on secret-tainted data (\`${snippet(n.condition.getText(sf), 80)}\`) — the iteration count leaks the secret's magnitude via timing.`,
          "use a fixed, public iteration bound (e.g. the buffer's known/public length) instead of a secret-derived bound."
        );
      }
    } else if ((ts.isWhileStatement(n) || ts.isDoStatement(n)) && n.expression) {
      if (containsTaintedIdentifier(ts, n.expression, tainted, { skipLengthAccess: true })) {
        pushFinding(
          "secret_dependent_loop_bound", "high", n,
          `loop condition depends on secret-tainted data (\`${snippet(n.expression.getText(sf), 80)}\`) — the iteration count leaks the secret's magnitude via timing.`,
          "use a fixed, public iteration bound instead of a secret-derived condition."
        );
      }
    }

    // (c) conditional early exit from a loop that touches tainted data
    if (
      (ts.isForStatement(n) || ts.isForOfStatement(n) || ts.isWhileStatement(n) || ts.isDoStatement(n)) &&
      n.statement
    ) {
      if (containsTaintedIdentifier(ts, n.statement, tainted) && loopBodyHasConditionalEarlyExit(ts, n.statement)) {
        pushFinding(
          "secret_dependent_early_exit", "high", n,
          "Loop over secret-tainted data contains a conditionally-guarded return/break — classic non-constant-time comparison (exiting on first mismatch leaks the mismatch position via timing).",
          "accumulate a difference across the full fixed-length iteration (e.g. `diff |= a[i] ^ b[i]`) and compare once after the loop completes; never return/break early inside a loop over secret data."
        );
      }
    }

    n.forEachChild(reportWalk);
  })(sf);

  return findings;
}

// ── Detector entry point ────────────────────────────────────────────────────

export async function runConstantTimeDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("constant-time", "no_root", null, t0);

  try {
    const ts = await loadTs(opts);
    if (!ts) {
      return makeReport(
        "constant-time",
        [{
          id: "constant_time_parser_unavailable",
          severity: "info",
          kind: "static",
          category: "timing-side-channel",
          message:
            "The `typescript` compiler API (a devDependency) could not be loaded, so the AST-based constant-time analyzer did not run. " +
            "This is an honest no-op, not a clean bill of health — install `typescript` in server/node_modules to enable this detector.",
          fixHint: "ensure `typescript` is installed (npm install in server/, even for a production build if this detector should run there)",
        }],
        t0
      );
    }

    const scanDir = `${root}/${SCAN_ROOT}`;
    const files = await walk(scanDir, EXTS);
    const findings = [];
    let scanned = 0;

    for (const f of files) {
      const rel = relPath(root, f);
      if (SKIP_FILES.some((re) => re.test(rel))) continue;
      const content = await readSafe(f);
      if (!content) continue;
      scanned++;
      const ext = EXTS.find((e) => f.endsWith(e)) || ".js";
      let fileFindings;
      try {
        fileFindings = analyzeSourceText(ts, f, content, rel, ext, opts);
      } catch {
        fileFindings = []; // never let one malformed file break the sweep
      }
      for (const fn of fileFindings) {
        if (findings.length >= MAX_FINDINGS) break;
        findings.push(fn);
      }
      if (findings.length >= MAX_FINDINGS) break;
    }

    findings.unshift({
      id: "constant_time_summary",
      severity: "info",
      kind: "static",
      category: "timing-side-channel",
      message: `Scanned ${scanned} of ${files.length} candidate file(s) under ${SCAN_ROOT}/; flagged ${findings.length} secret-dependent-flow pattern(s). See this detector's module header for the honest scope boundary — a clean file means "no pattern matched by these rules," not "constant-time."`,
      evidence: { scanned, totalFiles: files.length },
    });

    return makeReport("constant-time", findings, t0);
  } catch (err) {
    return makeError("constant-time", "exception", err, t0);
  }
}
