// server/lib/ts-language-service.js
//
// ConKay-as-Builder Phase 1 — the real semantic layer for the code lens.
//
// The `code.lsp-*` macros were lexical regex heuristics (scope-blind grep,
// no types). This wires a REAL TypeScript LanguageService — the same engine
// behind tsserver / VS Code IntelliSense — reading directly from the in-memory
// workspace (STATE.codeWorkspace.files), so it is type-aware + scope-correct
// with NO child process and NO disk sync. `typescript` is already a server
// dependency (v5.9.x); we lazy-load it so server boot pays nothing until the
// first semantic request.
//
// Public API (all sync; return `null` when TS doesn't apply so the caller can
// fall back to the lexical path): completions / hover / signature / references /
// definition / diagnostics / outline. `files` is the Map<path,{content}> that
// `ensureFiles` returns; `offset` is a 0-based character offset (use offsetOf to
// convert Monaco's 1-based line/column).

import { createRequire } from "node:module";

const _require = createRequire(import.meta.url);
let _ts = null;
let _loadFailed = false;

/** Lazy-load the TypeScript compiler module (cached). Returns null if absent. */
function ts() {
  if (_ts) return _ts;
  if (_loadFailed) return null;
  try {
    // CJS module — require via createRequire so this stays sync inside macros.
    _ts = _require("typescript");
    return _ts;
  } catch {
    _loadFailed = true;
    return null;
  }
}

const TS_LIKE = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts"]);
function isTsLike(path) {
  return TS_LIKE.has(String(path).split(".").pop()?.toLowerCase() || "");
}

/** Fast, stable content fingerprint for the LanguageService version cache. */
function fingerprint(s) {
  let h = 5381;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}:${h}`;
}

/** Convert a 1-based {line,column} (Monaco) into a 0-based character offset. */
export function offsetOf(content, line, column) {
  const lines = String(content || "").split("\n");
  let off = 0;
  const L = Math.max(1, Math.min(Number(line) || 1, lines.length));
  for (let i = 0; i < L - 1; i++) off += lines[i].length + 1; // +1 for the \n
  return off + Math.max(0, (Number(column) || 1) - 1);
}

/** Convert a 0-based offset back into a 1-based {line,column}. */
function lineColOf(content, offset) {
  const upto = String(content || "").slice(0, Math.max(0, offset));
  const parts = upto.split("\n");
  return { line: parts.length, column: parts[parts.length - 1].length + 1 };
}

// One LanguageService per workspace files-Map (the same Map object persists for
// a (user, project) across macro calls — WeakMap keeps the service warm and GCs
// it when the workspace is dropped). The host reads live from the Map so edits
// are picked up via the content-fingerprint version.
const _services = new WeakMap();

function getService(files) {
  const T = ts();
  if (!T) return null;
  let svc = _services.get(files);
  if (svc) return svc;

  const compilerOptions = {
    target: T.ScriptTarget.ES2020,
    module: T.ModuleKind.ESNext,
    moduleResolution: T.ModuleResolutionKind.Bundler,
    allowJs: true,
    checkJs: false,
    jsx: T.JsxEmit.ReactJSX,
    esModuleInterop: true,
    allowNonTsExtensions: true,
    skipLibCheck: true,
    noEmit: true,
    lib: ["lib.es2020.d.ts", "lib.dom.d.ts"],
  };

  const host = {
    getScriptFileNames: () => [...files.keys()].filter(isTsLike),
    getScriptVersion: (fileName) => {
      const blob = files.get(fileName);
      const content = blob ? blob.content : T.sys.readFile(fileName);
      return fingerprint(content);
    },
    getScriptSnapshot: (fileName) => {
      const blob = files.get(fileName);
      const content = blob ? blob.content : T.sys.readFile(fileName);
      return content == null ? undefined : T.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (o) => T.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || T.sys.fileExists(f),
    readFile: (f) => (files.has(f) ? files.get(f).content : T.sys.readFile(f)),
    readDirectory: T.sys.readDirectory,
    directoryExists: T.sys.directoryExists,
    getDirectories: T.sys.getDirectories,
  };

  svc = { ls: T.createLanguageService(host, T.createDocumentRegistry()), T };
  _services.set(files, svc);
  return svc;
}

function partsToString(T, parts) {
  return T.displayPartsToString(parts || "");
}

/** Type-aware completions at a position. */
export function completions(files, path, offset, prefix = "") {
  if (!isTsLike(path) || !files.has(path)) return null;
  const svc = getService(files);
  if (!svc) return null;
  try {
    const info = svc.ls.getCompletionsAtPosition(path, offset, {
      includeCompletionsForModuleExports: true,
      includeCompletionsWithInsertText: true,
    });
    if (!info) return { entries: [] };
    const pfx = String(prefix || "").toLowerCase();
    const entries = info.entries
      .filter((e) => !pfx || e.name.toLowerCase().startsWith(pfx))
      .slice(0, 200)
      .map((e) => ({ label: e.name, kind: e.kind, detail: e.kindModifiers || "", sortText: e.sortText }));
    return { entries, count: entries.length };
  } catch {
    return null;
  }
}

/** Hover / quick-info at a position (inferred types). */
export function hover(files, path, offset) {
  if (!isTsLike(path) || !files.has(path)) return null;
  const svc = getService(files);
  if (!svc) return null;
  try {
    const qi = svc.ls.getQuickInfoAtPosition(path, offset);
    if (!qi) return { found: false };
    const text = partsToString(svc.T, qi.displayParts);
    const doc = partsToString(svc.T, qi.documentation);
    return { found: true, kind: qi.kind, hover: text, doc: doc || null, type: text };
  } catch {
    return null;
  }
}

/** Signature help at a call site. */
export function signature(files, path, offset) {
  if (!isTsLike(path) || !files.has(path)) return null;
  const svc = getService(files);
  if (!svc) return null;
  try {
    const help = svc.ls.getSignatureHelpItems(path, offset, undefined);
    if (!help || !help.items.length) return { found: false, parameters: [] };
    const item = help.items[help.selectedItemIndex || 0] || help.items[0];
    const label =
      partsToString(svc.T, item.prefixDisplayParts) +
      item.parameters.map((p) => partsToString(svc.T, p.displayParts)).join(partsToString(svc.T, item.separatorDisplayParts)) +
      partsToString(svc.T, item.suffixDisplayParts);
    const parameters = item.parameters.map((p) => ({
      label: partsToString(svc.T, p.displayParts),
      documentation: partsToString(svc.T, p.documentation) || null,
    }));
    return { found: true, label, parameters, activeParameter: help.argumentIndex || 0 };
  } catch {
    return null;
  }
}

/** Scope-correct references to the binding at a position. */
export function references(files, path, offset) {
  if (!isTsLike(path) || !files.has(path)) return null;
  const svc = getService(files);
  if (!svc) return null;
  try {
    const refs = svc.ls.getReferencesAtPosition(path, offset);
    if (!refs) return { references: [], count: 0 };
    const out = refs.slice(0, 500).map((r) => {
      const content = files.get(r.fileName)?.content || "";
      const lc = lineColOf(content, r.textSpan.start);
      const lineText = String(content).split("\n")[lc.line - 1] || "";
      return { path: r.fileName, line: lc.line, column: lc.column, isDefinition: !!r.isDefinition, snippet: lineText.trim().slice(0, 200) };
    });
    return { references: out, count: out.length };
  } catch {
    return null;
  }
}

/** Go-to-definition for the symbol at a position. */
export function definition(files, path, offset) {
  if (!isTsLike(path) || !files.has(path)) return null;
  const svc = getService(files);
  if (!svc) return null;
  try {
    const defs = svc.ls.getDefinitionAtPosition(path, offset);
    if (!defs) return { definitions: [] };
    const out = defs.map((d) => {
      const content = files.get(d.fileName)?.content || "";
      const lc = lineColOf(content, d.textSpan.start);
      return { path: d.fileName, line: lc.line, column: lc.column, name: d.name, kind: d.kind };
    });
    return { definitions: out };
  } catch {
    return null;
  }
}

/** Real semantic + syntactic diagnostics for a file. */
export function diagnostics(files, path) {
  if (!isTsLike(path) || !files.has(path)) return null;
  const svc = getService(files);
  if (!svc) return null;
  try {
    const content = files.get(path)?.content || "";
    const raw = [
      ...svc.ls.getSyntacticDiagnostics(path),
      ...svc.ls.getSemanticDiagnostics(path),
    ];
    const sev = { 0: "warning", 1: "error", 2: "info", 3: "info" };
    const problems = raw.map((d) => {
      const lc = d.start != null ? lineColOf(content, d.start) : { line: 1, column: 1 };
      return {
        path,
        line: lc.line,
        column: lc.column,
        severity: sev[d.category] || "info",
        message: svc.T.flattenDiagnosticMessageText(d.messageText, "\n"),
        rule: `ts(${d.code})`,
      };
    });
    return { problems };
  } catch {
    return null;
  }
}

/** Real document outline (navigation tree) for a file. */
export function outline(files, path) {
  if (!isTsLike(path) || !files.has(path)) return null;
  const svc = getService(files);
  if (!svc) return null;
  try {
    const content = files.get(path)?.content || "";
    const items = svc.ls.getNavigationBarItems(path);
    const symbols = [];
    const seen = new Set();
    const KIND_MAP = { method: "function", function: "function", class: "class", interface: "interface", type: "type", enum: "enum", const: "variable", let: "variable", var: "variable", property: "property", "local class": "class", module: "module", alias: "type" };
    const walk = (nodes, depth) => {
      for (const n of nodes || []) {
        if (n.text === "<global>") { walk(n.childItems, depth); continue; }
        const span = n.spans && n.spans[0];
        const lc = span ? lineColOf(content, span.start) : { line: 1 };
        const key = `${n.text}:${lc.line}`;
        if (!seen.has(key)) {
          seen.add(key);
          symbols.push({ name: n.text, kind: KIND_MAP[n.kind] || n.kind || "symbol", line: lc.line, depth });
        }
        if (n.childItems && depth < 4) walk(n.childItems, depth + 1);
      }
    };
    walk(items, 0);
    symbols.sort((a, b) => a.line - b.line);
    return { symbols };
  } catch {
    return null;
  }
}

/** True when the TypeScript engine is available + the path is TS/JS. */
export function tsAvailable(path) {
  return !!ts() && (path == null || isTsLike(path));
}

export default {
  offsetOf, completions, hover, signature, references, definition, diagnostics, outline, tsAvailable,
};
