// server/lib/code-ast-complexity.js
//
// Real per-function AST complexity for the `repos` lens's `codeComplexity`
// macro (server/domains/repos.js). Closes docs/WAVE4_INVENTORY.md's
// "codeComplexity's heuristic is a regex count, not a real AST parse"
// finding: the prior caller (concord-frontend/components/repos/
// ConcordRepoWorkspace.tsx's `estimateFileComplexity`) counted `\bif\s*\(/g`
// etc. matches over raw file text and folded an ENTIRE file into one
// synthetic "function" record — no per-function boundary detection at all.
//
// This module instead walks the real syntax tree produced by the
// `typescript` compiler package — the same package server/lib/
// ts-language-service.js already uses (lazy `require("typescript")` via
// `createRequire`, exactly its pattern) for the code lens's real
// LanguageService. `typescript` is already a hard server dependency
// (server/package.json), so this needed ZERO new npm packages.
//
// Function boundaries are real AST nodes: every FunctionDeclaration,
// FunctionExpression, ArrowFunction, MethodDeclaration, GetAccessor,
// SetAccessor, and class Constructor becomes its own metrics frame, so a
// file with N real functions reports N separate complexity records, never
// one whole-file blob.
//
// Decision-point counting mirrors ESLint's `complexity` rule (a
// well-established McCabe-cyclomatic-complexity approximation used
// industry-wide): IfStatement, non-default SwitchCase (CaseClause),
// CatchClause, For/ForIn/ForOf/While/DoStatement, ConditionalExpression
// (ternary), and each individual `&&` / `||` operator. Nesting depth is a
// real per-frame counter incremented on entering one of those constructs and
// decremented on the way back out of its subtree — not a text-indentation
// guess.

import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
let _ts = null;
let _loadFailed = false;

/** Lazy-load the TypeScript compiler module (cached, mirrors ts-language-service.js). */
function ts() {
  if (_ts) return _ts;
  if (_loadFailed) return null;
  try {
    _ts = _require("typescript");
    return _ts;
  } catch {
    _loadFailed = true;
    return null;
  }
}

/** True when the TypeScript parser package is loadable. Callers use this to
 *  fail honestly (never silently degrade to a fabricated/guessed count). */
export function astEngineAvailable() {
  return !!ts();
}

function pickScriptKind(T, path) {
  const ext = String(path || "").split(".").pop()?.toLowerCase();
  if (ext === "tsx") return T.ScriptKind.TSX;
  if (ext === "ts" || ext === "mts" || ext === "cts") return T.ScriptKind.TS;
  if (ext === "jsx") return T.ScriptKind.JSX;
  // .js/.mjs/.cjs and any unrecognised extension: JSX-permissive, so an
  // ordinary React .js file (common in the wild — extension doesn't always
  // match content) still parses its <Component/> tags without erroring.
  return T.ScriptKind.JSX;
}

function functionLikeKinds(T) {
  return new Set([
    T.SyntaxKind.FunctionDeclaration,
    T.SyntaxKind.FunctionExpression,
    T.SyntaxKind.ArrowFunction,
    T.SyntaxKind.MethodDeclaration,
    T.SyntaxKind.GetAccessor,
    T.SyntaxKind.SetAccessor,
    T.SyntaxKind.Constructor,
  ]);
}

function nestingKinds(T) {
  return new Set([
    T.SyntaxKind.IfStatement,
    T.SyntaxKind.ForStatement,
    T.SyntaxKind.ForInStatement,
    T.SyntaxKind.ForOfStatement,
    T.SyntaxKind.WhileStatement,
    T.SyntaxKind.DoStatement,
    T.SyntaxKind.SwitchStatement,
    T.SyntaxKind.TryStatement,
  ]);
}

/** Best-effort REAL name for a function-like node, from its own binding or
 *  the nearest assignment target (`const foo = () => {}`, `obj.bar = function
 *  () {}`, `{ baz() {} }`). Falls back to "<anonymous>" — never invented. */
function functionNameFor(T, node) {
  if (node.name && T.isIdentifier(node.name)) return node.name.text;
  if (node.kind === T.SyntaxKind.GetAccessor || node.kind === T.SyntaxKind.SetAccessor) {
    const prefix = node.kind === T.SyntaxKind.GetAccessor ? "get " : "set ";
    try { return prefix + node.name.getText(); } catch { return prefix + "<anonymous>"; }
  }
  if (node.kind === T.SyntaxKind.Constructor) return "constructor";
  if (node.name) { try { return node.name.getText(); } catch { /* computed name, fall through */ } }
  const p = node.parent;
  if (p) {
    if (T.isVariableDeclaration(p) && p.name && T.isIdentifier(p.name)) return p.name.text;
    if (T.isPropertyAssignment(p) && p.name) { try { return p.name.getText(); } catch { /* noop */ } }
    if (T.isPropertyDeclaration(p) && p.name) { try { return p.name.getText(); } catch { /* noop */ } }
    if (T.isBinaryExpression(p) && p.operatorToken.kind === T.SyntaxKind.EqualsToken) {
      try { return p.left.getText(); } catch { /* noop */ }
    }
  }
  return "<anonymous>";
}

function newFrame(name) {
  return { name, branches: 0, loops: 0, conditions: 0, depth: 0, maxNesting: 0, startLine: null, endLine: null };
}

/**
 * analyzeSourceComplexity — real AST walk of one file's source text.
 *
 * @param {string} path - file path/name; only its extension is used, to pick
 *   a permissive-enough ts.ScriptKind (TS/TSX/JS/JSX all parse via the same
 *   `typescript` package).
 * @param {string} content - real source text.
 * @returns {{name:string, functions:Array<{name:string, lines:number,
 *   branches:number, loops:number, conditions:number, nesting:number}>,
 *   imports:string[], exports:string[]}|null} the `modules[]`-shaped record
 *   `repos.codeComplexity` already expects, or `null` when the TypeScript
 *   parser package isn't loadable — an honest failure signal, never a
 *   fabricated fallback count.
 */
export function analyzeSourceComplexity(path, content) {
  const T = ts();
  if (!T) return null;
  const text = String(content || "");
  const sourceFile = T.createSourceFile(
    String(path || "file.ts"),
    text,
    T.ScriptTarget.Latest,
    /* setParentNodes */ true, // required: functionNameFor() reads node.parent
    pickScriptKind(T, path),
  );

  const FN_KINDS = functionLikeKinds(T);
  const NEST_KINDS = nestingKinds(T);
  const functions = [];
  const imports = [];
  const exports = [];

  const moduleFrame = newFrame("<module>");
  const stack = [moduleFrame];

  function lineOf(pos) {
    return T.getLineAndCharacterOfPosition(sourceFile, pos).line + 1; // 1-based
  }

  function recordImportExport(node, kind) {
    if (kind === T.SyntaxKind.ImportDeclaration) {
      try { imports.push(String(node.moduleSpecifier.getText(sourceFile)).replace(/^["']|["']$/g, "")); } catch { /* noop */ }
      return;
    }
    if (kind === T.SyntaxKind.ExportDeclaration) {
      try { exports.push(node.getText(sourceFile).slice(0, 60)); } catch { exports.push("export"); }
      return;
    }
    if (kind === T.SyntaxKind.ExportAssignment) {
      exports.push("default");
      return;
    }
    if (
      (kind === T.SyntaxKind.FunctionDeclaration || kind === T.SyntaxKind.ClassDeclaration || kind === T.SyntaxKind.VariableStatement) &&
      Array.isArray(node.modifiers) && node.modifiers.some((m) => m.kind === T.SyntaxKind.ExportKeyword)
    ) {
      try {
        let label = "export";
        if (node.name && typeof node.name.getText === "function") label = node.name.getText(sourceFile);
        else if (node.declarationList?.declarations?.[0]?.name) label = node.declarationList.declarations[0].name.getText(sourceFile);
        exports.push(label);
      } catch { exports.push("export"); }
    }
  }

  function visit(node) {
    const kind = node.kind;
    recordImportExport(node, kind);

    const isFn = FN_KINDS.has(kind);
    let pushedFrame = null;
    if (isFn) {
      pushedFrame = newFrame(functionNameFor(T, node));
      pushedFrame.startLine = lineOf(node.getStart(sourceFile));
      pushedFrame.endLine = lineOf(node.getEnd());
      stack.push(pushedFrame);
    }

    const frame = stack[stack.length - 1];

    const entersNesting = NEST_KINDS.has(kind);
    if (entersNesting) {
      frame.depth += 1;
      frame.maxNesting = Math.max(frame.maxNesting, frame.depth);
    }

    if (kind === T.SyntaxKind.IfStatement) frame.branches += 1;
    else if (kind === T.SyntaxKind.CatchClause) frame.branches += 1;
    else if (kind === T.SyntaxKind.CaseClause) frame.branches += 1; // DefaultClause intentionally excluded
    else if (
      kind === T.SyntaxKind.ForStatement || kind === T.SyntaxKind.ForInStatement ||
      kind === T.SyntaxKind.ForOfStatement || kind === T.SyntaxKind.WhileStatement ||
      kind === T.SyntaxKind.DoStatement
    ) frame.loops += 1;
    else if (kind === T.SyntaxKind.ConditionalExpression) frame.conditions += 1;
    else if (
      kind === T.SyntaxKind.BinaryExpression &&
      (node.operatorToken.kind === T.SyntaxKind.AmpersandAmpersandToken || node.operatorToken.kind === T.SyntaxKind.BarBarToken)
    ) frame.conditions += 1;

    T.forEachChild(node, visit);

    if (entersNesting) frame.depth -= 1;

    if (isFn) {
      stack.pop();
      const lines = (pushedFrame.endLine != null && pushedFrame.startLine != null)
        ? (pushedFrame.endLine - pushedFrame.startLine + 1) : 0;
      functions.push({
        name: pushedFrame.name,
        lines,
        branches: pushedFrame.branches,
        loops: pushedFrame.loops,
        conditions: pushedFrame.conditions,
        nesting: pushedFrame.maxNesting,
      });
    }
  }

  visit(sourceFile);

  // Attribute top-level (module-scope) decision points honestly instead of
  // silently dropping them — a script with real top-level `if`/`for` (config
  // files, CLI entrypoints) still reports real numbers, under a synthetic
  // "<module>" name. Only added when it actually found something (or the
  // file has no functions at all) so ordinary files aren't cluttered with a
  // trailing all-zero entry.
  if (moduleFrame.branches + moduleFrame.loops + moduleFrame.conditions > 0 || functions.length === 0) {
    functions.push({
      name: "<module>",
      lines: text ? text.split("\n").length : 0,
      branches: moduleFrame.branches,
      loops: moduleFrame.loops,
      conditions: moduleFrame.conditions,
      nesting: moduleFrame.maxNesting,
    });
  }

  return { name: path, functions, imports, exports };
}

export default { analyzeSourceComplexity, astEngineAvailable };
